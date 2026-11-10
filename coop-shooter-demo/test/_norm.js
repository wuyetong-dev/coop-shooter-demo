/* 把新出的立绘规范化成「192px 高的透明底预览」
   用法：node test/_norm.js <源图路径> <输出名，不含扩展名>
   为什么要有这个：art/cast/ 里同时躺着原图（Japanese_*.png，1024×1536）
   和预览（kimi.png 等，192 高）。两者用途不同，不能混 ——
   原图留着拆件，预览只用来判断「缩到游戏尺寸还认不认得出」。 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const [, , src, name] = process.argv;
if (!src || !name) {
  console.error('用法：node test/_norm.js <源图> <输出名>');
  process.exit(1);
}
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

(async () => {
  const img = await loadImage(src);
  const c = cutWhite(img);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] < 24) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { console.error('整张图都是白的，抠图失败'); process.exit(1); }

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const k = H / bh, w = Math.round(bw * k);
  const out = createCanvas(w, H), og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, x0, y0, bw, bh, 0, 0, w, H);

  const file = path.join(__dirname, '..', 'art', 'cast', name + '.png');
  fs.writeFileSync(file, await out.encode('png'));
  console.log('✓ ' + path.relative(process.cwd(), file) + '  ' + w + '×' + H +
    '  （原图 ' + img.width + '×' + img.height + '，裁到 ' + bw + '×' + bh + '）');
})();
