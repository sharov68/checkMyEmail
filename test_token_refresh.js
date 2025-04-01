const fs = require("fs-extra");
const { google } = require("googleapis");

const TOKEN_PATH = "./token.json";
const _client_secret = require("./client_secret");

const { client_id, client_secret } = _client_secret.installed 
    ? _client_secret.installed 
    : _client_secret.web;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, "http://localhost");

// Функция загрузки токенов
function loadTokens() {
    if (!fs.existsSync(TOKEN_PATH)) {
        throw new Error("Файл token.json не найден. Авторизуйтесь заново.");
    }
    const tokens = fs.readJsonSync(TOKEN_PATH);
    oauth2Client.setCredentials(tokens);
    return tokens;
}

// Функция обновления access_token, если он устарел
async function refreshAccessTokenIfNeeded() {
    try {
        const tokens = loadTokens();
        
        if (!tokens.refresh_token) {
            throw new Error("Отсутствует refresh_token! Пройдите авторизацию заново.");
        }

        const newTokens = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(newTokens.credentials);
        
        // Сохраняем обновлённые токены
        fs.writeJsonSync(TOKEN_PATH, newTokens.credentials, { spaces: 2 });
        console.log("Токен обновлён и сохранён.");
    } catch (error) {
        console.error("Ошибка при обновлении токена:", error.message);
        process.exit(1);
    }
}

// Пример использования
(async () => {
    await refreshAccessTokenIfNeeded();

    // Теперь можно делать API-запросы
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const userInfo = await oauth2.userinfo.get();
    console.log("Пользователь:", userInfo.data.email);
})();
