/* 扑倒 / 起身：过渡曲线验收 + 洋葱皮
   ------------------------------------------------------------------
   为什么单独做一套：姿态的**稳态**（h=28 / hitW=66 / 84.6°）已经有
   test/headless.js 第 8 节钉死了，但「躺下去那 0.24 秒好不好看」不在
   任何判据里 —— 而这正是玩家感知「动作生硬」的地方。

   原来的实现是每帧指数插值：
       prone = lerp(prone, want, 1 - Math.pow(0.0004, dt))
   数学上连续、永远收敛，但有三个手感问题，全是曲线形状带来的：
     · 第一帧就倒下 12.2%（速度从 0 直接跳到上限）→ 读成「弹射」
     · 到 0.12 秒已经躺了 61%，剩下 0.2 秒在磨最后 39% → 尾巴拖沓
     · 扑倒和起身共用一条曲线 → 站起来跟躺下去一样省力，不成立

   现在换成「时长 + 缓动」补间（util.js poseStep）：
     · 扑倒 0.24 秒，二次加速（θ ∝ t²，恒力矩下的真实角位移）
     · 起身 0.36 秒，S 形（两头慢：收重心 / 稳住）
   本脚本要证明的就是「形状真的变了」，而不只是「还在动」。
   每条形状判据都配一条反证，否则无法区分「真通过」和「空检查」。

   用法：node test/_fall.js
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');

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
  get enemies(){ return enemies; },
  get keys(){ return keys; },
  get camera(){ return camera; },
  get world(){ return world; },
  get VIEW_ZOOM(){ return VIEW_ZOOM; },
  get CAM_TY(){ return CAM_TY; },
  proneK, cqEff, stanceH, stanceHitW, pronePose, proneHead,
  PRONE_FLAT, POSE_FALL_T, POSE_RISE_T, poseIn, poseInOut,
  startStage, update
})`, ctxVm);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra === undefined ? '' : '  ' + extra)); }
  else { fail++; console.log('  ❌ ' + name + (extra === undefined ? '' : '  ' + extra)); }
}
const DT = 1 / 60;
const f3 = v => (v === undefined || v === null ? '-' : v.toFixed(3));

/* 立绘解码要等一个事件循环 tick，否则是矢量兜底 */
async function settle(maxMs = 2000) {
  const t0 = Date.now();
  let good = false;
  while (Date.now() - t0 < maxMs) {
    good = vm.runInContext(
      `(typeof whaleSpriteReady==='function'&&whaleSpriteReady())&&(typeof whaleHoldReady==='function'&&whaleHoldReady())` +
      `&&(typeof heroSpriteReady==='function'&&heroSpriteReady())&&(typeof heroHoldReady==='function'&&heroHoldReady())`,
      ctxVm);
    if (good) break;
    await new Promise(r => setTimeout(r, 60));
  }
  return good;
}

const toScreenY = wy => (wy - api.world.groundY) * api.VIEW_ZOOM + (720 - 78);
const toScreenX = wx => (wx - api.camera.x) * api.VIEW_ZOOM;

/* 只跑 update：render 对过渡曲线没有输入，而且一帧 render 比 update 贵十倍 */
function tick(n, fn) {
  for (let i = 0; i < n; i++) {
    if (fn) fn(i);
    api.update(DT);
  }
  return api.player;
}

/* 逐帧记录必须**在 update 之后**取。先取再 update 会整体错一位：
   第一条永远是「按下去之前的 0」，于是「第一帧只动 <2%」变成空检查 ——
   它测的是「还没按的时候 prone 是 0」，当然永远通过。 */
function record(n, arr) {
  for (let i = 0; i < n; i++) { api.update(DT); arr.push(api.proneK(api.player)); }
}

/* ==================================================================
   ① 曲线形状：纯数学，先钉死「这是哪条曲线」
   ================================================================== */
console.log('--- ① 过渡曲线形状 ---');
{
  const { poseIn, poseInOut, POSE_FALL_T, POSE_RISE_T } = api;

  ok('端点精确：poseIn(0)=0 / poseIn(1)=1',
    poseIn(0) === 0 && poseIn(1) === 1, f3(poseIn(0)) + ' / ' + f3(poseIn(1)));

  /* 二次曲线在中点必然是 0.25 —— 这条同时排除了线性(0.5)和三次(0.125) */
  ok('poseIn(0.5)=0.25（二次 → 半程只倒下 1/4）',
    Math.abs(poseIn(0.5) - 0.25) < 1e-9, f3(poseIn(0.5)));

  /* 反证：换成三次曲线会在 0.5 处得到 0.125，两者差 0.125，
     远大于本判据的 1e-9 容差 —— 说明这条判据不是空的。 */
  const cubic = 0.5 * 0.5 * 0.5;
  ok('判据能分出二次与三次（非空检查）',
    Math.abs(poseIn(0.5) - cubic) > 0.10, 'Δ=' + f3(Math.abs(poseIn(0.5) - cubic)));

  /* 恒力矩角位移的特征：每一点都比前一点快，直到着地 */
  let accelAll = true, dPrev = -1;
  for (let i = 1; i <= 20; i++) {
    const d = poseIn(i / 20) - poseIn((i - 1) / 20);
    if (d < dPrev - 1e-9) { accelAll = false; break; }
    dPrev = d;
  }
  ok('单调递增且逐段加速（越倒越快，着地急停）', accelAll,
    '首段=' + poseIn(0.05).toFixed(4) + ' 末段=' + (poseIn(1) - poseIn(0.95)).toFixed(4));

  /* 起身的 S 形：两头导数为 0 —— 起手慢（收重心）、收尾慢（稳住） */
  const slope = (fn, u) => (fn(Math.min(1, u + 1e-4)) - fn(Math.max(0, u - 1e-4))) / (2e-4);
  const s0 = slope(poseInOut, 0.0001), s5 = slope(poseInOut, 0.5), s1 = slope(poseInOut, 0.9999);
  ok('起身：起手慢 + 收尾稳（两端斜率≈0）',
    s0 < 0.02 && s1 < 0.02, 'k(0)=' + s0.toFixed(4) + ' k(1)=' + s1.toFixed(4));
  ok('起身：中段最快（撑起来）', Math.abs(s5 - 1.5) < 0.01, 'k(0.5)=' + s5.toFixed(3));
  ok('起身：中心对称 poseInOut(u)+poseInOut(1-u)=1',
    Math.abs(poseInOut(0.3) + poseInOut(0.7) - 1) < 1e-9,
    f3(poseInOut(0.3)) + ' + ' + f3(poseInOut(0.7)));

  ok('起身比扑倒慢 50%', Math.abs(POSE_RISE_T / POSE_FALL_T - 1.5) < 1e-9,
    f3(POSE_FALL_T) + 's → ' + f3(POSE_RISE_T) + 's');
}

/* ==================================================================
   ② 真实循环：玩家按 Z，逐帧记录 prone
   ================================================================== */
console.log('\n--- ② 扑倒：逐帧采样（真实 update 循环） ---');
api.game.state = 'playing';
vm.runInContext('startStage(5)', ctxVm);
/* 注意：player 是 startStage 里创建/重建的，必须**在这之后**取引用，
   否则拿到的是 null（上一个会话在这里栽过一次，报 cannot set 'vy' of null） */
const p = api.player;
api.enemies.length = 0;
api.game.spawnQueue.length = 0;
p.vy = 0; p.onGround = true; p.dashTime = 0;
p.prone = 0; p.pronePs = null;
tick(10);

const fallSeries = [];
api.keys['KeyZ'] = true;
record(40, fallSeries);
api.keys['KeyZ'] = false;

let fallFrames = 0;
for (let i = 0; i < fallSeries.length; i++) { if (fallSeries[i] >= 0.999) { fallFrames = i + 1; break; } }

console.log('   帧  prone     Δ');
for (let i = 0; i < Math.min(fallFrames + 2, 18); i++) {
  const d = i === 0 ? fallSeries[0] : fallSeries[i] - fallSeries[i - 1];
  console.log('   ' + String(i + 1).padStart(2) + '   ' + f3(fallSeries[i]) + '   ' +
    (d >= 0 ? '+' : '') + f3(d) + (i === fallFrames - 1 ? '   ← 到位' : ''));
}
console.log('   到位后继续按 24 帧仍保持 ' + f3(fallSeries[fallSeries.length - 1]));

ok('扑倒 0.24 秒 ≈ 14~16 帧（60fps）', fallFrames >= 13 && fallFrames <= 17, fallFrames + ' 帧');
ok('扑倒终值精确 1.000（不是 0.98 收敛）', fallSeries[fallSeries.length - 1] >= 0.999,
  f3(fallSeries[fallSeries.length - 1]));

/* 半程只躺下 25%：这是「先看见人在往下倒，而不是先发呆再砸」的量化定义 */
const halfFrame = Math.floor(fallFrames / 2);
ok('半程只躺到 ≈25%（不是旧曲线的 61%）',
  Math.abs(fallSeries[halfFrame] - 0.25) < 0.06,
  '第 ' + (halfFrame + 1) + ' 帧 = ' + f3(fallSeries[halfFrame]));

/* 第一帧微小：从静止起步，不能「弹射」 */
ok('第一帧只动 <2%（起步不弹射）', fallSeries[0] < 0.02, 'Δ1=' + f3(fallSeries[0]));
/* 反证：旧指数曲线第一帧就是 12.2%，判据能把它抓出来 */
const oldFirst = 1 - Math.pow(0.0004, DT);
ok('旧曲线会被这条判据抓住（判据非空）', oldFirst > 0.10, '旧 Δ1=' + f3(oldFirst));

/* 每帧增量递增 —— 「越倒越快」的直接证据。
   末帧要排除：补间把 t 夹到 dur，最后一步只走剩下的零头，
   那一步的增量必然比前一步小（0.130 → 0.055），不是曲线的问题。 */
let incr = true, dPrev2 = -1;
for (let i = 1; i < fallFrames - 1; i++) {
  const d = fallSeries[i] - fallSeries[i - 1];
  if (d < dPrev2 - 1e-6) { incr = false; }
  dPrev2 = d;
}
ok('扑倒每帧增量单调不减（二次加速）', incr, '倒数第二帧 Δ=' + f3(dPrev2) +
  '，末帧只走零头 Δ=' + f3(fallSeries[fallFrames - 1] - fallSeries[fallFrames - 2]));

console.log('\n--- ③ 起身：逐帧采样 ---');
const riseSeries = [];
api.keys['KeyZ'] = false;
record(40, riseSeries);

let riseFrames = 0;
for (let i = 0; i < riseSeries.length; i++) { if (riseSeries[i] <= 0.001) { riseFrames = i + 1; break; } }
console.log('   帧  prone     Δ');
for (let i = 0; i < Math.min(riseFrames + 2, 24); i++) {
  const d = i === 0 ? riseSeries[0] - 1 : riseSeries[i] - riseSeries[i - 1];
  console.log('   ' + String(i + 1).padStart(2) + '   ' + f3(riseSeries[i]) + '   ' +
    (d >= 0 ? '+' : '') + f3(d) + (i === riseFrames - 1 ? '   ← 站定' : ''));
}

ok('起身 0.36 秒 ≈ 21~23 帧', riseFrames >= 20 && riseFrames <= 25, riseFrames + ' 帧');
ok('起身明显长于扑倒（起得慢是姿态的代价）', riseFrames > fallFrames + 3,
  riseFrames + ' vs ' + fallFrames);
ok('起身终值精确 0.000', riseSeries[riseSeries.length - 1] <= 0.001,
  f3(riseSeries[riseSeries.length - 1]));

const riseFirst = 1 - riseSeries[0];
const riseLast = riseSeries[riseFrames - 2] - riseSeries[riseFrames - 1];
ok('起身两头慢（首帧 Δ 与末帧 Δ 都小于中段）', riseFirst < 0.02 && riseLast < 0.03,
  '首=' + f3(riseFirst) + ' 末=' + f3(riseLast));

/* ==================================================================
   ④ 半路反悔：趴到一半松手、松手又按住
   ================================================================== */
console.log('\n--- ④ 半路反悔不跳变 ---');
{
  p.prone = 0; p.pronePs = null;
  tick(4);
  api.keys['KeyZ'] = true;
  tick(6);                                   /* 倒到一半 */
  const mid = api.proneK(p);
  api.keys['KeyZ'] = false;
  api.update(DT);
  const afterRelease = api.proneK(p);
  ok('松手后从当前值起步（单帧不跳变）', Math.abs(afterRelease - mid) < 0.06,
    f3(mid) + ' → ' + f3(afterRelease));

  tick(3);
  const before2 = api.proneK(p);
  api.keys['KeyZ'] = true;
  api.update(DT);
  const afterPress = api.proneK(p);
  ok('半路再按住也不跳变', Math.abs(afterPress - before2) < 0.06,
    f3(before2) + ' → ' + f3(afterPress));
  ok('反悔时「从哪儿起」落在 0..1 之间', mid > 0.05 && mid < 0.95, 'mid=' + f3(mid));
  api.keys['KeyZ'] = false;
  tick(40);
  ok('反悔后仍能正常归零', api.proneK(p) < 0.02, f3(api.proneK(p)));
}

/* ==================================================================
   ⑤ 过渡中间不能穿地
   ------------------------------------------------------------------
   绕脚底转 84.6° 时，身体最前端的点是往**下**走的（x·sinθ > |y|·cosθ），
   所以 pronePose 才要 shift + lift。稳态贴地是验过的，但中间态
   （θ=30°~60°）没有任何判据 —— 如果 lift 跟 prone 线性、而穿地量是
   三角函数的，中间就可能一头扎进地里。这里逐档量最低不透明像素。
   ================================================================== */
console.log('\n--- ⑤ 过渡中间是否穿地 ---');
vm.runInContext(`window.__soldierOnly = function(){
  ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(0, CAM_TY); ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  drawSoldier(player, false);
  ctx.restore();
};`, ctxVm);

const groundScreenY = toScreenY(api.world.groundY);
console.log('   prone   最低像素 - 地面(屏幕px)   折算世界px');
{
  const keep = {
    prone: p.prone, aim: p.aim, vx: p.vx, anim: p.anim, muzzle: p.muzzle,
    reloading: p.reloading, crouch: p.crouch
  };
  p.aim = 0; p.vx = 0; p.anim = 0; p.muzzle = 0; p.reloading = 0; p.crouch = 0;
  const dips = [];
  for (let i = 0; i <= 10; i++) {
    p.prone = i / 10;
    vm.runInContext('__soldierOnly()', ctxVm);
    const data = ctx.getImageData(0, 0, 1280, 720).data;
    let lowY = -1;
    for (let y = 719; y >= 0 && lowY < 0; y--) {
      const base = y * 1280 * 4;
      for (let x = 0; x < 1280; x++) {
        if (data[base + x * 4 + 3] > 16) { lowY = y; break; }
      }
    }
    const dip = lowY < 0 ? null : (lowY - groundScreenY) / api.VIEW_ZOOM;
    dips.push(dip);
    console.log('   ' + f3(i / 10) + '   ' +
      (dip === null ? '（空帧）' : (dip >= 0 ? '+' : '') + String(dip.toFixed(1)).padStart(6)) +
      '                  ' + (dip === null ? '-' : (dip >= 0 ? '+' : '') + dip.toFixed(1)));
  }
  /* 量到的「最低像素」其实是**脚下那圈投影**（chars.js 892 行的 ellipse，
     中心在 under+1、半高 4.8），不是鞋底 —— 所以 0 到 0.9 全都稳稳停在
     +4.9，这条直线本身就是证据：过渡中间没有任何一个部位比站立时更低。
     唯一更深的是 pr=1.0 的鞋尖（再往下 3.3px），那是刻意的「压进土里」。 */
  const floor = dips[0];
  const worst = dips.reduce((m, d) => (d === null ? m : Math.max(m, d)), -999);
  const flat = dips.slice(0, 10).every(d => d !== null && Math.abs(d - floor) < 0.7);
  ok('站立时最低点是脚下投影（不是穿地）', Math.abs(floor - 4.9) < 1.2,
    '+' + floor.toFixed(1) + 'px（投影半高 4.8×1.22/1.22 折算）');
  ok('过渡全程没有部位低于站立投影（一条直线）', flat,
    '0→0.9 恒为 +' + floor.toFixed(1));
  ok('趴定的鞋尖最多再压进 5px（刻意的）', worst - floor <= 5,
    '再深 +' + (worst - floor).toFixed(1) + 'px');
  Object.assign(p, keep);
}

/* ==================================================================
   ⑥ 对照图：5 个相位切片 + 新旧曲线逐帧增量柱
   ------------------------------------------------------------------
   一开始画的是 7 层洋葱皮，糊成一团什么都读不出（半透明叠半透明，
   躯干轮廓互相吃掉）。改成两种图，各自回答一个问题：
     · 切片：姿态本身对不对（头朝前 / 脚不离地 / 枪跟着走）
     · 柱状：节奏对不对（这是「生硬」的真正来源）
   柱状图把旧实现（每帧指数插值）放在同一时间轴上对照 —— 空口说
   「变得更顺」不算数，得让人一眼看见形状反过来了。
   ================================================================== */
vm.runInContext(`window.__panel = function(pr){
  ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(0, CAM_TY); ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  /* 背景压暗到 30%：保留空间关系（地面在哪、箱子在哪），
     又不跟角色抢对比度。铺满整屏是故意的 —— 切片边缘不会缺一块。 */
  ctx.globalAlpha = 0.30;
  drawBackground(); drawPlatforms(); drawProps(); drawCovers(); drawBlocks();
  ctx.globalAlpha = 1;
  const keep = player.prone;
  player.prone = pr;
  drawSoldier(player, false);
  player.prone = keep;
  ctx.restore();
};`, ctxVm);

function crop(sx, sy, sw, sh, k) {
  const c = createCanvas(sw * k, sh * k);
  const g = c.getContext('2d');
  g.fillStyle = '#0b1117';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw * k, sh * k);
  return c;
}

/* 旧实现的逐帧增量：p ← p + (1-p)·k，k = 1 - 0.0004^dt。
   这是原样复刻 game.js 里那一行 lerp，不是估的。 */
function oldSeries(n, dir) {
  const k = 1 - Math.pow(0.0004, DT);
  let v = dir > 0 ? 0 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const next = v + ((dir > 0 ? 1 : 0) - v) * k;
    out.push(Math.abs(next - v));
    v = next;
  }
  return out;
}

const TEXT = (g, s, x, y, size, color, bold) => {
  g.fillStyle = color || '#9fb3c6';
  g.font = (bold ? 'bold ' : '') + size + 'px "Microsoft YaHei",sans-serif';
  g.textBaseline = 'top';
  g.fillText(s, x, y);
};

(async () => {
  const sprites = await settle();
  console.log('\n立绘就绪：' + (sprites ? '✓' : '✗（退化了，下面的图不可信）'));

  const p2 = api.player;
  p2.aim = 0; p2.vx = 0; p2.anim = 0; p2.crouch = 0;
  p2.muzzle = 0; p2.reloading = 0;
  p2.prone = 0;

  const gy = toScreenY(p2.y);
  const gx = toScreenX(p2.x);
  const PW = 170, PH = 120, K = 2;
  const box = { x: Math.round(gx - 85), y: Math.round(gy - 108) };

  /* ---- 两个 case 的相位表 ---- */
  const us = [0, 0.25, 0.5, 0.75, 1];
  const fallPrs = us.map(u => api.poseIn(u));
  const risePrs = us.map(u => 1 - api.poseInOut(u));

  const panelW = PW * K, panelH = PH * K;
  const SHEET_W = panelW * us.length + 12 * (us.length - 1);
  const CHART_H = 226;
  const SHEET_H = 30 + panelH + 30 + CHART_H + 22 + 30 + panelH + 30 + CHART_H + 10;
  const sheet = createCanvas(SHEET_W, SHEET_H);
  const sg = sheet.getContext('2d');
  sg.fillStyle = '#05080b';
  sg.fillRect(0, 0, SHEET_W, SHEET_H);

  let cursorY = 0;

  function drawPanels(prs, title, marks) {
    TEXT(sg, title, 4, cursorY + 6, 14, '#7ee0a0', true);
    cursorY += 30;
    for (let i = 0; i < prs.length; i++) {
      vm.runInContext('__panel(' + prs[i] + ')', ctxVm);
      const img = crop(box.x, box.y, PW, PH, K);
      const x = i * (panelW + 12);
      sg.drawImage(img, x, cursorY);
      /* 地面基准线：脚底/鞋尖全程都该咬住这条线 */
      sg.strokeStyle = 'rgba(255,80,80,0.55)';
      sg.lineWidth = 1;
      const lineY = cursorY + (gy - box.y) * K;
      sg.beginPath();
      sg.moveTo(x, lineY + 0.5);
      sg.lineTo(x + panelW, lineY + 0.5);
      sg.stroke();
      /* 当前这一格是「时间上的第几成」＋「已经躺下多少」 */
      TEXT(sg, 'u=' + us[i].toFixed(2), x + 6, cursorY + 4, 12, 'rgba(170,205,235,0.9)');
      TEXT(sg, marks[i], x + 6, cursorY + panelH + 5, 13, '#d8e6f2', true);
    }
    cursorY += panelH + 30;
  }

  function drawChart(title, oldD, newD, note) {
    /* 标题和注记必须分两行。第一版把它们排在同一行、用
       `4 + title.length*14 + 12` 估标题宽度 —— 中文标点实际比 14px 窄，
       估出来的位置比真实结尾靠后，两段字直接叠在一起。
       排两行最省事，也最不会错。 */
    TEXT(sg, title, 4, cursorY + 4, 14, '#7ee0a0', true);
    TEXT(sg, note, 4, cursorY + 24, 12, '#7c8b99');
    cursorY += 44;
    const X0 = 74, DX = 62, BW = 24, HMAX = 108, BASE = cursorY + HMAX + 12;
    const mx = Math.max(...oldD, ...newD);
    const scale = HMAX / mx;

    /* 基线 + 刻度 */
    sg.strokeStyle = 'rgba(120,145,170,0.35)';
    sg.beginPath(); sg.moveTo(X0 - 12, BASE + 0.5); sg.lineTo(SHEET_W - 8, BASE + 0.5); sg.stroke();
    sg.strokeStyle = 'rgba(120,145,170,0.18)';
    for (let i = 1; i <= 2; i++) {
      const yy = BASE - (HMAX * i) / 3;
      sg.beginPath(); sg.moveTo(X0 - 12, yy + 0.5); sg.lineTo(SHEET_W - 8, yy + 0.5); sg.stroke();
    }
    TEXT(sg, 'Δprone / 帧', 4, cursorY + 2, 11, '#6f8296');

    const n = Math.max(oldD.length, newD.length);
    for (let i = 0; i < n; i++) {
      const x = X0 + i * DX;
      /* 旧：红 —— 首帧最高，然后一路衰减 */
      if (i < oldD.length) {
        sg.fillStyle = 'rgba(232,90,90,0.85)';
        sg.fillRect(x, BASE - oldD[i] * scale, BW, oldD[i] * scale);
      }
      /* 新：绿 —— 一路长高，到底为止 */
      if (i < newD.length) {
        sg.fillStyle = 'rgba(110,220,150,0.9)';
        sg.fillRect(x + BW + 3, BASE - newD[i] * scale, BW, newD[i] * scale);
      }
      if (i % 2 === 0) TEXT(sg, String(i + 1), x + BW / 2, BASE + 4, 11, '#5d6f80');
    }
    /* 图例压到右下角，避开已经画到右边的那几根柱 */
    const lx = SHEET_W - 330;
    sg.fillStyle = 'rgba(232,90,90,0.85)'; sg.fillRect(lx, BASE + 16, 10, 10);
    TEXT(sg, '旧：每帧指数插值', lx + 14, BASE + 13, 12, '#c89191');
    sg.fillStyle = 'rgba(110,220,150,0.9)'; sg.fillRect(lx + 148, BASE + 16, 10, 10);
    TEXT(sg, '新：二次加速 / S 形', lx + 162, BASE + 13, 12, '#8fc8a4');
    cursorY = BASE + 36;
  }

  drawPanels(fallPrs,
    '① 扑倒 0.24s（15 帧）— 二次加速：前段看得见人在往下倒，后段有重量，着地一拍停住',
    us.map((u, i) => '第 ' + Math.round(u * 14.4) + ' 帧躺下 ' + (fallPrs[i] * 100).toFixed(0) + '%'));

  /* 新曲线逐帧增量：按 0.24s / 15 帧折算，21 格时间轴里后面补 0 */
  {
    const N = 21;
    const nd = [];
    for (let i = 1; i <= N; i++) {
      const u0 = Math.min(1, (i - 1) / 14.4), u1 = Math.min(1, i / 14.4);
      nd.push(api.poseIn(u1) - api.poseIn(u0));
    }
    drawChart('② 扑倒的节奏：新旧曲线逐帧增量对照',
      oldSeries(N, 1), nd,
      '同一时间轴 · 旧曲线首帧就砸掉 12%，然后一路磨尾；新曲线从 0.5% 起加速，15 帧内到底就停');
  }

  drawPanels(risePrs,
    '③ 起身 0.36s（22 帧）— S 形：起手慢（收重心）、中段快（撑起来）、站定收（稳住）',
    us.map((u, i) => '第 ' + Math.round(u * 21.6) + ' 帧仍未起 ' + (risePrs[i] * 100).toFixed(0) + '%'));

  {
    const N = 21;
    const nd = [];
    for (let i = 1; i <= N; i++) {
      const u0 = Math.min(1, (i - 1) / 21.6), u1 = Math.min(1, i / 21.6);
      nd.push(api.poseInOut(u1) - api.poseInOut(u0));
    }
    drawChart('④ 起身的节奏：新旧曲线逐帧增量对照',
      oldSeries(N, -1), nd,
      '旧曲线起身跟扑倒一样省力；新曲线两头细、中间粗 —— 撑起来那一下最快，落位时被拽住');
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'fall.png');
  fs.writeFileSync(file, await sheet.encode('png'));
  console.log('✓ shots/fall.png  (' + SHEET_W + '×' + SHEET_H + ')');

  console.log('\n' + (fail === 0 ? '过渡曲线验收通过 ✓' : '有 ' + fail + ' 项未通过 ❌') +
    '   (' + pass + ' 通过 / ' + fail + ' 失败)');
  process.exit(fail === 0 ? 0 : 1);
})();
