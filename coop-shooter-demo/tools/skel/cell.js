/* 从拼版图里切一格放大看：node tools/skel/cell.js 图 格宽 序号 [x 偏移] [y0] [h] */
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const ROOT = path.join(__dirname, '../..');
(async () => {
  const [file, cwS, idxS, xoS, y0S, hS] = process.argv.slice(2);
  const im = await loadImage(path.join(ROOT, file));
  const n = Math.max(1, Math.round(im.width / Number(cwS)));
  const cw = Math.round(im.width / n);
  const idx = Number(idxS) || 0;
  const xo = Number(xoS || 0), y0 = Number(y0S || 0), h = Number(hS || im.height);
  const c = createCanvas(cw, h);
  const g = c.getContext('2d');
  g.fillStyle = '#262a32'; g.fillRect(0, 0, cw, h);
  g.drawImage(im, idx * cw + xo, y0, cw, h, 0, 0, cw, h);
  const out = path.join(ROOT, 'shots', '_cell' + idx + '.png');
  fs.writeFileSync(out, c.toBuffer('image/png'));
  console.log(out, cw + 'x' + h);
})();
