const FILES = 'abcdefgh';

export class BoardView {
    constructor(root, handlers) {
        this.root = root;
        this.handlers = handlers;
        this.squares = [];
        this.slots = new Array(64).fill(null);
        this.lastBoard = new Array(64).fill(null);
        this.orientation = 'w';
        this.interactive = false;
        this.drag = null;
        this.pendingClick = null;
        this.buildSquares();
        this.bindPointer();
    }

    buildSquares() {
        this.root.innerHTML = '';
        for (let i = 0; i < 64; i++) {
            const sq = document.createElement('div');
            sq.className = 'sq';
            sq.dataset.index = String(i);
            this.root.appendChild(sq);
            this.squares.push(sq);
        }
    }

    squareFromPoint(clientX, clientY) {
        const rect = this.root.getBoundingClientRect();
        const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
        const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
        if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
        return this.indexFromCell(col, row);
    }

    cellFromIndex(index) {
        const file = index & 7;
        const rank = index >> 3;
        return this.orientation === 'w' ? { col: file, row: rank } : { col: 7 - file, row: 7 - rank };
    }

    indexFromCell(col, row) {
        const file = this.orientation === 'w' ? col : 7 - col;
        const rank = this.orientation === 'w' ? row : 7 - row;
        return rank * 8 + file;
    }

    placePiece(el, index) {
        const { col, row } = this.cellFromIndex(index);
        el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
    }

    makePiece(piece, index, animate) {
        const el = document.createElement('div');
        el.className = 'piece' + (animate ? ' gone' : '');
        const color = piece === piece.toUpperCase() ? 'w' : 'b';
        const img = document.createElement('img');
        img.src = `assets/pieces/${color}${piece.toLowerCase()}.svg`;
        img.alt = piece;
        img.draggable = false;
        el.appendChild(img);
        this.placePiece(el, index);
        this.root.appendChild(el);
        if (animate) requestAnimationFrame(() => el.classList.remove('gone'));
        return { char: piece, el };
    }

    syncPieces(board, lastMove) {
        const old = this.slots;
        const next = new Array(64).fill(null);
        const free = [];
        const need = [];

        for (let i = 0; i < 64; i++) {
            if (old[i] && board[i] && old[i].char === board[i]) next[i] = old[i];
            else if (old[i]) free.push({ index: i, ref: old[i] });
            if (board[i] && !next[i]) need.push(i);
        }

        const take = (predicate) => {
            const at = free.findIndex(predicate);
            if (at === -1) return null;
            return free.splice(at, 1)[0];
        };

        for (const target of need) {
            let picked = null;
            if (lastMove && lastMove.to === target) {
                picked = take((f) => f.index === lastMove.from);
            }
            if (!picked) picked = take((f) => f.ref.char === board[target]);
            if (picked) {
                if (picked.ref.char !== board[target]) {
                    const color = board[target] === board[target].toUpperCase() ? 'w' : 'b';
                    picked.ref.el.firstChild.src = `assets/pieces/${color}${board[target].toLowerCase()}.svg`;
                    picked.ref.char = board[target];
                }
                picked.ref.el.classList.remove('drag');
                this.placePiece(picked.ref.el, target);
                next[target] = picked.ref;
            } else {
                next[target] = this.makePiece(board[target], target, true);
            }
        }

        for (const leftover of free) {
            leftover.ref.el.remove();
        }

        this.slots = next;
    }

    render(view) {
        const board = view.board;
        this.orientation = view.orientation === 'b' ? 'b' : 'w';
        this.interactive = Boolean(view.interactive);

        for (let i = 0; i < 64; i++) {
            const sq = this.squares[i];
            const { col, row } = this.cellFromIndex(i);
            sq.style.gridColumn = String(col + 1);
            sq.style.gridRow = String(row + 1);
            sq.className = 'sq ' + ((col + row) % 2 === 0 ? 'light' : 'dark');
            sq.innerHTML = '';
            if (row === 7) {
                const label = document.createElement('span');
                label.className = 'coord file';
                label.textContent = FILES[i & 7];
                sq.appendChild(label);
            }
            if (col === 0) {
                const label = document.createElement('span');
                label.className = 'coord rank';
                label.textContent = String(8 - (i >> 3));
                sq.appendChild(label);
            }
            if (view.lastMove && (view.lastMove.from === i || view.lastMove.to === i)) {
                sq.classList.add('last');
            }
            if (view.checkSquare === i) sq.classList.add('check');
            if (view.selected === i) sq.classList.add('sel');
            if (view.hints && view.hints.has(i)) {
                sq.classList.add('hint');
                if (board[i]) sq.classList.add('capture');
            }
        }

        this.syncPieces(board, view.lastMove);
        this.root.classList.toggle('locked', !this.interactive);
    }

    bindPointer() {
        const down = (event) => {
            if (!this.interactive) return;
            const index = this.squareFromPoint(event.clientX, event.clientY);
            if (index < 0) return;
            const slot = this.slots[index];
            if (slot) {
                this.drag = { index, el: slot.el, moved: false, startX: event.clientX, startY: event.clientY };
                slot.el.classList.add('drag');
            }
            this.pendingClick = { index, at: Date.now() };
            event.preventDefault();
        };

        const move = (event) => {
            if (!this.drag) return;
            const rect = this.root.getBoundingClientRect();
            const size = rect.width / 8;
            const dx = event.clientX - this.drag.startX;
            const dy = event.clientY - this.drag.startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.drag.moved = true;
            const { col, row } = this.cellFromIndex(this.drag.index);
            this.drag.el.style.transform =
                `translate(${col * 100}%, ${row * 100}%) translate(${dx}px, ${dy}px)`;
            this.drag.size = size;
        };

        const up = (event) => {
            if (!this.drag) {
                const pending = this.pendingClick;
                this.pendingClick = null;
                if (pending) {
                    const index = this.squareFromPoint(event.clientX, event.clientY);
                    this.handlers.onSelect(index >= 0 ? index : pending.index);
                }
                return;
            }
            const dragged = this.drag;
            this.drag = null;
            dragged.el.classList.remove('drag');
            const target = this.squareFromPoint(event.clientX, event.clientY);
            if (dragged.moved && target >= 0 && target !== dragged.index) {
                this.placePiece(dragged.el, dragged.index);
                this.pendingClick = null;
                this.handlers.onMove(dragged.index, target);
                return;
            }
            this.placePiece(dragged.el, dragged.index);
            this.handlers.onSelect(dragged.index);
        };

        const cancel = () => {
            if (!this.drag) return;
            this.placePiece(this.drag.el, this.drag.index);
            this.drag.el.classList.remove('drag');
            this.drag = null;
        };

        this.root.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
    }
}

export function pieceImage(color, piece) {
    return `assets/pieces/${color}${piece.toLowerCase()}.svg`;
}

export function avatarSrc(member) {
    if (member && member.avatarUrl) return member.avatarUrl;
    const name = member && member.avatar ? member.avatar : 'fallback';
    return `assets/avatars/${name}.svg`;
}
