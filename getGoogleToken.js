const os = require('os');
const _ = require("lodash");
const _client_secret = require("./client_secret");
if (_.isEmpty(_client_secret)) {
    console.log("No credentials");
    process.exit(0);
}

// property name inside of _client_secret dependence from app type in your Google development console.
// for example, type "Web Application" _client_secret.web
// In future need to collect all properties
const { client_id, client_secret } = _client_secret.installed ? _client_secret.installed : _client_secret.web;
const fs = require("fs-extra");
const { google } = require("googleapis");
const open = require("open");
const TOKEN_PATH = "./token.json"
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'];
const express = require("express");
const app = express();
const port = 4000;
const local_ip = "localhost";
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, `http://${local_ip}:${port}/auth`);
let server;

app.get("/auth", async (req, res) => {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    oauth2Client.setCredentials(tokens);
    res.send("Authentication successful! You can close this window.");
    console.log("Токен сохранён. Можно запускать скрипты.");
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    try {
        const userInfo = await oauth2.userinfo.v2.me.get();
        console.log("Получен токен для пользователя:", userInfo.data);
    } catch (error) {
        console.error("Ошибка при получении информации о пользователе:", error);
    }
    server.close();
    process.exit(1);
});

server = app.listen(port, () => {
    console.log(`Server is running on http://${local_ip}:${port}`);
    (async () => {
        try {
            const authUrl = oauth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
            console.log(`Перейди по ссылке для авторизации: ${authUrl}`);
            await open(authUrl);
        } catch (error) {
            console.log(error);
            process.exit(0);
        }
    })();
});
