export const WHITE = 'w';
export const BLACK = 'b';
export const FILES = 'abcdefgh';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];

const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const DIAGONALS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ORTHOGONALS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL_DIRS = [...DIAGONALS, ...ORTHOGONALS];

export const fileOf = (i) => i & 7;
export const rankOf = (i) => i >> 3;
export const squareName = (i) => FILES[fileOf(i)] + (8 - rankOf(i));

export function squareIndex(name) {
    const f = FILES.indexOf(name[0]);
    const r = 8 - Number(name[1]);
    if (f < 0 || r < 0 || r > 7) return -1;
    return r * 8 + f;
}

export function colorOf(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? WHITE : BLACK;
}

export function typeOf(piece) {
    return piece ? piece.toUpperCase() : null;
}

export function opposite(color) {
    return color === WHITE ? BLACK : WHITE;
}

export function createState(fen = START_FEN) {
    const parts = String(fen).trim().split(/\s+/);
    const board = new Array(64).fill(null);
    let i = 0;
    for (const ch of parts[0]) {
        if (ch === '/') continue;
        if (ch >= '1' && ch <= '8') {
            i += Number(ch);
            continue;
        }
        if (i < 64) board[i++] = ch;
    }
    const rights = parts[2] || '-';
    const state = {
        board,
        turn: parts[1] === 'b' ? BLACK : WHITE,
        castling: {
            wK: rights.includes('K'),
            wQ: rights.includes('Q'),
            bK: rights.includes('k'),
            bQ: rights.includes('q')
        },
        ep: parts[3] && parts[3] !== '-' ? squareIndex(parts[3]) : null,
        halfmove: Number(parts[4] || 0) || 0,
        fullmove: Number(parts[5] || 1) || 1,
        keys: [],
        history: []
    };
    state.keys.push(positionKey(state));
    return state;
}

export function positionKey(state) {
    let out = '';
    for (let i = 0; i < 64; i++) out += state.board[i] || '.';
    out += ' ' + state.turn;
    out += ' ' + (state.castling.wK ? 'K' : '') + (state.castling.wQ ? 'Q' : '')
        + (state.castling.bK ? 'k' : '') + (state.castling.bQ ? 'q' : '');
    out += ' ' + (state.ep === null ? '-' : squareName(state.ep));
    return out;
}

export function stateToFen(state) {
    let rows = [];
    for (let r = 0; r < 8; r++) {
        let row = '';
        let empty = 0;
        for (let f = 0; f < 8; f++) {
            const piece = state.board[r * 8 + f];
            if (piece) {
                if (empty) {
                    row += empty;
                    empty = 0;
                }
                row += piece;
            } else {
                empty++;
            }
        }
        if (empty) row += empty;
        rows.push(row);
    }
    const rights = (state.castling.wK ? 'K' : '') + (state.castling.wQ ? 'Q' : '')
        + (state.castling.bK ? 'k' : '') + (state.castling.bQ ? 'q' : '');
    return [
        rows.join('/'),
        state.turn,
        rights || '-',
        state.ep === null ? '-' : squareName(state.ep),
        state.halfmove,
        state.fullmove
    ].join(' ');
}

export function cloneState(state) {
    return {
        board: state.board.slice(),
        turn: state.turn,
        castling: { ...state.castling },
        ep: state.ep,
        halfmove: state.halfmove,
        fullmove: state.fullmove,
        keys: state.keys.slice(),
        history: state.history.slice()
    };
}

function addPawnMove(moves, from, to, captured, color, promotionRank, flag) {
    const piece = color === WHITE ? 'P' : 'p';
    if (rankOf(to) === promotionRank) {
        for (const p of PROMOTION_PIECES) {
            moves.push({ from, to, piece, captured, promotion: color === WHITE ? p.toUpperCase() : p, flag: 'promo' });
        }
        return;
    }
    moves.push({ from, to, piece, captured, promotion: null, flag });
}

function pushPawnMoves(state, from, moves) {
    const piece = state.board[from];
    const color = colorOf(piece);
    const dir = color === WHITE ? -1 : 1;
    const startRank = color === WHITE ? 6 : 1;
    const promotionRank = color === WHITE ? 0 : 7;
    const r = rankOf(from);
    const f = fileOf(from);

    const nr = r + dir;
    if (nr >= 0 && nr <= 7) {
        const one = nr * 8 + f;
        if (!state.board[one]) {
            addPawnMove(moves, from, one, null, color, promotionRank, 'normal');
            if (r === startRank) {
                const two = (r + dir * 2) * 8 + f;
                if (!state.board[two]) {
                    moves.push({ from, to: two, piece, captured: null, promotion: null, flag: 'double' });
                }
            }
        }
        for (const df of [-1, 1]) {
            const nf = f + df;
            if (nf < 0 || nf > 7) continue;
            const to = nr * 8 + nf;
            const target = state.board[to];
            if (target && colorOf(target) !== color) {
                addPawnMove(moves, from, to, target, color, promotionRank, 'normal');
            } else if (!target && state.ep === to) {
                moves.push({
                    from,
                    to,
                    piece,
                    captured: color === WHITE ? 'p' : 'P',
                    promotion: null,
                    flag: 'ep'
                });
            }
        }
    }
}

function pushSlidingMoves(state, from, dirs, moves) {
    const piece = state.board[from];
    const color = colorOf(piece);
    const r0 = rankOf(from);
    const f0 = fileOf(from);
    for (const [df, dr] of dirs) {
        let f = f0 + df;
        let r = r0 + dr;
        while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
            const to = r * 8 + f;
            const target = state.board[to];
            if (!target) {
                moves.push({ from, to, piece, captured: null, promotion: null, flag: 'normal' });
            } else {
                if (colorOf(target) !== color) {
                    moves.push({ from, to, piece, captured: target, promotion: null, flag: 'normal' });
                }
                break;
            }
            f += df;
            r += dr;
        }
    }
}

function pushStepMoves(state, from, deltas, moves) {
    const piece = state.board[from];
    const color = colorOf(piece);
    const r0 = rankOf(from);
    const f0 = fileOf(from);
    for (const [df, dr] of deltas) {
        const f = f0 + df;
        const r = r0 + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const to = r * 8 + f;
        const target = state.board[to];
        if (!target) {
            moves.push({ from, to, piece, captured: null, promotion: null, flag: 'normal' });
        } else if (colorOf(target) !== color) {
            moves.push({ from, to, piece, captured: target, promotion: null, flag: 'normal' });
        }
    }
}

function pushCastleMoves(state, from, moves) {
    const piece = state.board[from];
    const color = colorOf(piece);
    const homeRank = color === WHITE ? 7 : 0;
    if (rankOf(from) !== homeRank || fileOf(from) !== 4) return;
    const foe = opposite(color);
    const base = homeRank * 8;
    const rook = color === WHITE ? 'R' : 'r';
    const kingSide = color === WHITE ? state.castling.wK : state.castling.bK;
    const queenSide = color === WHITE ? state.castling.wQ : state.castling.bQ;

    if (kingSide && state.board[base + 7] === rook && !state.board[base + 5] && !state.board[base + 6]) {
        if (!isSquareAttacked(state, base + 4, foe)
            && !isSquareAttacked(state, base + 5, foe)
            && !isSquareAttacked(state, base + 6, foe)) {
            moves.push({ from, to: base + 6, piece, captured: null, promotion: null, flag: 'castleK' });
        }
    }
    if (queenSide && state.board[base] === rook && !state.board[base + 1]
        && !state.board[base + 2] && !state.board[base + 3]) {
        if (!isSquareAttacked(state, base + 4, foe)
            && !isSquareAttacked(state, base + 3, foe)
            && !isSquareAttacked(state, base + 2, foe)) {
            moves.push({ from, to: base + 2, piece, captured: null, promotion: null, flag: 'castleQ' });
        }
    }
}

export function pseudoMoves(state, from = null) {
    const moves = [];
    const list = from === null ? [...Array(64).keys()] : [from];
    for (const sq of list) {
        const piece = state.board[sq];
        if (!piece || colorOf(piece) !== state.turn) continue;
        switch (typeOf(piece)) {
            case 'P': pushPawnMoves(state, sq, moves); break;
            case 'N': pushStepMoves(state, sq, KNIGHT_DELTAS, moves); break;
            case 'B': pushSlidingMoves(state, sq, DIAGONALS, moves); break;
            case 'R': pushSlidingMoves(state, sq, ORTHOGONALS, moves); break;
            case 'Q': pushSlidingMoves(state, sq, ALL_DIRS, moves); break;
            case 'K':
                pushStepMoves(state, sq, ALL_DIRS, moves);
                pushCastleMoves(state, sq, moves);
                break;
            default: break;
        }
    }
    return moves;
}

export function isSquareAttacked(state, sq, byColor) {
    const board = state.board;
    const r = rankOf(sq);
    const f = fileOf(sq);

    const pawnRank = r + (byColor === WHITE ? 1 : -1);
    if (pawnRank >= 0 && pawnRank <= 7) {
        const pawn = byColor === WHITE ? 'P' : 'p';
        for (const df of [-1, 1]) {
            const pf = f + df;
            if (pf < 0 || pf > 7) continue;
            if (board[pawnRank * 8 + pf] === pawn) return true;
        }
    }

    const knight = byColor === WHITE ? 'N' : 'n';
    for (const [df, dr] of KNIGHT_DELTAS) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        if (board[nr * 8 + nf] === knight) return true;
    }

    const king = byColor === WHITE ? 'K' : 'k';
    for (const [df, dr] of ALL_DIRS) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        if (board[nr * 8 + nf] === king) return true;
    }

    const queen = byColor === WHITE ? 'Q' : 'q';
    const rook = byColor === WHITE ? 'R' : 'r';
    const bishop = byColor === WHITE ? 'B' : 'b';

    for (const [df, dr] of ORTHOGONALS) {
        let nf = f + df;
        let nr = r + dr;
        while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
            const target = board[nr * 8 + nf];
            if (target) {
                if (target === rook || target === queen) return true;
                break;
            }
            nf += df;
            nr += dr;
        }
    }
    for (const [df, dr] of DIAGONALS) {
        let nf = f + df;
        let nr = r + dr;
        while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
            const target = board[nr * 8 + nf];
            if (target) {
                if (target === bishop || target === queen) return true;
                break;
            }
            nf += df;
            nr += dr;
        }
    }
    return false;
}

export function kingSquare(state, color) {
    const king = color === WHITE ? 'K' : 'k';
    for (let i = 0; i < 64; i++) {
        if (state.board[i] === king) return i;
    }
    return -1;
}

export function isInCheck(state, color) {
    const sq = kingSquare(state, color);
    if (sq === -1) return false;
    return isSquareAttacked(state, sq, opposite(color));
}

export function applyMove(state, move, san = null) {
    const board = state.board;
    const piece = board[move.from];
    const color = colorOf(piece);
    const undo = {
        move,
        piece,
        captured: board[move.to],
        castling: { ...state.castling },
        ep: state.ep,
        halfmove: state.halfmove,
        fullmove: state.fullmove,
        rookFrom: -1,
        rookTo: -1,
        epSquare: -1,
        epPiece: null,
        san
    };

    board[move.from] = null;

    if (move.flag === 'ep') {
        const capSq = move.to + (color === WHITE ? 8 : -8);
        undo.epSquare = capSq;
        undo.epPiece = board[capSq];
        board[capSq] = null;
    }

    board[move.to] = move.promotion || piece;

    if (move.flag === 'castleK') {
        undo.rookFrom = move.to + 1;
        undo.rookTo = move.to - 1;
    } else if (move.flag === 'castleQ') {
        undo.rookFrom = move.to - 2;
        undo.rookTo = move.to + 1;
    }
    if (undo.rookFrom !== -1) {
        board[undo.rookTo] = board[undo.rookFrom];
        board[undo.rookFrom] = null;
    }

    const type = typeOf(piece);
    if (type === 'K') {
        state.castling[color + 'K'] = false;
        state.castling[color + 'Q'] = false;
    } else if (type === 'R') {
        const home = color === WHITE ? 63 : 7;
        const away = color === WHITE ? 56 : 0;
        if (move.from === home) state.castling[color + 'K'] = false;
        if (move.from === away) state.castling[color + 'Q'] = false;
    }

    if (undo.captured && typeOf(undo.captured) === 'R') {
        const foe = colorOf(undo.captured);
        const home = foe === WHITE ? 63 : 7;
        const away = foe === WHITE ? 56 : 0;
        if (move.to === home) state.castling[foe + 'K'] = false;
        if (move.to === away) state.castling[foe + 'Q'] = false;
    }

    state.ep = move.flag === 'double' ? (move.from + move.to) / 2 : null;

    if (type === 'P' || undo.captured || move.flag === 'ep') state.halfmove = 0;
    else state.halfmove += 1;

    if (color === BLACK) state.fullmove += 1;
    state.turn = opposite(color);
    state.keys.push(positionKey(state));

    if (san !== null) {
        state.history.push({
            san,
            from: move.from,
            to: move.to,
            piece,
            captured: undo.captured,
            promotion: move.promotion
        });
    }
    return undo;
}

export function undoMove(state, undo) {
    const board = state.board;
    const move = undo.move;
    const color = colorOf(undo.piece);

    board[move.from] = undo.piece;
    board[move.to] = undo.captured;
    if (undo.epSquare !== -1) board[undo.epSquare] = undo.epPiece;
    if (undo.rookFrom !== -1) {
        board[undo.rookFrom] = board[undo.rookTo];
        board[undo.rookTo] = null;
    }

    state.castling = undo.castling;
    state.ep = undo.ep;
    state.halfmove = undo.halfmove;
    state.fullmove = undo.fullmove;
    state.turn = color;
    state.keys.pop();
    if (undo.san !== null) state.history.pop();
}

export function legalMoves(state, from = null) {
    const color = state.turn;
    const result = [];
    for (const move of pseudoMoves(state, from)) {
        const undo = applyMove(state, move);
        if (!isInCheck(state, color)) result.push(move);
        undoMove(state, undo);
    }
    return result;
}

export function findMove(state, from, to, promotion = null) {
    const candidates = legalMoves(state, from).filter((m) => m.to === to);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    if (!promotion) return candidates.find((m) => m.promotion && typeOf(m.promotion) === 'Q') || candidates[0];
    const wanted = String(promotion).toUpperCase();
    return candidates.find((m) => m.promotion && typeOf(m.promotion) === wanted) || null;
}

export function moveToSan(state, move) {
    let san;
    if (move.flag === 'castleK') {
        san = 'O-O';
    } else if (move.flag === 'castleQ') {
        san = 'O-O-O';
    } else {
        const type = typeOf(move.piece);
        if (type === 'P') {
            san = move.captured || move.flag === 'ep' ? FILES[fileOf(move.from)] + 'x' : '';
            san += squareName(move.to);
            if (move.promotion) san += '=' + typeOf(move.promotion);
        } else {
            san = type;
            const rivals = legalMoves(state).filter((m) => m.to === move.to && m.from !== move.from && typeOf(m.piece) === type);
            if (rivals.length) {
                const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
                const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
                if (!sameFile) san += FILES[fileOf(move.from)];
                else if (!sameRank) san += String(8 - rankOf(move.from));
                else san += squareName(move.from);
            }
            if (move.captured) san += 'x';
            san += squareName(move.to);
        }
    }
    const undo = applyMove(state, move);
    const check = isInCheck(state, state.turn);
    const replies = legalMoves(state).length;
    undoMove(state, undo);
    if (check) san += replies === 0 ? '#' : '+';
    return san;
}

export function insufficientMaterial(state) {
    const counts = {};
    let total = 0;
    const bishopSquares = [];
    for (let i = 0; i < 64; i++) {
        const piece = state.board[i];
        if (!piece) continue;
        const type = typeOf(piece);
        counts[type] = (counts[type] || 0) + 1;
        total++;
        if (type === 'B') bishopSquares.push(((fileOf(i) + rankOf(i)) % 2 === 0) ? 'light' : 'dark');
    }
    if (total === 2) return true;
    if (counts.P || counts.R || counts.Q) return false;
    if (counts.N === 1 && total === 3) return true;
    if (counts.B === 1 && total === 3) return true;
    if (counts.B === 2 && total === 4 && bishopSquares[0] === bishopSquares[1]) return true;
    if (counts.N === 2 && total === 4) {
        let whiteKnights = 0;
        let blackKnights = 0;
        for (let i = 0; i < 64; i++) {
            if (state.board[i] === 'N') whiteKnights++;
            if (state.board[i] === 'n') blackKnights++;
        }
        if (whiteKnights === 2 || blackKnights === 2) return false;
    }
    return false;
}

export function repetitionCount(state) {
    const key = positionKey(state);
    let count = 0;
    for (const k of state.keys) if (k === key) count++;
    return count;
}

export function gameStatus(state) {
    const moves = legalMoves(state);
    const check = isInCheck(state, state.turn);
    if (!moves.length) {
        if (check) {
            return {
                over: true,
                result: opposite(state.turn),
                reason: 'checkmate',
                check: true,
                legalCount: 0
            };
        }
        return { over: true, result: 'draw', reason: 'stalemate', check: false, legalCount: 0 };
    }
    if (state.halfmove >= 100) {
        return { over: true, result: 'draw', reason: 'fifty', check, legalCount: moves.length };
    }
    if (insufficientMaterial(state)) {
        return { over: true, result: 'draw', reason: 'material', check, legalCount: moves.length };
    }
    if (repetitionCount(state) >= 3) {
        return { over: true, result: 'draw', reason: 'repetition', check, legalCount: moves.length };
    }
    return { over: false, result: null, reason: null, check, legalCount: moves.length };
}

export function moveSummary(state) {
    const last = state.history[state.history.length - 1] || null;
    return last;
}

export function capturedBy(state, color) {
    const out = [];
    for (const entry of state.history) {
        if (!entry.captured) continue;
        if (colorOf(entry.piece) === color) out.push(entry.captured);
    }
    return out;
}
