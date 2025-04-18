/**
 Принудительное обновление Гугл-токена при запуске сервиса:
 node app --force_token_refresh=true
 */

const argv = require('yargs').argv;
const config = require('./config');
let localConfig = {};
try {
	localConfig = require('./local-config');
// eslint-disable-next-line no-unused-vars
} catch (err) { /**/ }
const _ = require('lodash');
const cfg = _.merge(config, localConfig);
const { MongoClient } = require('mongodb');
const MONGO_URI = `mongodb://${cfg.mongodb.host}:${cfg.mongodb.port}/${cfg.mongodb.db}`;
console.log(MONGO_URI);
const client = new MongoClient(MONGO_URI);
let collections = {};

let force_token_refresh;
try {
	force_token_refresh = JSON.parse(argv.force_token_refresh);
// eslint-disable-next-line no-unused-vars
} catch (err) {
	force_token_refresh = false;
}

const { google } = require("googleapis");
const _client_secret = require("./client_secret");
const { client_id, client_secret } = _client_secret.installed ? _client_secret.installed : _client_secret.web;
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, "http://localhost");

(async()=>{
	await initMongoDB();
	const users = await collections.users.find().toArray();
	for (let i = 0; i < users.length; i++) {
		const user = users[i];
		if (user.tokens) {
			await ensureGoogleToken({ user });
			if (force_token_refresh) {
				await refreshGoogleToken({ user });
			} 
		} else {
			console.log(`У пользователя ${user._id} нет токенов!`);
		}
	}
})();

setInterval(() => {
// Можно сюда добавить какую-нибудь логику позже
}, 1000);

async function initMongoDB() {
	await client.connect();
	const db = client.db(cfg.mongodb.db);
	collections.users = db.collection("users");
}

async function refreshGoogleToken({ user }) {
	const newTokens = await oauth2Client.refreshAccessToken();
	oauth2Client.setCredentials(newTokens.credentials);
	await collections.users.updateOne({ _id:user._id }, { $set:{ tokens:newTokens.credentials } });
	console.log(`Гугл-токен пользователя ${user._id} обновился.`);
}

async function ensureGoogleToken({ user }) {
	oauth2Client.setCredentials(user.tokens);
	if ((new Date()).valueOf() >= (user.tokens.expiry_date - 10*60*1000)) {
		console.log(`Токен пользователя ${user._id} просроченный!`);
		await refreshGoogleToken({ user });
	} else {
		console.log(`Токен пользователя ${user._id} действующий.`);
	}
}
