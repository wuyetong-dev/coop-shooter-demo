/* 衣服细节体检：把「旧版 sprite / 新版 sprite / 参考图」压到游戏尺寸并排，
   再各放大 4 倍看衣服还剩几层。

   这里**刻意不设自动指标**。试过两个，都不可用：
   - 「色阶数」（量化到 16 级后数不重复颜色）：v2=247 / v3=263，只差 6%，
     但肉眼一看差一个量级 —— 它量的是抗锯齿的中间色，不是结构。
   - 「竖扫描色带数」（沿竖线数颜色跳变）：v2=19 / v3=22 / 参考图=16，
     参考图反而最低 —— 头发和刺绣的纹理把跳变刷爆了。
   衣服的"层"是结构关系（谁压在谁上面、有几道边），不是像素统计能抓的。
   所以判据就是人眼：能不能数出蕾丝领 / 灯笼袖 / 束腰金链 / 三层衬裙 / 橙色垂布。
   留一个测不准的数字，比留空更糟。

   用法：node test/_detail.js
   → shots/detail-check.png */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const OUT = path.join(__dirname, '..', 'shots');
const ART = path.join(__dirname, '..', 'art');
const H = 192;

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
  const list = [
    { f: path.join(ART, 'cast', '_old', 'claude-v2.png'), name: 'v2 旧版', tag: '纯色黑裙＋白围裙', col: '#8aa0b4' },
    { f: path.join(ART, 'cast', 'claude.png'), name: 'v3 现役', tag: '十二层黑金', col: '#ff9a4c' },
    { f: path.join(ART, 'ref', 'claude.jpg'), name: '参考图', tag: '插画（不可直接用）', col: '#ffc857' }
  ];
  for (const it of list) Object.assign(it, norm(await loadImage(it.f)));

  const PAD = 20, CW = 200, ZOOM = 4;
  const W = PAD * 2 + CW * 3;
  const R1 = 74, R2 = R1 + H + 56, H2 = 420;
  const canvas = createCanvas(W, R2 + H2 + 46);
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b1117'; g.fillRect(0, 0, W, canvas.height);
  const T = (s, x, y, sz, c, b, ct) => {
    g.fillStyle = c || '#9fb3c6';
    g.font = (b ? 'bold ' : '') + sz + 'px "Microsoft YaHei",sans-serif';
    g.textBaseline = 'top'; g.textAlign = ct ? 'center' : 'left';
    g.fillText(s, x, y); g.textAlign = 'left';
  };

  T('小克衣服细节体检：同一角色压到 192px 高，衣服还剩几层', PAD, 12, 16, '#7ee0a0', true);
  T('上排＝游戏内实际尺寸　下排＝衣服区域放大 4 倍（只取肩到膝）', PAD, 36, 12, '#7c8b99');

  for (let i = 0; i < 3; i++) {
    const it = list[i], cx = PAD + CW * i + CW / 2, x0 = PAD + CW * i + 6;
    g.fillStyle = '#0d1620'; g.fillRect(x0, R1, CW - 12, H);
    g.drawImage(it.canvas, cx - it.w / 2, R1 + H - it.h);
    T(it.name, cx, R1 + H + 8, 14, '#e6eef7', true, true);
    T(it.tag, cx, R1 + H + 26, 11, it.col, false, true);
    T(it.w + '×' + it.h + '（宽 ' + Math.round(it.w / it.h * 100) + '%）', cx, R1 + H + 42, 11, '#6f8296', false, true);

    const y0 = Math.round(H * 0.28), y1 = Math.round(H * 0.82);
    const srcH = y1 - y0;
    const dh = Math.min(H2 - 8, srcH * ZOOM);
    const dw = it.w * ZOOM;
    g.fillStyle = '#0d1620'; g.fillRect(x0, R2, CW - 12, H2);
    g.save();
    g.beginPath(); g.rect(x0, R2, CW - 12, H2); g.clip();
    g.imageSmoothingEnabled = false;
    g.drawImage(it.canvas, 0, y0, it.w, srcH, cx - dw / 2, R2 + 4, dw, dh);
    g.restore();
  }
  T('×4 放大（肩到膝）', PAD, R2 + H2 + 8, 12, '#6f8296');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'detail-check.png'), await canvas.encode('png'));
  console.log('\n占位（游戏内尺寸）：');
  for (const it of list) console.log('  ' + it.name.padEnd(8) + it.w + '×' + it.h + '  宽 ' + Math.round(it.w / it.h * 100) + '%  ' + it.tag);
  console.log('\n✓ shots/detail-check.png');
})();
