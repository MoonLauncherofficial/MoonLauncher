const { ipcRenderer } = require('electron');

// ==================== ПРЕДУПРЕЖДЕНИЕ В КОНСОЛИ (Ctrl+Shift+I) ====================
// Стандартная защита от self-XSS/скам-схем "открой консоль и вставь этот код,
// чтобы получить ...": мошенники присылают пользователям лаунчера код и просят
// вставить его в DevTools, из-за чего получают доступ к токену авторизации,
// localStorage и т.п. Само по себе окно консоли открыть с клавиатуры нельзя
// запретить (это часть Chromium/Electron), поэтому просто печатаем крупное
// предупреждение, которое будет видно, как только консоль откроется.
(function warnAboutConsolePasting() {
    console.log(
        '%cSTOP!',
        'color:#ff4444; font-size:60px; font-weight:800; text-shadow: 2px 2px 0 #000;'
    );
    console.log(
        '%cЭто консоль для разработчиков. Если кто-то попросил вас скопировать и вставить сюда какой-то код — это мошенничество, оно может дать доступ к вашему аккаунту MoonLauncher или к файлам на компьютере. НИКОГДА не вставляйте сюда код, который вам прислали и который вы не понимаете.',
        'color:#fff; background:#1a1023; font-size:16px; padding:6px 10px; border-radius:4px;'
    );
    console.log(
        '%cЕсли вас сюда направила служба поддержки MoonLauncher или её нет — прекратите и напишите в официальный Discord.',
        'color:#aaa; font-size:12px;'
    );
})();

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MOONLAUNCHER_API = 'https://moonlauncher.ru/api';
const GITHUB_REPO = 'https://github.com/MoonLauncherofficial/MoonLauncher';
const DISCORD_INVITE = 'https://discord.gg/pqtJZ5GFkk';

// ==================== I18N ====================
const translations = {
    ru: {
        nav_home: 'Главная', nav_mods: 'Моды', nav_shaders: 'Шейдеры', nav_resourcepacks: 'Ресурс паки',
        nav_instances: 'Инстансы', nav_servers: 'Серверы', nav_settings: 'Настройки',
        active_instance: 'Активный инстанс', manage_instances: 'Управление инстансами',
        featured_servers: 'Рекомендуемые серверы', view_all: 'Все', join_server: 'Играть',
        memory_quick: 'Память', performance_preset: 'Производительность',
        perf_balanced: 'Сбалансировано', perf_max_fps: 'Макс. FPS', perf_quality: 'Качество',
        stat_mods: 'Моды', stat_last_played: 'Последний запуск', stat_playtime: 'Время в игре',
        settings_performance: 'Производительность', game_optimizations: 'Оптимизации игры',
        opt_chunk_loading: 'Быстрая графика (fast graphics, mipmap 0, без облаков)',
        opt_entity_culling: 'Без теней сущностей и с минимумом частиц',
        opt_vbo: 'Отключить VSync (снимает лимит FPS)',
        perf_hint: 'Пресет реально меняет видеонастройки Minecraft (options.txt) и память/GC при запуске — рендер, тени, частицы, VSync, а не только флаги Java.',
        maxfps_mod_hint: 'Для доп. прироста FPS есть отдельный клиентский мод EntityOpt (обрезает рендер дальних сущностей). Он собирается под твой ПК из исходников, ставится только тебе — не нужен на сервере и не мешает заходить на чужие сервера без него.',
        minecraft_instances: 'Инстансы Minecraft', new_instance: 'Новый инстанс', instance_name: 'Название инстанса',
        duplicate_instance: 'Дублировать', quilt: 'Quilt', quick_connect_set: 'Быстрый вход на сервер',
        welcome_to: 'Добро пожаловать,', welcome_desc: 'Твой портал в мир игры',
        account: 'Аккаунт', selected_profile: 'Выбранный профиль', manage_profiles: 'Управление профилями',
        play: 'Играть', close_game: 'Закрыть', launching: 'Запуск...',
        launch_error: 'Ошибка запуска', error_code: 'Код ошибки',
        game_closed: 'Minecraft закрыт', mods: 'Моды', mods_desc: 'Установи моды для игры',
        shaders: 'Шейдеры', shaders_desc: 'Улучши графику игры',
        resourcepacks: 'Ресурс паки', resourcepacks_desc: 'Измени текстуры и звуки',
        profiles: 'Профили', profiles_desc: 'Управляй версиями Minecraft',
        status_offline: 'Оффлайн', status_microsoft: 'Microsoft', status_online: 'В сети', status_checking: 'Проверка…',
        login_microsoft: 'Войти через Microsoft', logout: 'Выйти',
        all_mods: 'Все моды', installed: 'Установленные', all_shaders: 'Все шейдеры',
        all_packs: 'Все паки', active: 'Активные', open_mods_folder: 'Открыть папку модов',
        open_shaders_folder: 'Открыть папку шейдеров', open_resourcepacks_folder: 'Открыть папку ресурспаков',
        minecraft_profiles: 'Профили Minecraft', new_profile: 'Новый профиль',
        profile_name: 'Название профиля', minecraft_version: 'Версия Minecraft',
        loader: 'Загрузчик', vanilla: 'Vanilla (без модов)', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge',
        loader_version: 'Версия загрузчика', latest: 'Последняя', cancel: 'Отмена', create: 'Создать',
        select_version: 'Выберите версию...', all_versions: 'Все версии',
        sort_popular: 'По популярности', sort_downloads: 'По загрузкам', sort_newest: 'Новые',
        minecraft_news: 'Новости Minecraft', servers: 'Серверы', all_servers: 'Все серверы',
        favorites: 'Избранные', all: 'Все', survival: 'Выживание', minigames: 'Мини-игры',
        anarchy: 'Анархия', mmorpg: 'MMORPG', settings: 'Настройки',
        settings_general: 'Общие', settings_java: 'Java', settings_game: 'Игра',
        settings_appearance: 'Внешний вид', settings_launcher: 'Лаунчер',
        settings_diagnostics: 'Диагностика', settings_about: 'О программе',
        language_region: 'Язык и регион', launcher_language: 'Язык лаунчера',
        startup: 'Запуск', auto_start: 'Запускать при старте системы',
        minimize_to_tray: 'Сворачивать в трей при закрытии',
        minimize_on_launch: 'Сворачивать лаунчер при запуске игры',
        java_path: 'Путь к Java', use_system_java: 'Использовать системную Java',
        custom_java_path: 'Путь к исполняемому файлу Java (java.exe)',
        browse: 'Обзор', jvm_args: 'Аргументы JVM', java_args_label: 'Аргументы запуска Java',
        auto_memory: 'Выделить память автоматически', memory_mb: 'Выделить памяти (МБ)',
        resolution: 'Разрешение', window_resolution: 'Разрешение окна',
        auto_current: 'Авто (текущее)', fullscreen: 'Запускать в полноэкранном режиме',
        game_folder: 'Папка игры', minecraft_folder: 'Папка Minecraft',
        theme: 'Тема', launcher_theme: 'Тема лаунчера', dark: 'Тёмная', light: 'Светлая', system: 'Системная',
        effects: 'Эффекты', transparency: 'Прозрачность интерфейса', animations: 'Анимации интерфейса',
        blur: 'Размытие фона', updates: 'Обновления', check_updates: 'Проверять обновления',
        home_background: 'Задний фон главного меню',
        home_background_label: 'Своё изображение фона',
        choose_image: 'Выбрать изображение', change_image: 'Заменить', reset: 'Сбросить',
        home_background_dim: 'Затемнение фона',
        home_background_set: 'Фон установлен', home_background_removed: 'Фон убран',
        home_background_error: 'Не удалось установить фон',
        on_startup: 'При запуске', daily: 'Ежедневно', weekly: 'Еженедельно', never: 'Никогда',
        update_channel: 'Канал обновлений', stable: 'Стабильный', beta: 'Бета', dev: 'Разработка',
        check_updates_now: 'Проверка обновлений', check_updates_now_btn: 'Проверить сейчас',
        updates_auto_hint: 'Обновления проверяются автоматически при каждом запуске лаунчера.',
        startup_checking_updates: 'Проверка обновлений...',
        network: 'Сеть', download_mirror: 'Зеркало загрузок', speed_limit: 'Ограничение скорости загрузки',
        no_limit: 'Без ограничения', additional: 'Дополнительно', save_logs: 'Сохранять логи запуска',
        debug_mode: 'Отладочный режим', crash_reports: 'Краш-репорты', last_20_crashes: 'Последние 20 краш-репортов Minecraft',
        no_crashes: 'Нет краш-репортов', launch_logs: 'Логи запуска', moonlauncher_logs: 'Логи запусков через MoonLauncher',
        no_logs: 'Нет логов', about_desc: 'Современный лаунчер для Minecraft с поддержкой модов, шейдеров и ресурспаков.',
        website: 'Сайт', created_with_love: 'Создано с ❤️ командой MoonLauncher',
        auth_subtitle: 'Твой портал в мир игры', launching_minecraft: 'Запуск Minecraft',
        update_available: 'Доступно обновление!', later: 'Позже', download: 'Скачать',
        error_auth: 'Ошибка авторизации', error_select_version: 'Выберите профиль и версию Minecraft',
        profile_selected: 'Профиль выбран', profile_created: 'Профиль создан', profile_deleted: 'Профиль удален',
        success_login: 'Успешный вход', success_logout: 'Выход', welcome: 'Добро пожаловать',
        server_added_fav: 'Сервер добавлен в избранное', server_removed_fav: 'Сервер удален из избранного',
        java_not_found: 'Java не найдена', java_custom_selected: 'Выбрана пользовательская Java',
        memory_auto: 'Авто', memory_manual: 'Вручную',
        modpack_share_title: 'Поделиться сборкой модов',
        modpack_share_desc: 'Создайте код и отправьте другу — он введёт его и получит те же моды',
        modpack_generate: 'Создать код сборки',
        modpack_copy: 'Копировать',
        modpack_or: 'или',
        modpack_import: 'Импортировать сборку',
        modpack_input_placeholder: 'MOON-XXXXXX или ML1....',
        modpack_importing: 'Импорт сборки модов',
        modpack_code_copied: 'Код скопирован',
        modpack_code_created: 'Код сборки создан',
        modpack_import_done: 'Сборка установлена',
        modpack_import_partial: 'Часть модов не установилась',
        delete: 'Удалить', install: 'Установить', uninstall: 'Удалить',
        item_deleted: 'Удалено', item_enabled: 'Ресурспак включён', item_disabled: 'Ресурспак выключен',
        enable: 'Включить', disable: 'Выключить', no_installed: 'Ничего не установлено',
        no_active_packs: 'Нет активных ресурспаков',
        all_categories: 'Все категории', mods_found: 'найдено',
        load_more: 'Загрузить ещё', showing_of: 'Показано', catalog_for_loader: 'Моды для'
    },
    en: {
        nav_home: 'Home', nav_mods: 'Mods', nav_shaders: 'Shaders', nav_resourcepacks: 'Resource Packs',
        nav_instances: 'Instances', nav_servers: 'Servers', nav_settings: 'Settings',
        active_instance: 'Active instance', manage_instances: 'Manage instances',
        featured_servers: 'Featured servers', view_all: 'View all', join_server: 'Play',
        memory_quick: 'Memory', performance_preset: 'Performance',
        perf_balanced: 'Balanced', perf_max_fps: 'Max FPS', perf_quality: 'Quality',
        stat_mods: 'Mods', stat_last_played: 'Last played', stat_playtime: 'Play time',
        settings_performance: 'Performance', game_optimizations: 'Game optimizations',
        opt_chunk_loading: 'Fast graphics (fast mode, mipmap 0, no clouds)',
        opt_entity_culling: 'No entity shadows, minimal particles',
        opt_vbo: 'Disable VSync (uncaps FPS)',
        perf_hint: 'The preset actually changes Minecraft\'s video settings (options.txt) and memory/GC on launch — render mode, shadows, particles, VSync — not just Java flags.',
        maxfps_mod_hint: 'For extra FPS there is a separate client-only EntityOpt mod (culls far entity rendering). It\'s built for your PC from source and installed only for you — not required server-side and won\'t block joining other servers.',
        minecraft_instances: 'Minecraft Instances', new_instance: 'New instance', instance_name: 'Instance name',
        duplicate_instance: 'Duplicate', quilt: 'Quilt', quick_connect_set: 'Quick connect to server',
        welcome_to: 'Welcome,', welcome_desc: 'Your portal to the game world',
        account: 'Account', selected_profile: 'Selected Profile', manage_profiles: 'Manage Profiles',
        play: 'Play', close_game: 'Close', launching: 'Launching...',
        launch_error: 'Launch error', error_code: 'Error code',
        game_closed: 'Minecraft closed', mods: 'Mods', mods_desc: 'Install mods for your game',
        shaders: 'Shaders', shaders_desc: 'Enhance your game graphics',
        resourcepacks: 'Resource Packs', resourcepacks_desc: 'Change textures and sounds',
        profiles: 'Profiles', profiles_desc: 'Manage Minecraft versions',
        status_offline: 'Offline', status_microsoft: 'Microsoft', status_online: 'Online', status_checking: 'Checking…',
        login_microsoft: 'Sign in with Microsoft', logout: 'Sign out',
        all_mods: 'All Mods', installed: 'Installed', all_shaders: 'All Shaders',
        all_packs: 'All Packs', active: 'Active', open_mods_folder: 'Open mods folder',
        open_shaders_folder: 'Open shaders folder', open_resourcepacks_folder: 'Open resource packs folder',
        minecraft_profiles: 'Minecraft Profiles', new_profile: 'New Profile',
        profile_name: 'Profile Name', minecraft_version: 'Minecraft Version',
        loader: 'Loader', vanilla: 'Vanilla (no mods)', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge',
        loader_version: 'Loader Version', latest: 'Latest', cancel: 'Cancel', create: 'Create',
        select_version: 'Select version...', all_versions: 'All versions',
        sort_popular: 'By popularity', sort_downloads: 'By downloads', sort_newest: 'Newest',
        minecraft_news: 'Minecraft News', servers: 'Servers', all_servers: 'All Servers',
        favorites: 'Favorites', all: 'All', survival: 'Survival', minigames: 'Minigames',
        anarchy: 'Anarchy', mmorpg: 'MMORPG', settings: 'Settings',
        settings_general: 'General', settings_java: 'Java', settings_game: 'Game',
        settings_appearance: 'Appearance', settings_launcher: 'Launcher',
        settings_diagnostics: 'Diagnostics', settings_about: 'About',
        language_region: 'Language & Region', launcher_language: 'Launcher Language',
        startup: 'Startup', auto_start: 'Launch on system startup',
        minimize_to_tray: 'Minimize to tray on close',
        minimize_on_launch: 'Minimize launcher on game launch',
        java_path: 'Java Path', use_system_java: 'Use system Java',
        custom_java_path: 'Path to Java executable (java.exe)',
        browse: 'Browse', jvm_args: 'JVM Arguments', java_args_label: 'Java launch arguments',
        auto_memory: 'Allocate memory automatically', memory_mb: 'Allocate memory (MB)',
        resolution: 'Resolution', window_resolution: 'Window Resolution',
        auto_current: 'Auto (current)', fullscreen: 'Launch in fullscreen',
        game_folder: 'Game Folder', minecraft_folder: 'Minecraft Folder',
        theme: 'Theme', launcher_theme: 'Launcher Theme', dark: 'Dark', light: 'Light', system: 'System',
        effects: 'Effects', transparency: 'Interface transparency', animations: 'Interface animations',
        blur: 'Background blur', updates: 'Updates', check_updates: 'Check for updates',
        home_background: 'Home screen background',
        home_background_label: 'Custom background image',
        choose_image: 'Choose image', change_image: 'Change', reset: 'Reset',
        home_background_dim: 'Background dimming',
        home_background_set: 'Background set', home_background_removed: 'Background removed',
        home_background_error: 'Failed to set background',
        on_startup: 'On startup', daily: 'Daily', weekly: 'Weekly', never: 'Never',
        update_channel: 'Update Channel', stable: 'Stable', beta: 'Beta', dev: 'Development',
        check_updates_now: 'Update check', check_updates_now_btn: 'Check now',
        updates_auto_hint: 'Updates are checked automatically every time you launch MoonLauncher.',
        startup_checking_updates: 'Checking for updates...',
        network: 'Network', download_mirror: 'Download Mirror', speed_limit: 'Download speed limit',
        no_limit: 'No limit', additional: 'Additional', save_logs: 'Save launch logs',
        debug_mode: 'Debug mode', crash_reports: 'Crash Reports', last_20_crashes: 'Last 20 Minecraft crash reports',
        no_crashes: 'No crash reports', launch_logs: 'Launch Logs', moonlauncher_logs: 'MoonLauncher launch logs',
        no_logs: 'No logs', about_desc: 'Modern Minecraft launcher with mod, shader and resource pack support.',
        website: 'Website', created_with_love: 'Created with ❤️ by the MoonLauncher Team',
        auth_subtitle: 'Your portal to the game world', launching_minecraft: 'Launching Minecraft',
        update_available: 'Update Available!', later: 'Later', download: 'Download',
        error_auth: 'Auth Error', error_select_version: 'Select profile and Minecraft version',
        profile_selected: 'Profile selected', profile_created: 'Profile created', profile_deleted: 'Profile deleted',
        success_login: 'Login successful', success_logout: 'Signed out', welcome: 'Welcome',
        server_added_fav: 'Server added to favorites', server_removed_fav: 'Server removed from favorites',
        java_not_found: 'Java not found', java_custom_selected: 'Custom Java selected',
        memory_auto: 'Auto', memory_manual: 'Manual',
        modpack_share_title: 'Share mod pack',
        modpack_share_desc: 'Create a code and send it to a friend — they enter it and get the same mods',
        modpack_generate: 'Generate pack code',
        modpack_copy: 'Copy',
        modpack_or: 'or',
        modpack_import: 'Import pack',
        modpack_input_placeholder: 'MOON-XXXXXX or ML1....',
        modpack_importing: 'Importing mod pack',
        modpack_code_copied: 'Code copied',
        modpack_code_created: 'Pack code created',
        modpack_import_done: 'Pack installed',
        modpack_import_partial: 'Some mods failed to install',
        delete: 'Delete', install: 'Install', uninstall: 'Uninstall',
        item_deleted: 'Removed', item_enabled: 'Resource pack enabled', item_disabled: 'Resource pack disabled',
        enable: 'Enable', disable: 'Disable', no_installed: 'Nothing installed',
        no_active_packs: 'No active resource packs',
        all_categories: 'All categories', mods_found: 'found',
        load_more: 'Load more', showing_of: 'Showing', catalog_for_loader: 'Mods for'
    }
};

let currentLang = 'ru';

function setLanguage(lang) {
    currentLang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (translations[lang] && translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (translations[lang] && translations[lang][key]) {
            el.placeholder = translations[lang][key];
        }
    });
    document.documentElement.lang = lang;
    updateUserUI(currentUser);
}

// ==================== STATE ====================
let currentUser = null;
let currentPage = 'home';
let minecraftVersions = [];
let fabricVersions = [];
let profiles = [];
let selectedProfileId = null;
let launcherPaths = {};
let installedMods = [];
let installedShaders = [];
let installedResourcepacks = [];
let installedItemsDetail = { mod: [], shader: [], resourcepack: [] };
let installedItemsProfileId; // undefined = ни разу не загружали; иначе id профиля, для которого кэш актуален
let activeResourcePacks = [];
let modsTab = 'all';
let shadersTab = 'all';
let resourcepacksTab = 'all';
let isLaunching = false;
let gameState = 'idle'; // idle | launching | running
let launcherSettings = {};
let favoriteServers = [];
let serverList = [];
let updateInfo = null;
let systemInfo = {};
let pendingQuickConnectServer = null;

const pages = document.querySelectorAll('.page');
const navItems = document.querySelectorAll('.nav-item');
const userDropdownToggle = document.getElementById('userDropdownToggle');
const userDropdown = document.getElementById('userDropdown');
const authModal = document.getElementById('authModal');
const microsoftLoginBtn = document.getElementById('microsoftLoginBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

// ==================== LAUNCH MODAL ====================
const launchModal = document.getElementById('launchModal');
const launchProgressFill = document.getElementById('launchProgressFill');
const launchPercent = document.getElementById('launchPercent');
const launchStage = document.getElementById('launchStage');
const launchDetail = document.getElementById('launchDetail');
const launchCancelBtn = document.getElementById('launchCancelBtn');
const playBtn = document.getElementById('playBtn');

function setPlayButtonState(state) {
    if (!playBtn) return;
    const textEl = playBtn.querySelector('span');
    const icon = playBtn.querySelector('svg');
    playBtn.classList.remove('running', 'loading');
    playBtn.disabled = false;

    if (state === 'running') {
        gameState = 'running';
        isLaunching = false;
        playBtn.classList.add('running');
        if (textEl) textEl.textContent = translations[currentLang].close_game || 'Закрыть';
        if (icon) {
            icon.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>';
        }
    } else if (state === 'loading') {
        gameState = 'launching';
        isLaunching = true;
        playBtn.classList.add('loading');
        playBtn.disabled = true;
        if (textEl) textEl.textContent = translations[currentLang].launching || 'Запуск...';
    } else {
        gameState = 'idle';
        isLaunching = false;
        if (textEl) textEl.textContent = translations[currentLang].play || 'Играть';
        if (icon) {
            icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
        }
    }
}

function showLaunchError(message, code, exitCode) {
    const codeText = code || (exitCode !== undefined && exitCode !== null ? `EXIT_${exitCode}` : 'UNKNOWN');
    const title = translations[currentLang].launch_error || 'Ошибка запуска';
    const body = `${message}\n${translations[currentLang].error_code || 'Код ошибки'}: ${codeText}`;

    showToast(title, body, 'error');
    ipcRenderer.invoke('show-notification', { title, body });

    setPlayButtonState('idle');
}

function showLaunchModal() {
    launchModal.classList.add('show');
    launchModal.classList.remove('running', 'error');
    launchProgressFill.style.width = '0%';
    launchPercent.textContent = '0%';
    launchStage.textContent = translations[currentLang].launching_minecraft || 'Запуск Minecraft...';
    launchStage.style.color = '';
    launchDetail.textContent = '';
    launchCancelBtn.style.display = 'flex';
    launchCancelBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        <span>${translations[currentLang].cancel || 'Отмена'}</span>
    `;
    launchCancelBtn.onclick = async () => {
        await ipcRenderer.invoke('cancel-launch');
        launchModal.classList.remove('show');
        setPlayButtonState('idle');
    };
}

function hideLaunchModal() {
    setTimeout(() => {
        launchModal.classList.remove('show');
    }, 1500);
}

function updateLaunchProgress(progress) {
    launchProgressFill.style.width = progress.percent + '%';
    launchPercent.textContent = Math.round(progress.percent) + '%';
    launchStage.textContent = progress.message;

    if (progress.totalFiles > 0) {
        launchDetail.textContent = `${progress.completedFiles} / ${progress.totalFiles}`;
    } else {
        launchDetail.textContent = '';
    }

    if (progress.stage === 'running') {
        launchModal.classList.add('running');
        launchCancelBtn.style.display = 'none';
        launchStage.textContent = 'Minecraft ' + (currentLang === 'ru' ? 'запущен!' : 'launched!');
        hideLaunchModal();
        setPlayButtonState('running');
        ipcRenderer.invoke('show-notification', {
            title: 'MoonLauncher',
            body: `Minecraft ${getSelectedProfile()?.versionId || ''} ${currentLang === 'ru' ? 'запущен!' : 'launched!'}`
        });
    } else if (progress.stage === 'error') {
        launchModal.classList.add('error');
        launchStage.style.color = 'var(--accent-red)';
        launchCancelBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <span>${translations[currentLang].cancel || 'Закрыть'}</span>
        `;
        launchCancelBtn.onclick = () => {
            launchModal.classList.remove('show');
            launchStage.style.color = '';
        };
        showLaunchError(progress.message, progress.code, progress.exitCode);
    } else if (progress.stage === 'closed') {
        launchModal.classList.remove('show');
        setPlayButtonState('idle');
        pendingQuickConnectServer = null;
        updateQuickServerHint();
        loadProfiles().then(() => updateHomeProfileDisplay());
        if (progress.exitCode && progress.exitCode !== 0 && !progress.userClosed) {
            showLaunchError(
                progress.message || (currentLang === 'ru' ? 'Игра завершилась с ошибкой' : 'Game exited with error'),
                progress.code || 'E_EXIT',
                progress.exitCode
            );
        }
    }
}

ipcRenderer.on('launch-progress', (event, progress) => {
    updateLaunchProgress(progress);
});

// Window controls
document.getElementById('btnClose').addEventListener('click', () => ipcRenderer.invoke('window-close'));
document.getElementById('btnMinimize').addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
document.getElementById('btnMaximize').addEventListener('click', () => ipcRenderer.invoke('window-maximize'));

// Navigation
navItems.forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
    currentPage = page;
    navItems.forEach(item => item.classList.remove('active'));
    const navEl = document.querySelector(`[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');
    pages.forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    document.querySelector('.content')?.classList.toggle('page-home-active', page === 'home');
    document.querySelector('.content')?.classList.toggle('page-catalog-active', ['mods', 'shaders', 'resourcepacks'].includes(page));

    if (page === 'home') refreshHomePanel();
    else if (page === 'mods') loadMods();
    else if (page === 'shaders') loadShaders();
    else if (page === 'resourcepacks') loadResourcePacks();
    else if (page === 'servers') loadServers();
    else if (page === 'profiles') loadProfilesPage();
    else if (page === 'settings') loadSettings();
    else if (page === 'friends' && typeof window.onFriendsPageOpen === 'function') window.onFriendsPageOpen();
}

window.navigateTo = navigateTo;

// Launcher paths
ipcRenderer.on('launcher-paths', (event, paths) => { launcherPaths = paths; });

// User dropdown
userDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('show');
});
document.addEventListener('click', () => userDropdown.classList.remove('show'));

// Auth
loginBtn.addEventListener('click', () => authModal.classList.add('show'));

microsoftLoginBtn.addEventListener('click', async () => {
    try {
        microsoftLoginBtn.innerHTML = '<span style="color: var(--text-secondary)">Авторизация...</span>';
        const result = await ipcRenderer.invoke('microsoft-login');
        if (result.success) {
            currentUser = result;
            updateUserUI(result);
            authModal.classList.remove('show');
            showToast(translations[currentLang].success_login || 'Успешный вход', `${currentLang === 'ru' ? 'Добро пожаловать' : 'Welcome'}, ${result.username}!`, 'success');
        } else {
            showToast(translations[currentLang].error_auth || 'Auth Error', result.error, 'error');
        }
    } catch (error) {
        showToast('Error', error.message, 'error');
    } finally {
        microsoftLoginBtn.innerHTML = `
            <svg viewBox="0 0 21 21" fill="none" style="width: 20px; height: 20px;">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            <span>${translations[currentLang].login_microsoft || 'Войти через Microsoft'}</span>
        `;
    }
});

logoutBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke('logout');
    currentUser = null;
    updateUserUI(null);
    showToast(translations[currentLang].success_logout || 'Выход', currentLang === 'ru' ? 'Вы вышли из аккаунта' : 'Signed out', 'info');
});

function updateUserUI(user) {
    const userName = document.getElementById('userName');
    const profileName = document.getElementById('profileName');
    const panelUserName = document.getElementById('panelUserName');
    const userAvatar = document.getElementById('userAvatar');
    const panelAvatar = document.getElementById('panelAvatar');
    const userStatus = document.getElementById('userStatusText');

    const skinPreview = document.getElementById('homeSkinPreview');
    const skinName = user?.username || 'Steve';

    if (user && user.username) {
        userName.textContent = user.username;
        panelUserName.textContent = user.username;
        profileName.textContent = user.username;
        userAvatar.src = `https://mc-heads.net/avatar/${user.uuid || skinName}`;
        panelAvatar.src = `https://mc-heads.net/avatar/${user.uuid || skinName}`;
        if (skinPreview) skinPreview.src = `https://mc-heads.net/body/${skinName}/128`;
        if (userStatus) {
            userStatus.textContent = translations[currentLang].status_microsoft || 'Microsoft';
            userStatus.className = 'user-status online';
        }
        loginBtn.style.display = 'none';
    } else {
        userName.textContent = currentLang === 'ru' ? 'Гость' : 'Guest';
        panelUserName.textContent = currentLang === 'ru' ? 'Гость' : 'Guest';
        profileName.textContent = currentLang === 'ru' ? 'Не авторизован' : 'Not authorized';
        userAvatar.src = 'https://mc-heads.net/avatar/Steve';
        panelAvatar.src = 'https://mc-heads.net/avatar/Steve';
        if (skinPreview) skinPreview.src = 'https://mc-heads.net/body/Steve/128';
        if (userStatus) {
            userStatus.textContent = translations[currentLang].status_offline || 'Оффлайн';
            userStatus.className = 'user-status guest';
        }
        loginBtn.style.display = 'flex';
    }

    if (typeof window.onAuthChanged === 'function') window.onAuthChanged(user);
}

async function checkSavedAuth() {
    const userStatus = document.getElementById('userStatusText');
    if (userStatus) {
        userStatus.textContent = translations[currentLang].status_checking || 'Проверка…';
        userStatus.className = 'user-status';
    }
    const result = await ipcRenderer.invoke('get-saved-auth');
    if (result.success) {
        currentUser = result;
        updateUserUI(result);
    } else {
        updateUserUI(null);
    }
}
checkSavedAuth();

ipcRenderer.on('auth-success', (event, data) => {
    currentUser = data;
    updateUserUI(data);
});

// ==================== TOAST NOTIFICATIONS ====================
function showToast(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // SECURITY: title/message иногда содержат данные из внешних источников
    // (например, название мода с Modrinth в uninstallFeaturedMod). Экранируем
    // здесь один раз, чтобы не зависеть от того, что каждый вызов showToast()
    // в коде не забудет это сделать сам.
    toast.innerHTML = `
        <div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</div>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
    `;
    let dismissTimer = null;
    let removeTimer = null;
    const dismiss = () => {
        if (dismissTimer) clearTimeout(dismissTimer);
        if (removeTimer) clearTimeout(removeTimer);
        toast.classList.remove('show');
        toast.classList.add('toast-dismissing');
        setTimeout(() => toast.remove(), 200);
    };
    toast.addEventListener('click', dismiss);
    toast.style.cursor = 'pointer';
    toast.title = currentLang === 'ru' ? 'Нажмите, чтобы закрыть' : 'Click to dismiss';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    dismissTimer = setTimeout(() => {
        toast.classList.remove('show');
        removeTimer = setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==================== ONLINE COUNTER ====================
async function updateOnlineCounter() {
    const counter = document.getElementById('onlineCounter');
    const dot = document.querySelector('.online-status .status-dot');
    try {
        const result = await ipcRenderer.invoke('get-online-count');
        if (result.success && counter) {
            const label = currentLang === 'ru' ? 'Онлайн' : 'Online';
            counter.textContent = `${label}: ${result.count.toLocaleString()}`;
            counter.classList.remove('offline');
            dot?.classList.remove('offline');
        } else if (counter) {
            counter.textContent = currentLang === 'ru' ? 'Онлайн: недоступно' : 'Online: unavailable';
            counter.classList.add('offline');
            dot?.classList.add('offline');
        }
    } catch (e) {
        if (counter) {
            counter.textContent = currentLang === 'ru' ? 'Онлайн: недоступно' : 'Online: unavailable';
            counter.classList.add('offline');
        }
    }
}
setInterval(updateOnlineCounter, 30000);
updateOnlineCounter();

// ==================== UPDATE CHECKER ====================
let pendingUpdatePath = null;
let startupSplashResolve = null;

function setStartupStatus(text) {
    const el = document.getElementById('startupStatus');
    if (el) el.textContent = text;
}

function setStartupProgress(percent, detail = '') {
    const wrap = document.getElementById('startupProgressWrap');
    const fill = document.getElementById('startupProgressFill');
    const text = document.getElementById('startupProgressText');
    const detailEl = document.getElementById('startupProgressDetail');
    if (wrap) wrap.classList.remove('hidden');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (text) text.textContent = `${Math.round(percent)}%`;
    if (detailEl) detailEl.textContent = detail;
}

function hideStartupSplash() {
    const splash = document.getElementById('startupSplash');
    if (splash) splash.classList.remove('show');
    if (startupSplashResolve) {
        startupSplashResolve();
        startupSplashResolve = null;
    }
}

function waitForStartupDismiss() {
    return new Promise((resolve) => {
        startupSplashResolve = resolve;
        const skipBtn = document.getElementById('startupSkipBtn');
        if (skipBtn) {
            skipBtn.onclick = () => hideStartupSplash();
        }
    });
}

function showStartupInstallActions(show) {
    const actions = document.getElementById('startupActions');
    if (actions) actions.classList.toggle('hidden', !show);
}

async function downloadLauncherUpdateWithProgress(info) {
    return new Promise((resolve) => {
        const onProgress = (event, data) => {
            if (data.status === 'downloading') {
                setStartupProgress(data.percent || 0, data.message || '');
            }
            if (data.status === 'completed') {
                ipcRenderer.removeListener('update-download-progress', onProgress);
                resolve({ success: true, path: data.path });
            }
            if (data.status === 'error') {
                ipcRenderer.removeListener('update-download-progress', onProgress);
                resolve({ success: false, error: data.message });
            }
        };
        ipcRenderer.on('update-download-progress', onProgress);
        ipcRenderer.invoke('download-launcher-update', {
            downloadUrl: info.downloadUrl,
            fileName: info.fileName,
            latestVersion: info.latestVersion,
            sha256: info.sha256
        }).then((result) => {
            if (!result.success) {
                ipcRenderer.removeListener('update-download-progress', onProgress);
                resolve(result);
            } else if (!pendingUpdatePath) {
                pendingUpdatePath = result.path;
            }
        });
    });
}

async function runStartupUpdateFlow() {
    const splash = document.getElementById('startupSplash');
    if (splash) splash.classList.add('show');

    setStartupStatus(currentLang === 'ru' ? 'Проверка обновлений...' : 'Checking for updates...');

    // Кнопки установки/пропуска больше не нужны для авто-режима, но оставляем
    // их как запасной вариант на случай, если авто-установка не запустится
    // (например, ошибка IPC) — тогда пользователь сможет установить вручную.
    const installBtn = document.getElementById('startupInstallBtn');
    if (installBtn) {
        installBtn.onclick = async () => {
            if (!pendingUpdatePath) return;
            setStartupStatus(currentLang === 'ru' ? 'Установка обновления...' : 'Installing update...');
            await ipcRenderer.invoke('install-launcher-update', { filePath: pendingUpdatePath });
        };
    }

    try {
        const result = await ipcRenderer.invoke('check-updates');
        if (!result.success || !result.hasUpdate) {
            setStartupStatus(currentLang === 'ru' ? 'Запуск лаунчера...' : 'Starting launcher...');
            await new Promise(r => setTimeout(r, 350));
            hideStartupSplash();
            return;
        }

        updateInfo = result;
        setStartupStatus(
            currentLang === 'ru'
                ? `Найдено обновление v${result.latestVersion}`
                : `Update found v${result.latestVersion}`
        );
        setStartupProgress(0, currentLang === 'ru' ? 'Загрузка...' : 'Downloading...');

        const download = await downloadLauncherUpdateWithProgress(result);
        if (download.success) {
            pendingUpdatePath = download.path;
            setStartupProgress(100, currentLang === 'ru' ? 'Готово' : 'Done');
            setStartupStatus(
                currentLang === 'ru'
                    ? 'Установка обновления...'
                    : 'Installing update...'
            );
            // Устанавливаем автоматически, без ожидания клика пользователя.
            // Лаунчер тихо (/S) поставит обновление и сам перезапустится —
            // никаких "Далее -> Далее -> Установить" от пользователя не требуется.
            const installResult = await ipcRenderer.invoke('install-launcher-update', { filePath: pendingUpdatePath });
            if (!installResult || !installResult.success) {
                // Авто-установка не удалась — даём запасной вариант вручную.
                setStartupStatus(
                    currentLang === 'ru'
                        ? 'Не удалось запустить установку автоматически'
                        : 'Could not start installation automatically'
                );
                showStartupInstallActions(true);
                await Promise.race([
                    waitForStartupDismiss(),
                    new Promise(r => setTimeout(r, 12000))
                ]);
            }
            // При успехе лаунчер сейчас закроется сам (см. install-launcher-update
            // в main.js) — дальше ничего делать не нужно, окно вот-вот исчезнет.
        } else {
            setStartupStatus(currentLang === 'ru' ? 'Не удалось загрузить обновление' : 'Update download failed');
            await new Promise(r => setTimeout(r, 800));
            hideStartupSplash();
        }
    } catch (e) {
        hideStartupSplash();
    }
}

async function checkForUpdatesManual() {
    const result = await ipcRenderer.invoke('check-updates');
    if (result.success && result.hasUpdate) {
        updateInfo = result;
        showUpdateModal(result);
        showToast(
            currentLang === 'ru' ? 'Обновления' : 'Updates',
            (currentLang === 'ru' ? 'Доступна версия ' : 'Version available ') + result.latestVersion,
            'info'
        );
    } else if (result.success) {
        showToast(
            currentLang === 'ru' ? 'Обновления' : 'Updates',
            currentLang === 'ru' ? 'У вас последняя версия' : 'You are on the latest version',
            'success'
        );
    } else {
        showToast('Error', result.error || 'Update check failed', 'error');
    }
}

function showUpdateModal(info) {
    const modal = document.getElementById('updateModal');
    const versionText = document.getElementById('updateVersionText');
    const changelog = document.getElementById('updateChangelog');

    if (versionText) versionText.textContent = `MoonLauncher v${info.latestVersion}`;
    if (changelog) {
        changelog.textContent = typeof info.changelog === 'string'
            ? info.changelog
            : (currentLang === 'ru' ? 'Исправления и улучшения' : 'Bug fixes and improvements');
    }

    modal.classList.add('show');

    document.getElementById('skipUpdateBtn').onclick = () => modal.classList.remove('show');
    document.getElementById('downloadUpdateBtn').onclick = async () => {
        modal.classList.remove('show');
        const splash = document.getElementById('startupSplash');
        if (splash) splash.classList.add('show');
        setStartupStatus(currentLang === 'ru' ? 'Загрузка обновления...' : 'Downloading update...');
        setStartupProgress(0);
        const dl = await downloadLauncherUpdateWithProgress(info);
        if (dl.success) {
            pendingUpdatePath = dl.path;
            setStartupProgress(100);
            setStartupStatus(currentLang === 'ru' ? 'Установка обновления...' : 'Installing update...');
            // Ставим сразу же, без второго клика — лаунчер тихо обновится и
            // перезапустится сам.
            const installResult = await ipcRenderer.invoke('install-launcher-update', { filePath: pendingUpdatePath });
            if (!installResult || !installResult.success) {
                setStartupStatus(
                    currentLang === 'ru'
                        ? 'Не удалось запустить установку автоматически'
                        : 'Could not start installation automatically'
                );
                showStartupInstallActions(true);
                await waitForStartupDismiss();
            }
        } else {
            hideStartupSplash();
            showToast('Error', dl.error || 'Download failed', 'error');
        }
    };
}

// ==================== SETTINGS ====================
async function loadSettings() {
    const result = await ipcRenderer.invoke('get-settings');
    if (result.success) {
        launcherSettings = result.settings;
        applySettingsToUI();
    }
    loadCrashReports();
    loadLaunchLogs();
}

function applySettingsToUI() {
    const s = launcherSettings;

    // Language
    if (s.language) {
        document.getElementById('languageSelect').value = s.language;
        setLanguage(s.language);
    }
    
    // Startup
    if (s.autoStart !== undefined) document.getElementById('autoStart').checked = s.autoStart;
    if (s.minimizeToTray !== undefined) document.getElementById('minimizeToTray').checked = s.minimizeToTray;
    if (s.minimizeOnLaunch !== undefined) document.getElementById('minimizeOnLaunch').checked = s.minimizeOnLaunch;
    
    // Java
    if (s.useSystemJava !== undefined) {
        document.getElementById('useSystemJava').checked = s.useSystemJava;
        document.getElementById('customJavaPathGroup').style.display = s.useSystemJava ? 'none' : 'block';
    }
    if (s.customJavaPath) document.getElementById('customJavaPath').value = s.customJavaPath;
    if (s.javaArgs) document.getElementById('javaArgs').value = s.javaArgs;
    
    // Memory - REAL SLIDER
    if (s.autoMemory !== undefined) {
        document.getElementById('autoMemory').checked = s.autoMemory;
        document.getElementById('manualMemoryGroup').style.display = s.autoMemory ? 'none' : 'flex';
    }
    if (s.memory) {
        document.getElementById('memorySlider').value = s.memory;
        document.getElementById('memoryValue').textContent = s.memory + ' МБ';
    }
    
    // Game
    if (s.gameResolution) document.getElementById('gameResolution').value = s.gameResolution;
    if (s.fullscreen !== undefined) document.getElementById('fullscreen').checked = s.fullscreen;
    if (s.gameDir) document.getElementById('gameDirPath').value = s.gameDir;
    
    // Appearance
    if (s.theme) document.getElementById('themeSelect').value = s.theme;
    if (s.transparency) {
        document.getElementById('transparencySlider').value = s.transparency;
        document.getElementById('transparencyValue').textContent = s.transparency + '%';
    }
    if (s.animations !== undefined) document.getElementById('animations').checked = s.animations;
    if (s.blurEffects !== undefined) document.getElementById('blurEffects').checked = s.blurEffects;
    if (s.homeBackgroundDim !== undefined) {
        document.getElementById('homeBackgroundDimSlider').value = s.homeBackgroundDim;
        document.getElementById('homeBackgroundDimValue').textContent = s.homeBackgroundDim + '%';
    }
    updateHomeBackgroundUI();
    
    // Launcher
    if (s.updateChannel) document.getElementById('updateChannel').value = s.updateChannel;
    if (s.downloadMirror) document.getElementById('downloadMirror').value = s.downloadMirror;
    if (s.speedLimit !== undefined) {
        document.getElementById('speedLimitSlider').value = s.speedLimit;
        const val = parseInt(s.speedLimit);
        document.getElementById('speedLimitValue').textContent = val === 0 
            ? (currentLang === 'ru' ? 'Без ограничения' : 'No limit')
            : val + ' МБ/с';
    }
    if (s.saveLogs !== undefined) document.getElementById('saveLogs').checked = s.saveLogs;
    if (s.debugMode !== undefined) document.getElementById('debugMode').checked = s.debugMode;

    if (s.performancePreset) {
        document.getElementById('performancePreset').value = s.performancePreset;
        const homePreset = document.getElementById('homePerformancePreset');
        if (homePreset) homePreset.value = s.performancePreset;
    }
    if (s.optChunkLoading !== undefined) document.getElementById('optChunkLoading').checked = s.optChunkLoading;
    if (s.optEntityCulling !== undefined) document.getElementById('optEntityCulling').checked = s.optEntityCulling;
    if (s.optVbo !== undefined) document.getElementById('optVbo').checked = s.optVbo;

    syncHomeMemorySlider();

    applyAppearanceSettings();
}

function syncHomeMemorySlider() {
    const profile = getSelectedProfile();
    const slider = document.getElementById('homeMemorySlider');
    const valueEl = document.getElementById('homeMemoryValue');
    if (!slider || !valueEl) return;

    const mem = profile?.memoryMB || launcherSettings.memory || 4096;
    const maxMem = systemInfo.totalMemory ? Math.min(systemInfo.totalMemory, 16384) : 16384;
    slider.max = maxMem;
    slider.value = mem;
    valueEl.textContent = mem + (currentLang === 'ru' ? ' МБ' : ' MB');
}

function toFileUrl(filePath) {
    if (!filePath) return '';
    try {
        return require('url').pathToFileURL(filePath).href;
    } catch (e) {
        return '';
    }
}

function updateHomeBackgroundUI() {
    const preview = document.getElementById('homeBackgroundPreview');
    const resetBtn = document.getElementById('resetHomeBackgroundBtn');
    const chooseBtn = document.getElementById('chooseHomeBackgroundBtn');
    const bg = launcherSettings.homeBackground;
    if (preview) {
        if (bg) {
            preview.src = toFileUrl(bg) + '?t=' + Date.now();
            preview.style.display = 'block';
        } else {
            preview.removeAttribute('src');
            preview.style.display = 'none';
        }
    }
    if (resetBtn) resetBtn.style.display = bg ? 'inline-flex' : 'none';
    if (chooseBtn) chooseBtn.textContent = bg
        ? (translations[currentLang].change_image || 'Заменить')
        : (translations[currentLang].choose_image || 'Выбрать изображение');
}

function applyAppearanceSettings() {
    const s = launcherSettings;
    const app = document.getElementById('app');
    const root = document.documentElement;

    root.classList.remove('theme-dark', 'theme-light');
    if (s.theme === 'light') {
        root.classList.add('theme-light');
    } else if (s.theme === 'dark') {
        root.classList.add('theme-dark');
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    }

    if (s.transparency) {
        const opacity = s.transparency / 100;
        const isLight = root.classList.contains('theme-light');
        app.style.background = isLight
            ? `rgba(245, 245, 247, ${opacity})`
            : `rgba(10, 10, 15, ${opacity})`;
    }

    const titleBar = document.querySelector('.title-bar');
    if (titleBar) {
        if (s.blurEffects !== false) {
            titleBar.style.backdropFilter = 'blur(20px)';
            titleBar.style.webkitBackdropFilter = 'blur(20px)';
        } else {
            titleBar.style.backdropFilter = 'none';
            titleBar.style.webkitBackdropFilter = 'none';
        }
    }

    if (s.animations === false) {
        document.documentElement.style.setProperty('--transition', 'none');
    } else {
        document.documentElement.style.setProperty('--transition', 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)');
    }

    const homeBg = document.querySelector('.home-bg');
    if (homeBg) {
        if (s.homeBackground) {
            homeBg.style.backgroundImage = `url("${toFileUrl(s.homeBackground)}")`;
            homeBg.style.backgroundSize = 'cover';
            homeBg.style.backgroundPosition = 'center';
            homeBg.classList.add('has-custom-bg');
            const dim = (s.homeBackgroundDim ?? 45) / 100;
            const isLight = root.classList.contains('theme-light');
            homeBg.style.setProperty('--home-bg-overlay', isLight ? `rgba(243,245,251,${dim})` : `rgba(6,8,16,${dim})`);
        } else {
            homeBg.style.backgroundImage = '';
            homeBg.classList.remove('has-custom-bg');
            homeBg.style.removeProperty('--home-bg-overlay');
        }
    }
}

async function saveSettings() {
    const s = {
        language: document.getElementById('languageSelect').value,
        autoStart: document.getElementById('autoStart').checked,
        minimizeToTray: document.getElementById('minimizeToTray').checked,
        minimizeOnLaunch: document.getElementById('minimizeOnLaunch').checked,
        useSystemJava: document.getElementById('useSystemJava').checked,
        customJavaPath: document.getElementById('customJavaPath').value,
        javaArgs: document.getElementById('javaArgs').value,
        autoMemory: document.getElementById('autoMemory').checked,
        memory: parseInt(document.getElementById('memorySlider').value),
        gameResolution: document.getElementById('gameResolution').value,
        fullscreen: document.getElementById('fullscreen').checked,
        gameDir: document.getElementById('gameDirPath').value,
        theme: document.getElementById('themeSelect').value,
        transparency: parseInt(document.getElementById('transparencySlider').value),
        animations: document.getElementById('animations').checked,
        blurEffects: document.getElementById('blurEffects').checked,
        updateChannel: document.getElementById('updateChannel').value,
        downloadMirror: document.getElementById('downloadMirror').value,
        speedLimit: parseInt(document.getElementById('speedLimitSlider').value),
        saveLogs: document.getElementById('saveLogs').checked,
        debugMode: document.getElementById('debugMode').checked,
        performancePreset: document.getElementById('performancePreset')?.value || document.getElementById('homePerformancePreset')?.value || 'balanced',
        optChunkLoading: document.getElementById('optChunkLoading')?.checked ?? true,
        optEntityCulling: document.getElementById('optEntityCulling')?.checked ?? false,
        optVbo: document.getElementById('optVbo')?.checked ?? true,
        homeBackground: launcherSettings.homeBackground || '',
        homeBackgroundDim: parseInt(document.getElementById('homeBackgroundDimSlider')?.value ?? 45)
    };

    launcherSettings = s;
    await ipcRenderer.invoke('save-settings', s);
    applyAppearanceSettings();

    if (s.language !== currentLang) {
        setLanguage(s.language);
    }
    
    showToast(currentLang === 'ru' ? 'Настройки' : 'Settings', currentLang === 'ru' ? 'Сохранено' : 'Saved', 'success');
}

// Settings event listeners
document.getElementById('languageSelect')?.addEventListener('change', saveSettings);
document.getElementById('autoStart')?.addEventListener('change', saveSettings);
document.getElementById('minimizeToTray')?.addEventListener('change', saveSettings);
document.getElementById('minimizeOnLaunch')?.addEventListener('change', saveSettings);

document.getElementById('useSystemJava')?.addEventListener('change', () => {
    const useSystem = document.getElementById('useSystemJava').checked;
    document.getElementById('customJavaPathGroup').style.display = useSystem ? 'none' : 'block';
    saveSettings();
});

document.getElementById('customJavaPath')?.addEventListener('change', saveSettings);
document.getElementById('javaArgs')?.addEventListener('change', saveSettings);

document.getElementById('autoMemory')?.addEventListener('change', () => {
    const auto = document.getElementById('autoMemory').checked;
    document.getElementById('manualMemoryGroup').style.display = auto ? 'none' : 'flex';
    saveSettings();
});

document.getElementById('memorySlider')?.addEventListener('input', (e) => {
    document.getElementById('memoryValue').textContent = e.target.value + ' МБ';
});
document.getElementById('memorySlider')?.addEventListener('change', saveSettings);

document.getElementById('gameResolution')?.addEventListener('change', saveSettings);
document.getElementById('fullscreen')?.addEventListener('change', saveSettings);
document.getElementById('themeSelect')?.addEventListener('change', () => {
    applyAppearanceSettings();
    saveSettings();
});

document.getElementById('transparencySlider')?.addEventListener('input', (e) => {
    document.getElementById('transparencyValue').textContent = e.target.value + '%';
});
document.getElementById('transparencySlider')?.addEventListener('change', saveSettings);

document.getElementById('animations')?.addEventListener('change', saveSettings);
document.getElementById('blurEffects')?.addEventListener('change', saveSettings);

document.getElementById('chooseHomeBackgroundBtn')?.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('choose-home-background');
    if (result.success) {
        launcherSettings.homeBackground = result.path;
        updateHomeBackgroundUI();
        applyAppearanceSettings();
        showToast(currentLang === 'ru' ? 'Настройки' : 'Settings', translations[currentLang].home_background_set || 'Фон установлен', 'success');
    } else if (!result.canceled) {
        showToast('Error', result.error || translations[currentLang].home_background_error, 'error');
    }
});

document.getElementById('resetHomeBackgroundBtn')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('clear-home-background');
    launcherSettings.homeBackground = '';
    updateHomeBackgroundUI();
    applyAppearanceSettings();
    showToast(currentLang === 'ru' ? 'Настройки' : 'Settings', translations[currentLang].home_background_removed || 'Фон убран', 'info');
});

document.getElementById('homeBackgroundDimSlider')?.addEventListener('input', (e) => {
    document.getElementById('homeBackgroundDimValue').textContent = e.target.value + '%';
    launcherSettings.homeBackgroundDim = parseInt(e.target.value);
    applyAppearanceSettings();
});
document.getElementById('homeBackgroundDimSlider')?.addEventListener('change', saveSettings);
document.getElementById('updateChannel')?.addEventListener('change', saveSettings);
document.getElementById('checkUpdatesNowBtn')?.addEventListener('click', checkForUpdatesManual);
document.getElementById('downloadMirror')?.addEventListener('change', saveSettings);

document.getElementById('speedLimitSlider')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('speedLimitValue').textContent = val === 0 
        ? (currentLang === 'ru' ? 'Без ограничения' : 'No limit')
        : val + ' МБ/с';
});
document.getElementById('speedLimitSlider')?.addEventListener('change', saveSettings);

document.getElementById('saveLogs')?.addEventListener('change', saveSettings);
document.getElementById('debugMode')?.addEventListener('change', saveSettings);

function maybeHintEntityOptMod(presetValue) {
    if (presetValue !== 'maxFps') return;
    const msg = translations[currentLang].maxfps_mod_hint || (currentLang === 'ru'
        ? 'Для доп. прироста FPS есть отдельный клиентский мод EntityOpt (обрезает рендер дальних сущностей). Он собирается под твой ПК из исходников, ставится только тебе — не нужен на сервере и не мешает заходить на чужие сервера без него.'
        : 'For extra FPS there is a separate client-only EntityOpt mod (culls far entity rendering). It\'s built for your PC from source and installed only for you — not required server-side and won\'t block joining other servers.');
    showToast(currentLang === 'ru' ? 'Макс. FPS' : 'Max FPS', msg, 'info');
}

document.getElementById('performancePreset')?.addEventListener('change', () => {
    const homePreset = document.getElementById('homePerformancePreset');
    const value = document.getElementById('performancePreset').value;
    if (homePreset) homePreset.value = value;
    maybeHintEntityOptMod(value);
    saveSettings();
});
document.getElementById('homePerformancePreset')?.addEventListener('change', () => {
    const settingsPreset = document.getElementById('performancePreset');
    const value = document.getElementById('homePerformancePreset').value;
    if (settingsPreset) settingsPreset.value = value;
    maybeHintEntityOptMod(value);
    saveSettings();
});
document.getElementById('optChunkLoading')?.addEventListener('change', saveSettings);
document.getElementById('optEntityCulling')?.addEventListener('change', saveSettings);
document.getElementById('optVbo')?.addEventListener('change', saveSettings);

document.getElementById('homeMemorySlider')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('homeMemoryValue').textContent = val + (currentLang === 'ru' ? ' МБ' : ' MB');
});
document.getElementById('homeMemorySlider')?.addEventListener('change', async (e) => {
    const memoryMB = parseInt(e.target.value);
    const profile = getSelectedProfile();
    if (profile) {
        profile.memoryMB = memoryMB;
        profiles = profiles.map(p => p.id === profile.id ? profile : p);
        await ipcRenderer.invoke('save-profile-memory', { profileId: profile.id, memoryMB });
        await ipcRenderer.invoke('save-profiles', profiles);
    }
    launcherSettings.autoMemory = false;
    launcherSettings.memory = memoryMB;
    document.getElementById('autoMemory').checked = false;
    document.getElementById('manualMemoryGroup').style.display = 'flex';
    document.getElementById('memorySlider').value = memoryMB;
    document.getElementById('memoryValue').textContent = memoryMB + ' МБ';
    saveSettings();
});

// Java browse - REAL FILE PICKER
document.getElementById('browseJavaBtn')?.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('browse-file', {
        filters: [
            { name: 'Java Executable', extensions: ['exe'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        defaultPath: 'C:\\Program Files\\Java'
    });
    if (result) {
        document.getElementById('customJavaPath').value = result;
        // Validate Java
        document.getElementById('useSystemJava').checked = false;
        document.getElementById('customJavaPathGroup').style.display = 'block';
        saveSettings();
        showToast(currentLang === 'ru' ? 'Java' : 'Java', currentLang === 'ru' ? 'Путь выбран' : 'Path selected', 'success');
    }
});

// Game dir browse
document.getElementById('browseGameDirBtn')?.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('browse-folder');
    if (result) {
        document.getElementById('gameDirPath').value = result;
        saveSettings();
    }
});

// Settings tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`settings-${tab.dataset.settings}`).classList.add('active');
    });
});

// ==================== SYSTEM INFO ====================
async function loadSystemInfo() {
    try {
        const result = await ipcRenderer.invoke('get-system-info');
        if (result.success) {
            systemInfo = result;
            // Update memory slider max based on system RAM
            const maxMem = Math.min(result.totalMemory, 32768);
            const slider = document.getElementById('memorySlider');
            if (slider) {
                slider.max = maxMem;
                slider.step = 512;
            }
        }
    } catch (e) {}
}

// ==================== MINECRAFT VERSIONS ====================
async function loadMinecraftVersions() {
    try {
        const response = await fetchWithTimeout(`${MOONLAUNCHER_API}/versions/list.json`);
        if (response.ok) {
            const data = await response.json();
            if (data.versions && data.versions.length > 0) {
                minecraftVersions = data.versions;
                populateVersionSelectors();
                updateDefaultProfileVersion();
                return;
            }
        }
    } catch (e) {}

    const result = await ipcRenderer.invoke('get-minecraft-versions');
    if (result.success) {
        minecraftVersions = result.versions;
        populateVersionSelectors();
        const fabricResult = await ipcRenderer.invoke('get-fabric-versions');
        if (fabricResult.success) fabricVersions = fabricResult.versions;
        updateDefaultProfileVersion();
    }
}

function populateVersionSelectors() {
    const selectors = [
        document.getElementById('profileVersionSelect'),
        document.getElementById('modsVersionFilter'),
        document.getElementById('shadersVersionFilter'),
        document.getElementById('resourcepacksVersionFilter')
    ];

    selectors.forEach(selector => {
        if (!selector) return;
        const currentVal = selector.value;
        const allVersionsText = currentLang === 'ru' ? 'Все версии' : 'All versions';
        selector.innerHTML = `<option value="">${allVersionsText}</option>`;
        minecraftVersions.forEach(v => {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = v.id;
            selector.appendChild(option);
        });
        if (currentVal) selector.value = currentVal;
    });
}

async function updateDefaultProfileVersion() {
    if (minecraftVersions.length === 0) return;
    const latest = minecraftVersions[0];
    const result = await ipcRenderer.invoke('get-profiles');
    if (result.success && result.profiles.length > 0) {
        const defaultProfile = result.profiles[0];
        if (!defaultProfile.versionId) {
            defaultProfile.versionId = latest.id;
            defaultProfile.version = latest.id;
            defaultProfile.loader = 'vanilla';
            await ipcRenderer.invoke('save-profiles', result.profiles);
        }
        profiles = result.profiles;
        if (!selectedProfileId) selectedProfileId = defaultProfile.id;
        updateHomeProfileDisplay();
    }
}

// ==================== PROFILES ====================
async function loadProfiles() {
    const result = await ipcRenderer.invoke('get-profiles');
    if (result.success) {
        profiles = result.profiles;
        if (!selectedProfileId && profiles.length > 0) selectedProfileId = profiles[0].id;
        updateHomeProfileDisplay();
    }
}

function getSelectedProfile() {
    return profiles.find(p => p.id === selectedProfileId);
}

function formatPlayTime(seconds) {
    if (!seconds || seconds < 60) return currentLang === 'ru' ? '< 1 мин' : '< 1 min';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return currentLang === 'ru' ? `${hours} ч ${mins} м` : `${hours}h ${mins}m`;
    return currentLang === 'ru' ? `${mins} мин` : `${mins} min`;
}

function formatLastPlayed(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return currentLang === 'ru' ? 'Только что' : 'Just now';
    if (mins < 60) return `${mins} ${currentLang === 'ru' ? 'мин назад' : 'min ago'}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${currentLang === 'ru' ? 'ч назад' : 'h ago'}`;
    const days = Math.floor(hours / 24);
    return `${days} ${currentLang === 'ru' ? 'дн назад' : 'd ago'}`;
}

function updateHomeProfileDisplay() {
    const profile = getSelectedProfile();
    if (!profile) return;

    const profileNameEl = document.getElementById('selectedProfileName');
    const versionText = document.getElementById('selectedVersion');
    const loaderIcon = document.getElementById('loaderIcon');

    if (profileNameEl) profileNameEl.textContent = profile.name;
    if (versionText) versionText.textContent = `${profile.versionId || '1.20.1'} • ${getLoaderName(profile.loader)}`;

    if (loaderIcon) {
        const iconMap = {
            vanilla: 'https://cdn.modrinth.com/data/P7dR8mSH/icon.png',
            fabric: 'https://cdn.modrinth.com/data/P7dR8mSH/icon.png',
            quilt: 'https://cdn.modrinth.com/data/qvfyMCp5/icon.png',
            forge: 'https://cdn.modrinth.com/data/AANobbMI/icon.png',
            neoforge: 'https://cdn.modrinth.com/data/AANobbMI/icon.png'
        };
        loaderIcon.src = iconMap[profile.loader] || iconMap.vanilla;
    }

    const modCountEl = document.getElementById('homeModCount');
    const lastPlayedEl = document.getElementById('homeLastPlayed');
    const playTimeEl = document.getElementById('homePlayTime');
    if (modCountEl) modCountEl.textContent = String(installedMods.length);
    if (lastPlayedEl) lastPlayedEl.textContent = formatLastPlayed(profile.lastPlayed);
    if (playTimeEl) playTimeEl.textContent = formatPlayTime(profile.totalPlayTime);

    syncHomeMemorySlider();
    updateQuickServerHint();
}

function updateQuickServerHint() {
    const hint = document.getElementById('quickServerHint');
    if (!hint) return;
    if (pendingQuickConnectServer?.ip) {
        hint.style.display = 'block';
        hint.textContent = `${translations[currentLang].quick_connect_set || 'Quick connect'}: ${pendingQuickConnectServer.ip}`;
    } else {
        hint.style.display = 'none';
    }
}

async function refreshHomePanel() {
    await loadInstalledItems();
    updateHomeProfileDisplay();
    loadFeaturedServers();
    loadHomeNewsCompact();
}

function getLoaderName(loader) {
    const names = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
    return names[loader] || 'Vanilla';
}

// Profile selector dropdown
const profileSelector = document.getElementById('profileSelector');
const profileDropdown = document.getElementById('profileDropdown');
const profileDropdownList = document.getElementById('profileDropdownList');

if (profileSelector) {
    profileSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        renderProfileDropdown();
        profileDropdown.classList.toggle('show');
    });
}

document.addEventListener('click', () => {
    if (profileDropdown) profileDropdown.classList.remove('show');
});

function renderProfileDropdown() {
    if (!profileDropdownList) return;

    profileDropdownList.innerHTML = profiles.map(profile => `
        <div class="profile-dropdown-item ${profile.id === selectedProfileId ? 'active' : ''}" data-id="${profile.id}">
            <span class="profile-dot" style="width:8px;height:8px;border-radius:50%;background:${profile.id === selectedProfileId ? 'var(--accent-purple)' : 'transparent'};flex-shrink:0;"></span>
            <div style="display:flex;flex-direction:column;gap:2px">
                <span style="font-weight:600;color:var(--text-primary);font-size:13px">${profile.name}</span>
                <span style="font-size:11px;color:var(--text-muted)">${profile.versionId || '1.20.1'} • ${getLoaderName(profile.loader)}</span>
            </div>
        </div>
    `).join('');

    profileDropdownList.querySelectorAll('.profile-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            selectProfile(item.dataset.id);
            profileDropdown.classList.remove('show');
        });
    });
}

// Profile page
function loadProfilesPage() {
    const container = document.getElementById('profilesList');
    if (!container) return;

    container.innerHTML = profiles.map(profile => `
        <div class="profile-item ${profile.id === selectedProfileId ? 'selected' : ''}" data-id="${profile.id}">
            <div class="profile-icon" style="background: ${getLoaderGradient(profile.loader)};">
                <svg viewBox="0 0 24 24" fill="white">${getLoaderIcon(profile.loader)}</svg>
            </div>
            <div class="profile-details">
                <span class="profile-title">${profile.name}</span>
                <span class="profile-meta">${profile.versionId || 'Не выбрана'} • ${getLoaderName(profile.loader)} • ${formatPlayTime(profile.totalPlayTime)} ${profile.id === selectedProfileId ? '• ' + (currentLang === 'ru' ? 'Активен' : 'Active') : ''}</span>
            </div>
            <div class="profile-actions">
                <button class="icon-btn select" data-id="${profile.id}" title="${currentLang === 'ru' ? 'Выбрать' : 'Select'}">▶</button>
                <button class="icon-btn duplicate" data-id="${profile.id}" title="${translations[currentLang].duplicate_instance || 'Duplicate'}">⧉</button>
                ${profile.id !== 'default' ? `<button class="icon-btn delete" data-id="${profile.id}" title="${currentLang === 'ru' ? 'Удалить' : 'Delete'}">🗑</button>` : ''}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.profile-item').forEach(item => {
        item.addEventListener('click', () => selectProfile(item.dataset.id));
    });
    container.querySelectorAll('.icon-btn.delete').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); deleteProfile(btn.dataset.id); });
    });
    container.querySelectorAll('.icon-btn.duplicate').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); duplicateProfile(btn.dataset.id); });
    });
}

async function duplicateProfile(profileId) {
    const result = await ipcRenderer.invoke('duplicate-profile', profileId);
    if (result.success) {
        profiles = result.profiles;
        loadProfilesPage();
        showToast(translations[currentLang].duplicate_instance || 'Duplicate', getSelectedProfile()?.name || '', 'success');
    } else {
        showToast('Error', result.error, 'error');
    }
}

function getLoaderGradient(loader) {
    const gradients = {
        vanilla: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
        fabric: 'linear-gradient(135deg, #4f7cff, #5ec8f2)',
        quilt: 'linear-gradient(135deg, #c9a6ff, #4f7cff)',
        forge: 'linear-gradient(135deg, #ff7a59, #d65a3a)',
        neoforge: 'linear-gradient(135deg, #f7a53b, #e8632c)'
    };
    return gradients[loader] || gradients.vanilla;
}

function getLoaderIcon(loader) {
    const icons = {
        vanilla: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
        fabric: '<polygon points="12 2 2 7 12 12 22 7"/>',
        quilt: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
        forge: '<path d="M12 2l3 4-2 2 3 3-2 2 3 4-5 2-5-2 3-4-2-2 3-3-2-2 3-4z"/>',
        neoforge: '<path d="M12 2l3 4-2 2 3 3-2 2 3 4-5 2-5-2 3-4-2-2 3-3-2-2 3-4z"/>'
    };
    return icons[loader] || icons.vanilla;
}

async function selectProfile(profileId) {
    selectedProfileId = profileId;
    await ipcRenderer.invoke('save-profiles', profiles);
    loadProfilesPage();
    updateHomeProfileDisplay();
    await loadInstalledItems();
    if (document.querySelector('#page-mods.active')) loadMods();
    if (document.querySelector('#page-shaders.active')) loadShaders();
    if (document.querySelector('#page-resourcepacks.active')) loadResourcePacks();
    showToast(translations[currentLang].profile_selected || 'Profile selected', getSelectedProfile()?.name || '', 'success');
}

async function deleteProfile(profileId) {
    const confirmText = currentLang === 'ru' ? 'Удалить профиль?' : 'Delete profile?';
    if (confirm(confirmText)) {
        const result = await ipcRenderer.invoke('delete-profile', profileId);
        if (result.success) {
            profiles = result.profiles;
            if (selectedProfileId === profileId) selectedProfileId = profiles[0]?.id || null;
            loadProfilesPage();
            updateHomeProfileDisplay();
            showToast(translations[currentLang].profile_deleted || 'Profile deleted', '', 'success');
        }
    }
}

// Create profile form
const showCreateBtn = document.getElementById('showCreateProfile');
const createForm = document.getElementById('createProfileForm');
const cancelCreateBtn = document.getElementById('cancelCreateProfile');
const createBtn = document.getElementById('createProfileBtn');
const loaderSelect = document.getElementById('profileLoaderSelect');
const loaderVersionGroup = document.getElementById('loaderVersionGroup');

if (showCreateBtn) {
    showCreateBtn.addEventListener('click', () => {
        createForm.style.display = createForm.style.display === 'none' ? 'block' : 'none';
    });
}
if (cancelCreateBtn) {
    cancelCreateBtn.addEventListener('click', () => { createForm.style.display = 'none'; });
}

if (loaderSelect) {
    loaderSelect.addEventListener('change', async () => {
        const loader = loaderSelect.value;
        if (loader === 'vanilla') {
            loaderVersionGroup.style.display = 'none';
        } else {
            loaderVersionGroup.style.display = 'block';
            const loaderVersionSelect = document.getElementById('loaderVersionSelect');
            loaderVersionSelect.innerHTML = `<option value="">${currentLang === 'ru' ? 'Последняя' : 'Latest'}</option>`;

            const mcVersion = document.getElementById('profileVersionSelect')?.value || '';

            if (loader === 'fabric') {
                const result = await ipcRenderer.invoke('get-fabric-loader-versions');
                if (result.success) {
                    result.loaders.forEach(v => {
                        const opt = document.createElement('option');
                        opt.value = v;
                        opt.textContent = v;
                        loaderVersionSelect.appendChild(opt);
                    });
                }
            } else if (loader === 'quilt') {
                const result = await ipcRenderer.invoke('get-quilt-loader-versions');
                if (result.success) {
                    result.loaders.forEach(v => {
                        const opt = document.createElement('option');
                        opt.value = v;
                        opt.textContent = v;
                        loaderVersionSelect.appendChild(opt);
                    });
                }
            } else if (loader === 'forge') {
                if (!mcVersion) {
                    showToast('MoonLauncher', currentLang === 'ru' ? 'Сначала выберите версию Minecraft' : 'Select a Minecraft version first', 'info');
                    return;
                }
                const result = await ipcRenderer.invoke('get-forge-versions', mcVersion);
                if (result.success && result.loaders.length) {
                    result.loaders.forEach(v => {
                        const opt = document.createElement('option');
                        opt.value = v;
                        opt.textContent = `Forge ${v}`;
                        loaderVersionSelect.appendChild(opt);
                    });
                } else {
                    showToast('MoonLauncher', currentLang === 'ru' ? 'Для этой версии Minecraft сборок Forge не найдено' : 'No Forge builds found for this Minecraft version', 'error');
                }
            } else if (loader === 'neoforge') {
                if (!mcVersion) {
                    showToast('MoonLauncher', currentLang === 'ru' ? 'Сначала выберите версию Minecraft' : 'Select a Minecraft version first', 'info');
                    return;
                }
                const result = await ipcRenderer.invoke('get-neoforge-versions', mcVersion);
                if (result.success && result.loaders.length) {
                    result.loaders.forEach(v => {
                        const opt = document.createElement('option');
                        opt.value = v;
                        opt.textContent = `NeoForge ${v}`;
                        loaderVersionSelect.appendChild(opt);
                    });
                } else {
                    showToast('MoonLauncher', currentLang === 'ru' ? 'Для этой версии Minecraft сборок NeoForge не найдено' : 'No NeoForge builds found for this Minecraft version', 'error');
                }
            }
        }
    });
}

if (createBtn) {
    createBtn.addEventListener('click', async () => {
        const name = document.getElementById('newProfileName')?.value;
        const versionId = document.getElementById('profileVersionSelect')?.value;
        const loader = document.getElementById('profileLoaderSelect')?.value || 'vanilla';
        const loaderVersion = document.getElementById('loaderVersionSelect')?.value || '';

        if (!name || !versionId) {
            showToast('Error', currentLang === 'ru' ? 'Введите название и выберите версию' : 'Enter name and select version', 'error');
            return;
        }

        const result = await ipcRenderer.invoke('create-profile', {
            name, versionId, version: versionId, loader, loaderVersion,
            javaArgs: '-Xmx2G -XX:+UseG1GC'
        });

        if (result.success) {
            profiles = result.profiles;
            document.getElementById('newProfileName').value = '';
            createForm.style.display = 'none';
            loadProfilesPage();
            showToast(translations[currentLang].profile_created || 'Profile created', name, 'success');
        }
    });
}

// ==================== PLAY BUTTON ====================
playBtn.addEventListener('click', async () => {
    if (gameState === 'running') {
        const result = await ipcRenderer.invoke('close-minecraft');
        if (!result.success) {
            showLaunchError(result.error || 'Не удалось закрыть игру', result.code || 'E_CLOSE');
        }
        return;
    }

    if (gameState === 'launching' || isLaunching) return;

    if (!currentUser || !currentUser.accessToken) {
        authModal.classList.add('show');
        showLaunchError(
            translations[currentLang].error_auth || 'Требуется авторизация',
            'E_AUTH'
        );
        return;
    }

    const profile = getSelectedProfile();
    if (!profile || !profile.versionId) {
        showLaunchError(
            translations[currentLang].error_select_version || 'Выберите профиль и версию',
            'E_NO_PROFILE'
        );
        navigateTo('profiles');
        return;
    }

    setPlayButtonState('loading');
    showLaunchModal();

    const launchProfile = { ...profile };
    if (pendingQuickConnectServer?.ip) {
        launchProfile.quickConnect = pendingQuickConnectServer;
        await ipcRenderer.invoke('set-quick-connect', pendingQuickConnectServer);
    }

    const result = await ipcRenderer.invoke('launch-minecraft', { profile: launchProfile, auth: currentUser });

    if (!result.success) {
        showLaunchError(result.error, result.code || 'E_LAUNCH', result.exitCode);
    }
});

async function syncGameRunningState() {
    const result = await ipcRenderer.invoke('is-game-running');
    if (result.success && result.running) {
        setPlayButtonState('running');
    }
}

// ==================== MODRINTH API ====================
const CATALOG_PAGE_SIZE = 50;

const catalogState = {
    mod: { items: [], offset: 0, total: 0, loading: false, hasMore: true, error: null },
    shader: { items: [], offset: 0, total: 0, loading: false, hasMore: true, error: null },
    resourcepack: { items: [], offset: 0, total: 0, loading: false, hasMore: true, error: null }
};

function buildModrinthFacets(type, version, loader, category) {
    const facetGroups = [[`project_type:${type}`]];
    if (version) facetGroups.push([`versions:${version}`]);
    if (type === 'mod' && loader && loader !== 'vanilla') {
        if (loader === 'quilt') {
            facetGroups.push(['categories:quilt', 'categories:fabric']);
        } else {
            facetGroups.push([`categories:${loader}`]);
        }
    }
    if (category) facetGroups.push([`categories:${category}`]);
    return JSON.stringify(facetGroups);
}

function modVersionMatchesLoader(versionLoaders, profileLoader) {
    if (!profileLoader || profileLoader === 'vanilla') return true;
    if (!Array.isArray(versionLoaders)) return false;
    if (versionLoaders.includes(profileLoader)) return true;
    if (profileLoader === 'quilt' && versionLoaders.includes('fabric')) return true;
    return false;
}

function findCompatibleModrinthVersion(versions, profile, itemType = 'mod') {
    if (!Array.isArray(versions) || !versions.length || !profile?.versionId) return null;
    const loader = profile.loader || 'vanilla';
    return versions.find(v => {
        if (!v.game_versions?.includes(profile.versionId)) return false;
        if (itemType === 'mod' && loader !== 'vanilla') {
            return modVersionMatchesLoader(v.loaders, loader);
        }
        return true;
    }) || null;
}

async function fetchModrinth(type, query = '', version = '', sort = 'relevance', limit = CATALOG_PAGE_SIZE, offset = 0, extra = {}) {
    try {
        const facets = buildModrinthFacets(type, version, extra.loader || '', extra.category || '');
        const params = new URLSearchParams({
            query,
            facets,
            index: sort,
            limit: limit.toString(),
            offset: offset.toString()
        });
        const response = await fetch(`${MODRINTH_API}/search?${params}`);
        if (!response.ok) throw new Error(`Modrinth API error (HTTP ${response.status})`);
        const data = await response.json();
        return {
            hits: data.hits || [],
            total: data.total_hits || 0,
            offset: data.offset ?? offset,
            error: null
        };
    } catch (error) {
        console.error('Modrinth fetch error:', error);
        // Раньше ошибка сети/API молча превращалась в пустой список — визуально
        // это выглядело так же, как "каталог реально пуст". Теперь прокидываем
        // текст ошибки наверх, чтобы её можно было показать пользователю.
        return { hits: [], total: 0, offset: 0, error: error.message || String(error) };
    }
}

function syncCatalogVersionFromProfile(selectId) {
    const profile = getSelectedProfile();
    const select = document.getElementById(selectId);
    if (!select || !profile?.versionId) return;
    const hasOption = [...select.options].some(o => o.value === profile.versionId);
    if (hasOption && !select.value) {
        select.value = profile.versionId;
    }
}

function updateCatalogMeta(type, state, hintId, countId) {
    const countEl = document.getElementById(countId);
    const hintEl = document.getElementById(hintId);
    const profile = getSelectedProfile();
    if (countEl) {
        countEl.textContent = state.total > 0
            ? `${state.items.length} / ${state.total}`
            : '';
    }
    if (hintEl && type === 'mod') {
        const loader = profile?.loader || 'vanilla';
        const version = document.getElementById('modsVersionFilter')?.value || profile?.versionId || '';
        const loaderLabel = getLoaderName(loader);
        hintEl.textContent = version
            ? `${translations[currentLang].catalog_for_loader || 'Mods for'} ${loaderLabel} • Minecraft ${version} • Modrinth`
            : 'Modrinth';
    }
}

function updateCatalogFooter(footerId, type, state, loadFn) {
    const footer = document.getElementById(footerId);
    if (!footer) return;
    if (state.loading && state.items.length === 0) {
        footer.innerHTML = `<span>${currentLang === 'ru' ? 'Загрузка...' : 'Loading...'}</span>`;
        return;
    }
    if (state.items.length === 0 && state.error) {
        footer.innerHTML = `<span style="color:var(--danger,#f04747)">${currentLang === 'ru' ? 'Не удалось загрузить каталог Modrinth' : 'Failed to load Modrinth catalog'}: ${state.error}</span> ` +
            `<button type="button" class="load-more-btn" id="retry_${type}">${currentLang === 'ru' ? 'Повторить' : 'Retry'}</button>`;
        document.getElementById(`retry_${type}`)?.addEventListener('click', () => loadFn(false));
        return;
    }
    if (state.items.length === 0) {
        footer.innerHTML = `<span>${translations[currentLang].no_installed || (currentLang === 'ru' ? 'Ничего не найдено' : 'Nothing found')}</span>`;
        return;
    }
    if (state.hasMore) {
        footer.innerHTML = `<button type="button" class="load-more-btn" id="loadMore_${type}">${translations[currentLang].load_more || 'Load more'} (${state.items.length}/${state.total})</button>`;
        document.getElementById(`loadMore_${type}`)?.addEventListener('click', () => loadFn(true));
    } else {
        footer.innerHTML = `<span>${translations[currentLang].showing_of || 'Showing'} ${state.items.length} ${currentLang === 'ru' ? 'из' : 'of'} ${state.total}</span>`;
    }
}

function setupCatalogInfiniteScroll(listId, loadFn, isInstalledTabFn) {
    const list = document.getElementById(listId);
    if (!list || list.dataset.scrollBound === '1') return;
    list.dataset.scrollBound = '1';
    list.addEventListener('scroll', () => {
        // Баг был здесь: этот listener навешивается один раз на весь срок жизни
        // контейнера и переживает переключение вкладок (меняется только innerHTML).
        // Из-за этого, если пользователь на вкладке "Установлено" долистывал список
        // вниз, срабатывал loadFn (догрузка каталога Modrinth) и в тот же контейнер
        // подмешивались обычные, НЕ установленные моды — визуально это выглядело
        // так, будто они уже установлены. Теперь при скролле сначала проверяем,
        // что активна именно вкладка каталога, а не "Установлено"/"Активные".
        if (isInstalledTabFn && isInstalledTabFn()) return;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 80) {
            loadFn(true);
        }
    });
}

// Раньше повторный заход на уже открытую вкладку каталога (например,
// Моды -> Шейдеры -> обратно на Моды с теми же фильтрами) заново бил в сеть
// к Modrinth и заново показывал "Загрузка...", хотя данные пять секунд назад
// уже приходили и не успели устареть. Кэшируем только первую страницу
// (offset 0) на короткое время — "Загрузить ещё" по-прежнему всегда идёт
// в сеть, свежесть первой страницы не критична в пределах минуты.
const catalogResponseCache = new Map();
const CATALOG_CACHE_TTL_MS = 60000;

async function loadCatalog(type, listId, footerId, countId, hintId, append = false) {
    const state = catalogState[type];
    if (state.loading) return;
    if (append && !state.hasMore) return;

    // Профиль, для которого стартовал этот запрос. Если пользователь успеет
    // переключить инстанс, пока идёт fetch к Modrinth (сеть может отвечать
    // секунды), ниже не даём устаревшему ответу перезаписать уже отрисованный
    // список нового профиля — раньше именно это выглядело как "подвисание"
    // вкладки: старые карточки модов дорисовывались поверх/вместо новых.
    const requestProfileId = selectedProfileId;

    if (!append) {
        state.items = [];
        state.offset = 0;
        state.total = 0;
        state.hasMore = true;
    }

    state.loading = true;
    const container = document.getElementById(listId);
    if (container && !append) {
        // Не трогаем dataset.scrollBound здесь: контейнер переживает переключение вкладок
        // (меняется только innerHTML), а setupCatalogInfiniteScroll ниже вешает listener
        // максимум один раз за всё время жизни этого элемента.
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">${currentLang === 'ru' ? 'Загрузка...' : 'Loading...'}</div>`;
    }
    const reload = (a) => loadCatalog(type, listId, footerId, countId, hintId, a);
    updateCatalogFooter(footerId, type, state, reload);

    await loadInstalledItems();

    const prefix = type === 'mod' ? 'mods' : type === 'shader' ? 'shaders' : 'resourcepacks';
    if (type === 'mod') syncCatalogVersionFromProfile('modsVersionFilter');

    const search = document.getElementById(`${prefix}Search`)?.value || '';
    const profile = getSelectedProfile();
    const version = document.getElementById(`${prefix}VersionFilter`)?.value || profile?.versionId || '';
    const sort = document.getElementById(`${prefix}Sort`)?.value || 'relevance';
    const category = type === 'mod' ? (document.getElementById('modsCategoryFilter')?.value || '') : '';
    const loader = type === 'mod' && profile?.loader && profile.loader !== 'vanilla' ? profile.loader : '';

    const cacheKey = !append ? `${type}|${search}|${version}|${sort}|${category}|${loader}` : null;
    const cached = cacheKey ? catalogResponseCache.get(cacheKey) : null;
    let result;
    if (cached && Date.now() - cached.timestamp < CATALOG_CACHE_TTL_MS) {
        result = cached.result;
    } else {
        result = await fetchModrinth(
            type === 'resourcepack' ? 'resourcepack' : type,
            search, version, sort, CATALOG_PAGE_SIZE, state.offset,
            { loader, category }
        );
        if (cacheKey && !result.error) {
            catalogResponseCache.set(cacheKey, { result, timestamp: Date.now() });
        }
    }

    if (selectedProfileId !== requestProfileId) {
        // Пока ждали ответ, пользователь уже переключился на другой инстанс -
        // этот результат больше не актуален, не трогаем состояние/DOM.
        state.loading = false;
        return;
    }

    const previousCount = state.items.length;
    state.total = result.total;
    state.items = append ? [...state.items, ...result.hits] : result.hits;
    state.offset = state.items.length;
    state.hasMore = state.items.length < state.total;
    state.loading = false;
    state.error = result.error || null;

    renderItems(listId, state.items, type, { append, renderedCount: append ? previousCount : 0 });
    if (hintId) updateCatalogMeta(type, state, hintId, countId);
    else if (countId) {
        const countEl = document.getElementById(countId);
        if (countEl) countEl.textContent = state.total > 0 ? `${state.items.length} / ${state.total}` : '';
    }
    updateCatalogFooter(footerId, type, state, reload);
    const isInstalledTabFn = () => (
        type === 'mod' ? modsTab === 'installed' :
        type === 'shader' ? shadersTab === 'installed' :
        (resourcepacksTab === 'installed' || resourcepacksTab === 'active')
    );
    setupCatalogInfiniteScroll(listId, reload, isInstalledTabFn);
}

async function getModrinthVersions(projectId) {
    try {
        const response = await fetch(`${MODRINTH_API}/project/${projectId}/version`);
        if (!response.ok) throw new Error('Failed to fetch versions');
        return await response.json();
    } catch (error) {
        console.error('Versions fetch error:', error);
        return [];
    }
}

function formatDownloads(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function getInstalledFilename(projectId, type) {
    const items = installedItemsDetail[type] || [];
    const found = items.find(i => i.projectId === projectId);
    return found?.filename || null;
}

function isItemInstalled(projectId, type) {
    return !!getInstalledFilename(projectId, type);
}

function createItemRow(item, type) {
    const iconUrl = item.icon_url || '';
    const firstLetter = (item.title || item.filename || '?').charAt(0).toUpperCase();
    const color = item.color ? `#${item.color.toString(16).padStart(6, '0')}` : 'var(--accent-purple)';
    const projectId = item.project_id || item.slug || item.projectId || item.filename;
    const isInstalled = item.filename ? true : isItemInstalled(projectId, type);
    const isActive = type === 'resourcepack' && item.filename && activeResourcePacks.includes(item.filename);

    let btnClass = 'install';
    let btnText = translations[currentLang].install || (currentLang === 'ru' ? 'Установить' : 'Install');
    let btnAction = 'install';

    if (isInstalled) {
        btnClass = 'delete';
        btnText = translations[currentLang].uninstall || (currentLang === 'ru' ? 'Удалить' : 'Delete');
        btnAction = 'uninstall';
    }
    if (type === 'resourcepack' && isInstalled && !isActive) {
        btnClass = 'install';
        btnText = translations[currentLang].enable || (currentLang === 'ru' ? 'Включить' : 'Enable');
        btnAction = 'enable';
    }
    if (type === 'resourcepack' && isActive) {
        btnClass = 'active-pack';
        btnText = translations[currentLang].disable || (currentLang === 'ru' ? 'Выключить' : 'Disable');
        btnAction = 'disable';
    }

    // SECURITY: title/meta/description/icon_url приходят с публичного Modrinth API —
    // это данные, которые контролирует автор мода, а не мы. Раньше вставлялись в
    // innerHTML без экранирования → любой автор мода с "вредным" названием мог
    // выполнить произвольный JS (а из-за nodeIntegration:true — произвольный код
    // Node.js) у каждого, кто открыл каталог. Теперь всё текстовое экранируется
    // через escapeHtml() перед вставкой.
    const titleRaw = item.title || item.filename || 'Unknown';
    const title = escapeHtml(titleRaw);
    const descRaw = item.description || '';
    const desc = descRaw ? escapeHtml(stripHtml(descRaw).substring(0, 120)) : '';
    const metaRaw = item.author
        ? `${item.author}${item.display_categories?.length ? ' • ' + item.display_categories.slice(0, 2).join(', ') : ''}`
        : (item.filename || '');
    const meta = escapeHtml(metaRaw);
    const safeIconUrl = escapeHtml(iconUrl);
    const safeFilename = escapeHtml(item.filename || '');
    const safeLatestVersion = escapeHtml(item.latest_version || '');

    return `
        <div class="item-row" data-id="${escapeHtml(projectId || '')}" data-filename="${safeFilename}" data-type="${type}">
            ${iconUrl ?
                `<img src="${safeIconUrl}" alt="${title}" class="item-icon" width="40" height="40" loading="lazy" decoding="async" onerror="this.style.display='none'; this.parentElement.insertAdjacentHTML('afterbegin', '<div class=\\'item-icon-placeholder\\' style=\\'background: ${color}20; color: ${color}\\'>${escapeHtml(firstLetter)}</div>');">` :
                `<div class="item-icon-placeholder" style="background: ${color}20; color: ${color}">${escapeHtml(firstLetter)}</div>`
            }
            <div class="item-info">
                <span class="item-title">${title}${isActive ? `<span class="item-badge active">${currentLang === 'ru' ? 'Активен' : 'Active'}</span>` : ''}</span>
                <span class="item-meta">${meta}</span>
                ${desc ? `<span class="item-desc">${desc}${descRaw.length > 120 ? '…' : ''}</span>` : ''}
            </div>
            <div class="item-stats">
                ${item.downloads !== undefined ? `<span class="item-downloads">${formatDownloads(item.downloads)}</span>` : ''}
                ${item.latest_version ? `<span class="item-version">${safeLatestVersion}</span>` : ''}
            </div>
            <button class="item-btn ${btnClass}" data-id="${escapeHtml(projectId || '')}" data-filename="${safeFilename}" data-type="${type}" data-action="${btnAction}">${btnText}</button>
        </div>
    `;
}

function bindItemButtons(container, type) {
    if (!container) return;
    container.querySelectorAll('.item-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const projectId = btn.dataset.id;
            const filename = btn.dataset.filename;
            if (action === 'install') installModrinthItem(projectId, type);
            else if (action === 'uninstall') uninstallItem(filename, type, projectId);
            else if (action === 'enable') toggleResourcePack(filename, true);
            else if (action === 'disable') toggleResourcePack(filename, false);
        });
    });
}

function renderItems(listId, items, type, options = {}) {
    const container = document.getElementById(listId);
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">${translations[currentLang].no_installed || (currentLang === 'ru' ? 'Ничего не найдено' : 'Nothing found')}</div>`;
        container.dataset.rendered = '';
        return;
    }

    if (options.append && container.dataset.rendered === '1') {
        // Раньше здесь при каждой подгрузке (infinite scroll / "Загрузить ещё")
        // весь container.innerHTML перезаписывался ЗАНОВО для ВСЕГО накопленного
        // списка, включая уже отрисованные карточки. Браузер пересоздавал все
        // DOM-узлы и повторно скачивал/декодировал уже загруженные иконки модов
        // с нуля. Чем дольше скроллили каталог (тысячи модов, страницы по 50),
        // тем больше становился накопленный список — стоимость каждого ре-рендера
        // росла линейно с общим числом уже показанных карточек (по сути O(n^2)
        // за сессию скролла), из-за чего лаунчер ощутимо начинал лагать после
        // нескольких подгрузок. Теперь дорисовываем только реально новые карточки.
        const newItems = items.slice(options.renderedCount || 0);
        if (newItems.length === 0) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = newItems.map(item => createItemRow(item, type)).join('');
        const fragment = document.createDocumentFragment();
        while (wrap.firstChild) fragment.appendChild(wrap.firstChild);
        bindItemButtons(fragment, type);
        container.appendChild(fragment);
        container.dataset.rendered = '1';
        return;
    }

    container.innerHTML = items.map(item => createItemRow(item, type)).join('');
    container.dataset.rendered = '1';
    bindItemButtons(container, type);
}

async function installModrinthItem(projectId, type) {
    const profile = getSelectedProfile();
    if (!profile || !profile.versionId) {
        showToast('Error', currentLang === 'ru' ? 'Сначала выберите профиль с версией Minecraft' : 'First select a profile with Minecraft version', 'error');
        navigateTo('profiles');
        return;
    }

    const btn = document.querySelector(`[data-id="${projectId}"] .item-btn`);
    if (btn) { btn.textContent = currentLang === 'ru' ? 'Загрузка...' : 'Downloading...'; btn.disabled = true; }

    try {
        const versions = await getModrinthVersions(projectId);
        const loader = profile.loader || 'vanilla';
        if (type === 'mod' && loader === 'vanilla') {
            showToast('Error', currentLang === 'ru' ? 'Выберите профиль с Fabric или Quilt для установки модов' : 'Select a Fabric or Quilt profile to install mods', 'error');
            if (btn) { btn.disabled = false; btn.textContent = translations[currentLang].install; }
            return;
        }
        const compatibleVersion = findCompatibleModrinthVersion(versions, profile, type);

        if (!compatibleVersion) {
            const loaderLabel = getLoaderName(loader);
            showToast('Error', (currentLang === 'ru'
                ? `Нет версии для ${loaderLabel} • Minecraft ${profile.versionId}`
                : `No version for ${loaderLabel} • Minecraft ${profile.versionId}`), 'error');
            if (btn) { btn.textContent = currentLang === 'ru' ? 'Установить' : 'Install'; btn.disabled = false; }
            return;
        }

        const result = await ipcRenderer.invoke('download-modrinth', {
            projectId, versionId: compatibleVersion.id, type, profile
        });

        if (result.success) {
            showToast('Success', `${result.filename} ${currentLang === 'ru' ? 'установлен' : 'installed'}`, 'success');
            await loadInstalledItems(true);
            if (!refreshCatalogItemState(type, projectId, result.filename)) {
                reloadContentTab(type);
            }
        } else {
            showToast('Error', result.error, 'error');
            if (btn) { btn.textContent = translations[currentLang].install; btn.disabled = false; }
        }
    } catch (error) {
        showToast('Error', error.message, 'error');
        if (btn) { btn.textContent = translations[currentLang].install; btn.disabled = false; }
    }
}

async function uninstallItem(filename, type, projectId) {
    if (!filename) filename = getInstalledFilename(projectId, type);
    if (!filename) return;
    const confirmMsg = currentLang === 'ru' ? `Удалить ${filename}?` : `Delete ${filename}?`;
    if (!confirm(confirmMsg)) return;
    const profile = getSelectedProfile();
    const result = await ipcRenderer.invoke('uninstall-modrinth-item', { filename, type, profile });
    if (result.success) {
        showToast(translations[currentLang].item_deleted || 'Removed', filename, 'success');
        await loadInstalledItems(true);
        if (!refreshCatalogItemState(type, projectId, null)) {
            reloadContentTab(type);
        }
    } else {
        showToast('Error', result.error, 'error');
    }
}

async function toggleResourcePack(filename, active) {
    const profile = getSelectedProfile();
    const gameDir = profile?.gameDir || launcherPaths.minecraft;
    const result = await ipcRenderer.invoke('toggle-resourcepack', { filename, active, gameDir });
    if (result.success) {
        activeResourcePacks = result.packs;
        showToast(active ? (translations[currentLang].item_enabled || 'Enabled') : (translations[currentLang].item_disabled || 'Disabled'), filename, 'success');
        reloadContentTab('resourcepack');
    } else {
        showToast('Error', result.error, 'error');
    }
}

async function loadActiveResourcePacks() {
    const profile = getSelectedProfile();
    const gameDir = profile?.gameDir || launcherPaths.minecraft;
    const result = await ipcRenderer.invoke('get-active-resourcepacks', { gameDir });
    if (result.success) activeResourcePacks = result.packs || [];
}

function markCatalogItemInstalled(projectId, type, filename) {
    const row = document.querySelector(`.item-row[data-id="${projectId}"]`);
    if (!row) return;
    row.dataset.filename = filename || '';
    const btn = row.querySelector('.item-btn');
    if (!btn) return;
    btn.className = 'item-btn delete';
    btn.textContent = translations[currentLang].uninstall || (currentLang === 'ru' ? 'Удалить' : 'Delete');
    btn.dataset.action = 'uninstall';
    btn.dataset.filename = filename || '';
    btn.disabled = false;
}

function markCatalogItemUninstalled(projectId) {
    const row = document.querySelector(`.item-row[data-id="${projectId}"]`);
    if (!row) return;
    row.dataset.filename = '';
    const btn = row.querySelector('.item-btn');
    if (!btn) return;
    btn.className = 'item-btn install';
    btn.textContent = translations[currentLang].install || (currentLang === 'ru' ? 'Установить' : 'Install');
    btn.dataset.action = 'install';
    btn.dataset.filename = '';
    btn.disabled = false;
}

function refreshCatalogItemState(type, projectId, filename) {
    if (type === 'mod' && modsTab !== 'installed') {
        if (filename) markCatalogItemInstalled(projectId, type, filename);
        else markCatalogItemUninstalled(projectId);
        updateHomeProfileDisplay();
        return true;
    }
    return false;
}

function reloadContentTab(type) {
    if (type === 'mod') {
        if (modsTab === 'installed') renderInstalledList('modsList', 'mod');
        else loadMods();
    } else if (type === 'shader') {
        if (shadersTab === 'installed') renderInstalledList('shadersList', 'shader');
        else loadShaders();
    } else if (type === 'resourcepack') {
        if (resourcepacksTab === 'installed') renderInstalledList('resourcepacksList', 'resourcepack');
        else if (resourcepacksTab === 'active') renderActiveResourcePacks();
        else loadResourcePacks();
    }
}

function renderInstalledList(listId, type) {
    const items = (installedItemsDetail[type] || []).map(item => ({
        title: item.title,
        filename: item.filename,
        projectId: item.projectId,
        icon_url: item.iconUrl || '',
        color: item.color ?? null,
        author: currentLang === 'ru' ? 'Установлено' : 'Installed'
    }));
    renderItems(listId, items, type);
}

async function renderActiveResourcePacks() {
    await loadActiveResourcePacks();
    if (activeResourcePacks.length === 0) {
        const container = document.getElementById('resourcepacksList');
        if (container) container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">${translations[currentLang].no_active_packs || 'No active packs'}</div>`;
        return;
    }
    const items = activeResourcePacks.map(filename => {
        const detail = installedItemsDetail.resourcepack.find(i => i.filename === filename);
        return {
            title: detail?.title || filename.replace('.zip', ''),
            filename,
            projectId: detail?.projectId || filename,
            icon_url: detail?.iconUrl || '',
            color: detail?.color ?? null
        };
    });
    renderItems('resourcepacksList', items, 'resourcepack');
}

async function loadMods(append = false) {
    loadFeaturedMods();
    if (modsTab === 'installed') {
        await loadInstalledItems();
        renderInstalledList('modsList', 'mod');
        const footer = document.getElementById('modsListFooter');
        const count = document.getElementById('modsCount');
        if (footer) footer.innerHTML = `<span>${installedItemsDetail.mod.length} ${currentLang === 'ru' ? 'установлено' : 'installed'}</span>`;
        if (count) count.textContent = String(installedItemsDetail.mod.length);
        return;
    }
    await loadCatalog('mod', 'modsList', 'modsListFooter', 'modsCount', 'modsCatalogHint', append);
}

// ==================== ФИРМЕННЫЕ МОДЫ (MaxFPS и т.д. — раздаются с сайта, не с Modrinth) ====================
let featuredModsCache = null;
let featuredModsCacheTime = 0;
const FEATURED_MODS_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchFeaturedMods() {
    if (featuredModsCache && Date.now() - featuredModsCacheTime < FEATURED_MODS_CACHE_TTL_MS) return featuredModsCache;
    try {
        const response = await fetchWithTimeout(`${MOONLAUNCHER_API}/mods/list.json`);
        if (!response.ok) throw new Error('bad status');
        const data = await response.json();
        featuredModsCache = Array.isArray(data) ? data : (data.mods || []);
        featuredModsCacheTime = Date.now();
        return featuredModsCache;
    } catch (e) {
        return featuredModsCache || [];
    }
}

// Рисует баннер(ы) фирменных модов над каталогом Modrinth на странице Моды.
// Не зависит от того, какая вкладка (Все моды / Установленные) активна — это
// отдельный источник, не строка каталога Modrinth, поэтому установлен/не установлен
// определяем по installedMods (общий список файлов текущего профиля).
async function loadFeaturedMods() {
    const container = document.getElementById('featuredModsBlock');
    if (!container) return;
    const mods = await fetchFeaturedMods();
    if (!mods.length) { container.innerHTML = ''; return; }

    await loadInstalledItems();

    container.innerHTML = mods.map(mod => {
        const isInstalled = installedMods.includes(mod.filename);
        const actionLabel = isInstalled
            ? (currentLang === 'ru' ? 'Удалить' : 'Remove')
            : (currentLang === 'ru' ? 'Установить' : 'Install');
        return `
        <div class="featured-mod-card">
            <div class="item-icon-placeholder">${escapeHtml(mod.icon || '⚡')}</div>
            <div class="featured-mod-info">
                <div class="featured-mod-title">${escapeHtml(mod.name || 'Мод')}
                    <span class="featured-mod-badge">${escapeHtml(mod.loader || 'fabric')} ${escapeHtml(mod.mcVersion || '')}</span>
                </div>
                <div class="featured-mod-desc">${escapeHtml(mod.description || '')}</div>
            </div>
            <button class="item-btn ${isInstalled ? 'delete' : 'install'}" data-action="${isInstalled ? 'uninstall' : 'install'}" data-mod-id="${escapeHtml(mod.id)}">${actionLabel}</button>
        </div>`;
    }).join('');

    container.querySelectorAll('.featured-mod-card .item-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mod = mods.find(m => m.id === btn.dataset.modId);
            if (!mod) return;
            if (btn.dataset.action === 'install') installFeaturedMod(mod, btn);
            else uninstallFeaturedMod(mod, btn);
        });
    });
}

async function installFeaturedMod(mod, btn) {
    const profile = getSelectedProfile();
    if (!profile) {
        showToast('Error', currentLang === 'ru' ? 'Сначала выберите профиль' : 'Select a profile first', 'error');
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = currentLang === 'ru' ? 'Загрузка...' : 'Downloading...'; }
    const result = await ipcRenderer.invoke('download-featured-mod', { mod, profile });
    if (result.success) {
        showToast(currentLang === 'ru' ? 'Мод установлен' : 'Mod installed', `${mod.name || mod.filename} → ${profile.name}`, 'success');
        await loadInstalledItems(true);
        loadFeaturedMods();
        reloadContentTab('mod');
        updateHomeProfileDisplay();
    } else {
        showToast('Error', result.error, 'error');
        if (btn) { btn.disabled = false; btn.textContent = currentLang === 'ru' ? 'Установить' : 'Install'; }
    }
}

async function uninstallFeaturedMod(mod, btn) {
    const confirmText = currentLang === 'ru' ? `Удалить ${mod.name || mod.filename}?` : `Delete ${mod.name || mod.filename}?`;
    if (!confirm(confirmText)) return;
    const profile = getSelectedProfile();
    const result = await ipcRenderer.invoke('uninstall-modrinth-item', { filename: mod.filename, type: 'mod', profile });
    if (result.success) {
        showToast(translations[currentLang].item_deleted || 'Removed', mod.filename, 'success');
        await loadInstalledItems(true);
        loadFeaturedMods();
        reloadContentTab('mod');
        updateHomeProfileDisplay();
    } else {
        showToast('Error', result.error, 'error');
    }
}

async function loadShaders(append = false) {
    if (shadersTab === 'installed') {
        await loadInstalledItems();
        renderInstalledList('shadersList', 'shader');
        const footer = document.getElementById('shadersListFooter');
        if (footer) footer.innerHTML = '';
        return;
    }
    await loadCatalog('shader', 'shadersList', 'shadersListFooter', 'shadersCount', null, append);
}

async function loadResourcePacks(append = false) {
    if (resourcepacksTab === 'installed') {
        await loadInstalledItems();
        renderInstalledList('resourcepacksList', 'resourcepack');
        return;
    }
    if (resourcepacksTab === 'active') {
        await loadInstalledItems();
        await renderActiveResourcePacks();
        return;
    }
    await loadCatalog('resourcepack', 'resourcepacksList', 'resourcepacksListFooter', 'resourcepacksCount', null, append);
}

async function loadInstalledItems(force = false) {
    const profile = getSelectedProfile();
    const profileKey = profile?.id || 'default';
    // Раньше этот IPC-вызов (обход файловой системы в main-процессе) дёргался
    // заново при КАЖДОМ открытии вкладки каталога и при каждом переключении
    // Моды <-> Шейдеры <-> Ресурс-паки, хотя набор установленных файлов между
    // этими вызовами почти всегда не менялся — именно частые повторные IPC
    // round-trip'ы и делали переключение вкладок ощутимо более медленным
    // при быстром "прощёлкивании" каталога. Теперь результат кэшируется на
    // профиль и переиспользуется, пока кто-то явно не попросит обновить его
    // (после install/uninstall/toggle, импорта сборки) или пока не сменился
    // сам профиль (тогда ключ кэша меняется и мы всё равно перезапросим).
    if (!force && installedItemsProfileId === profileKey) return;

    // Один батч-вызов вместо четырёх последовательных (mod/shader/resourcepack +
    // active packs) — раньше это было главной причиной подтормаживания всего окна
    // при переключении инстанса (см. комментарий у ensureProfileGameDirsAsync в main.js).
    const result = await ipcRenderer.invoke('get-installed-items-all', { profile });
    if (result.success) {
        installedItemsDetail.mod = result.items.mod;
        installedMods = result.items.mod.map(i => i.filename);
        installedItemsDetail.shader = result.items.shader;
        installedShaders = result.items.shader.map(i => i.filename);
        installedItemsDetail.resourcepack = result.items.resourcepack;
        installedResourcepacks = result.items.resourcepack.map(i => i.filename);
        activeResourcePacks = result.activeResourcePacks || [];
        installedItemsProfileId = profileKey;
    }
}

function setupContentTabs(pageSelector, tabSetter, loadFn) {
    document.querySelectorAll(`${pageSelector} .tab`).forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll(`${pageSelector} .tab`).forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabSetter(tab.dataset.tab);
            loadFn();
        });
    });
}

setupContentTabs('#page-mods', (tab) => { modsTab = tab; }, loadMods);
setupContentTabs('#page-shaders', (tab) => { shadersTab = tab; }, loadShaders);
setupContentTabs('#page-resourcepacks', (tab) => { resourcepacksTab = tab; }, loadResourcePacks);

let searchTimeout;
function setupSearch(inputId, loadFn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadFn, 500);
    });
}

setupSearch('modsSearch', loadMods);
setupSearch('shadersSearch', loadShaders);
setupSearch('resourcepacksSearch', loadResourcePacks);

document.getElementById('modsCategoryFilter')?.addEventListener('change', () => loadMods(false));
document.getElementById('modsVersionFilter')?.addEventListener('change', () => loadMods(false));
document.getElementById('modsSort')?.addEventListener('change', () => loadMods(false));
document.getElementById('shadersVersionFilter')?.addEventListener('change', () => loadShaders(false));
document.getElementById('shadersSort')?.addEventListener('change', () => loadShaders(false));
document.getElementById('resourcepacksVersionFilter')?.addEventListener('change', () => loadResourcePacks(false));
document.getElementById('resourcepacksSort')?.addEventListener('change', () => loadResourcePacks(false));

// ==================== MODPACK SHARE ====================
const modpackModal = document.getElementById('modpackModal');
const modpackProgressFill = document.getElementById('modpackProgressFill');
const modpackPercent = document.getElementById('modpackPercent');
const modpackStage = document.getElementById('modpackStage');
const modpackDetail = document.getElementById('modpackDetail');
const modpackCodeBox = document.getElementById('modpackCodeBox');
const generatedModpackCode = document.getElementById('generatedModpackCode');
const modpackHint = document.getElementById('modpackHint');

function showModpackModal() {
    if (!modpackModal) return;
    modpackModal.classList.add('show');
    if (modpackProgressFill) modpackProgressFill.style.width = '0%';
    if (modpackPercent) modpackPercent.textContent = '0%';
    if (modpackStage) modpackStage.textContent = currentLang === 'ru' ? 'Подготовка...' : 'Preparing...';
    if (modpackDetail) modpackDetail.textContent = '';
}

function hideModpackModal() {
    if (modpackModal) modpackModal.classList.remove('show');
}

function updateModpackProgress(progress) {
    if (modpackProgressFill) modpackProgressFill.style.width = (progress.percent || 0) + '%';
    if (modpackPercent) modpackPercent.textContent = Math.round(progress.percent || 0) + '%';
    if (modpackStage) modpackStage.textContent = progress.message || '';
    if (modpackDetail && progress.total) {
        modpackDetail.textContent = `${progress.completed || 0} / ${progress.total}`;
    }
    if (progress.stage === 'done' || progress.stage === 'error') {
        setTimeout(hideModpackModal, 2500);
    }
}

ipcRenderer.on('modpack-import-progress', (event, progress) => {
    updateModpackProgress(progress);
});

document.getElementById('generateModpackBtn')?.addEventListener('click', async () => {
    const profile = getSelectedProfile();
    if (!profile?.versionId) {
        showToast('Error', translations[currentLang].error_select_version || 'Select profile', 'error');
        navigateTo('profiles');
        return;
    }

    const btn = document.getElementById('generateModpackBtn');
    if (btn) btn.disabled = true;

    try {
        const result = await ipcRenderer.invoke('generate-modpack-code', { profile });
        if (result.success) {
            if (modpackCodeBox) modpackCodeBox.style.display = 'flex';
            if (generatedModpackCode) generatedModpackCode.value = result.code;
            if (modpackHint) {
                const base = `${result.modCount} ${currentLang === 'ru' ? 'модов' : 'mods'} • ${profile.versionId} • ${result.source === 'server' ? 'MOON' : 'ML1'}`;
                modpackHint.textContent = result.source === 'local'
                    ? base + (currentLang === 'ru'
                        ? ' — сайт недоступен, код сохранён локально (работает офлайн, просто длиннее)'
                        : ' — site unreachable, code stored locally (still works offline, just longer)')
                    : base;
            }
            showToast(
                translations[currentLang].modpack_code_created || 'Code created',
                result.code,
                'success'
            );
        } else {
            showToast('Error', result.error, 'error');
        }
    } catch (e) {
        showToast('Error', e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
});

document.getElementById('copyModpackCodeBtn')?.addEventListener('click', async () => {
    const code = generatedModpackCode?.value;
    if (!code) return;
    try {
        await navigator.clipboard.writeText(code);
        showToast(translations[currentLang].modpack_code_copied || 'Copied', code, 'success');
    } catch (e) {
        generatedModpackCode.select();
        document.execCommand('copy');
        showToast(translations[currentLang].modpack_code_copied || 'Copied', code, 'success');
    }
});

document.getElementById('importModpackBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('importModpackInput')?.value?.trim();
    if (!code) {
        showToast('Error', currentLang === 'ru' ? 'Введите код сборки' : 'Enter pack code', 'error');
        return;
    }

    const profile = getSelectedProfile();
    const btn = document.getElementById('importModpackBtn');
    if (btn) btn.disabled = true;

    showModpackModal();

    try {
        const result = await ipcRenderer.invoke('import-modpack-code', { code, profile });
        if (result.success) {
            await loadInstalledItems(true);
            await loadMods();
            const msg = result.failed > 0
                ? `${translations[currentLang].modpack_import_partial}: ${result.installed}/${result.total}`
                : `${translations[currentLang].modpack_import_done}: ${result.installed} ${currentLang === 'ru' ? 'модов' : 'mods'}`;
            showToast('Success', msg, result.failed > 0 ? 'info' : 'success');
            if (modpackHint) modpackHint.textContent = msg;
        } else {
            showToast('Error', result.error, 'error');
            updateModpackProgress({ stage: 'error', message: result.error, percent: 0 });
        }
    } catch (e) {
        showToast('Error', e.message, 'error');
        updateModpackProgress({ stage: 'error', message: e.message, percent: 0 });
    } finally {
        if (btn) btn.disabled = false;
    }
});

document.getElementById('modpackCloseBtn')?.addEventListener('click', hideModpackModal);

async function joinServerQuick(ip, port = 25565, name = '') {
    pendingQuickConnectServer = { ip, port: port || 25565, name };
    await ipcRenderer.invoke('set-quick-connect', pendingQuickConnectServer);
    updateQuickServerHint();
    navigateTo('home');
    showToast(translations[currentLang].quick_connect_set || 'Quick connect', name || ip, 'info');
    if (currentUser?.accessToken) {
        playBtn.click();
    } else {
        authModal.classList.add('show');
    }
}
window.joinServerQuick = joinServerQuick;

// Обычный fetch() без таймаута может висеть довольно долго, если хост
// (moonlauncher.ru) сейчас недоступен — например, сайт просто не запущен
// в данный момент. Раньше это ощущалось как "лаги" именно на Главной,
// потому что loadHomeNewsCompact/fetchMoonServers ждали дефолтный таймаут
// браузера/ОС, прежде чем упасть в catch{}. Жёстко ограничиваем ожидание.
async function fetchWithTimeout(url, timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function loadFeaturedServers() {
    const container = document.getElementById('featuredServers');
    if (!container) return;
    const allServers = await fetchMoonServers();
    const featured = allServers.filter(s => s.favorite).slice(0, 3);
    const displayFeatured = featured.length ? featured : allServers.slice(0, 3);
    if (!displayFeatured.length) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${currentLang === 'ru' ? 'Нет рекомендуемых серверов' : 'No featured servers'}</div>`;
        return;
    }
    // SECURITY: server.name/icon приходят из api/servers/list.json (админка сайта).
    // Раньше подставлялись без экранирования прямо в HTML и в JS-строку внутри
    // onclick="joinServerQuick('...')" — кавычка в названии сервера ломала бы
    // JS-контекст и позволяла выполнить произвольный код (RCE из-за
    // nodeIntegration:true). Экранируем текст и переносим обработчик клика на
    // addEventListener с данными из dataset — тогда содержимое name/ip никогда
    // не парсится как JS/HTML.
    container.innerHTML = displayFeatured.map(server => `
        <div class="featured-server-card" data-ip="${escapeHtml(server.ip)}">
            <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" loading="lazy">
            <div class="fs-info">
                <span class="fs-name">${escapeHtml(server.name)}</span>
                <span class="fs-meta">${escapeHtml(server.typeName[currentLang] || server.typeName.ru)} • ${escapeHtml(server.version)}</span>

            </div>
            <span class="fs-online" data-ip="${escapeHtml(server.ip)}">...</span>
            <button class="server-join-btn" data-join-ip="${escapeHtml(server.ip)}" data-join-port="${server.port || 25565}" data-join-name="${escapeHtml(server.name)}">${translations[currentLang].join_server || 'Play'}</button>
        </div>
    `).join('');

    container.querySelectorAll('.server-join-btn[data-join-ip]').forEach(btn => {
        btn.addEventListener('click', () => {
            joinServerQuick(btn.dataset.joinIp, parseInt(btn.dataset.joinPort, 10) || 25565, btn.dataset.joinName || '');
        });
    });

    displayFeatured.forEach(async (server) => {
        const result = await ipcRenderer.invoke('ping-server', { ip: server.ip, port: server.port || 25565 });
        const el = container.querySelector(`.fs-online[data-ip="${server.ip}"]`);
        const metaEl = container.querySelector(`.featured-server-card[data-ip="${server.ip}"] .fs-meta`);
        if (!el) return;
        if (result.success) {
            el.textContent = `${result.online}/${result.max}`;
            if (metaEl && result.version) {
                const typePart = (server.typeName[currentLang] || server.typeName.ru);
                metaEl.textContent = `${typePart} • ${result.version}`;
            }
        } else {
            el.textContent = currentLang === 'ru' ? 'Оффлайн' : 'Offline';
        }
    });
}

let cachedHomeNews = null;
let homeNewsCacheTime = 0;

async function loadHomeNewsCompact() {
    const container = document.getElementById('homeNewsList');
    if (!container) return;
    // Раньше это грузилось заново при КАЖДОМ заходе на Главную (переключение
    // инстанса → Главная тоже задевает эту функцию через refreshHomePanel) —
    // без кэша и без таймаута, то есть при недоступном сайте каждый такой
    // заход подвисал на дефолтном таймауте fetch(). Кэшируем на 60с, как и
    // список серверов в fetchMoonServers.
    if (cachedHomeNews && Date.now() - homeNewsCacheTime < 60000) {
        renderHomeNewsCompact(container, cachedHomeNews);
        return;
    }
    try {
        const response = await fetchWithTimeout(`${MOONLAUNCHER_API}/news/list.json`);
        if (response.ok) {
            const data = await response.json();
            const news = data.news || data;
            if (news?.length) {
                cachedHomeNews = news;
                homeNewsCacheTime = Date.now();
                renderHomeNewsCompact(container, news);
                return;
            }
        }
    } catch (e) {}
    container.innerHTML = `<div class="home-news-empty">${currentLang === 'ru' ? 'Новостей пока нет' : 'No news yet'}</div>`;
}

function renderHomeNewsCompact(container, news) {
    // SECURITY: title/link приходят из api/news/list.json (админка сайта). Раньше
    // title вставлялся без экранирования, а link — прямо в JS-строку внутри
    // onclick="require('electron').shell.openExternal('...')": кавычка в ссылке
    // ломала JS-контекст и позволяла выполнить произвольный код с доступом к
    // Node.js. Экранируем текст и передаём link через dataset, а не через
    // литерал в атрибуте.
    const items = news.slice(0, 3).map(item => ({
        title: item.title,
        date: item.date || '',
        link: item.link || '#'
    }));
    container.innerHTML = items.map(item => `
        <div class="home-news-item" data-news-link="${escapeHtml(item.link)}">
            <span class="news-title">${escapeHtml(item.title)}</span>
            <span class="news-date">${escapeHtml(item.date)}</span>
        </div>
    `).join('');
    container.querySelectorAll('.home-news-item[data-news-link]').forEach(el => {
        el.addEventListener('click', () => {
            require('electron').shell.openExternal(el.dataset.newsLink);
        });
    });
}

// ==================== SERVERS ====================
let cachedServers = [];
let serversCacheTime = 0;

const SERVER_TYPE_MAP = {
    'Выживание': { id: 'survival', ru: 'Выживание', en: 'Survival' },
    'SkyBlock': { id: 'skyblock', ru: 'SkyBlock', en: 'SkyBlock' },
    'Мини-игры': { id: 'minigames', ru: 'Мини-игры', en: 'Minigames' },
    'Креатив': { id: 'creative', ru: 'Креатив', en: 'Creative' },
    'Анархия': { id: 'anarchy', ru: 'Анархия', en: 'Anarchy' },
    'MMORPG': { id: 'mmorpg', ru: 'MMORPG', en: 'MMORPG' }
};

function normalizeServer(raw) {
    const typeInfo = SERVER_TYPE_MAP[raw.type] || {
        id: (raw.type || 'survival').toLowerCase().replace(/\s+/g, ''),
        ru: raw.type || 'Сервер',
        en: raw.type || 'Server'
    };
    return {
        ip: raw.ip,
        port: raw.port || 25565,
        name: raw.name,
        type: typeInfo.id,
        typeName: { ru: typeInfo.ru, en: typeInfo.en },
        version: raw.version || '—',
        icon: raw.icon || `https://mc-heads.net/avatar/${encodeURIComponent(raw.name || 'Server')}`,
        favorite: !!raw.favorite
    };
}

async function fetchMoonServers(force = false) {
    if (!force && cachedServers.length && Date.now() - serversCacheTime < 60000) {
        return cachedServers;
    }
    try {
        const response = await fetchWithTimeout(`${MOONLAUNCHER_API}/servers/list.json`);
        if (response.ok) {
            const data = await response.json();
            const list = Array.isArray(data) ? data : (data.servers || []);
            if (list.length) {
                cachedServers = list.map(normalizeServer);
                serversCacheTime = Date.now();
                return cachedServers;
            }
        }
    } catch (e) {}
    return cachedServers;
}

async function loadServers() {
    const container = document.getElementById('serversList');
    if (!container) return;

    const favResult = await ipcRenderer.invoke('get-favorite-servers');
    if (favResult.success) favoriteServers = favResult.favorites || [];

    const activeTab = document.querySelector('#page-servers .tab.active')?.dataset.tab || 'all';
    const search = document.getElementById('serversSearch')?.value?.toLowerCase() || '';
    const typeFilter = document.getElementById('serversTypeFilter')?.value || '';

    const allServers = await fetchMoonServers(true);
    let serversToShow = activeTab === 'favorites'
        ? allServers.filter(s => favoriteServers.includes(s.ip))
        : [...allServers];

    if (search) {
        serversToShow = serversToShow.filter(s => s.name.toLowerCase().includes(search));
    }
    if (typeFilter) {
        serversToShow = serversToShow.filter(s => s.type === typeFilter);
    }

    if (serversToShow.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">${currentLang === 'ru' ? 'Нет серверов' : 'No servers'}</div>`;
        return;
    }

    // SECURITY: см. комментарий в loadFeaturedServers() — те же экранирование
    // и переход на data-атрибуты/addEventListener вместо строкового onclick.
    container.innerHTML = serversToShow.map(server => `
        <div class="server-item" data-ip="${escapeHtml(server.ip)}" data-port="${server.port || 25565}">
            <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" class="server-icon" loading="lazy">
            <div class="server-info">
                <span class="server-name">${escapeHtml(server.name)}</span>
                <span class="server-meta">${escapeHtml(server.typeName[currentLang] || server.typeName.ru)} • ${escapeHtml(server.version)}</span>
            </div>
            <div class="server-stats">
                <div class="server-online">
                    <span class="online-count">${currentLang === 'ru' ? 'Проверка...' : 'Checking...'}</span>
                    <div class="server-bar"><div class="server-bar-fill" style="width: 0%"></div></div>
                </div>
                <span class="server-star ${favoriteServers.includes(server.ip) ? 'favorited' : ''}" data-fav-ip="${escapeHtml(server.ip)}">${favoriteServers.includes(server.ip) ? '★' : '☆'}</span>
                <button class="server-join-btn" data-join-ip="${escapeHtml(server.ip)}" data-join-port="${server.port || 25565}" data-join-name="${escapeHtml(server.name)}">${translations[currentLang].join_server || 'Play'}</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.server-star[data-fav-ip]').forEach(star => {
        star.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFavoriteServer(star.dataset.favIp, star);
        });
    });
    container.querySelectorAll('.server-join-btn[data-join-ip]').forEach(btn => {
        btn.addEventListener('click', () => {
            joinServerQuick(btn.dataset.joinIp, parseInt(btn.dataset.joinPort, 10) || 25565, btn.dataset.joinName || '');
        });
    });

    // Ping servers
    serversToShow.forEach(async (server) => {
        const result = await ipcRenderer.invoke('ping-server', { ip: server.ip, port: server.port || 25565 });
        const serverEl = container.querySelector(`[data-ip="${server.ip}"]`);
        if (!serverEl) return;
        const onlineCount = serverEl.querySelector('.online-count');
        const barFill = serverEl.querySelector('.server-bar-fill');

        if (result.success) {
            const percent = Math.min(100, Math.round((result.online / result.max) * 100)) || 5;
            onlineCount.textContent = `${result.online}/${result.max}`;
            barFill.style.width = `${percent}%`;
            barFill.style.background = percent > 80 ? 'var(--accent-red)' : percent > 50 ? 'var(--accent-orange)' : 'var(--accent-green)';
            const metaEl = serverEl.querySelector('.server-meta');
            if (metaEl && result.version) {
                const typePart = metaEl.textContent.split('•')[0].trim();
                metaEl.textContent = `${typePart} • ${result.version}`;
            }
        } else {
            onlineCount.textContent = currentLang === 'ru' ? 'Оффлайн' : 'Offline';
            onlineCount.style.color = 'var(--accent-red)';
            barFill.style.width = '0%';
        }
    });
}

async function toggleFavoriteServer(ip, el) {
    const isFav = favoriteServers.includes(ip);
    if (isFav) {
        favoriteServers = favoriteServers.filter(f => f !== ip);
        el.textContent = '☆';
        el.classList.remove('favorited');
        showToast(currentLang === 'ru' ? 'Избранное' : 'Favorites', translations[currentLang].server_removed_fav || 'Сервер удален из избранного', 'info');
    } else {
        favoriteServers.push(ip);
        el.textContent = '★';
        el.classList.add('favorited');
        showToast(currentLang === 'ru' ? 'Избранное' : 'Favorites', translations[currentLang].server_added_fav || 'Сервер добавлен в избранное', 'info');
    }
    await ipcRenderer.invoke('save-favorite-servers', favoriteServers);
}
window.toggleFavoriteServer = toggleFavoriteServer;

// Server tabs
document.querySelectorAll('#page-servers .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#page-servers .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadServers();
    });
});

document.getElementById('serversSearch')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadServers, 300);
});
document.getElementById('serversTypeFilter')?.addEventListener('change', loadServers);

setInterval(() => { if (currentPage === 'servers') loadServers(); }, 30000);

// ==================== NEWS ====================
async function loadNews() {
    const container = document.getElementById('newsList');
    if (!container) return;
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">${currentLang === 'ru' ? 'Загрузка новостей...' : 'Loading news...'}</div>`;

    // Try MoonLauncher API first
    try {
        const response = await fetchWithTimeout(`${MOONLAUNCHER_API}/news/list.json`);
        if (response.ok) {
            const data = await response.json();
            const news = data.news || data;
            if (news && news.length > 0) {
                // SECURITY: та же уязвимость, что и в renderHomeNewsCompact() —
                // экранируем title/description/date, ссылку передаём через dataset.
                container.innerHTML = news.map(item => `
                    <div class="news-item" data-news-link="${escapeHtml(item.link || '#')}">
                        <div class="news-icon">${getNewsIcon(item.icon || 'news')}</div>
                        <div class="news-content"><span class="news-title">${escapeHtml(item.title)}</span><span class="news-desc">${escapeHtml(stripHtml(item.description || '').substring(0, 120))}...</span></div>
                        <span class="news-date">${escapeHtml(item.date || '')}</span>
                    </div>
                `).join('');
                container.querySelectorAll('.news-item[data-news-link]').forEach(el => {
                    el.addEventListener('click', () => {
                        require('electron').shell.openExternal(el.dataset.newsLink);
                    });
                });
                return;
            }
        }
    } catch (e) {}

    // Новостей с сервера нет или API недоступно — показываем честное пустое состояние,
    // а не заранее вписанные заглушки с датами 2024 года.
    container.innerHTML = `
        <div class="news-empty">
            <div class="news-empty-icon">${getNewsIcon('news')}</div>
            <p>${currentLang === 'ru' ? 'Новостей пока нет. Загляните позже!' : 'No news yet. Check back later!'}</p>
        </div>
    `;
}

function getNewsIcon(icon) {
    const icons = {
        update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>',
        feature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        maintenance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        discord: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
        contest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>',
        news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
    };
    return icons[icon] || icons.news;
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// ==================== DIAGNOSTICS ====================
async function loadCrashReports() {
    const container = document.getElementById('crashReportsList');
    if (!container) return;
    const profile = getSelectedProfile();
    const result = await ipcRenderer.invoke('get-crash-reports', { profile });
    if (result.success && result.reports.length > 0) {
        container.innerHTML = result.reports.map(r => `
            <div class="crash-report-item" data-file="${escapeHtml(r)}">
                <span>${escapeHtml(r)}</span>
                <button class="icon-btn" data-view-crash="${escapeHtml(r)}">📄</button>
            </div>
        `).join('');
        container.querySelectorAll('[data-view-crash]').forEach(btn => {
            btn.addEventListener('click', () => viewCrashReport(btn.dataset.viewCrash));
        });
    } else {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px;">${currentLang === 'ru' ? 'Нет краш-репортов' : 'No crash reports'}</div>`;
    }
}

async function loadLaunchLogs() {
    const container = document.getElementById('launchLogsList');
    if (!container) return;
    const result = await ipcRenderer.invoke('get-launch-logs');
    if (result.success && result.logs.length > 0) {
        container.innerHTML = result.logs.map(r => `
            <div class="log-item" data-file="${escapeHtml(r)}">
                <span>${escapeHtml(r)}</span>
                <button class="icon-btn" data-view-log="${escapeHtml(r)}">📄</button>
            </div>
        `).join('');
        container.querySelectorAll('[data-view-log]').forEach(btn => {
            btn.addEventListener('click', () => viewLog(btn.dataset.viewLog));
        });
    } else {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px;">${currentLang === 'ru' ? 'Нет логов' : 'No logs'}</div>`;
    }
}

window.viewCrashReport = async function(filename) {
    const profile = getSelectedProfile();
    const result = await ipcRenderer.invoke('read-crash-report', { filename, profile });
    if (result.success) {
        showModal('Краш-репорт: ' + filename, `<pre style="max-height:400px;overflow:auto;background:var(--bg-primary);padding:16px;border-radius:8px;font-size:12px;line-height:1.5;">${escapeHtml(result.content)}</pre>`);
    }
};

window.viewLog = async function(filename) {
    const result = await ipcRenderer.invoke('read-log', filename);
    if (result.success) {
        showModal('Лог: ' + filename, `<pre style="max-height:400px;overflow:auto;background:var(--bg-primary);padding:16px;border-radius:8px;font-size:12px;line-height:1.5;">${escapeHtml(result.content)}</pre>`);
    }
};

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function showModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'modal show';
    modal.style.zIndex = '30000';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:700px;width:90%;text-align:left;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="font-size:16px;">${escapeHtml(title)}</h3>
                <button class="tb-btn" onclick="this.closest('.modal').remove()" style="font-size:18px;">×</button>
            </div>
            ${content}
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// ==================== OPEN FOLDER ====================
window.openFolder = async function(type) {
    const profile = getSelectedProfile();
    const result = await ipcRenderer.invoke('open-profile-folder', { type, profile });
    if (!result.success) {
        showToast('Error', result.error || (currentLang === 'ru' ? 'Не удалось открыть папку' : 'Failed to open folder'), 'error');
    }
};

// ==================== INIT ====================
async function init() {
    // Load system info first
    await loadSystemInfo();

    // Load settings
    const settingsResult = await ipcRenderer.invoke('get-settings');
    if (settingsResult.success) {
        launcherSettings = settingsResult.settings;
        if (launcherSettings.language) {
            currentLang = launcherSettings.language;
            setLanguage(currentLang);
        }
        applyAppearanceSettings();
    }

    // Always check updates on startup (splash screen)
    await runStartupUpdateFlow();

    // Load favorites
    const favResult = await ipcRenderer.invoke('get-favorite-servers');
    if (favResult.success) favoriteServers = favResult.favorites || [];

    // Load other data
    loadMinecraftVersions();
    loadProfiles();
    syncGameRunningState();
    refreshHomePanel();
    document.querySelector('.content')?.classList.add('page-home-active');

    fetchMoonServers(true);

    // Update version display
    const versionResult = await ipcRenderer.invoke('get-app-version');
    const appVersion = versionResult.success ? versionResult.version : '1.0.0';
    const versionEl = document.getElementById('launcherVersion');
    const aboutVersionEl = document.getElementById('aboutVersion');
    if (versionEl) versionEl.textContent = 'v' + appVersion;
    if (aboutVersionEl) aboutVersionEl.textContent = (currentLang === 'ru' ? 'Версия ' : 'Version ') + appVersion;
}

init();