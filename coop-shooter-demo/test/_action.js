/* ==================================================================
   动作层验收：七套画法 × 十七条动作
   ------------------------------------------------------------------
   这个脚本回答七个问题，缺一条都算没做完：

     ① 覆盖：每个角色 × 每条动作，姿态通道是否真的动了
        （「接了但没反应」是这类重构最常见的翻车方式）
     ② 连续性：逐帧采样，单帧最大跳变是否超阈值
        （用户的原话是「动作切换无明显跳变」，那就得有个数字管着）
        ②b 衰减型一次性量（开火 / 受击）是否起于 1、单调掉到 0
     ③ 一次性 / 循环的区分：循环动作首尾接得上；一次性动作两头归零、
        阵亡播完停在终点
     ④ 一致性：同一段输入喂给四套画法，姿态通道必须逐帧完全相同
        （统一动作层如果只统一了一半，这条会立刻抓到）
     ⑥ 贴地：蹲 / 趴 / 匍匐 / 跑步，最下面的墨迹必须踩在同一条线上
        （数像素 —— 姿态数值对了不等于画得对，陷进地里 / 浮空只有像素知道）
     ⑦ 动觉：起伏和呼吸必须真的落在像素上
        （给「算完丢掉」准备的：少一行 translate，所有数值测试都还是绿的）

   出图：shots/actions.png（行=角色，列=动作）+ shots/ground.png（贴地）。
   行距 / 列宽 / 格子高度都是算出来的，不手填 —— 手填过两次，两次都叠了。

   用法：node test/_action.js
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
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) { /* 没字体就用默认 */ }
}

const canvas = createCanvas(1500, 1000);
const ctx = canvas.getContext('2d');
let clock = 0;
const canvasEl = {
  width: 1500, height: 1000, style: {},
  getContext: () => ctx,
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1500, height: 1000 })
};
const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams,
  Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock },
  requestAnimationFrame: () => 0,
  addEventListener: () => {},
  innerWidth: 1500, innerHeight: 1000, devicePixelRatio: 1,
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
  startStage, createEnemy, update,
  actRun, actPose, actPlay, actDeathCurve, actReloadEnvelope, crouchStep, poseStep,
  gaitFor, drawSoldier, drawEnemy, drawCorpses,
  /* 敌兵的「阵亡」不是一套倒地姿态，是一条真正的尸体（drawCorpses 读 t 推曲线）。
     造一条放在原点、已经软倒一半的尸体，画完就清掉。 */
  putCorpse: (c) => { corpses.length = 0; corpses.push(c); },
  clearCorpses: () => { corpses.length = 0; },
  setFrame: (n) => { _frameNo = n; }, nowFrame: () => _frameNo
})`, ctxVm);

const DT = 1 / 60;
/* 模拟时钟：动作层的阵亡曲线读 game.time，测试里不推它，
   尸体就永远停在「刚倒下」那一帧（death 通道恒为 0 —— 第一版就是这样）。 */
function advance() { vm.runInContext('game.time += 1/60', ctxVm); }

/* ---------- 角色样本：Game 里真正会被 drawSoldier 分派的画法 ----------
   前五套是手绘 / 位图混排，六名干员里剩下三个（格克 / 双子 / 小克）用同一份
   drawCast，但立绘不同 —— 脚底位置、腿片矩形、发团宽度全不一样，
   所以每个都要单列一行，不能「一个干员代表六个人」。 */
const LOOKS = [
  { key: 'hero', label: '无名（黑甲）', make: () => api.player },
  { key: 'whale', label: '大肥鱼', make: () => api.buddy },
  { key: 'kimi', label: '奇米', make: () => agent('kimi') },
  { key: 'glm', label: '知源', make: () => agent('glm') },
  { key: 'gpt', label: '枢机', make: () => agent('gpt') },
  { key: 'grok', label: '格克', make: () => agent('grok') },
  { key: 'gemini', label: '双子', make: () => agent('gemini') },
  { key: 'claude', label: '小克', make: () => agent('claude') },
  { key: 'soldier', label: '敌兵', make: () => api.createEnemy('grunt', 400, 1) },
  { key: 'boss', label: '重装 BOSS', make: () => api.createEnemy('boss', 400, 1) }
];

function agent(look) {
  /* 干员在关卡里也是玩家（playable），这里造一个同构的实体：
     字段和 createPlayer 一致，只是 look 换成干员的 */
  const p = api.player;
  const a = Object.assign({}, p);
  a.look = look;
  a.anim = 0;
  /* Object.assign 是浅拷贝：act / _pose / poseStep 的状态机对象会被
     几个人共用，动一个人的姿态等于动所有人的。这里全部断开。 */
  a.act = null;
  a._pose = null;
  a._poseNo = -1;
  a._mo = null;
  a._moNo = -1;
  a.crouchPs = null;
  a.pronePs = null;
  return a;
}

/* ---------- 驱动：每条动作在物理上长什么样 ---------- */
/* 每个 drive 只负责「把物理量拨到该有的样子」，
   和 game.js / ai.js 里真实控制器做的是一回事 —— 这一层验的是
   动作层对这些物理量的响应，不是控制器本身。 */
const ACTIONS = [
  { id: 'idle', label: '待机', kind: 'loop', frames: 60, drive() {} },
  { id: 'run', label: '跑步', kind: 'loop', frames: 60, drive(a) { a.vx = 290; } },
  { id: 'crouch', label: '蹲下', kind: 'hold', frames: 40, drive(a) { api.crouchStep(a, true, DT); } },
  {
    id: 'crouchW', label: '蹲行', kind: 'loop', frames: 50,
    drive(a) { api.crouchStep(a, true, DT); a.vx = 150; }
  },
  { id: 'prone', label: '趴下', kind: 'hold', frames: 40, drive(a) { api.poseStep(a, 'prone', true, DT); } },
  {
    id: 'crawl', label: '匍匐', kind: 'loop', frames: 50,
    drive(a) { api.poseStep(a, 'prone', true, DT); a.vx = 90; }
  },
  { id: 'jump', label: '跳跃', kind: 'loop', frames: 24, drive(a) { a.onGround = false; a.vy = -520; } },
  { id: 'fall', label: '下落', kind: 'loop', frames: 24, drive(a) { a.onGround = false; a.vy = 430; } },
  {
    id: 'reload', label: '上膛', kind: 'once', frames: 72,
    drive(a, i) { a.reloadDur = 1.2; a.reloading = 1.2 * (1 - Math.min(1, i / 71)); }
  },
  {
    id: 'fire', label: '开火', kind: 'once', frames: 12,
    drive(a, i) { a.muzzle = Math.max(0, 0.06 - i * DT); }
  },
  {
    id: 'hit', label: '受击', kind: 'once', frames: 24,
    drive(a, i) { a.flash = Math.max(0, 0.16 - i * DT); }
  },
  {
    id: 'death', label: '阵亡', kind: 'once', frames: 60,
    drive(a, i) {
      a.downed = true;
      if (i === 0) a.downedAt = api.game.time;
    }
  },
  { id: 'revive', label: '救援', kind: 'hold', frames: 36, drive(a) { a.reviveK = 1; } }
];

let fails = 0;
function ok(cond, label, detail) {
  if (!cond) fails++;
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (detail !== undefined ? '  ' + detail : ''));
}

/* 把实体拨回「刚站起来」的初始态：动作层状态全清、姿态缓存作废 */
function reset(a) {
  a.act = null;
  a._pose = null;
  a._poseNo = -1;
  a._mo = null;
  a._moNo = -1;
  a.anim = 0;
  a.vx = 0;
  a.vy = 0;
  a.onGround = true;
  a.crouch = 0;
  a.prone = 0;
  a.reloading = 0;
  a.reloadDur = 0;
  a.reloadT = 0;
  a.reload = 0;
  a.muzzle = 0;
  a.flash = 0;
  a.landSquash = 0;
  a.downed = false;
  a.dead = false;
  a.reviveK = 0;
  a.dashTime = 0;
  /* poseStep / crouchStep 把「补间进行到哪」存在 crouchPs / pronePs 里。
     不清掉的话，实体被外部直接写回 crouch=0 之后，状态机还以为自己
     已经跑到终点、方向没变 → 下一帧直接给出 1（一帧趴下）。
     这正是「测试里造数据」最容易踩的坑：游戏里这条路径永远连续，
     所以只有离线复现才会撞上。 */
  a.crouchPs = null;
  a.pronePs = null;
  /* 倾角读的是「这一帧的 vx 减上一帧的 vx」。reset 把 vx 拨回 0 之后，
     上一帧残留的 _vxPrev 还在 290 → 第一帧算出 -17300px/s² 的假加速度，
     平滑后还剩 -370，折成 0.0088 rad 的鬼影前倾。
     游戏里这条路径不存在（重生是新建对象），只有离线复用同一个实体才会撞上。 */
  a._vxPrev = undefined;
  a._accSm = 0;
}

/* 跑一段动作，逐帧记下姿态通道 */
function runClip(a, act) {
  reset(a);
  const frames = [];
  for (let i = 0; i < act.frames; i++) {
    act.drive(a, i);
    advance();
    api.setFrame(api.nowFrame() + 1);
    const P = api.actRun(a, DT);
    frames.push({
      w: Object.assign({}, P.w),
      crouch: P.crouch, prone: P.prone,
      reload: P.reload, fire: P.fire, hit: P.hit, death: P.death, revive: P.revive,
      bob: P.bob, lean: P.lean
    });
  }
  return frames;
}

const CH = ['crouch', 'prone', 'reload', 'fire', 'hit', 'death', 'revive', 'bob', 'lean'];

/* ---------- ⑥ 贴地 ---------- */
/* 姿态数值对了不等于画得对：蹲下去该变矮、趴下去该贴地、跑步脚该踩在线
   上 —— 这三件事全在 painter 的变换里，数值层看不见。这里直接数像素：
   每种姿势把角色画在一条固定的地面线上，找「最下面一个不透明的像素」，
   和站姿比。差值为正 = 陷进地里，为负 = 浮空。
   用「与站姿之差」而不是绝对值：位图立绘底部本来就有几像素透明边，
   那是素材属性，不是姿势问题。 */
const GROUND_Y = 480, ROI = { x: 150, y: 280, w: 700, h: 260 };

/* 量一遍「墨迹的上下边界」：相对地面线，往上为负 */
function inkBand(a) {
  const main = ctx;
  main.save();
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.clearRect(0, 0, 1500, 1000);
  main.translate(300, GROUND_Y);
  const oldCam = api.camera.x;
  api.camera.x = 0;
  a.x = 0; a.y = 0;
  /* BOSS 头顶挂着一块「铁血队长」名牌（HUD 元素，不跟着起伏走）。
     量姿势的时候把它摘掉，否则量到的永远是那行字的上边缘。 */
  const hadBoss = a.boss;
  if (hadBoss) a.boss = false;
  try { paintActor(a); } catch (e) { /* 画不出来就是没墨 */ }
  if (hadBoss) a.boss = true;
  api.camera.x = oldCam;
  main.restore();
  const d = main.getImageData(ROI.x, ROI.y, ROI.w, ROI.h).data;
  let top = null, bot = null;
  for (let y = 0; y < ROI.h; y++) {
    const row = y * ROI.w * 4;
    let hit = false;
    for (let x = 0; x < ROI.w; x++) {
      if (d[row + x * 4 + 3] > 12) { hit = true; break; }
    }
    if (!hit) continue;
    if (top === null) top = (ROI.y + y) - GROUND_Y;
    bot = (ROI.y + y) - GROUND_Y;
  }
  return { top: top, bot: bot };
}

function inkBottom(a) {
  const b = inkBand(a);
  return b.bot;
}

/* 和游戏里同一套分派：敌兵走 drawEnemy，其余走 drawSoldier */
function paintActor(a) {
  if (a.type) api.drawEnemy(a); else api.drawSoldier(a, false);
}

function ground() {
  console.log('\n--- ⑥ 贴地：蹲 / 趴 / 匍匐 / 跑步 的最低墨迹与站姿之差（±3px）---');
  const POSES = [
    { id: 'idle', label: '站立', frames: 20, drive() {} },
    { id: 'run', label: '跑步', frames: 26, drive(a) { a.vx = 290; } },
    { id: 'crouch', label: '蹲下', frames: 30, drive(a) { api.crouchStep(a, true, DT); } },
    { id: 'prone', label: '趴下', frames: 34, drive(a) { api.poseStep(a, 'prone', true, DT); } },
    {
      id: 'crawl', label: '匍匐', frames: 34,
      drive(a) { api.poseStep(a, 'prone', true, DT); a.vx = 90; }
    }
  ];
  for (const L of LOOKS) {
    const base = inkBottom(poseOf(L, POSES[0]));
    const bad = [];
    const nums = [];
    for (const p of POSES) {
      /* 跑步是唯一「接触断续」的姿势：一个步态周期里两只脚会交替离地，
         任何单独一帧都可能正当空。所以取四个相位里最贴线的那一个 ——
         判据是「这一圈里至少有一次踩到线上」，不是「每一帧都踩着」。 */
      let v;
      if (p.id === 'run') {
        const cands = [22, 26, 30, 34].map(n =>
          inkBottom(poseOf(L, { id: 'run', frames: n, drive: p.drive })));
        v = cands.reduce((best, x) =>
          (Math.abs(x - base) < Math.abs(best - base) ? x : best), cands[0]);
      } else {
        v = inkBottom(poseOf(L, p));
      }
      if (v === null) { bad.push(p.label + '=空'); continue; }
      const d = v - base;
      nums.push(p.label + ' ' + (d >= 0 ? '+' : '') + d);
      /* 匍匐放宽到 5px：爬的时候膝盖和肘是「压」在地上前进的，
         压进去两三个像素读成负重，不是穿模。压到 0 反而像飘着滑。
         其余姿势一律 3px —— 站、蹲、躺这三件事没有「压」的理由。 */
      const tol = (p.id === 'crawl') ? 5 : 3;
      if (Math.abs(d) > tol) bad.push(p.label + '=' + (d >= 0 ? '+' : '') + d + 'px');
    }
    ok(bad.length === 0, L.label + '：五种姿势都踩在同一条地面线上', bad.length ? bad.join(' ') : nums.join(' / '));
  }
  fs.mkdirSync(OUT, { recursive: true });
  groundSheet(POSES);
}

/* 贴地对照图：每格一条地面线，蹲 / 趴 有没有陷进去一眼就能看出来 */
function groundSheet(poses) {
  const CW = 168, CH = 132, PADX = 74, PADY = 66;
  const W3 = PADX + CW * poses.length + 10;
  const H3 = PADY + CH * LOOKS.length + 14;
  const c3 = createCanvas(W3, H3);
  const g = c3.getContext('2d');
  g.fillStyle = '#0d1218';
  g.fillRect(0, 0, W3, H3);
  g.textAlign = 'center';
  g.fillStyle = '#dbe7f3';
  g.font = '600 15px "Microsoft YaHei"';
  g.fillText('贴地对照：每格一条地面线，最低的墨迹必须踩在线上', W3 / 2, 26);
  g.font = '12px "Microsoft YaHei"';
  g.fillStyle = '#7f95ab';
  g.fillText('绿线 = 地面。向上浮 / 向下陷都会看得出来（数值见终端 ⑥）', W3 / 2, 46);

  for (let c = 0; c < poses.length; c++) {
    g.fillStyle = '#9fb4c8';
    g.font = '600 13px "Microsoft YaHei"';
    g.fillText(poses[c].label, PADX + CW * c + CW / 2, PADY - 8);
  }

  for (let r = 0; r < LOOKS.length; r++) {
    const L = LOOKS[r];
    const footY = PADY + CH * r + CH - 24;
    /* 这一行的地面线先铺好，画完再补一道，保证线永远压在墨迹之上 */
    g.fillStyle = 'rgba(90,200,140,0.20)';
    g.fillRect(PADX, footY, CW * poses.length, 1);

    g.fillStyle = '#c7d7e6';
    g.font = '600 12px "Microsoft YaHei"';
    g.textAlign = 'right';
    g.fillText(L.label, PADX - 8, footY - 34);
    g.textAlign = 'center';

    for (let c = 0; c < poses.length; c++) {
      const a = poseOf(L, poses[c]);
      const cx = PADX + CW * c + CW / 2;
      const main = ctx;
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.clearRect(0, 0, 1500, 1000);
      main.translate(700, 700);
      const oldCam = api.camera.x;
      api.camera.x = 0;
      a.x = 0; a.y = 0;
      try { paintActor(a); } catch (e) { /* 单格失败不拖垮整张图 */ }
      api.camera.x = oldCam;
      main.restore();
      /* 把「脚底 = 700」的那一条贴到 footY 上 */
      g.drawImage(canvas, 700 - 84, 700 - 100, 168, 108, cx - 84, footY - 100, 168, 108);
      g.fillStyle = 'rgba(90,200,140,0.55)';
      g.fillRect(cx - 84, footY, 168, 1);
    }
  }
  const f = path.join(OUT, 'ground.png');
  fs.writeFileSync(f, c3.toBuffer('image/png'));
  console.log('  已出图 ' + f + '（' + W3 + '×' + H3 + '）');
}

/* 摆好一条姿势，返回实体（贴地检查只关心最后一帧）。
   时钟先钉到 3 秒：呼吸、头发、胸灯这些「读全局时间」的量如果接着上一次
   的状态往下跑，同一个姿势量两次会差 1~2px —— 那是噪声，不是 bug。 */
function poseOf(L, p) {
  const a = L.make();
  reset(a);
  vm.runInContext('game.time = 3', ctxVm);
  for (let i = 0; i < p.frames; i++) {
    p.drive(a, i);
    advance();
    api.setFrame(api.nowFrame() + 1);
    api.actRun(a, DT);
  }
  return a;
}

/* ---------- ⑦ 动觉真的画出来了 ---------- */
/* 这一条是给「算完丢掉」准备的。动作层把 bob / lean 算得再准，
   painter 里少一行 ctx.translate(0, -bob)，画面上一动不动 ——
   而这种漏写不会报错、也不会让任何数值测试变红。
   判据：同一个角色跑一个步态周期，头顶那条线必须上下走；
         站着不动时，头顶的呼吸也必须有一点点起伏。
   这正好是「敌兵原本像插在土里的立牌」那个 bug 的回归测试。 */
function aliveness() {
  console.log('\n--- ⑦ 动觉：起伏 / 呼吸必须真的落在像素上 ---');
  for (const L of LOOKS) {
    const tops = [10, 18, 26, 34, 42].map(n =>
      inkBand(poseOf(L, { id: 'run', frames: n, drive(x) { x.vx = 290; } })).top);
    const runSpread = Math.max(...tops) - Math.min(...tops);

    /* 呼吸是亚像素量（BREATH_AMP=0.9，摆幅 ±0.45），像素上量不出来，
       所以这一条量数值：待机姿态里的 bob 必须是非零的小量。
       两者分开验，是因为它们失败的形态不一样 ——
       跑动漏画是「画面上不动」，呼吸漏算是「站着一丝气都没有」。 */
    const ia = poseOf(L, { id: 'idle', frames: 20, drive() {} });
    const breath = Math.abs(api.actPose(ia).bob);

    ok(runSpread >= 1.2 && breath > 0.05 && breath < 1.2,
      L.label + '：跑动起伏画到了像素上、待机有呼吸',
      '跑动头顶摆幅 ' + runSpread.toFixed(1) + 'px / 待机 bob ' + breath.toFixed(2) + 'px');
  }
}

/* ---------- ① 覆盖 ---------- */
function coverage() {
  console.log('\n--- ① 覆盖：每条动作都必须真的让姿态动起来 ---');
  for (const L of LOOKS) {
    const a = L.make();
    const dead = [];
    for (const act of ACTIONS) {
      const fs2 = runClip(a, act);
      /* 「动了」的判据：本动作专属通道的极差 > 阈值；
         没有专属通道的（jump/fall/idle）看权重是否到位 */
      const span = k => {
        const v = fs2.map(f => (k.indexOf('.') > 0 ? f.w[k.split('.')[1]] : f[k]));
        return Math.max(...v) - Math.min(...v);
      };
      let moved;
      if (act.id === 'jump') moved = Math.max(...fs2.map(f => f.w.jump));
      else if (act.id === 'fall') moved = Math.max(...fs2.map(f => f.w.fall));
      else if (act.id === 'idle') moved = Math.max(...fs2.map(f => f.w.idle));
      else if (act.id === 'run') moved = Math.max(...fs2.map(f => f.w.run));
      else if (act.id === 'crouchW') moved = Math.max(...fs2.map(f => f.w.crouchW));
      else if (act.id === 'crawl') moved = Math.max(...fs2.map(f => f.w.crawl));
      else if (act.id === 'crouch') moved = Math.max(...fs2.map(f => f.crouch));
      else if (act.id === 'prone') moved = Math.max(...fs2.map(f => f.prone));
      else moved = span(act.id);
      if (!(moved > 0.8)) dead.push(act.id + '=' + moved.toFixed(2));
    }
    ok(dead.length === 0, L.label + '：12 条动作全部有响应', dead.length ? dead.join(' ') : '12/12');
  }
}

/* ---------- ② 连续性 ---------- */
function continuity() {
  console.log('\n--- ② 连续性：逐帧最大跳变（阈值 0.20）---');
  let worst = 0, worstAt = '';
  for (const L of LOOKS) {
    for (const act of ACTIONS) {
      const fs2 = runClip(L.make(), act);
      for (let i = 1; i < fs2.length; i++) {
        /* 两类通道不按「过渡」判，理由各不相同：
           · bob / lean 是衍生的振荡量：全速跑时相位每帧走 0.27rad，
             |cos| 本来就跳 0.6 —— 那是脚步，不是跳变（接缝见 ③）。
           · fire 是计时器派生的衰减量（muzzle / 0.06），步长上界就是
             dt/0.06 = 0.278；要它更平只能把枪口火光拉成一团糊，反而更假。
             形状由 ②b 单独验，摘出来不等于放过。 */
        for (const k of CH) {
          if (k === 'bob' || k === 'lean' || k === 'fire') continue;
          const d = Math.abs(fs2[i][k] - fs2[i - 1][k]);
          if (d > worst) { worst = d; worstAt = L.key + '/' + act.id + ' 第' + i + '帧 ' + k; }
        }
        for (const kk of Object.keys(fs2[i].w)) {
          const d = Math.abs(fs2[i].w[kk] - fs2[i - 1].w[kk]);
          if (d > worst) { worst = d; worstAt = L.key + '/' + act.id + ' 第' + i + '帧 w.' + kk; }
        }
      }
    }
  }
  ok(worst <= 0.20, '所有角色 × 所有动作的单帧跳变 ≤ 0.20', '最大 ' + worst.toFixed(3) + ' @ ' + worstAt);

  /* ②b 衰减型一次性量：起于 1、一路掉到 0、绝不回弹。
     把它们从上面的检查摘出来，就得在这里给更硬的约束 ——
     否则「排除」等于「没验」。 */
  const WINDOW = { fire: 0.06, hit: 0.14 };
  for (const k of Object.keys(WINDOW)) {
    let top = 0, backUp = 0, endV = 0, worstStep = 0;
    for (const L of LOOKS) {
      const act = ACTIONS.find(x => x.id === k);
      const fs2 = runClip(L.make(), act);
      top = Math.max(top, fs2[0][k]);
      endV = Math.max(endV, fs2[fs2.length - 1][k]);
      for (let i = 1; i < fs2.length; i++) {
        const d = fs2[i][k] - fs2[i - 1][k];
        if (d > 1e-9) backUp++;
        worstStep = Math.max(worstStep, -d);
      }
    }
    ok(Math.abs(top - 1) < 1e-9 && endV === 0 && backUp === 0 && worstStep <= DT / WINDOW[k] + 1e-9,
      k + ' 通道：起于 1、单调衰减、窗口内归零',
      'step≤' + worstStep.toFixed(3) + '（上界 ' + (DT / WINDOW[k]).toFixed(3) + '）回弹 ' + backUp + ' 末值 ' + endV);
  }
}

/* ---------- ③ 循环接缝 / 一次性两端 ---------- */
function seams() {
  console.log('\n--- ③ 循环首尾相接 vs 一次性两头归零 ---');

  /* 循环：步态相位 0 和 2π 必须完全同形（同一个正弦，只是换了一条支） */
  const a = api.player;
  reset(a);
  let maxSeam = 0;
  for (const g of [{ stepRot: 0.52, stepLift: 9, idleRot: 0.13, idleLift: 2 }, null]) {
    const K = g || { stepRot: 1, stepLift: 1, idleRot: 1, idleLift: 1, airFront: 0, airBack: 0, airLiftF: 0, airLiftB: 0 };
    a.vx = 290; a.onGround = true;
    a.anim = 0;
    const g0 = api.gaitFor(a, 1.0, 0, K);
    a.anim = Math.PI * 2;
    const g2 = api.gaitFor(a, 1.0, 0, K);
    maxSeam = Math.max(maxSeam,
      Math.abs(g0.front.rot - g2.front.rot), Math.abs(g0.front.lift - g2.front.lift),
      Math.abs(g0.back.rot - g2.back.rot), Math.abs(g0.back.lift - g2.back.lift));
  }
  ok(maxSeam < 1e-9, '跑步循环首尾同形（相位 0 ≡ 2π）', 'Δ=' + maxSeam.toExponential(1));

  /* 待机 ↔ 迈步之间的过渡带：速度从 0 拉到 290，腿角不许跳 */
  a.vx = 0; a.anim = 1.234; a.onGround = true;
  let maxStep = 0, prevRot = null;
  for (let sp = 0; sp <= 290; sp += 2) {
    a.vx = sp;
    const g = api.gaitFor(a, 3.7, 0, { stepRot: 0.52, stepLift: 9, idleRot: 0.13, idleLift: 2 });
    if (prevRot !== null) maxStep = Math.max(maxStep, Math.abs(g.front.rot - prevRot));
    prevRot = g.front.rot;
  }
  /* 每 2px/s 一步，最陡的一段约等于 0.52-0.13 分摊到 26 步 ≈ 0.015 */
  ok(maxStep < 0.03, '停步 ↔ 迈步之间腿角连续（不再硬切）', '每 2px/s 最大 Δ=' + maxStep.toFixed(4));

  /* 一次性：换弹包络两头必须归零 */
  const fake = { reloadDur: 1, reloading: 1 };
  const r0 = api.actReloadEnvelope(fake);
  fake.reloading = 0.000001;
  const r1 = api.actReloadEnvelope(fake);
  fake.reloading = 0.5;
  const rM = api.actReloadEnvelope(fake);
  ok(Math.abs(r0.k) < 1e-9 && Math.abs(r1.k) < 1e-5 && Math.abs(rM.k - 1) < 1e-6,
    '上膛包络：0 → 1 → 0，两头精确归零',
    r0.k.toFixed(3) + ' / ' + rM.k.toFixed(3) + ' / ' + r1.k.toFixed(6));

  /* 阵亡：一次性，播完停在终点，不会自己重来 */
  const d = [];
  for (let i = 0; i <= 90; i++) d.push(api.actDeathCurve(i / 60).done === undefined ? 0 : api.actDeathCurve(i / 60));
  const tail = d[d.length - 1];
  const settled = d.filter(x => x.done).length;
  ok(settled > 30 && Math.abs(tail.ang - (0.30 + 1.21)) < 0.09,
    '阵亡曲线：1 秒后停在终点（不循环、不回弹）',
    'ang=' + tail.ang.toFixed(2) + ' rad，已稳定 ' + settled + ' 帧');
}

/* ---------- ④ 四套画法的一致性 ---------- */
function consistency() {
  console.log('\n--- ④ 一致性：同一段输入，四套画法的通道必须逐帧相同 ---');
  const ids = ['hero', 'whale', 'kimi', 'soldier'];
  const seqs = {};
  for (const key of ids) {
    const L = LOOKS.find(x => x.key === key);
    const a = L.make();
    reset(a);
    const s = [];
    a.prone = 0; a.crouch = 0;
    for (let i = 0; i < 90; i++) {
      /* 一段把主要状态都过一遍的剧本：跑 → 蹲 → 趴 → 换弹 → 受击 */
      if (i < 20) a.vx = 290;
      else if (i < 35) { a.vx = 0; api.crouchStep(a, true, DT); }
      else if (i < 50) { api.crouchStep(a, false, DT); api.poseStep(a, 'prone', true, DT); }
      else if (i < 65) { a.reloadDur = 0.8; a.reloading = Math.max(0, 0.8 * (1 - (i - 50) / 15)); }
      else { a.flash = Math.max(0, 0.16 - (i - 65) * DT); }
      api.setFrame(api.nowFrame() + 1);
      const P = api.actRun(a, DT);
      s.push([P.crouch, P.prone, P.reload, P.hit, P.bob, P.lean, P.w.run, P.w.crawl]);
    }
    seqs[key] = s;
  }
  let worst = 0, where = '';
  for (let i = 0; i < 90; i++) {
    for (let k = 0; k < 8; k++) {
      const v = seqs[ids[0]][i][k];
      for (const key of ids.slice(1)) {
        const d = Math.abs(seqs[key][i][k] - v);
        if (d > worst) { worst = d; where = '第' + i + '帧 通道' + k + ' ' + key; }
      }
    }
  }
  ok(worst < 1e-9, '主角 / 大肥鱼 / 干员 / 敌兵 姿态逐帧一致', 'Δ=' + worst.toExponential(1) + ' ' + where);
}

/* ---------- ⑤ 出图 ---------- */
const SHEET_ACTS = ['run', 'jump', 'fall', 'crouch', 'prone', 'crawl', 'reload', 'hit', 'death'];

/* 版面：列宽 / 行高都按内容算，不手填 —— 手填过一次，把两行标注叠在一起了。
   CELL_H 是从主画布上裁下来的窗口高度，行高必须比它大，否则上一格的下沿
   会压到下一格的上沿：BOSS 的名牌画在头顶 23px 处，行高只差 38px 时它就
   正好落进上一行的格子里，看着像「敌兵也有名牌」。所以 ROWH 由 CELL_H 推。 */
const COLW = 150, CELL_H = 190, CELL_W = 240, CELL_TOP = 170;
const ROWH = CELL_H + 10, PADX = 66, PADY = 74;

async function sheet() {
  fs.mkdirSync(OUT, { recursive: true });

  const W2 = PADX + COLW * SHEET_ACTS.length + 16;
  const H2 = PADY + ROWH * LOOKS.length + 20;
  const sheetC = createCanvas(W2, H2);
  const g = sheetC.getContext('2d');
  g.fillStyle = '#0d1218';
  g.fillRect(0, 0, W2, H2);
  g.textAlign = 'center';

  const camMark = api.camera.x;
  const origCtx = vm.runInContext('ctx', ctxVm);
  /* painter 全部走全局 ctx —— 临时把它指到这张对照图的 context 上 */
  vm.runInContext('ctx', ctxVm);

  g.fillStyle = '#dbe7f3';
  g.font = '600 16px "Microsoft YaHei"';
  g.fillText('动作层对照：行 = 角色，列 = 动作（每条动作取「最能读出这条动作」的那一帧）', W2 / 2, 30);
  g.font = '12px "Microsoft YaHei"';
  g.fillStyle = '#7f95ab';
  g.fillText('循环：跑步 / 跳跃 / 下落 / 蹲行 / 匍匐    一次性：上膛 / 受击 / 阵亡（敌兵那一列画的是尸体，友军是待救倒地）', W2 / 2, 50);

  for (let c = 0; c < SHEET_ACTS.length; c++) {
    g.fillStyle = '#9fb4c8';
    g.font = '600 13px "Microsoft YaHei"';
    g.fillText(ACTIONS.find(a => a.id === SHEET_ACTS[c]).label, PADX + COLW * c + COLW / 2, PADY - 14);
  }

  for (let r = 0; r < LOOKS.length; r++) {
    const L = LOOKS[r];
    const rowY = PADY + ROWH * r + ROWH - 22;
    g.fillStyle = '#c7d7e6';
    g.font = '600 13px "Microsoft YaHei"';
    g.textAlign = 'right';
    g.fillText(L.label, PADX - 14, rowY - 40);
    g.textAlign = 'center';

    for (let c = 0; c < SHEET_ACTS.length; c++) {
      const act = ACTIONS.find(x => x.id === SHEET_ACTS[c]);
      const a = L.make();
      reset(a);
      /* 取「最能读出这条动作」的那一帧：跑到中段、蹲/趴到底、换弹过半、受击第一拍 */
      const pick = { run: 26, jump: 6, fall: 6, crouch: 30, prone: 34, crawl: 34, reload: 36, hit: 2, death: 40 }[act.id];
      for (let i = 0; i <= pick; i++) {
        act.drive(a, i);
        /* 全局时钟也必须往前走：倒地曲线读的是 game.time - downedAt，
           不推时钟的话「阵亡」永远停在刚倒下的那一帧，画出来还是站着的
           （第一版这张图就是这样，看着像全部人都没死）。 */
        advance();
        api.setFrame(api.nowFrame() + 1);
        api.actRun(a, DT);
        clock += 1000 / 60 * 0.0001;      /* 推进一点点全局时钟，让呼吸/余震有相位 */
      }
      const cx = PADX + COLW * c + COLW / 2;
      const sx = cx, sy = rowY;
      /* 用和游戏里完全一样的 painter：camera 归零、实体脚底落在格子里 */
      const oldCam = api.camera.x;
      api.camera.x = 0;
      a.x = 0; a.y = 0;
      a.flatShadow = true;
      a.sx = undefined;
      /* painter 读全局 ctx：把它临时换到对照图上（vm 里 ctx 是 let/const，
         所以直接用 drawSoldier 的闭包版本是做不到的 —— 这里换成
         一个转发 shell：先画到临时画布再贴过来） */
      paintCell(g, a, sx, sy, act.id === 'death');
      api.camera.x = oldCam;
    }
  }

  const file = path.join(OUT, 'actions.png');
  fs.writeFileSync(file, sheetC.toBuffer('image/png'));
  console.log('  已出图 ' + file + '（' + W2 + '×' + H2 + '）');
  vm.runInContext('ctx', ctxVm);
}

/* 把一个角色画到对照图的指定脚底位置。
   painter 绑死全局 ctx，所以在主画布上画完再裁过来 —— 比把 ctx 换成
   参数要安全：那要改七套画法的签名，改漏一个就是「某个角色永远不出图」。

   「派给谁画」必须和游戏里的分派一模一样，否则这张图本身就成了假证据：
     · 敌兵 / BOSS 走 render2.js 的 drawEnemy（不是 drawSoldier）
     · 敌兵的阵亡是一条 corpse（drawCorpses 按 t 推曲线），
       活人那一套 downed 姿态只对玩家 / 大肥鱼 / 干员成立 */
function paintCell(g, a, sx, sy, isDeath) {
  const isEnemy = !!a.type;
  const main = ctx;
  main.save();
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.clearRect(0, 0, 1500, 1000);
  main.translate(700, 700);
  a.x = 0; a.y = 0;
  try {
    if (isEnemy && isDeath) {
      api.putCorpse({
        x: 0, y: 0, h: a.baseH || a.h, dir: 1,
        color: a.color, dark: a.dark, boss: !!a.boss, look: a.look || null,
        vy: 0, t: 0.62, life: 6, seed: 1, landed: true
      });
      api.drawCorpses();
      api.clearCorpses();
    } else if (isEnemy) {
      api.drawEnemy(a);
    } else {
      api.drawSoldier(a, false);
    }
  } catch (e) {
    console.log('    画不出 ' + (a.look || a.type) + '：' + e.message);
  }
  main.restore();
  g.drawImage(canvas, 700 - CELL_W / 2, 700 - CELL_TOP, CELL_W, CELL_H,
    sx - CELL_W / 2, sy - CELL_TOP, CELL_W, CELL_H);
}

(async () => {
  /* 先把关卡起起来：player / buddy 是 startStage 里造的，
     没有它们连「角色样本」都拿不到 */
  api.startStage(3);
  api.game.state = 'play';
  for (let i = 0; i < 8; i++) { clock += 1000 / 60; }

  /* 先等立绘解码：位图通道和矢量兜底是两条不同的代码路径，
     贴地 / 对照图必须在「游戏里真正会跑的那一条」上量，否则修的是空气。
     （第一版把等待放在出图那一步，结果 ⑥ 量到的全是不上场的矢量人偶。） */
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 3000) {
    /* 六张干员立绘也要等齐。不等的话 drawCast() 会安静地退回 drawAgent()，
       这里量到的就是那条**不上场**的程序化骨架 —— 第四轮在 dumpShop 上栽过一次，
       同一类错误在 _cast-look 之前也栽过一次。 */
    ready = vm.runInContext(
      `(function(){
         var ok = (typeof whaleSpriteReady==='function') && whaleSpriteReady() &&
                  (typeof heroSpriteReady==='function') && heroSpriteReady();
         var ns = (typeof CAST_SPRITE!=='undefined') ? Object.keys(CAST_SPRITE) : [];
         if (!ns.length) return false;
         for (var i=0;i<ns.length;i++) if (!castReady(ns[i])) return false;
         return ok;
       })()`,
      ctxVm);
    if (ready) break;
    await new Promise(r => setTimeout(r, 60));
  }
  console.log('--- 立绘解码：' + (ready ? '就绪 ✓（大肥鱼 / 主角 / 六干员）' : '超时 ✗（位图通道没就绪，下面量的是矢量兜底）') + ' ---');

  coverage();
  continuity();
  seams();
  consistency();
  ground();
  aliveness();
  await sheet();
  console.log('\n' + (fails === 0 ? '动作层验收通过 ✓' : '有 ' + fails + ' 项没通过 ✗') + '\n');
  process.exit(fails === 0 ? 0 : 1);
})();
