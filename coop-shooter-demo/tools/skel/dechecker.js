/* 抠掉画进像素的棋盘格背景。
   ImageGen 的 transparent 有时不生效：棋盘格被当成图案画进 RGB，alpha 全 255。
   做法：从四边 flood fill，只吃「亮 + 低饱和」的连通区域 —— 角色身上的亮高光
   被深色包围，不在连通区里，所以不会被误抠。                       */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  const src = process.argv[2];
  const out = process.argv[3];
  const im = await loadImage(src);
  const W = im.width, H = im.height;
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  g.drawImage(im, 0, 0);
  const id = g.getImageData(0, 0, W, H);
  const d = id.data;

  const light = (i) => {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    return lum > 195 && sat < 16;
  };

  const vis = new Uint8Array(W * H);
  const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (vis[p]) return;
    if (!light(p * 4)) return;
    vis[p] = 1; qx[qt] = x; qy[qt] = y; qt++;
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (qh < qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  let cleared = 0;
  for (let p = 0; p < W * H; p++) if (vis[p]) { d[p * 4 + 3] = 0; cleared++; }

  /* 边缘残留：贴着空洞、但仍然偏亮的半透明像素一并清掉（只清 1px 圈） */
  const del = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    if (vis[p]) continue;
    const nb = vis[p - 1] || vis[p + 1] || vis[p - W] || vis[p + W];
    if (!nb) continue;
    const i = p * 4;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum > 175) del.push(p);
  }
  for (const p of del) { d[p * 4 + 3] = 0; cleared++; }

  g.putImageData(id, 0, 0);
  fs.writeFileSync(out, cv.toBuffer('image/png'));
  console.log(path.basename(out), W + 'x' + H, '清掉', cleared, '(' + (cleared / (W * H) * 100).toFixed(1) + '%)');
})();
