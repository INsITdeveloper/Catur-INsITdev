import {
    WHITE,
    BLACK,
    createState,
    cloneState,
    legalMoves,
    findMove,
    moveToSan,
    applyMove,
    gameStatus,
    stateToFen,
    squareName,
    colorOf,
    typeOf,
    opposite,
    capturedBy
} from '../client/rules.js';
import { chooseBotMove, botIdentity } from './bot.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const TOKEN_PATTERN = /^[a-f0-9]{24,64}$/;
const AVATAR_PATTERN = /^(a(0[1-9]|1[0-4])|fallback)$/;
const AVATAR_URL_HOSTS = new Set(['cloudins-cdn.insjay.biz.id', 'cdnins.insjay.biz.id']);
const MAX_NAME_LENGTH = 16;
const MAX_AVATAR_URL_LENGTH = 400;
const MAX_WS_BYTES = 16 * 1024;
const MAX_CHAT_LENGTH = 280;
const CHAT_HISTORY = 60;
const MAX_SEATS = 2;
const GRACE_MS = 120000;
const DISCONNECT_PAUSE_MS = 60000;
const BOT_DELAY_MS = 900;
const BOT_BUDGET_MS = 700;
const MATCH_BOT_FALLBACK_MS = 8000;
const EMPTY_ROOM_TTL_MS = 20 * 60 * 1000;
const LOBBY_SEAT_TTL_MS = 90 * 1000;

export const TIME_CONTROLS = {
    '3+2': { initial: 180000, increment: 2000, label: '3 menit + 2 detik' },
    '5+0': { initial: 300000, increment: 0, label: '5 menit' },
    '10+0': { initial: 600000, increment: 0, label: '10 menit' },
    '10+5': { initial: 600000, increment: 5000, label: '10 menit + 5 detik' },
    '30+0': { initial: 1800000, increment: 0, label: '30 menit' },
    unlimited: { initial: null, increment: 0, label: 'Tanpa batas waktu' }
};

const PIECE_NAMES = {
    P: 'Pion', N: 'Kuda', B: 'Uskup', R: 'Benteng', Q: 'Ratu', K: 'Raja'
};

function randomId(bytes = 8) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeText(raw, max) {
    if (typeof raw !== 'string') return null;
    const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean.length) return null;
    return clean.slice(0, max);
}

function sanitizeName(raw) {
    const clean = sanitizeText(raw, MAX_NAME_LENGTH);
    if (!clean || clean.length < 2) return null;
    return clean;
}

function sanitizeAvatar(raw) {
    return typeof raw === 'string' && AVATAR_PATTERN.test(raw) ? raw : 'fallback';
}

function sanitizeAvatarUrl(raw) {
    if (typeof raw !== 'string' || !raw.length || raw.length > MAX_AVATAR_URL_LENGTH) return null;
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (!AVATAR_URL_HOSTS.has(parsed.hostname)) return null;
    return parsed.toString();
}

function sanitizeProfile(raw) {
    const profile = raw && typeof raw === 'object' ? raw : {};
    return {
        name: sanitizeName(profile.name) || 'Pemain',
        avatar: sanitizeAvatar(profile.avatar),
        avatarUrl: sanitizeAvatarUrl(profile.avatarUrl)
    };
}

function sanitizePlayerId(raw) {
    return typeof raw === 'string' && PLAYER_ID_PATTERN.test(raw) ? raw : null;
}

function sanitizeTimeControl(raw) {
    return typeof raw === 'string' && TIME_CONTROLS[raw] ? raw : '10+0';
}

function sanitizeHostColor(raw) {
    return raw === 'w' || raw === 'b' ? raw : 'random';
}

function reasonText(reason, winnerName, loserName) {
    switch (reason) {
        case 'checkmate': return `${winnerName} menang dengan skakmat.`;
        case 'timeout': return `${loserName} kehabisan waktu. ${winnerName} menang.`;
        case 'resign': return `${loserName} menyerah. ${winnerName} menang.`;
        case 'abandon': return `${loserName} meninggalkan permainan. ${winnerName} menang.`;
        case 'stalemate': return 'Seri karena buntu (stalemate).';
        case 'repetition': return 'Seri karena posisi berulang tiga kali.';
        case 'fifty': return 'Seri karena aturan 50 langkah.';
        case 'material': return 'Seri karena materi tidak cukup untuk skakmat.';
        case 'agreement': return 'Seri atas kesepakatan kedua pemain.';
        case 'aborted': return 'Permainan dibatalkan.';
        default: return 'Permainan selesai.';
    }
}

export class LobbyDO {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.queue = [];
        this.socketQueue = new Map();
        ctx.blockConcurrencyWhile(async () => {
            const codes = await ctx.storage.get('codes');
            this.codes = new Set(Array.isArray(codes) ? codes : []);
        });
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/internal/room-created' && request.method === 'POST') {
            const body = await request.json();
            this.codes.add(body.code);
            if (this.codes.size > 5000) this.codes = new Set([...this.codes].slice(-2000));
            await this.ctx.storage.put('codes', [...this.codes]);
            return Response.json({ ok: true });
        }
        if (url.pathname === '/internal/room-closed' && request.method === 'POST') {
            const body = await request.json();
            this.codes.delete(body.code);
            await this.ctx.storage.put('codes', [...this.codes]);
            return Response.json({ ok: true });
        }

        const upgrade = request.headers.get('Upgrade');
        if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
            return new Response('Butuh Upgrade: websocket', { status: 426 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        this.socketQueue.set(server, null);

        server.addEventListener('message', (event) => {
            let message;
            try {
                if (typeof event.data !== 'string' || event.data.length > MAX_WS_BYTES) return;
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            try {
                this.handleMessage(server, message);
            } catch (err) {
                console.error('lobby error', err);
                this.send(server, { type: 'ERROR', message: 'Terjadi kesalahan di server.' });
            }
        });

        const detach = () => this.detach(server);
        server.addEventListener('close', detach);
        server.addEventListener('error', detach);

        return new Response(null, { status: 101, webSocket: client });
    }

    send(ws, payload) {
        if (!ws) return;
        try {
            ws.send(JSON.stringify(payload));
        } catch (err) {
            console.error('send gagal', err);
        }
    }

    detach(ws) {
        const entry = this.socketQueue.get(ws);
        this.socketQueue.delete(ws);
        if (!entry) return;
        const index = this.queue.indexOf(entry);
        if (index !== -1) this.queue.splice(index, 1);
        if (entry.timer) clearTimeout(entry.timer);
    }

    newCode() {
        for (let attempt = 0; attempt < 200; attempt++) {
            let code = '';
            const bytes = new Uint8Array(ROOM_CODE_LENGTH);
            crypto.getRandomValues(bytes);
            for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
            if (!this.codes.has(code)) {
                this.codes.add(code);
                return code;
            }
        }
        return 'R' + randomId(4).toUpperCase();
    }

    async allocateRoom(seats, options) {
        const code = this.newCode();
        await this.ctx.storage.put('codes', [...this.codes]);
        const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
        const response = await stub.fetch('https://room.internal/internal/init', {
            method: 'POST',
            body: JSON.stringify({ code, seats, options })
        });
        const data = await response.json();
        return { code, seats: data.seats };
    }

    async handleMessage(ws, message) {
        const type = message?.type;

        if (type === 'FIND_MATCH') {
            const playerId = sanitizePlayerId(message.playerId);
            if (!playerId) {
                this.send(ws, { type: 'ERROR', message: 'ID pemain tidak valid.' });
                return;
            }
            if (this.queue.some((entry) => entry.playerId === playerId)) {
                this.send(ws, { type: 'ERROR', message: 'Kamu sudah ada di antrean.' });
                return;
            }
            const profile = sanitizeProfile(message.profile);
            const entry = {
                ws,
                playerId,
                profile,
                timeControlId: sanitizeTimeControl(message.timeControlId),
                timer: null
            };
            this.queue.push(entry);
            this.socketQueue.set(ws, entry);
            this.send(ws, { type: 'MATCH_SEARCHING', message: 'Mencari lawan...' });
            entry.timer = setTimeout(() => {
                entry.timer = null;
                this.pairWithBot(entry);
            }, MATCH_BOT_FALLBACK_MS);
            await this.tryMatch();
            return;
        }

        if (type === 'CANCEL_MATCH') {
            const entry = this.socketQueue.get(ws);
            if (!entry) {
                this.send(ws, { type: 'ERROR', message: 'Kamu tidak sedang mencari lawan.' });
                return;
            }
            this.detach(ws);
            this.socketQueue.set(ws, null);
            this.send(ws, { type: 'MATCH_CANCELLED' });
            return;
        }

        if (type === 'CREATE_ROOM') {
            const playerId = sanitizePlayerId(message.playerId);
            if (!playerId) {
                this.send(ws, { type: 'ERROR', message: 'ID pemain tidak valid.' });
                return;
            }
            const profile = sanitizeProfile(message.profile);
            const options = {
                timeControlId: sanitizeTimeControl(message.timeControlId),
                hostColor: sanitizeHostColor(message.hostColor)
            };
            const result = await this.allocateRoom([{ playerId, profile, host: true }], options);
            this.send(ws, {
                type: 'ROOM_CREATED',
                roomCode: result.code,
                playerId,
                token: result.seats[0].token
            });
            return;
        }

        if (type === 'PING') {
            this.send(ws, { type: 'PONG', at: Date.now() });
            return;
        }

        this.send(ws, { type: 'ERROR', message: 'Perintah tidak dikenal.' });
    }

    async tryMatch() {
        while (this.queue.length >= 2) {
            const a = this.queue.splice(Math.floor(Math.random() * this.queue.length), 1)[0];
            const b = this.queue.splice(Math.floor(Math.random() * this.queue.length), 1)[0];
            for (const entry of [a, b]) {
                if (entry.timer) clearTimeout(entry.timer);
                entry.timer = null;
                this.socketQueue.set(entry.ws, null);
            }
            const options = { timeControlId: a.timeControlId, hostColor: 'random', autoStart: true };
            const result = await this.allocateRoom([
                { playerId: a.playerId, profile: a.profile, host: true },
                { playerId: b.playerId, profile: b.profile, host: false }
            ], options);
            this.send(a.ws, {
                type: 'MATCH_FOUND',
                roomCode: result.code,
                playerId: a.playerId,
                token: result.seats[0].token
            });
            this.send(b.ws, {
                type: 'MATCH_FOUND',
                roomCode: result.code,
                playerId: b.playerId,
                token: result.seats[1].token
            });
        }
    }

    async pairWithBot(entry) {
        const index = this.queue.indexOf(entry);
        if (index === -1) return;
        this.queue.splice(index, 1);
        this.socketQueue.set(entry.ws, null);
        const options = { timeControlId: entry.timeControlId, hostColor: 'random', autoStart: true };
        const result = await this.allocateRoom([
            { playerId: entry.playerId, profile: entry.profile, host: true },
            { bot: true, host: false }
        ], options);
        this.send(entry.ws, {
            type: 'MATCH_FOUND',
            roomCode: result.code,
            playerId: entry.playerId,
            token: result.seats[0].token,
            botFilled: true
        });
    }
}

export class RoomDO {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.room = null;
        this.sockets = new Map();
        this.socketOwner = new Map();
        ctx.blockConcurrencyWhile(async () => {
            this.room = (await ctx.storage.get('room')) || null;
        });
    }

    async persist() {
        if (this.room) await this.ctx.storage.put('room', this.room);
    }

    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === '/internal/init' && request.method === 'POST') {
            const body = await request.json();
            const seats = this.initialize(body.code, body.seats || [], body.options || {});
            await this.persist();
            this.scheduleAlarm();
            return Response.json({ ok: true, seats });
        }

        if (url.pathname === '/internal/info') {
            const room = this.room;
            if (!room) return Response.json({ exists: false });
            return Response.json({
                exists: true,
                code: room.code,
                phase: room.phase,
                players: room.members.filter((m) => m.role === 'player').length,
                freeSeats: room.members.filter((m) => m.role === 'player').length < MAX_SEATS,
                timeControlId: room.options.timeControlId
            });
        }

        const upgrade = request.headers.get('Upgrade');
        if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
            return new Response('Butuh Upgrade: websocket', { status: 426 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();

        server.addEventListener('message', (event) => {
            let message;
            try {
                if (typeof event.data !== 'string' || event.data.length > MAX_WS_BYTES) {
                    this.sendError(server, 'Pesan terlalu besar atau tidak valid.');
                    return;
                }
                message = JSON.parse(event.data);
            } catch {
                this.sendError(server, 'Format pesan tidak valid.');
                return;
            }
            this.handleMessage(server, message).catch((err) => {
                console.error('room error', err);
                this.sendError(server, 'Terjadi kesalahan di server.');
            });
        });

        const detach = () => {
            this.handleClose(server).catch((err) => console.error('close error', err));
        };
        server.addEventListener('close', detach);
        server.addEventListener('error', detach);

        return new Response(null, { status: 101, webSocket: client });
    }

    initialize(code, seatInputs, options) {
        const timeControlId = sanitizeTimeControl(options.timeControlId);
        const members = [];
        const created = [];
        let hostId = null;

        for (const seat of seatInputs) {
            const token = randomId(16);
            if (seat.bot) {
                const identity = botIdentity(members.map((m) => m.name));
                const id = 'bot_' + randomId(4);
                members.push({
                    id,
                    token,
                    name: identity.name,
                    avatar: identity.avatar,
                    avatarUrl: null,
                    isBot: true,
                    role: 'player',
                    color: null,
                    connected: true,
                    offlineAt: null,
                    voice: false,
                    muted: false,
                    joinedAt: Date.now()
                });
                created.push({ id, token, bot: true });
                continue;
            }
            const profile = sanitizeProfile(seat.profile);
            const id = sanitizePlayerId(seat.playerId) || 'p_' + randomId(6);
            members.push({
                id,
                token,
                name: profile.name,
                avatar: profile.avatar,
                avatarUrl: profile.avatarUrl,
                isBot: false,
                role: 'player',
                color: null,
                connected: false,
                offlineAt: Date.now(),
                voice: false,
                muted: false,
                joinedAt: Date.now()
            });
            created.push({ id, token, bot: false });
            if (seat.host) hostId = id;
        }

        if (!hostId) hostId = created[0] ? created[0].id : null;

        this.room = {
            code,
            hostId,
            createdAt: Date.now(),
            autoStart: Boolean(options.autoStart),
            phase: 'lobby',
            options: {
                timeControlId,
                hostColor: sanitizeHostColor(options.hostColor)
            },
            members,
            game: null,
            chat: [],
            rematch: [],
            updatedAt: Date.now()
        };
        return created;
    }

    send(ws, payload) {
        if (!ws || ws.readyState !== 1) return;
        try {
            ws.send(JSON.stringify(payload));
        } catch (err) {
            console.error('send gagal', err);
        }
    }

    sendError(ws, message) {
        this.send(ws, { type: 'ERROR', message });
    }

    memberById(id) {
        return this.room?.members.find((m) => m.id === id) || null;
    }

    playerByColor(color) {
        return this.room?.members.find((m) => m.role === 'player' && m.color === color) || null;
    }

    connectedHumans() {
        return this.room.members.filter((m) => m.role === 'player' && !m.isBot && m.connected).length;
    }

    players() {
        return this.room.members.filter((m) => m.role === 'player');
    }

    broadcast(payload, exceptId = null) {
        for (const [memberId, ws] of this.sockets) {
            if (exceptId && memberId === exceptId) continue;
            this.send(ws, payload);
        }
    }

    broadcastState() {
        for (const [memberId, ws] of this.sockets) {
            this.send(ws, this.buildState(memberId));
        }
    }

    publicMember(member) {
        return {
            id: member.id,
            name: member.name,
            avatar: member.avatar,
            avatarUrl: member.avatarUrl,
            isBot: member.isBot,
            role: member.role,
            color: member.color,
            connected: member.isBot ? true : member.connected,
            abandoned: Boolean(member.abandoned),
            voice: member.voice,
            muted: member.muted
        };
    }

    buildState(memberId) {
        const room = this.room;
        const me = this.memberById(memberId);
        const now = Date.now();
        const payload = {
            type: 'STATE',
            serverTime: now,
            graceMs: GRACE_MS,
            disconnectPauseMs: DISCONNECT_PAUSE_MS,
            room: {
                code: room.code,
                hostId: room.hostId,
                phase: room.phase,
                options: room.options,
                you: me
                    ? { id: me.id, role: me.role, color: me.color, isBot: false }
                    : null,
                members: room.members.map((m) => this.publicMember(m)),
                chat: room.chat.slice(-40),
                rematch: room.rematch.slice(),
                timeControls: TIME_CONTROLS
            },
            game: null
        };

        if (room.game) {
            const g = room.game;
            const state = g.state;
            payload.game = {
                fen: stateToFen(state),
                board: state.board,
                turn: state.turn,
                history: state.history.map((h) => h.san),
                lastMove: g.lastMove,
                check: Boolean(g.check),
                over: g.over,
                result: g.result,
                reason: g.reason,
                winnerColor: g.winnerColor,
                drawOfferBy: g.drawOfferBy,
                captured: {
                    w: capturedBy(state, WHITE),
                    b: capturedBy(state, BLACK)
                },
                clocks: g.clock
                    ? {
                        initial: g.clock.initial,
                        increment: g.clock.increment,
                        w: this.clockMs(WHITE, now),
                        b: this.clockMs(BLACK, now),
                        running: g.clock.lastTick !== null
                    }
                    : null,
                clockDeadline: this.clockDeadline(),
                moveNumber: Math.floor(state.history.length / 2) + 1
            };
        }
        return payload;
    }

    clockMs(color, now) {
        const g = this.room.game;
        if (!g || !g.clock || g.clock.initial === null || g.clock.lastTick === null) {
            return g && g.clock ? g.clock[color] : null;
        }
        let elapsed = now - g.clock.lastTick;
        const member = this.playerByColor(color);
        if (member && !member.isBot && !member.connected && g.state.turn === color) {
            const paused = Math.min(Math.max(0, now - member.offlineAt), DISCONNECT_PAUSE_MS);
            elapsed = Math.max(0, elapsed - paused);
        }
        return Math.max(0, g.clock[color] - elapsed);
    }

    clockDeadline() {
        const g = this.room.game;
        if (!g || !g.clock || g.clock.initial === null || g.clock.lastTick === null || g.over) return null;
        const color = g.state.turn;
        const member = this.playerByColor(color);
        const paused = member && !member.isBot && !member.connected ? DISCONNECT_PAUSE_MS : 0;
        return g.clock.lastTick + g.clock[color] + paused;
    }

    settleClock(now) {
        const g = this.room.game;
        if (!g || !g.clock || g.clock.initial === null || g.clock.lastTick === null) return;
        const color = g.state.turn;
        g.clock[color] = this.clockMs(color, now);
        g.clock.lastTick = now;
    }

    finishGame(result, reason, winnerColor) {
        const g = this.room.game;
        if (!g || g.over) return;
        g.over = true;
        g.result = result;
        g.reason = reason;
        g.winnerColor = winnerColor;
        g.drawOfferBy = null;
        g.clock && (g.clock.lastTick = null);
        this.room.phase = 'finished';
        this.room.rematch = [];
        const winner = winnerColor ? this.playerByColor(winnerColor) : null;
        const loserColor = winnerColor ? opposite(winnerColor) : null;
        const loser = loserColor ? this.playerByColor(loserColor) : null;
        const text = reasonText(
            reason,
            winner ? winner.name : 'Putih',
            loser ? loser.name : 'Hitam'
        );
        this.broadcast({
            type: 'GAME_OVER',
            result,
            reason,
            winnerColor,
            winnerName: winner ? winner.name : null,
            text
        });
    }

    maybeAutoStart() {
        const room = this.room;
        if (!room || !room.autoStart || room.phase !== 'lobby' || room.game) return;
        const players = this.players();
        if (players.length < 2) return;
        if (players.some((p) => !p.isBot && !p.connected)) return;
        this.startGame();
    }

    startGame() {
        const players = this.players();
        if (players.length < 2) {
            this.broadcast({ type: 'ERROR', message: 'Butuh dua pemain untuk mulai.' });
            return;
        }
        const humans = players.filter((p) => !p.isBot);
        if (humans.some((p) => !p.connected)) {
            this.broadcast({ type: 'ERROR', message: 'Masih ada pemain yang belum terhubung.' });
            return;
        }
        const tc = TIME_CONTROLS[this.room.options.timeControlId] || TIME_CONTROLS['10+0'];
        const host = this.memberById(this.room.hostId) || players[0];
        const hostColor = this.room.options.hostColor === 'w' || this.room.options.hostColor === 'b'
            ? this.room.options.hostColor
            : (Math.random() < 0.5 ? WHITE : BLACK);
        const other = players.find((p) => p.id !== host.id) || players[1];
        host.color = hostColor;
        other.color = opposite(hostColor);
        if (other.role !== 'player') other.role = 'player';

        const state = createState();
        this.room.game = {
            state,
            clock: tc.initial === null
                ? { initial: null, increment: 0, w: null, b: null, lastTick: null }
                : { initial: tc.initial, increment: tc.increment, w: tc.initial, b: tc.initial, lastTick: Date.now() },
            startedAt: Date.now(),
            lastMove: null,
            check: false,
            over: false,
            result: null,
            reason: null,
            winnerColor: null,
            drawOfferBy: null,
            botDeadline: null
        };
        this.room.phase = 'playing';
        this.room.rematch = [];
        this.broadcast({
            type: 'GAME_START',
            message: `Permainan dimulai. ${host.name} memegang ${hostColor === WHITE ? 'putih' : 'hitam'}.`
        });
        this.broadcastState();
        this.scheduleAlarm();
    }

    afterMove(move, san) {
        const g = this.room.game;
        const mover = colorOf(move.piece);
        if (g.clock && g.clock.initial !== null) {
            g.clock[mover] = Math.max(0, g.clock[mover]) + g.clock.increment;
            g.clock.lastTick = Date.now();
        }
        g.lastMove = { from: move.from, to: move.to, san };
        g.drawOfferBy = null;
        const status = gameStatus(g.state);
        g.check = Boolean(status.check);
        this.room.chat.push({
            id: randomId(4),
            system: true,
            text: `${this.playerByColor(mover)?.name || '?'}: ${san}`,
            at: Date.now()
        });
        if (this.room.chat.length > CHAT_HISTORY) this.room.chat.splice(0, this.room.chat.length - CHAT_HISTORY);

        if (status.over) {
            this.finishGame(status.result, status.reason, status.result === 'draw' ? null : status.result);
        }
        this.broadcastState();
        this.scheduleAlarm();
    }

    maybeRunBot() {
        const g = this.room.game;
        if (!g || g.over) return;
        const member = this.playerByColor(g.state.turn);
        if (!member || !member.isBot) {
            g.botDeadline = null;
            return;
        }
        if (!g.botDeadline) g.botDeadline = Date.now() + BOT_DELAY_MS;
    }

    runBotIfDue(now) {
        const g = this.room.game;
        if (!g || g.over) return false;
        const member = this.playerByColor(g.state.turn);
        if (!member || !member.isBot) return false;
        if (!g.botDeadline) g.botDeadline = now + BOT_DELAY_MS;
        if (now < g.botDeadline) return false;
        g.botDeadline = null;
        const move = chooseBotMove(g.state, BOT_BUDGET_MS);
        if (!move) {
            const status = gameStatus(g.state);
            this.finishGame(status.result || 'draw', status.reason || 'stalemate', null);
            return true;
        }
        const san = moveToSan(g.state, move);
        applyMove(g.state, move, san);
        this.afterMove(move, san);
        return true;
    }

    nextDeadline(now) {
        const deadlines = [];
        const room = this.room;
        const g = room.game;
        if (g && !g.over) {
            if (g.clock && g.clock.initial !== null && g.clock.lastTick !== null) {
                const color = g.state.turn;
                const remaining = this.clockMs(color, now);
                if (remaining !== null) deadlines.push(now + Math.max(250, remaining));
            }
            const member = this.playerByColor(g.state.turn);
            if (member && member.isBot) {
                deadlines.push(g.botDeadline || now + BOT_DELAY_MS);
            }
        }
        for (const member of room.members) {
            if (member.isBot || member.connected || member.offlineAt === null) continue;
            deadlines.push(member.offlineAt + GRACE_MS);
        }
        if (!this.connectedHumans()) deadlines.push(now + EMPTY_ROOM_TTL_MS);
        if (!deadlines.length) return null;
        return Math.min(...deadlines);
    }

    scheduleAlarm() {
        const at = this.nextDeadline(Date.now());
        if (at === null) {
            this.ctx.storage.deleteAlarm().catch(() => {});
            return;
        }
        this.ctx.storage.setAlarm(at).catch((err) => console.error('alarm gagal', err));
    }

    async alarm() {
        if (!this.room) return;
        const now = Date.now();
        this.settleClock(now);

        const g = this.room.game;
        if (g && !g.over && g.clock && g.clock.initial !== null) {
            const color = g.state.turn;
            if (this.clockMs(color, now) <= 0) {
                this.finishGame(opposite(color), 'timeout', opposite(color));
            }
        }

        for (const member of [...this.room.members]) {
            if (member.isBot || member.connected || member.offlineAt === null) continue;
            if (now - member.offlineAt < GRACE_MS) continue;
            if (this.room.phase === 'playing' && member.role === 'player') {
                member.abandoned = true;
                const other = this.players().find((p) => p.id !== member.id);
                const unlimited = !this.room.game?.clock || this.room.game.clock.initial === null;
                if (unlimited && other && !other.abandoned) {
                    this.finishGame(other.color, 'abandon', other.color);
                }
            } else {
                this.removeMember(member.id);
            }
        }

        this.runBotIfDue(now);

        if (!this.connectedHumans()) {
            const humans = this.room.members.filter((m) => !m.isBot);
            const allGone = humans.every((m) => !m.connected && m.offlineAt !== null && now - m.offlineAt > EMPTY_ROOM_TTL_MS);
            if (allGone || !humans.length) {
                await this.destroyRoom();
                return;
            }
        }

        await this.persist();
        this.broadcastState();
        this.scheduleAlarm();
    }

    async destroyRoom() {
        const code = this.room.code;
        this.room = null;
        await this.ctx.storage.deleteAll();
        try {
            const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
            await stub.fetch('https://lobby.internal/internal/room-closed', {
                method: 'POST',
                body: JSON.stringify({ code })
            });
        } catch (err) {
            console.error('room-closed gagal', err);
        }
    }

    removeMember(memberId) {
        const room = this.room;
        const member = this.memberById(memberId);
        if (!member) return;
        room.members = room.members.filter((m) => m.id !== memberId);
        room.rematch = room.rematch.filter((id) => id !== memberId);
        const ws = this.sockets.get(memberId);
        if (ws) {
            this.sockets.delete(memberId);
            this.socketOwner.delete(ws);
            try {
                ws.close(1000, 'dikeluarkan');
            } catch {}
        }
        if (room.hostId === memberId) {
            const next = room.members.find((m) => !m.isBot && m.role === 'player')
                || room.members.find((m) => !m.isBot);
            room.hostId = next ? next.id : null;
        }
        if (room.game && member.role === 'player') {
            const other = this.players().find((p) => p.id !== memberId);
            if (other && !room.game.over) {
                this.finishGame(other.color, 'abandon', other.color);
            }
        }
        if (room.phase === 'playing' && this.players().length < 2) {
            this.room.phase = 'lobby';
            this.room.game = null;
        }
        this.broadcast({
            type: 'MEMBER_LEFT',
            memberId,
            name: member.name
        });
    }

    async handleClose(ws) {
        const memberId = this.socketOwner.get(ws);
        this.socketOwner.delete(ws);
        if (!memberId || this.sockets.get(memberId) !== ws) return;
        this.sockets.delete(memberId);
        const member = this.memberById(memberId);
        if (!member) return;
        const now = Date.now();
        this.settleClock(now);
        member.connected = false;
        member.offlineAt = now;
        member.voice = false;
        member.muted = false;
        await this.persist();
        this.broadcast({
            type: 'MEMBER_OFFLINE',
            memberId,
            name: member.name,
            graceMs: GRACE_MS,
            pauseMs: DISCONNECT_PAUSE_MS
        }, memberId);
        this.broadcastVoicePeers();
        this.broadcastState();
        this.scheduleAlarm();
    }

    async handleMessage(ws, message) {
        const room = this.room;
        const type = message?.type;
        if (!room) {
            this.sendError(ws, 'Room ini sudah tidak aktif.');
            return;
        }

        if (type === 'PING') {
            this.send(ws, { type: 'PONG', at: Date.now() });
            return;
        }

        if (type === 'JOIN' || type === 'RESUME') {
            await this.attach(ws, message);
            return;
        }

        const memberId = this.socketOwner.get(ws);
        const member = memberId ? this.memberById(memberId) : null;
        if (!member) {
            this.sendError(ws, 'Kamu belum masuk ke room ini.');
            return;
        }

        switch (type) {
            case 'CHAT_SEND': {
                const text = sanitizeText(message.text, MAX_CHAT_LENGTH);
                if (!text) {
                    this.sendError(ws, 'Pesan kosong atau terlalu panjang.');
                    return;
                }
                room.chat.push({
                    id: randomId(4),
                    memberId: member.id,
                    name: member.name,
                    avatar: member.avatar,
                    avatarUrl: member.avatarUrl,
                    isBot: member.isBot,
                    text,
                    at: Date.now()
                });
                if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
                this.broadcast({
                    type: 'CHAT_MESSAGE',
                    message: room.chat[room.chat.length - 1]
                });
                await this.persist();
                return;
            }

            case 'SET_OPTIONS': {
                if (room.hostId !== member.id) {
                    this.sendError(ws, 'Hanya pembuat room yang bisa mengubah pengaturan.');
                    return;
                }
                if (room.phase !== 'lobby') {
                    this.sendError(ws, 'Pengaturan hanya bisa diubah di lobby.');
                    return;
                }
                room.options.timeControlId = sanitizeTimeControl(message.timeControlId);
                room.options.hostColor = sanitizeHostColor(message.hostColor);
                await this.persist();
                this.broadcastState();
                return;
            }

            case 'ADD_BOT': {
                if (room.hostId !== member.id) {
                    this.sendError(ws, 'Hanya pembuat room yang bisa menambah bot.');
                    return;
                }
                if (room.phase !== 'lobby') {
                    this.sendError(ws, 'Bot hanya bisa ditambah di lobby.');
                    return;
                }
                if (this.players().length >= MAX_SEATS) {
                    this.sendError(ws, 'Kursi pemain sudah penuh.');
                    return;
                }
                const identity = botIdentity(room.members.map((m) => m.name));
                room.members.push({
                    id: 'bot_' + randomId(4),
                    token: randomId(16),
                    name: identity.name,
                    avatar: identity.avatar,
                    avatarUrl: null,
                    isBot: true,
                    role: 'player',
                    color: null,
                    connected: true,
                    offlineAt: null,
                    voice: false,
                    muted: false,
                    joinedAt: Date.now()
                });
                await this.persist();
                this.broadcastState();
                return;
            }

            case 'REMOVE_BOT': {
                if (room.hostId !== member.id) {
                    this.sendError(ws, 'Hanya pembuat room yang bisa menghapus bot.');
                    return;
                }
                const target = this.memberById(message.memberId);
                if (!target || !target.isBot) {
                    this.sendError(ws, 'Bot tidak ditemukan.');
                    return;
                }
                this.removeMember(target.id);
                await this.persist();
                this.broadcastState();
                return;
            }

            case 'TAKE_OVER_BOT': {
                if (room.phase !== 'playing' || !room.game || room.game.over) {
                    this.sendError(ws, 'Tidak ada permainan yang bisa dilanjutkan.');
                    return;
                }
                const target = this.memberById(message.memberId);
                if (!target || target.role !== 'player' || target.id === member.id) {
                    this.sendError(ws, 'Pemain itu tidak bisa digantikan.');
                    return;
                }
                if (!target.abandoned && target.connected) {
                    this.sendError(ws, 'Pemain itu masih terhubung.');
                    return;
                }
                target.isBot = true;
                target.abandoned = false;
                target.connected = true;
                target.name = botIdentity(room.members.filter((m) => m.id !== target.id).map((m) => m.name)).name;
                await this.persist();
                this.broadcastState();
                this.scheduleAlarm();
                return;
            }

            case 'START_GAME': {
                if (room.hostId !== member.id) {
                    this.sendError(ws, 'Hanya pembuat room yang bisa memulai.');
                    return;
                }
                if (room.phase !== 'lobby') {
                    this.sendError(ws, 'Permainan sudah berjalan.');
                    return;
                }
                this.startGame();
                await this.persist();
                return;
            }

            case 'MOVE': {
                if (room.phase !== 'playing' || !room.game || room.game.over) {
                    this.sendError(ws, 'Permainan belum berjalan.');
                    return;
                }
                if (member.role !== 'player') {
                    this.sendError(ws, 'Penonton tidak bisa menggerakkan bidak.');
                    return;
                }
                const g = room.game;
                if (g.state.turn !== member.color) {
                    this.sendError(ws, 'Bukan giliranmu.');
                    return;
                }
                const now = Date.now();
                this.settleClock(now);
                if (g.clock && g.clock.initial !== null && this.clockMs(member.color, now) <= 0) {
                    this.finishGame(opposite(member.color), 'timeout', opposite(member.color));
                    await this.persist();
                    this.broadcastState();
                    return;
                }
                const move = findMove(g.state, message.from, message.to, message.promotion);
                if (!move) {
                    this.sendError(ws, 'Langkah itu tidak sah.');
                    return;
                }
                const san = moveToSan(g.state, move);
                applyMove(g.state, move, san);
                this.afterMove(move, san);
                await this.persist();
                return;
            }

            case 'RESIGN': {
                if (room.phase !== 'playing' || !room.game || room.game.over || member.role !== 'player') {
                    this.sendError(ws, 'Tidak ada permainan yang bisa dihentikan.');
                    return;
                }
                this.finishGame(opposite(member.color), 'resign', opposite(member.color));
                await this.persist();
                this.broadcastState();
                return;
            }

            case 'OFFER_DRAW': {
                if (room.phase !== 'playing' || !room.game || room.game.over || member.role !== 'player') {
                    this.sendError(ws, 'Tidak ada permainan berjalan.');
                    return;
                }
                room.game.drawOfferBy = member.id;
                this.broadcastState();
                await this.persist();
                return;
            }

            case 'DRAW_ACCEPT': {
                const g = room.game;
                if (!g || g.over || !g.drawOfferBy || g.drawOfferBy === member.id) {
                    this.sendError(ws, 'Tidak ada tawaran seri untuk diterima.');
                    return;
                }
                this.finishGame('draw', 'agreement', null);
                await this.persist();
                this.broadcastState();
                return;
            }

            case 'DRAW_DECLINE': {
                const g = room.game;
                if (!g || !g.drawOfferBy || g.drawOfferBy === member.id) {
                    this.sendError(ws, 'Tidak ada tawaran seri.');
                    return;
                }
                g.drawOfferBy = null;
                this.broadcastState();
                await this.persist();
                return;
            }

            case 'REMATCH': {
                if (room.phase !== 'finished') {
                    this.sendError(ws, 'Permainan belum selesai.');
                    return;
                }
                if (member.role !== 'player') {
                    this.sendError(ws, 'Hanya pemain yang bisa minta ulang.');
                    return;
                }
                if (!room.rematch.includes(member.id)) room.rematch.push(member.id);
                const players = this.players();
                const allVoted = players.every((p) => p.isBot || room.rematch.includes(p.id));
                if (allVoted && players.length === 2) {
                    for (const p of players) {
                        p.color = p.color === WHITE ? BLACK : WHITE;
                    }
                    room.phase = 'lobby';
                    room.game = null;
                    room.rematch = [];
                    room.options.hostColor = 'random';
                    this.startGame();
                } else {
                    this.broadcastState();
                }
                await this.persist();
                return;
            }

            case 'BACK_TO_LOBBY': {
                if (room.hostId !== member.id) {
                    this.sendError(ws, 'Hanya pembuat room yang bisa mengembalikan ke lobby.');
                    return;
                }
                room.phase = 'lobby';
                room.game = null;
                room.rematch = [];
                for (const p of this.players()) p.color = null;
                await this.persist();
                this.broadcastState();
                return;
            }

            case 'VOICE_JOIN': {
                member.voice = true;
                member.muted = Boolean(message.muted);
                await this.persist();
                this.broadcastVoicePeers();
                this.broadcastState();
                return;
            }

            case 'VOICE_LEAVE': {
                member.voice = false;
                member.muted = false;
                await this.persist();
                this.broadcastVoicePeers();
                this.broadcastState();
                return;
            }

            case 'VOICE_MUTE': {
                member.muted = Boolean(message.muted);
                this.broadcastVoicePeers();
                return;
            }

            case 'VOICE_SIGNAL': {
                const target = this.memberById(message.to);
                if (!target || target.isBot) return;
                const targetWs = this.sockets.get(target.id);
                if (!targetWs) return;
                this.send(targetWs, {
                    type: 'VOICE_SIGNAL',
                    from: member.id,
                    kind: message.kind,
                    payload: message.payload
                });
                return;
            }

            case 'LEAVE_ROOM': {
                this.send(ws, { type: 'LEFT_ROOM', name: member.name });
                if (member.role === 'player' && room.phase === 'playing' && room.game && !room.game.over) {
                    this.finishGame(opposite(member.color), 'abandon', opposite(member.color));
                }
                this.removeMember(member.id);
                await this.persist();
                this.broadcastState();
                return;
            }

            default:
                this.sendError(ws, 'Perintah tidak dikenal.');
        }
    }

    broadcastVoicePeers() {
        const peers = this.room.members
            .filter((m) => m.voice && !m.isBot)
            .map((m) => ({ id: m.id, name: m.name, muted: m.muted, color: m.color }));
        this.broadcast({ type: 'VOICE_PEERS', peers });
    }

    async attach(ws, message) {
        const room = this.room;
        const now = Date.now();
        const playerId = sanitizePlayerId(message.playerId);
        const token = typeof message.token === 'string' ? message.token : null;

        let member = null;
        if (playerId && token && TOKEN_PATTERN.test(token)) {
            const candidate = this.memberById(playerId);
            if (candidate && candidate.token === token) member = candidate;
        }

        if (!member) {
            if (message.type === 'RESUME') {
                this.send(ws, {
                    type: 'RESUME_FAILED',
                    message: 'Sesi lama sudah tidak berlaku. Silakan masuk lagi.'
                });
                return;
            }
            if (!playerId) {
                this.sendError(ws, 'ID pemain tidak valid.');
                return;
            }
            if (this.memberById(playerId)) {
                this.sendError(ws, 'Pemain dengan ID ini sudah ada di room.');
                return;
            }
            const freeSeat = room.members.filter((m) => m.role === 'player').length < MAX_SEATS;
            const asSpectator = message.asSpectator === true || !freeSeat || room.phase !== 'lobby';
            const profile = sanitizeProfile(message.profile);
            member = {
                id: playerId,
                token: randomId(16),
                name: profile.name,
                avatar: profile.avatar,
                avatarUrl: profile.avatarUrl,
                isBot: false,
                role: asSpectator ? 'spectator' : 'player',
                color: null,
                connected: true,
                offlineAt: null,
                voice: false,
                muted: false,
                joinedAt: now
            };
            room.members.push(member);
        }

        const previous = this.sockets.get(member.id);
        if (previous && previous !== ws) {
            this.socketOwner.delete(previous);
            try {
                previous.close(4000, 'sesi digantikan');
            } catch {}
        }

        this.settleClock(now);
        member.connected = true;
        member.offlineAt = null;
        member.abandoned = false;
        this.sockets.set(member.id, ws);
        this.socketOwner.set(ws, member.id);

        this.maybeAutoStart();

        this.send(ws, {
            type: 'READY',
            playerId: member.id,
            token: member.token,
            role: member.role,
            color: member.color,
            roomCode: room.code,
            hostId: room.hostId,
            resumed: message.type === 'RESUME'
        });
        this.send(ws, this.buildState(member.id));
        this.broadcastVoicePeers();
        this.broadcastState();
        await this.persist();
        this.scheduleAlarm();
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/ws') {
            const roomCode = url.searchParams.get('room');
            if (roomCode) {
                const code = roomCode.trim().toUpperCase();
                if (!/^[A-Z0-9]{4,10}$/.test(code)) {
                    return new Response('Kode room tidak valid.', { status: 400 });
                }
                return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
            }
            return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(request);
        }

        if (url.pathname.startsWith('/api/room/')) {
            const code = url.pathname.slice('/api/room/'.length).trim().toUpperCase();
            if (!/^[A-Z0-9]{4,10}$/.test(code)) {
                return Response.json({ exists: false, error: 'Kode room tidak valid.' }, { status: 400 });
            }
            const response = await env.ROOM.get(env.ROOM.idFromName(code))
                .fetch('https://room.internal/internal/info');
            return new Response(response.body, {
                status: response.status,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
            });
        }

        if (url.pathname === '/api/config') {
            return Response.json({
                timeControls: TIME_CONTROLS,
                graceMs: GRACE_MS,
                disconnectPauseMs: DISCONNECT_PAUSE_MS
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        return env.ASSETS.fetch(request);
    }
};
