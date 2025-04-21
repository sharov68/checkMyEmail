/**
 Принудительное обновление Гугл-токена при запуске сервиса:
 node app --force_token_refresh=true
 */

const { Buffer } = require('buffer');
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
let gmail;
let _b_gmailCheckStart;

(async()=>{
	await initMongoDB();
	await checkNewMessages();
})();

setInterval(async () => {
	if (!_b_gmailCheckStart) {
		await checkNewMessages();
	}
}, 5*60*1000);

async function checkNewMessages() {
	_b_gmailCheckStart = 1;
	const users = await collections.users.find().toArray();
	for (let i = 0; i < users.length; i++) {
		const user = users[i];
		if (user.tokens) {
			await ensureGoogleToken({ user });
			if (force_token_refresh) {
				await refreshGoogleToken({ user });
			}
			const lastGmailMessage = await getLastGmailMessage({ user });
			if (lastGmailMessage) {
				const newMessageIds = await getMessagesAfter({ lastMessage:lastGmailMessage });
				for (let j = 0; j < newMessageIds.length; j++) {
					const messageId = newMessageIds[j];
					await getMessage({ messageId, user });
				}
			} else {
				await getMessages({ user });
			}
		} else {
			console.log(`У пользователя ${user._id} нет токенов!`);
		}
	}
	_b_gmailCheckStart = 0;
}

async function initMongoDB() {
	await client.connect();
	const db = client.db(cfg.mongodb.db);
	collections.users = db.collection("users");
	collections.gmail = db.collection("gmail");
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
	gmail = google.gmail({ version:'v1', auth:oauth2Client });
}

async function getMessages({ user }) {
	const userId = 'me';
	let allMessages = [];
	let pageToken = null;
	do {
		const res = await gmail.users.messages.list({ userId, maxResults:10, pageToken });
		if (res.data.messages) {
			allMessages = allMessages.concat(res.data.messages);
		}
		pageToken = res.data.nextPageToken;
	} while (pageToken);
	allMessages = allMessages.reverse();
	for (let i = 0; i < allMessages.length; i++) {
		const message = allMessages[i];
		await getMessage({ messageId:message.id, user });
	}
}

async function getMessage({ messageId, user }) {
	const { data } = await gmail.users.messages.get({ userId:'me', id:messageId });
	let messageText;
	if (data.payload.body && data.payload.body.data) {
		messageText = decodeBase64Url(data.payload.body.data);
	} else if (data.payload.parts) {
		messageText = findPlainTextPart(data.payload.parts);
	}
	const { id, threadId, snippet, historyId } = data;
	const gmailData = { id, threadId, snippet, historyId, messageText, _iduser:user._id };
	await collections.gmail.insertOne(gmailData);
	console.log("\n");
	console.log(id, data.snippet);
	console.log("\n");
}

function decodeBase64Url(data) {
	const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
	return Buffer.from(base64, 'base64').toString('utf-8');
}

function findPlainTextPart(parts) {
	for (const part of parts) {
		if (part.mimeType === 'text/plain' && part.body?.data) {
			return decodeBase64Url(part.body.data);
		}
		if (part.parts) {
			const nested = findPlainTextPart(part.parts);
			if (nested) {
				return nested;
			}
		}
	}
	return null;
}

async function getLastGmailMessage({ user }) {
	const lastMessage = await collections.gmail.findOne({ _iduser:user._id }, { sort:{ _id:-1 } });
	return lastMessage;
}

async function getMessagesAfter({ lastMessage }) {
	const startHistoryId = lastMessage.historyId;
	const { data: historyData } = await gmail.users.history.list({
		userId: 'me',
		startHistoryId,
		historyTypes: ['messageAdded'],
	});
	const newMessageIds = [];
	if (historyData.history) {
		for (const h of historyData.history) {
			for (const m of h.messages || []) {
				newMessageIds.push(m.id);
			}
		}
	}
	console.log("\n");
	console.log("Новые письма:", newMessageIds);
	console.log("\n");
	return newMessageIds;
}
