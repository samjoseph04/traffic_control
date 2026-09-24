(() => {
'use strict';

/* ---------- Constants ---------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);

const S = 640, C = 320, RW = 60;           // canvas size, centre, half road width
const BOX0 = C - RW, BOX1 = C + RW;        // intersection edges (260..380)
const L = 40, W = 22, GAP = 10;            // car length, width, gap between cars
const STOP = BOX0 - 8;                     // distance along lane where a car's front stops
const ACC = 220, DEC = 420;                // px/s^2
const JAM_MAX = 4;                         // seconds a queue may touch the screen edge
const KEY = 'trafficControlHighScore';
const DIRS = ['N', 'S', 'E', 'W'];         // where cars come FROM
const COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#eab308', '#22d3ee', '#f1f5f9'];
const ANGLE = { N: Math.PI / 2, S: -Math.PI / 2, W: 0, E: Math.PI };
const LIGHT_POS = { N: [244, 222], E: [396, 222], W: [244, 418], S: [396, 418] };
const grp = d => (d === 'N' || d === 'S') ? 'NS' : 'EW';

// Position of a car centre; s = distance travelled from its spawn edge.
function pos(d, s) {
  switch (d) {
    case 'N': return [290, s];
    case 'S': return [350, S - s];
    case 'W': return [s, 350];
    default:  return [S - s, 290];
  }
}

/* ---------- State ---------- */
let state = 'ready', cars = [], pops = [], crash = null;
let score = 0, time = 0, spawnT = 0, high = 0, newBest = false;
let light, jam;
try { high = parseInt(localStorage.getItem(KEY), 10) || 0; } catch (e) {}

const level = () => 1 + Math.floor(time / 20);
const yellowTime = () => Math.max(0.9, 1.4 - level() * 0.05);

function reset() {
  cars = []; pops = []; crash = null;
  score = 0; time = 0; spawnT = 0.6; newBest = false;
  light = { green: 'NS', phase: 'green', timer: 0, next: 'NS' };
  jam = { N: 0, S: 0, E: 0, W: 0 };
  updateHud(); updateButtons();
}

function setState(s) {
  state = s;
  $('startScreen').hidden = s !== 'ready';
  $('pauseScreen').hidden = s !== 'paused';
  $('overScreen').hidden = s !== 'over';
  $('btnPause').textContent = s === 'paused' ? '▶ Resume' : '⏸ Pause';
}

function start() { reset(); setState('playing'); }
function togglePause() {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') setState('playing');
}

/* ---------- Traffic lights ---------- */
function requestLight(g) {
  if (state !== 'playing') return;
  if (light.phase === 'green') {
    if (light.green === g) return;
    light.phase = 'yellow';
    light.timer = yellowTime();
  }
  light.next = g;
  updateButtons();
}

function lightFor(d) {
  if (grp(d) !== light.green) return 'red';
  return light.phase === 'green' ? 'green' : 'yellow';
}

/* ---------- Simulation ---------- */
function spawn() {
  const order = DIRS.slice().sort(() => Math.random() - 0.5);
  for (const d of order) {
    let tail = null;
    for (const c of cars) if (c.d === d && (!tail || c.s < tail.s)) tail = c;
    if (tail && tail.s < -30 + L + GAP) continue;      // lane entrance is full
    const maxV = Math.min(230, 95 + time * 1.3) * (0.9 + Math.random() * 0.2);
    cars.push({
      d, s: -30, maxV,
      v: tail ? Math.min(maxV, tail.v + 30) : maxV,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      choice: null, counted: false
    });
    return;
  }
}

function moveLane(d, dt) {
  const lane = cars.filter(c => c.d === d).sort((a, b) => b.s - a.s);
  const st = lightFor(d), stopC = STOP - L / 2;

  lane.forEach((c, i) => {
    // Decide once per light cycle whether this car stops or drives through.
    if (st === 'green') c.choice = null;
    else if (c.choice === null) {
      const dist = stopC - c.s;
      if (dist < -1) c.choice = 'go';                                   // already past the line
      else if (st === 'red' || dist >= (c.v * c.v) / (2 * DEC)) c.choice = 'stop';
      else c.choice = 'go';                                             // too close to brake on yellow
    }

    const leader = i > 0 ? lane[i - 1] : null;
    let limit = leader ? leader.s - L - GAP : Infinity;
    if (c.choice === 'stop') limit = Math.min(limit, stopC);

    let target = c.maxV;
    if (limit < Infinity) target = Math.min(target, Math.sqrt(2 * DEC * Math.max(0, limit - c.s)));
    c.v = c.v < target ? Math.min(target, c.v + ACC * dt) : Math.max(target, c.v - DEC * 1.6 * dt);
    c.s += c.v * dt;
    if (c.s > limit) { c.s = limit; c.v = Math.min(c.v, leader ? leader.v : 0); }

    if (!c.counted && c.s > BOX1 + L / 2) {          // fully through the intersection
      c.counted = true;
      score += 10;
      const [x, y] = pos(d, c.s);
      pops.push({ x, y, t: 0 });
    }
  });

  // Congestion: a stopped queue reaching the screen edge
  const tail = lane[lane.length - 1];
  if (tail && tail.s < 60 && tail.v < 8) jam[d] += dt;
  else jam[d] = Math.max(0, jam[d] - dt * 2);
  if (jam[d] > JAM_MAX) gameOver('jam');
}

function carBox(c) {
  const [x, y] = pos(c.d, c.s);
  const vert = c.d === 'N' || c.d === 'S';
  const hw = (vert ? W : L) / 2 - 1.5, hh = (vert ? L : W) / 2 - 1.5;
  return { x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh };
}

function checkCollisions() {
  const near = cars.filter(c => c.s > BOX0 - 30 && c.s < BOX1 + 30);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      if (grp(near[i].d) === grp(near[j].d)) continue;
      const a = carBox(near[i]), b = carBox(near[j]);
      if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) {
        gameOver('crash', (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2, (Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) / 2);
        return;
      }
    }
  }
}

function update(dt) {
  time += dt;
  if (light.phase === 'yellow' && (light.timer -= dt) <= 0) {
    light.green = light.next; light.phase = 'green'; updateButtons();
  }
  if ((spawnT -= dt) <= 0) {
    spawn();
    spawnT = Math.max(0.6, 1.9 - time * 0.012) * (0.8 + Math.random() * 0.4);
  }
  for (const d of DIRS) { if (state !== 'playing') return; moveLane(d, dt); }
  cars = cars.filter(c => c.s < S + 60);
  pops.forEach(p => p.t += dt);
  pops = pops.filter(p => p.t < 0.8);
  checkCollisions();
  updateHud();
}

function gameOver(kind, x, y) {
  if (state === 'over') return;
  if (kind === 'crash') crash = { x, y, t: 0 };
  if (score > high) {
    high = score; newBest = true;
    try { localStorage.setItem(KEY, high); } catch (e) {}
  }
  $('overTitle').textContent = kind === 'crash' ? '💥 Crash!' : '🚦 Traffic jam!';
  $('overMsg').textContent = kind === 'crash'
    ? 'Two cars collided. Switch only when the middle is clear.'
    : 'A line of cars backed up to the edge. Keep traffic moving!';
  $('finalScore').textContent = score;
  $('finalBest').textContent = high;
  $('newBest').hidden = !newBest;
  setState('over');
  updateHud();
}

/* ---------- HUD ---------- */
function updateHud() {
  const m = Math.floor(time / 60), s = Math.floor(time % 60);
  $('score').textContent = score;
  $('high').textContent = Math.max(high, score);
  $('time').textContent = m + ':' + String(s).padStart(2, '0');
  $('level').textContent = level();
}
function updateButtons() {
  if (!light) return;
  const g = light.phase === 'green' ? light.green : light.next;
  $('btnNS').classList.toggle('active', g === 'NS');
  $('btnEW').classList.toggle('active', g === 'EW');
}

/* ---------- Rendering ---------- */
const bg = document.createElement('canvas');
bg.width = bg.height = S;

function buildBackground() {
  const g = bg.getContext('2d');
  g.fillStyle = '#2b7a44'; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,.04)';
  for (let i = 0; i < S; i += 40) for (let j = 0; j < S; j += 40) if ((i + j) / 40 % 2 === 0) g.fillRect(i, j, 40, 40);
  g.fillStyle = '#b9b6a8';                                   // sidewalks
  g.fillRect(BOX0 - 10, 0, 2 * RW + 20, S); g.fillRect(0, BOX0 - 10, S, 2 * RW + 20);
  g.fillStyle = '#3c3f48';                                   // roads
  g.fillRect(BOX0, 0, 2 * RW, S); g.fillRect(0, BOX0, S, 2 * RW);
  g.fillStyle = '#454852'; g.fillRect(BOX0, BOX0, 2 * RW, 2 * RW);

  const line = (a, b, c, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); };
  g.strokeStyle = '#f5c518'; g.lineWidth = 2;                // centre double line
  for (const o of [-2, 2]) {
    line(C + o, 0, C + o, BOX0); line(C + o, BOX1, C + o, S);
    line(0, C + o, BOX0, C + o); line(BOX1, C + o, S, C + o);
  }
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([16, 14]);   // edge dashes
  for (const o of [BOX0 + 5, BOX1 - 5]) {
    line(o, 0, o, BOX0 - 12); line(o, BOX1 + 12, o, S);
    line(0, o, BOX0 - 12, o); line(BOX1 + 12, o, S, o);
  }
  g.setLineDash([]);
  g.fillStyle = '#fff';                                      // stop lines
  g.fillRect(BOX0, BOX0 - 6, RW, 4); g.fillRect(C, BOX1 + 2, RW, 4);
  g.fillRect(BOX0 - 6, C, 4, RW);    g.fillRect(BOX1 + 2, BOX0, 4, RW);

  g.font = 'bold 15px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [['N', C, 20], ['S', C, S - 20], ['W', 20, C], ['E', S - 20, C]].forEach(([t, x, y]) => {
    g.fillStyle = 'rgba(10,12,25,.85)'; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillText(t, x, y + 1);
  });
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

function drawCar(c) {
  const [x, y] = pos(c.d, c.s);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ANGLE[c.d]);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(-L / 2 + 2, -W / 2 + 3, L, W, 5); ctx.fill();
  ctx.fillStyle = c.color; rr(-L / 2, -W / 2, L, W, 5); ctx.fill();
  ctx.fillStyle = 'rgba(15,25,45,.85)';
  ctx.fillRect(3, -W / 2 + 3, 9, W - 6); ctx.fillRect(-13, -W / 2 + 3, 6, W - 6);
  ctx.fillStyle = '#fff7b0';
  ctx.fillRect(L / 2 - 3, -W / 2 + 2, 3, 4); ctx.fillRect(L / 2 - 3, W / 2 - 6, 3, 4);
  ctx.fillStyle = c.v < 6 ? '#ff2a2a' : '#9c1f1f';
  ctx.fillRect(-L / 2, -W / 2 + 2, 3, 4); ctx.fillRect(-L / 2, W / 2 - 6, 3, 4);
  ctx.restore();
}

function drawLight(d) {
  const [x, y] = LIGHT_POS[d], st = lightFor(d);
  ctx.fillStyle = '#12141f'; rr(x - 12, y - 32, 24, 64, 8); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  [['red', '#ff3b3b', -20], ['yellow', '#ffd21f', 0], ['green', '#2dff7a', 20]].forEach(([name, col, dy]) => {
    const on = st === name;
    ctx.save();
    ctx.globalAlpha = on ? 1 : 0.2;
    ctx.fillStyle = col;
    if (on) { ctx.shadowColor = col; ctx.shadowBlur = 18; }
    ctx.beginPath(); ctx.arc(x, y + dy, 8, 0, 7); ctx.fill();
    ctx.restore();
  });
}

function draw() {
  ctx.drawImage(bg, 0, 0);
  cars.forEach(drawCar);
  DIRS.forEach(drawLight);

  for (const d of DIRS) {                                    // congestion warning
    if (jam[d] > 0.3) {
      const [x, y] = pos(d, 40), a = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      ctx.fillStyle = 'rgba(255,40,40,' + (0.4 + 0.6 * a) + ')';
      ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', x, y + 1);
    }
  }
  pops.forEach(p => {
    ctx.globalAlpha = 1 - p.t / 0.8;
    ctx.fillStyle = '#ffd84d'; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('+10', p.x, p.y - p.t * 40);
    ctx.globalAlpha = 1;
  });
  if (crash) {
    const r = 14 + Math.min(crash.t, 0.6) * 70, a = Math.max(0.35, 1 - crash.t);
    ctx.fillStyle = 'rgba(255,120,0,' + a + ')'; ctx.beginPath(); ctx.arc(crash.x, crash.y, r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,120,' + a + ')'; ctx.beginPath(); ctx.arc(crash.x, crash.y, r * 0.55, 0, 7); ctx.fill();
  }
}

/* ---------- Loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'playing') update(dt);
  if (crash) crash.t += dt;
  draw();
  requestAnimationFrame(frame);
}

/* ---------- Input ---------- */
const KEYMAP = {
  KeyW: 'NS', ArrowUp: 'NS', KeyA: 'NS', ArrowLeft: 'NS',
  KeyS: 'EW', ArrowDown: 'EW', KeyD: 'EW', ArrowRight: 'EW'
};
addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (e.repeat) return;
    if (state === 'ready' || state === 'over') start();
    else if (e.code === 'Space') togglePause();
    return;
  }
  if (KEYMAP[e.code]) { e.preventDefault(); requestLight(KEYMAP[e.code]); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') setState('paused'); });

const click = (id, fn) => $(id).addEventListener('click', e => { fn(); e.currentTarget.blur(); });
click('startBtn', start);
click('restartBtn', start);
click('resumeBtn', togglePause);
click('btnPause', togglePause);
click('btnNS', () => requestLight('NS'));
click('btnEW', () => requestLight('EW'));

/* ---------- Init ---------- */
buildBackground();
reset();
setState('ready');
requestAnimationFrame(frame);
})();
