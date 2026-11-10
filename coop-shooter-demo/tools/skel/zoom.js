/* 局部放大 + 网格：node tools/skel/zoom.js file x0 y0 x1 y1 [K]
   给细部（手、枪口、脚）读坐标用。输出 _zoom.png
   --------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const [file, x0, y0, x1, y1, K0] = process.argv.slice(2);
const K = Number(K0 || 10);
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');

(async () => {
  const im = await loadImage(file);
  const sx = +x0, sy = +y0, ex = +x1, ey = +y1;
  const W = ex - sx, H = ey - sy;
  const out = createCanvas(W * K, H * K);
  const g = out.getContext('2d');
  g.fillStyle = '#0d1218'; g.fillRect(0, 0, out.width, out.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(im, sx, sy, W, H, 0, 0, W * K, H * K);

  for (let x = sx; x <= ex; x += 5) {
    const big = x % 10 === 0;
    g.strokeStyle = big ? 'rgba(255,90,90,0.9)' : 'rgba(255,90,90,0.3)';
    g.lineWidth = big ? 1.5 : 1;
    const px = (x - sx) * K;
    g.beginPath(); g.moveTo(px + 0.5, 0); g.lineTo(px + 0.5, H * K); g.stroke();
    if (big) { g.fillStyle = '#ffc0c0'; g.font = 'bold 12px "Microsoft YaHei"'; g.fillText(String(x), px + 2, 12); }
  }
  for (let y = sy; y <= ey; y += 5) {
    const big = y % 10 === 0;
    g.strokeStyle = big ? 'rgba(90,225,255,0.9)' : 'rgba(90,225,255,0.3)';
    g.lineWidth = big ? 1.5 : 1;
    const py = (y - sy) * K;
    g.beginPath(); g.moveTo(0, py + 0.5); g.lineTo(W * K, py + 0.5); g.stroke();
    if (big) { g.fillStyle = '#bcdef0'; g.font = 'bold 12px "Microsoft YaHei"'; g.fillText(String(y), 2, py + 21); }
  }
  const p = file.replace(/\.png$/i, '_zoom.png');
  fs.writeFileSync(p, out.toBuffer('image/png'));
  console.log('→ ' + p + '  区域(' + sx + ',' + sy + ')-(' + ex + ',' + ey + ') @' + K + 'x');
})();
