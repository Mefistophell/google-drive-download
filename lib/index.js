const fs = require('fs')
const readline = require('readline')
const { google } = require('googleapis')
const crypto = require('crypto')


module.exports = function(config) {
    /**
     * Validate the config properties
     *
     * @type {{scopes: string, tokenPath: string, credentialsPath: string, fileDir: string, mimeTypes: string, maxFileSize: string}}
     */

    const props = {
        scopes: 'object',
        tokenPath: 'string',
        credentialsPath: 'string',
        fileDir: 'string',
        mimeTypes: 'object',
        maxFileSize: 'number',
    }

    function checkProp(prop, type) {
        if (!config[prop] || typeof config[prop] !== type) throw new Error(`The ${prop} value is not valid`)
    }

    for (let key in props) {
        checkProp(key, props[key])
    }

    return GDrive.bind({
        SCOPES: config.scopes,
        TOKEN_PATH: config.tokenPath,
        CREDENTIALS_JSON: config.credentialsPath,
        DIR: config.fileDir,
        MIMETYPES: config.mimeTypes,
        MAXFILESIZE: config.maxFileSize
    })
}


function GDrive(id) {

    const {
        SCOPES,
        TOKEN_PATH,
        CREDENTIALS_JSON,
        DIR,
        MIMETYPES,
        MAXFILESIZE
    } = this

    return new Promise(function(resolve, reject) {
        // Load client secrets from a local file.
        fs.readFile(CREDENTIALS_JSON, (err, content) => {
            if (err) return console.log('Error loading client secret file:', err)
            // Authorize a client with credentials, then call the Google Drive API.
            authorize(JSON.parse(content), init)
        })


        /**
         * Create an OAuth2 client with the given credentials, and then execute the
         * given callback function.
         * @param {Object} credentials The authorization client credentials.
         * @param {function} callback The callback to call with the authorized client.
         */
        function authorize(credentials, callback) {
            const { client_secret, client_id, redirect_uris } = credentials.installed
            const oAuth2Client = new google.auth.OAuth2(
                client_id, client_secret, redirect_uris[0])

            // Check if we have previously stored a token.
            fs.readFile(TOKEN_PATH, (err, token) => {
                if (err) return getAccessToken(oAuth2Client, callback)
                oAuth2Client.setCredentials(JSON.parse(token))
                callback(oAuth2Client)
            })
        }

        /**
         * Get and store new token after prompting for user authorization, and then
         * execute the given callback with the authorized OAuth2 client.
         * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
         * @param {getEventsCallback} callback The callback for the authorized client.
         */
        function getAccessToken(oAuth2Client, callback) {
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
            })
            console.log('Authorize this app by visiting this url:', authUrl)
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            })
            rl.question('Enter the code from that page here: ', (code) => {
                rl.close()
                oAuth2Client.getToken(code, (err, token) => {
                    if (err) return console.error('Error retrieving access token', err)
                    oAuth2Client.setCredentials(token)
                    // Store the token to disk for later program executions
                    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                        if (err) console.error(err)
                        console.log('Token stored to', TOKEN_PATH)
                    })
                    callback(oAuth2Client)
                })
            })
        }

        let _FILENAME, _EXT, _MIMETYPE, _FILEPATH, _EXPORTTYPE

        /**
         * Initialization.
         *
         * Preparing to download the file.
         * This requires data verification and determination of the downloading method.
         * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
         */
        async function init(auth) {
            try {
                const drive = google.drive({ version: 'v3', auth })
                const meta = await getMetaData(drive)
                validateSize(meta.size)
                const format = getFormat(meta.mimeType)
                const { ext, exportType } = format

                const fileId = meta.id
                const { filePath, fileName } = generateFileName(ext)

                let download = drive.files.get
                const params = {
                    fileId: fileId,
                    alt: 'media'
                }

                if (exportType) {
                    download = drive.files.export
                    params.mimeType = exportType
                }

                _FILENAME = fileName
                _FILEPATH = filePath
                _MIMETYPE = meta.mimeType
                _EXT = ext
                _EXPORTTYPE = exportType

                return download.call(drive, params, { responseType: 'stream' }, onEvent(filePath))

            } catch (e) {
                reject(e)
            }
        }

        /**
         * Check the file size
         *
         * Keep in mind that Google Drive doesn't return the file size for its own files
         * so you can check only the size of binary files
         *
         * @param {string} size The size of the file's content in bytes.
         */
        function validateSize(size) {
            if (size && size > MAXFILESIZE) {
                throw new Error(`A size of the file must be smaller than ${MAXFILESIZE} bytes. 
                Current size is: ${size} bytes`)
            }
        }

        /**
         * Request for the file metadata
         *
         * @param drive {GDrive}
         * @returns {Promise<any>}
         */
        function getMetaData(drive) {
            return new Promise(function(resolve, reject) {
                drive.files.get({
                    fileId: id,
                    fields: 'id,kind,size,name,mimeType'
                }, (err, res) => {
                    if (err) return reject(err)
                    return resolve(res.data)
                })
            })
        }

        /**
         * Recursive function to generate a unique file name
         *
         * @param {string} ext The file extension
         * @returns {string} filename The full filename including the path
         */
        function generateFileName(ext) {
            const fileName = crypto.randomBytes(20).toString('hex')
            const filePath = `${DIR}${fileName}.${ext}`

            try {
                fs.accessSync(filePath, fs.constants.F_OK)
                generateFileName(ext)
            } catch (e) {
                return { filePath, fileName }
            }
        }

        /**
         * Callback function that processes the file stream.
         *
         * @param {string} fileName The full filename
         * @returns {Boolean} true
         * @throws {Error} reject
         */
        function onEvent(fileName) {
            return (err, res) => {
                if (err) return reject(err)

                const dest = fs.createWriteStream(fileName, { flag: 'w' })
                res.data
                    .on('end', function() {
                        resolve({ _FILENAME, _EXT, _FILEPATH, _MIMETYPE, _EXPORTTYPE })
                    })
                    .on('error', function(err) {
                        reject(err)
                    })
                    .pipe(dest)
            }
        }

        /**
         * Check the file mimeType and return the corresponding object
         * containing the file extension and mimeType for export (if required)
         *
         * @param {string} mimeType The mimeType of the downloading file
         * @returns {{ext:string, exportType:string}}
         */
        function getFormat(mimeType) {
            try {
                const { ext, exportType } = MIMETYPES[mimeType]
                return { ext, exportType }
            } catch (e) {
                throw new Error('This type of files can\'t be uploaded')
            }
        }

    })
}

