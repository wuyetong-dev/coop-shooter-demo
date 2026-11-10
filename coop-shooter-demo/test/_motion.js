/* 动觉三自由度：数值探针 + 洋葱皮叠图。
   ------------------------------------------------------------------
   验的是三件事，全都要「数字对得上」再谈好不好看：
     ① 跑动起伏 bob     —— 腿并拢时必须最高（|cos| 峰 = sin 零），既不浮空也不陷地
     ② 起步倾角 lean    —— 加速度正负决定前倾/后仰，趴下/蹲下要衰减
     ③ 换弹下沉 dip     —— 两头必须归零（否则收枪那一帧会突跳）

   还要验一件最容易错的：**枪口必须跟着一起动**。
   同一个人、同一个姿态，开不开动觉，muzzlePoint 的位移必须和
   render 里那条变换链算出来的一致 —— 差一像素，子弹就又从枪管边上飞出去。
   这一项不靠手算（手算正是上一轮的错源），直接问 canvas 要变换矩阵。

   用法：node test/_motion.js [输出前缀]
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');
const PREFIX = process.argv[2] || 'motion';
const DT = 1 / 60;

const FONTS = ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc'];
for (const f of FONTS) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) { /* 没有就算了 */ }
}

const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d');
let clock = 0;
const canvasEl = {
  width: 1280, height: 720, style: {},
  getContext: () => ctx,
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};
const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams,
  Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock },
  requestAnimationFrame: () => 0,
  addEventListener: () => {},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  document: { getElementById: () => canvasEl, createElement: () => createCanvas(8, 8) }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);

const ORDER = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js'];
for (const f of ORDER) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });
}

const api = vm.runInContext(`({
  get game(){ return game; },
  get player(){ return player; },
  get buddy(){ return buddy; },
  get enemies(){ return enemies; },
  get camera(){ return camera; },
  get world(){ return world; },
  get VIEW_ZOOM(){ return VIEW_ZOOM; },
  get CAM_TY(){ return CAM_TY; },
  frame, render
})`, ctxVm);

function step(n) {
  for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); }
}

/* 世界 → 屏幕（与 render.js 的世界层变换完全一致） */
const sX = wx => (wx - api.camera.x) * api.VIEW_ZOOM;
const sY = wy => wy * api.VIEW_ZOOM + api.CAM_TY;

async function settle(maxMs = 3000) {
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < maxMs) {
    ok = vm.runInContext(
      `(typeof whaleSpriteReady==='function'&&whaleSpriteReady())&&(typeof whaleHoldReady==='function'&&whaleHoldReady())` +
      `&&(typeof heroSpriteReady==='function'&&heroSpriteReady())&&(typeof heroHoldReady==='function'&&heroHoldReady())`,
      ctxVm);
    if (ok) break;
    await new Promise(r => setTimeout(r, 60));
  }
  return ok;
}

/* 把动觉的输入拨到指定值，然后问一次 motionOf。
   _dt 手动写死、_moNo 清缓存 —— 不然同一帧问两次会拿到上一个人的旧值。
   vxPrev 单独给，是为了让 (vx - vxPrev)/dt 正好等于想测的那个加速度：
   只写 _accSm 是不够的，motionOf 每帧都会拿它跟「这一帧真实加速度」做平滑，
   vx 不变就等于加速度突然归零，一帧就把值拽回去 9%。 */
function probe(nb, opts) {
  const a = api.buddy;
  a.look = 'whale';
  a.x = nb.x; a.y = nb.y; a.vx = nb.vx; a.anim = nb.anim; a.aim = nb.aim;
  a.crouch = nb.crouch || 0; a.prone = nb.prone || 0;
  a.onGround = true;
  a._accSm = opts.accSm || 0;
  a._vxPrev = (opts.vxPrev !== undefined) ? opts.vxPrev : nb.vx;
  a._moNo = -1; a._mo = null;
  vm.runInContext('_dt = ' + opts.dt + '; _frameNo = (_frameNo|0) + 1;', ctxVm);
  return vm.runInContext('motionOf(buddy)', ctxVm);
}

/* 恒定加速度跑 n 帧，取收敛后的姿态。
   平滑系数 1-0.0025^dt ≈ 0.116/帧 → 时间常数约 8.6 帧（0.14 秒），
   跑 60 帧（1 秒）残差只剩 0.3%，可以当成「顶到上限」。 */
function converge(nb, acc, frames) {
  let mo = null;
  for (let i = 0; i < frames; i++) {
    /* 每帧都让 (vx - vxPrev)/dt === acc，假装这一帧确实在以 acc 加速 */
    mo = probe(nb, { accSm: api.buddy._accSm || 0, vxPrev: nb.vx - acc * DT, dt: DT });
  }
  return mo;
}

let fails = 0;
function ok(cond, label, detail) {
  if (!cond) fails++;
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (detail !== undefined ? '  ' + detail : ''));
}

(async () => {
  const sprites = await settle();
  console.log('立绘就绪：' + (sprites ? '✓' : '✗（退化了，下面的图不可信）'));
  fs.mkdirSync(OUT, { recursive: true });

  api.game.state = 'play';
  vm.runInContext('startStage(5)', ctxVm);
  step(40);
  api.enemies.length = 0;
  step(6);

  const p = api.player, b = api.buddy;
  const HOME = { x: p.x, y: p.y };
  b.muzzle = 0; b.landSquash = 0;

  /* ---------- ① 跑动起伏 ---------- */
  console.log('\n--- ① 跑动起伏 bob（全速 290）---');
  const BOB = [];
  for (let i = 0; i <= 8; i++) {
    const ph = i / 8 * Math.PI * 2;
    const mo = probe({ ...HOME, vx: 290, anim: ph, aim: 0 }, { dt: 0 });
    /* 腿相 = sin(anim)：sin 过零时两腿并拢 → 人应该最高（|cos| 最大） */
    BOB.push({ ph, bob: mo.bob, leg: Math.sin(ph) });
  }
  for (const r of BOB) {
    const bar = '█'.repeat(Math.round(r.bob / 2.4 * 18));
    console.log('  anim=' + r.ph.toFixed(2) + '  腿=' + (r.leg >= 0 ? '+' : '') + r.leg.toFixed(2) +
      '  bob=' + r.bob.toFixed(2).padStart(5) + '  ' + bar);
  }
  const bobs = BOB.map(r => r.bob);
  ok(Math.min(...bobs) < 0.15, '起伏最低点归零（腿张开时不悬空）', 'min=' + Math.min(...bobs).toFixed(3));
  ok(Math.abs(Math.max(...bobs) - 2.4) < 0.12, '起伏峰值 = BOB_AMP', 'max=' + Math.max(...bobs).toFixed(2));
  /* 峰值相位必须落在腿过零（两腿并拢）那一帧，否则读起来就是「踩空」 */
  const peakAt = BOB.reduce((a, r) => r.bob > a.bob ? r : a, BOB[0]);
  ok(Math.abs(peakAt.leg) < 0.01, '峰值落在腿并拢那一帧（相位对齐）', 'leg=' + peakAt.leg.toFixed(3));
  /* bob 永远 >= 0：中立姿态已经是最低点，只往上弹不往下沉，脚才不会穿地板 */
  ok(bobs.every(v => v >= 0), '起伏恒为非负（只弹起不下沉、不穿地）',
    'min=' + Math.min(...bobs).toFixed(3));

  /* 站定时换成呼吸：不能是 0，否则人彻底死了 */
  const idle = probe({ ...HOME, vx: 0, anim: 0, aim: 0 }, { dt: 0 });
  ok(Math.abs(idle.bob) > 0.01 && Math.abs(idle.bob) <= 0.45, '待机呼吸有幅度且不超过半像素', 'bob=' + idle.bob.toFixed(3));
  const proneMo = probe({ ...HOME, vx: 0, anim: 0, aim: 0, prone: 1 }, { dt: 0 });
  ok(Math.abs(proneMo.bob) < 1e-6, '趴下不起伏（贴地了）', 'bob=' + proneMo.bob.toFixed(4));
  const crouchMo = probe({ ...HOME, vx: 0, anim: 0, aim: 0, crouch: 1 }, { dt: 0 });
  ok(Math.abs(crouchMo.bob) < 1e-6, '蹲下不呼吸（蹲姿没有呼吸支）', 'bob=' + crouchMo.bob.toFixed(4));

  /* ---------- ② 起步倾角 ---------- */
  console.log('\n--- ② 起步前倾 / 急停后仰 lean（参考加速度 2600）---');
  /* 注意：deg 必须返回数字。返回 toFixed 的字符串时，
     `deg(x) - 3.55` 能算（减号会强转），`deg(x) + 3.55` 却变成字符串拼接，
     判断静默恒假 —— 这类错必须当场掐掉，不能靠运气。 */
  const deg = r => r * 180 / Math.PI;
  const degS = r => deg(r).toFixed(2);
  const runFwd = { ...HOME, vx: 290, anim: 0.6, aim: 0 };
  const L = [];
  for (const acc of [-2600, -1300, 0, 1300, 2600]) {
    const mo = acc === 0
      ? probe(runFwd, { dt: DT, accSm: 0 })
      : converge(runFwd, acc, 60);
    L.push({ acc, lean: mo.lean });
    console.log('  acc=' + String(acc).padStart(6) + '  lean=' + mo.lean.toFixed(4) + ' rad = ' +
      degS(mo.lean).padStart(6) + '°');
  }
  ok(Math.abs(deg(L[4].lean) - 3.55) < 0.25, '满加速度 → 前倾 ≈3.6°', degS(L[4].lean) + '°');
  ok(Math.abs(deg(L[0].lean) + 3.55) < 0.25, '急停 → 后仰 ≈3.6°', degS(L[0].lean) + '°');
  ok(Math.abs(L[2].lean) < 1e-6, '匀速 → 不倾', '0');

  /* 方向反转时倾角要跟着翻：往回跑还往前倒就是「滑冰」。
     面朝左（aim=π）起步向左，vx 从 0 变负 → 加速度是负的。 */
  const runBack = { ...HOME, vx: -290, anim: 0.6, aim: Math.PI };
  const back = converge(runBack, -2600, 60);
  ok(back.lean > 0.05, '面朝左起步 → 仍朝行进方向前倾（facing 抵消负加速度）',
    'lean=+' + degS(back.lean) + '°');
  ok(Math.abs(back.lean - L[4].lean) < 0.01, '左右起步倾角对称', 'Δ=' + (back.lean - L[4].lean).toFixed(4));

  const crouchL = converge({ ...HOME, vx: 290, anim: 0.6, aim: 0, crouch: 1 }, 2600, 60);
  ok(Math.abs(crouchL.lean) < Math.abs(L[4].lean) * 0.6, '蹲下时倾角衰减到 55%',
    degS(crouchL.lean) + '° vs ' + degS(L[4].lean) + '°');
  const proneL = converge({ ...HOME, vx: 100, anim: 0.6, aim: 0, prone: 1 }, 2600, 60);
  ok(Math.abs(proneL.lean) < Math.abs(L[4].lean) * 0.15, '趴下时几乎不倾（不然戳进地板）',
    degS(proneL.lean) + '°');

  /* _dt = 0 时不许积分加速度：无头回归图靠这条才可复现 */
  const noDt = probe(runFwd, { dt: 0, accSm: 2600, vxPrev: 0 });
  ok(Math.abs(noDt.lean) < 1e-6, '_dt=0 不积分加速度（回归可复现）', 'lean=' + noDt.lean.toFixed(4));

  /* ---------- ③ 换弹下沉 ---------- */
  console.log('\n--- ③ 换弹下沉 gunDip（包络 sin(π·rp)）---');
  const D = [];
  for (let i = 0; i <= 4; i++) {
    const rp = i / 4;
    b.reloadDur = 2.0; b.reloading = 2.0 * (1 - rp); b.reloadT = 0; b.reload = 0;
    const d = vm.runInContext('gunDip(buddy)', ctxVm);
    D.push({ rp, dy: d.dy, rot: d.rot });
    console.log('  进度=' + (rp * 100).toFixed(0).padStart(3) + '%  dy=' + d.dy.toFixed(2).padStart(5) +
      'px  rot=' + degS(d.rot).padStart(5) + '°');
  }
  b.reloading = 0; b.reloadDur = 0;
  ok(Math.abs(D[0].dy) < 1e-9 && Math.abs(D[4].dy) < 1e-9, '两头归零（收枪不突跳）',
    D[0].dy.toFixed(4) + ' / ' + D[4].dy.toFixed(4));
  ok(Math.abs(D[2].dy - 7.5) < 1e-6, '中段最深 7.5px', D[2].dy.toFixed(2));
  ok(D[2].rot > 0.25, '中段枪口垂 17°', degS(D[2].rot) + '°');

  /* 敌兵那条路（reloadT/reload）必须和玩家那条给出同一条包络，
     否则同一把枪玩家换弹是沉的、敌人换弹是浮的。 */
  b.reloading = 0; b.reloadDur = 0;
  b.reloadT = 1.0; b.reload = 2.0;
  const dEnemy = vm.runInContext('gunDip(buddy)', ctxVm);
  b.reloadT = 0; b.reload = 0;
  ok(Math.abs(dEnemy.dy - D[2].dy) < 1e-6, '敌兵换弹包络与玩家一致', dEnemy.dy.toFixed(2) + 'px');
  ok(Math.abs(vm.runInContext('gunDip(buddy).dy', ctxVm)) < 1e-9, '不换弹时不起作用（常态零开销）', '0');

  /* ---------- ④ 枪口必须跟着动 ---------- */
  /* 这是整套动觉最容易翻车的地方：render 里 rotate(lean) + translate(0,-bob)，
     muzzlePoint 里必须原路反推回去。差一像素，子弹又从枪管边上飞出去。

     校验办法：motionOf 有逐帧缓存（_moNo === _frameNo 就直接返回 _mo），
     于是可以**直接往缓存里喂一个指定的 {bob, lean}**，精确控制自由度，
     其余输入（aim / 姿态 / 枪的挂点）完全不动。这样比的就不是「我和公式谁对」，
     而是「同一个点经过四种组合后，相对脚底的关系是否自洽」——
     不需要手推任何旋转，也不受 whaleLean 干扰。 */
  console.log('\n--- ④ 枪口跟随（动觉开 vs 关）---');
  const base = { ...HOME, vx: 290, anim: 0, aim: 0 };
  b.muzzle = 0;
  probe(base, { dt: 0 });

  const fno = vm.runInContext('_frameNo', ctxVm);
  function seeded(bob, lean) {
    b._moNo = fno; b._mo = { bob: bob, lean: lean };
    return vm.runInContext('muzzlePoint(buddy)', ctxVm);
  }

  const B0 = 1.0890, L0 = 0.0618;                 /* 典型一帧：起伏 1.09px、前倾 3.54° */
  const m00 = seeded(0, 0);
  const mB0 = seeded(B0, 0);                      /* 只起伏 */
  const mL0 = seeded(0, L0);                      /* 只倾 */
  const mBL = seeded(B0, L0);                     /* 两样一起 */
  console.log('  静止  muzzle=(' + m00.x.toFixed(2) + ', ' + m00.y.toFixed(2) + ')');
  console.log('  起步  muzzle=(' + mBL.x.toFixed(2) + ', ' + mBL.y.toFixed(2) + ')  Δ=(' +
    (mBL.x - m00.x).toFixed(2) + ', ' + (mBL.y - m00.y).toFixed(2) + ')');
  /* 两样一起时看**总位移**，不看单轴：bob 把枪口往上压、lean 把它往前上方甩，
     在某个挂点高度上这两者会在 y 上几乎抵消（这一版就是 Δy=0.02）——
     抵消是几何结果，不是「没动」。分轴的正确性由下面 ①② 两条分别管。 */
  ok(Math.hypot(mBL.x - m00.x, mBL.y - m00.y) > 0.5, '枪口真的跟着动了（画上动、判定也动）',
    '|Δ|=' + Math.hypot(mBL.x - m00.x, mBL.y - m00.y).toFixed(2));

  /* 用 canvas 的矩阵算旋转，不手推：读 a b c d e f 按定义式展开 */
  function rot(pt, ang, ox, oy) {
    const g = createCanvas(8, 8).getContext('2d');
    g.translate(ox, oy); g.rotate(ang); g.translate(-ox, -oy);
    const M = g.getTransform();
    return { x: M.a * pt.x + M.c * pt.y + M.e, y: M.b * pt.x + M.d * pt.y + M.f };
  }

  /* ① 只起伏：必须正好是「往上 B0」，横向不许动（走的是 translate(0,-bob)） */
  const dB = { x: mB0.x - m00.x, y: mB0.y - m00.y };
  console.log('  只起伏 Δ=(' + dB.x.toFixed(3) + ', ' + dB.y.toFixed(3) + ')  期望 (0, ' + (-B0).toFixed(3) + ')');
  ok(Math.abs(dB.x) < 0.02 && Math.abs(dB.y + B0) < 0.02,
    '起伏只往上、不横移（脚不离地）', 'Δ=(' + dB.x.toFixed(3) + ', ' + dB.y.toFixed(3) + ')');

  /* ② 倾身到底往哪走。
     注意这里**不能**断言「枪口到脚底的距离不变」——
     枪在倾身时被反向抵平、保持绝对俯仰角，所以身体转了、枪没转，
     枪口反而是绕着掌心甩的，半径必然变。上一版就是因为这条错断言误报。
     能断言的是方向：往前倾（+angle）时，掌心跟着往前，枪口必然往 +x 走。 */
  const dL = { x: mL0.x - m00.x, y: mL0.y - m00.y };
  console.log('  只倾 Δ=(' + dL.x.toFixed(3) + ', ' + dL.y.toFixed(3) + ')');
  ok(dL.x > 0.05, '前倾把枪口往前带（不是往后翻）', 'Δx=' + dL.x.toFixed(3));
  ok(Math.hypot(dL.x, dL.y) > 0.1, '倾身确实改变了枪口位置（不是画上动、判定不动）',
    '|Δ|=' + Math.hypot(dL.x, dL.y).toFixed(2));

  /* ③ 复合顺序：bob 必须在「转之前」的本地系里减。
     这条不需要知道掌心在哪、枪有多长 —— 同一个 lean、同一把枪，
     开不开 bob 的差，只能是 -R(lean)·(0,bob)。顺序写反就会变成 -(0,bob)，
     在大角度下两者差出 bob·sinθ，一眼可辨。
     平瞄那 3.5° 太小（只差 0.07px），故意拨到 0.5rad ≈ 28.6° 来放大。 */
  const LBIG = 0.5, BBIG = 6.0;
  const lZero = seeded(0, LBIG);
  const lBoth = seeded(BBIG, LBIG);
  const wantD = rot({ x: HOME.x, y: HOME.y - BBIG }, LBIG, HOME.x, HOME.y);
  const expDx = wantD.x - HOME.x, expDy = wantD.y - HOME.y;
  const gotDx = lBoth.x - lZero.x, gotDy = lBoth.y - lZero.y;
  console.log('  ' + (LBIG * 180 / Math.PI).toFixed(0) + '° 倾身下开 bob ' + BBIG + 'px：实测 Δ=(' +
    gotDx.toFixed(2) + ', ' + gotDy.toFixed(2) + ')  期望 (' + expDx.toFixed(2) + ', ' + expDy.toFixed(2) + ')');
  ok(Math.abs(gotDx - expDx) < 0.02 && Math.abs(gotDy - expDy) < 0.02,
    'bob 在旋转之前的本地系里减（顺序正确）',
    'Δ=(' + (gotDx - expDx).toFixed(3) + ', ' + (gotDy - expDy).toFixed(3) + ')');
  /* 反证：顺序写反时答案会变成纯竖直的 -(0,BBIG) —— 判据必须能把它认出来 */
  const wrongDy = -BBIG;
  ok(Math.hypot(gotDx - 0, gotDy - wrongDy) > 1.0, '顺序写反会被这套判据抓住（判据非空）',
    '反证偏差=' + Math.hypot(gotDx, gotDy - wrongDy).toFixed(2) + 'px');

  /* 换弹时枪口也要跟着枪走：子弹是从「那一刻的枪管」出来的 */
  b._moNo = -1; b._mo = null;
  probe(base, { dt: 0 });
  b.muzzle = 0; b.reloadDur = 2.0; b.reloading = 1.0;   /* 进度 50% */
  const muDip = vm.runInContext('muzzlePoint(buddy)', ctxVm);
  b.reloading = 0; b.reloadDur = 0;
  console.log('  换弹中 muzzle=(' + muDip.x.toFixed(2) + ', ' + muDip.y.toFixed(2) + ')');
  ok(Math.abs(muDip.y - m00.y) > 2, '换弹下沉时枪口也跟着垂下去',
    'Δy=' + (muDip.y - m00.y).toFixed(2));

  /* ---------- 洋葱皮叠图：起伏与倾角各一张 ---------- */
  console.log('\n--- 洋葱皮叠图 ---');
  const p0 = api.player;
  p0.x = -9999;                       /* 主角挪出画面，只留大肥鱼 */

  vm.runInContext(`window.__drawOnly = function(){
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(0, CAM_TY); ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
    drawSoldier(buddy, false);
    ctx.restore();
  };`, ctxVm);

  const SHEET_W = 1280, SHEET_H = 720;
  const outs = [];

  async function onion(name, title, frames, alpha) {
    const c = createCanvas(SHEET_W, SHEET_H);
    const g = c.getContext('2d');
    g.fillStyle = '#0b1016';
    g.fillRect(0, 0, SHEET_W, SHEET_H);

    for (const f of frames) {
      probe({ ...HOME, vx: 290, anim: f.anim, aim: 0 }, { dt: 0, accSm: 0 });
      if (f.acc) converge({ ...HOME, vx: 290, anim: f.anim, aim: 0 }, f.acc, 60);
      vm.runInContext('__drawOnly()', ctxVm);
      g.save();
      g.globalAlpha = alpha;
      g.drawImage(canvas, 0, 0);
      g.restore();
    }

    /* 脚下基准线 + 起伏峰值线：到底弹了多高，一眼能量出来 */
    const footY = sY(HOME.y);
    const peakY = footY - 2.4 * api.VIEW_ZOOM;
    g.setLineDash([6, 5]);
    g.lineWidth = 1.5;
    g.strokeStyle = '#ff6b6b';
    g.beginPath(); g.moveTo(0, footY); g.lineTo(SHEET_W, footY); g.stroke();
    g.strokeStyle = '#4fd8ff';
    g.beginPath(); g.moveTo(0, peakY); g.lineTo(SHEET_W, peakY); g.stroke();
    g.setLineDash([]);

    g.fillStyle = '#e8f0f8';
    g.font = 'bold 20px "Microsoft YaHei",sans-serif';
    g.textBaseline = 'top';
    g.fillText(title, 24, 18);
    g.fillStyle = '#ff6b6b';
    g.font = '13px "Microsoft YaHei",sans-serif';
    g.fillText('脚底基准（红线：起伏再大，脚也不许离线）', 24, footY + 6);
    g.fillStyle = '#4fd8ff';
    g.fillText('起伏峰值 +' + (2.4 * api.VIEW_ZOOM).toFixed(1) + 'px（蓝线）', 24, peakY - 20);

    const file = path.join(OUT, PREFIX + '-' + name + '.png');
    fs.writeFileSync(file, await c.encode('png'));
    console.log('  ✓ shots/' + PREFIX + '-' + name + '.png');
    outs.push(file);
  }

  await onion('bob', '① 跑动起伏：8 相位洋葱皮（腿并拢时最高）',
    BOB.map(r => ({ anim: r.ph })), 0.26);
  await onion('lean', '② 起步前倾 / 匀速 / 急停后仰（三个姿态叠一起）', [
    { anim: 0, acc: -2600 },
    { anim: 0, acc: 0 },
    { anim: 0, acc: 2600 }
  ], 0.42);

  console.log(fails === 0 ? '\n动觉验收通过 ✓' : '\n✗ ' + fails + ' 项未通过');
  process.exit(fails === 0 ? 0 : 1);
})();
