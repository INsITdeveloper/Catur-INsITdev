import { createState, legalMoves, applyMove, undoMove, stateToFen, moveToSan, gameStatus } from '../client/rules.js';

function perft(state, depth) {
    if (depth === 0) return 1;
    const moves = legalMoves(state);
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const move of moves) {
        const undo = applyMove(state, move);
        nodes += perft(state, depth - 1);
        undoMove(state, undo);
    }
    return nodes;
}

const CASES = [
    ['posisi awal', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['en passant & pin', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['promosi', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['rokade & skak', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['posisi tengah', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]]
];

let failed = 0;
for (const [label, fen, expected] of CASES) {
    expected.forEach((want, index) => {
        const state = createState(fen);
        const got = perft(state, index + 1);
        const intact = stateToFen(state) === fen;
        const pass = got === want && intact;
        if (!pass) failed++;
        console.log(`${pass ? 'ok  ' : 'GAGAL'} ${label} d${index + 1}: ${got} (harap ${want})${intact ? '' : ' [state rusak]'}`);
    });
}

const square = (name) => 'abcdefgh'.indexOf(name[0]) + (8 - Number(name[1])) * 8;
const schlar = createState('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
const moves = legalMoves(schlar);
const mate = moves.find((m) => m.from === square('f3') && m.to === square('f7'));
const san = mate ? moveToSan(schlar, mate) : null;
const okMate = san === 'Qxf7#';
if (!okMate) failed++;
console.log(`${okMate ? 'ok  ' : 'GAGAL'} skakmat terdeteksi: ${san}`);

const stalemate = createState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
const status = gameStatus(stalemate);
const okStale = status.over && status.result === 'draw' && status.reason === 'stalemate';
if (!okStale) failed++;
console.log(`${okStale ? 'ok  ' : 'GAGAL'} stalemate terdeteksi: ${status.reason}`);

const repetition = createState('4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
const cycle = [
    ['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8'],
    ['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8']
];
const fromName = (n) => 'abcdefgh'.indexOf(n[0]) + (8 - Number(n[1])) * 8;
for (const [from, to] of cycle) {
    const list = legalMoves(repetition, fromName(from));
    const pick = list.find((m) => m.to === fromName(to));
    if (!pick) break;
    applyMove(repetition, pick, moveToSan(repetition, pick));
}
const repStatus = gameStatus(repetition);
const okRep = repStatus.over && repStatus.reason === 'repetition';
if (!okRep) failed++;
console.log(`${okRep ? 'ok  ' : 'GAGAL'} pengulangan tiga kali: ${repStatus.reason}`);

const fifty = createState('4k3/8/8/8/8/8/4R3/4K3 w - - 99 60');
const rookMoves = legalMoves(fifty, fromName('e2'));
const quiet = rookMoves.find((m) => !m.captured);
if (quiet) applyMove(fifty, quiet, moveToSan(fifty, quiet));
const fiftyStatus = gameStatus(fifty);
const okFifty = fiftyStatus.over && fiftyStatus.reason === 'fifty';
if (!okFifty) failed++;
console.log(`${okFifty ? 'ok  ' : 'GAGAL'} aturan 50 langkah: ${fiftyStatus.reason}`);

const lone = gameStatus(createState('7k/8/8/8/8/8/5B2/6K1 w - - 0 1'));
const okLone = lone.over && lone.reason === 'material';
if (!okLone) failed++;
console.log(`${okLone ? 'ok  ' : 'GAGAL'} materi tidak cukup: ${lone.reason}`);

console.log(failed === 0 ? '\nSEMUA TES ATURAN LULUS' : `\n${failed} TES GAGAL`);
process.exit(failed === 0 ? 0 : 1);
