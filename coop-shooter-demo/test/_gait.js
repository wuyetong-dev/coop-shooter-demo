/* 步态验证：蹲着走 / 趴着爬的时候，腿到底动没动。

   为什么需要这个脚本
   ------------------
   姿态图是一整张静态位图，接进游戏之后「一移动就整张平移」——
   用户的原话是「趴下腿应该在蠕动，结果它没有动，是在平移」。
   修法是 poseWarped：把图切成细条、每条按连续权重加位移。

   但这件事**没法用单帧截图证明**。一张图腿抬着、一张图腿放下，
   看上去都可能是「本来就该这样」。唯一站得住的判据是：
   同一套动作里，连续两帧的腿部像素必须不一样。

   所以这个脚本做两件事：
     1) 打印数值（速度 / 步频相位 / 形变幅度），确认路径被走到
     2) 对连续帧的裁剪图做像素差，确认腿真的在动、而且停得下来

   用法：node test/_gait.js
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');

for (const f of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc']) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) { /* 没字体就算了 */ }
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

for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js']) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });
}

const api = vm.runInContext(`({
  get game(){ return game; },
  get player(){ return player; },
  get buddy(){ return buddy; },
  get enemies(){ return enemies; },
  get keys(){ return keys; },
  get camera(){ return camera; },
  get world(){ return world; },
  get VIEW_ZOOM(){ return VIEW_ZOOM; },
  frame, render, poseWarpOf, poseGeom, POSE_ART
})`, ctxVm);

function step(n) {
  for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); }
}

/* 只画世界层（不压 HUD，血条正好盖住腿） */
const DRAW_WORLD = `(function(){
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(0, CAM_TY);
  ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  drawBackground(); drawPlatforms(); drawProps();
  drawCovers(); drawBlocks();
  if (buddy) drawSoldier(buddy, false);
  if (player) drawSoldier(player, false);
  drawBullets();
  ctx.restore();
})()`;
const drawWorld = () => vm.runInContext(DRAW_WORLD, ctxVm);

/* 只画主角一个人，并把他钉在画布正中。
   为什么必须这样：第一版我用 drawWorld 裁角色周围那块去比像素差，
   每帧差异 6000+ —— 那不是腿在动，是背景在滚。画面里只要有任何
   滚动的东西，这个测法就全是噪声。
   现在背景完全不画（clearRect 之后直接画人），差异 100% 来自身体。 */
const DRAW_ONE = `(function(){
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W * 0.5, H * 0.72);
  ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  ctx.translate(-player.x, -player.y);
  drawSoldier(player, false);
  ctx.restore();
})()`;
const drawOne = () => vm.runInContext(DRAW_ONE, ctxVm);

const toScreenY = wy => (wy - api.world.groundY) * api.VIEW_ZOOM + (720 - 78);

async function settle(maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = vm.runInContext(
      `(typeof heroSpriteReady==='function'&&heroSpriteReady())&&(typeof hERO_ok==='undefined'||true)` +
      `&&(typeof POSE_IMG!=='undefined')` +
      `&&Object.keys(POSE_IMG).every(k=>Object.keys(POSE_IMG[k]).every(q=>{` +
      `  const m=POSE_IMG[k][q]; return m && m.complete && m.naturalWidth>0; }))`, ctxVm);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 60));
  }
  return false;
}

/* 裁一块区域，返回 canvas（不放大，用于像素比对） */
function grab(sx, sy, sw, sh) {
  const c = createCanvas(sw, sh);
  c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

/* 两张同尺寸图里有差别的像素数 */
function diffCount(a, b) {
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  let n = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 18) n++;
  }
  return n;
}

/* 横排条带：每格放大 k 倍 + 标签。
   6 格 × 4 倍是 4560px 宽 —— 读图工具会把整张缩到 1600 以内，
   腿上那两像素的变化正好被抹平，等于白出图。所以另出一张
   「两帧 8 倍」的对照，那张才是拿来看的。 */
function strip(cells, k, label) {
  const CW = cells[0].cv.width, CH = cells[0].cv.height;
  const c = createCanvas(CW * k * cells.length, CH * k + 28);
  const g = c.getContext('2d');
  g.fillStyle = '#0e141b';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '15px "Microsoft YaHei",sans-serif';
  g.textBaseline = 'top';
  cells.forEach((cell, i) => {
    const x = i * CW * k;
    g.drawImage(cell.cv, 0, 0, CW, CH, x, 0, CW * k, CH * k);
    g.fillStyle = '#5c7286';
    g.fillRect(x, 0, 1, CH * k);
    g.fillStyle = '#8fd0ff';
    g.fillText(cell.label, x + 7, CH * k + 5);
  });
  const f = path.join(OUT, label + '.png');
  fs.writeFileSync(f, c.toBuffer('image/png'));
  console.log('→ shots/' + label + '.png  ' + c.width + 'x' + c.height);
  return f;
}

/* 两帧 8 倍对照：只看「腿有没有换姿势」。 */
function ab(cells, a, b, label) {
  const CW = cells[0].cv.width, CH = cells[0].cv.height, k = 8;
  const c = createCanvas(CW * k * 2 + 12, CH * k + 30);
  const g = c.getContext('2d');
  g.fillStyle = '#0e141b';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '16px "Microsoft YaHei",sans-serif';
  g.textBaseline = 'top';
  [a, b].forEach((idx, i) => {
    const x = i * (CW * k + 12);
    g.drawImage(cells[idx].cv, 0, 0, CW, CH, x, 0, CW * k, CH * k);
    g.fillStyle = '#8fd0ff';
    g.fillText(cells[idx].label, x + 6, CH * k + 6);
  });
  const f = path.join(OUT, label + '.png');
  fs.writeFileSync(f, c.toBuffer('image/png'));
  console.log('→ shots/' + label + '.png  ' + c.width + 'x' + c.height);
}

/* 一次步态采样：按住两个键跑若干帧，每 gap 帧抓一张。
   角色被 drawOne 钉在画布正中，所以裁剪框是固定坐标 —— 框里的东西
   除了角色本身不会有别的会动。 */
function sample(keysOn, n, gap, tag, BW, BH) {
  for (const k in api.keys) api.keys[k] = false;
  for (const k of keysOn) api.keys[k] = true;
  step(30);                                   /* 先让姿态 / 权重落到稳态 */

  const BX = Math.round(640 - BW / 2), BY = Math.round(518 - BH + 10);

  const cells = [], frames = [], amps = [], kinds = [];
  let state = null;
  for (let i = 0; i < n; i++) {
    const p = api.player;
    drawOne();
    const cv = grab(BX, BY, BW, BH);
    const w = api.poseWarpOf(p);
    frames.push(cv);
    amps.push(w ? w.amp : 0);
    kinds.push(w ? w.kind : 'none');
    /* 状态必须当场取。放到最后取会读到「下一段采样」的残值 ——
       我第一次就是把断言写在末尾，测出来 crouch=0 / 姿态图=prone，
       还以为蹲着走坏了，其实是那时人正趴着。 */
    if (!state) {
      state = vm.runInContext(`(function(){
        const pa = poseArtOf('hero', cqEff(player), proneK(player));
        return { cq: player.crouch || 0, pr: player.prone || 0,
                 vx: player.vx || 0, art: pa ? pa.key : 'none' };
      })()`, ctxVm);
    }
    cells.push({
      cv: cv,
      label: '#' + i + ' anim=' + (p.anim || 0).toFixed(2) +
             ' vx=' + (p.vx || 0).toFixed(0) +
             (w ? ' 抬' + w.amp.toFixed(1) : ' 无形变')
    });
    step(gap);
  }
  const diffs = [];
  for (let i = 1; i < frames.length; i++) diffs.push(diffCount(frames[i - 1], frames[i]));
  console.log('  ' + tag + ' 相邻帧差异像素: ' + diffs.join(' / '));
  return { cells, diffs, amps, kinds, state };
}

(async () => {
  const ok = await settle();
  console.log('立绘 + 姿态图就绪：' + (ok ? '✓' : '✗（下面的图不可信）'));
  fs.mkdirSync(OUT, { recursive: true });

  api.game.state = 'play';
  vm.runInContext('startStage(5)', ctxVm);
  step(50);
  api.enemies.length = 0;
  step(6);

  const p = api.player;
  p.aim = 0;
  if (api.buddy) { api.buddy.x = 60000; }      /* 大肥鱼挪走，只留主角不抢镜 */

  console.log('\n── 蹲着走（按住 S + D）──');
  const crouch = sample(["KeyS", "KeyD"], 6, 7, "_gait_crouch", 80, 112);
  strip(crouch.cells, 6, '_gait_crouch');
  ab(crouch.cells, 0, 2, '_gait_crouch_ab');

  console.log('\n── 趴着爬（按住 Z + D）──');
  const crawl = sample(["KeyZ", "KeyD"], 6, 7, "_gait_crawl", 128, 84);
  strip(crawl.cells, 6, '_gait_crawl');
  ab(crawl.cells, 1, 3, '_gait_crawl_ab');

  /* 停下来必须停：静置帧之间的差异应该接近 0（呼吸 / 待机不计） */
  console.log('\n── 趴着不动（只按 Z）──');
  const still = sample(["KeyZ"], 4, 10, "_gait_still", 128, 84);
  strip(still.cells, 6, '_gait_still');

  const sumDiff = a => a.reduce((s, v) => s + v, 0);

  /* 断言：不是给人看的总结，是给下一次改动看的闸门。
     蹲行走最容易悄悄退回去的地方有两处 ——
     wantCrouch 里多写一个条件、移动 cap 少乘一个系数。 */
  const st = crouch.state;
  const fails = [];

  /* 蹲行：权重到 1、速度落在设计值附近、姿态图仍然是蹲那张 */
  if (!st || st.cq < 0.9) fails.push('蹲行时 crouch=' + (st ? st.cq.toFixed(2) : '?') + '（应该贴近 1，否则是站起来走了）');
  if (!st || st.art !== 'crouch') fails.push('蹲行时姿态图是 ' + (st ? st.art : '?') + '（应该是 crouch）');
  if (!st || Math.abs(st.vx) < 130 || Math.abs(st.vx) > 170) {
    fails.push('蹲行速度 ' + (st ? Math.abs(st.vx).toFixed(0) : '?') + '（设计约 151 = 290×0.52，超出说明 cap 被改了）');
  }

  /* 蹲行：腿必须真的在走。这一条是这次返工的起因 —— 上一版「蹲着走」
     只有重心起伏，用户一眼看出是平移。判据三条：走的是 legs 那条
     通路（不是没形变、也不是误用了爬行的竖条切法）、摆幅到设计值、
     相邻帧真的有像素在变。 */
  const cqKinds = crouch.kinds.filter(k => k !== 'none');
  const cqPeak = Math.max.apply(null, crouch.amps);
  if (!cqKinds.length || cqKinds.some(k => k !== 'legs')) {
    fails.push('蹲行形变通路 = ' + (cqKinds.join('/') || '无') + '（应该是 legs）');
  }
  if (cqPeak < 2.5) fails.push('蹲行摆幅 ' + cqPeak.toFixed(2) + '（< 2.5px，腿几乎没摆）');
  if (sumDiff(crouch.diffs) < 800) {
    fails.push('蹲行相邻帧差异 ' + sumDiff(crouch.diffs) + '（太小，腿其实没动）');
  }

  /* 爬行：腿必须真的在动（形变幅度 > 1.5），静止时必须停 */
  const peak = Math.max.apply(null, crawl.amps);
  if (peak < 1.5) fails.push('爬行形变幅度 ' + peak.toFixed(2) + '（腿没在动）');
  if (sumDiff(crawl.diffs) < 300) fails.push('爬行相邻帧差异 ' + sumDiff(crawl.diffs) + '（太小，腿其实没动）');
  if (sumDiff(still.diffs) > 60) fails.push('静止差异 ' + sumDiff(still.diffs) + '（停下还在动，会变成原地蠕）');

  console.log('\n结论：');
  console.log('  蹲行 crouch=' + (st ? st.cq.toFixed(2) : '?') + ' vx=' + (st ? Math.abs(st.vx).toFixed(0) : '?') +
              ' 姿态图=' + (st ? st.art : '?') + '（速度 52%，可以蹲着走）');
  console.log('  蹲行摆幅峰值 ' + cqPeak.toFixed(1) + 'px，相邻帧差异合计 ' + sumDiff(crouch.diffs) + '（两腿反向摆）');
  console.log('  爬行形变幅度峰值 ' + peak.toFixed(1) + 'px，相邻帧差异合计 ' + sumDiff(crawl.diffs) + '（腿在动）');
  console.log('  静止相邻帧差异 ' + sumDiff(still.diffs) + '（停下就停）');

  if (fails.length) {
    console.log('\n✗ 失败 ' + fails.length + ' 处：');
    for (const f of fails) console.log('   · ' + f);
    process.exitCode = 1;
  } else {
    console.log('\n✓ 步态全部通过');
  }

  /* 最后一张：带背景的实机图。
     前面那些都只画了角色（为了比像素），能证明「腿在动」，
     证明不了「跟地面接得对不对」—— 脚离地、穿地这些只有放进
     关卡里才看得出来。 */
  console.log('');
  for (const [keysOn, tag] of [[['KeyS', 'KeyD'], 'crouch'], [['KeyZ', 'KeyD'], 'crawl']]) {
    for (const k in api.keys) api.keys[k] = false;
    for (const k of keysOn) api.keys[k] = true;
    step(40);
    const p = api.player;
    /* 必须乘 VIEW_ZOOM：drawWorld 是先 translate 再 scale(1.22)，
       所以 drawSoldier 里的 (x - camera.x) 是缩放前的坐标。
       少了这一步，裁框会偏左 22%，人半个身子在框外 —— 我第一版
       就是这么拍出一张「角色贴着右边框」的图。 */
    const px = (p.x - api.camera.x) * api.VIEW_ZOOM;
    const gy = toScreenY(p.y);
    drawWorld();
    const CW = 240, CH = 170;
    const cv = grab(Math.round(px - CW / 2), Math.round(gy - CH + 26), CW, CH);
    strip([{ cv: cv, label: '实机：' + (tag === 'crouch' ? '蹲着走' : '趴着爬') }], 4, '_gait_scene_' + tag);
  }
})();
