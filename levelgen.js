// Bộ sinh màn ngẫu nhiên vô hạn.
// Màn được ghép từ các "đoạn" đã biết chắc là vượt qua được (với 2+ người),
// nối nhau từ trái sang phải. `g` là hàng mặt đất hiện tại (ô đất trên cùng).
const H = 17;

const NAME_A = ['Thung lũng', 'Hẻm núi', 'Đồi', 'Cầu', 'Mê cung', 'Ngõ', 'Lâu đài', 'Khu chợ', 'Sân sau', 'Hang',
  'Công viên', 'Ký túc xá'];
const NAME_B = ['Xì Hơi', 'Cú Lừa', 'Nước Mắt', 'Tình Bạn Tan Vỡ', 'Ai Cũng Chết', 'Không Lối Thoát', 'Đạp Đầu Nhau',
  'Lật Kèo', 'Báo Thủ', 'Trầm Cảm', 'Gai Góc', 'Chìa Khóa Đâu', 'Đổ Lỗi'];
const HINTS = ['Màn này do máy tự nghĩ ra. Máy cũng không chắc.', 'Nếu chết, hãy đổ lỗi cho đứa gần nhất.',
  'Đừng tin sàn. Đừng tin cửa. Tin bạn bè (một chút).', 'Đoạn này dễ lắm. Đùa đấy.',
  'Mỗi lần chết là một lần trưởng thành. Team bạn sắp trưởng thành lắm rồi.', 'Đứa nào xì hơi thì tự giác nhận.',
  'Lạc đường? Đi sang phải.', 'Cửa thật thường là cái xấu nhất.'];

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

function generate(depth) {
  const cols = []; // mỗi cột là mảng 17 ký tự
  const blocks = [], elevators = [], boulders = [];
  let g = rnd(13, 16);
  let gateIdx = 0;

  const newCol = (ground = true) => {
    const c = Array(H).fill('.');
    if (ground) for (let y = g; y < H; y++) c[y] = '#';
    cols.push(c);
    return cols.length - 1;
  };
  const set = (x, y, ch) => { if (x >= 0 && x < cols.length && y >= 0 && y < H) cols[x][y] = ch; };
  const flat = (n) => { let x; for (let i = 0; i < n; i++) x = newCol(); return x; };

  const seg = {
    wall2() { flat(2); const x = newCol(); newCol(); for (const c of [x, x + 1]) { set(c, g - 1, '#'); set(c, g - 2, '#'); } flat(2); },
    stepUp() { if (g <= 10) return seg.stepDown(); g -= rnd(1, 2); flat(rnd(3, 5)); },
    stepDown() { if (g >= 16) return seg.stepUp(); g = Math.min(16, g + rnd(1, 3)); flat(rnd(3, 5)); },
    pit() { flat(2); for (let i = rnd(2, 3); i > 0; i--) newCol(false); flat(2); },
    spikes() { flat(2); for (let i = rnd(2, 3); i > 0; i--) set(newCol(), g - 1, '^'); flat(2); },
    platform(withKey) {
      flat(2);
      const w = rnd(3, 5), x0 = cols.length;
      for (let i = 0; i < w; i++) { const x = newCol(); set(x, g - 3, '#'); }
      if (withKey) set(x0 + Math.floor(w / 2), g - 4, 'K');
      flat(2);
    },
    gate() {
      const [gc, pc] = gateIdx++ % 2 === 0 ? ['g', 'p'] : ['h', 'q'];
      flat(1); set(newCol(), g - 1, pc); flat(2);
      const x = newCol();
      for (let y = 0; y < g; y++) set(x, y, y >= g - 6 ? gc : '#');
      flat(2); set(newCol(), g - 1, pc); flat(2);
    },
    block() {
      if (g < 13) return seg.stepUp();
      flat(1);
      const x = newCol(); newCol();
      set(x, g - 2, 'B'); blocks.push({ w: 2, h: 2, need: 'all' });
      flat(rnd(4, 7));
      g -= 4; flat(rnd(4, 6));
    },
    elevator() {
      if (g < 13) return seg.stepDown();
      flat(1);
      const x = newCol(); newCol(); newCol(); newCol();
      const to = Math.max(8, g - rnd(4, 7));
      set(x, g - 1, 'E'); elevators.push({ w: 4, toRow: to, need: 'all', at: [x, g - 1] });
      g = to; flat(rnd(4, 6));
    },
    fakeBridge() {
      if (g < 12) return seg.stepDown();
      flat(2);
      for (let i = 0; i < 3; i++) { const x = newCol(false); set(x, g, 'x'); }
      flat(2);
    },
    hidden() { flat(rnd(2, 4)); for (let i = rnd(1, 2); i > 0; i--) set(newCol(), g - 1, 'v'); flat(2); },
    fakeKey() { flat(2); set(newCol(), g - 1, 'k'); flat(rnd(6, 9)); },
    fakeDoor() { flat(2); set(newCol(), g - 1, 'F'); flat(3); },
    // lò xo bật qua tường cao 5 ô
    spring() {
      if (g < 14) return seg.stepDown();
      flat(1); set(newCol(), g - 1, 'j'); flat(1);
      const x = newCol(); newCol();
      for (const c of [x, x + 1]) for (let y = g - 5; y < g; y++) set(c, y, '#');
      flat(3);
    },
    banana() { flat(3); set(newCol(), g - 1, 'n'); flat(rnd(3, 5)); },
    chili() { flat(2); set(newCol(), g - 1, 'o'); flat(rnd(6, 9)); },
    // đá lăn đuổi: một đoạn chạy dài chỉ có chướng ngại nhảy qua được
    chase() {
      flat(2);
      const x0 = newCol(); set(x0, g - 1, 'O');
      flat(6); seg.pit(); flat(3); seg.spikes(); flat(3); seg.wall2(); flat(4);
      boulders.push({ at: [x0, g - 1], endCol: cols.length - 1 });
      flat(2);
    },
  };

  // Mở đầu: đủ chỗ cho 8 người đứng
  flat(12); set(2, g - 1, 'S');

  const n = Math.min(4 + depth, 16);
  const trollP = Math.min(0.15 + depth * 0.04, 0.45);
  const normal = ['wall2', 'stepUp', 'stepDown', 'pit', 'spikes', 'platform', 'gate', 'block', 'elevator'];
  const trolls = ['fakeBridge', 'hidden', 'fakeKey', 'fakeDoor', 'spring', 'banana', 'chili', 'chase'];
  const keyAt = rnd(1, n - 1);
  for (let i = 0; i < n; i++) {
    if (i === keyAt) seg.platform(true);
    const s = chance(trollP) ? pick(trolls) : pick(normal);
    if (s === 'platform') seg.platform(false); else seg[s]();
  }
  if (chance(trollP)) seg.fakeDoor();
  flat(4); set(newCol(), g - 1, 'D'); flat(4);

  const rows = [];
  for (let y = 0; y < H; y++) rows.push(cols.map((c) => c[y]).join(''));
  return {
    name: `${pick(NAME_A)} ${pick(NAME_B)}`,
    hint: pick(HINTS),
    rows, blocks, elevators, boulders, generated: true,
  };
}

module.exports = { generate };
