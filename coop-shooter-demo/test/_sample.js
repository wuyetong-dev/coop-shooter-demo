/* 样张体检：把「现役 sprite / 参考图 / 按新规格出的样张」缩到同一尺寸，
   看新规格到底是把图像拉近了游戏，还是只是换了张图。 */
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
    { f: path.join(ART, 'v2', 'idle_cut.png'), name: '大肥鱼', tag: '现役 sprite', col: '#7ee0a0' },
    { f: path.join(ART, 'ref', 'claude.jpg'), name: '小克', tag: '参考图', col: '#ffc857' },
    { f: path.join(ART, 'cast', 'Japanese_chibi_anime_game_spri_2026-10-29T16-13-08.png'), name: '小克', tag: '新规格 v2', col: '#78e2ff' }
  ];
  for (const it of list) Object.assign(it, norm(await loadImage(it.f)));

  const PAD = 16, CW = 300, ZOOM = 2;
  const W = PAD * 2 + CW * 3, ROW1 = 90, H1 = H, ROW2 = ROW1 + H1 + 70, H2 = 290;
  const canvas = createCanvas(W, ROW2 + H2 + 60);
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b1117';
  g.fillRect(0, 0, W, canvas.height);

  const T = (s, x, y, sz, c, b, ct) => {
    g.fillStyle = c || '#9fb3c6';
    g.font = (b ? 'bold ' : '') + sz + 'px "Microsoft YaHei",sans-serif';
    g.textBaseline = 'top'; g.textAlign = ct ? 'center' : 'left';
    g.fillText(s, x, y); g.textAlign = 'left';
  };

  T('样张体检：同一角色，三种画法压到游戏内尺寸（高 192px）', PAD, 12, 16, '#7ee0a0', true);
  T('左＝现役标准　中＝参考图（插画）　右＝按新规格重出的样张', PAD, 36, 12, '#7c8b99');
  T('下面一行是同图放大 2 倍的上半身，看的是「轮廓和色块还剩几个」', PAD, 56, 12, '#5d6f80');

  for (let i = 0; i < 3; i++) {
    const it = list[i], cx = PAD + CW * i + CW / 2, x0 = PAD + CW * i + 8;
    g.fillStyle = '#0d1620';
    g.fillRect(x0, ROW1, CW - 16, H1);
    g.drawImage(it.canvas, cx - it.w / 2, ROW1 + H1 - it.h);
    g.strokeStyle = 'rgba(255,80,80,0.4)';
    g.beginPath(); g.moveTo(x0, ROW1 + H1 - 0.5); g.lineTo(x0 + CW - 16, ROW1 + H1 - 0.5); g.stroke();
    T(it.name, cx, ROW1 + H1 + 8, 14, '#e6eef7', true, true);
    T(it.tag + '  ' + it.w + '×' + it.h, cx, ROW1 + H1 + 26, 11, it.col, false, true);

    /* 放大 3 倍取上半身（头顶到腰），最近邻之外用平滑，模拟人眼远看 */
    const halfH = H * 0.55;
    g.fillStyle = '#0d1620';
    g.fillRect(x0, ROW2, CW - 16, H2);
    g.imageSmoothingEnabled = true;
    g.drawImage(it.canvas, 0, 0, it.w, halfH,
      cx - (it.w * ZOOM) / 2, ROW2 + 4, it.w * ZOOM, halfH * ZOOM > H2 - 8 ? H2 - 8 : halfH * ZOOM);
  }
  T('×2 放大（上半身）', PAD, ROW2 + H2 + 8, 12, '#6f8296');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'sample-check.png'), await canvas.encode('png'));
  console.log('\n三种画法压到 192px 后的占位：');
  for (const it of list) console.log('  ' + it.name + '  ' + it.w + '×' + it.h + '  ' + it.tag);
  console.log('\n✓ shots/sample-check.png');
})();
