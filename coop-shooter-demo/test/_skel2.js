/* 骨骼原型 v2：切件（头 / 躯干 / 大腿x2 / 小腿x2）+ 两骨 IK。
   输出：站立 / 蹲下 / 趴下 三姿态对照，4 倍放大。 */
const fs = require('fs'), path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '..');

const ART = process.argv[2] || 'art/hero_hold.png';
const NAME = process.argv[3] || 'skel2.png';

/* 立绘像素坐标（measure.js 出的，膝盖位置人工校过） */
const SK = {
  'art/hero_hold.png': {
    bot: 191, foot: 0.50,
    head: { x: 14, y: 2, w: 70, h: 68, jx: 46, jy: 70 },   /* 含头盔，绕颈 */
    neck: { x: 46, y: 70 },
    torso: { y0: 64 },
    legs: {
      back:  { hip: [24, 140], knee: [17, 158], ank: [12.5, 188],
               thigh: [0, 132, 40, 34], shin: [0, 152, 40, 40] },
      front: { hip: [50.5, 140], knee: [56, 158], ank: [63.5, 188],
               thigh: [36, 132, 42, 34], shin: [30, 152, 48, 40] }
    }
  },
  'art/v2/hold_cut.png': {
    bot: 191, foot: 0.56,
    head: { x: 40, y: 6, w: 76, h: 100, jx: 84, jy: 104 },
    neck: { x: 84, y: 104 },
    torso: { y0: 96 },
    legs: {
      back:  { hip: [41, 168], knee: [42, 178], ank: [41, 188],
               thigh: [22, 160, 40, 24], shin: [24, 172, 34, 20] },
      front: { hip: [89.5, 168], knee: [94, 178], ank: [97.5, 188],
               thigh: [72, 160, 44, 24], shin: [76, 172, 36, 20] }
    }
  }
}[ART];

function cut(img, r) {
  const c = createCanvas(Math.max(1, Math.round(r[2])), Math.max(1, Math.round(r[3])));
  c.getContext('2d').drawImage(img, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
  return c;
}
function ik(h, a, L1, L2) {
  let dx = a[0] - h[0], dy = a[1] - h[1];
  let d = Math.hypot(dx, dy);
  const max = L1 + L2 - 0.02, min = Math.abs(L1 - L2) + 0.02;
  const dd = Math.max(min, Math.min(max, d));
  const base = Math.atan2(dy, dx);
  const cosA = (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const sc = dd / (d || 1);
  return {
    k: [h[0] + Math.cos(base + A) * L1, h[1] + Math.sin(base + A) * L1],
    a: [h[0] + Math.cos(base) * dd * 0 + (a[0] - h[0]) * sc + h[0] - h[0], 0]
  };
}

async function main() {
  const img = await loadImage(path.join(ROOT, ART));
  const W = img.width, H = img.height;
  const S = SK;

  /* 切件 */
  const headCv = cut(img, [S.head.x, S.head.y, S.head.w, S.head.h]);
  /* 躯干：整图挖掉头 + 两条腿 */
  const torsoCv = createCanvas(W, H);
  {
    const g = torsoCv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(S.head.x, S.head.y, S.head.w, S.head.h);
    for (const k of ['back', 'front']) {
      const L = S.legs[k];
      const y0 = Math.min(L.thigh[1], L.shin[1]) - 2;
      g.fillRect(L.thigh[0] - 1, y0, L.thigh[2] + 2, H - y0);
    }
  }
  const legParts = {};
  for (const k of ['back', 'front']) {
    const L = S.legs[k];
    legParts[k] = {
      thigh: cut(img, L.thigh),
      shin: cut(img, L.shin),
      L: { ...L },
      L1: Math.hypot(L.knee[0] - L.hip[0], L.knee[1] - L.hip[1]),
      L2: Math.hypot(L.ank[0] - L.knee[0], L.ank[1] - L.knee[1])
    };
  }

  function drawPose(g, ox, oy, scale, mode) {
    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    /* 脚底统一在 y=0，立绘坐标 y 向下 → 转换 */
    const baseY = -S.bot;
    g.translate(0, baseY);

    let hipDrop = 0, footBack = 0, torsoRot = 0, headRot = 0;
    if (mode === 'crouch') { hipDrop = 22; torsoRot = -0.22; headRot = 0.16; }
    if (mode === 'prone') { hipDrop = 46; footBack = 0; torsoRot = Math.PI / 2 * 0.92; headRot = -1.15; }

    const drawOne = (key) => {
      const P = legParts[key];
      const L = P.L;
      const hip = [L.hip[0], L.hip[1] + hipDrop];
      let ank;
      if (mode === 'prone') {
        ank = [L.hip[0] - (P.L1 + P.L2) * 0.96, S.bot];
        hip[1] = S.bot - 6;
        hip[0] = L.hip[0];
      } else {
        ank = [L.ank[0] + footBack, L.ank[1]];
      }
      const k = ik(hip, ank, P.L1, P.L2).k;
      /* 大腿 */
      const th0 = Math.atan2(L.knee[1] - L.hip[1], L.knee[0] - L.hip[0]);
      const th1 = Math.atan2(k[1] - hip[1], k[0] - hip[0]);
      g.save();
      g.translate(hip[0], hip[1]);
      g.rotate(th1 - th0);
      /* 部件内关节坐标 = 关节 - 切件左上角；把它挪到原点，部件就绕着关节转 */
      g.translate(-(L.hip[0] - L.thigh[0]), -(L.hip[1] - L.thigh[1]));
      g.drawImage(P.thigh, 0, 0);
      g.restore();
      /* 小腿 */
      const sh0 = Math.atan2(L.ank[1] - L.knee[1], L.ank[0] - L.knee[0]);
      const sh1 = Math.atan2(ank[1] - k[1], ank[0] - k[0]);
      g.save();
      g.translate(k[0], k[1]);
      g.rotate(sh1 - sh0);
      g.translate(-(L.knee[0] - L.shin[0]), -(L.knee[1] - L.shin[1]));
      g.drawImage(P.shin, 0, 0);
      g.restore();
      /* 关节补片：膝盖一圈，防止折角露背景 */
      const r = key === 'front' ? 7 : 6;
      g.save();
      g.beginPath(); g.arc(k[0], k[1], r, 0, 7); g.clip();
      g.translate(-(L.knee[0] - L.shin[0]), -(L.knee[1] - L.shin[1]));
      g.drawImage(P.shin, 0, 0);
      g.restore();
      return { hip, k, ank };
    };

    drawOne('back');
    /* 躯干 */
    const hipPivot = [S.legs.front.hip[0], S.legs.front.hip[1] + hipDrop];
    if (mode === 'prone') hipPivot[1] = S.bot - 6;
    g.save();
    g.translate(hipPivot[0], hipPivot[1]);
    g.rotate(torsoRot);
    g.translate(-hipPivot[0], -hipPivot[1]);
    g.drawImage(torsoCv, 0, 0);
    g.restore();
    drawOne('front');
    /* 头：跟着躯干转，再绕颈回正 */
    g.save();
    g.translate(hipPivot[0], hipPivot[1]);
    g.rotate(torsoRot);
    g.translate(-hipPivot[0], -hipPivot[1]);
    g.translate(S.neck.x, S.neck.y);
    g.rotate(headRot);
    g.translate(-(S.neck.x - S.head.x), -(S.neck.y - S.head.y));
    g.drawImage(headCv, 0, 0);
    g.restore();

    g.restore();
  }

  const Z = 4;
  const cw = (W + 26) * Z * 3, chh = (H + 26) * Z;
  const cv = createCanvas(cw, chh);
  const g = cv.getContext('2d');
  g.fillStyle = '#262a32'; g.fillRect(0, 0, cw, chh);
  const modes = ['stand', 'crouch', 'prone'];
  modes.forEach((m, i) => {
    g.save();
    g.strokeStyle = '#4a5260'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(i * (W + 26) * Z, chh - 26 * Z + 2);
    g.lineTo((i + 1) * (W + 26) * Z, chh - 26 * Z + 2);
    g.stroke();
    g.restore();
    drawPose(g, i * (W + 26) * Z + 60, chh - 26 * Z, Z, m);
  });
  fs.writeFileSync(path.join(ROOT, 'shots', NAME), cv.toBuffer('image/png'));
  console.log('->', path.join('shots', NAME), cv.width + 'x' + cv.height);
}
main().catch(e => { console.error(e); process.exit(1); });
