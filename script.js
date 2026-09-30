'use strict';

const N = 8;
const FLEET = [3, 2, 2, 1, 1];
const $ = s => document.querySelector(s);

let mode, players, cur, phase, busy = false, sound = true, ac;
let sel = 0, horiz = true, hov = null, last = null, ai = { hits: [] };
let passNext = 0, passAfter = '', placedCells = [];

/* ---------- Звук (Web Audio API) ---------- */
function sfx(type) {
  if (!sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    
    const t = ac.currentTime;
    const len = { shot: 0.35, hit: 0.7, miss: 0.5, sink: 1.1 }[type];
    const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
    const d = buf.getChannelData(0);
    
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    }
    
    const src = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = { shot: 900, hit: 500, miss: 2600, sink: 260 }[type];
    g.gain.value = type === 'miss' ? 0.3 : 0.8;
    
    src.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    src.start(t);

    if (type !== 'miss') {
      const o = ac.createOscillator();
      const og = ac.createGain();
      o.frequency.setValueAtTime(type === 'shot' ? 220 : 130, t);
      o.frequency.exponentialRampToValueAtTime(30, t + len);
      og.gain.setValueAtTime(0.6, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(og);
      og.connect(ac.destination);
      o.start(t);
      o.stop(t + len);
    }
  } catch (e) {
    /* Звуковой контекст недоступен */
  }
}

$('#snd').onclick = () => {
  sound = !sound;
  $('#snd').textContent = sound ? '🔊' : '🔇';
};

/* ---------- Модель ---------- */
const mk = () => ({
  grid: Array.from({ length: N }, () => Array(N).fill(-1)),
  shots: Array.from({ length: N }, () => Array(N).fill(0)), // 0: пусто, 1: промах, 2: попадание
  ships: [],
  toPlace: [...FLEET]
});

const pname = i => mode === 'solo' ? (i ? 'Компьютер' : 'Вы') : 'Капитан ' + (i + 1);
const inB = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
const cellsFor = (r, c, len, h) => Array.from({ length: len }, (_, i) => h ? [r, c + i] : [r + i, c]);

function canPlace(p, r, c, len, h) {
  return cellsFor(r, c, len, h).every(([y, x]) => {
    if (!inB(y, x)) return false;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        if (inB(y + a, x + b) && p.grid[y + a][x + b] >= 0) return false;
      }
    }
    return true;
  });
}

function rebuild(p) {
  p.grid.forEach(row => row.fill(-1));
  p.ships.forEach((s, i) => s.cells.forEach(([y, x]) => p.grid[y][x] = i));
}

function put(p, r, c, len, h) {
  p.ships.push({ len, hits: 0, cells: cellsFor(r, c, len, h) });
  rebuild(p);
}

function auto(p) {
  for (;;) {
    p.ships = [];
    rebuild(p);
    let ok = true;
    for (const len of FLEET) {
      let done = false;
      for (let t = 0; t < 200 && !done; t++) {
        const h = Math.random() < 0.5;
        const r = Math.random() * N | 0;
        const c = Math.random() * N | 0;
        if (canPlace(p, r, c, len, h)) {
          put(p, r, c, len, h);
          done = true;
        }
      }
      if (!done) { ok = false; break; }
    }
    if (ok) { p.toPlace = []; return; }
  }
}

/* ---------- Экраны ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

/* ---------- Отрисовка поля ---------- */
function draw(el, p, showShips, playerIdx) {
  el.innerHTML = '';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.r = r;
      d.dataset.c = c;
      const si = p.grid[r][c];
      const s = p.shots[r][c];

      if (s === 2) {
        const sh = p.ships[si];
        d.classList.add('ship', sh.hits === sh.len ? 'sunk' : 'hit');
      } else if (s === 1) {
        d.classList.add('miss');
      } else if (si >= 0 && showShips) {
        d.classList.add('ship');
      }

      const pi = placedCells.findIndex(([y, x]) => y === r && x === c);
      if (pi >= 0) {
        d.classList.add('placed');
        d.style.animationDelay = pi * 45 + 'ms';
      }

      if (last && last[0] === playerIdx && last[1] === r && last[2] === c) {
        d.classList.add('fresh');
      }

      el.appendChild(d);
    }
  }
}

const cellOf = e => {
  const t = e.target.closest('.cell');
  return t ? [+t.dataset.r, +t.dataset.c] : null;
};

/* ---------- Расстановка ---------- */
function startPlace() {
  phase = 'place';
  sel = 0;
  horiz = true;
  hov = null;
  busy = false;
  show('place');
  renderPlace();
}

function renderPlace() {
  const p = players[cur];
  $('#placeTitle').textContent = pname(cur) + ', расставьте флот';
  draw($('#pb'), p, true, cur);
  placedCells = [];

  if (sel >= p.toPlace.length) sel = 0;

  $('#tray').innerHTML = p.toPlace.map((len, i) =>
    `<button class="ship-btn ${i === sel ? 'on' : ''}" data-i="${i}" title="${len}-палубный"><span class="decks">${'<i></i>'.repeat(len)}</span></button>`
  ).join('') || '<span class="hint">Весь флот на позициях!</span>';

  $('#ready').disabled = p.toPlace.length > 0;
  $('#rot').textContent = '🔄 Повернуть: ' + (horiz ? 'горизонтально' : 'вертикально');
  preview();
}

function preview() {
  const p = players[cur];
  document.querySelectorAll('#pb .ok, #pb .bad').forEach(e => e.classList.remove('ok', 'bad'));
  if (phase !== 'place' || !hov || !p.toPlace.length) return;

  const len = p.toPlace[sel];
  const ok = canPlace(p, hov[0], hov[1], len, horiz);

  cellsFor(hov[0], hov[1], len, horiz).forEach(([y, x]) => {
    if (inB(y, x)) {
      $('#pb').children[y * N + x].classList.add(ok ? 'ok' : 'bad');
    }
  });
}

function rotate() {
  if (phase !== 'place') return;
  horiz = !horiz;
  $('#rot').textContent = '🔄 Повернуть: ' + (horiz ? 'горизонтально' : 'вертикально');
  preview();
}

$('#pb').onmouseover = e => { const c = cellOf(e); if (c) { hov = c; preview(); } };
$('#pb').onmouseleave = () => { hov = null; preview(); };
$('#pb').onclick = e => {
  if (phase !== 'place' || busy) return;
  const rc = cellOf(e);
  if (!rc) return;
  const p = players[cur], [r, c] = rc;
  busy = true;

  const si = p.grid[r][c];
  if (si >= 0) {
    p.toPlace.push(p.ships[si].len);
    p.ships.splice(si, 1);
    rebuild(p);
    sel = p.toPlace.length - 1;
    hov = rc;
  } else if (p.toPlace.length) {
    const len = p.toPlace[sel];
    if (canPlace(p, r, c, len, horiz)) {
      put(p, r, c, len, horiz);
      placedCells = p.ships[p.ships.length - 1].cells;
      p.toPlace.splice(sel, 1);
      sel = 0;
      hov = rc;
    }
  }
  renderPlace();
  setTimeout(() => busy = false, 60);
};

$('#tray').onclick = e => {
  const b = e.target.closest('.ship-btn');
  if (b) { sel = +b.dataset.i; renderPlace(); }
};

$('#rot').onclick = rotate;
$('#auto').onclick = () => {
  auto(players[cur]);
  placedCells = players[cur].ships.flatMap(s => s.cells);
  renderPlace();
};
$('#reset').onclick = () => { players[cur] = mk(); renderPlace(); };

document.addEventListener('keydown', e => {
  if (e.code === 'KeyR' || e.key === 'к' || e.key === 'К') rotate();
});

$('#ready').onclick = () => {
  if (players[cur].toPlace.length) return;
  if (mode === 'solo') {
    auto(players[1]);
    cur = 0;
    startBattle();
  } else if (cur === 0) {
    pass(1, 'place');
  } else {
    pass(0, 'battle');
  }
};

/* ---------- Экран передачи ---------- */
function pass(next, after) {
  busy = true;
  passNext = next;
  passAfter = after;
  $('#pb').innerHTML = $('#eb').innerHTML = $('#ob').innerHTML = '';
  $('#passTxt').textContent = 'Передайте устройство Капитану ' + (next + 1);
  $('#passSub').textContent = after === 'place'
    ? 'Расставьте флот, пока соперник не смотрит на экран.'
    : after === 'battle'
      ? 'Все корабли на позициях. Капитан 1 открывает огонь!'
      : 'Соперник промахнулся. Теперь ваш ход!';
  show('pass');
}

$('#passBtn').onclick = () => {
  cur = passNext;
  if (passAfter === 'place') {
    startPlace();
  } else {
    phase = 'battle';
    busy = false;
    show('battle');
    renderBattle();
  }
};

/* ---------- Бой ---------- */
function startBattle() {
  phase = 'battle';
  busy = false;
  ai = { hits: [] };
  last = null;
  setMsg('Орудия заряжены. Огонь!');
  show('battle');
  renderBattle();
}

function setMsg(t) { $('#msg').textContent = t; }

function renderBattle() {
  const v = mode === 'solo' ? 0 : cur;
  draw($('#eb'), players[1 - v], false, 1 - v);
  draw($('#ob'), players[v], true, v);
  const alive = players[1 - v].ships.filter(s => s.hits < s.len).length;
  $('#turn').textContent = 'Ход: ' + pname(cur) + ' · вражеских кораблей: ' + alive;
  last = null;
}

$('#eb').onclick = e => { const rc = cellOf(e); if (rc) fire(rc[0], rc[1], false); };

function surround(t, sh) {
  sh.cells.forEach(([y, x]) => {
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        if (inB(y + a, x + b) && !t.shots[y + a][x + b]) {
          t.shots[y + a][x + b] = 1;
        }
      }
    }
  });
}

function fire(r, c, isAI) {
  if (busy || phase !== 'battle') return;
  if (mode === 'solo' && cur === 1 && !isAI) return;

  const vi = 1 - cur;
  const t = players[vi];
  if (t.shots[r][c]) return;

  busy = true;
  sfx('shot');

  setTimeout(() => {
    const si = t.grid[r][c];
    last = [vi, r, c];

    if (si >= 0) {
      const sh = t.ships[si];
      t.shots[r][c] = 2;
      sh.hits++;
      const sunk = sh.hits === sh.len;

      if (sunk) surround(t, sh);
      if (isAI) ai.hits = sunk ? [] : [...ai.hits, [r, c]];

      sfx(sunk ? 'sink' : 'hit');
      setMsg(pname(cur) + (sunk ? ': корабль потоплен! ☠️ Стреляйте снова.' : ': попадание! 🔥 Стреляйте снова.'));
      renderBattle();

      if (t.ships.every(s => s.hits === s.len)) return win();

      busy = false;
      if (isAI) setTimeout(aiMove, 900);
    } else {
      t.shots[r][c] = 1;
      sfx('miss');
      setMsg(pname(cur) + ': промах 💦');
      renderBattle();
      setTimeout(endTurn, 1100);
    }
  }, 350);
}

function endTurn() {
  cur = 1 - cur;
  if (mode === 'solo') {
    busy = false;
    renderBattle();
    if (cur === 1) setTimeout(aiMove, 800);
  } else {
    pass(cur, 'turn');
  }
}

function win() {
  phase = 'over';
  $('#winTxt').textContent = mode === 'solo'
    ? (cur === 0 ? 'Победа! Вражеский флот на дне.' : 'Компьютер потопил ваш флот. Реванш?')
    : 'Победил Капитан ' + (cur + 1) + '!';
  setTimeout(() => show('win'), 1400);
}

/* ---------- ИИ: карта вероятностей + добивание ---------- */
function aiMove() {
  if (phase !== 'battle' || cur !== 1) return;
  const t = players[0];
  let cand = [];
  const hs = ai.hits;

  if (hs.length) {
    if (hs.length > 1) {
      const rs = hs.map(x => x[0]);
      const cs = hs.map(x => x[1]);
      if (hs[0][0] === hs[1][0]) {
        const a = Math.min(...cs), b = Math.max(...cs), r = hs[0][0];
        cand = [[r, a - 1], [r, b + 1]];
      } else {
        const a = Math.min(...rs), b = Math.max(...rs), c = hs[0][1];
        cand = [[a - 1, c], [b + 1, c]];
      }
    } else {
      const [r, c] = hs[0];
      cand = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    }
    cand = cand.filter(([r, c]) => inB(r, c) && !t.shots[r][c]);
  }

  if (!cand.length) {
    ai.hits = [];
    const sc = Array.from({ length: N }, () => Array(N).fill(0));
    t.ships.filter(s => s.hits < s.len).forEach(s => {
      for (const h of [true, false]) {
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const cl = cellsFor(r, c, s.len, h);
            if (cl.every(([y, x]) => inB(y, x) && !t.shots[y][x])) {
              cl.forEach(([y, x]) => sc[y][x]++);
            }
          }
        }
      }
    });

    let best = -1;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (t.shots[r][c]) continue;
        if (sc[r][c] > best) { best = sc[r][c]; cand = []; }
        if (sc[r][c] === best) cand.push([r, c]);
      }
    }
  }

  const [r, c] = cand[Math.random() * cand.length | 0];
  fire(r, c, true);
}

/* ---------- Инициализация событий ---------- */
document.querySelectorAll('[data-mode]').forEach(b => {
  b.onclick = () => {
    mode = b.dataset.mode;
    players = [mk(), mk()];
    cur = 0;
    last = null;
    startPlace();
  };
});

$('#again').onclick = () => { phase = 'menu'; busy = false; show('menu'); };
$('#back').onclick = () => { phase = 'menu'; busy = false; show('menu'); };