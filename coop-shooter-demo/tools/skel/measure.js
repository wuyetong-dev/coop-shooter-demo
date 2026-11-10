/* 立绘骨骼量测：从 alpha 形状自动求出髋 / 膝 / 踝（左右两条腿）+ 颈 + 脚底。
   不靠肉眼读网格 —— 网格判读会偏 20px（主角那次偏得整条骨架跑到两腿中间）。
   人工只补一个数：胯的搜索上限 hipMax（裙子长的时候要往下压）。

   用法：node tools/skel/measure.js art/hero_hold.png art/v2/hold_cut.png ...
         → 打印 JSON，粘进 art/skel/_skel.json
*/
const fs = require('fs'), path = require('path');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '../..');

const ALPHA = 128;

function segsOf(mask, gap) {
  const out = [];
  let s = -1, last = -1;
  for (let x = 0; x < mask.length; x++) {
    if (mask[x]) {
      if (s < 0) s = x;
      last = x;
    } else if (s >= 0 && x - last > gap) {
      out.push([s, last]); s = -1;
    }
  }
  if (s >= 0) out.push([s, last]);
  return out;
}

async function measure(file, opt) {
  const img = await loadImage(path.join(ROOT, file));
  const cv = createCanvas(img.width, img.height);
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const W = img.width, H = img.height;
  const rows = [];
  for (let y = 0; y < H; y++) {
    const m = new Uint8Array(W);
    let any = false;
    for (let x = 0; x < W; x++) { if (d[(y * W + x) * 4 + 3] > ALPHA) { m[x] = 1; any = true; } }
    rows.push(any ? segsOf(m, opt.gap || 3) : []);
  }

  let bot = -1;
  for (let y = H - 1; y >= 0; y--) if (rows[y].length) { bot = y; break; }
  let top = 0;
  for (let y = 0; y < H; y++) if (rows[y].length) { top = y; break; }

  /* 胯：从脚底往上扫，最后一行「还是两段」就是胯（再往上并成一段 = 躯干）。
     hipFloor 是搜索下限（y 更小 = 更高）。长裙 / 高腰要往下压。 */
  const hipFloor = opt.hipFloor === undefined ? Math.max(top, bot - Math.round(H * 0.55)) : opt.hipFloor;
  let forkY = -1, miss = 0;
  for (let y = bot - 2; y >= hipFloor; y--) {
    if (rows[y].length >= 2) { forkY = y; miss = 0; }
    else if (forkY > 0 && ++miss >= 5) break;
  }
  if (forkY < 0) return { file, error: '找不到两腿分开的行（长裙 / 双腿并拢）', bot, top };
  /* 取胯前 3 行作为「腿根」行，读段中心 */
  const hipRow = rows[forkY];
  if (!hipRow || hipRow.length < 2) return { file, error: '胯行不是两段', bot, top, forkY };

  /* 左段 = 后腿（画面上靠 x 小的一侧），右段 = 前腿 */
  const order = hipRow.slice().sort((a, b) => a[0] - b[0]);
  const feetRow = rows[bot - 2].length >= 2 ? rows[bot - 2] : rows[bot - 4];
  const feet = feetRow.slice().sort((a, b) => a[0] - b[0]);

  const legs = {};
  const keys = ['back', 'front'];
  for (let i = 0; i < 2; i++) {
    const hp = order[i], ft = feet[Math.min(i, feet.length - 1)];
    const hx = (hp[0] + hp[1]) / 2, hy = forkY + 2;
    const ax = (ft[0] + ft[1]) / 2, ay = bot - 3;
    legs[keys[i]] = {
      hip: [r1(hx), r1(hy)], ank: [r1(ax), r1(ay)],
      knee: [r1(hx + (ax - hx) * 0.52), r1(hy + (ay - hy) * 0.55)]
    };
  }
  return { file, W, H, top, bot, forkY, legs,
    widths: { hipRow: hipRow, feetRow: feetRow } };
}
function r1(v) { return Math.round(v * 10) / 10; }

(async () => {
  const files = process.argv.slice(2);
  const out = {};
  for (const f of files) {
    const o = { gap: 3 };
    if (/whale|hold_cut/.test(f)) o.hipFloor = 150;
    const m = await measure(f, o);
    out[f] = m;
    console.log('---', f);
    console.log(JSON.stringify(m.legs || m, null, 1));
  }
  console.log('\n=== JSON ===');
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
