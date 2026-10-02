import {
    WHITE,
    BLACK,
    colorOf,
    typeOf,
    opposite,
    legalMoves,
    applyMove,
    undoMove,
    isInCheck,
    gameStatus,
    positionKey
} from '../client/rules.js';

const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const MATE = 100000;

const PST = {
    P: [
        0, 0, 0, 0, 0, 0, 0, 0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5, 5, 10, 25, 25, 10, 5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, -5, -10, 0, 0, -10, -5, 5,
        5, 10, 10, -20, -20, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0
    ],
    N: [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50
    ],
    B: [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20
    ],
    R: [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, 10, 10, 10, 10, 5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        0, 0, 0, 5, 5, 0, 0, 0
    ],
    Q: [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20
    ],
    K: [
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        20, 20, 0, 0, 0, 0, 20, 20,
        20, 30, 10, 0, 0, 10, 30, 20
    ],
    KE: [
        -50, -40, -30, -20, -20, -30, -40, -50,
        -30, -20, -10, 0, 0, -10, -20, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -30, 0, 0, 0, 0, -30, -30,
        -50, -30, -30, -30, -30, -30, -30, -50
    ]
};

function tableFor(type, endgame) {
    if (type === 'K') return endgame ? PST.KE : PST.K;
    return PST[type];
}

function totalMaterial(state) {
    let sum = 0;
    for (let i = 0; i < 64; i++) {
        const piece = state.board[i];
        if (!piece) continue;
        const type = typeOf(piece);
        if (type !== 'K') sum += VALUE[type];
    }
    return sum;
}

export function evaluate(state) {
    const endgame = totalMaterial(state) < 1800;
    let score = 0;
    let bishops = { w: 0, b: 0 };
    for (let i = 0; i < 64; i++) {
        const piece = state.board[i];
        if (!piece) continue;
        const color = colorOf(piece);
        const type = typeOf(piece);
        const table = tableFor(type, endgame);
        const idx = color === WHITE ? i : 63 - i;
        const value = VALUE[type] + table[idx];
        score += color === WHITE ? value : -value;
        if (type === 'B') bishops[color]++;
    }
    if (bishops.w >= 2) score += 30;
    if (bishops.b >= 2) score -= 30;
    return score;
}

function moveScore(state, move) {
    let score = 0;
    if (move.captured) {
        score += 10000 + VALUE[typeOf(move.captured)] * 10 - VALUE[typeOf(move.piece)];
    }
    if (move.promotion) score += 9000 + VALUE[typeOf(move.promotion)];
    if (move.flag === 'castleK' || move.flag === 'castleQ') score += 200;
    if (move.flag === 'ep') score += 500;
    return score;
}

function orderedMoves(state, moves) {
    return moves
        .map((move) => ({ move, score: moveScore(state, move) }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.move);
}

function quiesce(state, alpha, beta, deadline) {
    const stand = evaluate(state) * (state.turn === WHITE ? 1 : -1);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (Date.now() > deadline) return alpha;

    const captures = orderedMoves(state, legalMoves(state).filter((m) => m.captured || m.promotion));
    for (const move of captures) {
        const undo = applyMove(state, move);
        const score = -quiesce(state, -beta, -alpha, deadline);
        undoMove(state, undo);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    return alpha;
}

function search(state, depth, alpha, beta, deadline, nodes) {
    nodes.count++;
    if (nodes.count % 2048 === 0 && Date.now() > deadline) {
        nodes.aborted = true;
        return 0;
    }

    if (depth === 0) return quiesce(state, alpha, beta, deadline);

    const moves = legalMoves(state);
    if (!moves.length) {
        return isInCheck(state, state.turn) ? -MATE + (nodes.count % 1000) : 0;
    }

    let best = -Infinity;
    for (const move of orderedMoves(state, moves)) {
        const undo = applyMove(state, move);
        const score = -search(state, depth - 1, -beta, -alpha, deadline, nodes);
        undoMove(state, undo);
        if (nodes.aborted) return 0;
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    return best;
}

export function chooseBotMove(state, budgetMs = 900) {
    const deadline = Date.now() + budgetMs;
    const rootMoves = orderedMoves(state, legalMoves(state));
    if (!rootMoves.length) return null;
    if (rootMoves.length === 1) return rootMoves[0];

    let bestMove = rootMoves[0];
    let bestScore = -Infinity;

    for (let depth = 1; depth <= 4; depth++) {
        const nodes = { count: 0, aborted: false };
        let alpha = -Infinity;
        let localBest = null;
        let localScore = -Infinity;

        for (const move of rootMoves) {
            const undo = applyMove(state, move);
            const score = -search(state, depth - 1, -Infinity, -alpha, deadline, nodes);
            undoMove(state, undo);
            if (nodes.aborted) break;
            if (score > localScore) {
                localScore = score;
                localBest = move;
            }
            if (score > alpha) alpha = score;
        }

        if (localBest && !nodes.aborted) {
            bestMove = localBest;
            bestScore = localScore;
            if (Math.abs(bestScore) > MATE - 2000) break;
        }
        if (nodes.aborted || Date.now() > deadline) break;
    }

    return bestMove;
}

export function botIdentity(taken = []) {
    const names = [
        'Kasparov Mini', 'Tal Bot', 'Capablanca Jr', 'Petrosian Bot', 'Fischer Mini',
        'Morphy Bot', 'Anand Bot', 'Carlsen Jr', 'Karpov Mini', 'Lasker Bot',
        'Alekhine Bot', 'Rubinstein Bot', 'Nimzowitsch Bot', 'Spassky Mini'
    ];
    const used = new Set(taken.map((n) => String(n).toLowerCase()));
    const pool = names.filter((n) => !used.has(n.toLowerCase()));
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'Bot ' + Math.floor(Math.random() * 900 + 100);
    const avatars = ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12', 'a13', 'a14'];
    return { name: pick, avatar: avatars[Math.floor(Math.random() * avatars.length)] };
}

export function randomColor() {
    return Math.random() < 0.5 ? WHITE : BLACK;
}

export function describeResult(status, state) {
    if (!status.over) return null;
    switch (status.reason) {
        case 'checkmate':
            return { kind: 'checkmate', winner: status.result, loser: opposite(status.result) };
        case 'stalemate':
            return { kind: 'stalemate', winner: null };
        case 'fifty':
            return { kind: 'fifty', winner: null };
        case 'material':
            return { kind: 'material', winner: null };
        case 'repetition':
            return { kind: 'repetition', winner: null };
        default:
            return { kind: status.reason, winner: null };
    }
}

export function evaluateStatus(state) {
    return gameStatus(state);
}

export function repetitionKey(state) {
    return positionKey(state);
}
