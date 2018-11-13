const readline = require('readline');
const fs = require('fs');
const { google } = require('googleapis');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const CREDENTIALS_PATH = `../../credentials.json`
const TOKEN_PATH = `../../token.json`

rl.question('Please, put credentials.json in the root of your app and press enter: ', () => {
    try {
        fs.accessSync(CREDENTIALS_PATH, fs.constants.F_OK);
        rl.question('Enter the scopes: ', (scopes) => {
            const scopeArray = scopes.split(',').map(el => el.trim())
            auth(scopeArray)
        })
    } catch (e) {
        throw new Error(e)
    }
})

function auth(SCOPES) {
    fs.readFile(CREDENTIALS_PATH, (err, content) => {
        if (err) return console.log('Error loading client secret file:', err);
        // Authorize a client with credentials, then call the Google Drive API.
        authorize(JSON.parse(content));
    });


    /**
     * Create an OAuth2 client with the given credentials
     * @param {Object} credentials The authorization client credentials.
     */
    function authorize(credentials) {
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const oAuth2Client = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);
        return getAccessToken(oAuth2Client);
    }

    /**
     * Get and store new token after prompting for user authorization
     * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
     */
    function getAccessToken(oAuth2Client) {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });
        console.log('Authorize this app by visiting this url:', authUrl);
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) {
                    console.error('Error retrieving access token');
                    process.exit()
                }
                oAuth2Client.setCredentials(token);
                // Store the token to disk for later program executions
                fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                    if (err) console.error(err);
                    console.log('Token stored to', TOKEN_PATH);
                    console.log('Installation complete');
                    process.exit()
                });
            });
        });
    }
}