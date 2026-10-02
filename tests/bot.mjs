import { createState, legalMoves, applyMove, moveToSan, gameStatus, stateToFen } from '../client/rules.js';
import { chooseBotMove, evaluate, botIdentity } from '../server/bot.js';

let failed = 0;
const check = (label, ok) => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'GAGAL'} ${label}`);
};

const identities = new Set();
for (let i = 0; i < 40; i++) identities.add(botIdentity([...identities]).name);
check(`identitas bot unik (${identities.size} nama)`, identities.size >= 8);

const tactical = createState('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
const mateInOne = chooseBotMove(tactical, 900);
const mateSan = mateInOne ? moveToSan(tactical, mateInOne) : null;
check(`bot menemukan skakmat 1 langkah (${mateSan})`, mateSan === 'Qxf7#');

const freeQueen = createState('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
const capture = chooseBotMove(freeQueen, 900);
check('bot merebut ratu yang menggantung', Boolean(capture && capture.captured && capture.captured.toUpperCase() === 'Q'));

let totalMoves = 0;
let games = 0;
let mates = 0;
let draws = 0;
let slowest = 0;

for (let game = 0; game < 12; game++) {
    const state = createState();
    let plies = 0;
    while (plies < 260) {
        const status = gameStatus(state);
        if (status.over) {
            if (status.result === 'draw') draws++;
            else mates++;
            break;
        }
        const started = Date.now();
        const move = chooseBotMove(state, 700);
        const spent = Date.now() - started;
        slowest = Math.max(slowest, spent);
        if (!move) {
            check('bot selalu punya langkah saat posisi belum selesai', false);
            break;
        }
        const legal = legalMoves(state).some((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
        if (!legal) {
            check(`langkah bot sah (${stateToFen(state)})`, false);
            break;
        }
        applyMove(state, move, moveToSan(state, move));
        plies++;
        totalMoves++;
    }
    if (plies >= 260) {
        check('permainan selesai sebelum 260 ply', false);
    }
    games++;
}

check(`menyelesaikan ${games} permainan penuh (${totalMoves} langkah)`, games === 12);
check(`bot tidak pernah melewati jatah waktu (terlama ${slowest} ms)`, slowest < 4000);
check(`ada permainan yang berakhir skakmat (${mates} skakmat, ${draws} seri)`, mates + draws === 12);

const start = evaluate(createState());
check(`evaluasi posisi awal seimbang (${start})`, Math.abs(start) < 30);

console.log(failed === 0 ? '\nSEMUA TES BOT LULUS' : `\n${failed} TES GAGAL`);
process.exit(failed === 0 ? 0 : 1);
