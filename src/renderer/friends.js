// ==================== ДРУЗЬЯ / СООБЩЕНИЯ (реал-тайм через Socket.IO) ====================
// Отдельный сервер (см. /server/server.js в архиве) держит список пользователей,
// заявки в друзья и историю сообщений. Ник для поиска и авторизации на сервере
// друзей — это ник Minecraft-аккаунта (currentUser.username), которым лаунчер
// уже пользуется для входа через Microsoft.

(function () {
    const io = require('socket.io-client');
    const fs = require('fs');
    const path = require('path');

    // Адрес сервера друзей/сообщений. Меняй тут, если сервер переехал.
    const FRIENDS_SERVER_URL = 'http://31.25.28.34:3000';
    const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ
    const MAX_MESSAGE_LENGTH = 2000;

    let socket = null;
    let myNickname = null;
    let friends = [];             // [{nickname, online, lastSeen}]
    let incomingRequests = [];    // [{nickname, ts}]
    let outgoingRequests = [];    // [{nickname, ts}]
    let activeChatWith = null;    // nickname текущего открытого чата
    let chatCache = {};           // nickname -> [messages]
    let friendsPageInited = false;

    const $ = (id) => document.getElementById(id);

    function setConnStatus(state) {
        const dot = document.querySelector('#friendsConnStatus .status-dot');
        const text = $('friendsConnStatusText');
        if (!text) return;
        if (state === 'connected') {
            text.textContent = 'В сети';
            dot && dot.classList.add('online');
        } else if (state === 'connecting') {
            text.textContent = 'Подключение...';
            dot && dot.classList.remove('online');
        } else {
            text.textContent = 'Нет соединения с сервером';
            dot && dot.classList.remove('online');
        }
    }

    function ensureSocket() {
        if (socket) return socket;
        setConnStatus('connecting');
        socket = io(FRIENDS_SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1500,
            maxHttpBufferSize: 25 * 1024 * 1024,
        });

        socket.on('connect', () => {
            setConnStatus('connected');
            if (myNickname) socket.emit('auth', { nickname: myNickname });
        });
        socket.on('disconnect', () => setConnStatus('disconnected'));
        socket.on('connect_error', () => setConnStatus('disconnected'));

        socket.on('friends:state', (data) => {
            friends = data.friends || [];
            incomingRequests = data.incoming || [];
            outgoingRequests = data.outgoing || [];
            renderFriendsList();
            renderRequests();
        });

        socket.on('friend:online', ({ nickname }) => {
            const f = friends.find(f => f.nickname === nickname);
            if (f) { f.online = true; renderFriendsList(); updateChatHeaderIfActive(nickname); }
        });
        socket.on('friend:offline', ({ nickname }) => {
            const f = friends.find(f => f.nickname === nickname);
            if (f) { f.online = false; renderFriendsList(); updateChatHeaderIfActive(nickname); }
        });

        socket.on('friend:request:incoming', ({ nickname, ts }) => {
            incomingRequests.push({ nickname, ts });
            renderRequests();
            notifyFriendsBadge();
            if (typeof showToast === 'function') showToast('Заявка в друзья', `${nickname} хочет добавить вас в друзья`, 'info');
        });

        socket.on('friend:request:accepted', ({ nickname }) => {
            outgoingRequests = outgoingRequests.filter(r => r.nickname !== nickname);
            if (!friends.find(f => f.nickname === nickname)) friends.push({ nickname, online: true });
            renderFriendsList();
            renderRequests();
            if (typeof showToast === 'function') showToast('Заявка принята', `${nickname} принял(а) вашу заявку в друзья`, 'success');
        });

        socket.on('friend:request:declined', ({ nickname }) => {
            outgoingRequests = outgoingRequests.filter(r => r.nickname !== nickname);
            renderRequests();
        });

        socket.on('friend:removed', ({ nickname }) => {
            friends = friends.filter(f => f.nickname !== nickname);
            renderFriendsList();
            if (activeChatWith === nickname) closeActiveChat();
        });

        socket.on('message:new', (msg) => {
            const other = msg.from === myNickname ? msg.to : msg.from;
            if (!chatCache[other]) chatCache[other] = [];
            chatCache[other].push(msg);
            if (activeChatWith === other) {
                appendMessageToDom(msg);
                scrollChatToBottom();
            } else if (msg.from !== myNickname && typeof showToast === 'function') {
                showToast(msg.from, msg.type === 'file' ? `📎 Файл: ${msg.name}` : msg.text, 'info');
            }
        });

        socket.on('friends:error', ({ message }) => {
            if (typeof showToast === 'function') showToast('Ошибка', message, 'error');
        });

        return socket;
    }

    function notifyFriendsBadge() {
        const badge = $('friendsNavBadge');
        const count = incomingRequests.length;
        if (!badge) return;
        if (count > 0) {
            badge.style.display = 'inline-flex';
            badge.textContent = count > 9 ? '9+' : String(count);
        } else {
            badge.style.display = 'none';
        }
    }

    // ==================== RENDER: friends list ====================
    function renderFriendsList() {
        const list = $('friendsList');
        const empty = $('friendsListEmpty');
        if (!list) return;
        list.innerHTML = '';
        if (!friends.length) {
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';

        friends
            .slice()
            .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.nickname.localeCompare(b.nickname))
            .forEach(f => {
                const row = document.createElement('div');
                row.className = 'friend-row' + (activeChatWith === f.nickname ? ' active' : '');
                row.innerHTML = `
                    <img class="friend-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(f.nickname)}">
                    <div class="friend-row-info">
                        <span class="friend-row-name">${escapeHtml(f.nickname)}</span>
                        <span class="friend-row-status ${f.online ? 'online' : ''}">${f.online ? 'В сети' : 'Не в сети'}</span>
                    </div>
                `;
                row.addEventListener('click', () => openChatWith(f.nickname));
                list.appendChild(row);
            });
    }

    // ==================== RENDER: requests ====================
    function renderRequests() {
        const incomingList = $('incomingRequestsList');
        const outgoingList = $('outgoingRequestsList');
        const empty = $('requestsEmpty');
        if (!incomingList || !outgoingList) return;
        incomingList.innerHTML = '';
        outgoingList.innerHTML = '';

        incomingRequests.forEach(r => {
            const row = document.createElement('div');
            row.className = 'friend-request-row';
            row.innerHTML = `
                <img class="friend-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(r.nickname)}">
                <span class="friend-row-name">${escapeHtml(r.nickname)}</span>
                <div class="friend-request-actions">
                    <button class="fr-accept" title="Принять">✓</button>
                    <button class="fr-decline" title="Отклонить">✕</button>
                </div>
            `;
            row.querySelector('.fr-accept').addEventListener('click', () => {
                ensureSocket().emit('friend:accept', { nickname: r.nickname });
                incomingRequests = incomingRequests.filter(x => x.nickname !== r.nickname);
                if (!friends.find(f => f.nickname === r.nickname)) friends.push({ nickname: r.nickname, online: false });
                renderRequests();
                renderFriendsList();
                notifyFriendsBadge();
            });
            row.querySelector('.fr-decline').addEventListener('click', () => {
                ensureSocket().emit('friend:decline', { nickname: r.nickname });
                incomingRequests = incomingRequests.filter(x => x.nickname !== r.nickname);
                renderRequests();
                notifyFriendsBadge();
            });
            incomingList.appendChild(row);
        });

        outgoingRequests.forEach(r => {
            const row = document.createElement('div');
            row.className = 'friend-request-row';
            row.innerHTML = `
                <img class="friend-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(r.nickname)}">
                <span class="friend-row-name">${escapeHtml(r.nickname)}</span>
                <span class="friend-request-pending">Ожидание...</span>
            `;
            outgoingList.appendChild(row);
        });

        if (empty) empty.style.display = (incomingRequests.length === 0 && outgoingRequests.length === 0) ? 'block' : 'none';
    }

    // ==================== SEARCH ====================
    let searchDebounce = null;
    function initSearch() {
        const input = $('friendSearchInput');
        if (!input || input.dataset.bound) return;
        input.dataset.bound = '1';
        input.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            const q = input.value.trim();
            const results = $('friendSearchResults');
            if (!q) { results.innerHTML = ''; return; }
            searchDebounce = setTimeout(() => {
                ensureSocket().emit('friends:search', { query: q }, (res) => {
                    renderSearchResults(res && res.users ? res.users : []);
                });
            }, 300);
        });
    }

    function renderSearchResults(users) {
        const results = $('friendSearchResults');
        if (!results) return;
        results.innerHTML = '';
        if (!users.length) {
            results.innerHTML = '<div class="friends-empty-hint">Никого не найдено</div>';
            return;
        }
        users.forEach(u => {
            const isFriend = friends.some(f => f.nickname === u.nickname);
            const isOutgoing = outgoingRequests.some(r => r.nickname === u.nickname);
            const isMe = u.nickname === myNickname;
            const row = document.createElement('div');
            row.className = 'friend-search-row';
            let actionHtml = '';
            if (isMe) actionHtml = '<span class="friend-request-pending">Это вы</span>';
            else if (isFriend) actionHtml = '<span class="friend-request-pending">Уже в друзьях</span>';
            else if (isOutgoing) actionHtml = '<span class="friend-request-pending">Заявка отправлена</span>';
            else actionHtml = '<button class="fr-add-btn">Добавить</button>';

            row.innerHTML = `
                <img class="friend-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(u.nickname)}">
                <span class="friend-row-name">${escapeHtml(u.nickname)}</span>
                ${actionHtml}
            `;
            const addBtn = row.querySelector('.fr-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    ensureSocket().emit('friend:request', { nickname: u.nickname }, (res) => {
                        if (res && res.success) {
                            outgoingRequests.push({ nickname: u.nickname, ts: Date.now() });
                            renderSearchResults(users);
                            renderRequests();
                            if (typeof showToast === 'function') showToast('Заявка отправлена', `Заявка в друзья отправлена игроку ${u.nickname}`, 'success');
                        } else if (typeof showToast === 'function') {
                            showToast('Ошибка', (res && res.error) || 'Не удалось отправить заявку', 'error');
                        }
                    });
                });
            }
            results.appendChild(row);
        });
    }

    // ==================== TABS ====================
    function initTabs() {
        document.querySelectorAll('.friends-tab').forEach(tab => {
            if (tab.dataset.bound) return;
            tab.dataset.bound = '1';
            tab.addEventListener('click', () => {
                document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.friends-tab-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                $('ftab-' + tab.dataset.ftab).classList.add('active');
            });
        });
    }

    // ==================== CHAT ====================
    function openChatWith(nickname) {
        activeChatWith = nickname;
        $('friendsChatEmpty').style.display = 'none';
        $('friendsChatActive').style.display = 'flex';
        $('chatFriendName').textContent = nickname;
        $('chatAvatar').src = `https://mc-heads.net/avatar/${encodeURIComponent(nickname)}`;
        updateChatHeaderIfActive(nickname);
        renderFriendsList();

        if (!chatCache[nickname]) {
            ensureSocket().emit('history:get', { withUser: nickname }, (res) => {
                chatCache[nickname] = (res && res.messages) || [];
                if (activeChatWith === nickname) renderChatMessages();
            });
        } else {
            renderChatMessages();
        }
    }

    function closeActiveChat() {
        activeChatWith = null;
        $('friendsChatActive').style.display = 'none';
        $('friendsChatEmpty').style.display = 'flex';
        renderFriendsList();
    }

    function updateChatHeaderIfActive(nickname) {
        if (activeChatWith !== nickname) return;
        const f = friends.find(f => f.nickname === nickname);
        const statusEl = $('chatFriendStatus');
        if (statusEl) {
            statusEl.textContent = f && f.online ? 'В сети' : 'Не в сети';
            statusEl.className = 'friends-chat-status' + (f && f.online ? ' online' : '');
        }
    }

    function renderChatMessages() {
        const box = $('chatMessages');
        if (!box) return;
        box.innerHTML = '';
        (chatCache[activeChatWith] || []).forEach(appendMessageToDom);
        scrollChatToBottom();
    }

    function scrollChatToBottom() {
        const box = $('chatMessages');
        if (box) box.scrollTop = box.scrollHeight;
    }

    function appendMessageToDom(msg) {
        const box = $('chatMessages');
        if (!box) return;
        const mine = msg.from === myNickname;
        const wrap = document.createElement('div');
        wrap.className = 'chat-msg-row ' + (mine ? 'mine' : 'theirs');

        const time = new Date(msg.ts || Date.now());
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (msg.type === 'file') {
            const sizeKb = Math.round((msg.size || 0) / 1024);
            wrap.innerHTML = `
                <div class="chat-bubble file-bubble">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <div class="file-bubble-info">
                        <span class="file-bubble-name">${escapeHtml(msg.name)}</span>
                        <span class="file-bubble-size">${sizeKb} КБ</span>
                    </div>
                    ${mine ? '' : '<button class="file-download-btn">Скачать</button>'}
                    <span class="chat-msg-time">${timeStr}</span>
                </div>
            `;
            if (!mine) {
                wrap.querySelector('.file-download-btn').addEventListener('click', async () => {
                    const result = await ipcRenderer.invoke('save-friend-file', { defaultName: msg.name, dataBase64: msg.data });
                    if (result && result.success && typeof showToast === 'function') {
                        showToast('Файл сохранён', result.filePath, 'success');
                    }
                });
            }
        } else {
            wrap.innerHTML = `
                <div class="chat-bubble">
                    <span class="chat-msg-text"></span>
                    <span class="chat-msg-time">${timeStr}</span>
                </div>
            `;
            wrap.querySelector('.chat-msg-text').textContent = msg.text || '';
        }
        box.appendChild(wrap);
    }

    function initChatInput() {
        const input = $('chatMessageInput');
        const sendBtn = $('chatSendBtn');
        const counter = $('chatCharCount');
        const attachBtn = $('chatAttachBtn');
        const removeFriendBtn = $('chatRemoveFriendBtn');
        if (!input || input.dataset.bound) return;
        input.dataset.bound = '1';

        input.addEventListener('input', () => {
            if (input.value.length > MAX_MESSAGE_LENGTH) input.value = input.value.slice(0, MAX_MESSAGE_LENGTH);
            counter.textContent = `${input.value.length} / ${MAX_MESSAGE_LENGTH}`;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendCurrentMessage();
            }
        });

        sendBtn.addEventListener('click', sendCurrentMessage);

        function sendCurrentMessage() {
            const text = input.value.trim();
            if (!text || !activeChatWith) return;
            if (text.length > MAX_MESSAGE_LENGTH) {
                if (typeof showToast === 'function') showToast('Ошибка', `Сообщение длиннее ${MAX_MESSAGE_LENGTH} символов`, 'error');
                return;
            }
            ensureSocket().emit('message:send', { to: activeChatWith, text }, (res) => {
                if (!res || !res.success) {
                    if (typeof showToast === 'function') showToast('Ошибка', (res && res.error) || 'Не удалось отправить сообщение', 'error');
                }
            });
            input.value = '';
            input.style.height = 'auto';
            counter.textContent = `0 / ${MAX_MESSAGE_LENGTH}`;
        }

        attachBtn.addEventListener('click', async () => {
            if (!activeChatWith) return;
            const filePath = await ipcRenderer.invoke('browse-file', { title: 'Выберите файл (до 15 МБ)' });
            if (!filePath) return;
            try {
                const stat = fs.statSync(filePath);
                if (stat.size > MAX_FILE_SIZE) {
                    if (typeof showToast === 'function') showToast('Ошибка', 'Файл больше 15 МБ', 'error');
                    return;
                }
                const buffer = fs.readFileSync(filePath);
                const base64 = buffer.toString('base64');
                const name = path.basename(filePath);
                attachBtn.disabled = true;
                ensureSocket().emit('file:send', { to: activeChatWith, name, size: stat.size, data: base64 }, (res) => {
                    attachBtn.disabled = false;
                    if (!res || !res.success) {
                        if (typeof showToast === 'function') showToast('Ошибка', (res && res.error) || 'Не удалось отправить файл', 'error');
                    }
                });
            } catch (e) {
                attachBtn.disabled = false;
                if (typeof showToast === 'function') showToast('Ошибка', e.message, 'error');
            }
        });

        removeFriendBtn.addEventListener('click', () => {
            if (!activeChatWith) return;
            if (!confirm(`Удалить ${activeChatWith} из друзей?`)) return;
            ensureSocket().emit('friend:remove', { nickname: activeChatWith });
            friends = friends.filter(f => f.nickname !== activeChatWith);
            renderFriendsList();
            closeActiveChat();
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str == null ? '' : str);
        return div.innerHTML;
    }

    function initFriendsPageOnce() {
        if (friendsPageInited) return;
        friendsPageInited = true;
        initTabs();
        initSearch();
        initChatInput();
    }

    // Вызывается при открытии вкладки "Друзья"
    window.onFriendsPageOpen = function () {
        initFriendsPageOnce();
        const loggedIn = !!myNickname;
        $('friendsLoggedIn').style.display = loggedIn ? 'flex' : 'none';
        $('friendsLoggedOut').style.display = loggedIn ? 'none' : 'flex';
        if (loggedIn) ensureSocket();
    };

    // Вызывается из app.js при входе/выходе из аккаунта
    window.onAuthChanged = function (user) {
        const nickname = user && user.username ? user.username : null;
        if (nickname === myNickname) return;
        myNickname = nickname;

        friends = [];
        incomingRequests = [];
        outgoingRequests = [];
        chatCache = {};
        activeChatWith = null;
        notifyFriendsBadge();

        if (socket) {
            socket.disconnect();
            socket = null;
        }

        if (nickname) {
            ensureSocket();
        }
    };
})();
