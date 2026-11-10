/* 给姿态立绘套坐标网格，用来人工读锚点。
   用法：node tools/skel/grid.js art/pose/hero_crouch.png 4
   输出同目录 _grid_<名>.png，10px 细线、50px 粗线并标数字。
   --------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const file = process.argv[2];
const K = Number(process.argv[3] || 4);
const STEP = Number(process.argv[4] || 10);
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');

(async () => {
  const im = await loadImage(file);
  const W = im.width, H = im.height;
  const out = createCanvas(W * K, H * K);
  const g = out.getContext('2d');
  g.fillStyle = '#101820'; g.fillRect(0, 0, out.width, out.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(im, 0, 0, W * K, H * K);

  for (let x = 0; x <= W; x += STEP) {
    const big = x % (STEP * 5) === 0;
    g.strokeStyle = big ? 'rgba(255,80,80,0.85)' : 'rgba(255,80,80,0.28)';
    g.lineWidth = big ? 1.6 : 1;
    g.beginPath(); g.moveTo(x * K + 0.5, 0); g.lineTo(x * K + 0.5, H * K); g.stroke();
    if (big) {
      g.fillStyle = '#ffb0b0'; g.font = 'bold 13px "Microsoft YaHei"';
      g.fillText(String(x), x * K + 2, 13);
    }
  }
  for (let y = 0; y <= H; y += STEP) {
    const big = y % (STEP * 5) === 0;
    g.strokeStyle = big ? 'rgba(80,220,255,0.85)' : 'rgba(80,220,255,0.28)';
    g.lineWidth = big ? 1.6 : 1;
    g.beginPath(); g.moveTo(0, y * K + 0.5); g.lineTo(W * K, y * K + 0.5); g.stroke();
    if (big) {
      g.fillStyle = '#b6f0ff'; g.font = 'bold 13px "Microsoft YaHei"';
      g.fillText(String(y), 2, y * K + 22);
    }
  }
  const p = file.replace(/\.png$/i, '_grid.png');
  fs.writeFileSync(p, out.toBuffer('image/png'));
  console.log('→ ' + p + '  ' + W + 'x' + H + ' @' + K + 'x');
})();
