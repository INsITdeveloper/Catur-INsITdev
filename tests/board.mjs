class FakeClassList {
    constructor() {
        this.set = new Set();
    }
    add(...names) {
        for (const name of names) this.set.add(name);
    }
    remove(...names) {
        for (const name of names) this.set.delete(name);
    }
    contains(name) {
        return this.set.has(name);
    }
    toggle(name, force) {
        const on = force === undefined ? !this.set.has(name) : Boolean(force);
        if (on) this.set.add(name);
        else this.set.delete(name);
        return on;
    }
}

class FakeStyle {
    constructor() {
        this.props = {};
    }
    setProperty(name, value) {
        this.props[name] = String(value);
    }
    removeProperty(name) {
        delete this.props[name];
    }
    getPropertyValue(name) {
        return this.props[name] || '';
    }
}

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parent = null;
        this.dataset = {};
        this.style = new FakeStyle();
        this.classList = new FakeClassList();
        this.textContent = '';
        this.listeners = {};
        this.rect = { left: 0, top: 0, width: 800, height: 800 };
    }
    get className() {
        return [...this.classList.set].join(' ');
    }
    set className(value) {
        this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
    }
    get innerHTML() {
        return '';
    }
    set innerHTML(value) {
        if (String(value) === '') {
            for (const child of this.children) child.parent = null;
            this.children = [];
        }
    }
    appendChild(child) {
        child.parent = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
        child.parent = null;
        return child;
    }
    remove() {
        if (this.parent) this.parent.removeChild(this);
    }
    querySelector() {
        return null;
    }
    querySelectorAll() {
        return [];
    }
    getBoundingClientRect() {
        return this.rect;
    }
    addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
    }
    removeEventListener(type, fn) {
        const list = this.listeners[type];
        if (!list) return;
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
    }
    fire(type, event) {
        for (const fn of (this.listeners[type] || []).slice()) fn(event);
    }
}

const windowListeners = {};

globalThis.document = { createElement: (tag) => new FakeElement(tag) };
globalThis.window = {
    addEventListener(type, fn) {
        (windowListeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
        const list = windowListeners[type];
        if (!list) return;
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
    }
};

globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

function fireWindow(type, event) {
    for (const fn of (windowListeners[type] || []).slice()) fn(event);
}

const { BoardView } = await import('../client/board.js');

let failed = 0;
function check(label, ok, extra = '') {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'GAGAL'} ${label}${extra ? ' — ' + extra : ''}`);
}

const CENTER = (index, orientation = 'w') => {
    const file = index & 7;
    const rank = index >> 3;
    const col = orientation === 'w' ? file : 7 - file;
    const row = orientation === 'w' ? rank : 7 - rank;
    return { clientX: col * 100 + 50, clientY: row * 100 + 50 };
};

function makeBoard(entries) {
    const board = new Array(64).fill(null);
    for (const [index, piece] of entries) board[index] = piece;
    return board;
}

function newView() {
    const root = new FakeElement('div');
    const calls = [];
    const view = new BoardView(root, {
        onSelect: (index) => calls.push(['select', index]),
        onMove: (from, to) => calls.push(['move', from, to])
    });
    view.render({
        board: makeBoard([
            [12, 'P'],
            [11, 'N'],
            [52, 'p'],
            [51, 'n']
        ]),
        orientation: 'w',
        interactive: true
    });
    return { view, calls, root };
}

function click(view, index, orientation = 'w') {
    const point = CENTER(index, orientation);
    view.root.fire('pointerdown', { ...point, preventDefault() {} });
    fireWindow('pointerup', { ...point, preventDefault() {} });
}

function drag(view, from, to) {
    view.root.fire('pointerdown', { ...CENTER(from), preventDefault() {} });
    fireWindow('pointermove', { ...CENTER(to), preventDefault() {} });
    fireWindow('pointerup', { ...CENTER(to), preventDefault() {} });
}

const e2 = 12;
const e4 = 28;
const d2 = 11;
const f3 = 21;
const e7 = 52;
const f6 = 45;

let scene = newView();
click(scene.view, e2);
check('klik bidak sendiri memanggil onSelect', scene.calls.some((c) => c[0] === 'select' && c[1] === e2), JSON.stringify(scene.calls));

scene = newView();
click(scene.view, e4);
check('klik petak kosong tetap memanggil onSelect', scene.calls.some((c) => c[0] === 'select' && c[1] === e4), JSON.stringify(scene.calls));

scene = newView();
click(scene.view, e7);
check('klik bidak lawan memanggil onSelect', scene.calls.some((c) => c[0] === 'select' && c[1] === e7), JSON.stringify(scene.calls));

scene = newView();
drag(scene.view, e2, e4);
check('geser bidak ke petak kosong memanggil onMove', scene.calls.some((c) => c[0] === 'move' && c[1] === e2 && c[2] === e4), JSON.stringify(scene.calls));

scene = newView();
drag(scene.view, d2, f3);
check('geser bidak ke petak lain memakai indeks yang benar', scene.calls.some((c) => c[0] === 'move' && c[1] === d2 && c[2] === f3), JSON.stringify(scene.calls));

scene = newView();
drag(scene.view, e2, e4);
check('geser tidak ikut memicu onSelect', !scene.calls.some((c) => c[0] === 'select'), JSON.stringify(scene.calls));

scene = newView();
click(scene.view, e2);
click(scene.view, e4);
const selects = scene.calls.filter((c) => c[0] === 'select').map((c) => c[1]);
check('dua klik berurutan menghasilkan pilih lalu tujuan', selects[0] === e2 && selects[1] === e4, JSON.stringify(selects));

scene = newView();
scene.view.render({
    board: makeBoard([[12, 'P']]),
    orientation: 'w',
    interactive: false
});
click(scene.view, e2);
check('papan terkunci mengabaikan klik', scene.calls.length === 0, JSON.stringify(scene.calls));

scene = newView();
scene.view.render({
    board: makeBoard([[12, 'P'], [52, 'p']]),
    orientation: 'b',
    interactive: true
});
click(scene.view, e2, 'b');
check('papan terbalik memetakan petak dengan benar', scene.calls.some((c) => c[0] === 'select' && c[1] === e2), JSON.stringify(scene.calls));

console.log(failed === 0 ? '\nSEMUA TES PAPAN LULUS' : `\n${failed} TES PAPAN GAGAL`);
process.exit(failed === 0 ? 0 : 1);
