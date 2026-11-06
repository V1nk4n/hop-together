// Hop Together — game giải đố hợp tác chơi qua mạng LAN.
// Chạy: node server.js  (không cần cài thêm gói nào)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const LEVELS = require('./levels');
const { generate } = require('./levelgen');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 10;

// ---------- Hằng số vật lý ----------
const T = 32, VIEW_W = 960, PW = 26, PH = 30, EPS = 0.01;
const GRAV = 0.6, JUMP = -10.2, MAXFALL = 13, SPEED = 3.4, PUSH = 1.8, ELEV_SPEED = 1.6;
const COLORS = ['#ff5a5f', '#3fa7ff', '#ffc93c', '#4cd97b', '#b57bff', '#ff8c42', '#2ee6d6', '#ff7eb6', '#8d6e63', '#9e9e9e'];
const ACC_COUNT = 10; // số loại phụ kiện (vẽ ở client)
const FART_CD = 70, FART_RANGE = 95, FART_KNOCK = 10;
const EMOTES = 4;

// Câu bêu tên tội đồ. {n} = nạn nhân, {f} = kẻ xì hơi
const SHAME = {
  fall: ['{n} đi tìm đáy vực. Chưa thấy đáy.', '{n} tưởng mình biết bay 🕊️', '{n} nhảy vực như nhảy cầu, 0 điểm',
    '{n} rơi tự do, team chơi lại không tự do'],
  fake: ['{n} tin sàn nhà. Sai lầm.', '{n}: "Ủa sàn đâu?"', 'Sàn giả 1 - 0 {n}'],
  spike: ['{n} ngồi lên gai cho mát mông 🌵', '{n} kiểm tra độ nhọn của gai: rất nhọn', '{n} biến thành xiên que 🍢'],
  trap: ['{n} dính bẫy như nai vàng ngơ ngác 🦌', 'Gai mọc từ đâu ra vậy {n}? 😏', '{n} vừa bị game troll 🤡'],
  fart: ['{f} xì hơi thổi bay {n} 💨☠️', 'Bom hơi của {f} đã hạ gục {n}', '{n} không chịu nổi mùi của {f} 🤢'],
  block: ['{n} đẩy khối xuống vực. Đỉnh cao trí tuệ 🧠', 'Khối nặng đã ra đi, nghi phạm: {n}'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
Object.assign(SHAME, {
  throw: ['{f} ném {n} như ném rác 🗑️', '{f}: "Tao tưởng ném qua được..." ({n} RIP)', '{n} bay theo đường parabol của {f} 📐'],
  slap: ['{f} tát {n} một phát về với ông bà 👋', '{n} ăn tát của {f} xong mất phương hướng'],
  banana: ['{n} trượt vỏ chuối về với đất mẹ 🍌', '{n} dẫm chuối. Kinh điển.'],
  bananaBy: ['{f} ném chuối hạ gục {n} 🍌', '{n} trượt vỏ chuối do {f} rải 🍌'],
  sneeze: ['{n} hắt xì một phát bay luôn 🤧', '{n} bị cảm, cả team bị chết'],
  spicy: ['{n} ăn ớt xong chạy thẳng vào cõi chết 🌶️🔥', '{n} cay quá không nhìn đường'],
  boulder: ['{n} bị đá lăn cán dẹp lép 🪨', '{n} chạy chậm hơn hòn đá', 'Hòn đá 1 - 0 {n}'],
  poop: ['{n} bị chim ỉa xong lú luôn 💩'],
});
const CURSES = {
  moon: 'Trọng lực mặt trăng 🌙', reverse: 'Phím ngược 🔄', giant: 'Ai cũng to gấp rưỡi 🍔',
  ice: 'Sàn trơn như băng 🧊', rope: 'Dây buộc nhau 🪢',
};
const ROPE_LEN = 130, GIANT = 1.5;

// ---------- HTTP tĩnh ----------
const PUBLIC = path.join(__dirname, 'public');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
};
const server = http.createServer((req, res) => {
  if (req.url === '/rooms') {
    const list = [...rooms.values()].map((r) => {
      const host = r.players.get(r.G.host) || r.players.values().next().value;
      return { code: r.code, host: host ? host.name : '', count: r.players.size, phase: r.G.phase };
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(list));
    return;
  }
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const f = FILES[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(PUBLIC, f[0]), (err, data) => {
    if (err) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSocket tối giản ----------
class Conn {
  constructor(socket) {
    this.s = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onclose && this.onclose());
    socket.on('error', () => socket.destroy());
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.s.destroy(); return; }
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = Buffer.from(this.buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= this.buf[maskOff + (i & 3)];
      this.buf = this.buf.subarray(off + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      this.frag.push(payload);
      if (fin) {
        const msg = Buffer.concat(this.frag).toString('utf8');
        this.frag = [];
        if (this.onmessage) this.onmessage(msg);
      }
    }
  }
  frame(op, data) {
    if (this.s.destroyed) return;
    const len = data.length;
    let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    this.s.write(Buffer.concat([h, data]));
  }
  send(obj) { this.frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))); }
  close() { try { this.frame(8, Buffer.alloc(0)); } catch {} this.s.end(); }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  onConnect(new Conn(socket));
});

// ---------- Trạng thái game ----------
// Mỗi phòng có players/G/L riêng. Các hàm game dùng 3 biến dưới đây,
// withRoom() gán chúng cho phòng đang xử lý.
const rooms = new Map(); // mã phòng -> { code, players, G, L }
let players = null, G = null, L = null;
let nextId = 1;
function newRoom() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(code));
  const room = { code, players: new Map(), G: { phase: 'lobby', timer: 0, msg: '', cam: 0, frame: 0, victim: 0, host: 0 }, L: null };
  rooms.set(code, room);
  return room;
}
function withRoom(room, fn) {
  players = room.players; G = room.G; L = room.L;
  try { return fn(); } finally { room.L = L; }
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  return out;
}

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) p.conn.send(s);
}
function hostId() {
  if (!players.has(G.host)) { const first = players.values().next().value; G.host = first ? first.id : 0; }
  return G.host;
}
function sendRoster() {
  broadcast({
    t: 'roster', host: hostId(), phase: G.phase, room: [...rooms.values()].find((r) => r.players === players).code,
    players: [...players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, waiting: p.waiting,
      acc: p.acc, deaths: p.deaths })),
  });
}
function levelMsg() {
  return {
    t: 'level', idx: L.idx, total: LEVELS.length, name: L.name, hint: L.hint,
    rows: L.grid.map((r) => r.join('')),
    plates: L.plates.map((p) => [p.x, p.y, p.group]),
    door: [L.door.x, L.door.y],
    fakeDoors: L.fakeDoors.map((d) => [d.x, d.y]),
    springs: L.springs.map((sp) => [sp.x, sp.y]),
    curse: L.curse, curseName: L.curse ? CURSES[L.curse] : '',
    fakeFloors: L.fakeFloors.map((f) => [f.tx, f.ty]),
    hidden: L.hidden.map((h) => [h.tx, h.ty]),
    hasKey: !!L.key, generated: L.generated,
  };
}
function fx(o) { broadcast({ t: 'fx', ...o }); }

function playing() { return [...players.values()].filter((p) => !p.waiting); }
function active() { return [...players.values()].filter((p) => !p.waiting && !p.entered); }
function needOf(spec) {
  const n = Math.max(1, playing().length);
  if (spec === 'all') return n;
  if (spec === 'all-1') return Math.max(1, n - 1);
  return Math.max(1, Math.min(Number(spec) || 1, n));
}

// idx >= LEVELS.length là màn tự sinh. def truyền vào khi chơi lại để giữ nguyên bản đồ.
function loadLevel(idx, def) {
  const retry = !!def;
  if (!def) def = idx < LEVELS.length ? LEVELS[idx] : generate(idx - LEVELS.length + 1);
  G.def = def;
  const H = def.rows.length, W = Math.max(...def.rows.map((r) => r.length));
  const lv = {
    idx, name: def.name, hint: def.hint || '', W, H, pxW: W * T, pxH: H * T, generated: !!def.generated,
    fakeFloors: [], fakeMap: new Map(), hidden: [], fakeKeys: [], fakeDoors: [],
    springs: [], bananas: [], chilis: [], boulders: [], birds: [], poops: [],
    birdT: rnd(8, 16) * 60, swapT: rnd(30, 45) * 60, swapLeft: 0,
    grid: [], plates: [], blocks: [], elevs: [], spawn: { x: 64, y: (H - 1) * T },
    key: null, door: null, gateOpen: { g: false, h: false },
  };
  let bi = 0, ei = 0;
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      let c = def.rows[y][x] || '.';
      if (c === 'S') { lv.spawn = { x: x * T, y: (y + 1) * T }; c = '.'; }
      else if (c === 'K') { lv.key = { x: x * T + 4, y: y * T + 4, w: 24, h: 24, holder: null, used: false }; c = '.'; }
      else if (c === 'D') { lv.door = { x: x * T, y: (y - 1) * T, w: T, h: 2 * T, open: false }; c = '.'; }
      else if (c === 'B') {
        const m = (def.blocks && def.blocks[bi++]) || {};
        lv.blocks.push({ kind: 'b', x: x * T, y: y * T, w: (m.w || 2) * T, h: (m.h || 2) * T,
          need: m.need ?? 'all', vy: 0, ldx: 0, ldy: 0, ground: null, cnt: 0, needN: 1 });
        c = '.';
      } else if (c === 'E') {
        const list = def.elevators || [];
        const m = list.find((e) => e.at && e.at[0] === x && e.at[1] === y) || list[ei++] || {};
        const top = (y + 1) * T - 16;
        lv.elevs.push({ kind: 'e', x: x * T, y: top, w: (m.w || 4) * T, h: 16, restY: top,
          topY: (m.toRow ?? y - 5) * T, need: m.need ?? 'all', ldx: 0, ldy: 0, riders: 0, needN: 1 });
        c = '.';
      } else if (c === 'x') {
        const f = { tx: x, ty: y, state: 0, t: 0 };
        lv.fakeFloors.push(f); lv.fakeMap.set(x + ',' + y, f);
      } else if (c === 'v') {
        lv.hidden.push({ tx: x, ty: y, up: 0, rising: false });
      } else if (c === 'k') {
        lv.fakeKeys.push({ x: x * T + 4, y: y * T + 4, w: 24, h: 24, alive: true, run: 0 });
        c = '.';
      } else if (c === 'j') {
        lv.springs.push({ x: x * T + 2, y: (y + 1) * T - 12, w: T - 4, h: 12, squish: 0 });
        c = '.';
      } else if (c === 'n') {
        lv.bananas.push({ x: x * T + 6, y: (y + 1) * T - 12, w: 20, h: 12, vx: 0, vy: 0, heldBy: 0, rest: true, by: 0, armedAt: 0, tileOnly: true });
        c = '.';
      } else if (c === 'o') {
        lv.chilis.push({ x: x * T + 8, y: (y + 1) * T - 22, w: 16, h: 22, alive: true });
        c = '.';
      } else if (c === 'O') {
        const m = (def.boulders || []).find((b) => b.at && b.at[0] === x && b.at[1] === y) || {};
        lv.boulders.push({ trig: x * T, y0: (y + 1) * T - 72, endX: (m.endCol ?? W - 6) * T, x: 0, y: 0, w: 72, h: 72, active: false, dead: false, rot: 0 });
        c = '.';
      } else if (c === 'F') {
        lv.fakeDoors.push({ x: x * T, y: (y - 1) * T, w: T, h: 2 * T });
        c = '.';
      } else if (c === 'p' || c === 'q') {
        lv.plates.push({ x: x * T, y: (y + 1) * T - 8, w: T, h: 8, group: c === 'p' ? 'g' : 'h', pressed: false });
        c = '.';
      }
      row.push(c);
    }
    lv.grid.push(row);
  }
  if (!lv.door) lv.door = { x: (W - 3) * T, y: (H - 3) * T, w: T, h: 2 * T, open: false };
  if (!lv.key) lv.door.open = true;
  L = lv;
  // Lời nguyền: chơi lại thì giữ nguyên, màn mới thì bốc lại (màn 1 được tha)
  L.curse = retry ? G.curse : (idx === 0 ? null : pick(Object.keys(CURSES)));
  G.curse = L.curse;

  let i = 0;
  const k = L.curse === 'giant' ? GIANT : 1;
  for (const p of players.values()) {
    p.waiting = false;
    p.w = Math.round(PW * k); p.h = Math.round(PH * k);
    const row = Math.floor(i / 6), col = i % 6;
    resetBody(p, L.spawn.x + col * (p.w + 8) + row * 12, L.spawn.y - p.h - row * (p.h + 10));
    i++;
  }
  G.phase = 'play'; G.timer = 0; G.msg = ''; G.victim = 0;
  G.cam = clampCam(L.spawn.x);
  broadcast(levelMsg());
  sendRoster();
}

function resetBody(p, x, y) {
  Object.assign(p, { x, y, vx: 0, vy: 0, kx: 0, onGround: false, ground: null, coyote: 0, jbuf: 0,
    entered: false, ldx: 0, ldy: 0, face: 1, fartCd: 0, hitBy: 0, hitAt: -999, hitKind: '', fakeAt: -999,
    selfKind: '', selfAt: -999, launchAt: -999, carriedBy: 0, carrying: 0, holdBanana: null, dizzy: 0, confused: 0,
    spicy: 0, slip: 0, slipV: 0, slapCd: 0, sneezeAt: G.frame + rnd(20, 45) * 60, swapSrc: 0 });
}

// ---------- Va chạm ----------
function overlap(a, b) {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}
function tileAt(tx, ty) {
  if (tx < 0 || tx >= L.W) return '#';
  if (ty < 0 || ty >= L.H) return '.';
  return L.grid[ty][tx];
}
function tileSolid(tx, ty) {
  const c = tileAt(tx, ty);
  if (c === '#') return true;
  if (c === 'g' || c === 'h') return !L.gateOpen[c];
  if (c === 'x') return L.fakeMap.get(tx + ',' + ty).state < 2;
  return false;
}
function bodies() { return [...active(), ...L.blocks, ...L.elevs]; }
function hits(e) {
  const out = [];
  const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - EPS) / T);
  const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - EPS) / T);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (tileSolid(tx, ty)) out.push({ x: tx * T, y: ty * T, w: T, h: T, obj: null });
  if (!e.tileOnly) for (const b of bodies()) if (b !== e && b.carriedBy !== e.id && e.carriedBy !== b.id && overlap(e, b)) out.push({ x: b.x, y: b.y, w: b.w, h: b.h, obj: b });
  return out;
}
// Chỉ chặn bởi những vật nằm phía trước hướng di chuyển (tránh bị "dịch chuyển" khi đang chồng lấn sẵn).
function moveX(e, dx) {
  if (!dx) return null;
  const ox = e.x;
  e.x += dx;
  let hit = null;
  for (const r of hits(e)) {
    if (dx > 0 && r.x >= ox + e.w - 0.5 && e.x + e.w > r.x) { e.x = r.x - e.w; hit = r; }
    if (dx < 0 && r.x + r.w <= ox + 0.5 && e.x < r.x + r.w) { e.x = r.x + r.w; hit = r; }
  }
  return hit;
}
function moveY(e, dy) {
  if (!dy) return null;
  const oy = e.y;
  e.y += dy;
  let hit = null;
  for (const r of hits(e)) {
    if (dy > 0 && r.y >= oy + e.h - 0.5 && e.y + e.h > r.y) { e.y = r.y - e.h; hit = r; }
    if (dy < 0 && r.y + r.h <= oy + 0.5 && e.y < r.y + r.h) { e.y = r.y + r.h; hit = r; }
  }
  return hit;
}

// Khi "đổi xác", thân p bị điều khiển bằng phím của người khác
function inp(p) { const src = p.swapSrc && players.get(p.swapSrc); return src ? src.input : p.input; }
function inputDir(p) {
  const i = inp(p);
  let d = (i.r ? 1 : 0) - (i.l ? 1 : 0);
  if (L.curse === 'reverse') d = -d;
  if (p.confused > 0) d = -d;
  return d;
}
function hit(o, by, kind) { o.hitBy = by ? by.id : 0; o.hitAt = G.frame; o.hitKind = kind; o.launchAt = G.frame; }
function release(p) {
  const c = players.get(p.carriedBy);
  if (c) c.carrying = 0;
  p.carriedBy = 0;
}
function rootGround(e) {
  let g = e.ground, n = 0;
  while (g && g.kind === 'p' && n++ < 12) g = g.ground;
  return g;
}
function touchSide(p, t, d) {
  const vo = Math.min(p.y + p.h, t.y + t.h) - Math.max(p.y, t.y);
  if (vo < 6) return false;
  return d > 0 ? Math.abs(p.x + p.w - t.x) < 2 : Math.abs(p.x - (t.x + t.w)) < 2;
}
// Đếm số người đang đẩy khối (tính cả người đẩy nối đuôi nhau).
function countPushers(b, d) {
  const ps = active().filter((p) => inputDir(p) === d);
  const set = new Set();
  const frontier = [b];
  while (frontier.length) {
    const t = frontier.pop();
    for (const p of ps) if (!set.has(p) && touchSide(p, t, d)) { set.add(p); frontier.push(p); }
  }
  return set;
}

// ---------- Mô phỏng ----------
function clampCam(centerX) {
  if (L.pxW <= VIEW_W) return (L.pxW - VIEW_W) / 2;
  return Math.max(0, Math.min(L.pxW - VIEW_W, centerX - VIEW_W / 2));
}

function step() {
  G.frame++;
  if (G.phase === 'vote') {
    if (--G.timer <= 0 || G.votes.size >= playing().length) resolveVote();
    return;
  }
  if (G.phase === 'dead' || G.phase === 'clear') {
    if (--G.timer <= 0) {
      if (G.phase === 'dead') loadLevel(L.idx, G.def);
      else loadLevel(L.idx + 1);
    }
    if (G.phase !== 'play') return;
  }
  if (G.phase !== 'play') return;

  // Thang máy
  for (const e of L.elevs) {
    e.needN = needOf(e.need);
    e.riders = active().filter((p) => rootGround(p) === e).length;
    const target = e.riders >= e.needN ? e.topY : e.restY;
    let dy = Math.max(-ELEV_SPEED, Math.min(ELEV_SPEED, target - e.y));
    if (dy > 0) {
      const probe = { x: e.x, y: e.y + dy, w: e.w, h: e.h };
      if ([...active(), ...L.blocks].some((b) => overlap(probe, b))) dy = 0;
    }
    e.y += dy; e.ldx = 0; e.ldy = dy;
  }

  // Khối đẩy
  for (const b of [...L.blocks].sort((a, c) => c.y - a.y)) {
    const sx = b.x, sy = b.y;
    b.needN = needOf(b.need);
    const r = countPushers(b, 1), l = countPushers(b, -1);
    b.cnt = Math.max(r.size, l.size);
    let vx = 0;
    if (r.size >= b.needN && l.size < b.needN) { vx = PUSH; b.lastPusher = [...r][0]; }
    else if (l.size >= b.needN && r.size < b.needN) { vx = -PUSH; b.lastPusher = [...l][0]; }
    const g = b.ground;
    if (g && (g.ldx || g.ldy)) { moveX(b, g.ldx); moveY(b, g.ldy); }
    b.vy = Math.min(b.vy + GRAV, MAXFALL);
    moveX(b, vx);
    const hy = moveY(b, b.vy);
    if (hy && b.vy > 0) { b.ground = hy.obj; b.vy = 0; } else { b.ground = null; if (hy) b.vy = 0; }
    b.ldx = b.x - sx; b.ldy = b.y - sy;
    if (b.y > L.pxH + 64) return killByBlock(b);
  }

  const grav = L.curse === 'moon' ? GRAV * 0.45 : GRAV;
  updateSwap();

  // Người chơi (xử lý người ở dưới trước để người đứng trên được "chở" theo)
  const act = active();
  let minX = Infinity, maxX = -Infinity;
  for (const p of act) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w); }
  const leash = L.pxW > VIEW_W && act.length > 1;
  for (const p of act.sort((a, c) => c.y - a.y)) {
    const sx = p.x, sy = p.y, wasGround = p.onGround;
    const I = inp(p);
    // Đang bị bế: dính trên đầu người bế, nhảy để thoát
    if (p.carriedBy) {
      const c = players.get(p.carriedBy);
      const jp0 = I.j && !p.prevJ; p.prevJ = I.j;
      if (!c || c.waiting || c.entered || jp0) {
        release(p);
        if (jp0) p.vy = JUMP * 0.8;
      } else {
        p.x = c.x + c.w / 2 - p.w / 2; p.y = c.y - p.h; p.vy = 0; p.kx = 0;
        p.onGround = true; p.ground = c; p.ldx = p.x - sx; p.ldy = p.y - sy;
        continue;
      }
    }
    for (const k of ['dizzy', 'confused', 'spicy', 'slip', 'slapCd']) if (p[k] > 0) p[k]--;
    const g = p.ground;
    if (g && (g.ldx || g.ldy)) { moveX(p, g.ldx); moveY(p, g.ldy); }

    let dir = inputDir(p);
    if (p.dizzy > 0 || p.slip > 0) dir = 0;
    if (p.spicy > 0) dir = p.face; // ăn ớt: cắm đầu chạy
    if (dir) p.face = dir;
    const target = dir * SPEED * (p.spicy > 0 ? 1.9 : 1);
    p.vx = L.curse === 'ice' ? p.vx + (target - p.vx) * (p.onGround ? 0.04 : 0.025) : target;
    if (p.slip > 0) { p.vx = p.slipV; p.slipV *= 0.965; }
    let jp = I.j && !p.prevJ;
    p.prevJ = I.j;
    if (p.dizzy > 0 || p.slip > 0) jp = false;
    if (jp) p.jbuf = 7; else if (p.jbuf > 0) p.jbuf--;
    if (p.onGround) p.coyote = 6; else if (p.coyote > 0) p.coyote--;
    if (p.jbuf > 0 && p.coyote > 0) { p.vy = JUMP; p.jbuf = 0; p.coyote = 0; }
    if (!I.j && p.vy < -4 && G.frame - p.launchAt > 30) p.vy = -4; // thả phím sớm = nhảy thấp
    p.vy = Math.min(p.vy + grav, MAXFALL);

    const fp = I.f && !p.prevF;
    p.prevF = I.f;
    if (p.fartCd > 0) p.fartCd--;
    else if (fp) fart(p);
    const gp = I.g && !p.prevG; p.prevG = I.g;
    if (gp) grabOrThrow(p);
    const tp = I.k && !p.prevT; p.prevT = I.k;
    if (tp && p.slapCd <= 0) slap(p);
    sneezeTick(p);

    // Cả đội phải ở cùng một khung hình
    let mx = p.vx + p.kx;
    if (leash) {
      const hi = minX + VIEW_W - p.w, lo = maxX - VIEW_W;
      if (mx > 0 && p.x + mx > hi) mx = Math.max(0, hi - p.x);
      if (mx < 0 && p.x + mx < lo) mx = Math.min(0, lo - p.x);
    }
    if (moveX(p, mx)) { p.kx = 0; if (p.spicy > 0) p.face = -p.face; if (p.slip > 0) p.slipV = -p.slipV * 0.5; }
    p.kx *= 0.86;
    if (Math.abs(p.kx) < 0.2) p.kx = 0;
    const hy = moveY(p, p.vy);
    if (hy && p.vy < -8 && G.frame - p.launchAt < 60) fx({ k: 'text', x: p.x + p.w / 2, y: p.y - 10, text: pick(['CỘP! 🤕', 'Ui da!', 'Đầu ơi!']) });
    if (hy && p.vy > 0) { p.onGround = true; p.ground = hy.obj; p.vy = 0; }
    else { p.onGround = false; p.ground = null; if (hy) p.vy = 0; }
    // Lò xo
    for (const sp of L.springs) {
      if (p.vy >= 0 && overlap(p, sp) && p.y + p.h <= sp.y + sp.h + 2) {
        const big = Math.random() < 0.2;
        p.vy = big ? -21 : -15.5; p.onGround = false; p.ground = null; p.launchAt = G.frame; p.coyote = 0;
        fx({ k: 'spring', x: sp.x + sp.w / 2, y: sp.y, big });
      }
    }
    p.ldx = p.x - sx; p.ldy = p.y - sy;

    // Nhảy lên đầu người cầm chìa = cướp chìa
    const k = L.key;
    if (!wasGround && p.onGround && k && k.holder && k.holder !== p && p.ground === k.holder) {
      fx({ k: 'steal', id: p.id, from: k.holder.id });
      k.holder = p;
    }
    // Đứng lên sàn giả
    if (p.onGround && !p.ground) {
      const ty = Math.floor((p.y + p.h + 1) / T);
      for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - EPS) / T); tx++)
        if (tileAt(tx, ty) === 'x') { crumble(tx, ty); p.fakeAt = G.frame; }
    }
  }

  if (L.curse === 'rope') ropeTick();
  itemsTick(grav);
  birdTick();
  const bk = boulderTick();
  if (bk) return killPlayer(bk, 'boulder');

  // Sàn giả sụp
  for (const f of L.fakeFloors) if (f.state === 1 && --f.t <= 0) f.state = 2;

  // Gai ẩn
  for (const h of L.hidden) {
    if (!h.rising) {
      for (const p of active())
        if (p.x + p.w > h.tx * T + 2 && p.x < h.tx * T + T - 2 && p.y + p.h > h.ty * T + T / 2 && p.y < (h.ty + 1) * T) {
          h.rising = true; break;
        }
    }
    if (h.rising && h.up < 1) h.up = Math.min(1, h.up + 0.25);
  }

  // Chìa khóa giả: bỏ chạy khi có người lại gần
  for (const fk of L.fakeKeys) {
    if (!fk.alive) continue;
    let near = null, nd = Infinity;
    for (const p of active()) {
      const d = Math.hypot(p.x + p.w / 2 - (fk.x + 12), p.y + p.h / 2 - (fk.y + 12));
      if (d < nd) { nd = d; near = p; }
    }
    if (near && overlap(near, fk)) {
      fk.alive = false;
      fx({ k: 'poof', x: fk.x + 12, y: fk.y + 12, text: pick(['Chìa giả đó 🤡', 'Lêu lêu 😝', 'Ngây thơ quá!', 'Hụt rồi nha!']) });
      continue;
    }
    if (near && nd < 110 && fk.run < 260) {
      const dir = Math.sign(fk.x + 12 - (near.x + near.w / 2)) || 1;
      const nx = fk.x + dir * 4.2;
      const tx = Math.floor((dir > 0 ? nx + fk.w : nx) / T), ty = Math.floor((fk.y + 12) / T);
      if (!tileSolid(tx, ty) && nx > 0 && nx + fk.w < L.pxW) { fk.x = nx; fk.run += 4.2; }
    }
  }

  // Cửa (thật & giả)
  for (const p of playing()) {
    const dp = inp(p).d && !p.prevD;
    p.prevD = inp(p).d;
    if (dp && p.carriedBy) continue;
    if (!dp) continue;
    if (!p.entered) {
      const fd = L.fakeDoors.find((d) => overlap(p, d));
      if (fd) {
        p.vy = -11; p.kx = (Math.random() < 0.5 ? -1 : 1) * 9; p.ground = null; p.onGround = false;
        p.launchAt = G.frame; // để cú bay không bị cắt bởi "nhảy thấp"
        fx({ k: 'poof', x: fd.x + T / 2, y: fd.y + 10, text: pick(['Cửa giả! Hehe 😝', 'Đi đâu đấy? 🚪', 'Không phải cửa này!', 'Bị nhổ ra rồi 🤮']) });
        continue;
      }
    }
    if (!L.door.open) continue;
    if (p.entered) {
      p.entered = false;
      p.x = L.door.x + (T - p.w) / 2; p.y = L.door.y + L.door.h - p.h; p.vy = 0; p.ground = null;
    } else if (overlap(p, L.door)) {
      p.entered = true; p.ground = null;
      if (p.carrying) { const o = players.get(p.carrying); if (o) release(o); }
      if (p.carriedBy) release(p);
      if (L.key && L.key.holder === p) L.key.holder = null;
    }
  }

  // Chìa khóa
  const k = L.key;
  if (k && !k.used) {
    if (k.holder && (!players.has(k.holder.id) || k.holder.entered)) k.holder = null;
    if (!k.holder) for (const p of active()) if (overlap(p, k) && G.frame - p.droppedAt > 40) { k.holder = p; break; }
    if (k.holder) {
      const h = k.holder;
      k.x = h.x + h.w / 2 - k.w / 2; k.y = h.y - k.h - 4;
      if (overlap(h, L.door)) { k.used = true; k.holder = null; L.door.open = true; }
    }
  }

  // Công tắc & cổng
  const pressed = { g: false, h: false };
  for (const pl of L.plates) {
    pl.pressed = active().some((p) => overlap(p, pl)) || L.blocks.some((b) => overlap(b, pl));
    if (pl.pressed) pressed[pl.group] = true;
  }
  for (const grp of ['g', 'h']) {
    if (pressed[grp]) { L.gateOpen[grp] = true; continue; }
    if (!L.gateOpen[grp]) continue;
    // không đóng cổng khi có ai đang đứng trong đó
    let blocked = false;
    for (const b of bodies()) {
      for (let ty = Math.floor(b.y / T); ty <= Math.floor((b.y + b.h - EPS) / T) && !blocked; ty++)
        for (let tx = Math.floor(b.x / T); tx <= Math.floor((b.x + b.w - EPS) / T); tx++)
          if (tileAt(tx, ty) === grp) { blocked = true; break; }
      if (blocked) break;
    }
    if (!blocked) L.gateOpen[grp] = false;
  }

  // Chết: rơi xuống vực hoặc chạm gai
  for (const p of active()) {
    if (p.y > L.pxH + 40) return killPlayer(p, G.frame - p.fakeAt < 120 ? 'fake' : 'fall');
    for (let ty = Math.floor(p.y / T); ty <= Math.floor((p.y + p.h - EPS) / T); ty++)
      for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - EPS) / T); tx++) {
        const c = tileAt(tx, ty);
        const spike = c === '^' || (c === 'v' && L.hidden.find((h) => h.tx === tx && h.ty === ty).up >= 1);
        if (spike && overlap(p, { x: tx * T + 4, y: ty * T + T / 2, w: T - 8, h: T / 2 }))
          return killPlayer(p, c === '^' ? 'spike' : 'trap');
      }
  }

  // Camera
  const a2 = active();
  if (a2.length) {
    let mn = Infinity, mx = -Infinity;
    for (const p of a2) { mn = Math.min(mn, p.x); mx = Math.max(mx, p.x + p.w); }
    G.cam = clampCam((mn + mx) / 2);
  }

  // Qua màn
  const pl = playing();
  if (pl.length && pl.every((p) => p.entered)) {
    G.phase = 'clear'; G.timer = 150; G.msg = `Qua màn "${L.name}"!`;
    if (L.idx + 1 === LEVELS.length) { G.timer = 240; G.msg = 'Hết màn làm sẵn! Từ giờ máy tự nghĩ màn 🤖'; }
  }
}

function fart(p) {
  p.fartCd = FART_CD;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  for (const o of active()) {
    if (o === p) continue;
    const dx = o.x + o.w / 2 - cx, dy = o.y + o.h / 2 - cy;
    if (Math.abs(dy) > 50 || Math.abs(dx) > FART_RANGE || dx * p.face > 8) continue; // chỉ thổi người phía sau
    o.kx = -p.face * FART_KNOCK;
    o.vy = Math.min(o.vy, -5);
    o.ground = null; o.onGround = false;
    hit(o, p, 'fart');
    if (o.carriedBy) release(o);
    if (L.key && L.key.holder === o) { L.key.holder = null; o.droppedAt = G.frame; }
  }
  fx({ k: 'fart', id: p.id, x: Math.round(cx), y: Math.round(p.y + p.h - 6), f: p.face });
}

// Bế (G) đồng đội hoặc vỏ chuối; bấm lại để ném
function grabOrThrow(p) {
  if (p.carrying) {
    const o = players.get(p.carrying);
    if (o) {
      release(o);
      o.x = p.x + p.w / 2 - o.w / 2; o.y = p.y - o.h;
      o.kx = p.face * 10; o.vy = -9; o.onGround = false; o.ground = null;
      hit(o, p, 'throw');
      fx({ k: 'text', x: o.x + o.w / 2, y: o.y - 10, text: pick(['BAY ĐIIII!', 'Ném nè!', 'Vèo~']) });
    }
    p.carrying = 0; return;
  }
  if (p.holdBanana) {
    const b = p.holdBanana;
    b.heldBy = 0; b.rest = false; b.vx = p.face * 6; b.vy = -6; b.by = p.id; b.armedAt = G.frame;
    p.holdBanana = null; return;
  }
  if (p.carriedBy) return;
  const cx = p.x + p.w / 2;
  let best = null, bd = 48;
  for (const o of active()) {
    if (o === p || o.carriedBy || o.carrying || o.ground === p) continue;
    const d = Math.abs(o.x + o.w / 2 - cx);
    if (d < bd && Math.abs(o.y + o.h - (p.y + p.h)) < 24) { best = o; bd = d; }
  }
  if (best) {
    best.carriedBy = p.id; p.carrying = best.id;
    fx({ k: 'text', x: cx, y: p.y - best.h - 16, text: pick(['Lên nào!', 'Hự!', 'Nặng vãi']) });
    return;
  }
  const ban = L.bananas.find((b) => !b.heldBy && b.rest && Math.abs(b.x + b.w / 2 - cx) < 30 && Math.abs(b.y - p.y) < 40);
  if (ban) { ban.heldBy = p.id; p.holdBanana = ban; }
}

// Tát (T): người trước mặt văng ra và choáng 1 giây
function slap(p) {
  p.slapCd = 30;
  const cx = p.x + p.w / 2;
  for (const o of active()) {
    if (o === p) continue;
    const dx = (o.x + o.w / 2 - cx) * p.face;
    if (dx > 0 && dx < p.w + 18 && Math.abs(o.y - p.y) < 30) {
      if (o.carriedBy) release(o);
      o.kx = p.face * 8; o.vy = Math.min(o.vy, -4); o.dizzy = 60; o.ground = null;
      hit(o, p, 'slap');
      fx({ k: 'slap', id: o.id, x: o.x + o.w / 2, y: o.y });
      return;
    }
  }
  fx({ k: 'text', x: cx + p.face * 20, y: p.y, text: 'Hụt 💨' });
}

// Ợ / hắt xì ngẫu nhiên
function sneezeTick(p) {
  if (G.frame === p.sneezeAt - 50) fx({ k: 'presneeze', id: p.id });
  if (G.frame < p.sneezeAt) return;
  p.sneezeAt = G.frame + rnd(20, 45) * 60;
  if (Math.random() < 0.7) {
    p.kx = -p.face * 9; p.vy = Math.min(p.vy, -3); p.onGround = false; p.ground = null;
    p.selfKind = 'sneeze'; p.selfAt = G.frame; p.launchAt = G.frame;
    fx({ k: 'sneeze', id: p.id, x: p.x + p.w / 2, y: p.y, f: p.face });
  } else fx({ k: 'burp', id: p.id, x: p.x + p.w / 2, y: p.y, f: p.face });
}

function ropeTick() {
  const ps = active().filter((p) => !p.carriedBy).sort((a, b) => a.id - b.id);
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i], b = ps[i + 1];
    const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
    const d = Math.hypot(dx, dy);
    if (d <= ROPE_LEN) continue;
    const ex = (d - ROPE_LEN) / 2, ux = dx / d, uy = dy / d;
    moveX(a, ux * ex); moveY(a, uy * ex); moveX(b, -ux * ex); moveY(b, -uy * ex);
    if (uy > 0.3) b.vy = Math.min(b.vy, 1); // người bị treo được kéo lên
    if (uy < -0.3) a.vy = Math.min(a.vy, 1);
  }
}

function itemsTick(grav) {
  // ớt
  for (const c of L.chilis) {
    if (!c.alive) continue;
    const p = active().find((q) => overlap(q, c));
    if (p) {
      c.alive = false; p.spicy = 180; p.selfKind = 'spicy'; p.selfAt = G.frame + 180;
      fx({ k: 'text', x: c.x + 8, y: c.y - 10, text: pick(['CAY QUÁÁÁ 🌶️🔥', 'NÓNG NÓNG NÓNG!', 'Ớt chỉ thiên 🔥']) });
    }
  }
  // vỏ chuối
  for (const b of L.bananas) {
    if (b.heldBy) {
      const h = players.get(b.heldBy);
      if (!h || h.waiting || h.entered) { b.heldBy = 0; b.rest = false; if (h) h.holdBanana = null; continue; }
      b.x = h.x + h.w / 2 - b.w / 2; b.y = h.y - b.h - 2; continue;
    }
    if (!b.rest) {
      b.vy = Math.min(b.vy + grav, MAXFALL);
      if (moveX(b, b.vx)) b.vx = -b.vx * 0.3;
      const hy = moveY(b, b.vy);
      if (hy && b.vy > 0) { b.rest = true; b.vx = 0; b.vy = 0; } else if (hy) b.vy = 0;
      if (b.y > L.pxH + 50) { b.rest = true; b.y = -999; }
    }
    for (const p of active()) {
      if (!overlap(p, b) || p.slip > 0 || p.carriedBy) continue;
      const flying = !b.rest && b.by && b.by !== p.id && G.frame - b.armedAt > 5;
      if (flying || (b.rest && p.onGround && Math.abs(p.vx) > 0.5)) {
        const dir = Math.sign(p.vx) || p.face;
        p.slip = 50; p.slipV = dir * 8; p.launchAt = G.frame;
        if (flying) hit(p, players.get(b.by), 'banana'); else { p.selfKind = 'banana'; p.selfAt = G.frame; }
        b.rest = false; b.vx = -dir * 3; b.vy = -6; b.by = 0;
        fx({ k: 'text', x: p.x + p.w / 2, y: p.y - 10, text: pick(['TRƯỢTTT! 🍌', 'Ối chuối!', 'Á á á!']) });
        break;
      }
    }
  }
}

// Chim bay ngang ỉa xuống đầu => phím ngược 5 giây
function birdTick() {
  if (--L.birdT <= 0) {
    L.birdT = rnd(12, 22) * 60;
    const left = Math.random() < 0.5;
    const targets = active();
    if (targets.length) L.birds.push({ x: left ? G.cam - 40 : G.cam + VIEW_W + 40, y: 30 + Math.random() * 60, vx: left ? 3 : -3,
      target: pick(targets).id, dropped: false });
  }
  for (const b of L.birds) {
    b.x += b.vx;
    const t = players.get(b.target);
    if (!b.dropped && t && Math.abs(b.x - (t.x + t.w / 2 + t.vx * 12)) < 6) {
      b.dropped = true; L.poops.push({ x: b.x, y: b.y + 10, w: 10, h: 10, vy: 1 });
    }
  }
  L.birds = L.birds.filter((b) => b.x > G.cam - 120 && b.x < G.cam + VIEW_W + 120);
  for (const pp of L.poops) {
    pp.vy = Math.min(pp.vy + 0.25, 9); pp.y += pp.vy;
    const p = active().find((q) => overlap(q, pp));
    if (p) {
      pp.dead = true; p.confused = 300;
      fx({ k: 'poop', id: p.id, x: pp.x, y: pp.y });
    } else if (tileSolid(Math.floor(pp.x / T), Math.floor((pp.y + 10) / T)) || pp.y > L.pxH) pp.dead = true;
  }
  L.poops = L.poops.filter((pp) => !pp.dead);
}

// Đá lăn đuổi phía sau
function boulderTick() {
  for (const b of L.boulders) {
    if (b.dead) continue;
    if (!b.active) {
      if (!active().some((p) => p.x > b.trig)) continue;
      b.active = true; b.x = Math.min(b.trig - 8 * T, G.cam - 80);
      b.y = b.y0;
      fx({ k: 'text', x: b.trig, y: 120, text: 'ĐÁ LĂN! CHẠY ĐIIIII 🪨' });
    }
    b.x += 2.7; b.rot += 2.7 / 36;
    const gy = groundTopAt(b.x + b.w / 2, b.y);
    if (gy !== null) b.y += Math.max(-4, Math.min(6, gy - b.h - b.y));
    if (b.x > b.endX) { b.dead = true; fx({ k: 'poof', x: b.x + 36, y: b.y + 36, text: 'Đá vỡ rồi, thở phào 😮‍💨' }); continue; }
    const hb = { x: b.x + 8, y: b.y + 8, w: b.w - 16, h: b.h - 8 };
    const victim = active().find((p) => overlap(p, hb));
    if (victim) return victim;
  }
  return null;
}
function groundTopAt(px, fromY) {
  const tx = Math.max(0, Math.floor(px / T));
  for (let ty = Math.max(0, Math.floor(fromY / T) - 3); ty < L.H; ty++) if (tileSolid(tx, ty)) return ty * T;
  return null;
}

// Đổi xác: cả team bị hoán đổi điều khiển 10 giây
function updateSwap() {
  const act = active();
  if (L.swapLeft > 0) {
    if (--L.swapLeft === 0 || act.length < 2) {
      L.swapLeft = 0;
      for (const p of players.values()) p.swapSrc = 0;
      fx({ k: 'swap', on: false });
    }
    return;
  }
  if (--L.swapT > 0 || act.length < 2) return;
  L.swapT = rnd(35, 55) * 60; L.swapLeft = 600;
  const ids = act.map((p) => p.id).sort(() => Math.random() - 0.5);
  ids.forEach((id, i) => { players.get(id).swapSrc = ids[(i + 1) % ids.length]; });
  fx({ k: 'swap', on: true });
}

function crumble(tx, ty) {
  let a = tx, b = tx;
  while (tileAt(a - 1, ty) === 'x') a--;
  while (tileAt(b + 1, ty) === 'x') b++;
  for (let x = a; x <= b; x++) {
    const f = L.fakeMap.get(x + ',' + ty);
    if (f.state === 0) { f.state = 1; f.t = 14; }
  }
}

function shame(victim, cause) {
  let blame = victim, tpl = SHAME[cause];
  const by = players.get(victim.hitBy);
  if (by && by !== victim && G.frame - victim.hitAt < 150) {
    blame = by; tpl = SHAME[victim.hitKind === 'banana' ? 'bananaBy' : victim.hitKind] || SHAME.fart;
  } else if (victim.selfKind && G.frame - victim.selfAt < 150) tpl = SHAME[victim.selfKind];
  return { blame, msg: pick(tpl).replace('{n}', victim.name).replace('{f}', blame.name) };
}
function killPlayer(p, cause) {
  const { blame, msg } = shame(p, cause);
  G.victim = p.id;
  fx({ k: 'death', id: p.id, x: Math.round(p.x), y: Math.round(Math.min(p.y, L.pxH)), cause });
  startVote(blame, msg);
}
function killByBlock(b) {
  const p = b.lastPusher && players.get(b.lastPusher.id);
  const msg = p ? pick(SHAME.block).replace('{n}', p.name) : 'Khối nặng tự sát. Không ai chịu trách nhiệm 🤷';
  G.victim = 0;
  fx({ k: 'death', id: 0, x: Math.round(b.x), y: L.pxH, cause: 'block' });
  startVote(p, msg);
}
// Có từ 2 người trở lên thì cả team bỏ phiếu xem ai mới là thủ phạm thật
function startVote(suspect, msg) {
  if (playing().length < 2) {
    if (suspect) suspect.deaths++;
    kill(msg); sendRoster(); return;
  }
  G.phase = 'vote'; G.timer = 60 * 3; G.msg = msg; G.votes = new Map(); G.suspect = suspect ? suspect.id : 0;
}
function resolveVote() {
  const tally = new Map();
  for (const t of G.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
  let target = 0, best = 0;
  for (const [id, n] of tally) if (n > best || (n === best && id === G.suspect)) { target = id; best = n; }
  if (!best) target = G.suspect;
  const p = players.get(target);
  if (p) {
    p.deaths++;
    G.msg = best ? `Cả team phán: ${p.name} có tội! 🔨 (${best} phiếu)` : `Không ai bỏ phiếu. ${p.name} lãnh đủ 🔨`;
  } else G.msg = 'Không ai có tội. Lạ thật đấy 🤔';
  G.phase = 'dead'; G.timer = 110;
  sendRoster();
}
function kill(msg, timer = 130) {
  G.phase = 'dead'; G.timer = timer; G.msg = msg;
}

function snapshot() {
  const r = (v) => Math.round(v * 10) / 10;
  return {
    t: 's', ph: G.phase, msg: G.msg, cam: r(G.cam), vic: G.victim,
    p: [...players.values()].map((p) => [p.id, r(p.x), r(p.y), p.face, p.entered ? 1 : 0, p.waiting ? 1 : 0,
      p.onGround ? 1 : 0, Math.sign(p.vx || 0),
      (p.dizzy > 0 ? 1 : 0) | (p.confused > 0 ? 2 : 0) | (p.spicy > 0 ? 4 : 0) | (p.slip > 0 ? 8 : 0) | (p.carriedBy ? 16 : 0),
      p.swapSrc]),
    bn: L.bananas.map((b) => [r(b.x), r(b.y), b.heldBy ? 1 : 0]),
    ch: L.chilis.map((c) => [c.x, c.y, c.alive ? 1 : 0]),
    bd: L.birds.map((b) => [r(b.x), r(b.y), b.vx > 0 ? 1 : -1]),
    pp: L.poops.map((pp) => [r(pp.x), r(pp.y)]),
    bo: L.boulders.filter((b) => b.active && !b.dead).map((b) => [r(b.x), r(b.y), r(b.rot)]),
    vt: G.phase === 'vote' ? { left: Math.ceil(G.timer / 60), suspect: G.suspect, votes: [...G.votes] } : null,
    b: L.blocks.map((b) => [r(b.x), r(b.y), b.w, b.h, b.needN, b.cnt]),
    e: L.elevs.map((e) => [r(e.x), r(e.y), e.w, e.needN, e.riders]),
    k: L.key ? [r(L.key.x), r(L.key.y), L.key.holder ? L.key.holder.id : 0, L.key.used ? 1 : 0] : null,
    d: L.door.open ? 1 : 0,
    go: L.gateOpen,
    pl: L.plates.map((p) => (p.pressed ? 1 : 0)),
    ff: L.fakeFloors.map((f) => (f.state === 1 ? 1 + f.t / 100 : f.state)),
    fk: L.fakeKeys.map((k) => [r(k.x), r(k.y), k.alive ? 1 : 0]),
    hs: L.hidden.map((h) => h.up),
  };
}

// Vòng lặp cố định 60 bước/giây
const DT = 1000 / 60;
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last; last = now;
  if (acc > 250) acc = 250;
  let steps = 0;
  while (acc >= DT) { acc -= DT; steps++; }
  if (!steps) return;
  for (const room of rooms.values()) {
    try {
      withRoom(room, () => {
        if (!L || G.phase === 'lobby') return;
        for (let i = 0; i < steps && L && G.phase !== 'lobby'; i++) step();
        if (L && G.phase !== 'lobby') broadcast(snapshot());
      });
    } catch (err) {
      // Lỗi trong một phòng: ghi log, đưa phòng về phòng chờ thay vì làm sập cả server
      console.error(`[${room.code}] lỗi mô phỏng:`, err);
      room.G.phase = 'lobby'; room.L = null;
      withRoom(room, () => { sendRoster(); broadcast({ t: 'chat', id: 0, name: 'Hệ thống', text: 'Game gặp lỗi nên đã quay về phòng chờ. Chủ phòng bấm Bắt đầu lại nhé.' }); });
    }
  }
}, 4);

// ---------- Kết nối ----------
function onConnect(conn) {
  conns.add(conn);
  conn.s.on('close', () => conns.delete(conn));
  let me = null, room = null;
  conn.onmessage = (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !me) {
      if (m.create) room = newRoom();
      else room = rooms.get(String(m.room || '').toUpperCase().trim());
      if (!room) { conn.send({ t: 'noroom' }); return; }
      if (room.players.size >= MAX_PLAYERS) { conn.send({ t: 'full' }); room = null; return; }
      withRoom(room, () => onJoin(m));
      return;
    }
    if (me) {
      try { withRoom(room, () => onGame(m)); } catch (err) { console.error('lỗi xử lý tin nhắn:', err); }
    }
  };
  function onJoin(m) {
    {
      const used = new Set([...players.values()].map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[0];
      const name = String(m.name || 'Người chơi').trim().slice(0, 14) || 'Người chơi';
      me = { id: nextId++, kind: 'p', name, color, conn, w: PW, h: PH, acc: Math.floor(Math.random() * ACC_COUNT),
        deaths: 0, emoAt: -999, droppedAt: -999,
        input: { l: 0, r: 0, j: 0, d: 0, f: 0, g: 0, k: 0 }, prevJ: 0, prevD: 0, prevF: 0, prevG: 0, prevT: 0, waiting: G.phase !== 'lobby' };
      resetBody(me, -999, -999);
      players.set(me.id, me);
      if (m.create) G.host = me.id;
      conn.send({ t: 'hello', id: me.id, room: room.code, levels: LEVELS.map((l) => l.name), urls: lanUrls() });
      if (L && G.phase !== 'lobby') conn.send(levelMsg());
      sendRoster();
      console.log(`+ ${name} vào phòng ${room.code} (${players.size} người)`);
    }
  }
  function onGame(m) {
    if (m.t === 'chat') {
      const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!text || Date.now() - (me.chatAt || 0) < 400) return;
      me.chatAt = Date.now();
      broadcast({ t: 'chat', id: me.id, name: me.name, color: me.color, text });
    } else if (m.t === 'in') {
      me.input = { l: m.l ? 1 : 0, r: m.r ? 1 : 0, j: m.j ? 1 : 0, d: m.d ? 1 : 0, f: m.f ? 1 : 0, g: m.g ? 1 : 0, k: m.k ? 1 : 0 };
    } else if (m.t === 'vote' && G.phase === 'vote' && players.has(Number(m.id))) {
      G.votes.set(me.id, Number(m.id));
    } else if (m.t === 'emo' && L && G.phase !== 'lobby' && G.frame - me.emoAt > 20) {
      me.emoAt = G.frame;
      fx({ k: 'emo', id: me.id, n: Math.max(0, Math.min(EMOTES - 1, Number(m.n) || 0)) });
    } else if (m.t === 'acc') {
      me.acc = (me.acc + 1 + Math.floor(Math.random() * (ACC_COUNT - 1))) % ACC_COUNT;
      sendRoster();
    } else if (m.t === 'start' && me.id === hostId() && G.phase === 'lobby') {
      const idx = Math.max(0, Math.min(LEVELS.length, Number(m.level) || 0));
      loadLevel(idx);
    } else if (m.t === 'restart' && L && (G.phase === 'play' || G.phase === 'vote')) {
      G.victim = 0;
      kill(`${me.name} bấm R vì quá nhục 😩`, 45);
    } else if (m.t === 'menu' && me.id === hostId()) {
      G.phase = 'lobby';
      for (const p of players.values()) p.waiting = false;
      sendRoster();
    }
  }
  conn.onclose = () => {
    if (me) withRoom(room, onLeave);
  };
  function onLeave() {
    if (L) {
      if (me.carriedBy) release(me);
      const o = players.get(me.carrying); if (o) o.carriedBy = 0;
      if (me.holdBanana) me.holdBanana.heldBy = 0;
      for (const p of players.values()) if (p.swapSrc === me.id) p.swapSrc = 0;
    }
    players.delete(me.id);
    if (L && L.key && L.key.holder === me) L.key.holder = null;
    console.log(`- ${me.name} rời phòng ${room.code} (${players.size} người)`);
    if (players.size === 0) { rooms.delete(room.code); L = null; return; }
    sendRoster();
  }
}

const conns = new Set();
setInterval(() => { for (const c of conns) c.frame(9, Buffer.alloc(0)); }, 25000);
process.on('uncaughtException', (err) => console.error('Lỗi không bắt được:', err));

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Cổng ${PORT} đang bị chương trình khác dùng. Đổi cổng: PORT=3002 node server.js` : err);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  HOP TOGETHER đang chạy!');
  console.log(`  Máy này:   http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  Mạng LAN:  ${u}`);
  console.log('  Gửi địa chỉ LAN cho bạn bè cùng mạng để vào chơi.');
  console.log('==============================================');
});
