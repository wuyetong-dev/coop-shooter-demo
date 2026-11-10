/* 高倍握持台：脱离游戏画布，把「姿态立绘 + 枪」按同一套公式在 6 倍尺度上合成。
   ------------------------------------------------------------
   为什么不用游戏画布放大：游戏里角色只有 ~94px 高，放大会把插值糊一起放大，
   看不到握把形状。这里直接把 ctx 整体缩放，枪是矢量画的 → 6 倍下依然干净，
   立绘是位图 → 略软但轮廓清楚。这样才判得出「握把有没有坐进掌心」。

   读的是游戏自己的 drawHero，挂点、镜像、倾角、后坐一个都不复制。
   用法：node test/_hold3x.js [crouch|prone] [S]
   ------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');
const POSE = process.argv[2] === 'prone' ? 'prone' : 'crouch';
const S = Number(process.argv[3] || 6);

GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');

const W = 900, H = 760;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
let clock = 0;
const canvasEl = {
  width: W, height: H, style: {}, getContext: () => ctx,
  addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H })
};
const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams, Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock },
  requestAnimationFrame: () => 0, addEventListener: () => {},
  innerWidth: W, innerHeight: H, devicePixelRatio: 1,
  document: { getElementById: () => canvasEl, createElement: () => createCanvas(8, 8) }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);
for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js']) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });
}
const api = vm.runInContext(`({ get game(){return game;}, get player(){return player;},
  get camera(){return camera;}, get HERO_VH(){return HERO_VH;}, frame })`, ctxVm);

function step(n) { for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); } }
async function settle(maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = vm.runInContext(`(typeof heroHoldReady==='function'&&heroHoldReady())&&(typeof POSE_IMG!=='undefined')` +
      `&&Object.keys(POSE_IMG).every(k=>Object.keys(POSE_IMG[k]).every(q=>{const m=POSE_IMG[k][q];return m&&m.complete&&m.naturalWidth>0;}))`, ctxVm);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 60));
  }
  return false;
}

(async () => {
  if (!await settle()) { console.error('✗ 素材没就绪'); process.exit(1); }
  api.game.state = 'play';
  vm.runInContext('startStage(5)', ctxVm);
  step(40);
  vm.runInContext('enemies.length = 0', ctxVm);
  step(6);

  const p = api.player;
  /* 把角色挪到世界原点、相机也归零：这样 drawHero 的本地坐标就是输出坐标 */
  p.x = 0; p.vx = 0; p.aim = 0;
  api.camera.x = 0;
  p.crouch = POSE === 'crouch' ? 1 : 0;
  p.prone = POSE === 'prone' ? 1 : 0;
  p.muzzle = 0.05;

  const art = vm.runInContext(`POSE_ART.hero.${POSE}`, ctxVm);
  const base = { x: art.hand[0], y: art.hand[1] };
  const OX = 240, OY = 690;             /* 脚底在设备像素里的落点 */

  const D = [-0.03, 0, 0.03];
  const CW = 400, CH = 330, PAD = 10, LBL = 40;
  const cells = [];

  for (const d of D) {
    const hx = base.x, hy = base.y + d;
    vm.runInContext(`POSE_ART.hero.${POSE}.hand = [${hx}, ${hy}]`, ctxVm);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#161d25'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    /* 世界点 (0, p.y=地面) 要落在设备像素 (OX, OY)：
       先把 ctx 整体缩放 S 并平移到 (OX,OY)，再把世界地面挪到原点。
       drawHero 内部是 translate(sx, a.y)，a.y 还是世界坐标，不扣就会跑到画布外。 */
    ctx.setTransform(S, 0, 0, S, OX, OY);
    ctx.translate(0, -p.y);
    vm.runInContext('drawHero(player, false)', ctxVm);
    ctx.restore();

    const lc = vm.runInContext(`poseHand(POSE_ART.hero.${POSE}, HERO_VH)`, ctxVm);
    const ax = OX + lc.x * S, ay = OY + lc.y * S;

    const c = createCanvas(CW, CH);
    const g = c.getContext('2d');
    g.fillStyle = '#10161d'; g.fillRect(0, 0, CW, CH);
    g.drawImage(canvas, Math.round(ax - 100), Math.round(ay - 120), CW, CH, 0, 0, CW, CH);

    /* 十字：横向长线（看枪身高度对不对），纵向短线 */
    const lx = 100, ly = 120;
    g.strokeStyle = 'rgba(0,240,255,0.9)'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(lx - 90, ly); g.lineTo(lx + 90, ly);
    g.moveTo(lx, ly - 18); g.lineTo(lx, ly + 18);
    g.stroke();

    cells.push({ c: c, v: hy, d: d });
  }

  const out = createCanvas(PAD + (CW + PAD) * cells.length, LBL + CH + PAD + 30);
  const g = out.getContext('2d');
  g.fillStyle = '#0b0f14'; g.fillRect(0, 0, out.width, out.height);
  g.textBaseline = 'top';
  cells.forEach((it, i) => {
    const x = PAD + i * (CW + PAD);
    g.drawImage(it.c, x, LBL);
    g.fillStyle = it.d === 0 ? '#8fe3b0' : '#7ee0ff';
    g.font = 'bold 22px "Microsoft YaHei"';
    g.fillText('hand.y = ' + it.v.toFixed(4), x + 8, 8);
  });
  g.fillStyle = '#7f8b99';
  g.font = '17px "Microsoft YaHei"';
  g.fillText('6 倍美术台 · ' + POSE + ' · 青线 = 游戏实际挂点。枪身中轴要落在手心那条横线附近，握着才不浮。',
    PAD + 4, LBL + CH + 6);

  const name = '_hold3x_' + POSE + '.png';
  fs.writeFileSync(path.join(OUT, name), out.toBuffer('image/png'));
  console.log('→ shots/' + name + '  ' + out.width + 'x' + out.height);
})();
