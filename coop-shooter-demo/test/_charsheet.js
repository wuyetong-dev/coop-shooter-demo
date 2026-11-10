/* 角色对照表：把大肥鱼按游戏内真实尺寸（96px 高）逐个姿态画到纯色底上。
   ------------------------------------------------------------------
   为什么需要它：战场截图里她被 HUD 面板和屏幕边缘切掉一半，看图根本
   判断不了「脚踩没踩地、枪握没握在拳上、蹲下有没有压扁」，而这几件事
   恰恰每次换立绘都会错一个。这里去掉关卡、去掉 HUD，一次排开九个姿态。

   用法：
     node test/_charsheet.js            出 shots/_charsheet.png（1x，真实尺寸）
     node test/_charsheet.js --zoom 3   再出一张 3 倍最近邻放大版
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');

for (const f of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf']) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) { /* 没有就算了 */ }
}

const W = 1180, H = 280;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const canvasEl = {
  width: W, height: H, style: {},
  getContext: () => ctx,
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H })
};

const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams, Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  addEventListener: () => {},
  innerWidth: W, innerHeight: H, devicePixelRatio: 1,
  document: {
    getElementById: () => canvasEl,
    createElement: () => createCanvas(8, 8)
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const cx = vm.createContext(sandbox);

const ORDER = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js'];
for (const f of ORDER) vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), cx, { filename: f });

/* 每格一个姿态：字段直接抄 drawWhaleGirl 会读的那些 */
const POSES = [
  { t: '待机 朝右', aim: 0 },
  { t: '待机 朝左', aim: Math.PI },
  { t: '举枪 平射', aim: 0, muzzle: 0.6 },
  { t: '举枪 抬射', aim: -0.55 },
  { t: '举枪 压射', aim: 0.5 },
  { t: '跑动', aim: 0.08, vx: 120, anim: 1.1 },
  { t: '蹲下', aim: 0, crouch: 1 },
  { t: '趴下', aim: 0, prone: 1 },
  { t: '受击红闪', aim: 0, invuln: 0.2 }
];

(async () => {
  /* 等四张立绘解码 —— 不等就全都画成矢量兜底，白看 */
  const probe = `(whaleSpriteReady() && whaleHoldReady() && heroSpriteReady() && heroHoldReady())`;
  for (let i = 0; i < 200; i++) {
    if (vm.runInContext(probe, cx)) break;
    await new Promise(r => setTimeout(r, 10));
  }
  const ready = vm.runInContext(probe, cx);
  console.log('立绘就绪：' + (ready ? '四张全部解码成功' : '有缺失 —— 下面画的是矢量兜底'));
  if (!ready) process.exitCode = 2;

  const api = vm.runInContext(`({ startStage, game, camera, player, get buddy(){return buddy;} })`, cx);
  api.startStage(1);
  api.game.time = 1.4;                 /* 尾巴/头发的摆动相位固定，两张图可比 */
  api.camera.x = 0;

  const CELL = 128, GROUND = H - 46;
  ctx.fillStyle = '#3c4550';
  ctx.fillRect(0, 0, W, H);
  /* 地面线：一眼看出脚是踩着还是悬着 */
  ctx.fillStyle = '#2c333c';
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.strokeStyle = '#8fa3b5';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, GROUND + 0.5); ctx.lineTo(W, GROUND + 0.5); ctx.stroke();

  const buddy = api.buddy;
  /* --only 6：只画第 6 格，铺满整张图 —— 名字牌与血条会压在身上，
     整排看的时候总分不清「哪块是装饰、哪块是身体」。 */
  const oi = process.argv.indexOf('--only');
  const only = oi > 0 ? parseInt(process.argv[oi + 1], 10) : -1;

  POSES.forEach((p, i) => {
    if (only >= 0 && i !== only) return;
    const cxp = only >= 0 ? W / 2 : 20 + CELL * i + CELL / 2;
    const a = Object.assign({}, buddy, {
      x: cxp, y: GROUND, aim: p.aim, vx: p.vx || 0, anim: p.anim || 0,
      crouch: p.crouch || 0, prone: p.prone || 0, muzzle: p.muzzle || 0,
      invuln: p.invuln || 0, landSquash: 0, airJumpT: 0, dashTime: 0,
      dead: false, downed: false, onGround: true, vy: 0
    });
    ctx.save();
    try { vm.runInContext('drawWhaleGirl', cx)(a, true); } catch (e) { console.log('  ✗ ' + p.t + ': ' + e.message); }
    ctx.restore();

    /* 角色原点竖线：脚底锚点应该正好落在这条线上 */
    ctx.strokeStyle = 'rgba(255,200,80,0.55)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cxp + 0.5, GROUND - 110); ctx.lineTo(cxp + 0.5, GROUND + 8); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#dfe8f0';
    ctx.font = '13px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.t, cxp, H - 16);
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '_charsheet.png'), await canvas.encode('png'));
  console.log('  ✓ shots/_charsheet.png  ' + W + 'x' + H);

  const zi = process.argv.indexOf('--zoom');
  const K = zi > 0 ? Math.max(2, parseInt(process.argv[zi + 1]) || 3) : 0;
  if (K) {
    const z = createCanvas(W * K, H * K);
    const g = z.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(canvas, 0, 0, W * K, H * K);
    fs.writeFileSync(path.join(OUT, '_charsheet_' + K + 'x.png'), await z.encode('png'));
    console.log('  ✓ shots/_charsheet_' + K + 'x.png  ' + W * K + 'x' + H * K);
  }
})();
