let client_secret = require("./client_secret.json");
let local_client_secret = {};
const fs = require('fs');
const _ = require("lodash");
const dir = './';
const fileNamePattern = /^client_secret_\d+-[a-z0-9]+\.apps.googleusercontent.com.json$/;
const files = fs.readdirSync(dir);
const file = files.find(f => fileNamePattern.test(f));
if (file) {
    try {
        local_client_secret = require(`${dir}${file}`);
    } catch (error) {}
}
client_secret = _.merge(client_secret, local_client_secret);

module.exports = client_secret;
