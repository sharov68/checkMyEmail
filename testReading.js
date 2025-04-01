const _ = require("lodash");
const _client_secret = require("./client_secret");
if (_.isEmpty(_client_secret)) {
    console.log("No credentials");
    process.exit(0);
}
const { client_id, client_secret } = _client_secret.installed;
const fs = require("fs-extra");
const { google } = require("googleapis");
const TOKEN_PATH = "./token.json"
const port = 4000;
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, `http://localhost:${port}/auth`);

(async () => {
    try {
        authenticate();
        await listMessages(oauth2Client);
        process.exit(1);
    } catch (error) {
        console.log(error);
        process.exit(0);
    }
})();

function authenticate() {
    try {
        oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")));
    } catch (error) {
        console.log(error);
        process.exit(0);
    }
    return;
}

async function listMessages(auth) {
    const gmail = google.gmail({ version:'v1', auth });
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 1,
    });
    for (let i = 0; i < data.messages.length; i++) {
        const message = data.messages[i];
        await getMessage(auth, message.id);
    }
    //console.log("1111111", data.messages);
}

async function getMessage(auth, messageId) {
    console.log("11111111111111", messageId);
    
    const gmail = google.gmail({ version:'v1', auth });
    const { data } = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
    });
    //console.log("22222222", JSON.stringify(data, null, 2));
    console.log("22222222", data);
    
}
