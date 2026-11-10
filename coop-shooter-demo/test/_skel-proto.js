/* 骨骼原型：只验证「关节坐标 + 切件 + 两骨 IK」能不能看。
   不接进游戏，只出对照图。 */
const fs = require('fs'), path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '..');

const ART = process.argv[2] || 'art/hero_hold.png';
const OUT = path.join(ROOT, 'shots', process.argv[3] || 'skel.png');

/* ---- 关节：立绘像素坐标（y 向下，脚底 ≈ bot） ---- */
const SK = {
  'art/hero_hold.png': {
    bot: 190, foot: 0.50,
    head: { x: 50, y: 6, w: 62, h: 66, jx: 50, jy: 66 },
    torso:[0, 66, 87, 130],
    legs: {
      back:  { hip:[44,118], knee:[33,146], ank:[30,175],
               thigh:[22,110,32,44], shin:[18,142,34,50] },
      front: { hip:[66,120], knee:[71,147], ank:[74,176],
               thigh:[54,112,32,44], shin:[52,144,36,50] }
    }
  },
  'art/v2/hold_cut.png': {
    bot: 191, foot: 0.56,
    head: { x: 62, y: 14, w: 56, h: 94, jx: 90, jy: 106 },
    torso:[0, 100, 116, 96],
    legs: {
      back:  { hip:[70,146], knee:[74,172], ank:[70,188],
               thigh:[56,146,32,34], shin:[56,168,30,26] },
      front: { hip:[90,144], knee:[96,172], ank:[97,187],
               thigh:[76,144,36,36], shin:[80,168,32,26] }
    }
  }
}[ART];

async function main() {
const img = await loadImage(path.join(ROOT, ART));
const W = img.width, H = img.height;

function drawSkeleton(g, ox, oy, s) {
  g.save(); g.translate(ox, oy); g.scale(s, s);
  g.strokeStyle = '#39ff6a'; g.lineWidth = 0.6;
  for (const k of ['back','front']) {
    const L = SK.legs[k];
    g.beginPath();
    g.moveTo(L.hip[0], L.hip[1]); g.lineTo(L.knee[0], L.knee[1]); g.lineTo(L.ank[0], L.ank[1]);
    g.stroke();
    for (const p of [L.hip, L.knee, L.ank]) {
      g.beginPath(); g.arc(p[0], p[1], 1.6, 0, 7); g.fillStyle = '#ffde3a'; g.fill();
    }
  }
  const hd = SK.head;
  g.strokeStyle = '#5ad2ff'; g.strokeRect(hd.x, hd.y, hd.w, hd.h);
  g.beginPath(); g.arc(hd.jx, hd.jy, 1.6, 0, 7); g.fillStyle = '#ff5a3c'; g.fill();
  g.strokeStyle = '#ff5a3c'; g.strokeRect(SK.torso[0], SK.torso[1], SK.torso[2], SK.torso[3]);
  g.restore();
}

const Z = 4;
const cv = createCanvas(W*Z*2 + 40, H*Z + 30);
const g = cv.getContext('2d');
g.fillStyle = '#262a32'; g.fillRect(0,0,cv.width,cv.height);
g.drawImage(img, 0, 0, W*Z, H*Z);
drawSkeleton(g, 0, 0, Z);
g.drawImage(img, W*Z+40, 0, W*Z, H*Z);
g.save(); g.translate(W*Z+40,0); g.scale(Z,Z);
g.strokeStyle='rgba(90,210,255,0.9)'; g.lineWidth=1/Z;
for (const k of ['back','front']) {
  const L = SK.legs[k];
  g.strokeRect(L.thigh[0],L.thigh[1],L.thigh[2],L.thigh[3]);
  g.strokeStyle='rgba(255,150,60,0.9)';
  g.strokeRect(L.shin[0],L.shin[1],L.shin[2],L.shin[3]);
  g.strokeStyle='rgba(90,210,255,0.9)';
}
g.restore();
fs.writeFileSync(OUT, cv.toBuffer('image/png'));
console.log('->', OUT, cv.width+'x'+cv.height);
}
main().catch(e=>{console.error(e);process.exit(1);});
