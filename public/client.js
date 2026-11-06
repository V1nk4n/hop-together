(() => {
  const T = 32, VIEW_W = 960, VIEW_H = 544, PW = 26, PH = 30;
  const GATE_COLORS = { g: '#ff9f1c', h: '#2ec4b6' };
  // Phong cách "Vở học trò": giấy kẻ ô ly, bút bi xanh, bút đỏ chấm bài, tô gạch chéo
  const C = {
    bg: '#fbfaf4', grid: 'rgba(80,130,210,.17)', margin: 'rgba(214,51,75,.45)',
    wall: 'rgba(35,64,168,.42)', wallTop: '#5b6fae', ink: '#2340a8', red: '#d6334b',
    block: '#e08a3c', elev: '#7a86a8', key: '#c98a00', door: '#7a4a2a', spike: '#d6334b', fart: '#3a9a3a',
  };
  const FONT = '"Segoe Print", "Comic Sans MS", "Patrick Hand", cursive';
  const ACC_NAMES = ['Mũ ảo thuật', 'Kính râm', 'Ria mép', 'Tóc dựng', 'Mũ chong chóng', 'Nơ hồng', 'Mũ sinh nhật',
    'Nón lá', 'Hào quang', 'Ba sợi tóc'];
  const EMOTES = ['Ê!', 'Đỡ tao!', 'Ngu à?', '😂'];
  const FART_TEXT = ['PỪỪỪT!', 'BÚP!', 'PRRRT 💨', 'XÌÌÌ...', 'BỤP!'];

  const $ = (id) => document.getElementById(id);
  // Trang chạy HTTPS (khi deploy) thì phải dùng wss://
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const cv = $('cv'), ctx = cv.getContext('2d');

  let myName = '', ws = null, myId = 0, hostId = 0, levelNames = [], urls = [], roomCode = '';
  let roster = new Map(); // id -> {name,color,waiting,acc,deaths}
  let level = null, levelCanvas = null, state = null, phase = 'lobby';
  let camX = 0, selLevel = 0, shake = 0;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  // Hiệu ứng phía client
  const vis = new Map(); // id -> trạng thái hoạt hình của từng người
  let particles = [], texts = [], ragdolls = [], debris = [];
  let prevFF = [];
  let curseUntil = 0, swapOn = false, voteKey = '';
  const scaleK = () => (level && level.curse === 'giant' ? 1.5 : 1);

  // ---------- Kết nối ----------
  function savedName() { try { return localStorage.getItem('ht-name') || ''; } catch { return ''; } }
  $('name').value = savedName();
  $('name').focus();
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) { $('roomCode').value = urlRoom.toUpperCase(); $('btnJoin').classList.remove('ghost'); }
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('roomCode').value ? join() : join(true)); });
  $('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('btnJoin').onclick = () => join();
  $('btnCreate').onclick = () => join(true);

  function join(create, code) {
    const name = $('name').value.trim() || 'Người chơi';
    myName = name;
    const room = (code || $('roomCode').value).trim().toUpperCase();
    if (!create && !room) { joinErr('Nhập mã phòng hoặc chọn phòng bên dưới.'); return; }
    try { localStorage.setItem('ht-name', name); } catch {}
    if (ws) { ws.onclose = null; ws.close(); }
    ws = new WebSocket(WS_URL);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, create: !!create, room }));
    ws.onmessage = (ev) => onMsg(JSON.parse(ev.data));
    ws.onclose = () => showMsg('Mất kết nối', 'Máy chủ đã tắt hoặc mạng bị ngắt.');
  }
  function joinErr(t) { $('joinErr').textContent = t; $('joinErr').classList.remove('hidden'); }

  // Danh sách phòng đang mở
  async function refreshRooms() {
    if (myId) return;
    try {
      const list = await (await fetch('/rooms')).json();
      $('roomList').innerHTML = list.length ? list.map((r) =>
        `<button class="ghost" data-code="${r.code}"><b>${r.code}</b> · ${esc(r.host)}<br><small>${r.count}/10 người · ${r.phase === 'lobby' ? 'đang chờ' : 'đang chơi'}</small></button>`).join('')
        : '<span class="sub">Chưa có phòng nào. Tạo một phòng đi!</span>';
      for (const b of $('roomList').querySelectorAll('button')) b.onclick = () => join(false, b.dataset.code);
    } catch {}
  }
  refreshRooms();
  setInterval(refreshRooms, 2000);
  // Nhịp tim: giữ server (vd. Render free) không ngủ khi cả phòng đang đứng im ở phòng chờ
  setInterval(() => { send({ t: 'hb' }); if (p2 && p2.ws.readyState === 1) p2.ws.send('{"t":"hb"}'); }, 30000);
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function showMsg(title, text) {
    $('msgTitle').textContent = title; $('msgText').textContent = text;
    $('msgScreen').classList.remove('hidden');
  }

  function getVis(id) {
    let v = vis.get(id);
    if (!v) { v = { y: 0, vy: 0, g: 1, s: 0, sv: 0, fartT: 0, fartedT: 0, emo: null, emoT: 0, stealT: 0, blink: 3 + Math.random() * 3 }; vis.set(id, v); }
    return v;
  }

  function onMsg(m) {
    if (m.t === 'hello') {
      myId = m.id; levelNames = m.levels; urls = m.urls; roomCode = m.room;
      $('joinScreen').classList.add('hidden');
      $('chatWrap').classList.remove('hidden');
      history.replaceState(null, '', '?room=' + roomCode);
      renderLobby();
    }
    else if (m.t === 'full') { joinErr('Phòng đã đầy (tối đa 10 người).'); }
    else if (m.t === 'noroom') { joinErr('Không tìm thấy phòng này. Kiểm tra lại mã nhé.'); refreshRooms(); }
    else if (m.t === 'roster') {
      hostId = m.host;
      roster = new Map(m.players.map((p) => [p.id, p]));
      if (m.phase === 'lobby') phase = 'lobby';
      renderLobby();
    } else if (m.t === 'level') {
      level = m; buildLevelCanvas(); phase = 'play'; state = null;
      curseUntil = m.curse ? now() + 4 : 0; swapOn = false;
      particles = []; texts = []; debris = []; prevFF = [];
      renderLobby();
    } else if (m.t === 's') {
      for (const p of m.p) {
        const v = getVis(p[0]);
        const vy = p[2] - v.y;
        if (!v.g && p[6] && v.vy > 2.5) v.sv -= Math.min(0.12, v.vy * 0.016); // đáp đất: bẹp
        v.vy = Math.abs(vy) > 40 ? 0 : vy; v.y = p[2]; v.g = p[6];
      }
      // Sàn giả vừa sụp -> mảnh vụn
      if (level && m.ff) m.ff.forEach((st, i) => {
        if (st === 2 && prevFF[i] !== 2 && prevFF[i] !== undefined) {
          const [tx, ty] = level.fakeFloors[i];
          for (let j = 0; j < 4; j++) debris.push({ x: tx * T + (j % 2) * 16, y: ty * T + (j >> 1) * 16,
            vx: (Math.random() - 0.5) * 3, vy: Math.random() * -2, r: 0, vr: (Math.random() - 0.5) * 0.3, life: 90 });
        }
      });
      prevFF = m.ff || [];
      state = m;
      renderVote();
      if (phase === 'lobby' && m.ph !== 'lobby') { phase = m.ph; renderLobby(); }
      phase = m.ph;
    } else if (m.t === 'fx') onFx(m);
    else if (m.t === 'chat') onChat(m);
  }

  function onFx(m) {
    if (m.k === 'fart') {
      const v = getVis(m.id); v.fartT = 50;
      for (let i = 0; i < 12; i++) particles.push({ kind: 'cloud', x: m.x - m.f * 10, y: m.y,
        vx: -m.f * (1 + Math.random() * 2.5), vy: (Math.random() - 0.7) * 1.2, r: 5 + Math.random() * 5, life: 70, max: 70 });
      texts.push({ x: m.x - m.f * 26, y: m.y - 30, text: pickArr(FART_TEXT), life: 60, color: '#5a7d1a', size: 16 });
      // người phía sau bị dính mùi
      if (state) for (const p of state.p) {
        if (p[0] === m.id) continue;
        const dx = p[1] + PW / 2 - m.x, dy = p[2] + PH / 2 - m.y;
        if (Math.abs(dx) < 110 && Math.abs(dy) < 70 && dx * m.f <= 10) getVis(p[0]).fartedT = 70;
      }
      shake = Math.max(shake, 3);
    } else if (m.k === 'death') {
      const r = roster.get(m.id);
      const y = Math.min(m.y, (level ? level.rows.length * T : VIEW_H) - 40);
      if (r) ragdolls.push({ x: m.x, y, vx: (Math.random() - 0.5) * 7, vy: -15, rot: 0,
        vr: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2), color: r.color, acc: r.acc, name: r.name });
      for (let i = 0; i < 70; i++) particles.push({ kind: 'confetti', x: m.x + PW / 2, y,
        vx: (Math.random() - 0.5) * 11, vy: -3 - Math.random() * 9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5,
        color: pickArr(['#ff5a5f', '#3fa7ff', '#ffc93c', '#4cd97b', '#b57bff', '#ff7eb6']), life: 130, max: 130 });
      texts.push({ x: m.x + PW / 2, y: y - 40, text: pickArr(['RIP 🪦', 'Ối dồi ôi!', 'Toang 💀', 'Bay màu!']), life: 100, color: '#c44569', size: 22 });
      shake = 20;
    } else if (m.k === 'emo') {
      const v = getVis(m.id); v.emo = EMOTES[m.n]; v.emoT = 130;
    } else if (m.k === 'poof') {
      for (let i = 0; i < 10; i++) particles.push({ kind: 'smoke', x: m.x, y: m.y, vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4, r: 6 + Math.random() * 6, life: 50, max: 50 });
      texts.push({ x: m.x, y: m.y - 20, text: m.text, life: 110, color: C.ink, size: 18 });
    } else if (['text', 'slap', 'presneeze', 'sneeze', 'burp', 'spring', 'poop', 'swap'].includes(m.k)) onFx2(m);
    else if (m.k === 'steal') {
      getVis(m.id).stealT = 80;
      getVis(m.from).fartedT = 50;
      const p = state && state.p.find((q) => q[0] === m.id);
      if (p) texts.push({ x: p[1] + PW / 2, y: p[2] - 40, text: 'CƯỚP! 😈', life: 80, color: '#c44569', size: 20 });
    }
  }
  function onFx2(m) {
    const P = state && state.p.find((q) => q[0] === m.id);
    const head = (dy = 20) => P ? [P[1] + PW * scaleK() / 2, P[2] - dy] : [m.x, m.y - dy];
    if (m.k === 'text') texts.push({ x: m.x, y: m.y, text: m.text, life: 80, color: C.ink, size: 16 });
    else if (m.k === 'slap') {
      texts.push({ x: m.x, y: m.y - 12, text: pickArr(['BỐP!', 'CHÁT!', 'BẠT TAI!']), life: 70, color: C.red, size: 22 });
      shake = Math.max(shake, 6);
    } else if (m.k === 'presneeze') { const v = getVis(m.id); v.emo = pickArr(['A... a...', 'Ơ... ơ...', 'Hắt... hắt...']); v.emoT = 50; }
    else if (m.k === 'sneeze') {
      const [x, y] = head(10);
      texts.push({ x: x + m.f * 30, y, text: pickArr(['HẮT XÌ!!', 'ẮT XÌÌÌ!', 'HẮT XÌ 🤧']), life: 70, color: C.ink, size: 20 });
      for (let i = 0; i < 10; i++) particles.push({ kind: 'confetti', x: x + m.f * 12, y: y + 14, vx: m.f * (2 + Math.random() * 4), vy: (Math.random() - 0.6) * 3,
        rot: 0, vr: 0, color: '#9fd4ff', life: 40, max: 40 });
    } else if (m.k === 'burp') {
      const [x, y] = head(10);
      texts.push({ x: x + m.f * 26, y, text: pickArr(['Ợ~', 'ỢỢỢ...', 'Ợ (xin lỗi)']), life: 70, color: '#5a7d1a', size: 18 });
      getVis(m.id).fartT = 40;
    } else if (m.k === 'spring') {
      texts.push({ x: m.x, y: m.y - 20, text: m.big ? 'BOOOOING!!!' : 'Boing!', life: 60, color: C.red, size: m.big ? 22 : 15 });
      springSquish.set(m.x, 1);
    } else if (m.k === 'poop') {
      texts.push({ x: m.x, y: m.y - 20, text: 'Bị chim ỉa trúng đầu 💩 Phím ngược!', life: 110, color: '#7a4a2a', size: 15 });
    } else if (m.k === 'swap') {
      swapOn = m.on;
      if (m.on) { shake = Math.max(shake, 8); texts.push({ x: camX + VIEW_W / 2, y: 150, text: 'ĐỔI XÁC!!! 🔀', life: 120, color: C.red, size: 34 }); }
      else texts.push({ x: camX + VIEW_W / 2, y: 150, text: 'Về lại xác cũ 😮‍💨', life: 90, color: C.ink, size: 24 });
    }
  }
  const springSquish = new Map();
  // ---------- Chat ----------
  function onChat(m) {
    const row = document.createElement('div');
    row.className = 'chat-row';
    const who = document.createElement('b');
    who.textContent = m.name + ': ';
    who.style.color = m.color || 'var(--accent)';
    const txt = document.createElement('span');
    txt.textContent = m.text;
    row.append(who, txt);
    $('chatLog').append(row);
    while ($('chatLog').children.length > 30) $('chatLog').firstChild.remove();
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    setTimeout(() => row.classList.add('old'), 9000);
    // bong bóng trên đầu nhân vật
    if (m.id) { const v = getVis(m.id); v.emo = m.text.length > 34 ? m.text.slice(0, 33) + '…' : m.text; v.emoT = 240; }
  }
  function openChat() {
    if (!myId) return;
    keysDown.clear(); syncInput();
    $('chatBox').classList.remove('hidden');
    $('chatLog').classList.add('open');
    $('chatInput').focus();
  }
  function closeChat() {
    $('chatInput').value = '';
    $('chatInput').blur();
    $('chatLog').classList.remove('open');
    $('chatBox').classList.add('hidden');
  }
  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const t = $('chatInput').value.trim(); if (t) send({ t: 'chat', text: t }); closeChat(); e.preventDefault(); }
    else if (e.key === 'Escape') closeChat();
    e.stopPropagation();
  });
  $('btnChat').onclick = () => openChat();

  function pickArr(a) { return a[Math.floor(Math.random() * a.length)]; }

  // ---------- Bỏ phiếu đổ tội ----------
  function renderVote() {
    const vt = state && state.ph === 'vote' && state.vt;
    $('votePanel').classList.toggle('hidden', !vt);
    if (!vt) { voteKey = ''; return; }
    const tally = new Map(); let mine = 0;
    for (const [voter, target] of vt.votes) { tally.set(target, (tally.get(target) || 0) + 1); if (voter === myId) mine = target; }
    const cands = state.p.filter((p) => !p[5]).map((p) => roster.get(p[0])).filter(Boolean);
    const key = JSON.stringify([vt.left, vt.votes, cands.length]);
    if (key === voteKey) return;
    voteKey = key;
    $('voteLeft').textContent = vt.left;
    $('voteList').innerHTML = cands.map((p) =>
      `<button class="${mine === p.id ? '' : 'ghost'}" data-id="${p.id}"><span class="dot" style="background:${p.color}"></span>` +
      `${esc(p.name)}${p.id === vt.suspect ? ' 🕵️' : ''} <b>${'🔨'.repeat(tally.get(p.id) || 0)}</b></button>`).join('');
    for (const b of $('voteList').querySelectorAll('button')) b.onclick = () => {
      send({ t: 'vote', id: Number(b.dataset.id) });
      if (p2 && p2.ws.readyState === 1) p2.ws.send(JSON.stringify({ t: 'vote', id: Number(b.dataset.id) })); // P2 bầu theo P1
    };
  }

  // ---------- Phòng chờ ----------
  function renderLobby() {
    const inLobby = phase === 'lobby' && myId;
    $('lobbyScreen').classList.toggle('hidden', !inLobby);
    $('topbtns').classList.toggle('hidden', inLobby || !myId);
    $('btnMenu').classList.toggle('hidden', myId !== hostId);
    const p2Label = p2 ? '➖ Bỏ người chơi 2' : '➕ Người chơi 2';
    $('btnP2').textContent = p2 ? '➖ Bỏ người chơi 2 (cùng máy)' : '➕ Thêm người chơi 2 (cùng máy)';
    $('btnP2b').textContent = p2Label;
    $('p2help').classList.toggle('hidden', !p2);
    if (!inLobby) return;
    $('roomTitle').textContent = roomCode;
    $('urls').innerHTML = inviteLinks().map((u) => `<div>${u}</div>`).join('');
    $('lobbyPlayers').innerHTML = [...roster.values()].map((p) =>
      `<span class="chip"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}` +
      `${p.id === hostId ? ' 👑' : ''}${p.id === myId ? ' (bạn)' : ''}` +
      ` <small style="color:var(--muted)">· ${ACC_NAMES[p.acc] || ''}${p.deaths ? ` · ☠️${p.deaths}` : ''}</small></span>`).join('');
    const isHost = myId === hostId;
    $('hostPanel').classList.toggle('hidden', !isHost);
    $('waitHost').classList.toggle('hidden', isHost);
    const list = [...levelNames.map((n, i) => `${i + 1}. ${esc(n)}`), '🎲 Màn ngẫu nhiên (vô hạn)'];
    $('levelList').innerHTML = list.map((n, i) =>
      `<button class="ghost ${i === selLevel ? 'sel' : ''}" data-i="${i}">${n}</button>`).join('');
    for (const b of $('levelList').querySelectorAll('button'))
      b.onclick = () => { selLevel = Number(b.dataset.i); renderLobby(); };
  }
  function inviteLinks() {
    const bases = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? (urls.length ? urls : [location.origin]) : [location.origin];
    return bases.map((b) => `${b}/?room=${roomCode}`);
  }
  $('btnCopy').onclick = async () => {
    const link = inviteLinks()[0];
    try { await navigator.clipboard.writeText(link); $('btnCopy').textContent = '✅ Đã sao chép!'; }
    catch { prompt('Sao chép link này:', link); }
    setTimeout(() => { $('btnCopy').textContent = '📋 Sao chép link mời'; }, 1500);
  };
  $('btnStart').onclick = () => send({ t: 'start', level: selLevel });
  $('btnAcc').onclick = () => send({ t: 'acc' });
  $('btnRestart').onclick = () => send({ t: 'restart' });
  $('btnMenu').onclick = () => send({ t: 'menu' });
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

  // ---------- Điều khiển ----------
  const input = { l: 0, r: 0, j: 0, d: 0, f: 0, g: 0, k: 0 };
  const touchHeld = { l: 0, r: 0, j: 0, d: 0, f: 0, g: 0, k: 0 };
  const keysDown = new Set();
  const KEYMAP = {
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
    ArrowUp: 'j', KeyW: 'j', Space: 'j', ArrowDown: 'd', KeyS: 'd', KeyF: 'f', KeyE: 'f', KeyG: 'g', KeyT: 'k',
  };
  // Khi có người chơi 2 trên cùng máy thì chia đôi bàn phím
  const KEYMAP_P1 = { KeyA: 'l', KeyD: 'r', KeyW: 'j', Space: 'j', KeyS: 'd', KeyF: 'f', KeyE: 'f', KeyG: 'g', KeyT: 'k' };
  const KEYMAP_P2 = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'j', ArrowDown: 'd', Period: 'f', Comma: 'g', Slash: 'k',
    ShiftRight: 'f' };
  let p2 = null; // { ws, id, input }
  const mapFor = (code) => (p2 ? KEYMAP_P1[code] || KEYMAP_P2[code] : KEYMAP[code]);
  const isMine = (id) => id === myId || (p2 && id === p2.id);
  function syncInput() {
    const n = { l: 0, r: 0, j: 0, d: 0, f: 0, g: 0, k: 0 };
    const n2 = { l: 0, r: 0, j: 0, d: 0, f: 0, g: 0, k: 0 };
    for (const code of keysDown) {
      if (!p2) { if (KEYMAP[code]) n[KEYMAP[code]] = 1; }
      else if (KEYMAP_P1[code]) n[KEYMAP_P1[code]] = 1;
      else if (KEYMAP_P2[code]) n2[KEYMAP_P2[code]] = 1;
    }
    for (const k in touchHeld) if (touchHeld[k]) n[k] = 1;
    if (Object.keys(n).some((k) => n[k] !== input[k])) {
      Object.assign(input, n);
      send({ t: 'in', ...input });
    }
    if (p2 && p2.id && Object.keys(n2).some((k) => n2[k] !== p2.input[k])) {
      Object.assign(p2.input, n2);
      if (p2.ws.readyState === 1) p2.ws.send(JSON.stringify({ t: 'in', ...p2.input }));
    }
  }
  function addP2() {
    if (p2 || !roomCode) return;
    const w = new WebSocket(WS_URL);
    p2 = { ws: w, id: 0, input: { l: 0, r: 0, j: 0, d: 0, f: 0, g: 0, k: 0 } };
    w.onopen = () => w.send(JSON.stringify({ t: 'join', name: myName.slice(0, 11) + ' 2', room: roomCode }));
    w.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'hello') { p2.id = m.id; keysDown.clear(); syncInput(); renderLobby(); }
      else if (m.t === 'full' || m.t === 'noroom') removeP2();
    };
    w.onclose = () => { p2 = null; renderLobby(); };
    renderLobby();
  }
  function removeP2() {
    if (!p2) return;
    p2.ws.onclose = null; p2.ws.close(); p2 = null;
    keysDown.clear(); syncInput(); renderLobby();
  }
  const toggleP2 = () => (p2 ? removeP2() : addP2());
  // Bảng hướng dẫn: cột phím đổi theo chế độ 1 hay 2 người cùng máy
  function toggleHelp(show) {
    const el = $('helpScreen');
    const on = show ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !on);
    if (!on) return;
    $('hcP1').textContent = p2 ? 'Người chơi 1' : 'Phím';
    $('hcP2').classList.toggle('hidden', !p2);
    for (const td of el.querySelectorAll('td[data-solo]')) td.textContent = p2 ? td.dataset.p1 : td.dataset.solo;
    for (const td of el.querySelectorAll('.p2col')) td.classList.toggle('hidden', !p2);
  }
  $('btnHelp').onclick = () => toggleHelp();
  $('btnHelpClose').onclick = () => toggleHelp(false);
  // Bỏ focus khỏi nút sau khi bấm để Space/Enter không bấm lại nút
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
  $('btnP2').onclick = toggleP2;
  $('btnP2b').onclick = toggleP2;
  addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (mapFor(e.code)) { e.preventDefault(); keysDown.add(e.code); syncInput(); }
    else if (e.code === 'KeyR' && !e.repeat && phase === 'play') send({ t: 'restart' });
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && myId) { e.preventDefault(); openChat(); }
    else if (e.code === 'KeyH' && !e.repeat && myId) toggleHelp();
    else if (e.code === 'Escape' && !$('helpScreen').classList.contains('hidden')) toggleHelp(false);
    else if (e.code === 'Escape' && myId === hostId && phase !== 'lobby') send({ t: 'menu' });
    else if (/^Digit[1-4]$/.test(e.code) && !e.repeat) send({ t: 'emo', n: Number(e.code[5]) - 1 });
  });
  addEventListener('keyup', (e) => { if (keysDown.delete(e.code)) syncInput(); });
  addEventListener('blur', () => { keysDown.clear(); for (const k in touchHeld) touchHeld[k] = 0; syncInput(); });

  if (matchMedia('(pointer: coarse)').matches) {
    $('touch').classList.remove('hidden');
    $('touchEmo').classList.remove('hidden');
    for (const b of document.querySelectorAll('#touch button')) {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); touchHeld[k] = 1; syncInput(); };
      const off = (e) => { e.preventDefault(); touchHeld[k] = 0; syncInput(); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
    for (const b of document.querySelectorAll('#touchEmo button'))
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); send({ t: 'emo', n: Number(b.dataset.n) }); });
  }

  // ---------- Vẽ: tiện ích ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function line(pts, w = 2, color = C.ink) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function noise(i, f) { const v = Math.sin(i * 127.1 + f * 311.7) * 43758.5453; return v - Math.floor(v); }
  const boil = () => Math.floor(now() * 7);
  // Đường run run: mỗi "khung sôi" lệch một chút, trông như vẽ tay
  function wob(g, pts, amp, frame, closed) {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = (noise(i + x * 0.07, frame) - 0.5) * amp, jy = (noise(i + y * 0.09 + 50, frame) - 0.5) * amp;
      i ? g.lineTo(x + jx, y + jy) : g.moveTo(x + jx, y + jy);
    });
    if (closed) g.closePath();
  }
  function rectPts(x, y, w, h, step = 9) {
    const p = [];
    for (let i = 0; i < w; i += step) p.push([x + i, y]);
    for (let i = 0; i < h; i += step) p.push([x + w, y + i]);
    for (let i = w; i > 0; i -= step) p.push([x + i, y + h]);
    for (let i = h; i > 0; i -= step) p.push([x, y + i]);
    return p;
  }
  function hatch(g, x, y, w, h, color, gap = 7, lw = 1.3) {
    g.strokeStyle = color; g.lineWidth = lw; g.beginPath();
    const start = Math.floor((x + y) / gap) * gap - (x + y);
    for (let i = start - h; i < w; i += gap) { g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); }
    g.stroke();
  }
  // Hộp vẽ tay: tô gạch chéo bên trong + viền run
  function dbox(g, x, y, w, h, frame, o = {}) {
    if (o.fill) { g.fillStyle = o.fill; g.fillRect(x, y, w, h); }
    if (o.hatch) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); hatch(g, x, y, w, h, o.hatch, o.gap || 6, o.lw || 1.4); g.restore(); }
    wob(g, rectPts(x, y, w, h), o.amp ?? 2.2, frame, true);
    g.strokeStyle = o.ink || C.ink; g.lineWidth = o.width || 2; g.lineJoin = 'round'; g.stroke();
  }
  function zigzag(g, x, y, w, hgt, frame, color) {
    const pts = []; for (let i = 0; i <= w; i += 4) pts.push([x + i, (i / 4) % 2 ? y - hgt : y]);
    wob(g, pts, 1.3, frame); g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  }

  // Ô tường: gạch chéo liền mạch theo toạ độ thế giới, chỉ vẽ viền ở cạnh giáp khoảng trống
  function drawSolidTile(g, tx, ty, frame, solidAt) {
    const x = tx * T, y = ty * T;
    g.save(); g.beginPath(); g.rect(x, y, T, T); g.clip(); hatch(g, x, y, T, T, C.wall, 7, 1.3); g.restore();
    g.strokeStyle = C.ink; g.lineWidth = 2; g.lineCap = 'round';
    const edge = (pts) => { wob(g, pts, 2, frame + tx * 3 + ty); g.stroke(); };
    if (!solidAt(tx, ty - 1)) edge([[x, y], [x + 11, y], [x + 22, y], [x + T, y]]);
    if (!solidAt(tx, ty + 1)) edge([[x, y + T], [x + 16, y + T], [x + T, y + T]]);
    if (!solidAt(tx - 1, ty)) edge([[x, y], [x, y + 16], [x, y + T]]);
    if (!solidAt(tx + 1, ty)) edge([[x + T, y], [x + T, y + 16], [x + T, y + T]]);
  }
  function levelSolidAt(tx, ty) {
    const rows = level.rows;
    if (ty < 0 || ty >= rows.length) return false;
    if (tx < 0 || tx >= rows[0].length) return true;
    const c = rows[ty][tx];
    return c === '#' || c === 'x';
  }

  // Dựng sẵn 3 bản vẽ của màn để luân phiên => nét "sôi" nhẹ mà không tốn CPU
  let levelCanvases = [];
  function buildLevelCanvas() {
    const rows = level.rows, H = rows.length, W = rows[0].length;
    levelCanvases = [0, 1, 2].map((f) => {
      const cvs = document.createElement('canvas');
      cvs.width = W * T; cvs.height = H * T;
      const g = cvs.getContext('2d');
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = rows[y][x];
        if (c === '#') drawSolidTile(g, x, y, f * 13, levelSolidAt);
        else if (c === '^') zigzag(g, x * T, y * T + T, T, 14, f * 13 + x, C.spike);
      }
      return cvs;
    });
    levelCanvas = levelCanvases[0];
  }

  // ---------- Vẽ: nhân vật ----------
  function moodOf(id, v, p) {
    if (state.ph === 'dead' || state.ph === 'vote') return 'shock';
    const fl = p[8] || 0;
    if (fl & 8) return 'scream';
    if (fl & 1) return 'dizzy';
    if (fl & 4) return 'spicy';
    if (fl & 16) return 'jump';
    if (state.ph === 'clear') return 'happy';
    if (v.fartT > 0) return 'relief';
    if (v.fartedT > 0) return 'gross';
    if (v.vy > 7) return 'scream';
    if (hasRider(p)) return 'squish';
    if (v.stealT > 0 || (state.k && state.k[2] === id)) return 'smug';
    if (!p[6] && v.vy < -1) return 'jump';
    return 'normal';
  }
  function hasRider(p) {
    const w = PW * scaleK(), h = PH * scaleK();
    for (const q of state.p) {
      if (q === p || q[4] || q[5]) continue;
      if (Math.abs(q[2] + h - p[2]) < 1.5 && q[1] + w > p[1] + 2 && q[1] < p[1] + w - 2) return true;
    }
    return false;
  }

  function drawFace(cx, top, face, mood, blink) {
    const ex = cx + face * 3, ey = top + 10, my = top + 19;
    const eye = (dx, rw, rh, pupil) => {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(ex + dx, ey, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = C.ink; ctx.stroke();
      circle(ex + dx + face * 1.2, ey + 1, pupil, C.ink);
    };
    switch (mood) {
      case 'jump':
        eye(-5, 4.2, 5.2, 2); eye(5, 4.2, 5.2, 2);
        circle(ex, my + 1, 2.6, C.ink); break;
      case 'scream':
        eye(-5, 5, 6, 1.2); eye(5, 5, 6, 1.2);
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(ex, my + 2, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        circle(ex, my + 5, 2, '#ff6b6b'); break;
      case 'squish':
        line([ex - 8, ey - 3, ex - 3, ey, ex - 8, ey + 3]); line([ex + 8, ey - 3, ex + 3, ey, ex + 8, ey + 3]);
        line([ex - 5, my, ex - 2.5, my - 2, ex, my, ex + 2.5, my - 2, ex + 5, my]);
        ctx.fillStyle = '#7ec8ff'; ctx.beginPath(); ctx.ellipse(cx + 11, top + 4, 2, 3.2, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 'relief':
        line([ex - 8, ey + 1, ex - 5, ey - 2, ex - 2, ey + 1]); line([ex + 2, ey + 1, ex + 5, ey - 2, ex + 8, ey + 1]);
        circle(ex - 9, my - 2, 2.5, 'rgba(255,105,140,.6)'); circle(ex + 9, my - 2, 2.5, 'rgba(255,105,140,.6)');
        line([ex - 4, my, ex + 1, my + 2, ex + 5, my - 1]); break;
      case 'gross':
        line([ex - 8, ey - 1, ex - 2, ey + 1]); line([ex + 2, ey + 1, ex + 8, ey - 1]);
        line([ex - 5, my + 1, ex - 2, my - 1, ex + 1, my + 1, ex + 4, my - 1]);
        ctx.fillStyle = 'rgba(155,197,61,.35)'; ctx.fillRect(cx - 12, top + 2, 24, 22); break;
      case 'smug':
        eye(-5, 3.6, 4.4, 2); eye(5, 3.6, 4.4, 2);
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(ex - 9, ey - 5, 18, 4);
        line([ex - 9, ey - 7, ex - 2, ey - 6]); line([ex + 2, ey - 8, ex + 9, ey - 6]);
        ctx.beginPath(); ctx.arc(ex + face * 1, my - 3, 5, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke(); break;
      case 'shock':
        eye(-5, 4.8, 5.8, 1.4); eye(5, 4.8, 5.8, 1.4);
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(ex, my + 1, 2.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7ec8ff'; ctx.beginPath(); ctx.ellipse(cx - 11, top + 5, 2, 3.2, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 'happy':
        line([ex - 8, ey + 1, ex - 5, ey - 2, ex - 2, ey + 1]); line([ex + 2, ey + 1, ex + 5, ey - 2, ex + 8, ey + 1]);
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(ex, my - 2, 5, 0, Math.PI); ctx.fill(); break;
      case 'dizzy': {
        for (const dx of [-5, 5]) {
          ctx.beginPath();
          for (let a = 0; a < 12; a++) { const r = a * 0.4, an = a * 0.9 + now() * 8; ctx.lineTo(ex + dx + Math.cos(an) * r, ey + Math.sin(an) * r); }
          ctx.lineWidth = 1.4; ctx.strokeStyle = C.ink; ctx.stroke();
        }
        line([ex - 4, my + 1, ex - 1, my - 1, ex + 2, my + 1, ex + 5, my - 1]); break;
      }
      case 'spicy':
        ctx.fillStyle = 'rgba(255,60,40,.35)'; ctx.fillRect(cx - 12, top + 2, 24, 22);
        line([ex - 8, ey - 4, ex - 2, ey - 1]); line([ex + 2, ey - 1, ex + 8, ey - 4]);
        eye(-5, 3, 3.6, 1.8); eye(5, 3, 3.6, 1.8);
        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(ex + face * 2, my + 1, 4, 3.5, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 'dead':
        line([ex - 8, ey - 3, ex - 3, ey + 2]); line([ex - 8, ey + 2, ex - 3, ey - 3]);
        line([ex + 3, ey - 3, ex + 8, ey + 2]); line([ex + 3, ey + 2, ex + 8, ey - 3]);
        line([ex - 4, my, ex + 4, my]); circle(ex + 2, my + 3, 2.5, '#ff6b6b'); break;
      default:
        if (blink) { line([ex - 8, ey, ex - 2, ey]); line([ex + 2, ey, ex + 8, ey]); }
        else { eye(-5, 3.6, 4.6, 2); eye(5, 3.6, 4.6, 2); }
        ctx.beginPath(); ctx.arc(ex, my - 3, 3.5, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
    }
  }

  function drawAcc(acc, cx, top, face, mood) {
    const t = now();
    ctx.lineWidth = 2; ctx.strokeStyle = C.ink;
    switch (acc) {
      case 0: // mũ ảo thuật
        ctx.fillStyle = '#222'; ctx.fillRect(cx - 12, top - 2, 24, 4); ctx.strokeRect(cx - 12, top - 2, 24, 4);
        ctx.fillRect(cx - 8, top - 16, 16, 14); ctx.strokeRect(cx - 8, top - 16, 16, 14);
        ctx.fillStyle = '#e63946'; ctx.fillRect(cx - 8, top - 6, 16, 3); break;
      case 1: // kính râm
        if (mood === 'dead') break;
        ctx.fillStyle = '#111';
        rr(cx + face * 3 - 10, top + 6, 8, 6, 2); ctx.fill(); rr(cx + face * 3 + 2, top + 6, 8, 6, 2); ctx.fill();
        line([cx + face * 3 - 2, top + 8, cx + face * 3 + 2, top + 8], 2, '#111');
        ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(cx + face * 3 - 8, top + 7, 2, 2); break;
      case 2: // ria mép
        ctx.fillStyle = '#4a2c17';
        ctx.beginPath(); const mx = cx + face * 3, my = top + 15;
        ctx.moveTo(mx, my); ctx.quadraticCurveTo(mx - 6, my - 3, mx - 10, my + 2); ctx.quadraticCurveTo(mx - 5, my + 2, mx, my + 2);
        ctx.quadraticCurveTo(mx + 5, my + 2, mx + 10, my + 2); ctx.quadraticCurveTo(mx + 6, my - 3, mx, my); ctx.fill(); break;
      case 3: // tóc dựng
        ctx.fillStyle = '#ffd60a';
        ctx.beginPath(); ctx.moveTo(cx - 12, top + 4);
        for (let i = 0; i < 5; i++) { ctx.lineTo(cx - 12 + i * 6 + 3, top - 12 + (i % 2) * 5); ctx.lineTo(cx - 12 + (i + 1) * 6, top + 2); }
        ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      case 4: { // mũ chong chóng
        ctx.fillStyle = '#3fa7ff'; ctx.beginPath(); ctx.arc(cx, top + 2, 10, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffc93c'; ctx.fillRect(cx - 10, top, 20, 3);
        line([cx, top - 8, cx, top - 14]);
        const a = Math.abs(Math.cos(t * 18));
        ctx.fillStyle = '#ff5a5f';
        ctx.beginPath(); ctx.ellipse(cx, top - 15, 11 * a + 1, 2.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
      }
      case 5: // nơ hồng
        ctx.fillStyle = '#ff7eb6';
        ctx.beginPath(); ctx.moveTo(cx + 4, top + 1); ctx.lineTo(cx - 6, top - 7); ctx.lineTo(cx - 6, top + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 4, top + 1); ctx.lineTo(cx + 14, top - 7); ctx.lineTo(cx + 14, top + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        circle(cx + 4, top + 1, 3, '#ff4d94'); break;
      case 6: // mũ sinh nhật
        ctx.fillStyle = '#b57bff';
        ctx.beginPath(); ctx.moveTo(cx - 8, top + 2); ctx.lineTo(cx + 2, top - 20); ctx.lineTo(cx + 9, top + 2); ctx.closePath();
        ctx.fill(); ctx.stroke();
        line([cx - 4, top - 6, cx + 6, top - 4], 2, '#ffc93c'); line([cx - 1, top - 13, cx + 4, top - 12], 2, '#ffc93c');
        circle(cx + 2, top - 21, 3.5, '#ffc93c'); break;
      case 7: // nón lá
        ctx.fillStyle = '#e9c46a';
        ctx.beginPath(); ctx.moveTo(cx - 19, top + 3); ctx.lineTo(cx, top - 12); ctx.lineTo(cx + 19, top + 3); ctx.closePath();
        ctx.fill(); ctx.stroke();
        line([cx - 10, top - 3, cx + 10, top - 3], 1.2, '#b08b3c'); break;
      case 8: { // hào quang
        const yy = top - 9 + Math.sin(t * 3) * 2;
        ctx.beginPath(); ctx.ellipse(cx, yy, 10, 3.5, 0, 0, Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = '#ffd60a'; ctx.stroke(); break;
      }
      case 9: // ba sợi tóc
        for (const dx of [-4, 0, 4]) {
          ctx.beginPath(); ctx.moveTo(cx + dx, top + 1);
          ctx.quadraticCurveTo(cx + dx - 4, top - 8, cx + dx + 2 + Math.sin(t * 4 + dx) * 2, top - 13);
          ctx.lineWidth = 1.8; ctx.strokeStyle = C.ink; ctx.stroke();
        }
    }
  }

  function drawBody(x, y, color, acc, face, mood, squash, opts = {}) {
    const t = now(), f = boil() + (opts.seed || 0);
    const s = squash;
    const bw = (PW + (mood === 'squish' ? 4 : 0)) * (1 - s * 0.8), bh = (PH - 4) * (1 + s);
    const cx = x + PW / 2, bottom = y + PH - 3;
    const top = bottom - bh;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // chân que
    if (!opts.noLegs) {
      const step = opts.moving && opts.grounded ? Math.sin(t * 16) * 3 : 0;
      wob(ctx, [[cx - 6, bottom - 1], [cx - 7 + step, bottom + 4]], 1, f); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
      wob(ctx, [[cx + 6, bottom - 1], [cx + 7 - step, bottom + 4]], 1, f + 1); ctx.stroke();
    }
    const j = (k) => (noise(k, f) - 0.5) * 2.2;
    const wb = Math.sin(t * 9 + x * 0.1) * (opts.moving ? 1.2 : 0.5);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2 + j(1), bottom);
      ctx.bezierCurveTo(cx - bw / 2 - 2 + j(2), bottom - bh * 0.6, cx - bw / 2 + 2 + wb, top + j(3), cx, top + wb * 0.5);
      ctx.bezierCurveTo(cx + bw / 2 - 2 + wb, top + j(4), cx + bw / 2 + 2 + j(5), bottom - bh * 0.6, cx + bw / 2 + j(6), bottom);
      ctx.closePath();
    };
    // tô bút màu gạch chéo
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = '#fffdf6'; ctx.fillRect(cx - 20, top - 4, 40, bh + 8);
    hatch(ctx, cx - 20, top - 4, 40, bh + 8, color, 4.2, 2.6);
    ctx.restore();
    path(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2; ctx.stroke();
    drawFace(cx, top, face, mood, opts.blink);
    drawAcc(acc, cx, top, face, mood);
  }

  // Lớp phủ trạng thái, vẽ trong toạ độ của nhân vật (0,0 = góc trên trái)
  function drawStatus(fl, face, v) {
    const t = now(), f = boil();
    if (fl & 1) for (let i = 0; i < 3; i++) { // choáng: sao quay quanh đầu
      const a = t * 6 + i * 2.1, sx = PW / 2 + Math.cos(a) * 15, sy = -2 + Math.sin(a) * 4;
      ctx.fillStyle = '#e0a800'; ctx.font = `bold 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('★', sx, sy);
    }
    if (fl & 2) { // bị chim ỉa: cục phân trên đầu + dấu hỏi
      ctx.fillStyle = '#8a5a2e';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(PW / 2, 2 - i * 3.5, 7 - i * 2, 2.6, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = C.red; ctx.font = `bold 13px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('?', PW / 2 + 13 + Math.sin(t * 5) * 2, -6); ctx.fillText('?', PW / 2 - 12, -10 + Math.cos(t * 5) * 2);
    }
    if (fl & 4) { // ăn ớt: phun lửa + bốc khói
      if (Math.random() < 0.7) particles.push({ kind: 'fire', x: 0, y: 0, vx: 0, vy: 0, life: 1, max: 1 });
      for (let i = 0; i < 5; i++) {
        const fx0 = PW / 2 + face * (16 + i * 7 + Math.random() * 4), fy0 = 18 + (Math.random() - 0.5) * 6;
        wob(ctx, [[fx0, fy0 - 5 + i], [fx0 + face * 6, fy0], [fx0, fy0 + 5 - i]], 2, f + i);
        ctx.strokeStyle = i % 2 ? '#ff7a00' : C.red; ctx.lineWidth = 2; ctx.stroke();
      }
      wob(ctx, [[PW / 2 - 6, -4], [PW / 2 - 9, -12], [PW / 2 - 5, -18]], 2, f); ctx.strokeStyle = '#9aa'; ctx.lineWidth = 1.5; ctx.stroke();
      wob(ctx, [[PW / 2 + 6, -4], [PW / 2 + 9, -12], [PW / 2 + 5, -18]], 2, f + 3); ctx.stroke();
    }
    if (fl & 8) { ctx.fillStyle = C.red; ctx.font = `bold 12px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('!!', PW / 2, -8); }
  }

  function drawBubble(cx, y, text) {
    ctx.font = `bold 13px ${FONT}`;
    const w = ctx.measureText(text).width + 16, h = 24, f = boil();
    const tail = cx;
    cx = Math.max(camX + w / 2 + 6, Math.min(camX + VIEW_W - w / 2 - 6, cx));
    if (Math.abs(tail - cx) > w / 2 - 10) cx = tail + Math.sign(cx - tail) * (w / 2 - 10);
    wob(ctx, rectPts(cx - w / 2, y - h, w, h, 10), 1.6, f, true);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
    wob(ctx, [[tail - 5, y], [tail - 1, y + 7], [tail + 4, y]], 1, f); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(text, cx, y - 7);
  }

  function drawKey(x, y, held) {
    const yy = y + (held ? 0 : Math.sin(now() * 3) * 3), f = boil();
    const cx = x + 6, cy = yy + 12;
    const circ = []; for (let i = 0; i <= 12; i++) circ.push([cx + Math.cos(i / 12 * 6.3) * 6.5, cy + Math.sin(i / 12 * 6.3) * 6.5]);
    ctx.lineWidth = 2.4; ctx.strokeStyle = C.key; ctx.lineCap = 'round';
    wob(ctx, circ, 1.4, f); ctx.fillStyle = 'rgba(255,201,60,.45)'; ctx.fill(); ctx.stroke();
    wob(ctx, [[cx + 6, cy], [cx + 20, cy], [cx + 20, cy + 6], [cx + 16, cy], [cx + 16, cy + 5]], 1.2, f); ctx.stroke();
  }

  function drawDoor(dx, dy, open) {
    const f = boil();
    if (open) {
      dbox(ctx, dx, dy, T, 2 * T, f, { fill: '#fffdf6', hatch: 'rgba(35,40,90,.85)', gap: 3, lw: 1.4, ink: C.door, width: 2.5 });
      ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, T, 2 * T); ctx.clip();
      ctx.translate(dx + T, dy); ctx.scale(-1, 1); hatch(ctx, 0, 0, T, 2 * T, 'rgba(35,40,90,.6)', 4, 1.2); ctx.restore();
    } else {
      dbox(ctx, dx, dy, T, 2 * T, f, { fill: '#fffdf6', hatch: 'rgba(122,74,42,.35)', gap: 6, ink: C.door, width: 2.5 });
      // ổ khoá vẽ tay
      wob(ctx, rectPts(dx + 9, dy + 26, 14, 11, 7), 1, f, true); ctx.fillStyle = 'rgba(255,201,60,.6)'; ctx.fill();
      ctx.strokeStyle = C.key; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(dx + 16, dy + 26, 4.5, Math.PI, 0); ctx.stroke();
    }
    ctx.fillStyle = C.door; ctx.font = `bold 10px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('CỬA', dx + T / 2, dy - 8);
  }

  function drawItems(s) {
    const f = boil(), t = now();
    // lò xo
    for (const [x, y] of level.springs || []) {
      let k = springSquish.get(x + 14) || 0;
      if (k > 0) springSquish.set(x + 14, k - 0.06);
      const top = y - 6 + k * 6;
      const coil = []; for (let i = 0; i <= 8; i++) coil.push([x + 4 + (i % 2) * 20, y + 12 - (i / 8) * (12 - (top - y) - 12)]);
      wob(ctx, coil, 1, f); ctx.strokeStyle = '#7a86a8'; ctx.lineWidth = 2; ctx.stroke();
      dbox(ctx, x, top - 4, 28, 5, f, { fill: '#fffdf6', hatch: C.red, gap: 3, lw: 2, amp: 1 });
    }
    // ớt
    for (const [x, y, alive] of s.ch) {
      if (!alive) continue;
      const bob = Math.sin(t * 4 + x) * 2;
      ctx.save(); ctx.translate(x + 8, y + 12 + bob); ctx.rotate(0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 11, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(214,51,75,.75)'; ctx.fill(); ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.stroke();
      wob(ctx, [[0, -10], [2, -14], [5, -15]], 1, f); ctx.strokeStyle = '#3a9a3a'; ctx.stroke();
      ctx.restore();
    }
    // vỏ chuối
    for (const [x, y] of s.bn) {
      if (y < -100) continue;
      ctx.save(); ctx.translate(x + 10, y + 8);
      ctx.beginPath(); ctx.arc(0, -6, 11, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,214,10,.85)'; ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#b08b00'; ctx.stroke();
      wob(ctx, [[-9, 0], [-13, 4]], 1, f); ctx.stroke(); wob(ctx, [[9, 0], [13, 4]], 1, f + 1); ctx.stroke();
      ctx.restore();
    }
    // đá lăn có mặt cáu
    for (const [x, y, rot] of s.bo) {
      const cx = x + 36, cy = y + 36;
      const c = []; for (let i = 0; i <= 18; i++) c.push([cx + Math.cos(i / 18 * 6.3) * 36, cy + Math.sin(i / 18 * 6.3) * 36]);
      wob(ctx, c, 3, f, true); ctx.fillStyle = '#fffdf6'; ctx.fill();
      ctx.save(); ctx.clip(); hatch(ctx, cx - 40, cy - 40, 80, 80, 'rgba(90,90,110,.55)', 5, 1.4); ctx.restore();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; wob(ctx, c, 3, f, true); ctx.stroke();
      for (let i = 0; i < 3; i++) { const a = rot + i * 2.1; wob(ctx, [[cx + Math.cos(a) * 12, cy + Math.sin(a) * 12], [cx + Math.cos(a) * 30, cy + Math.sin(a) * 30]], 2, f + i); ctx.stroke(); }
      line([cx - 14, cy - 12, cx - 4, cy - 7]); line([cx + 14, cy - 12, cx + 4, cy - 7]);
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cx - 8, cy - 4, 3, 0, 7); ctx.arc(cx + 8, cy - 4, 3, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + 14, 8, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      for (let i = 0; i < 3; i++) { wob(ctx, [[x - 8 - i * 10, cy - 10 + i * 10], [x - 22 - i * 10, cy - 10 + i * 10]], 2, f + i); ctx.strokeStyle = 'rgba(35,64,168,.5)'; ctx.stroke(); }
    }
    // chim
    for (const [x, y, dir] of s.bd) {
      const flap = Math.sin(t * 14) * 6;
      ctx.lineWidth = 2; ctx.strokeStyle = C.ink;
      wob(ctx, [[x - 12, y - flap], [x - 4, y], [x, y + 2], [x + 4, y], [x + 12, y - flap]], 1, f); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y + 3, 6, 4, 0, 0, Math.PI * 2); ctx.fillStyle = '#fffdf6'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.ink; ctx.fillRect(x + dir * 3, y + 1, 2, 2);
      ctx.fillStyle = '#e0a800'; ctx.beginPath(); ctx.moveTo(x + dir * 6, y + 2); ctx.lineTo(x + dir * 10, y + 3); ctx.lineTo(x + dir * 6, y + 5); ctx.fill();
    }
    for (const [x, y] of s.pp) { ctx.fillStyle = '#8a5a2e'; ctx.beginPath(); ctx.ellipse(x, y, 4, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    // dây buộc
    if (level.curse === 'rope') {
      const k = scaleK();
      const ps = s.p.filter((p) => !p[4] && !p[5] && !(s.ph === 'dead' && p[0] === s.vic)).sort((a, b) => a[0] - b[0]);
      ctx.strokeStyle = '#8a5a2e'; ctx.lineWidth = 2;
      for (let i = 0; i + 1 < ps.length; i++) {
        const ax = ps[i][1] + PW * k / 2, ay = ps[i][2] + PH * k * 0.6, bx = ps[i + 1][1] + PW * k / 2, by = ps[i + 1][2] + PH * k * 0.6;
        const sag = Math.max(0, 130 - Math.hypot(bx - ax, by - ay)) * 0.4;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag, bx, by); ctx.stroke();
      }
    }
  }

  // ---------- Vẽ: thế giới ----------
  function drawWorld() {
    const s = state;
    const rows = level.rows;
    // sàn giả (giống hệt tường thật)
    level.fakeFloors.forEach(([tx, ty], i) => {
      const st = s.ff[i];
      if (st >= 2) return;
      const j = st >= 1 ? (Math.random() - 0.5) * 4 : 0;
      ctx.save(); ctx.translate(j, j * 0.5);
      drawSolidTile(ctx, tx, ty, Math.floor(boil() / 2.4) % 3 * 13, levelSolidAt);
      ctx.restore();
    });
    // gai ẩn
    level.hidden.forEach(([tx, ty], i) => {
      const up = s.hs[i];
      if (up <= 0) { ctx.fillStyle = 'rgba(35,64,168,.22)'; for (let k = 0; k < 3; k++) ctx.fillRect(tx * T + 7 + k * 8, ty * T + T - 2, 2, 2); return; }
      zigzag(ctx, tx * T, ty * T + T, T, 14 * up, boil() + tx, C.spike);
    });

    // cửa giả trông như đang mở 😈
    for (const [fx, fy] of level.fakeDoors) drawDoor(fx, fy, true);
    const [dx, dy] = level.door;
    drawDoor(dx, dy, s.d);
    const playing = s.p.filter((p) => !p[5]);
    const inside = playing.filter((p) => p[4]).length;
    if (s.d && playing.length) {
      ctx.font = `bold 13px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = C.ink;
      ctx.fillText(`${inside}/${playing.length}`, dx + T / 2, dy - 10);
    }

    // cổng
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c !== 'g' && c !== 'h') continue;
      const col = GATE_COLORS[c];
      if (s.go[c]) {
        ctx.setLineDash([3, 5]);
        wob(ctx, rectPts(x * T + 6, y * T + 1, T - 12, T - 2, 8), 1.5, boil() + y, true);
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      } else {
        dbox(ctx, x * T + 4, y * T, T - 8, T, boil() + y, { hatch: col, gap: 4, lw: 2.2, amp: 1.6 });
      }
    }
    // công tắc
    level.plates.forEach(([x, y, grp], i) => {
      const down = s.pl[i];
      dbox(ctx, x + 5, y + (down ? 3 : -3), T - 10, down ? 5 : 10, boil() + i, { fill: '#fffdf6', hatch: GATE_COLORS[grp], gap: 3, lw: 2, amp: 1.2 });
      wob(ctx, [[x, y + 8], [x + T, y + 8]], 1, boil()); ctx.stroke();
    });

    // thang máy
    for (const [x, y, w, need, riders] of s.e) {
      ctx.setLineDash([2, 6]); wob(ctx, [[x + w / 2, 0], [x + w / 2, y]], 1, 0); ctx.strokeStyle = C.wallTop; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      dbox(ctx, x, y, w, 16, boil(), { fill: '#fffdf6', hatch: C.elev, gap: 5, amp: 1.5 });
      ctx.font = `bold 12px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillStyle = riders >= need ? '#1f7a4a' : C.red;
      ctx.fillText(`▲ ${riders}/${need}`, x + w / 2, y + 12);
    }

    // khối
    for (const [x, y, w, h, need, cnt] of s.b) {
      const f = boil();
      dbox(ctx, x, y, w, h, f, { fill: '#fffdf6', hatch: 'rgba(224,138,60,.55)', gap: 6, width: 2.5 });
      wob(ctx, [[x + 3, y + 3], [x + w / 2, y + h / 2], [x + w - 3, y + h - 3]], 2, f); ctx.stroke();
      wob(ctx, [[x + w - 3, y + 3], [x + w / 2, y + h / 2], [x + 3, y + h - 3]], 2, f + 1); ctx.stroke();
      ctx.fillStyle = '#fffdf6'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 12, 0, 7); ctx.fill();
      ctx.fillStyle = C.red; ctx.font = `900 22px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(String(Math.max(0, need - cnt)), x + w / 2, y + h / 2 + 8);
    }

    drawItems(s);

    // chìa khóa giả & thật
    for (const [x, y, alive] of s.fk) if (alive) drawKey(x, y, 0);
    if (s.k && !s.k[3] && !s.k[2]) drawKey(s.k[0], s.k[1], 0);

    // người chơi
    const t = now();
    const labels = [];
    for (const p of s.p) {
      const [id, x, y, face, entered, waiting, grounded, moving] = p;
      if (entered || waiting) continue;
      if (s.ph === 'dead' && id === s.vic) continue;
      const r = roster.get(id);
      if (!r) continue;
      const v = getVis(id);
      const mood = moodOf(id, v, p);
      const blink = (t % v.blink) < 0.12;
      const k = scaleK();
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
      drawBody(0, 0, r.color, r.acc, face, mood, v.s, { moving, grounded, blink, seed: id * 7 });
      drawStatus(p[8] || 0, face, v);
      ctx.restore();
      // tên
      ctx.font = `bold 11px ${FONT}`; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = C.bg;
      const label = p2 && isMine(id) ? (id === myId ? 'P1 · ' : 'P2 · ') + r.name : r.name;
      const lw = ctx.measureText(label).width;
      let lx = Math.max(camX + lw / 2 + 4, Math.min(camX + VIEW_W - lw / 2 - 4, x + PW * k / 2));
      let ny = y - (r.acc === 6 || r.acc === 4 || r.acc === 0 ? 24 : 12) * k;
      for (let tries = 0; tries < 6 && labels.some((b) => Math.abs(b.x - lx) < (b.w + lw) / 2 + 2 && Math.abs(b.y - ny) < 13); tries++) ny -= 13;
      labels.push({ x: lx, y: ny, w: lw });
      ctx.strokeText(label, lx, ny);
      ctx.fillStyle = isMine(id) ? C.ink : C.wallTop;
      ctx.fillText(label, lx, ny);
      if (v.emoT > 0) drawBubble(x + PW * k / 2, ny - 14, v.emo);
    }
    if (s.k && !s.k[3] && s.k[2]) drawKey(s.k[0], s.k[1], 1);

    // Đổi xác: đánh dấu thân mình đang điều khiển
    for (const who of p2 ? [myId, p2.id] : [myId]) {
      const body = s.p.find((p) => p[9] === who);
      if (body) drawBubble(body[1] + PW * scaleK() / 2, body[2] - 40, p2 ? (who === myId ? 'P1 Ở ĐÂY ↓' : 'P2 Ở ĐÂY ↓') : 'BẠN Ở ĐÂY ↓');
    }

    // Nhắc khi đứng ở cửa
    for (const mine of s.p.filter((p) => isMine(p[0]))) if (mine && !mine[4] && !mine[5] && s.ph === 'play') {
      const [, mx, my] = mine;
      const near = (ddx, ddy) => mx + PW > ddx - 6 && mx < ddx + T + 6 && my + PH > ddy && my < ddy + 2 * T;
      let tip = null;
      if (near(dx, dy)) {
      const downKey = p2 && mine[0] === myId ? 'S' : '↓';
        if (s.d) tip = `${downKey} Nhấn để vào cửa`;
        else tip = s.k && s.k[2] === mine[0] ? 'Chạm vào cửa để mở 🔑' : '🔒 Cửa khóa! Mang chìa khóa tới đây';
      } else if (level.fakeDoors.some(([fx, fy]) => near(fx, fy))) tip = `${p2 && mine[0] === myId ? 'S' : '↓'} Nhấn để vào cửa`;
      if (tip) drawBubble(mx + PW / 2, my - 44, tip);
    }

    // xác bay 🪦
    for (const d of ragdolls) {
      ctx.save();
      ctx.translate(d.x + PW / 2, d.y + PH / 2); ctx.rotate(d.rot); ctx.translate(-PW / 2, -PH / 2);
      drawBody(0, 0, d.color, d.acc, 1, 'dead', 0.1, { noLegs: false });
      ctx.restore();
    }

    // hạt hiệu ứng
    for (const q of particles) {
      const a = q.life / q.max;
      if (q.kind === 'cloud') {
        ctx.globalAlpha = a;
        const sp = []; for (let k = 0; k < 14; k++) { const an = k * 0.7 + q.r * 0.2; sp.push([q.x + Math.cos(an) * (1 + k * q.r / 18), q.y + Math.sin(an) * (1 + k * q.r / 18)]); }
        wob(ctx, sp, 1, boil()); ctx.strokeStyle = C.fart; ctx.lineWidth = 1.6; ctx.stroke();
      } else if (q.kind === 'smoke') {
        ctx.globalAlpha = a;
        const cp = []; for (let k = 0; k <= 10; k++) cp.push([q.x + Math.cos(k / 10 * 6.3) * q.r, q.y + Math.sin(k / 10 * 6.3) * q.r]);
        wob(ctx, cp, 2, boil()); ctx.strokeStyle = '#8a8a9a'; ctx.lineWidth = 1.5; ctx.stroke();
      } else {
        if (q.kind === 'fire') continue;
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillStyle = q.color; ctx.fillRect(-4, -2, 8, 4); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    for (const d of debris) {
      ctx.save(); ctx.translate(d.x + 8, d.y + 8); ctx.rotate(d.r);
      dbox(ctx, -8, -8, 16, 16, boil(), { hatch: C.wall, gap: 5, amp: 1.5 }); ctx.restore();
    }
    for (const tx of texts) {
      ctx.globalAlpha = Math.min(1, tx.life / 25);
      ctx.font = `900 ${tx.size}px ${FONT}`; ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = C.bg; ctx.strokeText(tx.text, tx.x, tx.y);
      ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  }

  function updateFx() {
    for (const v of vis.values()) {
      if (v.fartT > 0) v.fartT--;
      if (v.fartedT > 0) v.fartedT--;
      if (v.emoT > 0) v.emoT--;
      if (v.stealT > 0) v.stealT--;
      // lò xo thạch: kéo dài khi bay lên, bẹp khi rơi
      const target = v.g ? 0 : Math.max(-0.12, Math.min(0.16, -v.vy * 0.018));
      v.sv += (target - v.s) * 0.22; v.sv *= 0.78; v.s += v.sv;
    }
    for (const q of particles) {
      q.x += q.vx; q.y += q.vy; q.life--;
      if (q.kind === 'confetti') { q.vy += 0.25; q.vx *= 0.98; q.rot += q.vr; }
      else { q.vx *= 0.95; q.vy *= 0.95; q.r += 0.35; }
    }
    particles = particles.filter((q) => q.life > 0);
    for (const tx of texts) { tx.y -= 0.6; tx.life--; }
    texts = texts.filter((t) => t.life > 0);
    for (const d of ragdolls) { d.x += d.vx; d.y += d.vy; d.vy += 0.45; d.rot += d.vr; }
    ragdolls = ragdolls.filter((d) => d.y < 1200);
    for (const d of debris) { d.x += d.vx; d.y += d.vy; d.vy += 0.5; d.r += d.vr; d.life--; }
    debris = debris.filter((d) => d.life > 0);
    if (shake > 0) shake *= 0.88;
    if (shake < 0.3) shake = 0;
  }

  // Bảng tội đồ: tờ giấy note vàng dán băng keo, viết bút bi, đếm tội bằng vạch kiểu "nhốt tù"
  function drawShameNote(sw, sinners) {
    const f = boil();
    // Đo tên dài nhất + vạch đếm để tờ note đủ rộng (tối đa 360, quá thì thu nhỏ chữ)
    const tallyW = (p) => (p.deaths > 15 ? 44 : Math.ceil(p.deaths / 5) * 22);
    ctx.font = `bold 14px ${FONT}`;
    const need = Math.max(...sinners.map((p) => ctx.measureText(p.name).width + tallyW(p)));
    const W = Math.min(360, Math.max(208, Math.ceil(need) + 66));
    const nameMax = (p) => W - 66 - tallyW(p);
    const rowH = 26, H = 50 + sinners.length * rowH + 8;
    const x = sw - W - 18, y = 66;
    ctx.save();
    ctx.translate(x + W / 2, y); ctx.rotate(0.045); ctx.translate(-W / 2, 0);
    // giấy + bóng + góc quăn
    const paper = [[0, 0], [W * 0.5, 2], [W, 0], [W, H - 18], [W - 18, H], [W * 0.4, H + 1], [0, H]];
    ctx.save(); ctx.translate(3, 4); wob(ctx, paper, 1.5, 0, true); ctx.fillStyle = 'rgba(35,64,168,.12)'; ctx.fill(); ctx.restore();
    wob(ctx, paper, 1.5, f, true); ctx.fillStyle = '#fff3a0'; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(176,139,0,.7)'; ctx.stroke();
    wob(ctx, [[W, H - 18], [W - 14, H - 14], [W - 18, H]], 1, f, true); ctx.fillStyle = '#e8d470'; ctx.fill(); ctx.stroke();
    // dòng kẻ mờ trên giấy note
    ctx.strokeStyle = 'rgba(80,130,210,.25)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < sinners.length; i++) { const ly = 50 + (i + 1) * rowH - 4; ctx.moveTo(8, ly); ctx.lineTo(W - 12, ly); }
    ctx.stroke();
    // băng keo
    ctx.save(); ctx.translate(W / 2, -2); ctx.rotate(-0.08);
    wob(ctx, [[-34, -8], [34, -8], [36, 0], [34, 8], [-34, 8], [-36, 0]], 1.2, f, true);
    ctx.fillStyle = 'rgba(210,225,240,.7)'; ctx.fill(); ctx.strokeStyle = 'rgba(120,140,170,.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    // tiêu đề bút đỏ, gạch chân 2 lần + đầu lâu vẽ tay
    ctx.textAlign = 'left'; ctx.font = `900 16px ${FONT}`; ctx.fillStyle = C.red;
    ctx.fillText('BẢNG TỘI ĐỒ', 38, 28);
    const tw = ctx.measureText('BẢNG TỘI ĐỒ').width;
    ctx.strokeStyle = C.red; ctx.lineWidth = 1.8;
    wob(ctx, [[36, 34], [36 + tw * 0.5, 35], [40 + tw, 33]], 1.5, f); ctx.stroke();
    wob(ctx, [[40, 38], [38 + tw * 0.6, 39], [36 + tw, 38]], 1.5, f + 1); ctx.stroke();
    const sk = []; for (let i = 0; i <= 10; i++) sk.push([20 + Math.cos(i / 10 * 6.3) * 9, 22 + Math.sin(i / 10 * 6.3) * 8]);
    wob(ctx, sk, 1.2, f); ctx.fillStyle = '#fffdf6'; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.stroke();
    line([15, 19, 19, 23]); line([19, 19, 15, 23]); line([21, 19, 25, 23]); line([25, 19, 21, 23]);
    line([16, 29, 18, 27, 20, 29, 22, 27, 24, 29], 1.2);

    sinners.forEach((p, i) => {
      const ry = 50 + i * rowH + 16;
      // nhân vật mini tô gạch chéo
      ctx.save(); ctx.beginPath(); ctx.ellipse(18, ry - 5, 8, 7.5, 0, 0, Math.PI * 2); ctx.clip();
      hatch(ctx, 8, ry - 14, 20, 18, p.color, 3, 2.2); ctx.restore();
      ctx.beginPath(); ctx.ellipse(18, ry - 5, 8, 7.5, 0, 0, Math.PI * 2); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = C.ink; ctx.fillRect(15, ry - 7, 1.8, 1.8); ctx.fillRect(20, ry - 7, 1.8, 1.8);
      // tên
      ctx.fillStyle = C.ink; ctx.textAlign = 'left';
      let fs = 14;
      do { ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px ${FONT}`; } while (ctx.measureText(p.name).width > nameMax(p) && --fs > 9);
      ctx.fillText(p.name, 32, ry, nameMax(p));
      const nw = Math.min(ctx.measureText(p.name).width, nameMax(p));
      // vạch đếm tội: 4 vạch đứng + 1 gạch chéo
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.8;
      const tx0 = W - 14;
      if (p.deaths > 15) { ctx.textAlign = 'right'; ctx.fillStyle = C.red; ctx.font = `900 15px ${FONT}`; ctx.fillText(`×${p.deaths}`, tx0, ry); }
      else {
        const groups = Math.ceil(p.deaths / 5);
        let gx = tx0 - groups * 22 + 4;
        for (let g = 0; g < groups; g++, gx += 22) {
          const n = Math.min(5, p.deaths - g * 5);
          for (let k = 0; k < Math.min(4, n); k++) { wob(ctx, [[gx + k * 4, ry - 12], [gx + k * 4 + 0.5, ry + 1]], 1, f + g * 5 + k); ctx.stroke(); }
          if (n === 5) { wob(ctx, [[gx - 3, ry - 2], [gx + 16, ry - 10]], 1, f + g); ctx.stroke(); }
        }
      }
      // trùm báo: khoanh đỏ + vương miện + chú thích
      if (i === 0 && (sinners.length > 1 || p.deaths > 1)) {
        const ring = []; for (let k = 0; k <= 16; k++) { const a = k / 16 * 6.6 - 0.2; ring.push([32 + nw / 2 + Math.cos(a) * (nw / 2 + 8), ry - 5 + Math.sin(a) * 12]); }
        wob(ctx, ring, 1.8, f); ctx.strokeStyle = C.red; ctx.lineWidth = 1.6; ctx.stroke();
        wob(ctx, [[11, ry - 13], [13, ry - 19], [16, ry - 14], [18, ry - 20], [20, ry - 14], [23, ry - 19], [25, ry - 13]], 0.8, f);
        ctx.fillStyle = 'rgba(255,201,60,.8)'; ctx.fill(); ctx.strokeStyle = '#b08b00'; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.save(); ctx.translate(W - 4, H + 14); ctx.rotate(-0.12);
        ctx.font = `bold 12px ${FONT}`; ctx.fillStyle = C.red; ctx.textAlign = 'right';
        ctx.fillText('↖ trùm báo team', 0, 0); ctx.restore();
      }
    });
    ctx.restore();
  }

  function drawHud(sw, sh) {
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.font = `bold 20px ${FONT}`;
    const tag = level.generated ? ' 🤖' : `/${level.total}`;
    ctx.fillText(`Màn ${level.idx + 1}${tag}: ${level.name}`, 16, 30);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.wallTop;
    ctx.fillText(level.hint, 16, 52);
    const me = state.p.find((p) => p[0] === myId);
    ctx.fillStyle = C.ink; ctx.font = `bold 15px ${FONT}`;
    if (me && me[5]) ctx.fillText('Bạn sẽ vào chơi từ lượt sau (nhấn R để cả đội chơi lại màn).', 16, 76);
    else if (me && me[4]) {
      const left = state.p.filter((p) => !p[5] && !p[4]).length;
      ctx.fillText(`Bạn đã vào cửa (↓ để ra lại). Còn ${left} người chưa vào...`, 16, 76);
    } else {
      // Mục tiêu hiện tại
      ctx.font = `bold 14px ${FONT}`;
      const goal = !state.d
        ? (state.k && state.k[2] ? '🎯 Mang chìa khóa tới cửa thật để mở' : '🎯 Tìm chìa khóa 🔑 (cẩn thận chìa giả)')
        : '🎯 Cửa đã mở! TẤT CẢ đứng ở cửa và nhấn ↓';
      ctx.fillText(goal, 16, 76);
    }

    if (level.curse) {
      ctx.textAlign = 'left'; ctx.fillStyle = C.red; ctx.font = `bold 14px ${FONT}`;
      ctx.fillText(`☠ Lời nguyền: ${level.curseName}`, 16, 98);
    }
    if (state.p.some((p) => p[9])) {
      const b = state.p.find((p) => p[9] === myId), r = b && roster.get(b[0]);
      ctx.textAlign = 'left'; ctx.fillStyle = C.red; ctx.font = `bold 16px ${FONT}`;
      ctx.fillText(r ? `🔀 ĐỔI XÁC! Bạn đang điều khiển: ${r.name}` : '🔀 ĐỔI XÁC!', 16, 122);
    }
    if (curseUntil > now() && state.ph === 'play') {
      const a = Math.min(1, (curseUntil - now()) / 0.6);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(sw / 2, sh * 0.32); ctx.rotate(-0.04);
      ctx.textAlign = 'center'; ctx.font = `900 22px ${FONT}`; ctx.fillStyle = C.ink; ctx.fillText('Lời nguyền của màn này:', 0, -18);
      ctx.font = `900 34px ${FONT}`; ctx.lineWidth = 6; ctx.strokeStyle = C.bg; ctx.strokeText(level.curseName, 0, 22);
      ctx.fillStyle = C.red; ctx.fillText(level.curseName, 0, 22); ctx.restore();
    }

    // Bảng tội đồ
    const sinners = [...roster.values()].filter((p) => p.deaths > 0).sort((a, b) => b.deaths - a.deaths).slice(0, 5);
    if (sinners.length) drawShameNote(sw, sinners);

    if (state.ph !== 'play' && state.msg) {
      const big = state.ph === 'clear';
      if (state.ph === 'vote') { ctx.save(); ctx.translate(0, -120); }
      const tilt = Math.sin(now() * 6) * 0.03;
      ctx.save();
      ctx.translate(sw / 2, sh / 2); ctx.rotate(tilt);
      const tear = []; for (let i = 0; i <= 40; i++) tear.push([-sw / 2 + 30 + i * (sw - 60) / 40, -44 + (i % 2) * 5]);
      for (let i = 40; i >= 0; i--) tear.push([-sw / 2 + 30 + i * (sw - 60) / 40, 44 - (i % 2) * 5]);
      wob(ctx, tear, 1.5, boil(), true); ctx.fillStyle = '#fffdf6'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = big ? '#1f7a4a' : C.red;
      ctx.font = `900 ${big ? 32 : 28}px ${FONT}`;
      ctx.fillText(state.msg, 0, 11);
      ctx.restore();
      if (state.ph === 'vote') ctx.restore();
    }
  }

  function drawSun() {
    const x = VIEW_W - 70, y = 120, f = boil();
    const c = []; for (let k = 0; k <= 14; k++) c.push([x + Math.cos(k / 14 * 6.3) * 20, y + Math.sin(k / 14 * 6.3) * 20]);
    wob(ctx, c, 2, f); ctx.fillStyle = 'rgba(255,201,60,.35)'; ctx.fill(); ctx.strokeStyle = '#e0a800'; ctx.lineWidth = 2; ctx.stroke();
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * 6.3 + now() * 0.3;
      wob(ctx, [[x + Math.cos(a) * 26, y + Math.sin(a) * 26], [x + Math.cos(a) * 36, y + Math.sin(a) * 36]], 1.5, f + k); ctx.stroke();
    }
    ctx.fillStyle = '#e0a800'; ctx.fillRect(x - 8, y - 5, 4, 4); ctx.fillRect(x + 4, y - 5, 4, 4);
    ctx.beginPath(); ctx.arc(x, y + 3, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }

  function frame() {
    requestAnimationFrame(frame);
    const dpr = window.devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (!level || !state || phase === 'lobby') return;
    updateFx();

    const scale = Math.min(W / VIEW_W, H / VIEW_H);
    const ox = (W - VIEW_W * scale) / 2, oy = (H - VIEW_H * scale) / 2;
    camX += (state.cam - camX) * 0.18;
    if (Math.abs(state.cam - camX) > 400) camX = state.cam;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;

    ctx.save();
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.rect(0, 0, VIEW_W, VIEW_H); ctx.clip();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawSun();
    ctx.translate(-Math.round(camX) + sx, sy);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    const gx0 = Math.floor(camX / 16) * 16;
    for (let x = gx0; x < camX + VIEW_W + 16; x += 16) { ctx.moveTo(x, 0); ctx.lineTo(x, VIEW_H); }
    for (let y = 16; y < VIEW_H; y += 16) { ctx.moveTo(gx0, y); ctx.lineTo(camX + VIEW_W + 16, y); }
    ctx.stroke();
    ctx.strokeStyle = C.margin; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(44, VIEW_H); ctx.stroke();
    // mây vẽ tay (trôi chậm hơn)
    for (let i = 0; i < 30; i++) {
      const cx = i * 300 + camX * 0.5 + 90, cy = 70 + (i * 37) % 110;
      if (cx < camX - 120 || cx > camX + VIEW_W + 20) continue;
      const pts = []; for (let k = 0; k <= 16; k++) { const a = k / 16 * 6.3; pts.push([cx + 45 + Math.cos(a) * 45, cy + Math.sin(a) * 13 - Math.abs(Math.sin(a * 3)) * 6]); }
      wob(ctx, pts, 2, boil() + i, true); ctx.strokeStyle = 'rgba(35,64,168,.4)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.drawImage(levelCanvases[Math.floor(now() * 3) % 3] || levelCanvas, 0, 0);
    drawWorld();
    ctx.restore();

    ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
    drawHud(VIEW_W, VIEW_H);
    ctx.restore();
  }
  requestAnimationFrame(frame);
})();
