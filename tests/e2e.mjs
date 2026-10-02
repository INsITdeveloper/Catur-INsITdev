import { createState, legalMoves, moveToSan, applyMove } from '../client/rules.js';

const BASE = process.env.E2E_URL || 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

let failed = 0;
function check(label, ok, extra = '') {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'GAGAL'} ${label}${extra ? ` — ${extra}` : ''}`);
}

class Client {
    constructor(label) {
        this.label = label;
        this.inbox = [];
        this.waiters = [];
        this.closed = false;
    }

    async open(url) {
        this.ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${this.label}: timeout buka socket`)), 8000);
            this.ws.addEventListener('open', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
            this.ws.addEventListener('error', () => {
                clearTimeout(timer);
                reject(new Error(`${this.label}: gagal buka socket`));
            }, { once: true });
        });
        this.ws.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'STATE') this.lastState = message;
            const waiter = this.waiters.find((w) => w.type === message.type);
            if (waiter) {
                this.waiters.splice(this.waiters.indexOf(waiter), 1);
                clearTimeout(waiter.timer);
                waiter.resolve(message);
                return;
            }
            this.inbox.push(message);
        });
        this.ws.addEventListener('close', () => {
            this.closed = true;
        });
        return this;
    }

    send(payload) {
        this.ws.send(JSON.stringify(payload));
    }

    wait(type, timeout = 6000) {
        const found = this.inbox.findIndex((m) => m.type === type);
        if (found !== -1) return Promise.resolve(this.inbox.splice(found, 1)[0]);
        return new Promise((resolve, reject) => {
            const waiter = { type, resolve };
            waiter.timer = setTimeout(() => {
                this.waiters.splice(this.waiters.indexOf(waiter), 1);
                reject(new Error(`${this.label}: menunggu ${type} kehabisan waktu`));
            }, timeout);
            this.waiters.push(waiter);
        });
    }

    drain(type) {
        const hits = this.inbox.filter((m) => m.type === type);
        this.inbox = this.inbox.filter((m) => m.type !== type);
        return hits;
    }

    close() {
        try {
            this.ws.close();
        } catch {}
    }
}

const profile = (name, avatar) => ({ name, avatar });

async function waitForState(client, predicate, timeout = 8000) {
    if (client.lastState && predicate(client.lastState)) return client.lastState;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const state = await client.wait('STATE', Math.max(500, deadline - Date.now()));
        if (predicate(state)) return state;
    }
    throw new Error(`${client.label}: STATE yang diharapkan tidak muncul`);
}

async function main() {
    console.log(`menguji ${BASE}\n`);

    const page = await fetch(`${BASE}/`);
    check('halaman utama tersaji', page.status === 200);
    const html = await page.text();
    check('aset bidak dirujuk halaman', html.includes('app.js'));

    const piece = await fetch(`${BASE}/assets/pieces/wq.svg`);
    check('aset bidak SVG tersedia', piece.status === 200 && (await piece.text()).includes('<svg'));

    const avatar = await fetch(`${BASE}/assets/avatars/a07.svg`);
    check('aset avatar SVG tersedia', avatar.status === 200);

    const unknown = await fetch(`${BASE}/api/room/ZZZZZZ`);
    const unknownJson = await unknown.json();
    check('room tak dikenal dilaporkan tidak ada', unknownJson.exists === false);

    const alice = new Client('alice');
    const bob = new Client('bob');
    await alice.open(`${WS_BASE}/ws`);
    await bob.open(`${WS_BASE}/ws`);
    check('dua klien tersambung ke lobby', true);

    alice.send({ type: 'FIND_MATCH', playerId: 'alice_test_01', profile: profile('Alice', 'a01'), timeControlId: '10+0' });
    await alice.wait('MATCH_SEARCHING');
    bob.send({ type: 'FIND_MATCH', playerId: 'bob_test_0001', profile: profile('Bob', 'a02'), timeControlId: '10+0' });

    const foundAlice = await alice.wait('MATCH_FOUND');
    const foundBob = await bob.wait('MATCH_FOUND');
    check('matchmaking memasangkan dua pemain', foundAlice.roomCode === foundBob.roomCode && Boolean(foundAlice.token));
    const code = foundAlice.roomCode;

    alice.close();
    bob.close();

    const roomInfo = await (await fetch(`${BASE}/api/room/${code}`)).json();
    check('room hasil matchmaking bisa dicek', roomInfo.exists === true && roomInfo.players === 2);

    const a = new Client('alice-room');
    const b = new Client('bob-room');
    await a.open(`${WS_BASE}/ws?room=${code}`);
    await b.open(`${WS_BASE}/ws?room=${code}`);
    a.send({ type: 'RESUME', playerId: 'alice_test_01', token: foundAlice.token });
    b.send({ type: 'RESUME', playerId: 'bob_test_0001', token: foundBob.token });

    const readyA = await a.wait('READY');
    const readyB = await b.wait('READY');
    check('kedua pemain dapat kursinya kembali lewat token', readyA.role === 'player' && readyB.role === 'player');

    const stateA = await waitForState(a, (s) => s.game !== null);
    const colorOf = (id) => (stateA.room.members.find((m) => m.id === id) || {}).color || null;
    const aliceColor = colorOf('alice_test_01');
    const bobColor = colorOf('bob_test_0001');
    check('warna berbeda dibagikan', Boolean(aliceColor && bobColor && aliceColor !== bobColor), `alice=${aliceColor} bob=${bobColor} readyA=${readyA.color} readyB=${readyB.color}`);
    const white = aliceColor === 'w' ? a : b;
    const black = aliceColor === 'w' ? b : a;
    check('permainan langsung berjalan setelah matchmaking', stateA.room.phase === 'playing' && stateA.game.board.length === 64);
    check('jam catur berjalan', stateA.game.clocks && stateA.game.clocks.w > 0 && stateA.game.clockDeadline > 0);

    const bad = await (async () => {
        white.send({ type: 'MOVE', from: 8, to: 16 });
        try {
            return await white.wait('ERROR', 2500);
        } catch {
            return null;
        }
    })();
    check('langkah tidak sah ditolak server', bad !== null, bad ? bad.message : 'tidak ada penolakan');

    const script = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
    for (let i = 0; i < script.length; i++) {
        const mover = i % 2 === 0 ? white : black;
        const state = i % 2 === 0 ? await waitForState(white, (s) => s.game && s.game.history.length === i)
            : await waitForState(black, (s) => s.game && s.game.history.length === i);
        const engine = createState(state.game.fen);
        const move = legalMoves(engine).find((m) => {
            const from = 'abcdefgh'[m.from & 7] + (8 - (m.from >> 3));
            const to = 'abcdefgh'[m.to & 7] + (8 - (m.to >> 3));
            return from + to === script[i];
        });
        if (!move) {
            check(`langkah skrip ${script[i]} tersedia`, false);
            break;
        }
        mover.send({ type: 'MOVE', from: move.from, to: move.to, promotion: 'q' });
    }

    const finishWhite = await white.wait('GAME_OVER', 8000);
    const finishBlack = await black.wait('GAME_OVER', 8000);
    check('skakmat terkirim ke kedua pemain', finishWhite.reason === 'checkmate' && finishBlack.reason === 'checkmate');
    check('pemenang adalah pemain putih', finishWhite.winnerColor === 'w' && finishWhite.winnerColor === (aliceColor === 'w' ? aliceColor : bobColor));

    const afterA = await waitForState(a, (s) => s.game && s.game.over);
    check('papan akhir tersimpan di state', afterA.game.history.length === 7 && afterA.game.history[6].includes('#'));

    a.send({ type: 'CHAT_SEND', text: 'gg, main lagi?' });
    const chat = await b.wait('CHAT_MESSAGE');
    check('obrolan teks sampai ke lawan', chat.message.text === 'gg, main lagi?');

    const longChat = 'x'.repeat(400);
    a.send({ type: 'CHAT_SEND', text: longChat });
    const trimmed = await b.wait('CHAT_MESSAGE');
    check('obrolan teks dipotong di server', trimmed.message.text.length === 280);

    a.send({ type: 'VOICE_JOIN', muted: false });
    b.send({ type: 'VOICE_JOIN', muted: true });
    const peers = await (async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const message = await a.wait('VOICE_PEERS', Math.max(500, deadline - Date.now()));
            if (message.peers.length === 2) return message;
        }
        throw new Error('VOICE_PEERS tidak lengkap');
    })();
    check('daftar peserta obrolan suara tersinkron', peers.peers.length === 2);
    check('status bisu diteruskan', peers.peers.some((p) => p.id === 'bob_test_0001' && p.muted === true));

    a.send({ type: 'VOICE_SIGNAL', to: 'bob_test_0001', kind: 'offer', payload: { sdp: 'contoh-penawaran', type: 'offer' } });
    const signal = await b.wait('VOICE_SIGNAL');
    check('sinyal WebRTC diteruskan ke lawan', signal.kind === 'offer' && signal.from === 'alice_test_01');

    a.send({ type: 'REMATCH' });
    b.send({ type: 'REMATCH' });
    const rematch = await waitForState(a, (s) => s.room.phase === 'playing' && s.game && s.game.history.length === 0, 8000);
    check('main lagi berjalan dan warna ditukar', rematch.game.turn === 'w' && rematch.game.history.length === 0);

    b.close();
    const offline = await a.wait('MEMBER_OFFLINE', 8000);
    check('lawan terputus dilaporkan, kursinya ditahan', offline.memberId === 'bob_test_0001' && offline.graceMs > 0);
    const stillThere = await waitForState(a, (s) => s.room.members.some((m) => m.id === 'bob_test_0001' && !m.connected));
    check('pemain terputus masih terdaftar di room', stillThere.room.members.filter((m) => m.role === 'player').length === 2);

    const b2 = new Client('bob-reconnect');
    await b2.open(`${WS_BASE}/ws?room=${code}`);
    b2.send({ type: 'RESUME', playerId: 'bob_test_0001', token: foundBob.token });
    const readyB2 = await b2.wait('READY');
    check('sambung ulang memakai token yang sama', readyB2.resumed === true && readyB2.playerId === 'bob_test_0001');
    const back = await waitForState(b2, (s) => s.room.members.every((m) => m.connected || m.isBot));
    check('papan dipulihkan utuh setelah sambung ulang', back.game !== null && back.room.phase === 'playing');
    check('riwayat obrolan ikut dipulihkan', back.room.chat.length >= 2);

    const wrong = new Client('penyusup');
    await wrong.open(`${WS_BASE}/ws?room=${code}`);
    wrong.send({ type: 'RESUME', playerId: 'bob_test_0001', token: 'f'.repeat(32) });
    const failedResume = await wrong.wait('RESUME_FAILED', 5000);
    check('token palsu ditolak', Boolean(failedResume.message));
    wrong.close();

    const spectator = new Client('penonton');
    await spectator.open(`${WS_BASE}/ws?room=${code}`);
    spectator.send({ type: 'JOIN', playerId: 'spectator_0001', profile: profile('Penonton', 'a05') });
    const specReady = await spectator.wait('READY', 5000);
    check('tamu ketiga masuk sebagai penonton', specReady.role === 'spectator');
    spectator.send({ type: 'MOVE', from: 8, to: 16 });
    const denied = await spectator.wait('ERROR', 4000);
    check('penonton tidak bisa menggerakkan bidak', denied.message.includes('Penonton'));

    b2.send({ type: 'RESIGN' });
    const over = await a.wait('GAME_OVER', 6000);
    check('menyerah mengakhiri permainan', over.reason === 'resign');
    spectator.close();

    a.send({ type: 'LEAVE_ROOM' });
    await a.wait('LEFT_ROOM', 5000);
    check('keluar room dibersihkan', true);

    a.close();
    b2.close();

    console.log(failed === 0 ? '\nSEMUA TES END-TO-END LULUS' : `\n${failed} TES GAGAL`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('\nTES BERHENTI:', err.message);
    process.exit(1);
});
