/* 骨骼原型 v4：把身体真正拆成部件。
   ----------------------------------------------------------------
   v1 是「整图加变形」，v2 硬切两段切烂了，v3 的蹲下对了但趴下是碎的。
   v3 趴下裂开的原因不在切缝，在几何：躯干往左放倒、两条腿的踝目标也往左，
   腿等于折回到身上去了。而且「绕脚底转整张图」这件事本身就错了 ——
   趴下是躯干绕**髋**放平，腿从髋向后伸，头单独绕颈抬回来，三件事分开。

   这一版把三种姿态统一成同一套关节目标：
     drop    骨盆下沉（膝盖一弯，胯必然矮，这是蹲下变矮的**唯一**来源）
     lean    躯干绕原髋的旋转（骨盆跟着一起倾）
     headRot 头绕颈的相对旋转
     ank     两条腿的踝目标
   躯干 / 头 / 大腿 / 小腿 各是一片 canvas，各自绕自己的关节转。 */
const fs = require('fs'), path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '..');

const ART = process.argv[2] || 'art/hero_hold.png';
const NAME = process.argv[3] || 'skel4.png';

const SK = {
  'art/hero_hold.png': {
    bot: 191,
    /* 头片比「挖掉的头」多带 13px 衣领：挖只挖到颈线（69），
       头片一直画到 82。静止时两者重叠、像素完全相同；头一转开，
       躯干上残留的那截衣领正好堵住下颌和脖子之间的空档。 */
    head: [10, 0, 78, 82], neck: [46, 69],
    hipL: [24, 140], hipR: [50.5, 140],
    legs: {
      back:  { hip: [24, 140],   ank: [12.5, 188], rect: [0, 108, 40, 84] },
      front: { hip: [50.5, 140], ank: [63.5, 188], rect: [36, 108, 51, 84] }
    }
  }
}[ART];

/* 膝不写死坐标，取髋→踝连线的比例点。
   理由：量测工具给的「膝」本来就是插值出来的，和画上的膝差 1~2px；
   一旦拿它当骨骼，静止姿态下 IK 解出来的膝就和原图差这 1~2px，
   整条腿多转零点几度 —— 像素边缘全糊，站立姿态就不再和立绘逐像素一致了。
   取连线比例点时 L1+L2 恰好等于髋踝距，静止时 A=0、膝原地不动、误差为零。
   画上的膝本来也不在连线上（腿是有弧度的），但两段是刚性像素，
   切在哪只影响接缝位置，不影响形状。 */
const KNEE_F = Number(process.env.KF || 0.5);
const kneeOf = (L) => [L.hip[0] + (L.ank[0] - L.hip[0]) * (L.f === undefined ? KNEE_F : L.f),
                       L.hip[1] + (L.ank[1] - L.hip[1]) * (L.f === undefined ? KNEE_F : L.f)];

/* ---------- 姿态表 ---------- */
const CROUCH_K = Number(process.env.CK || 0.62);   /* 蹲下时脚往髋下收多少 */
const POSES = {
  stand:  { drop: 0,  lean: 0,     headRot: 0 },
  crouch: { drop: Number(process.env.HD || 16), lean: Number(process.env.CL || -0.48),
            headRot: Number(process.env.CH || 0.40), ankX: Number(process.env.CX || 10) },
  prone:  { drop: Number(process.env.PD || 25), lean: Number(process.env.PL || 1.42), headPull: Number(process.env.HP || 3),
            headRot: Number(process.env.HR || -1.15),
            ankBack: Number(process.env.AB || 8), ankFront: Number(process.env.AF || 3) }
};
/* 参数扫描：VAR="姿态|drop|lean|headRot|踝后|踝前[|踝X]" 每段一格，方便并排比对 */
const VAR = process.env.VAR ? process.env.VAR.split(';').map(s => s.split('|')) : null;
let curVar = null;

/* ---------- 两骨 IK ----------
   膝盖朝哪一侧是这种解法唯一的自由量：base - A 把膝推到连线的「前」侧，
   base + A 推到后侧。

   夹取范围这里有个坑：早先把 d 夹到 L1+L2-0.02，静止姿态下髋踝距正好等于
   L1+L2，于是每帧都少 0.02px。数字看着无所谓，但接近共线的三角形里
   cos A = 0.99984 → A = 1°，50px 长的腿末端直接偏 0.9px —— 整个部件被
   重采样，边缘糊一圈。所以「完全伸直」要单独走 A=0 这一支，不能靠夹。 */
function ik(h, L1, L2, target) {
  const dx = target[0] - h[0], dy = target[1] - h[1];
  const d0 = Math.hypot(dx, dy) || 0.001;
  const base = Math.atan2(dy, dx);
  const dStraight = L1 + L2;
  let A = 0;
  if (d0 < dStraight) {
    const dmin = Math.abs(L1 - L2);
    if (d0 <= dmin) A = Math.PI;
    else A = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d0 * d0 - L2 * L2) / (2 * L1 * d0))));
  }
  const out = Math.min(d0, dStraight) / d0;
  return {
    knee: [h[0] + Math.cos(base - A) * L1, h[1] + Math.sin(base - A) * L1],
    ank:  [h[0] + dx * out, h[1] + dy * out]
  };
}

function rotAbout(p, c, a) {
  const cs = Math.cos(a), sn = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
}

async function main() {
  const img = await loadImage(path.join(ROOT, ART));
  const W = img.width, H = img.height;
  const S = SK;

  /* ---------- 切件 ---------- */
  const headCv = createCanvas(S.head[2], S.head[3]);
  headCv.getContext('2d').drawImage(img, S.head[0], S.head[1], S.head[2], S.head[3],
                                    0, 0, S.head[2], S.head[3]);

  /* 躯干 = 整图挖掉「头」和「胯以下的一条横带」。
     不能按左右腿的 x 分别挖：腿片是斜的，盖不满矩形，会留两个方口。 */
  const torsoCv = createCanvas(W, H);
  {
    const g = torsoCv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, S.hipR[1] - 3, W, S.bot + 8 - (S.hipR[1] - 3));
    /* 头只挖到颈线（不是整个头框）：颈线以下那一小截衣领留在躯干上。
       头一转开，原本被头盖住的那块就空了 —— 留下一段衣领，
       头转多少都能被它堵住，不会在脖子上开一个洞。 */
    g.fillRect(S.head[0], S.head[1], S.head[2], S.neck[1] - S.head[1]);
    /* 颈线以下那 13px 不挖：留着当底衬（见头片注释） */
  }

  const legCv = {};
  for (const k of ['back', 'front']) {
    const R = S.legs[k].rect;
    const c = createCanvas(R[2], R[3]);
    c.getContext('2d').drawImage(img, R[0], R[1], R[2], R[3], 0, 0, R[2], R[3]);
    legCv[k] = c;
  }

  /* ---------- 一条腿：大腿 + 髋补片 + 小腿 ---------- */
  function bendLeg(g, key, hipNew, ankTarget, patchC, rPre, L1, L2) {
    const L = S.legs[key], R = L.rect, cv = legCv[key];
    const K = kneeOf(L);
    const r = rPre;

    const aThigh = Math.atan2(r.knee[1] - hipNew[1], r.knee[0] - hipNew[0]);
    const aShin  = Math.atan2(r.ank[1] - r.knee[1], r.ank[0] - r.knee[0]);
    const oThigh = Math.atan2(K[1] - L.hip[1], K[0] - L.hip[0]);
    const oShin  = Math.atan2(L.ank[1] - K[1], L.ank[0] - K[0]);

    const OV = Number(process.env.OV || 3.5);  /* 两段在膝处重叠的像素 */
    const BIG = 300;

    /* 半平面裁切：在以关节为原点的坐标系里，切一条**垂直于原腿轴**的线。
       水平切缝切斜腿，一转就裂 —— 这条线跟着腿轴走，转多少都只有一条缝。 */
    const halfPlane = (joint, ang, from, to) => {
      const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const x0 = joint[0] + ux * from, y0 = joint[1] + uy * from;
      const x1 = joint[0] + ux * to,   y1 = joint[1] + uy * to;
      g.beginPath();
      g.moveTo(x0 + nx * BIG, y0 + ny * BIG);
      g.lineTo(x0 - nx * BIG, y0 - ny * BIG);
      g.lineTo(x1 - nx * BIG, y1 - ny * BIG);
      g.lineTo(x1 + nx * BIG, y1 + ny * BIG);
      g.closePath();
      g.clip();
    };

    /* 大腿：绕 (原髋 → 新髋) 转，只画轴前 L1+OV */
    g.save();
    g.translate(hipNew[0], hipNew[1]);
    g.rotate(aThigh - oThigh);
    g.translate(-L.hip[0], -L.hip[1]);
    g.save();
    if (!process.env.NOCLIP) halfPlane(L.hip, oThigh, -6, L1 + OV);
    g.drawImage(cv, 0, 0, R[2], R[3], R[0], R[1], R[2], R[3]);
    g.restore();
    g.restore();

    /* 髋关节补片：刚性切段一定会在大腿根留一块三角缝（矩形角先离开躯干）。
       用一块**不随髋转动**的圆片取同一处的腿部像素填实 —— 圆是旋转不变的，
       所以只要圆心落在关节上，转多少都不露。
       v3 里把补片按 (新髋-原髋) 平移，蹲下时缝在 138~150 而补片只覆盖 150 以下，
       补了个空。圆心必须落在「骨盆上的髋关节」，不是「腿片自己的髋」。 */
    g.save();
    g.beginPath();
    g.arc(patchC[0], patchC[1], 15, 0, 7);
    g.clip();
    g.drawImage(cv, 0, 0, R[2], R[3], R[0], R[1], R[2], R[3]);
    g.restore();

    /* 小腿：绕 (原膝 → 新膝) 转，只画轴后 L1-OV。
       注意是「整条原腿绕膝转」，不是「在大腿基础上再转」——
       多叠一个 α 的后果是脚被甩离地面。 */
    g.save();
    g.translate(r.knee[0], r.knee[1]);
    g.rotate(aShin - oShin);
    g.translate(-K[0], -K[1]);
    g.save();
    if (!process.env.NOCLIP) halfPlane(L.hip, oThigh, L1 - OV, BIG);
    g.drawImage(cv, 0, 0, R[2], R[3], R[0], R[1], R[2], R[3]);
    g.restore();
    g.restore();
    return r;
  }

  /* ---------- 一个姿态 ---------- */
  function drawPose(g, ox, oy, Z, mode) {
    const P = Object.assign({}, POSES[mode]);
    if (curVar) {
      const v = curVar;
      P.drop = Number(v[1]); P.lean = Number(v[2]); P.headRot = Number(v[3]);
      P.ankBack = Number(v[4]); P.ankFront = Number(v[5]);
      if (v[6] !== undefined) P.ankX = Number(v[6]);
    }
    const pivot = S.hipR;                       /* 骨盆的旋转中心 = 原髋 */

    /* 身体的变换 = 先整体下沉 drop，再绕原髋转 lean。
       **不能**写成「绕 (髋+drop) 转」：那样骨盆自己会被甩出去，
       后腿的髋会飞到头侧 —— v3 趴下裂成 C 形就是这个原因。 */
    let gFix = 0;                              /* 贴地修正，算完关节才知道 */
    const bodyTf = (ctx) => {
      ctx.translate(0, P.drop + gFix);
      ctx.translate(pivot[0], pivot[1]);
      ctx.rotate(P.lean);
      ctx.translate(-pivot[0], -pivot[1]);
    };
    const bodyPt = (p) => {
      const q = rotAbout(p, pivot, P.lean);
      return [q[0], q[1] + P.drop];
    };

    /* 踝目标 */
    const anks = (() => {
      if (mode === 'crouch') {
        /* 立绘是行进中姿势，两脚前后差 30px。蹲着还保持这个跨步，
           怎么调都像迈腿 —— 必须把脚往髋下方收，并且压到地面。
           收多少由 ankX 定：脚越往膝盖底下靠，小腿越接近竖直，
           读起来才是「蹲」；收得不够，小腿往后斜，读起来是「坐」。 */
        const ax = P.ankX === undefined ? 14 : P.ankX;
        return {
          back:  [S.legs.back.hip[0]  + ax, S.bot - 1],
          front: [S.legs.front.hip[0] + ax, S.bot - 1]
        };
      }
      if (mode === 'prone') {
        /* 趴下：两条腿从髋向后伸，一上一下叠着（脸朝下时后腿的髋在上侧）。
           不向后伸的话腿会折回身上 —— v3 的趴下就是那么碎的。 */
        return {
          back:  [S.legs.back.hip[0]  - 40, S.bot - P.ankBack],
          front: [S.legs.front.hip[0] - 34, S.bot - P.ankFront]
        };
      }
      return {
        back:  [S.legs.back.ank[0],  S.legs.back.ank[1]],
        front: [S.legs.front.ank[0], S.legs.front.ank[1]]
      };
    })();

    /* ---- 先解关节，再决定整体下沉多少 ----
       骨骼一弯，靴底就跟着小腿转起来：脚踝压在地面上，鞋尖却翘了。
       与其每个姿态手调 drop，不如把两只靴底旋转后的最低点找出来，
       整体往下拉，让最低点正好坐在地面。站立时修正量恰好是 0。 */
    const legs = ['back', 'front'].map((k) => {
      const L = S.legs[k];
      const hipNew = mode === 'prone'
        ? [pivot[0] + (k === 'back' ? -5 : 3), pivot[1] + P.drop + (k === 'back' ? -8 : 4)]
        : bodyPt(L.hip);
      const K = kneeOf(L);
      const L1 = Math.hypot(K[0] - L.hip[0], K[1] - L.hip[1]);
      const L2 = Math.hypot(L.ank[0] - K[0], L.ank[1] - K[1]);
      const r = ik(hipNew, L1, L2, anks[k]);
      return { k, L, K, L1, L2, hipNew, r };
    });
    /* 靴底：踝前 8 / 踝后 5 两个点，绕膝转过去取最低 */
    const soleY = (o) => {
      const a = Math.atan2(o.r.ank[1] - o.r.knee[1], o.r.ank[0] - o.r.knee[0])
              - Math.atan2(o.L.ank[1] - o.K[1], o.L.ank[0] - o.K[0]);
      const rot = (p) => [o.r.knee[0] + (p[0] - o.K[0]) * Math.cos(a) - (p[1] - o.K[1]) * Math.sin(a),
                          o.r.knee[1] + (p[0] - o.K[0]) * Math.sin(a) + (p[1] - o.K[1]) * Math.cos(a)];
      return Math.max(rot([o.L.ank[0] + 8, S.bot])[1], rot([o.L.ank[0] - 5, S.bot])[1]);
    };
    const groundFix = P.autoGround === false ? 0
      : S.bot - Math.max(soleY(legs[0]), soleY(legs[1]));
    gFix = groundFix;

    g.save();
    g.translate(ox, oy);
    g.scale(Z, Z);
    g.translate(0, -S.bot);
    /* 趴下时身体整个往 +x 长出去，往回挪一点，别撞到隔壁格 */
    if (mode === 'prone') g.translate(-60, 0);

    /* 先躯干（胯以下已经被挖掉），腿再从骨盆里长出来盖住接缝 */
    g.save();
    bodyTf(g);
    g.drawImage(torsoCv, 0, 0);
    g.restore();

    for (const { k, L, hipNew, r: rSolved } of legs) {
      hipNew[1] += groundFix;
      rSolved.knee[1] += groundFix;
      rSolved.ank[1] += groundFix;
      if (process.env.DBGPOSE === mode) {
        const KK = kneeOf(L);
        const L1 = Math.hypot(KK[0] - L.hip[0], KK[1] - L.hip[1]);
        const L2 = Math.hypot(L.ank[0] - KK[0], L.ank[1] - KK[1]);
        const t = anks[k];
        const dd = Math.hypot(t[0] - hipNew[0], t[1] - hipNew[1]);
        const r = ik(hipNew, L1, L2, t);
        console.log(mode, k, 'hip', hipNew.map(v => v.toFixed(1)).join(','),
          'ankT', t.join(','), 'd', dd.toFixed(1), 'L1+L2', (L1 + L2).toFixed(1),
          'knee', r.knee.map(v => v.toFixed(1)).join(','),
          'ank', r.ank.map(v => v.toFixed(1)).join(','));
      }
      /* 髋关节补片：在**身体坐标系**里从髋往下偏一点点，再换到世界。
         这样蹲下、趴下时它都跟着骨盆走，永远压在骨盆和大腿的接缝上。 */
      const patchC = bodyPt(rotAbout([L.hip[0] - 2, L.hip[1] - 8], L.hip, P.lean));
      patchC[1] += groundFix;
      const legObj = legs.find(o => o.k === k);
      const rr = bendLeg(g, k, hipNew, anks[k], patchC, rSolved, legObj.L1, legObj.L2);
      if (process.env.DOTS) {
        const dot = (p, col, r) => {
          g.beginPath(); g.arc(p[0], p[1], r || 2.2, 0, 7);
          g.fillStyle = col; g.fill();
        };
        g.save();
        g.strokeStyle = k === 'back' ? '#ff8a3d' : '#3dd6ff';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(hipNew[0], hipNew[1]);
        g.lineTo(rr.knee[0], rr.knee[1]);
        g.lineTo(rr.ank[0], rr.ank[1]);
        g.stroke();
        dot(hipNew, '#ffe14d', 2.6);
        dot(rr.knee, k === 'back' ? '#ff8a3d' : '#3dd6ff', 2.6);
        dot(rr.ank, '#ff3d6e', 2.6);
        g.restore();
      }
    }

    /* 头：跟着身体走，再绕颈单独抬 / 收 */
    g.save();
    bodyTf(g);
    g.translate(S.neck[0], S.neck[1]);
    g.rotate(P.headRot);
    /* 抬头之后下巴会和衣领脱开一道缝。顺着脖子把整颗头往领口压一点，
       缝就被下颌的轮廓吃掉 —— 和游戏里 PRONE_HEAD.pull 是同一招。 */
    g.translate(0, P.headPull || 0);
    g.translate(-(S.neck[0] - S.head[0]), -(S.neck[1] - S.head[1]));
    /* 头片本身是矩形，多带的衣领在头转开之后会甩出去，变成一片游离碎片。
       裁剪改成「矩形（头）+ 以颈为心的圆盘（领口）」：圆盘是旋转不变的，
       领口那一小块永远盖在脖子上，既不会甩出去，也不会露出洞。 */
    g.save();
    g.beginPath();
    /* 这里是头片自己的坐标系：左上角 = (0,0)，颈在 (颈-头) 处 */
    const nx = S.neck[0] - S.head[0], ny = S.neck[1] - S.head[1];
    g.rect(0, 0, S.head[2], ny);
    g.moveTo(nx + 17, ny);
    g.arc(nx, ny, 17, 0, 7);
    g.clip();
    g.drawImage(headCv, 0, 0);
    g.restore();
    g.restore();

    g.restore();
  }

  if (process.env.DUMP) {
    const pw = 20;
    const parts = [headCv, torsoCv, legCv.back, legCv.front];
    const totW = parts.reduce((a, c) => a + c.width + pw, 20);
    const totH = Math.max(...parts.map(c => c.height)) + 20;
    const pc = createCanvas(totW, totH), pg = pc.getContext('2d');
    pg.fillStyle = '#1b5e20'; pg.fillRect(0, 0, totW, totH);
    let x = 10;
    for (const c of parts) { pg.drawImage(c, x, 10); x += c.width + pw; }
    fs.writeFileSync(path.join(ROOT, 'shots', '_dump.png'), pc.toBuffer('image/png'));
    console.log('dump', totW + 'x' + totH);
  }

  const Z = Number(process.env.Z || 5);
  const ONLY = process.env.ONLY;
  const PAD = 260;
  const modes = VAR ? VAR.map(v => v[0]) : (ONLY ? [ONLY] : ['stand', 'crouch', 'prone']);
  const cw = (W * 2 + PAD) * Z * modes.length, chh = (H + 20) * Z;
  const cv = createCanvas(cw, chh);
  const g = cv.getContext('2d');
  if (!process.env.TRANS) {
    g.fillStyle = '#262a32'; g.fillRect(0, 0, cw, chh);
  }
  modes.forEach((m, i) => {
    curVar = VAR ? VAR[i] : null;
    if (!process.env.TRANS) {
      g.strokeStyle = '#454c58'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(i * (W * 2 + PAD) * Z, chh - 20 * Z + 2);
      g.lineTo((i + 1) * (W * 2 + PAD) * Z, chh - 20 * Z + 2);
      g.stroke();
      if (VAR) {
        g.fillStyle = '#7ee0a0'; g.font = '22px sans-serif'; g.textBaseline = 'top';
        g.fillText(VAR[i].slice(0, 7).join(' '),
                   i * (W * 2 + PAD) * Z + 12, 12);
      }
    }
    drawPose(g, i * (W * 2 + PAD) * Z + W * Z, chh - 20 * Z, Z, m);
  });
  curVar = null;
  fs.writeFileSync(path.join(ROOT, 'shots', NAME), cv.toBuffer('image/png'));
  console.log('->', 'shots/' + NAME, cv.width + 'x' + cv.height);
}

main().catch(e => { console.error(e); process.exit(1); });
