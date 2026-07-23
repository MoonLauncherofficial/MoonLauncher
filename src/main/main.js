const { app, BrowserWindow, ipcMain, shell, dialog, Notification, Tray, Menu, safeStorage } = require('electron');

// Лаунчер сворачивается в трей при закрытии окна (настройка minimizeToTray),
// то есть процесс продолжает жить в фоне. Без блокировки повторного запуска
// каждый следующий `npm start` / запуск .exe поднимал ВТОРОЙ процесс Electron
// поверх первого — оба тянут один и тот же userData/кэш каталог, отсюда
// "Unable to move the cache" / "Gpu Cache Creation failed" в консоли и
// прогрессирующие лаги интерфейса (несколько живых процессов лаунчера разом
// грузят CPU/GPU), которые никак не лечились правками рендера в renderer'е.
// Теперь второй запуск просто поднимает и фокусирует уже открытое окно первого.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
    process.exit(0);
}
const path = require('path');

/**
 * SECURITY: имя файла для мода/шейдера/ресурс-пака (`filename`) в ряде мест
 * приходит либо с публичного Modrinth API (`primaryFile.filename`,
 * `mod.filename`), либо от самого рендерера через IPC (uninstall, чтение
 * логов/краш-репортов). Раньше оно подставлялось в `path.join(dir, filename)`
 * без проверки — имя вида "../../../AppData/.../Startup/evil.exe" могло бы
 * записать/прочитать/удалить файл за пределами предназначенной папки.
 * safeJoin() гарантирует, что итоговый путь остаётся внутри baseDir.
 */
function safeJoin(baseDir, ...segments) {
    const base = path.resolve(baseDir);
    const target = path.resolve(base, ...segments);
    if (target !== base && !target.startsWith(base + path.sep)) {
        throw new Error('Недопустимое имя файла (выход за пределы разрешённой папки)');
    }
    return target;
}
const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const { spawn, execSync } = require('child_process');
const axios = require('axios');
const AdmZip = require('adm-zip');
const zlib = require('zlib');
const crypto = require('crypto');
const { Transform } = require('stream');
const { getJavaFor, requiredJavaMajor, ensureJava } = require('./javaManager');

const CLIENT_ID = '9726e868-db01-4a87-874c-b43756978671';
const REDIRECT_URI = 'http://localhost:3000/auth/callback';
// server.js теперь сам поднимает https.createServer на 443 с валидным сертификатом
// из ssl/ (раньше там был только http.createServer, поэтому https:// ни на что не
// отвечал — отсюда и таймауты). Ходим на https и напрямую, без http→https редиректа,
// поэтому POST (в т.ч. modpacks/share) больше не превращается в GET по пути.
const MOONLAUNCHER_API = 'https://moonlauncher.ru/api';
// Сайт (не /api) — оттуда раздаются файлы фирменных модов (см. FEATURED_MODS_METADATA_URL ниже).
const MOONLAUNCHER_SITE = 'https://moonlauncher.ru';
// Фирменные моды (MaxFPS и т.д.) раздаются напрямую с сайта, а не с Modrinth — у них нет
// Modrinth versionId/projectId, поэтому обычный download-modrinth им не подходит.
// Используем тот же api/mods/list.json, который отдаёт и сайт (js/site.js), чтобы список
// не приходилось поддерживать в двух местах.
const FEATURED_MODS_METADATA_URL = `${MOONLAUNCHER_API}/mods/list.json`;

const LAUNCHER_ROOT = path.join(os.homedir(), '.moonlauncher');
const AUTH_FILE = path.join(LAUNCHER_ROOT, 'auth.json');

/**
 * SECURITY: auth.json хранит refreshToken MS-аккаунта — это долгоживущий
 * токен (scope offline_access), раньше писался обычным JSON открытым
 * текстом. Любой локальный malware/пользователь с доступом к файловой
 * системе мог его прочитать и залогиниться под чужим аккаунтом без пароля.
 * Теперь шифруем через Electron safeStorage (DPAPI на Windows, Keychain на
 * macOS, libsecret/kwallet на Linux). Если шифрование недоступно в системе —
 * откатываемся на plaintext, чтобы вход не сломался совсем, но это крайний
 * случай (актуально в основном для part Linux-окружений без desktop keyring).
 */
function writeAuthFile(authData) {
    const json = JSON.stringify(authData, null, 2);
    if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(AUTH_FILE, safeStorage.encryptString(json));
    } else {
        fs.writeFileSync(AUTH_FILE, json);
    }
}

function readAuthFile() {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = fs.readFileSync(AUTH_FILE);
    // Уже установленные версии лаунчера писали обычный JSON текстом — пробуем
    // сначала так, чтобы не терять сохранённый вход у существующих
    // пользователей при обновлении. Файл будет незаметно переупакован в
    // зашифрованный вид при следующей записи (refresh/повторный логин).
    try {
        return JSON.parse(raw.toString('utf8'));
    } catch (e) {
        if (!safeStorage.isEncryptionAvailable()) return null;
        try {
            return JSON.parse(safeStorage.decryptString(raw));
        } catch (e2) {
            return null;
        }
    }
}
const MINECRAFT_DIR = path.join(LAUNCHER_ROOT, 'minecraft');
const PROFILES_DIR = path.join(LAUNCHER_ROOT, 'profiles');
const MODS_DIR = path.join(MINECRAFT_DIR, 'mods');
const SHADERS_DIR = path.join(MINECRAFT_DIR, 'shaderpacks');
const RESOURCEPACKS_DIR = path.join(MINECRAFT_DIR, 'resourcepacks');
const LIBRARIES_DIR = path.join(MINECRAFT_DIR, 'libraries');
const ASSETS_DIR = path.join(MINECRAFT_DIR, 'assets');
const VERSIONS_DIR = path.join(MINECRAFT_DIR, 'versions');
const NATIVES_DIR = path.join(MINECRAFT_DIR, 'natives');
const LOGS_DIR = path.join(LAUNCHER_ROOT, 'logs');
const UPDATES_DIR = path.join(LAUNCHER_ROOT, 'updates');
const SETTINGS_FILE = path.join(LAUNCHER_ROOT, 'settings.json');
const MODPACK_MANIFEST_FILE = path.join(LAUNCHER_ROOT, 'modpack-manifest.json');
const JAVA_DIR = path.join(LAUNCHER_ROOT, 'java');
const UPDATE_BASE_URL = `${MOONLAUNCHER_API}/launcher-update`;

const GITHUB_REPO = 'https://github.com/MoonLauncherofficial/MoonLauncher';
const DISCORD_INVITE = 'https://discord.gg/pqtJZ5GFkk';

function applyDownloadMirror(url, mirror) {
    if (!url || !mirror || mirror === 'official') return url;
    if (mirror === 'bmclapi') {
        return url
            .replace('https://launchermeta.mojang.com/mc/game/', 'https://bmclapi2.bangbang93.com/mc/game/')
            .replace('https://piston-meta.mojang.com', 'https://bmclapi2.bangbang93.com')
            .replace('https://launcher.mojang.com', 'https://bmclapi2.bangbang93.com')
            .replace('https://libraries.minecraft.net', 'https://bmclapi2.bangbang93.com/maven')
            .replace('https://resources.download.minecraft.net', 'https://bmclapi2.bangbang93.com/assets');
    }
    if (mirror === 'mcbbs') {
        return url
            .replace('https://launchermeta.mojang.com/mc/game/', 'https://download.mcbbs.net/mc/game/')
            .replace('https://piston-meta.mojang.com', 'https://download.mcbbs.net')
            .replace('https://launcher.mojang.com', 'https://download.mcbbs.net')
            .replace('https://libraries.minecraft.net', 'https://download.mcbbs.net/maven')
            .replace('https://resources.download.minecraft.net', 'https://download.mcbbs.net/assets');
    }
    return url;
}

function versionMatchesProfile(versionData, profile, itemType = 'mod') {
    const mcVersion = profile?.versionId;
    if (mcVersion && versionData.game_versions && !versionData.game_versions.includes(mcVersion)) {
        return false;
    }
    const loader = profile?.loader || 'vanilla';
    if (itemType === 'mod' && loader !== 'vanilla') {
        const loaders = versionData.loaders;
        if (!Array.isArray(loaders)) return false;
        if (loaders.includes(loader)) return true;
        if (loader === 'quilt' && loaders.includes('fabric')) return true;
        return false;
    }
    return true;
}

function findCompatibleModrinthVersion(versions, profile, itemType = 'mod') {
    if (!Array.isArray(versions) || !versions.length) return null;
    return versions.find(v => versionMatchesProfile(v, profile, itemType)) || null;
}

function getOrCreateSessionId() {
    const sessionFile = path.join(LAUNCHER_ROOT, 'session.id');
    try {
        if (fs.existsSync(sessionFile)) {
            return fs.readFileSync(sessionFile, 'utf8').trim();
        }
        const id = crypto.randomUUID();
        fs.writeFileSync(sessionFile, id);
        return id;
    } catch {
        return crypto.randomUUID();
    }
}

// Реальный онлайн-счётчик ЛАУНЧЕРА (а не посетителей сайта).
// Раньше здесь дёргался api/online/count.php — он считает уникальные IP,
// зашедшие на сайт moonlauncher.ru, и не имеет отношения к тому, сколько
// людей реально сидит в лаунчере. Теперь используется отдельный серверный
// эндпоинт api/launcher-online/heartbeat.php:
//   - POST { clientId } раз в HEARTBEAT_INTERVAL_MS шлёт "я жив" (см. ниже);
//   - GET просто читает текущее число, ничего не регистрируя.
// clientId — это getOrCreateSessionId(), тот же постоянный ID лаунчера,
// который уже хранится в session.id, отдельный ID заводить не нужно.
async function fetchOnlineCount() {
    const response = await axios.get(`${MOONLAUNCHER_API}/launcher-online/heartbeat.php`, { timeout: 5000 });
    if (response.data && response.data.offline === true) {
        throw new Error('Server reports offline');
    }
    if (response.data && typeof response.data.count === 'number') {
        return response.data.count;
    }
    throw new Error('Bad online count response');
}

const HEARTBEAT_INTERVAL_MS = 60_000; // должно быть меньше окна на сервере (150с)
let heartbeatTimer = null;

async function sendOnlineHeartbeat() {
    try {
        await axios.post(
            `${MOONLAUNCHER_API}/launcher-online/heartbeat.php`,
            { clientId: getOrCreateSessionId() },
            { timeout: 5000 }
        );
    } catch (e) {
        // Нет сети / сайт недоступен — не критично, пропустим один пинг.
    }
}

function startOnlineHeartbeat() {
    if (heartbeatTimer) return; // уже запущено
    sendOnlineHeartbeat();
    heartbeatTimer = setInterval(sendOnlineHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function stopOnlineHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

const PERFORMANCE_PRESET_ARGS = {
    balanced: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
    maxFps: '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M -XX:+DisableExplicitGC',
    quality: '-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:MaxGCPauseMillis=150'
};

// РАНЬШЕ здесь были три "оптимизации" в виде JVM-флагов, которые НИЧЕГО не давали
// в реальной игре и были фактически плацебо:
//  - chunkLoading использовал -Dfml.ignoreInvalidMinecraftCertificates — это флаг
//    старого Forge/FML про проверку сертификатов, к скорости загрузки чанков
//    отношения не имеет;
//  - entityCulling использовал -XX:+AggressiveOpts — этот флаг убран из JVM ещё
//    в Java 9+ и современная Java (17/21, на которой запускается всё, что новее
//    1.17) его просто игнорирует;
//  - vbo использовал -Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL — свойство
//    LWJGL2, а весь современный Minecraft (1.13+) рендерится на LWJGL3, где этого
//    класса вообще нет.
// Реальный прирост FPS на слабом/старом CPU (i5-2500, GTX 1050 Ti и т.п.) даёт не
// подбор магических JVM-флагов, а настройки видео самого Minecraft — они и
// применяются теперь через options.txt в applyGamePerformanceOptions() ниже:
// fast graphics, отключенные тени сущностей, минимум частиц, mipmap 0, без
// облаков, отключенный VSync (чтобы FPS не был искусственно ограничен).
const PERFORMANCE_VIDEO_PRESETS = {
    maxFps: {
        graphicsMode: 0, fancyGraphics: 'false', renderClouds: 'false',
        ao: 0, entityShadows: 'false', particles: 2,
        mipmapLevels: 0, biomeBlendRadius: 0, vsync: 'false',
        fboEnable: 'true', useVbo: 'true'
    },
    balanced: {
        graphicsMode: 0, fancyGraphics: 'false', renderClouds: 'fast',
        ao: 1, entityShadows: 'false', particles: 1,
        mipmapLevels: 2, biomeBlendRadius: 2, vsync: 'false',
        fboEnable: 'true', useVbo: 'true'
    },
    quality: {
        graphicsMode: 2, fancyGraphics: 'true', renderClouds: 'true',
        ao: 2, entityShadows: 'true', particles: 0,
        mipmapLevels: 4, biomeBlendRadius: 5, vsync: 'true',
        fboEnable: 'true', useVbo: 'true'
    }
};

// Три переключателя "Оптимизации игры" в настройках накладываются ПОВЕРХ
// выбранного пресета (balanced/maxFps/quality) и тоже пишут реальные ключи
// options.txt, а не JVM-флаги.
function buildPerformanceVideoOptions(settings) {
    const preset = settings.performancePreset || 'balanced';
    const kv = { ...(PERFORMANCE_VIDEO_PRESETS[preset] || PERFORMANCE_VIDEO_PRESETS.balanced) };
    if (settings.optChunkLoading !== false) {
        kv.graphicsMode = 0; kv.fancyGraphics = 'false'; kv.mipmapLevels = 0; kv.renderClouds = 'false';
    }
    if (settings.optEntityCulling) {
        kv.entityShadows = 'false'; kv.particles = 2;
    }
    if (settings.optVbo !== false) {
        kv.vsync = 'false';
    }
    return kv;
}

let gameSessionStart = null;
let pendingQuickConnect = null;

[LAUNCHER_ROOT, MINECRAFT_DIR, PROFILES_DIR, MODS_DIR, SHADERS_DIR,
 RESOURCEPACKS_DIR, LIBRARIES_DIR, ASSETS_DIR, VERSIONS_DIR, NATIVES_DIR, LOGS_DIR, JAVA_DIR, UPDATES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let mainWindow;
let tray = null;
let isQuiting = false;
let currentLang = 'ru';

// ==================== PATH HELPERS ====================
function getAssetPath(...parts) {
    const candidates = [
        path.join(__dirname, '../../', ...parts),
        path.join(__dirname, '../', ...parts),
        path.join(app.getAppPath(), ...parts),
        path.join(process.cwd(), ...parts)
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return candidates[0]; // Return first even if not exists, for error reporting
}

function safeRequire(modulePath) {
    try {
        return require(modulePath);
    } catch (e) {
        return null;
    }
}

function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(Number);
    const pb = String(b).replace(/^v/, '').split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

// ==================== WINDOW & TRAY ====================
function getWindowIcon() {
    const candidates = [
        getAssetPath('assets', 'icon.png'),
        getAssetPath('assets', 'icon.ico'),
        getAssetPath('build', 'icon.png')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function createWindow() {
    const settings = loadSettingsSync();
    const windowIcon = getWindowIcon();
    
    const windowOptions = {
        width: 1360, height: 860, minWidth: 1100, minHeight: 700,
        frame: false, transparent: true, backgroundColor: '#00000000',
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false, 
            webSecurity: false 
        },
        show: false
    };

    if (windowIcon && fs.existsSync(windowIcon)) {
        windowOptions.icon = windowIcon;
    }

    mainWindow = new BrowserWindow(windowOptions);

    // Load from correct path
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    if (!fs.existsSync(htmlPath)) {
        console.error('HTML not found at:', htmlPath);
        // Try alternative
        const altHtml = path.join(app.getAppPath(), 'src/renderer/index.html');
        mainWindow.loadFile(fs.existsSync(altHtml) ? altHtml : htmlPath);
    } else {
        mainWindow.loadFile(htmlPath);
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.webContents.send('launcher-paths', {
            root: LAUNCHER_ROOT, minecraft: MINECRAFT_DIR,
            mods: MODS_DIR, shaders: SHADERS_DIR, resourcepacks: RESOURCEPACKS_DIR
        });
    });

    mainWindow.on('close', (event) => {
        const settings = loadSettingsSync();
        if (settings.minimizeToTray !== false && !isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
    if (tray) return;

    const iconPath = getWindowIcon();
    if (!iconPath || !fs.existsSync(iconPath)) {
        console.warn('Tray icon not found, skipping tray');
        return;
    }

    try {
        tray = new Tray(iconPath);

        const contextMenu = Menu.buildFromTemplate([
            { label: 'MoonLauncher', enabled: false },
            { type: 'separator' },
            { label: 'Открыть', click: () => { if (mainWindow) mainWindow.show(); } },
            { label: 'Играть', click: () => { if (mainWindow) mainWindow.webContents.send('tray-play'); } },
            { type: 'separator' },
            { label: 'Выход', click: () => { isQuiting = true; app.quit(); } }
        ]);

        tray.setToolTip('MoonLauncher');
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) mainWindow.hide();
                else mainWindow.show();
            }
        });
    } catch (error) {
        console.error('Tray error:', error.message);
        tray = null;
    }
}

app.on('second-instance', () => {
    // Пользователь запустил лаунчер ещё раз, пока старый висит в трее —
    // вместо второго процесса просто показываем и фокусируем текущее окно.
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    }
});

app.whenReady().then(() => {
    createWindow();
    createTray();

    const settings = loadSettingsSync();
    if (settings.autoStart) {
        app.setLoginItemSettings({ openAtLogin: true });
    }

    // Лаунчер сворачивается в трей и живёт как процесс дольше, чем открыто окно,
    // поэтому heartbeat стартует здесь (а не при открытии окна) и живёт до
    // фактического выхода из приложения — см. before-quit ниже.
    startOnlineHeartbeat();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { stopOnlineHeartbeat(); });

// ==================== SETTINGS ====================
function loadSettingsSync() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            if (data.language) currentLang = data.language;
            return { ...getDefaultSettings(), ...data };
        }
    } catch (e) {
        console.error('Settings load error:', e);
    }
    return getDefaultSettings();
}

function getDefaultSettings() {
    return {
        language: 'ru',
        autoStart: false,
        minimizeToTray: true,
        minimizeOnLaunch: true,
        useSystemJava: true,
        customJavaPath: '',
        javaArgs: '-Xmx2G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
        autoMemory: true,
        memory: 2048,
        gameResolution: 'auto',
        fullscreen: false,
        gameDir: MINECRAFT_DIR,
        theme: 'dark',
        transparency: 80,
        animations: true,
        blurEffects: true,
        updateChannel: 'stable',
        downloadMirror: 'official',
        speedLimit: 0,
        saveLogs: true,
        debugMode: false,
        performancePreset: 'balanced',
        optChunkLoading: true,
        optEntityCulling: false,
        optVbo: true,
        homeBackground: '',
        homeBackgroundDim: 45
    };
}

function buildPerformanceJvmArgs(settings) {
    const preset = settings.performancePreset || 'balanced';
    return PERFORMANCE_PRESET_ARGS[preset] || PERFORMANCE_PRESET_ARGS.balanced;
}

function updateProfileLaunchStats(profileId, sessionSeconds = 0) {
    try {
        const profilesFile = path.join(PROFILES_DIR, 'profiles.json');
        if (!fs.existsSync(profilesFile)) return;
        const profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return;
        profile.lastPlayed = Date.now();
        profile.launchCount = (profile.launchCount || 0) + 1;
        if (sessionSeconds > 0) {
            profile.totalPlayTime = (profile.totalPlayTime || 0) + sessionSeconds;
        }
        fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
    } catch (e) {
        console.warn('Profile stats update failed:', e.message);
    }
}

ipcMain.handle('get-settings', async () => {
    return { success: true, settings: loadSettingsSync() };
});

// ==================== HOME BACKGROUND ====================
// Файл фона копируем в LAUNCHER_ROOT (а не храним ссылку на исходный путь),
// чтобы фон не потерялся, если пользователь удалит/переместит оригинал,
// и чтобы при выборе нового фона не копились старые файлы с другим расширением.
const HOME_BG_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function clearHomeBackgroundFiles() {
    for (const ext of HOME_BG_EXTENSIONS) {
        const p = path.join(LAUNCHER_ROOT, `home-background${ext}`);
        if (fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
        }
    }
}

ipcMain.handle('choose-home-background', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        });
        if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };

        const src = result.filePaths[0];
        let ext = path.extname(src).toLowerCase();
        if (!HOME_BG_EXTENSIONS.includes(ext)) ext = '.png';
        const dest = path.join(LAUNCHER_ROOT, `home-background${ext}`);

        clearHomeBackgroundFiles();
        fs.copyFileSync(src, dest);

        const settings = loadSettingsSync();
        settings.homeBackground = dest;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

        return { success: true, path: dest };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-home-background', async () => {
    try {
        clearHomeBackgroundFiles();
        const settings = loadSettingsSync();
        settings.homeBackground = '';
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-settings', async (event, settings) => {
    try {
        const current = loadSettingsSync();
        const merged = { ...current, ...settings };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
        if (merged.language) currentLang = merged.language;

        app.setLoginItemSettings({ openAtLogin: merged.autoStart || false });

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== ONLINE COUNTER ====================
// Возвращает число реально запущенных копий лаунчера (heartbeat.php), а не
// посетителей сайта. Раньше тут был хардкод "count: 1" при любой ошибке —
// это и есть та самая имитация, которую нужно было убрать: теперь при недоступности
// сервера честно возвращаем success:false, а не рисуем произвольную цифру.
ipcMain.handle('get-online-count', async () => {
    try {
        const count = await fetchOnlineCount();
        return { success: true, count, source: 'api' };
    } catch (e) {}

    // Резерв: реальный суммарный онлайн по списку серверов (настоящий пинг, не выдумка).
    try {
        const serversResp = await axios.get(`${MOONLAUNCHER_API}/servers/list.json`, { timeout: 5000 });
        const list = Array.isArray(serversResp.data) ? serversResp.data : (serversResp.data?.servers || []);
        const { ping } = require('@minescope/mineping');
        let total = 0;
        let anySucceeded = false;
        for (const server of list.slice(0, 12)) {
            try {
                const result = await ping(server.ip, server.port || 25565, { timeout: 4000 });
                total += result.players?.online || 0;
                anySucceeded = true;
            } catch (err) {}
        }
        if (anySucceeded) {
            return { success: true, count: total, source: 'servers' };
        }
    } catch (e) {}

    return { success: false, count: null, source: 'offline' };
});

// ==================== PROFILE PATHS ====================
function getProfileGameDir(profile) {
    if (!profile) {
        const settings = loadSettingsSync();
        return settings.gameDir || MINECRAFT_DIR;
    }
    if (profile.gameDir) return profile.gameDir;
    if (profile.id && profile.id !== 'default') {
        return path.join(PROFILES_DIR, profile.id, 'minecraft');
    }
    const settings = loadSettingsSync();
    return settings.gameDir || MINECRAFT_DIR;
}

function getProfileContentDirs(profile) {
    const gameDir = getProfileGameDir(profile);
    return {
        gameDir,
        mods: path.join(gameDir, 'mods'),
        shaders: path.join(gameDir, 'shaderpacks'),
        resourcepacks: path.join(gameDir, 'resourcepacks')
    };
}

function ensureProfileGameDirs(profile) {
    const dirs = getProfileContentDirs(profile);
    for (const dir of [dirs.gameDir, dirs.mods, dirs.shaders, dirs.resourcepacks]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    return dirs;
}

// Асинхронный аналог ensureProfileGameDirs/loadModpackManifest/readActiveResourcePacks.
// Раньше переключение профиля (selectProfile в renderer) дёргало get-installed-items
// три раза подряд (mods/shaders/resourcepacks) + get-active-resourcepacks, и КАЖДЫЙ
// из этих вызовов внутри себя синхронно делал fs.existsSync/mkdirSync (ensureProfileGameDirs)
// и fs.readFileSync (loadModpackManifest) — итого больше десятка синхронных операций
// с диском подряд в главном процессе Electron. Даже если каждая по отдельности быстрая,
// синхронный fs блокирует ВЕСЬ event loop главного процесса, а значит и отрисовку окна —
// именно поэтому подтормаживало не только список модов, а вообще всё окно лаунчера
// (и на Главной, и на Инстансах — обе страницы вызывают один и тот же selectProfile).
// mkdir с recursive:true идемпотентен и не бросает ошибку, если папка уже есть —
// поэтому здесь не нужен предварительный existsSync-чек.
async function ensureProfileGameDirsAsync(profile) {
    const dirs = getProfileContentDirs(profile);
    await Promise.all(
        [dirs.gameDir, dirs.mods, dirs.shaders, dirs.resourcepacks].map((dir) =>
            fsPromises.mkdir(dir, { recursive: true })
        )
    );
    return dirs;
}

async function loadModpackManifestAsync(profile) {
    const paths = [getProfileModpackManifestPath(profile), MODPACK_MANIFEST_FILE];
    for (const manifestPath of paths) {
        try {
            const raw = await fsPromises.readFile(manifestPath, 'utf8');
            return JSON.parse(raw);
        } catch (e) {
            // Нет файла по этому пути (или он битый) — пробуем следующий /
            // отдаём пустой манифест, как и раньше делал синхронный вариант.
        }
    }
    return { mods: {}, shaders: {}, resourcepacks: {} };
}

async function readActiveResourcePacksAsync(gameDir) {
    const optionsPath = getOptionsPath(gameDir);
    let content;
    try {
        content = await fsPromises.readFile(optionsPath, 'utf8');
    } catch (e) {
        return [];
    }
    const line = content.split('\n').find((l) => l.startsWith('resourcePacks:'));
    if (!line) return [];
    try {
        const packs = JSON.parse(line.slice('resourcePacks:'.length));
        return packs.filter((p) => typeof p === 'string' && p.startsWith('file/'))
            .map((p) => decodeURIComponent(p.replace('file/', '')));
    } catch (e) {
        return [];
    }
}

function getProfileModpackManifestPath(profile) {
    return path.join(getProfileGameDir(profile), '.moonlauncher-modpack.json');
}

function migrateProfilesGameDirs(profiles) {
    let changed = false;
    for (const profile of profiles) {
        if (profile.id === 'default') continue;
        const sharedRoot = profile.gameDir === MINECRAFT_DIR || !profile.gameDir;
        if (sharedRoot) {
            profile.gameDir = path.join(PROFILES_DIR, profile.id, 'minecraft');
            ensureProfileGameDirs(profile);
            changed = true;
        }
    }
    return changed;
}

// ==================== MODPACK MANIFEST ====================
function loadModpackManifest(profile) {
    const paths = [
        getProfileModpackManifestPath(profile),
        MODPACK_MANIFEST_FILE
    ];
    for (const manifestPath of paths) {
        try {
            if (fs.existsSync(manifestPath)) {
                return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            }
        } catch (e) {
            console.error('Modpack manifest load error:', e.message);
        }
    }
    return { mods: {}, shaders: {}, resourcepacks: {} };
}

function saveModpackManifest(profile, manifest) {
    const manifestPath = getProfileModpackManifestPath(profile);
    if (!fs.existsSync(path.dirname(manifestPath))) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function addToModpackManifest(profile, type, filename, meta) {
    const manifest = loadModpackManifest(profile);
    const key = type === 'mod' ? 'mods' : type === 'shader' ? 'shaders' : 'resourcepacks';
    manifest[key][filename] = { ...meta, installedAt: Date.now() };
    saveModpackManifest(profile, manifest);
}

function encodeModpackLocal(pack) {
    const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(pack), 'utf8'));
    return 'ML1.' + compressed.toString('base64url');
}

function decodeModpackLocal(code) {
    const trimmed = code.trim();
    if (!trimmed.startsWith('ML1.')) {
        throw new Error('Неверный локальный код сборки');
    }
    const payload = trimmed.slice(4);
    const json = zlib.inflateSync(Buffer.from(payload, 'base64url')).toString('utf8');
    return JSON.parse(json);
}

function normalizeModpackCode(code) {
    return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function isLocalModpackCode(code) {
    return code.trim().toUpperCase().startsWith('ML1.');
}

async function fetchModpackFromServer(code) {
    const normalized = normalizeModpackCode(code).replace(/^MOON-/, '');
    try {
        const response = await axios.get(`${MOONLAUNCHER_API}/modpacks/get.php`, {
            params: { code: normalized },
            timeout: 15000
        });
        if (response.data?.pack) return response.data.pack;
        if (response.data?.mods) return response.data;
    } catch (e) { /* falls through to null below */ }
    return null;
}

async function uploadModpackToServer(pack) {
    // ВАЖНО: у остальных ручек этого раздела API есть суффикс .php
    // (см. /modpacks/get.php), а у этой изначально его не было —
    // из-за этого POST почти наверняка улетал в 404 и код всегда
    // тихо падал в локальный оффлайн-вариант (ML1....). Пробуем сначала
    // "правильный" путь с .php, а старый — как fallback, на случай если
    // на сервере всё-таки настроен алиас без расширения.
    const candidates = [
        `${MOONLAUNCHER_API}/modpacks/share.php`,
        `${MOONLAUNCHER_API}/modpacks/share`
    ];

    let lastError = null;
    for (const url of candidates) {
        try {
            const response = await axios.post(url, { pack }, { timeout: 15000 });
            if (response.data?.code) {
                return { code: response.data.code, source: 'server' };
            }
            lastError = new Error(`Сервер ответил без поля code (${url}): ${JSON.stringify(response.data)}`);
        } catch (e) {
            lastError = e;
        }
    }

    // Сервер недоступен/сломан — не страшно: локальный ML1-код работает
    // полностью офлайн и его так же можно передать другу текстом, просто
    // он длиннее и не хранится на сайте. На FPS/фризы в игре это никак не
    // влияет — это чисто про способ передачи списка модов.
    console.warn('Modpack upload failed, using local ML1 code instead:',
        lastError ? (lastError.response?.status || lastError.message) : 'unknown error');
    return { code: encodeModpackLocal(pack), source: 'local', serverError: lastError?.message || null };
}

async function resolveModpackFromCode(code) {
    const trimmed = code.trim();
    if (isLocalModpackCode(trimmed)) {
        return { pack: decodeModpackLocal(trimmed), source: 'local' };
    }
    const serverPack = await fetchModpackFromServer(trimmed);
    if (serverPack) {
        return { pack: serverPack, source: 'server' };
    }
    throw new Error('Код сборки не найден. Проверьте код или подключение к интернету.');
}

function sendModpackProgress(data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('modpack-import-progress', data);
    }
}

function resolveUpdateDownloadUrl(url) {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return `https://moonlauncher.ru${url}`;
    return `${UPDATE_BASE_URL}/${url.replace(/^\//, '')}`;
}

function normalizeUpdateManifest(data) {
    const changelog = data.changelog;
    const changelogText = Array.isArray(changelog)
        ? changelog.join('\n')
        : (changelog || data.description || '');
    const downloadUrl = resolveUpdateDownloadUrl(data.downloadUrl || data.download_url);
    const fileName = data.fileName || data.file_name
        || (downloadUrl ? path.basename(downloadUrl.split('?')[0]) : 'MoonLauncher-Setup.exe');

    return {
        latestVersion: data.version || data.latestVersion,
        changelog: changelogText,
        downloadUrl,
        fileName,
        mandatory: !!data.mandatory,
        releaseDate: data.date || data.releaseDate || '',
        fileSize: data.fileSize || data.file_size || 0,
        // SECURITY: если сайт публикует sha256 инсталлятора в манифесте — сверяем
        // его после скачивания перед автозапуском (см. download-launcher-update).
        // Пока сайт этого поля не отдаёт, проверка просто пропускается ниже.
        sha256: (data.sha256 || data.checksum || data.hash || '').toString().trim().toLowerCase()
    };
}

function sendUpdateDownloadProgress(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', payload);
    }
}

// ==================== UPDATE CHECKER ====================
// Источник обновлений — GitHub Releases репозитория MoonLauncherofficial/MoonLauncher.
// Раньше обновления запрашивались с сайта (moonlauncher.ru/api/launcher-update),
// а GitHub использовался только как резервный вариант при недоступности сайта.
// Теперь наоборот: GitHub Releases — основной и единственный источник обновлений,
// сайт больше не опрашивается.
const GITHUB_API_LATEST_RELEASE = 'https://api.github.com/repos/MoonLauncherofficial/MoonLauncher/releases/latest';

function normalizeGithubRelease(release, currentVersion) {
    const latestVersion = (release.tag_name || '').replace(/^v/i, '');
    // Ищем в assets релиза установщик: обычно .exe (NSIS) для Windows.
    const asset = release.assets?.find(a => /\.exe$/i.test(a.name))
        || release.assets?.find(a => /setup|installer/i.test(a.name))
        || release.assets?.[0];

    return {
        latestVersion,
        changelog: release.body || '',
        downloadUrl: asset?.browser_download_url || `${GITHUB_REPO}/releases`,
        fileName: asset?.name || `MoonLauncher-${latestVersion || 'latest'}-Setup.exe`,
        mandatory: false,
        releaseDate: release.published_at || '',
        fileSize: asset?.size || 0,
        // GitHub Releases API не отдаёт sha256 инсталлятора в метаданных ассета,
        // поэтому проверка целостности при скачивании (см. download-launcher-update)
        // просто пропускается — сравнивать не с чем.
        sha256: ''
    };
}

ipcMain.handle('check-updates', async () => {
    const pkg = safeRequire('../../package.json') || safeRequire('../package.json') || { version: '1.0.0' };
    const currentVersion = pkg.version || '1.0.0';

    try {
        const ghResponse = await axios.get(GITHUB_API_LATEST_RELEASE, {
            timeout: 10000,
            headers: { Accept: 'application/vnd.github+json' }
        });
        const normalized = normalizeGithubRelease(ghResponse.data, currentVersion);

        if (normalized.latestVersion && compareVersions(normalized.latestVersion, currentVersion) > 0) {
            return {
                success: true,
                hasUpdate: true,
                currentVersion,
                ...normalized
            };
        }
        return { success: true, hasUpdate: false, currentVersion };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('download-launcher-update', async (event, { downloadUrl, fileName, latestVersion, sha256 }) => {
    try {
        const url = resolveUpdateDownloadUrl(downloadUrl);
        if (!url) return { success: false, error: 'URL обновления не указан' };

        const safeName = (fileName || `MoonLauncher-${latestVersion || 'latest'}-Setup.exe`).replace(/[<>:"|?*]/g, '_');
        const destPath = safeJoin(UPDATES_DIR, safeName);

        sendUpdateDownloadProgress({ status: 'downloading', percent: 0, message: 'Подключение...' });

        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 600000,
            maxRedirects: 5
        });

        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const hasher = crypto.createHash('sha256');

        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(destPath);
            response.data.on('data', (chunk) => {
                downloaded += chunk.length;
                hasher.update(chunk);
                const percent = total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : Math.min(95, Math.round(downloaded / 1024 / 50));
                sendUpdateDownloadProgress({
                    status: 'downloading',
                    percent,
                    downloaded,
                    total,
                    message: total > 0
                        ? `${Math.round(downloaded / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)} МБ`
                        : `${Math.round(downloaded / 1024 / 1024)} МБ`
                });
            });
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
            response.data.on('error', reject);
        });

        // SECURITY: если манифест обновления (latest.json на сайте) отдаёт sha256
        // инсталлятора — сверяем его здесь, ДО того как файл станет доступен для
        // автозапуска в install-launcher-update. Раньше скачанный .exe запускался
        // без какой-либо проверки — если бы сервер раздачи или канал скачивания
        // был скомпрометирован, лаунчер тихо запустил бы подменённый инсталлятор.
        // Пока сайт не отдаёт sha256 в манифесте, проверка пропускается (не может
        // сравнить — но как только поле появится на сайте, защита заработает без
        // изменений в лаунчере).
        const expectedHash = (sha256 || '').toString().trim().toLowerCase();
        if (expectedHash) {
            const actualHash = hasher.digest('hex');
            if (actualHash !== expectedHash) {
                try { fs.unlinkSync(destPath); } catch (e) {}
                const msg = 'Проверка целостности обновления не пройдена (хэш не совпадает) — установка отменена';
                sendUpdateDownloadProgress({ status: 'error', percent: 0, message: msg });
                return { success: false, error: msg };
            }
        }

        sendUpdateDownloadProgress({ status: 'completed', percent: 100, path: destPath, message: 'Готово' });
        return { success: true, path: destPath, fileName: safeName };
    } catch (error) {
        sendUpdateDownloadProgress({ status: 'error', percent: 0, message: error.message });
        return { success: false, error: error.message };
    }
});

ipcMain.handle('install-launcher-update', async (event, { filePath }) => {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return { success: false, error: 'Файл установщика не найден' };
        }
        if (process.platform === 'win32') {
            // Тихая установка: флаг /S — стандартный ключ NSIS-инсталляторов
            // (в т.ч. собранных electron-builder) для полностью автоматической
            // установки без мастера "Далее -> Далее -> Установить". Обновление
            // ставится в ту же папку поверх текущей версии, после чего
            // NSIS-инсталлятор сам перезапускает лаунчер (runAfterFinish).
            //
            // ИСПРАВЛЕНО: раньше установщик запускался через "cmd.exe /c" с
            // ручной склейкой командной строки ("ping ... & \"путь\" /S"). Это
            // ломалось, если путь к файлу содержал кириллицу или иные не-ASCII
            // символы (например, имя пользователя Windows на кириллице) —
            // cmd.exe мог получить путь в неверной кодировке (OEM/866 вместо
            // UTF-8), не находил файл и тихо завершался с ошибкой, которую
            // никто не видел из-за stdio: 'ignore'. Симптом: в диспетчере
            // задач мелькал только ping.exe, а сам MoonLauncher-Setup.exe
            // даже не пытался стартовать.
            //
            // Теперь установщик запускается напрямую через spawn(filePath, [...]),
            // без промежуточного shell и без ручной сборки командной строки —
            // Node передаёт путь и аргументы как есть, без риска потерять
            // кодировку. Задержка перед стартом реализована через setTimeout
            // самого процесса (а не через "ping"), а app.quit() вызывается
            // только ПОСЛЕ того, как процесс инсталлятора подтверждённо стартовал
            // (событие 'spawn'), — так лаунчер успевает освободить свой .exe до
            // того, как инсталлятор попытается его перезаписать. Все ошибки
            // запуска пишутся в лог-файл updates/update-install.log, чтобы их
            // можно было увидеть, а не гадать по диспетчеру задач.
            const logPath = path.join(UPDATES_DIR, 'update-install.log');
            const appendLog = (msg) => {
                try {
                    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
                } catch (e) {}
            };

            setTimeout(() => {
                try {
                    const child = spawn(filePath, ['/S'], {
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: true
                    });

                    child.on('error', (err) => {
                        appendLog(`Ошибка запуска установщика "${filePath}": ${err.message}`);
                    });

                    child.once('spawn', () => {
                        appendLog(`Установщик запущен (pid ${child.pid}): "${filePath}" /S`);
                        child.unref();
                        isQuiting = true;
                        setTimeout(() => app.quit(), 300);
                    });
                } catch (err) {
                    appendLog(`Исключение при запуске установщика "${filePath}": ${err.message}`);
                    isQuiting = true;
                    app.quit();
                }
            }, 1200);

            return { success: true };
        } else {
            // На macOS/Linux безопасного «тихого» режима для .dmg/.AppImage нет —
            // просто открываем файл штатным способом ОС.
            await shell.openPath(filePath);
            isQuiting = true;
            setTimeout(() => app.quit(), 300);
            return { success: true };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== FAVORITE SERVERS ====================
ipcMain.handle('get-favorite-servers', async () => {
    try {
        const favFile = path.join(LAUNCHER_ROOT, 'favorites.json');
        if (fs.existsSync(favFile)) {
            return { success: true, favorites: JSON.parse(fs.readFileSync(favFile, 'utf8')) };
        }
    } catch (e) {}
    return { success: true, favorites: [] };
});

ipcMain.handle('save-favorite-servers', async (event, favorites) => {
    try {
        fs.writeFileSync(path.join(LAUNCHER_ROOT, 'favorites.json'), JSON.stringify(favorites, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== MICROSOFT AUTH ====================
const MICROSOFT_LOGIN_URL = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=XboxLive.signin%20offline_access&prompt=select_account`;

ipcMain.handle('microsoft-login', async () => {
    try {
        const authWindow = new BrowserWindow({
            width: 500, height: 650,
            parent: mainWindow,
            modal: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
            show: false,
            title: 'MoonLauncher - Microsoft Login'
        });

        authWindow.loadURL(MICROSOFT_LOGIN_URL);
        authWindow.show();

        const authCode = await new Promise((resolve, reject) => {
            let resolved = false;

            authWindow.webContents.on('will-redirect', (event, url) => {
                if (url.startsWith(REDIRECT_URI)) {
                    resolved = true;
                    authWindow.close();
                    const urlObj = new URL(url);
                    const code = urlObj.searchParams.get('code');
                    const error = urlObj.searchParams.get('error');
                    if (error) reject(new Error(error));
                    else if (code) resolve(code);
                    else reject(new Error('No auth code received'));
                }
            });

            authWindow.on('closed', () => {
                if (!resolved) reject(new Error('Auth window closed'));
            });
        });

        const tokenResponse = await axios.post('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
            new URLSearchParams({
                client_id: CLIENT_ID,
                code: authCode,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
                scope: 'XboxLive.signin offline_access'
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
            }
        );

        const msAccessToken = tokenResponse.data.access_token;
        const msRefreshToken = tokenResponse.data.refresh_token;

        const xboxResponse = await axios.post('https://user.auth.xboxlive.com/user/authenticate',
            {
                Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
                RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
            }, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: 30000
            }
        );

        const xboxToken = xboxResponse.data.Token;
        const userHash = xboxResponse.data.DisplayClaims.xui[0].uhs;

        const xstsResponse = await axios.post('https://xsts.auth.xboxlive.com/xsts/authorize',
            {
                Properties: { SandboxId: 'RETAIL', UserTokens: [xboxToken] },
                RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
            }, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: 30000
            }
        );

        const xstsToken = xstsResponse.data.Token;

        const mcTokenResponse = await axios.post('https://api.minecraftservices.com/authentication/login_with_xbox',
            { identityToken: `XBL3.0 x=${userHash};${xstsToken}` },
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        const mcAccessToken = mcTokenResponse.data.access_token;

        const profileResponse = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
            headers: { 'Authorization': `Bearer ${mcAccessToken}` },
            timeout: 30000
        });

        const username = profileResponse.data.name;
        const uuid = profileResponse.data.id;
        const skins = profileResponse.data.skins || [];
        const capes = profileResponse.data.capes || [];

        const authData = {
            username, uuid, accessToken: mcAccessToken, refreshToken: msRefreshToken,
            skins, capes, timestamp: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000
        };

        writeAuthFile(authData);

        return { success: true, username, uuid, accessToken: mcAccessToken, skins, capes };

    } catch (error) {
        console.error('Auth error:', error.message);
        return { success: false, error: error.message || 'Auth failed' };
    }
});

async function refreshAuthTokens() {
    const auth = readAuthFile();
    if (!auth || !auth.refreshToken) return { success: false };

    const tokenResponse = await axios.post('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
        new URLSearchParams({
            client_id: CLIENT_ID, refresh_token: auth.refreshToken,
            grant_type: 'refresh_token', scope: 'XboxLive.signin offline_access'
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
    );

    const msAccessToken = tokenResponse.data.access_token;

    const xboxResponse = await axios.post('https://user.auth.xboxlive.com/user/authenticate',
        { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
          RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const xstsResponse = await axios.post('https://xsts.auth.xboxlive.com/xsts/authorize',
        { Properties: { SandboxId: 'RETAIL', UserTokens: [xboxResponse.data.Token] },
          RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const userHash = xboxResponse.data.DisplayClaims.xui[0].uhs;
    const mcTokenResponse = await axios.post('https://api.minecraftservices.com/authentication/login_with_xbox',
        { identityToken: `XBL3.0 x=${userHash};${xstsResponse.data.Token}` },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const mcAccessToken = mcTokenResponse.data.access_token;
    const profileResponse = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
        headers: { 'Authorization': `Bearer ${mcAccessToken}` }, timeout: 30000
    });

    auth.accessToken = mcAccessToken;
    auth.refreshToken = tokenResponse.data.refresh_token || auth.refreshToken;
    auth.username = profileResponse.data.name;
    auth.uuid = profileResponse.data.id;
    auth.timestamp = Date.now();
    auth.expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    writeAuthFile(auth);
    return { success: true, username: auth.username, uuid: auth.uuid, accessToken: auth.accessToken };
}

ipcMain.handle('refresh-auth', async () => {
    try {
        return await refreshAuthTokens();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-saved-auth', async () => {
    try {
        const auth = readAuthFile();
        if (!auth) return { success: false };

        if (!auth.accessToken || auth.accessToken.length < 10) {
            return { success: false, invalid: true };
        }

        if (auth.expiresAt && Date.now() > auth.expiresAt - 5 * 60 * 1000) {
            const refreshed = await refreshAuthTokens();
            if (refreshed && refreshed.success) return refreshed;
            return { success: false, expired: true };
        }

        return { success: true, username: auth.username, uuid: auth.uuid, accessToken: auth.accessToken };
    } catch (error) {
        return { success: false };
    }
});

ipcMain.handle('logout', async () => {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
    return { success: true };
});

// ==================== MINECRAFT VERSIONS ====================
ipcMain.handle('get-minecraft-versions', async () => {
    try {
        const settings = loadSettingsSync();
        const manifestUrl = applyDownloadMirror(
            'https://launchermeta.mojang.com/mc/game/version_manifest.json',
            settings.downloadMirror
        );
        const response = await axios.get(manifestUrl, { timeout: 10000 });
        const versions = response.data.versions
            .filter(v => {
                const major = parseInt(v.id.split('.')[1]);
                return v.type === 'release' && major >= 14;
            })
            .map(v => ({ id: v.id, type: v.type, url: v.url, time: v.releaseTime }));
        return { success: true, versions };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== FABRIC VERSIONS ====================
ipcMain.handle('get-fabric-versions', async () => {
    try {
        const response = await axios.get('https://meta.fabricmc.net/v2/versions/game', { timeout: 10000 });
        return { success: true, versions: response.data.filter(v => v.stable).map(v => v.version) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-fabric-loader-versions', async () => {
    try {
        const response = await axios.get('https://meta.fabricmc.net/v2/versions/loader', { timeout: 10000 });
        return { success: true, loaders: response.data.filter(v => v.stable).map(v => v.version) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-quilt-loader-versions', async () => {
    try {
        const response = await axios.get('https://meta.quiltmc.org/v3/versions/loader', { timeout: 10000 });
        return { success: true, loaders: response.data.filter(v => v.stable).map(v => v.version) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== FORGE / NEOFORGE VERSIONS ====================
// Forge не даёт единый "loader version" независимо от версии Minecraft —
// у каждой версии MC свой список сборок Forge. promotions_slim.json от
// самого Forge — официальный источник recommended/latest по каждой версии.
ipcMain.handle('get-forge-versions', async (event, mcVersion) => {
    try {
        const response = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { timeout: 10000 });
        const promos = response.data.promos || {};
        const versions = [];
        const rec = promos[`${mcVersion}-recommended`];
        const latest = promos[`${mcVersion}-latest`];
        if (rec) versions.push(rec);
        if (latest && latest !== rec) versions.push(latest);
        return { success: true, loaders: versions };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-neoforge-versions', async (event, mcVersion) => {
    try {
        const response = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { timeout: 10000 });
        const all = [...response.data.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
        // NeoForge-версии вида "21.1.100" соответствуют Minecraft "1.21.1" —
        // сопоставляем по префиксу major.minor из mcVersion (без ведущего "1.").
        const mcParts = mcVersion.split('.');
        const prefix = mcParts.slice(1).join('.') + '.';
        const matching = all.filter(v => v.startsWith(prefix)).reverse();
        return { success: true, loaders: matching.length ? matching : all.reverse().slice(0, 20) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== PROFILES ====================
ipcMain.handle('get-profiles', async () => {
    try {
        const profilesFile = path.join(PROFILES_DIR, 'profiles.json');
        if (!fs.existsSync(profilesFile)) {
            const defaultProfile = {
                id: 'default', name: 'Основной профиль', version: '', versionId: '',
                loader: 'vanilla', loaderVersion: '', gameDir: MINECRAFT_DIR,
                javaArgs: '-Xmx2G -XX:+UseG1GC', created: Date.now()
            };
            fs.writeFileSync(profilesFile, JSON.stringify([defaultProfile], null, 2));
            return { success: true, profiles: [defaultProfile] };
        }
        let profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        if (migrateProfilesGameDirs(profiles)) {
            fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
        }
        return { success: true, profiles };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-profiles', async (event, profiles) => {
    try {
        fs.writeFileSync(path.join(PROFILES_DIR, 'profiles.json'), JSON.stringify(profiles, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('create-profile', async (event, profile) => {
    try {
        const profilesFile = path.join(PROFILES_DIR, 'profiles.json');
        let profiles = [];
        if (fs.existsSync(profilesFile)) profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        profile.id = 'profile_' + Date.now();
        profile.created = Date.now();
        profile.gameDir = path.join(PROFILES_DIR, profile.id, 'minecraft');
        ensureProfileGameDirs(profile);
        profiles.push(profile);
        fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
        return { success: true, profiles };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('duplicate-profile', async (event, profileId) => {
    try {
        const profilesFile = path.join(PROFILES_DIR, 'profiles.json');
        if (!fs.existsSync(profilesFile)) return { success: false, error: 'No profiles' };
        let profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        const source = profiles.find(p => p.id === profileId);
        if (!source) return { success: false, error: 'Profile not found' };
        const newId = 'profile_' + Date.now();
        const copy = {
            ...JSON.parse(JSON.stringify(source)),
            id: newId,
            name: `${source.name} (копия)`,
            created: Date.now(),
            lastPlayed: null,
            launchCount: 0,
            totalPlayTime: 0,
            gameDir: path.join(PROFILES_DIR, newId, 'minecraft')
        };
        ensureProfileGameDirs(copy);
        profiles.push(copy);
        fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
        return { success: true, profiles, profileId: copy.id };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-quick-connect', async (event, server) => {
    pendingQuickConnect = server && server.ip ? { ip: server.ip, port: server.port || 25565 } : null;
    return { success: true, server: pendingQuickConnect };
});

ipcMain.handle('save-profile-memory', async (event, { profileId, memoryMB }) => {
    try {
        const profilesFile = path.join(PROFILES_DIR, 'profiles.json');
        if (!fs.existsSync(profilesFile)) return { success: false };
        const profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        const profile = profiles.find(p => p.id === profileId);
        if (profile) {
            profile.memoryMB = memoryMB;
            fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-profile', async (event, profileId) => {
    try {
        const profilesFile = path.join(PROFILES_DIR, 'profiles.json');
        if (!fs.existsSync(profilesFile)) return { success: false };
        let profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
        profiles = profiles.filter(p => p.id !== profileId);
        fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
        return { success: true, profiles };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== PROGRESS TRACKING ====================
let launchProgress = {
    stage: '', message: '', percent: 0, totalFiles: 0, completedFiles: 0, cancelled: false
};

function sendProgress(stage, message, percent, totalFiles = 0, completedFiles = 0, extra = {}) {
    launchProgress = {
        stage, message, percent, totalFiles, completedFiles,
        cancelled: launchProgress.cancelled,
        ...extra
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-progress', launchProgress);
    }
}

let activeGameProcess = null;
let userRequestedClose = false;

const MINECRAFT_CLIENT_ID = '00000000402b5328';

function formatUuid(uuid, dashed = true) {
    const clean = (uuid || '').replace(/-/g, '');
    if (!dashed) return clean;
    if (clean.length !== 32) return uuid;
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function mergeManifestArguments(parentArgs, childArgs) {
    if (!parentArgs) return childArgs;
    if (!childArgs) return parentArgs;
    return {
        jvm: [...(parentArgs.jvm || []), ...(childArgs.jvm || [])],
        game: [...(parentArgs.game || []), ...(childArgs.game || [])]
    };
}

function mergeVersionManifests(parent, child) {
    return {
        ...parent,
        ...child,
        id: child.id || parent.id,
        mainClass: child.mainClass || parent.mainClass,
        minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
        assetIndex: child.assetIndex || parent.assetIndex,
        downloads: { ...(parent.downloads || {}), ...(child.downloads || {}) },
        libraries: [...(parent.libraries || []), ...(child.libraries || [])],
        arguments: mergeManifestArguments(parent.arguments, child.arguments)
    };
}

async function loadVersionManifest(versionId) {
    const versionDir = path.join(VERSIONS_DIR, versionId);
    const jsonPath = path.join(versionDir, `${versionId}.json`);
    if (!fs.existsSync(jsonPath)) {
        await downloadVersionManifest(versionId);
    }
    const manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (manifest.inheritsFrom) {
        const parent = await loadVersionManifest(manifest.inheritsFrom);
        return mergeVersionManifests(parent, manifest);
    }
    return manifest;
}

async function installQuilt(mcVersion, loaderVersion) {
    if (!loaderVersion) {
        const loaders = await axios.get('https://meta.quiltmc.org/v3/versions/loader', { timeout: 10000 });
        loaderVersion = loaders.data.find(l => l.stable)?.version;
        if (!loaderVersion) throw new Error('No stable Quilt loader found');
    }
    const quiltUrl = `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
    const quiltManifest = await axios.get(quiltUrl, { timeout: 30000 });
    const versionId = `quilt-loader-${loaderVersion}-${mcVersion}`;
    const versionDir = path.join(VERSIONS_DIR, versionId);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(quiltManifest.data, null, 2));
    if (quiltManifest.data.libraries) {
        for (const lib of quiltManifest.data.libraries) {
            const parts = lib.name.split(':');
            if (parts.length < 3) continue;
            const [group, artifact, version] = parts;
            const pathParts = group.replace(/\./g, '/').split('/');
            const libPath = path.join(LIBRARIES_DIR, ...pathParts, artifact, version, `${artifact}-${version}.jar`);
            if (!fs.existsSync(libPath) && lib.url) {
                const url = `${lib.url}${pathParts.join('/')}/${artifact}/${version}/${artifact}-${version}.jar`;
                try { await downloadFile(url, libPath); } catch (e) { console.warn(`Quilt lib skip: ${lib.name}`); }
            }
        }
    }
    return versionId;
}

/**
 * Forge/NeoForge (1.13+) не выдают готовый version.json по HTTP, как Fabric/Quilt.
 * Официальный способ — скачать installer.jar и прогнать его в тихом режиме
 * `--installClient <mc_dir>`: он сам качает нужные библиотеки и кладёт
 * versions/<id>/<id>.json + libraries/... прямо в директорию ванильного
 * лаунчера — у нас это ровно MINECRAFT_DIR, так что распаковывать вручную
 * ничего не нужно, только запустить установщик и найти появившийся id.
 */
/**
 * Установщики Forge/NeoForge (ClientInstall) сами проверяют, что целевая папка
 * похожа на настоящую папку Minecraft — а именно требуют файл
 * launcher_profiles.json, который создаёт оригинальный Mojang-лаунчер при
 * первом запуске. У нас его никто не создаёт, поэтому установщик падал с
 * "There is no minecraft launcher profile ..., you need to run the launcher
 * first!" (код 1, без Java тут дело вообще не в Java). Создаём минимальный
 * валидный стаб, если файла ещё нет — этого достаточно для проверки.
 */
function ensureLauncherProfilesStub() {
    const profilesPath = path.join(MINECRAFT_DIR, 'launcher_profiles.json');
    if (fs.existsSync(profilesPath)) return;
    const stub = {
        profiles: {},
        settings: {
            enableSnapshots: false,
            enableAdvanced: false,
            keepLauncherOpen: false,
            profileSorting: 'ByLastPlayed',
            showGameLog: false,
            showMenu: false
        },
        version: 3
    };
    fs.writeFileSync(profilesPath, JSON.stringify(stub, null, 2));
}

async function runInstallerJar(javaPath, installerPath) {
    ensureLauncherProfilesStub();
    return new Promise((resolve, reject) => {
        const child = spawn(javaPath, ['-jar', installerPath, '--installClient', MINECRAFT_DIR], {
            cwd: path.dirname(installerPath)
        });
        let stderr = '';
        let stdout = '';
        child.stdout?.on('data', d => { stdout += d.toString(); });
        child.stderr?.on('data', d => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve();
            else {
                const output = (stderr || stdout).slice(-400);
                reject(new Error(`Установщик завершился с кодом ${code}${output ? ': ' + output : ' (без вывода — вероятно, несовместимая версия Java)'}`));
            }
        });
    });
}

function findNewestVersionDirMatching(pattern, existingBefore) {
    if (!fs.existsSync(VERSIONS_DIR)) return null;
    const dirs = fs.readdirSync(VERSIONS_DIR).filter(d => {
        if (existingBefore.has(d)) return false;
        return pattern.test(d);
    });
    if (!dirs.length) return null;
    dirs.sort((a, b) => {
        const ta = fs.statSync(path.join(VERSIONS_DIR, a)).mtimeMs;
        const tb = fs.statSync(path.join(VERSIONS_DIR, b)).mtimeMs;
        return tb - ta;
    });
    return dirs[0];
}

async function installForge(mcVersion, forgeVersion, javaPath, onProgress) {
    if (!forgeVersion) {
        const promos = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { timeout: 10000 });
        forgeVersion = promos.data.promos?.[`${mcVersion}-recommended`] || promos.data.promos?.[`${mcVersion}-latest`];
        if (!forgeVersion) throw new Error(`Нет сборок Forge для Minecraft ${mcVersion}`);
    }
    const existingBefore = new Set(fs.existsSync(VERSIONS_DIR) ? fs.readdirSync(VERSIONS_DIR) : []);
    const full = `${mcVersion}-${forgeVersion}`;
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
    const installerDir = path.join(LAUNCHER_ROOT, 'installers');
    if (!fs.existsSync(installerDir)) fs.mkdirSync(installerDir, { recursive: true });
    const installerPath = path.join(installerDir, `forge-${full}-installer.jar`);

    if (onProgress) onProgress('Загрузка установщика Forge...', 0);
    await downloadFile(installerUrl, installerPath, (p) => onProgress && onProgress('Загрузка установщика Forge...', p));

    if (onProgress) onProgress('Установка Forge (может занять минуту)...', 100);
    await runInstallerJar(javaPath, installerPath);
    try { fs.unlinkSync(installerPath); } catch (e) {}

    const versionId = findNewestVersionDirMatching(/forge/i, existingBefore) || `${mcVersion}-forge-${forgeVersion}`;
    if (!fs.existsSync(path.join(VERSIONS_DIR, versionId, `${versionId}.json`))) {
        throw new Error('Установщик Forge отработал, но версия не появилась в versions/. Проверьте лог установки.');
    }
    return versionId;
}

async function installNeoForge(mcVersion, neoforgeVersion, javaPath, onProgress) {
    if (!neoforgeVersion) {
        const meta = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { timeout: 10000 });
        const all = [...meta.data.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
        const prefix = mcVersion.split('.').slice(1).join('.') + '.';
        const matching = all.filter(v => v.startsWith(prefix));
        neoforgeVersion = matching[matching.length - 1];
        if (!neoforgeVersion) throw new Error(`Нет сборок NeoForge для Minecraft ${mcVersion}`);
    }
    const existingBefore = new Set(fs.existsSync(VERSIONS_DIR) ? fs.readdirSync(VERSIONS_DIR) : []);
    const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoforgeVersion}/neoforge-${neoforgeVersion}-installer.jar`;
    const installerDir = path.join(LAUNCHER_ROOT, 'installers');
    if (!fs.existsSync(installerDir)) fs.mkdirSync(installerDir, { recursive: true });
    const installerPath = path.join(installerDir, `neoforge-${neoforgeVersion}-installer.jar`);

    if (onProgress) onProgress('Загрузка установщика NeoForge...', 0);
    await downloadFile(installerUrl, installerPath, (p) => onProgress && onProgress('Загрузка установщика NeoForge...', p));

    if (onProgress) onProgress('Установка NeoForge (может занять минуту)...', 100);
    await runInstallerJar(javaPath, installerPath);
    try { fs.unlinkSync(installerPath); } catch (e) {}

    const versionId = findNewestVersionDirMatching(/neoforge/i, existingBefore) || `neoforge-${neoforgeVersion}`;
    if (!fs.existsSync(path.join(VERSIONS_DIR, versionId, `${versionId}.json`))) {
        throw new Error('Установщик NeoForge отработал, но версия не появилась в versions/. Проверьте лог установки.');
    }
    return versionId;
}

async function resolveLaunchVersion(profile, javaPath) {
    const versionId = profile.versionId;
    const isFabric = profile.loader === 'fabric';
    const isQuilt = profile.loader === 'quilt';
    const isForge = profile.loader === 'forge';
    const isNeoForge = profile.loader === 'neoforge';

    if (isForge || isNeoForge) {
        const installFn = isForge ? installForge : installNeoForge;
        // Ищем уже установленную версию с этим загрузчиком для этой версии MC,
        // чтобы не переустанавливать Forge/NeoForge при каждом запуске.
        let versionKey = null;
        if (fs.existsSync(VERSIONS_DIR)) {
            const candidate = fs.readdirSync(VERSIONS_DIR).find(d => {
                if (isForge) return d.includes(versionId) && d.toLowerCase().includes('forge') && !d.toLowerCase().includes('neoforge');
                return d.toLowerCase().includes('neoforge') && (!profile.loaderVersion || d.includes(profile.loaderVersion));
            });
            if (candidate && fs.existsSync(path.join(VERSIONS_DIR, candidate, `${candidate}.json`))) {
                versionKey = candidate;
            }
        }
        if (!versionKey) {
            // Установщик Forge/NeoForge сам патчит байткод и трогает внутренности JDK —
            // это надёжно работает только на той версии Java, под которую его тестировали
            // (обычно текущая LTS), а не на любой Java >= минимальной версии. Если у игрока
            // в системе стоит сильно более новый JDK (например, самая свежая бета-сборка),
            // installer.jar может тихо завершаться с кодом 1 без вывода в stderr — как раз
            // это и произошло. Поэтому для запуска самого installer.jar берём гарантированно
            // совместимый Temurin JRE (тот же, что скачивается автоматически), а не javaPath,
            // выбранный для игры.
            const installerMajor = requiredJavaMajor(versionId);
            let installerJavaPath = javaPath;
            try {
                installerJavaPath = await ensureJava(JAVA_DIR, installerMajor, (percent, message) => {
                    sendProgress('loader_install', message || 'Подготовка Java для установщика...', 12 + Math.round(percent * 0.03));
                });
            } catch (e) {
                console.warn('Не удалось подготовить отдельную Java для установщика, используем текущую:', e.message);
            }
            if (!installerJavaPath) throw new Error('Для установки Forge/NeoForge нужна Java, но она не найдена.');
            versionKey = await installFn(versionId, profile.loaderVersion, installerJavaPath, (message, percent) => {
                sendProgress('loader_install', message, 15 + Math.round(percent * 0.08));
            });
        }
        const manifest = await loadVersionManifest(versionKey);
        // У Forge/NeoForge client jar обычно наследуется от родителя (inheritsFrom)
        // через mergeVersionManifests внутри loadVersionManifest — jar остаётся ванильным.
        const clientJar = path.join(VERSIONS_DIR, versionId, `${versionId}.jar`);
        if (!fs.existsSync(clientJar)) {
            const vanillaManifest = await loadVersionManifest(versionId);
            await downloadClientJar(vanillaManifest, clientJar);
        }
        return {
            manifest,
            versionKey,
            gameVersion: versionId,
            clientJar,
            isFabric: false,
            // Forge/NeoForge build their own "minecraft" JPMS module at runtime from the
            // client jar(s) listed in their own manifest libraries. Also putting the raw
            // vanilla client jar on the classpath creates a second module (auto-named from
            // the jar filename, e.g. "_1._20._1") that exports the same packages - causing
            // "module X contains package Y, module Z exports package Y" at startup.
            includeClientJarInClasspath: false
        };
    }

    if (isQuilt) {
        let loaderVersion = profile.loaderVersion;
        if (!loaderVersion) {
            const loaders = await axios.get('https://meta.quiltmc.org/v3/versions/loader', { timeout: 10000 });
            loaderVersion = loaders.data.find(l => l.stable)?.version;
            if (!loaderVersion) throw new Error('No stable Quilt loader found');
        }
        const resolvedQuiltId = `quilt-loader-${loaderVersion}-${versionId}`;
        const quiltJsonPath = path.join(VERSIONS_DIR, resolvedQuiltId, `${resolvedQuiltId}.json`);
        if (!fs.existsSync(quiltJsonPath)) {
            await installQuilt(versionId, loaderVersion);
        }
        const manifest = await loadVersionManifest(resolvedQuiltId);
        const vanillaJar = path.join(VERSIONS_DIR, versionId, `${versionId}.jar`);
        if (!fs.existsSync(vanillaJar)) {
            const vanillaManifest = await loadVersionManifest(versionId);
            await downloadClientJar(vanillaManifest, vanillaJar);
        }
        return {
            manifest,
            versionKey: resolvedQuiltId,
            gameVersion: versionId,
            clientJar: vanillaJar,
            isFabric: true,
            includeClientJarInClasspath: true
        };
    }

    if (isFabric) {
        let loaderVersion = profile.loaderVersion;
        if (!loaderVersion) {
            const loaders = await axios.get('https://meta.fabricmc.net/v2/versions/loader', { timeout: 10000 });
            loaderVersion = loaders.data.find(l => l.stable)?.version;
        }
        const fabricVersionId = `fabric-loader-${loaderVersion}-${versionId}`;
        const fabricJsonPath = path.join(VERSIONS_DIR, fabricVersionId, `${fabricVersionId}.json`);
        if (!fs.existsSync(fabricJsonPath)) {
            await installFabric(versionId, loaderVersion);
        }
        const manifest = await loadVersionManifest(fabricVersionId);
        const vanillaJar = path.join(VERSIONS_DIR, versionId, `${versionId}.jar`);
        if (!fs.existsSync(vanillaJar)) {
            const vanillaManifest = await loadVersionManifest(versionId);
            await downloadClientJar(vanillaManifest, vanillaJar);
        }
        return {
            manifest,
            versionKey: fabricVersionId,
            gameVersion: versionId,
            clientJar: vanillaJar,
            isFabric: true,
            includeClientJarInClasspath: true
        };
    }

    const manifest = await loadVersionManifest(versionId);
    const clientJar = path.join(VERSIONS_DIR, versionId, `${versionId}.jar`);
    return {
        manifest,
        versionKey: versionId,
        gameVersion: versionId,
        clientJar,
        isFabric: false,
        includeClientJarInClasspath: true
    };
}

function getNativeClassifierFromLibraryName(libName) {
    if (!libName) return null;
    const parts = libName.split(':');
    if (parts.length < 4) return null;
    return parts.slice(3).join(':');
}

function isNativeLibraryEntry(lib) {
    const classifier = getNativeClassifierFromLibraryName(lib?.name);
    return classifier !== null && classifier.startsWith('natives-');
}

function matchesPlatformNative(classifier) {
    if (!classifier) return false;
    return getPreferredNativeClassifierKeys().includes(classifier);
}

function getPreferredNativeClassifierKeys() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'win32') {
        if (arch === 'arm64') {
            return ['natives-windows-arm64', 'natives-windows'];
        }
        return ['natives-windows', 'natives-windows-x86_64'];
    }
    if (platform === 'darwin') {
        if (arch === 'arm64') {
            return ['natives-macos-arm64', 'natives-osx', 'natives-macos'];
        }
        return ['natives-macos', 'natives-osx', 'natives-macos-arm64'];
    }
    if (arch === 'arm64') {
        return ['natives-linux-arm64', 'natives-linux', 'natives-linux-x86_64'];
    }
    return ['natives-linux-x86_64', 'natives-linux', 'natives-linux-arm64'];
}

function pickNativeClassifier(classifiers) {
    if (!classifiers) return null;
    for (const key of getPreferredNativeClassifierKeys()) {
        if (classifiers[key]?.url || classifiers[key]?.path) {
            return { key, artifact: classifiers[key] };
        }
    }
    return null;
}

function libraryArtifactPath(lib) {
    if (lib.downloads?.artifact?.path) {
        return path.join(LIBRARIES_DIR, lib.downloads.artifact.path);
    }
    if (!lib.name) return null;
    const parts = lib.name.split(':');
    if (parts.length < 3) return null;
    const [group, artifact, version] = parts;
    const classifier = parts.length > 3 ? parts.slice(3).join(':') : null;
    const fileName = classifier
        ? `${artifact}-${version}-${classifier}.jar`
        : `${artifact}-${version}.jar`;
    const rel = `${group.replace(/\./g, '/')}/${artifact}/${version}/${fileName}`;
    return path.join(LIBRARIES_DIR, rel);
}

function libraryArtifactUrl(lib) {
    if (lib.downloads?.artifact?.url) return lib.downloads.artifact.url;
    const artifactPath = libraryArtifactPath(lib);
    if (!artifactPath || !lib.name) return null;
    const rel = path.relative(LIBRARIES_DIR, artifactPath).replace(/\\/g, '/');
    const base = lib.url || 'https://libraries.minecraft.net/';
    return base.endsWith('/') ? base + rel : base + '/' + rel;
}

function isNativeLibraryJar(libPath) {
    if (!libPath) return false;
    const name = path.basename(libPath).toLowerCase();
    return name.includes('-natives-') || name.includes('natives-');
}

function getNativeJarPath(lib) {
    if (lib.downloads?.artifact?.path) {
        return path.join(LIBRARIES_DIR, lib.downloads.artifact.path);
    }
    return libraryArtifactPath(lib);
}

async function ensureLibrary(lib) {
    if (lib.rules && !checkRules(lib.rules)) return null;
    if (isNativeLibraryEntry(lib)) return null;
    const libPath = libraryArtifactPath(lib);
    const libUrl = libraryArtifactUrl(lib);
    if (!libPath || !libUrl) return null;
    if (isNativeLibraryJar(libPath)) return null;
    if (!fs.existsSync(libPath)) {
        await downloadFile(libUrl, libPath);
    }
    return libPath;
}

async function downloadAllLibraries(manifest) {
    const libraries = [];
    const libs = manifest.libraries || [];
    const total = libs.length;
    let completed = 0;

    for (const lib of libs) {
        if (launchProgress.cancelled) throw new Error('Launch cancelled');
        try {
            const libPath = await ensureLibrary(lib);
            if (libPath) libraries.push(libPath);

            if (isNativeLibraryEntry(lib)) {
                const classifier = getNativeClassifierFromLibraryName(lib.name);
                if (matchesPlatformNative(classifier)) {
                    const nativePath = getNativeJarPath(lib);
                    const nativeUrl = lib.downloads?.artifact?.url || libraryArtifactUrl(lib);
                    if (nativePath && nativeUrl && !fs.existsSync(nativePath)) {
                        await downloadFile(nativeUrl, nativePath);
                    }
                }
            } else {
                const picked = pickNativeClassifier(lib.downloads?.classifiers);
                if (picked?.artifact?.url) {
                    const nativePath = path.join(LIBRARIES_DIR, picked.artifact.path);
                    if (!fs.existsSync(nativePath)) {
                        await downloadFile(picked.artifact.url, nativePath);
                    }
                }
            }
        } catch (e) {
            console.warn('Library skip:', lib.name || lib, e.message);
        }
        completed++;
        if (completed % 5 === 0) {
            sendProgress('libraries', `Библиотеки (${completed}/${total})`, 20 + (completed / total) * 40);
        }
    }
    return libraries;
}

function buildLaunchVariables(auth, profile, resolved, settings, classpath, nativesPath, launcherVersion) {
    const gameDir = profile.gameDir || MINECRAFT_DIR;
    const assetIndex = resolved.manifest.assetIndex?.id || resolved.gameVersion;
    let width = '854';
    let height = '480';
    if (settings.gameResolution && settings.gameResolution !== 'auto') {
        [width, height] = settings.gameResolution.split('x');
    }
    return {
        auth_player_name: auth.username,
        version_name: resolved.versionKey,
        game_directory: gameDir,
        assets_root: ASSETS_DIR,
        assets_index_name: assetIndex,
        auth_uuid: formatUuid(auth.uuid, true),
        auth_access_token: auth.accessToken,
        user_type: 'msa',
        version_type: 'release',
        clientid: MINECRAFT_CLIENT_ID,
        auth_xuid: auth.xuid || '',
        game_assets: ASSETS_DIR,
        resolution_width: width,
        resolution_height: height,
        quickPlayPath: '',
        quickPlaySingleplayer: '',
        quickPlayMultiplayer: '',
        quickPlayRealms: '',
        classpath,
        natives_directory: nativesPath,
        launcher_name: 'MoonLauncher',
        launcher_version: launcherVersion,
        library_directory: LIBRARIES_DIR,
        classpath_separator: path.delimiter
    };
}

function applyQuickConnectToGameArgs(gameArgs, quickConnect) {
    if (!quickConnect?.ip) return gameArgs;
    const host = quickConnect.ip;
    const port = quickConnect.port || 25565;
    const filtered = gameArgs.filter((arg, i, arr) => {
        if (arg === '--server' || arg === '--port') return false;
        if (i > 0 && (arr[i - 1] === '--server' || arr[i - 1] === '--port')) return false;
        if (arg === '--quickPlayMultiplayer') return false;
        if (i > 0 && arr[i - 1] === '--quickPlayMultiplayer') return false;
        return true;
    });
    filtered.push('--quickPlayMultiplayer', `${host}:${port}`);
    return filtered;
}

function substituteArg(arg, vars) {
    if (typeof arg !== 'string') return arg;
    let out = arg;
    for (const [key, val] of Object.entries(vars)) {
        out = out.split(`\${${key}}`).join(String(val ?? ''));
    }
    return out;
}

// Flags that always require a following value. If that value fails to resolve
// (e.g. a manifest variable we don't populate), the flag must be dropped too -
// otherwise Java receives a bare flag with nothing after it and refuses to start
// (e.g. "-p requires module path specification").
const VALUE_REQUIRING_FLAGS = new Set(['-p', '--module-path', '--add-modules', '--add-opens', '--add-exports', '--add-reads', '-cp', '-classpath']);

function processManifestArguments(argList, vars) {
    const result = [];
    if (!argList) return result;
    for (const arg of argList) {
        if (typeof arg === 'string') {
            const resolved = substituteArg(arg, vars);
            if (!resolved.includes('${')) result.push(resolved);
        } else if (arg && arg.rules) {
            if (checkRules(arg.rules)) {
                const values = Array.isArray(arg.value) ? arg.value : [arg.value];
                for (const v of values) {
                    if (typeof v === 'string') {
                        const resolved = substituteArg(v, vars);
                        if (!resolved.includes('${')) {
                            result.push(resolved);
                        } else if (result.length && VALUE_REQUIRING_FLAGS.has(result[result.length - 1])) {
                            // Value failed to resolve - drop the preceding flag so it isn't orphaned.
                            result.pop();
                        }
                    } else if (v) result.push(v);
                }
            }
        }
    }
    return result;
}

function sanitizeLaunchArgs(args) {
    const result = [];
    const skipIfEmptyNext = new Set([
        '--quickPlayPath', '--quickPlaySingleplayer', '--quickPlayMultiplayer', '--quickPlayRealms'
    ]);

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg || arg.includes('${')) continue;

        if (skipIfEmptyNext.has(arg)) {
            const next = args[i + 1];
            if (!next || next.startsWith('--')) continue;
            result.push(arg, next);
            i++;
            continue;
        }

        if (arg === '--demo') continue;
        result.push(arg);
    }
    return result;
}

function buildLaunchCommand(manifest, auth, profile, classpath, resolved, settings) {
    const nativesPath = path.join(NATIVES_DIR, resolved.versionKey);
    const pkg = safeRequire('../../package.json') || safeRequire('../package.json') || { version: '1.0.0' };
    const launcherVersion = pkg.version || '1.0.0';
    const vars = buildLaunchVariables(auth, profile, resolved, settings, classpath, nativesPath, launcherVersion);

    let jvmArgs = [];

    if (manifest.arguments?.jvm) {
        jvmArgs = processManifestArguments(manifest.arguments.jvm, vars);
    }
    const hasClasspath = jvmArgs.some((arg, i) =>
        arg === '-cp' && jvmArgs[i + 1] && !jvmArgs[i + 1].includes('${')
    );
    if (!hasClasspath && classpath) {
        jvmArgs.unshift('-cp', classpath);
    }
    if (!jvmArgs.some(a => typeof a === 'string' && a.startsWith('-Djava.library.path='))) {
        jvmArgs.unshift(`-Djava.library.path=${nativesPath}`);
    }

    if (!manifest.arguments?.jvm) {
        jvmArgs = [
            '-cp', classpath,
            `-Djava.library.path=${nativesPath}`,
            '-Dminecraft.launcher.brand=MoonLauncher',
            `-Dminecraft.launcher.version=${launcherVersion}`
        ];
        if (manifest.minecraftArguments) {
            const legacy = substituteArg(manifest.minecraftArguments, vars).split(' ');
            for (const a of legacy) {
                if (a.startsWith('-D') || a === '-cp' || a.startsWith('-X')) jvmArgs.push(a);
            }
        }
    }

    if (settings.fullscreen && !jvmArgs.includes('--fullscreen')) {
        jvmArgs.push('--fullscreen');
    }

    const mainClass = manifest.mainClass || 'net.minecraft.client.main.Main';
    let gameArgs = [];

    if (manifest.arguments?.game) {
        gameArgs = processManifestArguments(manifest.arguments.game, vars);
    } else {
        gameArgs = [
            '--username', auth.username,
            '--version', resolved.versionKey,
            '--gameDir', vars.game_directory,
            '--assetsDir', ASSETS_DIR,
            '--assetIndex', vars.assets_index_name,
            '--uuid', formatUuid(auth.uuid, false),
            '--accessToken', auth.accessToken,
            '--userType', 'msa',
            '--versionType', 'release',
            '--width', vars.resolution_width,
            '--height', vars.resolution_height
        ];
    }

    gameArgs = sanitizeLaunchArgs(gameArgs);

    return [...jvmArgs, mainClass, ...gameArgs];
}

// ==================== MINECRAFT LAUNCH ====================
ipcMain.handle('launch-minecraft', async (event, { profile, auth }) => {
    try {
        launchProgress.cancelled = false;
        const settings = loadSettingsSync();

        if (!profile || !profile.versionId) {
            return { success: false, error: 'Не выбрана версия Minecraft', code: 'E_NO_VERSION' };
        }
        if (!auth || !auth.accessToken || auth.accessToken.length < 10) {
            return { success: false, error: 'Не выполнен вход в аккаунт. Войдите через Microsoft.', code: 'E_AUTH' };
        }

        sendProgress('java', 'Поиск Java...', 5);
        let javaPath = null;
        if (!settings.useSystemJava && settings.customJavaPath && fs.existsSync(settings.customJavaPath)) {
            javaPath = settings.customJavaPath;
        } else {
            javaPath = await findJava(profile.versionId);
        }

        if (!javaPath) {
            // Подходящей Java на диске нет — качаем нужный Temurin JRE сами,
            // без участия пользователя (аналогично официальному лаунчеру).
            // Делается до установки Forge/NeoForge — их installer.jar сам
            // запускается через java, поэтому она нужна уже на этом шаге.
            try {
                sendProgress('java', 'Java не найдена, загружаем автоматически...', 5);
                javaPath = await getJavaFor(JAVA_DIR, profile.versionId, (percent, message) => {
                    sendProgress('java', message || 'Загрузка Java...', 5 + Math.round(percent * 0.07));
                });
            } catch (javaErr) {
                return {
                    success: false,
                    error: `Не удалось автоматически загрузить Java: ${javaErr.message}. Установите Java 17+ (для 1.17+) или Java 21 (для 1.20.5+) вручную и укажите путь в настройках.`,
                    code: 'E_JAVA_NOT_FOUND'
                };
            }
        }

        sendProgress('prepare', 'Подготовка версии...', 12);
        const resolved = await resolveLaunchVersion(profile, javaPath);
        const { manifest, versionKey, clientJar, includeClientJarInClasspath = true } = resolved;

        if (!fs.existsSync(clientJar)) {
            sendProgress('client_jar', 'Загрузка клиента Minecraft...', 22);
            await downloadClientJar(manifest, clientJar);
        }

        sendProgress('libraries', 'Загрузка библиотек...', 30);
        const libraries = await downloadAllLibraries(manifest);

        sendProgress('assets', 'Загрузка ассетов...', 68);
        await downloadAssets(manifest);

        sendProgress('natives', 'Распаковка нативных библиотек...', 87);
        await extractNatives(manifest, versionKey);

        const classpath = buildClasspath(libraries, includeClientJarInClasspath ? clientJar : null);

        sendProgress('launching', 'Запуск Minecraft...', 95);

        const quickConnect = profile.quickConnect || pendingQuickConnect;
        pendingQuickConnect = null;

        const logFile = path.join(LOGS_DIR, `mc-${Date.now()}.log`);
        let logStream = null;
        if (settings.saveLogs !== false) {
            logStream = fs.createWriteStream(logFile, { flags: 'a' });
            logStream.write(`=== MoonLauncher launch ${new Date().toISOString()} ===\n`);
            logStream.write(`Version: ${versionKey}\nJava: ${javaPath}\n\n`);
        }

        let javaArgs = [];
        const profileMemory = profile.memoryMB;
        if (profileMemory && profileMemory > 0) {
            javaArgs.push(`-Xmx${profileMemory}M`, `-Xms${Math.floor(profileMemory / 2)}M`);
        } else if (!settings.autoMemory && settings.memory) {
            javaArgs.push(`-Xmx${settings.memory}M`, `-Xms${Math.floor(settings.memory / 2)}M`);
        } else {
            const autoMem = Math.min(Math.floor(os.totalmem() / 1024 / 1024 / 2), 8192);
            javaArgs.push(`-Xmx${autoMem}M`, `-Xms${Math.floor(autoMem / 2)}M`);
        }

        const perfArgs = buildPerformanceJvmArgs(settings).split(' ').filter(Boolean);
        const userArgs = (settings.javaArgs || '').split(' ').filter(a => a && !a.startsWith('-Xmx') && !a.startsWith('-Xms'));
        javaArgs.push(...perfArgs, ...userArgs);

        let launchArgs = buildLaunchCommand(manifest, auth, profile, classpath, resolved, settings);
        if (quickConnect?.ip) {
            const mainClass = manifest.mainClass || 'net.minecraft.client.main.Main';
            const mainIdx = launchArgs.indexOf(mainClass);
            if (mainIdx >= 0) {
                const gamePart = launchArgs.slice(mainIdx + 1);
                const jvmPart = launchArgs.slice(0, mainIdx + 1);
                launchArgs = [...jvmPart, ...applyQuickConnectToGameArgs(gamePart, quickConnect)];
            }
        }
        const allArgs = [...javaArgs, ...launchArgs];

        if (settings.debugMode && logStream) {
            const safeArgs = allArgs.map(a =>
                (typeof a === 'string' && a.startsWith('eyJ')) ? '[ACCESS_TOKEN_REDACTED]' : a
            );
            logStream.write(`Args: ${safeArgs.join(' ')}\n\n`);
            console.log('Java:', javaPath);
            console.log('Args:', safeArgs.join(' '));
        }

        const gameDir = getProfileGameDir(profile);
        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
        applyGamePerformanceOptions(gameDir, settings);

        activeGameProcess = spawn(javaPath, allArgs, {
            cwd: gameDir,
            detached: false,
            env: { ...process.env }
        });

        gameSessionStart = Date.now();
        updateProfileLaunchStats(profile.id, 0);

        activeGameProcess.stdout.on('data', (data) => { if (logStream) logStream.write(`[OUT] ${data}`); });
        activeGameProcess.stderr.on('data', (data) => { if (logStream) logStream.write(`[ERR] ${data}`); });
        activeGameProcess.on('close', (code) => {
            const sessionSec = gameSessionStart ? Math.floor((Date.now() - gameSessionStart) / 1000) : 0;
            gameSessionStart = null;
            if (profile?.id && sessionSec > 30) {
                updateProfileLaunchStats(profile.id, sessionSec);
            }
            if (logStream) {
                logStream.write(`\n=== Exit code: ${code} ===\n`);
                logStream.end();
            }
            activeGameProcess = null;
            sendProgress('closed', 'Minecraft закрыт', 100, 0, 0, {
                exitCode: code,
                userClosed: userRequestedClose
            });
            userRequestedClose = false;
        });
        activeGameProcess.on('error', (err) => {
            if (logStream) {
                logStream.write(`\n=== Error: ${err.message} ===\n`);
                logStream.end();
            }
            activeGameProcess = null;
            sendProgress('error', 'Ошибка запуска: ' + err.message, 0, 0, 0, {
                code: 'E_PROCESS',
                exitCode: -1
            });
        });

        if (settings.minimizeOnLaunch !== false && mainWindow) {
            mainWindow.minimize();
        }

        sendProgress('running', 'Minecraft запущен!', 100);
        return { success: true, pid: activeGameProcess.pid };
    } catch (error) {
        console.error('Launch error:', error);
        const code = error.message === 'Launch cancelled' ? 'E_CANCELLED' : 'E_LAUNCH';
        return { success: false, error: error.message, code, exitCode: -1 };
    }
});

ipcMain.handle('close-minecraft', async () => {
    if (!activeGameProcess) {
        return { success: true, wasRunning: false };
    }
    try {
        userRequestedClose = true;
        activeGameProcess.kill();
        activeGameProcess = null;
        return { success: true, wasRunning: true };
    } catch (error) {
        return { success: false, error: error.message, code: 'E_CLOSE' };
    }
});

ipcMain.handle('is-game-running', async () => {
    return { success: true, running: !!activeGameProcess };
});

ipcMain.handle('cancel-launch', () => {
    launchProgress.cancelled = true;
    if (activeGameProcess) {
        try { activeGameProcess.kill(); } catch (e) {}
        activeGameProcess = null;
        sendProgress('closed', 'Запуск отменён', 100, 0, 0, { exitCode: 0, code: 'E_CANCELLED' });
    }
    return { success: true };
});

// ==================== JAVA MANAGEMENT ====================
async function findJava(mcVersion) {
    const major = parseInt(mcVersion.split('.')[1]);
    const needsJava17 = major >= 17;
    const needsJava21 = major >= 21;
    const targetVersion = needsJava21 ? 21 : needsJava17 ? 17 : 8;

    // Check JAVA_HOME
    if (process.env.JAVA_HOME) {
        const javaHomePath = path.join(process.env.JAVA_HOME, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
        if (fs.existsSync(javaHomePath)) {
            const v = await getJavaVersion(javaHomePath);
            if (v && isJavaCompatible(v, targetVersion)) return javaHomePath;
        }
    }

    // Check common paths
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const javaRoots = [
        path.join(programFiles, 'Java'),
        path.join(programFilesX86, 'Java'),
        path.join(programFiles, 'Eclipse Adoptium'),
        path.join(programFiles, 'Microsoft', 'jdk-*'),
        path.join(programFiles, 'Amazon Corretto'),
        path.join(programFiles, 'Zulu'),
        JAVA_DIR,
        '/usr/lib/jvm',
        '/usr/java',
        '/Library/Java/JavaVirtualMachines',
        path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines')
    ];

    const javaPaths = [];
    
    for (const root of javaRoots) {
        if (!fs.existsSync(root)) continue;
        
        if (root.includes('*')) {
            const dir = path.dirname(root);
            const pattern = path.basename(root).replace('*', '');
            if (fs.existsSync(dir)) {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                    if (entry.includes(pattern)) {
                        javaPaths.push(path.join(dir, entry, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java'));
                    }
                }
            }
        } else {
            try {
                const entries = fs.readdirSync(root);
                for (const entry of entries) {
                    const javaExe = path.join(root, entry, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
                    if (fs.existsSync(javaExe)) javaPaths.push(javaExe);
                    const altJava = path.join(root, entry, os.platform() === 'win32' ? 'java.exe' : 'java');
                    if (fs.existsSync(altJava)) javaPaths.push(altJava);
                }
            } catch (e) {}
        }
    }

    // Check PATH
    try {
        const whichCmd = os.platform() === 'win32' ? 'where java' : 'which java';
        const whichResult = execSync(whichCmd, { encoding: 'utf8', timeout: 5000 }).trim();
        if (whichResult) {
            javaPaths.push(...whichResult.split('\n').map(p => p.trim()).filter(Boolean));
        }
    } catch (e) {}

    for (const javaPath of [...new Set(javaPaths)]) {
        try {
            const version = await getJavaVersion(javaPath);
            if (version && isJavaCompatible(version, targetVersion)) {
                return javaPath;
            }
        } catch (e) {}
    }

    return null;
}

async function getJavaVersion(javaPath) {
    try {
        const result = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf8', timeout: 10000 });
        const versionMatch = result.match(/version "(\d+)(?:\.(\d+))?(?:\.\d+)?(?:[+-].*)?"/);
        if (versionMatch) {
            let major = parseInt(versionMatch[1]);
            if (major === 1) major = parseInt(versionMatch[2]);
            return major;
        }
    } catch (e) {
        return null;
    }
    return null;
}

function isJavaCompatible(javaVersion, targetVersion) {
    if (targetVersion === 8) return javaVersion >= 8 && javaVersion < 17;
    if (targetVersion === 17) return javaVersion >= 17 && javaVersion < 21;
    if (targetVersion === 21) return javaVersion >= 21;
    return javaVersion >= targetVersion;
}

// ==================== FABRIC INSTALLATION ====================
async function installFabric(mcVersion, loaderVersion) {
    try {
        if (!loaderVersion) {
            const loaders = await axios.get('https://meta.fabricmc.net/v2/versions/loader', { timeout: 10000 });
            loaderVersion = loaders.data.find(l => l.stable)?.version;
            if (!loaderVersion) throw new Error('No stable Fabric loader found');
        }

        const fabricUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
        const fabricManifest = await axios.get(fabricUrl, { timeout: 30000 });

        const versionId = `fabric-loader-${loaderVersion}-${mcVersion}`;
        const versionDir = path.join(VERSIONS_DIR, versionId);
        if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

        fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(fabricManifest.data, null, 2));

        if (fabricManifest.data.libraries) {
            for (const lib of fabricManifest.data.libraries) {
                const parts = lib.name.split(':');
                if (parts.length < 3) continue;
                const [group, artifact, version] = parts;
                const pathParts = group.replace(/\./g, '/').split('/');
                const libPath = path.join(LIBRARIES_DIR, ...pathParts, artifact, version, `${artifact}-${version}.jar`);

                if (!fs.existsSync(libPath) && lib.url) {
                    const url = `${lib.url}${pathParts.join('/')}/${artifact}/${version}/${artifact}-${version}.jar`;
                    try { await downloadFile(url, libPath); } catch (e) { console.warn(`Failed lib: ${lib.name}`); }
                }
            }
        }
        return true;
    } catch (error) {
        console.error('Fabric install error:', error);
        throw error;
    }
}

async function downloadVersionManifest(versionId) {
    const settings = loadSettingsSync();
    const manifestUrl = applyDownloadMirror(
        'https://launchermeta.mojang.com/mc/game/version_manifest.json',
        settings.downloadMirror
    );
    const manifest = await axios.get(manifestUrl, { timeout: 10000 });
    const versionInfo = manifest.data.versions.find(v => v.id === versionId);
    if (!versionInfo) throw new Error(`Версия ${versionId} не найдена`);

    const versionUrl = applyDownloadMirror(versionInfo.url, settings.downloadMirror);
    const versionData = await axios.get(versionUrl, { timeout: 30000 });
    const versionDir = path.join(VERSIONS_DIR, versionId);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

    fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(versionData.data, null, 2));
}

async function downloadClientJar(versionManifest, destPath) {
    const clientUrl = versionManifest.downloads?.client?.url;
    if (!clientUrl) throw new Error('URL клиента не найден');
    await downloadFile(clientUrl, destPath);
}

async function downloadLibraries(versionManifest, versionId) {
    const libraries = [];
    if (!versionManifest.libraries) return libraries;

    const totalLibs = versionManifest.libraries.length;
    let completed = 0;

    for (const lib of versionManifest.libraries) {
        if (launchProgress.cancelled) throw new Error('Launch cancelled');
        if (lib.rules && !checkRules(lib.rules)) continue;

        const artifact = lib.downloads?.artifact;
        if (artifact && artifact.url) {
            const libPath = path.join(LIBRARIES_DIR, artifact.path);
            if (!fs.existsSync(libPath)) {
                try {
                    await downloadFile(artifact.url, libPath);
                } catch (e) { 
                    console.warn(`Failed lib: ${lib.name}`); 
                    continue; 
                }
            }
            libraries.push(libPath);
        }

        const classifiers = lib.downloads?.classifiers;
        if (classifiers) {
            const nativeKey = getNativeKey();
            const native = classifiers[nativeKey];
            if (native && native.url) {
                const nativePath = path.join(LIBRARIES_DIR, native.path);
                if (!fs.existsSync(nativePath)) await downloadFile(native.url, nativePath);
            }
        }
        completed++;
        if (completed % 5 === 0) {
            const libPercent = (completed / totalLibs) * 40;
            sendProgress('libraries', `Загрузка библиотек... (${completed}/${totalLibs})`, 20 + libPercent);
        }
    }
    return libraries;
}

function getNativeKey() {
    const platform = os.platform();
    if (platform === 'win32') return 'natives-windows';
    if (platform === 'darwin') return 'natives-osx';
    return 'natives-linux';
}

function checkRules(rules) {
    let allowed = false;
    for (const rule of rules) {
        const action = rule.action === 'allow';
        if (rule.os) {
            const osName = os.platform();
            if (rule.os.name === 'windows' && osName === 'win32') allowed = action;
            else if (rule.os.name === 'osx' && osName === 'darwin') allowed = action;
            else if (rule.os.name === 'linux' && osName === 'linux') allowed = action;
        } else allowed = action;
    }
    return allowed;
}

async function downloadAssets(versionManifest) {
    const assetIndex = versionManifest.assetIndex;
    if (!assetIndex) return;

    const indexesDir = path.join(ASSETS_DIR, 'indexes');
    if (!fs.existsSync(indexesDir)) fs.mkdirSync(indexesDir, { recursive: true });

    const indexPath = path.join(indexesDir, `${assetIndex.id}.json`);
    if (!fs.existsSync(indexPath)) await downloadFile(assetIndex.url, indexPath);

    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const objectsDir = path.join(ASSETS_DIR, 'objects');
    const totalObjects = Object.keys(indexData.objects).length;
    let completed = 0;

    for (const [key, obj] of Object.entries(indexData.objects)) {
        if (launchProgress.cancelled) throw new Error('Launch cancelled');

        const hash = obj.hash;
        const hashPrefix = hash.substring(0, 2);
        const objPath = path.join(objectsDir, hashPrefix, hash);

        if (!fs.existsSync(objPath)) {
            const objDir = path.join(objectsDir, hashPrefix);
            if (!fs.existsSync(objDir)) fs.mkdirSync(objDir, { recursive: true });
            await downloadFile(`https://resources.download.minecraft.net/${hashPrefix}/${hash}`, objPath);
        }
        completed++;
        if (completed % 50 === 0) {
            const assetPercent = (completed / totalObjects) * 25;
            sendProgress('assets', `Загрузка ассетов... (${completed}/${totalObjects})`, 60 + assetPercent);
        }
    }
}

function extractNativeJarToFolder(nativeJarPath, extractDir, excludePatterns = []) {
    const zip = new AdmZip(nativeJarPath);
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryPath = entry.entryName.replace(/\\/g, '/');
        if (entryPath.startsWith('META-INF/')) continue;
        if (excludePatterns.some(ex => entryPath.includes(ex))) continue;

        const fileName = path.basename(entryPath);
        if (!fileName || !fileName.includes('.')) continue;

        const lower = fileName.toLowerCase();
        const isNativeFile = lower.endsWith('.dll') || lower.endsWith('.so') || lower.endsWith('.dylib') || lower.endsWith('.jnilib');
        if (!isNativeFile) continue;

        const outPath = path.join(extractDir, fileName);
        fs.writeFileSync(outPath, entry.getData());
    }
}

function getRequiredNativeLibraryName() {
    if (os.platform() === 'win32') return 'lwjgl.dll';
    if (os.platform() === 'darwin') return 'liblwjgl.dylib';
    return 'liblwjgl.so';
}

async function extractNatives(versionManifest, versionId) {
    const extractDir = path.join(NATIVES_DIR, versionId);

    if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    if (!versionManifest.libraries) return;

    let extractedCount = 0;

    for (const lib of versionManifest.libraries) {
        if (launchProgress.cancelled) throw new Error('Launch cancelled');
        if (lib.rules && !checkRules(lib.rules)) continue;

        let nativePath = null;
        let nativeUrl = null;

        if (isNativeLibraryEntry(lib)) {
            const classifier = getNativeClassifierFromLibraryName(lib.name);
            if (!matchesPlatformNative(classifier)) continue;
            nativePath = getNativeJarPath(lib);
            nativeUrl = lib.downloads?.artifact?.url || libraryArtifactUrl(lib);
        } else {
            const picked = pickNativeClassifier(lib.downloads?.classifiers);
            if (!picked) continue;
            nativePath = path.join(LIBRARIES_DIR, picked.artifact.path);
            nativeUrl = picked.artifact.url;
        }

        if (!nativePath) continue;

        if (!fs.existsSync(nativePath)) {
            if (!nativeUrl) continue;
            await downloadFile(nativeUrl, nativePath);
        }

        try {
            const exclude = lib.extract?.exclude || [];
            extractNativeJarToFolder(nativePath, extractDir, exclude);
            extractedCount++;
        } catch (e) {
            console.warn('Native extract error:', lib.name, e.message);
        }
    }

    console.log(`Extracted natives from ${extractedCount} jars to ${extractDir}`);

    const requiredNative = path.join(extractDir, getRequiredNativeLibraryName());
    if (!fs.existsSync(requiredNative)) {
        throw new Error(
            `Не удалось распаковать нативные библиотеки (${path.basename(requiredNative)}). ` +
            'Удалите папку .moonlauncher/minecraft/natives и запустите снова.'
        );
    }
}

function buildClasspath(libraries, versionJarPath) {
    const separator = os.platform() === 'win32' ? ';' : ':';
    const entries = versionJarPath ? [...libraries, versionJarPath] : [...libraries];
    return entries.join(separator);
}

function buildGameArgs(versionManifest, auth, profile, classpath, actualVersionId, settings) {
    const nativesPath = path.join(NATIVES_DIR, actualVersionId);
    const pkg = safeRequire('../../package.json') || { version: '1.0.0' };

    let jvmArgs = [
        '-cp', classpath,
        '-Djava.library.path=' + nativesPath,
        '-Dminecraft.launcher.brand=MoonLauncher',
        '-Dminecraft.launcher.version=' + (pkg.version || '1.0.0')
    ];

    if (versionManifest.arguments && versionManifest.arguments.jvm) {
        for (const arg of versionManifest.arguments.jvm) {
            if (typeof arg === 'string' && !arg.includes(' ')) {
                jvmArgs.push(arg);
            } else if (typeof arg === 'object' && arg.rules) {
                if (checkRules(arg.rules)) {
                    if (Array.isArray(arg.value)) {
                        jvmArgs.push(...arg.value);
                    } else {
                        jvmArgs.push(arg.value);
                    }
                }
            }
        }
    }

    if (settings.gameResolution && settings.gameResolution !== 'auto') {
        const [width, height] = settings.gameResolution.split('x');
        jvmArgs.push(`--width`, width, `--height`, height);
    }
    if (settings.fullscreen) {
        jvmArgs.push('--fullscreen');
    }

    const mainClass = versionManifest.mainClass || 'net.minecraft.client.main.Main';

    let gameArgs = [
        '--username', auth.username,
        '--version', actualVersionId,
        '--gameDir', profile.gameDir || MINECRAFT_DIR,
        '--assetsDir', ASSETS_DIR,
        '--assetIndex', versionManifest.assetIndex?.id || profile.versionId,
        '--uuid', auth.uuid,
        '--accessToken', auth.accessToken,
        '--userType', 'msa',
        '--versionType', 'release'
    ];

    if (versionManifest.arguments && versionManifest.arguments.game) {
        for (const arg of versionManifest.arguments.game) {
            if (typeof arg === 'string') {
                let resolved = arg
                    .replace('${auth_player_name}', auth.username)
                    .replace('${version_name}', actualVersionId)
                    .replace('${game_directory}', profile.gameDir || MINECRAFT_DIR)
                    .replace('${assets_root}', ASSETS_DIR)
                    .replace('${assets_index_name}', versionManifest.assetIndex?.id || profile.versionId)
                    .replace('${auth_uuid}', auth.uuid)
                    .replace('${auth_access_token}', auth.accessToken)
                    .replace('${user_type}', 'msa')
                    .replace('${version_type}', 'release');
                if (!resolved.includes('${')) {
                    gameArgs.push(resolved);
                }
            } else if (typeof arg === 'object' && arg.rules) {
                if (checkRules(arg.rules)) {
                    if (Array.isArray(arg.value)) {
                        gameArgs.push(...arg.value);
                    } else {
                        gameArgs.push(arg.value);
                    }
                }
            }
        }
    }

    return [...jvmArgs, mainClass, ...gameArgs];
}

async function downloadFile(url, dest, onProgress = null) {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const settings = loadSettingsSync();
    const speedLimitMB = settings.speedLimit || 0;
    const maxBytesPerSecond = speedLimitMB > 0 ? speedLimitMB * 1024 * 1024 : 0;
    const downloadUrl = applyDownloadMirror(url, settings.downloadMirror);

    const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 300000,
        onDownloadProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
                onProgress(progressEvent.loaded, progressEvent.total);
            }
        }
    });

    const writer = fs.createWriteStream(dest);
    let source = response.data;

    if (maxBytesPerSecond > 0) {
        let transferred = 0;
        let startTime = Date.now();
        source = response.data.pipe(new Transform({
            transform(chunk, encoding, callback) {
                transferred += chunk.length;
                const elapsed = (Date.now() - startTime) / 1000;
                const expectedTime = transferred / maxBytesPerSecond;
                const delay = Math.max(0, (expectedTime - elapsed) * 1000);
                if (delay > 0) {
                    setTimeout(() => callback(null, chunk), delay);
                } else {
                    callback(null, chunk);
                }
            }
        }));
    }

    source.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

// ==================== MODRINTH DOWNLOAD ====================
const MODRINTH_API_URL = 'https://api.modrinth.com/v2';

ipcMain.handle('download-modrinth', async (event, { projectId, versionId, type, profile }) => {
    try {
        const activeProfile = profile || { id: 'default', gameDir: MINECRAFT_DIR, loader: 'vanilla' };
        const versionResponse = await axios.get(`${MODRINTH_API_URL}/version/${versionId}`, { timeout: 30000 });
        const version = versionResponse.data;

        if (!versionMatchesProfile(version, activeProfile, type)) {
            const loader = activeProfile.loader || 'vanilla';
            return {
                success: false,
                error: loader !== 'vanilla'
                    ? `Версия не совместима с ${loader} для Minecraft ${activeProfile.versionId || ''}`.trim()
                    : `Версия не совместима с Minecraft ${activeProfile.versionId || ''}`.trim()
            };
        }

        if (!version.files || version.files.length === 0) {
            return { success: false, error: 'Нет доступных файлов' };
        }

        const primaryFile = version.files.find(f => f.primary) || version.files[0];

        const contentDirs = ensureProfileGameDirs(profile || { id: 'default', gameDir: MINECRAFT_DIR });
        let destDir;
        if (type === 'mod') destDir = contentDirs.mods;
        else if (type === 'shader') destDir = contentDirs.shaders;
        else if (type === 'resourcepack') destDir = contentDirs.resourcepacks;
        else destDir = contentDirs.mods;

        const destPath = safeJoin(destDir, primaryFile.filename);

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-status', {
                projectId, status: 'downloading', filename: primaryFile.filename
            });
        }

        await downloadFile(primaryFile.url, destPath);

        const projectResponse = await axios.get(`${MODRINTH_API_URL}/project/${projectId}`, { timeout: 15000 }).catch(() => null);
        addToModpackManifest(profile || { id: 'default', gameDir: MINECRAFT_DIR }, type, primaryFile.filename, {
            projectId,
            versionId,
            title: projectResponse?.data?.title || primaryFile.filename,
            iconUrl: projectResponse?.data?.icon_url || null,
            color: projectResponse?.data?.color ?? null,
            type
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-status', {
                projectId, status: 'completed', filename: primaryFile.filename, path: destPath
            });
        }

        return { success: true, path: destPath, filename: primaryFile.filename };
    } catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-status', {
                projectId, status: 'error', error: error.message
            });
        }
        return { success: false, error: error.message };
    }
});

// ==================== ФИРМЕННЫЕ МОДЫ (MaxFPS и т.д., раздаются с сайта, не с Modrinth) ====================
// mod здесь — это объект из api/mods/list.json (renderer его уже получил и передаёт как есть),
// а не Modrinth-версия, поэтому проверка совместимости своя: сравниваем loader/mcVersion профиля
// с тем, что заявлено для мода, вместо versionMatchesProfile (та рассчитана на формат Modrinth).
ipcMain.handle('download-featured-mod', async (event, { mod, profile }) => {
    try {
        if (!mod || !mod.downloadUrl || !mod.filename) {
            return { success: false, error: 'Некорректные данные мода' };
        }
        const activeProfile = profile || { id: 'default', gameDir: MINECRAFT_DIR, loader: 'vanilla' };
        const profileLoader = activeProfile.loader || 'vanilla';
        const profileVersion = activeProfile.versionId || '';
        const supported = Array.isArray(mod.supportedVersions) && mod.supportedVersions.length
            ? mod.supportedVersions
            : [mod.mcVersion].filter(Boolean);

        if (mod.loader && profileLoader !== mod.loader) {
            return { success: false, error: `Нужен профиль с загрузчиком ${mod.loader} (сейчас: ${profileLoader})` };
        }
        if (supported.length && !supported.includes(profileVersion)) {
            return { success: false, error: `${mod.name || 'Мод'} поддерживает только Minecraft ${supported.join(', ')} (сейчас в профиле: ${profileVersion || 'версия не выбрана'})` };
        }

        const contentDirs = ensureProfileGameDirs(activeProfile);
        const destPath = safeJoin(contentDirs.mods, mod.filename);
        const downloadUrl = /^https?:\/\//i.test(mod.downloadUrl) ? mod.downloadUrl : `${MOONLAUNCHER_SITE}${mod.downloadUrl}`;

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-status', { projectId: `featured:${mod.id}`, status: 'downloading', filename: mod.filename });
        }

        await downloadFile(downloadUrl, destPath);

        addToModpackManifest(activeProfile, 'mod', mod.filename, {
            projectId: `featured:${mod.id}`,
            versionId: mod.version || 'featured',
            title: mod.name || mod.filename,
            iconUrl: mod.icon || mod.iconUrl || null,
            type: 'mod'
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-status', { projectId: `featured:${mod.id}`, status: 'completed', filename: mod.filename, path: destPath });
        }

        return { success: true, path: destPath, filename: mod.filename };
    } catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-status', { projectId: `featured:${mod?.id}`, status: 'error', error: error.message });
        }
        return { success: false, error: error.message };
    }
});

// ==================== MODPACK SHARE / IMPORT ====================
ipcMain.handle('generate-modpack-code', async (event, { profile }) => {
    try {
        if (!profile) {
            return { success: false, error: 'Профиль не выбран' };
        }

        const contentDirs = ensureProfileGameDirs(profile);
        const manifest = loadModpackManifest(profile);
        const modsDir = fs.readdirSync(contentDirs.mods).filter(f => f.endsWith('.jar'));
        const items = [];

        for (const filename of modsDir) {
            const meta = manifest.mods[filename];
            if (meta?.projectId && meta?.versionId) {
                items.push({
                    projectId: meta.projectId,
                    versionId: meta.versionId,
                    type: 'mod',
                    title: meta.title || filename
                });
            }
        }

        if (items.length === 0) {
            return {
                success: false,
                error: 'Нет модов с данными Modrinth. Установите моды через лаунчер (кнопка «Установить»), затем создайте код.'
            };
        }

        const pack = {
            id: `pack_${Date.now()}`,
            name: profile.name ? `Сборка: ${profile.name}` : 'MoonLauncher Pack',
            versionId: profile.versionId,
            loader: profile.loader || 'vanilla',
            loaderVersion: profile.loaderVersion || '',
            createdAt: Date.now(),
            items
        };

        const upload = await uploadModpackToServer(pack);
        const displayCode = upload.source === 'server' && !upload.code.startsWith('ML1.')
            ? (upload.code.startsWith('MOON-') ? upload.code : `MOON-${upload.code}`)
            : upload.code;

        return {
            success: true,
            code: displayCode,
            source: upload.source,
            serverError: upload.serverError || null,
            modCount: items.length,
            pack
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('import-modpack-code', async (event, { code, profile }) => {
    try {
        if (!code || !code.trim()) {
            return { success: false, error: 'Введите код сборки' };
        }

        const { pack, source } = await resolveModpackFromCode(code);
        const items = pack.items || pack.mods || [];

        if (!items.length) {
            return { success: false, error: 'Сборка пуста' };
        }

        if (!profile) {
            return { success: false, error: 'Профиль не выбран' };
        }

        const contentDirs = ensureProfileGameDirs(profile);
        const targetVersion = profile.versionId || pack.versionId;
        let installed = 0;
        let failed = 0;
        const total = items.length;

        sendModpackProgress({
            stage: 'start',
            message: source === 'server' ? 'Загрузка сборки с сервера...' : 'Расшифровка кода...',
            percent: 0,
            total,
            completed: 0
        });

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemType = item.type || 'mod';
            const title = item.title || item.projectId;

            sendModpackProgress({
                stage: 'downloading',
                message: `Загрузка: ${title}`,
                percent: Math.round((i / total) * 100),
                total,
                completed: i,
                current: title
            });

            try {
                let versionId = item.versionId;

                if (!versionId) {
                    const versions = await axios.get(
                        `${MODRINTH_API_URL}/project/${item.projectId}/version`,
                        { timeout: 30000 }
                    );
                    const compatible = findCompatibleModrinthVersion(versions.data, profile, itemType);
                    if (!compatible) {
                        failed++;
                        continue;
                    }
                    versionId = compatible.id;
                }

                const versionResponse = await axios.get(`${MODRINTH_API_URL}/version/${versionId}`, { timeout: 30000 });
                const version = versionResponse.data;
                if (!versionMatchesProfile(version, profile, itemType)) {
                    failed++;
                    continue;
                }
                const primaryFile = version.files?.find(f => f.primary) || version.files?.[0];

                if (!primaryFile?.url) {
                    failed++;
                    continue;
                }

                let destDir = contentDirs.mods;
                if (itemType === 'shader') destDir = contentDirs.shaders;
                else if (itemType === 'resourcepack') destDir = contentDirs.resourcepacks;

                const destPath = safeJoin(destDir, primaryFile.filename);
                await downloadFile(primaryFile.url, destPath);

                addToModpackManifest(profile, itemType, primaryFile.filename, {
                    projectId: item.projectId,
                    versionId,
                    title: item.title || primaryFile.filename,
                    iconUrl: item.icon_url || item.iconUrl || null,
                    type: itemType
                });

                installed++;
            } catch (e) {
                console.warn('Modpack item failed:', item.projectId, e.message);
                failed++;
            }
        }

        sendModpackProgress({
            stage: 'done',
            message: `Готово: ${installed} из ${total}`,
            percent: 100,
            total,
            completed: total,
            installed,
            failed
        });

        return {
            success: true,
            installed,
            failed,
            total,
            packVersion: pack.versionId,
            packLoader: pack.loader,
            source
        };
    } catch (error) {
        sendModpackProgress({ stage: 'error', message: error.message, percent: 0 });
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-modpack-info', async (event, { code }) => {
    try {
        const { pack, source } = await resolveModpackFromCode(code);
        const items = pack.items || pack.mods || [];
        return {
            success: true,
            source,
            name: pack.name,
            versionId: pack.versionId,
            loader: pack.loader,
            modCount: items.length
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-profile-folder', async (event, { type, profile }) => {
    try {
        const activeProfile = profile || { id: 'default', gameDir: MINECRAFT_DIR };
        const dirs = ensureProfileGameDirs(activeProfile);
        const folderMap = {
            mods: dirs.mods,
            shaders: dirs.shaders,
            resourcepacks: dirs.resourcepacks,
            profiles: PROFILES_DIR
        };
        const target = folderMap[type] || dirs.mods;
        if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
        await shell.openPath(target);
        return { success: true, path: target };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== SERVER PING ====================
ipcMain.handle('ping-server', async (event, { ip, port = 25565 }) => {
    try {
        // @minescope/mineping — ESM-only модуль (require() его вообще не может
        // загрузить) и экспортирует pingJava/pingBedrock, а не ping. Из-за этого
        // `const { ping } = require(...)` всегда давал undefined, вызов ping(...)
        // падал с TypeError, попадал в catch — и на клиенте ЛЮБОЙ сервер, даже
        // реально работающий, показывался как "Оффлайн". pingJava также принимает
        // порт через options, а не третьим позиционным аргументом.
        const { pingJava } = await import('@minescope/mineping');
        const result = await pingJava(ip, { port, timeout: 5000 });
        return {
            success: true,
            online: result.players?.online ?? 0,
            max: result.players?.max ?? 0,
            version: result.version?.name || 'Unknown',
            description: (typeof result.description === 'string' ? result.description : result.description?.text) || ''
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ==================== WINDOW CONTROLS ====================
ipcMain.handle('window-close', () => { 
    const settings = loadSettingsSync();
    if (settings.minimizeToTray !== false && mainWindow) {
        mainWindow.hide();
    } else {
        isQuiting = true;
        if (mainWindow) mainWindow.close();
    }
});
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    }
});
ipcMain.handle('open-external', (event, url) => { shell.openExternal(url); });

// ==================== FILE OPERATIONS ====================
async function getInstalledItemsDetailedAsync(profile, type) {
    const contentDirs = await ensureProfileGameDirsAsync(profile || { id: 'default', gameDir: MINECRAFT_DIR });
    const manifest = await loadModpackManifestAsync(profile);
    const key = type === 'mod' ? 'mods' : type === 'shader' ? 'shaders' : 'resourcepacks';
    const dir = type === 'mod' ? contentDirs.mods : type === 'shader' ? contentDirs.shaders : contentDirs.resourcepacks;
    const ext = type === 'mod' ? '.jar' : '.zip';
    let files;
    try {
        // readdir (промис) вместо readdirSync: раньше это блокировало ВЕСЬ
        // главный процесс Electron на время чтения директории с диска, а
        // селект профиля дёргает эту функцию 3 раза подряд (mods/shaders/
        // resourcepacks) + ещё раз при открытии вкладки каталога — на
        // медленном диске/антивирусе это ощущалось как подтормаживание
        // сразу везде в интерфейсе лаунчера, а не только в одном списке.
        files = (await fsPromises.readdir(dir)).filter(f => f.endsWith(ext));
    } catch (e) {
        return [];
    }
    return files.map(filename => ({
        filename,
        projectId: manifest[key][filename]?.projectId || null,
        title: manifest[key][filename]?.title || filename.replace(ext, ''),
        versionId: manifest[key][filename]?.versionId || null,
        type
    }));
}

function removeFromModpackManifest(profile, type, filename) {
    const manifest = loadModpackManifest(profile);
    const key = type === 'mod' ? 'mods' : type === 'shader' ? 'shaders' : 'resourcepacks';
    if (manifest[key][filename]) {
        delete manifest[key][filename];
        saveModpackManifest(profile, manifest);
    }
}

function getOptionsPath(gameDir) {
    return path.join(gameDir || MINECRAFT_DIR, 'options.txt');
}

function readActiveResourcePacks(gameDir) {
    const optionsPath = getOptionsPath(gameDir);
    if (!fs.existsSync(optionsPath)) return [];
    const content = fs.readFileSync(optionsPath, 'utf8');
    const line = content.split('\n').find(l => l.startsWith('resourcePacks:'));
    if (!line) return [];
    try {
        const packs = JSON.parse(line.slice('resourcePacks:'.length));
        return packs.filter(p => typeof p === 'string' && p.startsWith('file/'))
            .map(p => decodeURIComponent(p.replace('file/', '')));
    } catch (e) {
        return [];
    }
}

function writeActiveResourcePacks(gameDir, activeFilenames) {
    const optionsPath = getOptionsPath(gameDir);
    let lines = [];
    if (fs.existsSync(optionsPath)) {
        lines = fs.readFileSync(optionsPath, 'utf8').split('\n');
    }
    const packEntries = ['"vanilla"', ...activeFilenames.map(f => `"file/${f}"`)];
    const newLine = `resourcePacks:[${packEntries.join(',')}]`;
    const idx = lines.findIndex(l => l.startsWith('resourcePacks:'));
    if (idx >= 0) lines[idx] = newLine;
    else lines.push(newLine);
    if (!fs.existsSync(path.dirname(optionsPath))) {
        fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
    }
    fs.writeFileSync(optionsPath, lines.join('\n'));
}

function updateOptionsTxtKeys(gameDir, kv) {
    const optionsPath = getOptionsPath(gameDir);
    let lines = [];
    if (fs.existsSync(optionsPath)) {
        lines = fs.readFileSync(optionsPath, 'utf8').split('\n').filter(l => l.length > 0);
    }
    for (const key of Object.keys(kv)) {
        const newLine = `${key}:${kv[key]}`;
        const idx = lines.findIndex(l => l.startsWith(`${key}:`));
        if (idx >= 0) lines[idx] = newLine;
        else lines.push(newLine);
    }
    if (!fs.existsSync(path.dirname(optionsPath))) {
        fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
    }
    fs.writeFileSync(optionsPath, lines.join('\n') + '\n');
}

// Пишет реальные видеонастройки Minecraft в options.txt профиля перед запуском,
// в соответствии с выбранным пресетом производительности. Раньше пресет вообще
// не трогал графику игры — только JVM-флаги, часть из которых была плацебо
// (см. комментарий у PERFORMANCE_VIDEO_PRESETS выше). Это и есть то, что реально
// поднимает FPS на слабом железе (например, i5-2500 + GTX 1050 Ti), а не подбор
// экспериментальных флагов сборщика мусора.
function applyGamePerformanceOptions(gameDir, settings) {
    try {
        const kv = buildPerformanceVideoOptions(settings);
        updateOptionsTxtKeys(gameDir, kv);
    } catch (e) {
        console.error('applyGamePerformanceOptions error:', e);
    }
}

ipcMain.handle('get-installed-items', async (event, { type, profile }) => {
    try {
        return { success: true, items: await getInstalledItemsDetailedAsync(profile, type) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Раньше renderer (loadInstalledItems в app.js) делал 4 ПОСЛЕДОВАТЕЛЬНЫХ IPC-вызова
// подряд при каждом переключении профиля (mod/shader/resourcepack + active packs) —
// каждый со своим синхронным fs внутри (см. комментарий у ensureProfileGameDirsAsync).
// Один батч-хендлер: директории/манифест читаются один раз, все три списка — параллельно.
ipcMain.handle('get-installed-items-all', async (event, { profile }) => {
    try {
        const activeProfile = profile || { id: 'default', gameDir: MINECRAFT_DIR };
        const contentDirs = await ensureProfileGameDirsAsync(activeProfile);
        const manifest = await loadModpackManifestAsync(activeProfile);

        const readType = async (type) => {
            const key = type === 'mod' ? 'mods' : type === 'shader' ? 'shaders' : 'resourcepacks';
            const dir = type === 'mod' ? contentDirs.mods : type === 'shader' ? contentDirs.shaders : contentDirs.resourcepacks;
            const ext = type === 'mod' ? '.jar' : '.zip';
            let files;
            try {
                files = (await fsPromises.readdir(dir)).filter((f) => f.endsWith(ext));
            } catch (e) {
                return [];
            }
            return files.map((filename) => ({
                filename,
                projectId: manifest[key][filename]?.projectId || null,
                title: manifest[key][filename]?.title || filename.replace(ext, ''),
                versionId: manifest[key][filename]?.versionId || null,
                iconUrl: manifest[key][filename]?.iconUrl || null,
                color: manifest[key][filename]?.color ?? null,
                type
            }));
        };

        const [mod, shader, resourcepack, activeResourcePacks] = await Promise.all([
            readType('mod'),
            readType('shader'),
            readType('resourcepack'),
            readActiveResourcePacksAsync(activeProfile.gameDir || contentDirs.gameDir)
        ]);

        return { success: true, items: { mod, shader, resourcepack }, activeResourcePacks };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('uninstall-modrinth-item', async (event, { filename, type, profile }) => {
    try {
        const contentDirs = ensureProfileGameDirs(profile || { id: 'default', gameDir: MINECRAFT_DIR });
        const dir = type === 'mod' ? contentDirs.mods : type === 'shader' ? contentDirs.shaders : contentDirs.resourcepacks;
        const filePath = safeJoin(dir, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        removeFromModpackManifest(profile || { id: 'default', gameDir: MINECRAFT_DIR }, type, filename);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-active-resourcepacks', async (event, { gameDir }) => {
    try {
        return { success: true, packs: readActiveResourcePacks(gameDir) };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('toggle-resourcepack', async (event, { filename, active, gameDir }) => {
    try {
        const dir = gameDir || MINECRAFT_DIR;
        let activePacks = readActiveResourcePacks(dir);
        if (active) {
            if (!activePacks.includes(filename)) activePacks.push(filename);
        } else {
            activePacks = activePacks.filter(p => p !== filename);
        }
        writeActiveResourcePacks(dir, activePacks);
        return { success: true, packs: activePacks };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-installed-mods', async () => {
    try {
        const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar'));
        return { success: true, mods: files };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-installed-shaders', async () => {
    try {
        const files = fs.readdirSync(SHADERS_DIR).filter(f => f.endsWith('.zip'));
        return { success: true, shaders: files };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-installed-resourcepacks', async () => {
    try {
        const files = fs.readdirSync(RESOURCEPACKS_DIR).filter(f => f.endsWith('.zip'));
        return { success: true, resourcepacks: files };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-launch-logs', async () => {
    try {
        const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log')).sort().reverse();
        return { success: true, logs: files };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('read-log', async (event, filename) => {
    try {
        const content = fs.readFileSync(safeJoin(LOGS_DIR, filename), 'utf8');
        return { success: true, content };
    } catch (error) { return { success: false, error: error.message }; }
});

// File/folder dialogs
ipcMain.handle('browse-file', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        ...options,
        properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
});

// Сохранение файла, присланного другом в чате (вкладка "Друзья")
ipcMain.handle('save-friend-file', async (event, { defaultName, dataBase64 }) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName || 'file',
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        fs.writeFileSync(result.filePath, Buffer.from(dataBase64, 'base64'));
        return { success: true, filePath: result.filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('browse-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});

// ==================== NOTIFICATIONS ====================
ipcMain.handle('show-notification', (event, { title, body }) => {
    if (Notification.isSupported()) {
        new Notification({ title, body }).show();
    }
});

// ==================== CRASH REPORTS ====================
ipcMain.handle('get-crash-reports', async (event, { profile } = {}) => {
    try {
        const gameDir = getProfileGameDir(profile || { id: 'default' });
        const crashDir = path.join(gameDir, 'crash-reports');
        if (!fs.existsSync(crashDir)) return { success: true, reports: [] };
        const files = fs.readdirSync(crashDir).filter(f => f.endsWith('.txt')).sort().reverse().slice(0, 20);
        return { success: true, reports: files };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('read-crash-report', async (event, { filename, profile } = {}) => {
    try {
        const gameDir = getProfileGameDir(profile || { id: 'default' });
        const content = fs.readFileSync(safeJoin(gameDir, 'crash-reports', filename), 'utf8');
        return { success: true, content };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('get-app-version', async () => {
    const pkg = safeRequire('../../package.json') || safeRequire('../package.json') || { version: '1.0.0' };
    return { success: true, version: pkg.version || '1.0.0' };
});

// ==================== SYSTEM INFO ====================
ipcMain.handle('get-system-info', async () => {
    return {
        success: true,
        totalMemory: Math.floor(os.totalmem() / 1024 / 1024),
        freeMemory: Math.floor(os.freemem() / 1024 / 1024),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length
    };
});