/**
 * ВНИМАНИЕ!
 * На данный момент это приложение может работать с одним пользователем.
 * Для нескольких пользователей нужно адаптировать.
 * Например, переменные bot, gamil должны быть индивидуально для каждого пользователя.
 */

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

const TelegramBot = require('node-telegram-bot-api');
const { google } = require("googleapis");
const MailComposer = require('nodemailer/lib/mail-composer');
const _client_secret = require("./client_secret");
const { client_id, client_secret } = _client_secret.installed ? _client_secret.installed : _client_secret.web;
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, "http://localhost");
let gmail, bot;
let _b_gmailCheckStart;

(async()=>{
	await initMongoDB();
	await initTelegram();
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

async function initTelegram() {
	if (config.telegram.apiKey) {
		const initAnswer = `Enter your email.`;
		bot = new TelegramBot(config.telegram.apiKey, { polling:true });
		bot.onText(/\/start/, async msg => {
			const chatId = msg.chat.id;
			console.log("\n");
			console.log(improveDate(new Date()), "Received /start.", "chat id:", chatId);
			console.log("\n");
			await bot.sendMessage(chatId, initAnswer);
		});
		bot.onText(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, async msg => {
			const chatId = msg.chat.id;
			console.log(improveDate(new Date()), "chat id:", chatId, msg.text);
			const user = await collections.users.findOne({ email:msg.text });
			if (user) {
				const code = generateCode();
				const text = `Код для привязки к телеграм: ${code}`;
				await sendEmailToSelf({ subject:"Привязка к телеграм", text, auth:oauth2Client, toEmail:user.email });
				await bot.sendMessage(chatId, "Проверь почту, туда должен прийти код, скинь его сюда.");
				await collections.users.updateOne({ _id:user._id }, { $set:{ code_for_telegram:code } });
			} else {
				await bot.sendMessage(chatId, "Your email is unknown!");
			}
		});
		bot.onText(/^CMG-\d{8}$/, async msg => {
			const chatId = msg.chat.id;
			console.log("\n");
			console.log(improveDate(new Date()), "Received code:", msg.text, "chat id:", chatId);
			console.log("\n");
			const user = await collections.users.findOne({ code_for_telegram:msg.text });
			if (user) {
				await collections.users.updateOne({ _id:user._id }, { $set:{ telegramId:chatId }, $unset:{ code_for_telegram:"" } });
				await bot.sendMessage(chatId, "Почта привязана.");
			} else {
				await bot.sendMessage(chatId, "Код неизвестен!");
			}
		});
	} else {
		console.log("Нет API key Телеграма!");
	}
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
	if (user.telegramId) {
		await bot.sendMessage(user.telegramId, snippet);
	} else {
		console.log(`У пользователя ${user._id} нет привязки к Телеграм!`);
	}
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

async function sendEmailToSelf({ toEmail, subject, text }) {
	const mail = new MailComposer({
		to: toEmail,
		from: toEmail,
		subject,
		text,
	}).compile();
	const encodedMessage = await new Promise((resolve, reject) => {
		mail.build((err, message) => {
			if (err) return reject(err);
			const encoded = message.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			resolve(encoded);
		});
	});
	await gmail.users.messages.send({
		userId: 'me',
		requestBody: {
			raw: encodedMessage,
		},
	});
}

function improveDate(date) {
	const str = date.toString();
	const arr = _.split(str, " GMT");
	return arr[0];
}

function generateCode() {
	const prefix = "CMG-";
	let digits = "";
	for (let i = 0; i < 8; i++) {
		digits += Math.floor(Math.random() * 10);
	}
	return prefix + digits;
}
