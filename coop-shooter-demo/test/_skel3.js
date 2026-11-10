/* 骨骼原型 v3：腿用「沿轴弯折」(bend warp) 而不是硬切两段。
   硬切的病灶：切缝是水平的、腿是斜的，一转就裂成碎片（v2 就是这样）。
   弯折的做法：把腿片按行切片，逐行绕 IK 路径上的对应点旋转 —— 连续、无缝。

   躯干不压缩：蹲下变矮是因为腿折了，不是身子缩了。这是之前做法最大的错。 */
const fs = require('fs'), path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '..');

const ART = process.argv[2] || 'art/hero_hold.png';
const NAME = process.argv[3] || 'skel3.png';
let DBG = null;
if (process.env.DBG) DBG = [];

const SK = {
  'art/hero_hold.png': {
    bot: 191,
    head: [10, 0, 78, 72], neck: [46, 69],
    hipL: [24, 140], hipR: [50.5, 140],
    legs: {
      back:  { hip: [24, 140], knee: [17, 164], ank: [12.5, 188], rect: [0, 108, 40, 84] },
      front: { hip: [50.5, 140], knee: [56, 164], ank: [63.5, 188], rect: [36, 108, 51, 84] }
    }
  },
  'art/v2/hold_cut.png': {
    bot: 191,
    head: [36, 2, 80, 104], neck: [84, 103],
    hipL: [41, 168], hipR: [89.5, 168],
    legs: {
      back:  { hip: [41, 168], knee: [42, 178], ank: [41, 188], rect: [20, 160, 44, 32] },
      front: { hip: [89.5, 168], knee: [94, 178], ank: [97.5, 188], rect: [70, 160, 40, 32] }
    }
  }
}[ART];

function ik(h, k0, a0, L1, L2, target) {
  /* target：脚踝要落到哪（世界）。返回新膝 */
  let dx = target[0] - h[0], dy = target[1] - h[1];
  const d0 = Math.hypot(dx, dy) || 0.001;
  const dmax = L1 + L2 - 0.02, dmin = Math.abs(L1 - L2) + 0.02;
  const d = Math.max(dmin, Math.min(dmax, d0));
  const base = Math.atan2(dy, dx);
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  /* 膝盖朝 +x 顶出去：base-A 是把膝推到连线的「前方」那一侧。
	     base+A 会推到后方（蹲下时膝盖朝屁股，看着像反关节）。 */
  const kx = h[0] + Math.cos(base - A) * L1;
  const ky = h[1] + Math.sin(base - A) * L1;
  const s = d / d0;
  return { knee: [kx, ky], ank: [h[0] + dx * s, h[1] + dy * s] };
}

type = null;
async function main() {
  const img = await loadImage(path.join(ROOT, ART));
  const W = img.width, H = img.height;
  const S = SK;

  const headCv = createCanvas(S.head[2], S.head[3]);
  headCv.getContext('2d').drawImage(img, S.head[0], S.head[1], S.head[2], S.head[3], 0, 0, S.head[2], S.head[3]);

  /* 躯干：挖掉头和腿 */
  const torsoCv = createCanvas(W, H);
  {
    const g = torsoCv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    /* 只挖一条「胯以下」的横带，不分左右腿的 x 范围 ——
       分 x 挖会留下两个方形缺口（腿片是斜的，盖不满矩形）。
       腿片顶部比胯高 8px，重叠那一段由腿自己盖回来。 */
    const y0 = S.hipR[1] - 3;
    g.fillRect(0, y0, W, S.bot + 6 - y0);
    g.fillRect(S.head[0], S.head[1], S.head[2], S.head[3]);
  }

  /* 腿：把带透明边的宽矩形裁到实际 alpha 范围，弯折时行宽才不浪费 */
  const legCv = {};
  for (const k of ['back', 'front']) {
    const R = S.legs[k].rect;
    const c = createCanvas(R[2], R[3]);
    c.getContext('2d').drawImage(img, R[0], R[1], R[2], R[3], 0, 0, R[2], R[3]);
    legCv[k] = c;
  }

  function bendLeg(g, key, newHip, newAnk) {
    const L = S.legs[key];
    const R = L.rect;
    const L1 = Math.hypot(L.knee[0] - L.hip[0], L.knee[1] - L.hip[1]);
    const L2 = Math.hypot(L.ank[0] - L.knee[0], L.ank[1] - L.knee[1]);
    const r = ik(newHip, L.knee, L.ank, L1, L2, newAnk);
    const cv = legCv[key];

    const aThigh = Math.atan2(r.knee[1] - newHip[1], r.knee[0] - newHip[0]);
    const aShin  = Math.atan2(r.ank[1] - r.knee[1], r.ank[0] - r.knee[0]);
    const oThigh = Math.atan2(L.knee[1] - L.hip[1], L.knee[0] - L.hip[0]);
    const oShin  = Math.atan2(L.ank[1] - L.knee[1], L.ank[0] - L.knee[0]);
    const OV = 3.5;                       /* 两段在膝处重叠的像素 */
    const BIG = 260;

    /* 半平面 clip：在「以关节为原点、已转到 α」的坐标系里，
       用原图坐标切一条垂直于腿轴的线，把腿分成上下两段。
       逐行平移那条路已经试过两次了，位移梯度一大就漏行、出阶梯 ——
       刚性两段 + 垂直切缝不会有这个问题，因为每一段内部是完整的像素。 */
    const halfPlane = (joint, ang, from, to) => {
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const nx = -uy, ny = ux;
      const p0 = [joint[0] + ux * from, joint[1] + uy * from];
      const p1 = [joint[0] + ux * to, joint[1] + uy * to];
      g.beginPath();
      g.moveTo(p0[0] + nx * BIG, p0[1] + ny * BIG);
      g.lineTo(p0[0] - nx * BIG, p0[1] - ny * BIG);
      g.lineTo(p1[0] - nx * BIG, p1[1] - ny * BIG);
      g.lineTo(p1[0] + nx * BIG, p1[1] + ny * BIG);
      g.closePath();
      g.clip();
    };

    /* 大腿：绕 (hip → hipNew) 转 α，只画轴上前 L1+OV 那截 */
    g.save();
    g.translate(newHip[0], newHip[1]);
    g.rotate(aThigh - oThigh);
    g.translate(-L.hip[0], -L.hip[1]);
    g.save();
    /* 切缝角度用**原图**的腿轴（clip 是在原图坐标里构造的），
       用新角度会在原图上斜着切错位置。 */
    if (!process.env.NOCLIP) halfPlane(L.hip, oThigh, -BIG, L1 + OV);
    g.drawImage(cv, 0, 0, R[2], R[3], R[0], R[1], R[2], R[3]);
    g.restore();
    g.restore();

    /* 髋关节球：以髋为心画一个圆片（跟着大腿转）。
       两段刚性切分后，胯和腿之间一定会裂一条缝 —— 大腿根部旋转时
       矩形角会先离开躯干。补一个圆把关节填实，缝隙就没有了。 */
    /* 补片**不动**：不转也不平移。
       平移 +18 会把它一起推下去，补片只覆盖 150 以下，而缝在 138~150 ——
       补了个空。留在原图位置，132~150 这段刚好把躯干下缘和大腿顶接起来，
       而且它本来就是裤腰那一块像素，颜色天然对。 */
    g.save();
    g.translate(-0.0001, 0);
    g.save();
    g.beginPath();
    g.arc(L.hip[0] - 2, L.hip[1] - 8, 15, 0, 7);
    g.clip();
    g.drawImage(cv, 0, 0, R[2], R[3], R[0], R[1], R[2], R[3]);
    g.restore();
    g.restore();

    /* 小腿：绕 (knee → kneeNew) 只画轴后 L1-OV 那截 */
    g.save();
    g.translate(r.knee[0], r.knee[1]);
    /* 世界角 = 新小腿方向 - 原小腿方向。加上大腿角是错的 ——
       这一段是「整条原腿绕膝转」，不是「在大腿基础上再转」，
       多转一个 α 的后果是脚被甩离地面（三档蹲全在悬空就是这么来的）。 */
    g.rotate(aShin - oShin);
    g.translate(-L.knee[0], -L.knee[1]);
    g.save();
    if (!process.env.NOCLIP) halfPlane(L.hip, oThigh, L1 - OV, BIG);
    g.drawImage(cv, 0, 0, R[2], R[3], R[0], R[1], R[2], R[3]);
    g.restore();
    g.restore();
  }

  function drawPose(g, ox, oy, Z, mode) {
    g.save();
    g.translate(ox, oy);
    g.scale(Z, Z);
    g.translate(0, -S.bot);

    let hipDrop = 0, lean = 0, headRot = 0;
    if (mode === 'crouch') { hipDrop = Number(process.env.HD || 15); lean = -0.34; headRot = 0.24; }
    if (mode === 'prone') { hipDrop = S.bot - 6 - 144; lean = -1.42; headRot = 1.05; }

    /* 立绘是「行进中」的姿势（两脚前后差 30px）。蹲下还保持这个跨步，
       怎么调都像迈腿 —— 必须把脚往髋下方收。
       K = 收拢比例，0 = 完全站姿，1 = 收到髋正下方。 */
    const crouchAnk = (k) => {
      const L = S.legs[k];
      if (mode !== 'crouch') return [L.ank[0], L.ank[1]];
      const K = Number(process.env.CK || 0.62);
      return [L.hip[0] + (L.ank[0] - L.hip[0]) * (1 - K), S.bot - 1];
    };
    const hipPivot = [S.hipR[0], S.hipR[1] + hipDrop];

    /* 躯干先画（挖掉了胯以下），腿再从胯里长出来盖住接缝 */
    g.save();
    g.translate(hipPivot[0], hipPivot[1]);
    g.rotate(lean);
    g.translate(-hipPivot[0], -hipPivot[1]);
    g.drawImage(torsoCv, 0, 0);
    g.restore();

    /* 后腿 → 前腿 */
    bendLeg(g, 'back',
      [S.legs.back.hip[0], S.legs.back.hip[1] + hipDrop],
      mode === 'prone' ? [S.legs.back.ank[0] - 44, S.bot - 4]
        : crouchAnk('back'));
    bendLeg(g, 'front',
      [S.legs.front.hip[0], S.legs.front.hip[1] + hipDrop],
      mode === 'prone' ? [S.legs.front.ank[0] - 44, S.bot - 4]
        : crouchAnk('front'));

    /* 头 */
    g.save();
    g.translate(hipPivot[0], hipPivot[1]);
    g.rotate(lean);
    g.translate(-hipPivot[0], -hipPivot[1]);
    g.translate(S.neck[0], S.neck[1]);
    g.rotate(headRot);
    g.translate(-(S.neck[0] - S.head[0]), -(S.neck[1] - S.head[1]));
    g.drawImage(headCv, 0, 0);
    g.restore();

    g.restore();
  }

  if (process.env.DUMP) {
    const pw = 20;
    const totW = [headCv, torsoCv, legCv.back, legCv.front].reduce((a,c)=>a+c.width+pw, 20);
    const totH = Math.max(headCv.height, torsoCv.height, legCv.back.height, legCv.front.height) + 20;
    const pc = createCanvas(totW, totH);
    const pg = pc.getContext('2d');
    pg.fillStyle = '#1b5e20'; pg.fillRect(0,0,totW,totH);
    let x = 10;
    for (const c of [headCv, torsoCv, legCv.back, legCv.front]) {
      pg.drawImage(c, x, 10); x += c.width + pw;
    }
    fs.writeFileSync(path.join(ROOT,'shots','_dump.png'), pc.toBuffer('image/png'));
    console.log('dump', totW+'x'+totH);
  }
  const Z = Number(process.env.Z || 5);
  const ONLY = process.env.ONLY;
  const PAD = 200;
  const modes = ONLY ? [ONLY] : ['stand', 'crouch', 'prone'];
  const cw = (W + PAD) * Z * modes.length, chh = (H + 30) * Z;
  const cv = createCanvas(cw, chh);
  const g = cv.getContext('2d');
  g.fillStyle = '#262a32'; g.fillRect(0, 0, cw, chh);
  modes.forEach((m, i) => {
    g.strokeStyle = '#454c58'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(i * (W + PAD) * Z, chh - 30 * Z + 2);
    g.lineTo((i + 1) * (W + PAD) * Z, chh - 30 * Z + 2);
    g.stroke();
    drawPose(g, i * (W + PAD) * Z + 210, chh - 30 * Z, Z, m);
  });
  if (DBG) { const v = DBG.filter(a=>a[2]>=0 && a[2]<=1); console.log('samples', v.length); v.filter((_,i)=>i%4===0).slice(0,40).forEach(a=>console.log(a.join('\t'))); }
  fs.writeFileSync(path.join(ROOT, 'shots', NAME), cv.toBuffer('image/png'));
  console.log('->', 'shots/' + NAME, cv.width + 'x' + cv.height);
}
main().catch(e => { console.error(e); process.exit(1); });
