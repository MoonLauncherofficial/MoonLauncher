/**
 * javaManager.js — автоматическая загрузка нужной версии Java (Eclipse Temurin JRE)
 * под конкретную версию Minecraft, если подходящая Java не найдена на диске.
 *
 * Раньше: если findJava() в main.js не находил Java — лаунчер просто падал с
 * ошибкой "Java не найдена. Установите Java 17+...", и пользователь должен был
 * сам скачивать/ставить JDK. Для обычного игрока это отваливающийся шаг —
 * большинство даже не знают, что такое Java.
 *
 * Теперь: если Java не найдена, лаунчер сам качает нужный Temurin JRE с Adoptium
 * (официальный билд OpenJDK) в userData/java/<major>/ и использует его — без
 * участия пользователя, аналогично тому, как это делает официальный Minecraft
 * Launcher.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');

/** Какой major Java нужен под версию Minecraft. */
function requiredJavaMajor(mcVersionId) {
    // mcVersionId может быть вида "1.20.4" или "1.21" — берём числовую часть.
    const parts = String(mcVersionId).split('.').map(n => parseInt(n, 10));
    const major = parts[0];
    const minor = parts[1] || 0;
    if (major === 1) {
        if (minor >= 20) return 21; // 1.20.5+/1.21+ требуют Java 21
        if (minor >= 18) return 17; // 1.18–1.20.4 — Java 17
        if (minor >= 17) return 17; // 1.17.x — Java 16/17, берём 17 (совместимо)
        return 8;                   // до 1.16.x — Java 8
    }
    return 21;
}

function platformParams() {
    const p = os.platform();
    const archRaw = os.arch();
    const arch = archRaw === 'arm64' ? 'aarch64' : (archRaw === 'ia32' ? 'x86-32' : 'x64');
    const osName = p === 'win32' ? 'windows' : (p === 'darwin' ? 'mac' : 'linux');
    return { osName, arch };
}

function javaExePath(javaRoot, major) {
    const { osName } = platformParams();
    const root = path.join(javaRoot, String(major));
    if (!fs.existsSync(root)) return null;
    let entries;
    try {
        entries = fs.readdirSync(root).filter(f => {
            try { return fs.statSync(path.join(root, f)).isDirectory(); } catch (e) { return false; }
        });
    } catch (e) {
        return null;
    }
    // Adoptium распаковывается в одну вложенную папку вида jdk-17.0.x+y-jre
    const inner = entries.find(f => f.toLowerCase().includes('jdk') || f.toLowerCase().includes('jre')) || entries[0];
    if (!inner) return null;
    const bin = osName === 'mac'
        ? path.join(root, inner, 'Contents', 'Home', 'bin')
        : path.join(root, inner, 'bin');
    const exe = path.join(bin, osName === 'windows' ? 'java.exe' : 'java');
    return fs.existsSync(exe) ? exe : null;
}

/**
 * SECURITY: защита от path traversal ("tar-slip"/"zip-slip") — имя записи
 * в архиве в принципе может содержать "../", и без проверки распаковка могла
 * бы записать файл куда угодно на диске (за пределами предназначенной для
 * Java папки). Источник архива сейчас — официальный api.adoptium.net по
 * HTTPS, так что практический риск невелик, но парсер здесь свой (не
 * библиотечный), поэтому проверяем явно, а не полагаемся на доверие к
 * источнику.
 */
function safeJoin(destDir, entryName) {
    const resolvedDest = path.resolve(destDir);
    const target = path.resolve(resolvedDest, entryName);
    if (target !== resolvedDest && !target.startsWith(resolvedDest + path.sep)) {
        throw new Error(`Небезопасный путь в архиве: ${entryName}`);
    }
    return target;
}

/**
 * Простая распаковка .tar.gz без зависимости от внешнего бинаря `tar` —
 * реализована через встроенный zlib (gunzip) + минимальный tar-парсер,
 * чтобы не тянуть в проект нативные модули с бинарными сборками под каждую ОС.
 */
async function extractTarGz(archivePath, destDir) {
    const zlib = require('zlib');
    const gz = fs.readFileSync(archivePath);
    const tarBuf = zlib.gunzipSync(gz);

    let offset = 0;
    while (offset + 512 <= tarBuf.length) {
        const header = tarBuf.subarray(offset, offset + 512);
        // Пустой блок — конец архива
        if (header.every(b => b === 0)) break;

        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
        const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
        const size = parseInt(sizeOctal, 8) || 0;
        const typeFlag = String.fromCharCode(header[156]);
        // GNU long-name extension
        let entryName = name;
        let dataStart = offset + 512;

        if (typeFlag === 'L') {
            // Следующий блок(и) содержат длинное имя, затем реальный заголовок
            const longName = tarBuf.subarray(dataStart, dataStart + size).toString('utf8').replace(/\0.*$/, '');
            const nextOffset = dataStart + Math.ceil(size / 512) * 512;
            const nextHeader = tarBuf.subarray(nextOffset, nextOffset + 512);
            const nextSizeOctal = nextHeader.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
            const nextSize = parseInt(nextSizeOctal, 8) || 0;
            const nextType = String.fromCharCode(nextHeader[156]);
            const outPath = safeJoin(destDir, longName);
            if (nextType === '5') {
                fs.mkdirSync(outPath, { recursive: true });
            } else {
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                const fileData = tarBuf.subarray(nextOffset + 512, nextOffset + 512 + nextSize);
                fs.writeFileSync(outPath, fileData);
                if (nextType === '2') { /* symlink — пропускаем на этом уровне поддержки */ }
                try { fs.chmodSync(outPath, 0o755); } catch (e) {}
            }
            offset = nextOffset + 512 + Math.ceil(nextSize / 512) * 512;
            continue;
        }

        if (entryName) {
            const outPath = safeJoin(destDir, entryName);
            if (typeFlag === '5' || entryName.endsWith('/')) {
                fs.mkdirSync(outPath, { recursive: true });
            } else if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                const fileData = tarBuf.subarray(dataStart, dataStart + size);
                fs.writeFileSync(outPath, fileData);
                try { fs.chmodSync(outPath, 0o755); } catch (e) {}
            }
        }

        offset = dataStart + Math.ceil(size / 512) * 512;
    }
}

/** Скачивает и распаковывает Temurin JRE нужного major в javaRoot, если ещё не установлен. */
async function ensureJava(javaRoot, major, onProgress) {
    const existing = javaExePath(javaRoot, major);
    if (existing) return existing;

    const { osName, arch } = platformParams();
    const apiUrl = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${osName}&vendor=eclipse`;

    if (onProgress) onProgress(0, 'Поиск подходящей Java...');
    const { data } = await axios.get(apiUrl, { timeout: 15000 });
    if (!data || !data.length) {
        throw new Error(`Не найдена Java ${major} для ${osName}/${arch}. Установите Java вручную.`);
    }

    const binary = data[0].binary;
    const downloadUrl = binary.package.link;
    const archiveName = binary.package.name;
    const destDir = path.join(javaRoot, String(major));
    fs.mkdirSync(destDir, { recursive: true });
    const archivePath = path.join(destDir, archiveName);

    if (onProgress) onProgress(0, `Загрузка Java ${major}...`);
    const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 0,
        onDownloadProgress: (evt) => {
            if (onProgress && evt.total) {
                onProgress(Math.round((evt.loaded / evt.total) * 100), `Загрузка Java ${major}...`);
            }
        }
    });

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(archivePath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });

    if (onProgress) onProgress(100, `Распаковка Java ${major}...`);

    if (archiveName.endsWith('.zip')) {
        const zip = new AdmZip(archivePath);
        // SECURITY: та же проверка на path traversal, что и для tar.gz выше —
        // не полагаемся только на защиту внутри adm-zip.
        for (const entry of zip.getEntries()) {
            safeJoin(destDir, entry.entryName);
        }
        zip.extractAllTo(destDir, true);
    } else {
        await extractTarGz(archivePath, destDir);
    }

    try { fs.unlinkSync(archivePath); } catch (e) {}

    const exe = javaExePath(javaRoot, major);
    if (!exe) throw new Error('Java распакована, но исполняемый файл не найден.');
    return exe;
}

/** По версии Minecraft вернуть путь к java, скачав/распаковав её при необходимости. */
async function getJavaFor(javaRoot, mcVersionId, onProgress) {
    const major = requiredJavaMajor(mcVersionId);
    return ensureJava(javaRoot, major, onProgress);
}

module.exports = { requiredJavaMajor, getJavaFor, ensureJava, javaExePath };
