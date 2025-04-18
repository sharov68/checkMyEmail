/*global process */
const config = require('./config');
let localConfig = {};
try {
	localConfig = require('./local-config');
// eslint-disable-next-line no-unused-vars
} catch (error) { /**/ }
const _ = require('lodash');
const cfg = _.merge(config, localConfig);
const { MongoClient } = require('mongodb');
const MONGO_URI = `mongodb://${cfg.mongodb.host}:${cfg.mongodb.port}/${cfg.mongodb.db}`;
console.log(MONGO_URI);
const client = new MongoClient(MONGO_URI);
const _client_secret = require("./client_secret");
if (_.isEmpty(_client_secret)) {
    console.log("No credentials");
    process.exit(0);
}

const { client_id, client_secret } = _client_secret.installed ? _client_secret.installed : _client_secret.web;
const { google } = require("googleapis");
const open = require("open");
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'];
const express = require("express");
const app = express();
const port = 4000;
const local_ip = "localhost";
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, `http://${local_ip}:${port}/auth`);
let server, users;

app.get("/auth", async (req, res) => {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    res.send("Authentication successful! You can close this window.");
    console.log("Токен сохранён. Можно запускать скрипты.");
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    try {
        const userInfo = await oauth2.userinfo.v2.me.get();
        console.log("Получен токен для пользователя:", userInfo.data);
        await initMongoDB();
        const user = await users.findOne({ email:"userInfo.data.email" });
        userInfo.data.tokens = tokens;
        if (user) {
            await users.updateOne({ _id:user._id }, { $set:userInfo.data });
        } else {
            await users.insertOne(userInfo.data);
        }
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

async function initMongoDB() {
    await client.connect();
    const db = client.db(cfg.mongodb.db);
    users = db.collection("users");
}
