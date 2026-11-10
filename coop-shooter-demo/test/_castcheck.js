/* 单个 AI 娘的立绘体检：旧版 / 新版 / 参考图 三列并排，
   上排是 192px 游戏内实际尺寸，下排是 ×4 放大（头到膝）。

   为什么单独一个脚本而不是每次现拼 node -e：
   后面还有 4 个人要出（格克 / 奇米 / 知源 / 双子），每次都现拼一段
   200 行的 drawImage 会写歪，而且排版 bug（文字压在一起、画布算少被切）
   上一轮已经踩过两次。做成工具，一次写对。

   用法：node test/_castcheck.js <id> <新图文件名>
     id  : gpt / grok / kimi / glm / gemini
     旧版：art/cast/_old/<id>-v1.png
     参考：art/ref/<id>.jpg
     新版：art/cast/<新图文件名>
   → shots/check-<id>.png
*/
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const OUT = path.join(__dirname, '..', 'shots');
const ART = path.join(__dirname, '..', 'art');
const H = 192;

const META = {
  gpt: { name: '枢机', oldTag: '奶白发・小天使翼・金瞳', newTag: '白龙娘・龙角龙翼龙尾' },
  grok: { name: '格克', oldTag: '旧版', newTag: '哥特战姬・金刺冠・花瓣摆' },
  kimi: { name: '奇米', oldTag: '旧版', newTag: '银白长发・月牙・长笛' },
  glm: { name: '知源', oldTag: '旧版', newTag: '狐耳・巨尾・Z 手册' },
  gemini: { name: '双子', oldTag: '旧版', newTag: '四角星・双色瞳・猫尾' }
};

/* 白底抠图：四边漫水填充。不能按颜色删白 —— 白裙、白龙翼也是白的。 */
function cutWhite(img) {
  const c = createCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, img.width, img.height), d = id.data;
  const W = img.width, Hh = img.height, seen = new Uint8Array(W * Hh), st = [];
  const isW = i => d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232;
  for (let x = 0; x < W; x++) { st.push(x); st.push((Hh - 1) * W + x); }
  for (let y = 0; y < Hh; y++) { st.push(y * W); st.push(y * W + W - 1); }
  while (st.length) {
    const p = st.pop(); if (seen[p]) continue; seen[p] = 1;
    const i = p * 4; if (!isW(i)) continue; d[i + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1);
    if (y > 0) st.push(p - W); if (y < Hh - 1) st.push(p + W);
  }
  g.putImageData(id, 0, 0); return c;
}
function bbox(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] < 24) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function norm(img) {
  const c = cutWhite(img), bb = bbox(c);
  const k = H / bb.h, w = Math.round(bb.w * k);
  const o = createCanvas(w, H), g = o.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, bb.x, bb.y, bb.w, bb.h, 0, 0, w, H);
  return { canvas: o, w, h: H };
}

(async () => {
  const id = process.argv[2];
  const newFile = process.argv[3];
  if (!id || !newFile) {
    console.error('用法：node test/_castcheck.js <id> <新图文件名>');
    process.exit(1);
  }
  const m = META[id] || { name: id, oldTag: '旧版', newTag: '新版' };
  const list = [
    { f: path.join(ART, 'cast', '_old', id + '-v1.png'), name: '旧版', tag: m.oldTag, col: '#8aa0b4' },
    { f: path.join(ART, 'cast', newFile), name: '新版', tag: m.newTag, col: '#7ee0a0' },
    { f: path.join(ART, 'ref', id + '.jpg'), name: '参考图', tag: '插画（不可直接用）', col: '#ffc857' }
  ];
  for (const it of list) {
    if (!fs.existsSync(it.f)) { console.error('缺文件：' + it.f); process.exit(1); }
    Object.assign(it, norm(await loadImage(it.f)));
  }

  const PAD = 24, CW = 210, ZOOM = 4;
  const W = PAD * 2 + CW * 3;
  const R1 = 80, R2 = R1 + H + 62;
  /* 行高跟着实际画出来的高度走。固定 H2 时列宽成了瓶颈（104 宽的 sprite
     只能放大 1.86 倍），下面留一大片死白，反而看不清细节。 */
  const Y0 = Math.round(H * 0.02), Y1 = Math.round(H * 0.72), SRC_H = Y1 - Y0;
  let Z = ZOOM;
  for (const it of list) Z = Math.min(Z, (CW - 16) / it.w);
  const H2 = Math.round(SRC_H * Z) + 10;
  const R3 = R2 + H2 + 62, Z3 = 4, H3 = H * Z3;
  const canvas = createCanvas(W, R3 + H3 + 34);
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b1117'; g.fillRect(0, 0, W, canvas.height);
  const T = (s, x, y, sz, c, b, ct) => {
    g.fillStyle = c || '#9fb3c6';
    g.font = (b ? 'bold ' : '') + sz + 'px "Microsoft YaHei",sans-serif';
    g.textBaseline = 'top'; g.textAlign = ct ? 'center' : 'left';
    g.fillText(s, x, y); g.textAlign = 'left';
  };

  T(m.name + '　立绘体检：192px 游戏内尺寸下还认不认得出', PAD, 14, 17, '#7ee0a0', true);
  T('第一排＝游戏内实际尺寸（深底模拟关卡）　第二排＝头到膝放大　第三排＝新版全身 ×4', PAD, 40, 12, '#7c8b99');

  for (let i = 0; i < 3; i++) {
    const it = list[i], cx = PAD + CW * i + CW / 2, x0 = PAD + CW * i + 6;
    g.fillStyle = '#0d1620'; g.fillRect(x0, R1, CW - 12, H);
    g.drawImage(it.canvas, Math.round(cx - it.w / 2), R1 + H - it.h);
    T(it.name, cx, R1 + H + 10, 15, '#e6eef7', true, true);
    T(it.tag, cx, R1 + H + 30, 11, it.col, false, true);
    T(it.w + '×' + it.h + '　宽 ' + Math.round(it.w / it.h * 100) + '%', cx, R1 + H + 46, 11, '#6f8296', false, true);

    const dh = Math.round(SRC_H * Z), dw = Math.round(it.w * Z);
    g.fillStyle = '#0d1620'; g.fillRect(x0, R2, CW - 12, H2);
    g.save();
    g.beginPath(); g.rect(x0, R2, CW - 12, H2); g.clip();
    g.imageSmoothingEnabled = false;
    g.drawImage(it.canvas, 0, Y0, it.w, SRC_H, Math.round(cx - dw / 2), R2 + 4, dw, dh);
    g.restore();
  }
  T('头到膝放大 ×' + Z.toFixed(2), PAD, R2 + H2 + 6, 12, '#6f8296');

  /* 第三排：新版全身 ×4，横跨整个画布。第二排被列宽限死了，
     全身轮廓和腿脚站位只能在这一排看。 */
  const nw = list[1];
  const cxn = W / 2;
  g.fillStyle = '#0d1620';
  g.fillRect(PAD, R3, W - PAD * 2, H3);
  g.imageSmoothingEnabled = false;
  g.drawImage(nw.canvas, Math.round(cxn - nw.w * Z3 / 2), R3, nw.w * Z3, H3);
  g.imageSmoothingEnabled = true;
  T('新版全身 ×' + Z3 + '（看剪影和腿脚站位）', PAD, R3 + H3 + 6, 12, '#6f8296');

  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, 'check-' + id + '.png');
  fs.writeFileSync(out, await canvas.encode('png'));
  console.log('\n占位（192px 高）：');
  for (const it of list) console.log('  ' + it.name.padEnd(6) + it.w + '×' + it.h + '　宽 ' + Math.round(it.w / it.h * 100) + '%　' + it.tag);
  console.log('\n✓ ' + out);
})();
