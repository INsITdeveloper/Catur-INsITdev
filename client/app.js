import { BoardView, avatarSrc, pieceImage } from './board.js';
import { VoiceChat } from './voice.js';
import { legalMoves, findMove, createState } from './rules.js';

const PLAYER_KEY = 'catur.player.v1';
const PROFILE_KEY = 'catur.profile.v1';
const SESSION_KEY = 'catur.session.v1';
const SOUND_KEY = 'catur.sound.v1';

const AVATARS = ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12', 'a13', 'a14'];

const CDN = {
    uploadUrl: 'https://cdnins.insjay.biz.id/upload-send',
    allowedHosts: ['cloudins-cdn.insjay.biz.id', 'cdnins.insjay.biz.id'],
    userIdKey: 'catur.cdn.id.v1',
    maxFileBytes: 8 * 1024 * 1024,
    outputSize: 256
};

const TIME_FALLBACK = {
    '3+2': '3 menit + 2 detik',
    '5+0': '5 menit',
    '10+0': '10 menit',
    '10+5': '10 menit + 5 detik',
    '30+0': '30 menit',
    unlimited: 'Tanpa batas waktu'
};

const $ = (id) => document.getElementById(id);

const el = {
    connPill: $('connPill'),
    soundToggle: $('soundToggle'),
    screens: {
        profile: $('screenProfile'),
        home: $('screenHome'),
        search: $('screenSearch'),
        lobby: $('screenLobby'),
        game: $('screenGame')
    },
    nameInput: $('nameInput'),
    avatarGrid: $('avatarGrid'),
    avatarPreview: $('avatarPreview'),
    avatarPreviewLabel: $('avatarPreviewLabel'),
    uploadAvatarBtn: $('uploadAvatarBtn'),
    clearAvatarBtn: $('clearAvatarBtn'),
    avatarFileInput: $('avatarFileInput'),
    avatarUploadStatus: $('avatarUploadStatus'),
    profileError: $('profileError'),
    saveProfileBtn: $('saveProfileBtn'),
    profileAvatar: $('profileAvatar'),
    profileName: $('profileName'),
    editProfileBtn: $('editProfileBtn'),
    resumeBox: $('resumeBox'),
    resumeText: $('resumeText'),
    resumeBtn: $('resumeBtn'),
    resumeDismiss: $('resumeDismiss'),
    homeTimeControl: $('homeTimeControl'),
    homeColor: $('homeColor'),
    quickMatchBtn: $('quickMatchBtn'),
    botGameBtn: $('botGameBtn'),
    createRoomBtn: $('createRoomBtn'),
    roomCodeInput: $('roomCodeInput'),
    joinRoomBtn: $('joinRoomBtn'),
    searchTitle: $('searchTitle'),
    searchHint: $('searchHint'),
    searchBotBtn: $('searchBotBtn'),
    cancelSearchBtn: $('cancelSearchBtn'),
    lobbyCode: $('lobbyCode'),
    copyCodeBtn: $('copyCodeBtn'),
    copyLinkBtn: $('copyLinkBtn'),
    lobbySeats: $('lobbySeats'),
    hostPanel: $('hostPanel'),
    tcSelect: $('tcSelect'),
    colorSelect: $('colorSelect'),
    addBotBtn: $('addBotBtn'),
    startGameBtn: $('startGameBtn'),
    guestHint: $('guestHint'),
    leaveLobbyBtn: $('leaveLobbyBtn'),
    stripTop: $('stripTop'),
    stripBottom: $('stripBottom'),
    board: $('board'),
    boardOverlay: $('boardOverlay'),
    overlayTitle: $('overlayTitle'),
    overlayText: $('overlayText'),
    moveList: $('moveList'),
    drawBtn: $('drawBtn'),
    resignBtn: $('resignBtn'),
    rematchBtn: $('rematchBtn'),
    backLobbyBtn: $('backLobbyBtn'),
    leaveGameBtn: $('leaveGameBtn'),
    drawOfferBar: $('drawOfferBar'),
    drawOfferText: $('drawOfferText'),
    acceptDrawBtn: $('acceptDrawBtn'),
    declineDrawBtn: $('declineDrawBtn'),
    chatDrawer: $('chatDrawer'),
    chatCloseBtn: $('chatCloseBtn'),
    chatLog: $('chatLog'),
    chatForm: $('chatForm'),
    chatInput: $('chatInput'),
    chatFab: $('chatFab'),
    chatDot: $('chatDot'),
    toastStack: $('toastStack'),
    promotionModal: $('promotionModal'),
    promoChoices: $('promoChoices'),
    confirmModal: $('confirmModal'),
    confirmTitle: $('confirmTitle'),
    confirmText: $('confirmText'),
    confirmYes: $('confirmYes'),
    confirmNo: $('confirmNo')
};

const voiceButtons = [
    { join: $('voiceJoinBtn'), mute: $('voiceMuteBtn'), leave: $('voiceLeaveBtn'), status: $('voiceStatus'), members: $('voiceMembers') },
    { join: $('voiceJoinBtn2'), mute: $('voiceMuteBtn2'), leave: $('voiceLeaveBtn2'), status: $('voiceStatus2'), members: $('voiceMembers2') }
];

const app = {
    playerId: null,
    profile: null,
    session: null,
    socket: null,
    socketKind: null,
    connected: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    wantRoom: null,
    pendingBotGame: false,
    pendingStart: false,
    screen: 'home',
    room: null,
    game: null,
    myId: null,
    myRole: 'player',
    myColor: null,
    orientation: 'w',
    selected: null,
    hints: new Set(),
    board: new Array(64).fill(null),
    position: null,
    clocks: null,
    clocksAt: 0,
    clockOffset: 0,
    unread: 0,
    chatOpen: false,
    sound: true,
    lastGameKey: null
};

let boardView = null;
let voice = null;
let clockTimer = null;
let pingTimer = null;
let lastPongAt = 0;

function randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadLocal(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function saveLocal(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {}
}

function dropLocal(key) {
    try {
        localStorage.removeItem(key);
    } catch {}
}

function toast(text, kind = '') {
    const node = document.createElement('div');
    node.className = 'toast ' + kind;
    node.textContent = text;
    el.toastStack.appendChild(node);
    setTimeout(() => node.remove(), 4200);
}

function askConfirm(title, text) {
    return new Promise((resolve) => {
        el.confirmTitle.textContent = title;
        el.confirmText.textContent = text;
        el.confirmModal.hidden = false;
        const done = (value) => {
            el.confirmModal.hidden = true;
            el.confirmYes.removeEventListener('click', yes);
            el.confirmNo.removeEventListener('click', no);
            resolve(value);
        };
        const yes = () => done(true);
        const no = () => done(false);
        el.confirmYes.addEventListener('click', yes);
        el.confirmNo.addEventListener('click', no);
    });
}

let audioCtx = null;

function beep(freq, duration) {
    if (!app.sound) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0.06;
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        osc.stop(audioCtx.currentTime + duration);
    } catch {}
}

function showScreen(name) {
    for (const [key, node] of Object.entries(el.screens)) {
        node.hidden = key !== name;
    }
    app.screen = name;
    const inRoom = name === 'lobby' || name === 'game';
    el.chatFab.hidden = !inRoom;
    if (!inRoom) {
        app.chatOpen = false;
        el.chatDrawer.hidden = true;
    } else if (app.chatOpen) {
        el.chatDrawer.hidden = false;
    }
    if (name === 'lobby' || name === 'game') renderVoice();
}

function socketUrl() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    if (app.socketKind === 'room' && app.wantRoom) {
        return `${scheme}://${location.host}/ws?room=${encodeURIComponent(app.wantRoom)}`;
    }
    return `${scheme}://${location.host}/ws`;
}

function setConnected(ok, label) {
    app.connected = ok;
    el.connPill.textContent = label;
    el.connPill.classList.toggle('on', ok);
    el.connPill.classList.toggle('warn', !ok && app.socketKind === 'room');
    updateOverlay();
}

function updateOverlay() {
    const inGame = app.screen === 'game';
    const show = inGame && !app.connected;
    el.boardOverlay.hidden = !show;
    if (show) {
        el.overlayTitle.textContent = 'Menyambung ulang...';
        el.overlayText.textContent = 'Kursimu masih ditahan di server. Jangan tutup halaman ini.';
    }
}

function closeSocket() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (app.socket) {
        const old = app.socket;
        app.socket = null;
        old.onclose = null;
        old.onerror = null;
        old.onmessage = null;
        try {
            old.close();
        } catch {}
    }
}

function scheduleReconnect() {
    if (app.reconnectTimer) return;
    const delay = Math.min(8000, 800 * Math.pow(1.7, app.reconnectAttempt));
    app.reconnectAttempt += 1;
    app.reconnectTimer = setTimeout(() => {
        app.reconnectTimer = null;
        if (app.socketKind === 'room' && app.wantRoom) openRoomSocket(app.wantRoom);
        else if (app.socketKind === 'lobby') openLobbySocket();
    }, delay);
}

function attachSocket(ws) {
    ws.onopen = () => {
        app.reconnectAttempt = 0;
        setConnected(true, 'tersambung');
        if (app.socketKind === 'room') {
            const session = app.session && app.session.roomCode === app.wantRoom ? app.session : null;
            if (session && session.token) {
                send({ type: 'RESUME', playerId: app.playerId, token: session.token });
            } else {
                send({ type: 'JOIN', playerId: app.playerId, profile: app.profile });
            }
        }
        pingTimer = setInterval(() => {
            if (!app.connected) return;
            if (Date.now() - lastPongAt > 30000) {
                try { ws.close(); } catch {}
                return;
            }
            send({ type: 'PING' });
        }, 12000);
    };
    ws.onmessage = (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }
        handleMessage(message);
    };
    ws.onclose = () => {
        setConnected(false, 'terputus');
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        app.socket = null;
        if (app.socketKind === 'room' && app.wantRoom) scheduleReconnect();
        else if (app.socketKind === 'lobby' && app.screen === 'search') scheduleReconnect();
    };
    ws.onerror = () => {};
}

function send(payload) {
    if (!app.socket || app.socket.readyState !== WebSocket.OPEN) return false;
    app.socket.send(JSON.stringify(payload));
    return true;
}

function openLobbySocket() {
    closeSocket();
    app.socketKind = 'lobby';
    const ws = new WebSocket(socketUrl());
    app.socket = ws;
    attachSocket(ws);
}

function openRoomSocket(code) {
    closeSocket();
    app.socketKind = 'room';
    app.wantRoom = code;
    const ws = new WebSocket(socketUrl());
    app.socket = ws;
    attachSocket(ws);
}

function rememberSession(code, token) {
    app.session = { roomCode: code, token, playerId: app.playerId, at: Date.now() };
    saveLocal(SESSION_KEY, app.session);
}

function forgetSession() {
    app.session = null;
    dropLocal(SESSION_KEY);
    el.resumeBox.hidden = true;
}

function handleMessage(message) {
    switch (message.type) {
        case 'PONG':
            lastPongAt = Date.now();
            return;

        case 'ERROR':
            toast(message.message || 'Terjadi kesalahan.', 'err');
            if (app.socketKind === 'lobby' && app.screen === 'search') showScreen('home');
            return;

        case 'MATCH_SEARCHING':
            app.searchMode = 'player';
            el.searchTitle.textContent = 'Mencari lawan...';
            el.searchHint.textContent = message.message || '';
            showScreen('search');
            return;

        case 'MATCH_CANCELLED':
            showScreen('home');
            return;

        case 'ROOM_CREATED':
        case 'MATCH_FOUND': {
            rememberSession(message.roomCode, message.token);
            app.pendingStart = false;
            if (message.botFilled) toast('Belum ada pemain lain, kamu dilawankan bot.', 'ok');
            openRoomSocket(message.roomCode);
            return;
        }

        case 'READY': {
            app.myId = message.playerId;
            app.myRole = message.role;
            app.myColor = message.color;
            rememberSession(message.roomCode, message.token);
            if (message.resumed) toast('Berhasil tersambung ulang ke room.', 'ok');
            if (app.pendingBotGame) {
                app.pendingBotGame = false;
                app.pendingStart = true;
                send({ type: 'ADD_BOT' });
            }
            if (app.socketKind === 'lobby') closeSocket();
            return;
        }

        case 'RESUME_FAILED':
            forgetSession();
            toast(message.message || 'Sesi lama tidak berlaku.', 'err');
            app.wantRoom = null;
            app.socketKind = null;
            closeSocket();
            showScreen('home');
            renderHome();
            return;

        case 'STATE':
            applyState(message);
            return;

        case 'CHAT_MESSAGE':
            appendChat(message.message);
            return;

        case 'VOICE_PEERS': {
            const ids = message.peers.map((p) => p.id);
            if (voice) voice.syncPeers(ids);
            app.voicePeers = message.peers;
            renderVoice();
            return;
        }

        case 'VOICE_SIGNAL':
            if (voice) voice.handleSignal(message.from, message.kind, message.payload);
            return;

        case 'GAME_START':
            toast(message.message || 'Permainan dimulai.', 'ok');
            beep(660, 0.12);
            return;

        case 'GAME_OVER':
            toast(message.text || 'Permainan selesai.', message.result === 'draw' ? '' : 'ok');
            beep(message.result === 'draw' ? 380 : 520, 0.2);
            return;

        case 'MEMBER_OFFLINE':
            if (message.memberId !== app.myId) {
                toast(`${message.name} terputus. Menunggu dia kembali (${Math.round((message.graceMs || 120000) / 1000)} detik).`);
            }
            return;

        case 'MEMBER_LEFT':
            if (message.memberId !== app.myId) toast(`${message.name} keluar dari room.`);
            return;

        case 'LEFT_ROOM':
            forgetSession();
            app.wantRoom = null;
            app.socketKind = null;
            app.room = null;
            app.game = null;
            closeSocket();
            if (voice) voice.leave();
            showScreen('home');
            renderHome();
            return;

        default:
            return;
    }
}

function applyState(message) {
    app.serverTime = message.serverTime;
    app.clockOffset = Date.now() - message.serverTime;
    app.room = message.room;
    app.myId = message.room.you ? message.room.you.id : app.myId;
    app.myRole = message.room.you ? message.room.you.role : app.myRole;
    app.myColor = message.room.you ? message.room.you.color : null;
    app.graceMs = message.graceMs;
    app.pauseMs = message.disconnectPauseMs;
    const previousGame = app.game;
    app.game = message.game;

    if (app.game) {
        app.clocks = app.game.clocks ? { ...app.game.clocks } : null;
        app.clocksAt = Date.now();
    } else {
        app.clocks = null;
    }

    if (app.room.phase === 'playing' || app.room.phase === 'finished') {
        if (app.screen !== 'game') {
            app.selected = null;
            app.hints = new Set();
        }
        app.orientation = app.myColor === 'b' ? 'b' : 'w';
        showScreen('game');
        renderGame();
    } else {
        showScreen('lobby');
        renderLobby();
    }

    if (app.chatOpen) renderChat();

    if (app.pendingStart && app.room.phase === 'lobby') {
        const players = app.room.members.filter((m) => m.role === 'player');
        if (players.length >= 2) {
            app.pendingStart = false;
            send({ type: 'START_GAME' });
        }
    }

    if (app.game && previousGame && previousGame.history.length !== app.game.history.length) {
        const mine = app.game.history.length % 2 === (app.myColor === 'w' ? 1 : 0);
        if (!mine) beep(440, 0.06);
    }
}

function renderHome() {
    el.profileName.textContent = app.profile.name;
    el.profileAvatar.src = avatarSrc(app.profile);
    const session = app.session;
    if (session && session.token) {
        el.resumeBox.hidden = false;
        const age = Math.round((Date.now() - (session.at || 0)) / 60000);
        el.resumeText.textContent = `Kamu masih punya kursi di room ${session.roomCode}${age ? ` (dibuat ${age} menit lalu)` : ''}.`;
    } else {
        el.resumeBox.hidden = true;
    }
}

function renderProfile() {
    el.nameInput.value = app.profile ? app.profile.name : '';
    el.avatarGrid.innerHTML = '';
    for (const name of AVATARS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.avatar = name;
        const img = document.createElement('img');
        img.src = `assets/avatars/${name}.svg`;
        img.alt = name;
        button.appendChild(img);
        button.addEventListener('click', () => {
            app.profile.avatar = name;
            app.profile.avatarUrl = null;
            refreshAvatarSelection();
        });
        el.avatarGrid.appendChild(button);
    }
    refreshAvatarSelection();
}

function refreshAvatarSelection() {
    for (const button of el.avatarGrid.children) {
        button.classList.toggle('sel', button.dataset.avatar === app.profile.avatar && !app.profile.avatarUrl);
    }
    el.avatarPreview.src = avatarSrc(app.profile);
    el.avatarPreviewLabel.textContent = app.profile.avatarUrl ? 'Foto sendiri' : 'Avatar bawaan';
    el.clearAvatarBtn.hidden = !app.profile.avatarUrl;
}

function memberTag(member, hostId) {
    const tags = [];
    if (member.id === hostId) tags.push(['host', 'Host']);
    if (member.role === 'spectator') tags.push(['spectator', 'Penonton']);
    else if (member.color === 'w') tags.push(['white', 'Putih']);
    else if (member.color === 'b') tags.push(['black', 'Hitam']);
    if (member.isBot) tags.push(['bot', 'Bot']);
    if (!member.connected) tags.push(['off', 'Terputus']);
    if (member.voice) tags.push(['voice', member.muted ? 'Mic mati' : 'Suara']);
    return tags;
}

function renderLobby() {
    const room = app.room;
    el.lobbyCode.textContent = room.code;
    el.lobbySeats.innerHTML = '';
    const isHost = room.hostId === app.myId;

    for (const member of room.members) {
        const row = document.createElement('div');
        row.className = 'seat';
        const img = document.createElement('img');
        img.src = avatarSrc(member);
        img.alt = member.name;
        row.appendChild(img);

        const info = document.createElement('div');
        info.className = 'seat-info';
        const name = document.createElement('span');
        name.className = 'seat-name';
        name.textContent = member.name + (member.id === app.myId ? ' (kamu)' : '');
        info.appendChild(name);
        const tagRow = document.createElement('div');
        tagRow.className = 'seat-tags';
        for (const [cls, label] of memberTag(member, room.hostId)) {
            const tag = document.createElement('span');
            tag.className = 'tag ' + cls;
            tag.textContent = label;
            tagRow.appendChild(tag);
        }
        info.appendChild(tagRow);
        row.appendChild(info);

        if (isHost && member.isBot) {
            const remove = document.createElement('button');
            remove.className = 'ghost';
            remove.textContent = 'Hapus';
            remove.addEventListener('click', () => send({ type: 'REMOVE_BOT', memberId: member.id }));
            row.appendChild(remove);
        }
        el.lobbySeats.appendChild(row);
    }

    el.hostPanel.hidden = !isHost;
    el.guestHint.hidden = isHost;
    if (isHost) {
        el.tcSelect.value = room.options.timeControlId;
        el.colorSelect.value = room.options.hostColor;
        const players = room.members.filter((m) => m.role === 'player');
        const ready = players.length >= 2 && players.every((p) => p.connected || p.isBot);
        el.startGameBtn.disabled = !ready;
        el.addBotBtn.disabled = players.length >= 2;
    }
    renderVoice();
}

function playersByColor() {
    const room = app.room;
    const white = room.members.find((m) => m.role === 'player' && m.color === 'w') || null;
    const black = room.members.find((m) => m.role === 'player' && m.color === 'b') || null;
    return { white, black };
}

function renderStrip(node, member, isMe) {
    node.innerHTML = '';
    node.classList.toggle('active', Boolean(app.game) && !app.game.over && member && member.color === app.game.turn);
    if (!member) {
        const empty = document.createElement('span');
        empty.className = 'ps-name';
        empty.textContent = 'Menunggu pemain...';
        node.appendChild(empty);
        return;
    }
    const img = document.createElement('img');
    img.src = avatarSrc(member);
    img.alt = member.name;
    node.appendChild(img);

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'ps-name';
    name.textContent = member.name + (isMe ? ' (kamu)' : '');
    info.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'ps-meta';
    const bits = [];
    if (member.isBot) bits.push('bot');
    if (!member.connected) bits.push('terputus');
    if (member.voice) bits.push(member.muted ? 'mic mati' : 'di obrolan suara');
    if (bits.length) meta.textContent = bits.join(' \u00b7 ');
    info.appendChild(meta);

    const captured = document.createElement('div');
    captured.className = 'captured';
    const taken = app.game && app.game.captured ? app.game.captured[member.color === 'w' ? 'w' : 'b'] : null;
    if (taken) {
        for (const piece of taken) {
            const icon = document.createElement('img');
            const color = piece === piece.toUpperCase() ? 'b' : 'w';
            icon.src = pieceImage(color, piece);
            icon.alt = piece;
            captured.appendChild(icon);
        }
    }
    info.appendChild(captured);
    node.appendChild(info);

    const spacer = document.createElement('div');
    spacer.className = 'ps-spacer';
    node.appendChild(spacer);

    const clock = document.createElement('div');
    clock.className = 'clock';
    clock.dataset.color = member.color || '';
    node.appendChild(clock);
}

function renderClocks() {
    if (!app.game || !app.game.clocks) {
        for (const node of document.querySelectorAll('.clock')) node.textContent = '\u221e';
        return;
    }
    const clocks = app.game.clocks;
    const now = Date.now();
    for (const node of document.querySelectorAll('.clock')) {
        const color = node.dataset.color;
        if (!color) {
            node.textContent = '';
            continue;
        }
        let ms;
        if (clocks.initial === null) {
            node.textContent = '\u221e';
            node.classList.remove('low', 'paused');
            continue;
        }
        if (app.game.over || app.game.clockDeadline === null || app.game.clockDeadline === undefined) {
            ms = clocks[color];
        } else if (app.game.turn !== color) {
            ms = clocks[color];
        } else {
            const serverNow = now - app.clockOffset;
            ms = app.game.clockDeadline - serverNow;
            const member = memberOfColor(color);
            node.classList.toggle('paused', Boolean(member && !member.connected));
        }
        ms = Math.max(0, ms);
        const total = Math.floor(ms / 1000);
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        node.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
        node.classList.toggle('low', ms < 30000);
    }
}

function memberOfColor(color) {
    if (!app.room) return null;
    return app.room.members.find((m) => m.role === 'player' && m.color === color) || null;
}

function renderMoveList() {
    el.moveList.innerHTML = '';
    if (!app.game) return;
    const history = app.game.history;
    for (let i = 0; i < history.length; i += 2) {
        const num = document.createElement('div');
        num.className = 'num';
        num.textContent = `${i / 2 + 1}.`;
        el.moveList.appendChild(num);
        for (const offset of [0, 1]) {
            const san = document.createElement('div');
            san.className = 'san';
            if (i + offset < history.length) {
                san.textContent = history[i + offset];
                if (i + offset === history.length - 1) san.classList.add('current');
            }
            el.moveList.appendChild(san);
        }
    }
    el.moveList.scrollTop = el.moveList.scrollHeight;
}

function renderGame() {
    const room = app.room;
    const game = app.game;
    const { white, black } = playersByColor();
    const bottom = app.orientation === 'w' ? white : black;
    const top = app.orientation === 'w' ? black : white;

    renderStrip(el.stripTop, top, top && top.id === app.myId);
    renderStrip(el.stripBottom, bottom, bottom && bottom.id === app.myId);
    renderMoveList();

    const myTurn = game && !game.over && app.myRole === 'player' && game.turn === app.myColor;
    const canMove = myTurn && app.connected;

    let selected = app.selected;
    if (selected !== null && game) {
        const piece = game.board[selected];
        if (!piece || (piece === piece.toUpperCase() ? 'w' : 'b') !== app.myColor) {
            selected = null;
            app.hints = new Set();
        }
    }
    app.selected = selected;

    let checkSquare = -1;
    if (game.check) {
        const king = game.turn === 'w' ? 'K' : 'k';
        checkSquare = game.board.indexOf(king);
    }

    boardView.render({
        board: game.board,
        orientation: app.orientation,
        lastMove: game.lastMove,
        selected,
        hints: app.hints,
        checkSquare,
        interactive: canMove
    });

    el.drawBtn.disabled = !myTurn;
    el.resignBtn.disabled = !(game && !game.over && app.myRole === 'player');
    el.rematchBtn.hidden = !(game && game.over && app.myRole === 'player');
    el.backLobbyBtn.hidden = !(room.hostId === app.myId && game && game.over);

    if (game && game.over) {
        el.rematchBtn.disabled = (room.rematch || []).includes(app.myId);
    }

    if (game && game.drawOfferBy && game.drawOfferBy !== app.myId) {
        const by = room.members.find((m) => m.id === game.drawOfferBy);
        el.drawOfferBar.hidden = false;
        el.drawOfferText.textContent = `${by ? by.name : 'Lawan'} menawarkan seri.`;
    } else if (game && game.drawOfferBy === app.myId) {
        el.drawOfferBar.hidden = false;
        el.drawOfferText.textContent = 'Tawaran seri terkirim. Menunggu jawaban.';
    } else {
        el.drawOfferBar.hidden = true;
    }

    renderClocks();
    renderVoice();
    if (!clockTimer) clockTimer = setInterval(renderClocks, 250);
}

function renderVoice() {
    const joined = voice && voice.isJoined;
    const peers = app.voicePeers || [];
    const speaking = voice ? voice.speakingSet() : new Set();
    for (const set of voiceButtons) {
        set.join.hidden = joined;
        set.mute.hidden = !joined;
        set.leave.hidden = !joined;
        if (joined) set.mute.textContent = voice.muted ? 'Bunyikan' : 'Bisukan';
        set.status.textContent = joined
            ? (peers.length > 1 ? `${peers.length} orang di obrolan suara.` : 'Kamu sendirian di obrolan suara.')
            : 'Belum ikut obrolan suara.';
        set.members.innerHTML = '';
        for (const peer of peers) {
            const member = app.room ? app.room.members.find((m) => m.id === peer.id) : null;
            const chip = document.createElement('div');
            chip.className = 'voice-chip';
            if (peer.muted) chip.classList.add('muted');
            if (speaking.has(peer.id)) chip.classList.add('speaking');
            const img = document.createElement('img');
            img.src = avatarSrc(member || { avatar: 'fallback' });
            img.alt = peer.name;
            chip.appendChild(img);
            const label = document.createElement('span');
            label.textContent = peer.id === app.myId ? 'Kamu' : peer.name;
            chip.appendChild(label);
            set.members.appendChild(chip);
        }
    }
}

function appendChat(message) {
    if (!message) return;
    const node = document.createElement('div');
    node.className = 'chat-msg';
    if (message.system) {
        node.classList.add('system');
        const text = document.createElement('span');
        text.className = 'cm-text';
        text.textContent = message.text;
        node.appendChild(text);
    } else {
        if (message.memberId === app.myId) node.classList.add('mine');
        const img = document.createElement('img');
        img.src = avatarSrc(message);
        img.alt = message.name;
        node.appendChild(img);
        const body = document.createElement('div');
        body.className = 'cm-body';
        const name = document.createElement('div');
        name.className = 'cm-name';
        name.textContent = message.name;
        const text = document.createElement('div');
        text.className = 'cm-text';
        text.textContent = message.text;
        body.appendChild(name);
        body.appendChild(text);
        node.appendChild(body);
    }
    el.chatLog.appendChild(node);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    if (!app.chatOpen && !message.system) {
        app.unread += 1;
        el.chatDot.hidden = false;
    }
}

function renderChat() {
    el.chatLog.innerHTML = '';
    if (app.room && app.room.chat) {
        for (const message of app.room.chat) appendChat(message);
    }
    app.unread = 0;
    el.chatDot.hidden = true;
}

function openChat(open) {
    app.chatOpen = open;
    el.chatDrawer.hidden = !open;
    if (open) {
        renderChat();
        el.chatInput.focus();
    }
}

function handleSelect(index) {
    const game = app.game;
    if (!game || game.over || app.myRole !== 'player') return;
    if (!app.connected) return;
    if (game.turn !== app.myColor) {
        toast('Sekarang bukan giliranmu.');
        return;
    }
    const piece = game.board[index];
    if (piece) {
        const color = piece === piece.toUpperCase() ? 'w' : 'b';
        if (color === app.myColor) {
            app.selected = app.selected === index ? null : index;
            app.hints = new Set();
            if (app.selected !== null) {
                const state = createState(game.fen);
                for (const move of legalMoves(state, index)) app.hints.add(move.to);
            }
            renderGame();
            return;
        }
    }
    if (app.selected !== null && app.hints.has(index)) {
        attemptMove(app.selected, index);
    }
}

function attemptMove(from, to) {
    const game = app.game;
    if (!game) return;
    const piece = game.board[from];
    if (!piece) return;
    const type = piece.toUpperCase();
    const rank = to >> 3;
    const promoRank = piece === 'P' ? 0 : piece === 'p' ? 7 : -1;
    if (type === 'P' && rank === promoRank) {
        showPromotion((promotion) => {
            app.selected = null;
            app.hints = new Set();
            send({ type: 'MOVE', from, to, promotion });
        });
        return;
    }
    app.selected = null;
    app.hints = new Set();
    renderGame();
    send({ type: 'MOVE', from, to });
}

function showPromotion(callback) {
    el.promoChoices.innerHTML = '';
    for (const piece of ['q', 'r', 'b', 'n']) {
        const button = document.createElement('button');
        button.type = 'button';
        const img = document.createElement('img');
        img.src = pieceImage(app.myColor || 'w', piece);
        img.alt = piece;
        button.appendChild(img);
        button.addEventListener('click', () => {
            el.promotionModal.hidden = true;
            callback(piece);
        });
        el.promoChoices.appendChild(button);
    }
    el.promotionModal.hidden = false;
}

function handleMove(from, to) {
    const game = app.game;
    if (!game || game.over || app.myRole !== 'player') return;
    if (!app.connected) {
        toast('Koneksi terputus. Menunggu tersambung ulang.', 'err');
        return;
    }
    if (game.turn !== app.myColor) {
        toast('Sekarang bukan giliranmu.');
        return;
    }
    const state = createState(game.fen);
    const legal = findMove(state, from, to, 'q');
    if (!legal) {
        app.selected = null;
        app.hints = new Set();
        renderGame();
        return;
    }
    attemptMove(from, to);
}

function buildTimeControlOptions(controls) {
    const select = el.homeTimeControl;
    select.innerHTML = '';
    for (const [id, meta] of Object.entries(controls || {})) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = meta.label || TIME_FALLBACK[id] || id;
        select.appendChild(option);
    }
    select.value = '10+0';
    const tcSelect = el.tcSelect;
    tcSelect.innerHTML = '';
    for (const [id, meta] of Object.entries(controls || {})) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = meta.label || TIME_FALLBACK[id] || id;
        tcSelect.appendChild(option);
    }
}

async function uploadAvatar(file) {
    if (!CDN.allowedHosts.length) return null;
    el.avatarUploadStatus.textContent = 'Memotong dan mengunggah...';
    const bitmap = await createImageBitmap(file);
    const size = CDN.outputSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob || blob.size > CDN.maxFileBytes) {
        el.avatarUploadStatus.textContent = 'Ukuran foto terlalu besar.';
        return null;
    }
    let userId = loadLocal(CDN.userIdKey, null);
    if (!userId) {
        userId = 'catur-' + randomHex(8);
        saveLocal(CDN.userIdKey, userId);
    }
    const form = new FormData();
    form.append('file', blob, `catur-${Date.now()}.jpg`);
    const response = await fetch(CDN.uploadUrl, {
        method: 'POST',
        headers: { 'x-user-id': userId, 'x-filename': `catur-${Date.now()}.jpg` },
        body: form
    });
    if (!response.ok) {
        el.avatarUploadStatus.textContent = 'Upload gagal. Pakai avatar bawaan saja.';
        return null;
    }
    const data = await response.json();
    const url = data.public_url || data.url;
    if (!url) return null;
    try {
        const host = new URL(url).hostname;
        if (!CDN.allowedHosts.includes(host)) return null;
    } catch {
        return null;
    }
    el.avatarUploadStatus.textContent = 'Foto terpasang.';
    return url;
}

function bindEvents() {
    boardView = new BoardView(el.board, {
        onSelect: handleSelect,
        onMove: handleMove
    });

    el.saveProfileBtn.addEventListener('click', () => {
        const name = el.nameInput.value.trim();
        if (name.length < 2) {
            el.profileError.textContent = 'Nama minimal 2 karakter.';
            el.profileError.hidden = false;
            return;
        }
        app.profile.name = name.slice(0, 16);
        saveLocal(PROFILE_KEY, app.profile);
        el.profileError.hidden = true;
        if (app.invite) {
            const code = app.invite;
            app.invite = null;
            openRoomSocket(code);
            return;
        }
        showScreen('home');
        renderHome();
    });

    el.uploadAvatarBtn.addEventListener('click', () => el.avatarFileInput.click());
    el.avatarFileInput.addEventListener('change', async () => {
        const file = el.avatarFileInput.files && el.avatarFileInput.files[0];
        if (!file) return;
        try {
            const url = await uploadAvatar(file);
            if (url) {
                app.profile.avatarUrl = url;
                refreshAvatarSelection();
            }
        } catch {
            el.avatarUploadStatus.textContent = 'Upload gagal. Pakai avatar bawaan saja.';
        }
        el.avatarFileInput.value = '';
    });
    el.clearAvatarBtn.addEventListener('click', () => {
        app.profile.avatarUrl = null;
        el.avatarUploadStatus.textContent = 'JPG/PNG/WebP, dipotong ke 256\u00d7256.';
        refreshAvatarSelection();
    });
    el.editProfileBtn.addEventListener('click', () => {
        renderProfile();
        showScreen('profile');
    });

    el.quickMatchBtn.addEventListener('click', () => {
        openLobbySocket();
        const start = () => send({
            type: 'FIND_MATCH',
            playerId: app.playerId,
            profile: app.profile,
            timeControlId: el.homeTimeControl.value
        });
        const wait = setInterval(() => {
            if (app.socket && app.socket.readyState === WebSocket.OPEN) {
                clearInterval(wait);
                start();
            }
        }, 60);
        setTimeout(() => clearInterval(wait), 6000);
        el.searchTitle.textContent = 'Mencari lawan...';
        el.searchHint.textContent = 'Menunggu pemain lain masuk ke antrean.';
        showScreen('search');
    });

    el.searchBotBtn.addEventListener('click', () => {
        if (app.socketKind === 'lobby' && app.socket) {
            send({ type: 'CANCEL_MATCH' });
            closeSocket();
        }
        app.pendingBotGame = true;
        openLobbySocket();
        const wait = setInterval(() => {
            if (app.socket && app.socket.readyState === WebSocket.OPEN) {
                clearInterval(wait);
                send({
                    type: 'CREATE_ROOM',
                    playerId: app.playerId,
                    profile: app.profile,
                    timeControlId: el.homeTimeControl.value,
                    hostColor: el.homeColor.value
                });
            }
        }, 60);
        setTimeout(() => clearInterval(wait), 6000);
    });

    el.cancelSearchBtn.addEventListener('click', () => {
        send({ type: 'CANCEL_MATCH' });
        closeSocket();
        showScreen('home');
    });

    el.botGameBtn.addEventListener('click', () => {
        app.pendingBotGame = true;
        openLobbySocket();
        const wait = setInterval(() => {
            if (app.socket && app.socket.readyState === WebSocket.OPEN) {
                clearInterval(wait);
                send({
                    type: 'CREATE_ROOM',
                    playerId: app.playerId,
                    profile: app.profile,
                    timeControlId: el.homeTimeControl.value,
                    hostColor: el.homeColor.value
                });
            }
        }, 60);
        setTimeout(() => clearInterval(wait), 6000);
    });

    el.createRoomBtn.addEventListener('click', () => {
        app.pendingBotGame = false;
        openLobbySocket();
        const wait = setInterval(() => {
            if (app.socket && app.socket.readyState === WebSocket.OPEN) {
                clearInterval(wait);
                send({
                    type: 'CREATE_ROOM',
                    playerId: app.playerId,
                    profile: app.profile,
                    timeControlId: el.homeTimeControl.value,
                    hostColor: el.homeColor.value
                });
            }
        }, 60);
        setTimeout(() => clearInterval(wait), 6000);
    });

    el.joinRoomBtn.addEventListener('click', async () => {
        const code = el.roomCodeInput.value.trim().toUpperCase();
        if (code.length < 4) {
            toast('Kode room minimal 4 karakter.', 'err');
            return;
        }
        try {
            const response = await fetch(`/api/room/${encodeURIComponent(code)}`);
            const info = await response.json();
            if (!info.exists) {
                toast('Kode room tidak ditemukan.', 'err');
                return;
            }
        } catch {
            toast('Tidak bisa memeriksa room. Coba lagi.', 'err');
            return;
        }
        app.pendingBotGame = false;
        forgetSession();
        openRoomSocket(code);
        el.roomCodeInput.value = '';
    });

    el.resumeBtn.addEventListener('click', () => {
        if (!app.session) return;
        app.pendingBotGame = false;
        openRoomSocket(app.session.roomCode);
    });
    el.resumeDismiss.addEventListener('click', () => {
        forgetSession();
        renderHome();
    });

    el.copyCodeBtn.addEventListener('click', async () => {
        if (!app.room) return;
        await navigator.clipboard.writeText(app.room.code).catch(() => {});
        toast('Kode room disalin.', 'ok');
    });
    el.copyLinkBtn.addEventListener('click', async () => {
        if (!app.room) return;
        await navigator.clipboard.writeText(`${location.origin}/?room=${app.room.code}`).catch(() => {});
        toast('Tautan disalin.', 'ok');
    });

    el.tcSelect.addEventListener('change', () => send({
        type: 'SET_OPTIONS',
        timeControlId: el.tcSelect.value,
        hostColor: el.colorSelect.value
    }));
    el.colorSelect.addEventListener('change', () => send({
        type: 'SET_OPTIONS',
        timeControlId: el.tcSelect.value,
        hostColor: el.colorSelect.value
    }));
    el.addBotBtn.addEventListener('click', () => send({ type: 'ADD_BOT' }));
    el.startGameBtn.addEventListener('click', () => send({ type: 'START_GAME' }));
    el.leaveLobbyBtn.addEventListener('click', async () => {
        if (await askConfirm('Keluar room?', 'Kursimu akan dilepas dan kamu kembali ke menu utama.')) {
            send({ type: 'LEAVE_ROOM' });
        }
    });
    el.leaveGameBtn.addEventListener('click', async () => {
        if (await askConfirm('Keluar room?', 'Kalau permainan sedang berjalan, kamu dianggap kalah.')) {
            send({ type: 'LEAVE_ROOM' });
        }
    });
    el.resignBtn.addEventListener('click', async () => {
        if (await askConfirm('Menyerah?', 'Permainan langsung berakhir dan lawanmu menang.')) {
            send({ type: 'RESIGN' });
        }
    });
    el.drawBtn.addEventListener('click', () => send({ type: 'OFFER_DRAW' }));
    el.acceptDrawBtn.addEventListener('click', () => send({ type: 'DRAW_ACCEPT' }));
    el.declineDrawBtn.addEventListener('click', () => send({ type: 'DRAW_DECLINE' }));
    el.rematchBtn.addEventListener('click', () => send({ type: 'REMATCH' }));
    el.backLobbyBtn.addEventListener('click', () => send({ type: 'BACK_TO_LOBBY' }));

    el.chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = el.chatInput.value.trim();
        if (!text) return;
        if (!send({ type: 'CHAT_SEND', text })) {
            toast('Belum tersambung.', 'err');
            return;
        }
        el.chatInput.value = '';
    });
    el.chatFab.addEventListener('click', () => openChat(!app.chatOpen));
    el.chatCloseBtn.addEventListener('click', () => openChat(false));

    for (const set of voiceButtons) {
        set.join.addEventListener('click', async () => {
            if (!voice) return;
            const ok = await voice.join();
            if (ok) {
                const peers = (app.voicePeers || []).map((p) => p.id);
                voice.syncPeers([...peers, app.myId]);
                toast('Kamu ikut obrolan suara.', 'ok');
            }
            renderVoice();
        });
        set.mute.addEventListener('click', () => {
            if (!voice) return;
            voice.toggleMute();
            renderVoice();
        });
        set.leave.addEventListener('click', () => {
            if (!voice) return;
            voice.leave();
            renderVoice();
        });
    }

    el.soundToggle.addEventListener('click', () => {
        app.sound = !app.sound;
        saveLocal(SOUND_KEY, app.sound);
        el.soundToggle.textContent = app.sound ? '\u{1F50A}' : '\u{1F507}';
    });

    window.addEventListener('online', () => {
        if (app.socketKind && !app.connected) scheduleReconnect();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && app.socketKind && !app.connected) scheduleReconnect();
    });
}

async function boot() {
    app.playerId = loadLocal(PLAYER_KEY, null) || 'p_' + randomHex(12);
    saveLocal(PLAYER_KEY, app.playerId);
    app.profile = loadLocal(PROFILE_KEY, null) || { name: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], avatarUrl: null };
    app.sound = loadLocal(SOUND_KEY, true);
    app.session = loadLocal(SESSION_KEY, null);
    if (app.session && app.session.playerId && app.session.playerId !== app.playerId) app.session = null;
    el.soundToggle.textContent = app.sound ? '\u{1F50A}' : '\u{1F507}';

    voice = new VoiceChat({
        selfId: app.playerId,
        send,
        onChange: renderVoice,
        onError: (text) => toast(text, 'err')
    });

    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        buildTimeControlOptions(config.timeControls);
        app.graceMs = config.graceMs;
        app.pauseMs = config.disconnectPauseMs;
    } catch {
        buildTimeControlOptions(null);
    }

    bindEvents();
    setConnected(false, 'terputus');

    const url = new URL(location.href);
    const invited = url.searchParams.get('room');
    if (invited) {
        history.replaceState(null, '', location.pathname);
        app.invite = invited.toUpperCase();
        app.pendingBotGame = false;
        forgetSession();
    }

    if (app.profile.name) {
        renderHome();
        showScreen('home');
        if (app.invite) openRoomSocket(app.invite);
        else if (app.session && app.session.token) openRoomSocket(app.session.roomCode);
    } else {
        renderProfile();
        showScreen('profile');
        if (app.invite) toast(`Kamu diundang ke room ${app.invite}. Isi profil dulu ya.`);
    }
}

boot();
