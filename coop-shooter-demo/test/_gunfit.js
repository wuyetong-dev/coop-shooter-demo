/* 掌心标定：把同一个姿态图挂上枪，只改 hand 的 y，横排比对。
   ------------------------------------------------------------
   为什么不能靠算：枪的握把 GUN_GRIP 是设计稿里的一个点，它要和
   **画出来的那只手**重合。手和枪在立绘里本来就连成一块，alpha 扫
   不出边界，只能看。所以做一张条带图，眼睛一次过完。

   裁框必须**以掌心为中心**：之前按玩家脚底框（px-74, 宽 132），
   蹲姿掌心落在屏幕 x≈288，框尾只到 278 —— 整把枪在框外，看起来
   像"枪没画出来"，其实画了。现在先算出掌心屏幕坐标，再围绕它裁。

   每格都画一个青红十字在锚点上：
     · 十字压在握把上 = 挂点选对了
     · 十字在手背上方、枪也浮着 = hand.y 要变小（往上收）
     · 十字在手心下方、枪压着手腕 = hand.y 要变大（往下放）

   用法：node test/_gunfit.js [crouch|prone] [--x]
         --x  改横扫 5 档（定完纵向再定横向）
   ------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');
const POSE = process.argv[2] === 'prone' ? 'prone' : 'crouch';
const SWEEP_X = process.argv.includes('--x');

GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');

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
  Array, Object, Boolean, Error, Set, Map, URLSearchParams, Image,
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

const api = vm.runInContext(`({ get game(){return game;}, get player(){return player;},
  get buddy(){return buddy;}, get enemies(){return enemies;}, get camera(){return camera;},
  get world(){return world;}, get VIEW_ZOOM(){return VIEW_ZOOM;},
  get CAM_TY(){return CAM_TY;}, get HERO_VH(){return HERO_VH;}, frame })`, ctxVm);

const DRAW = `(function(){
  ctx.clearRect(0,0,1280,720);
  ctx.save();
  ctx.translate(0, CAM_TY); ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  drawBackground(); drawPlatforms(); drawProps(); drawCovers(); drawBlocks();
  if (player) drawSoldier(player, false);
  drawBullets();
  ctx.restore();
})()`;

function step(n) { for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); } }
async function settle(maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = vm.runInContext(
      `(typeof heroHoldReady==='function'&&heroHoldReady())&&(typeof POSE_IMG!=='undefined')` +
      `&&Object.keys(POSE_IMG).every(k=>Object.keys(POSE_IMG[k]).every(q=>{` +
      `const m=POSE_IMG[k][q];return m&&m.complete&&m.naturalWidth>0;}))`, ctxVm);
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
  api.enemies.length = 0;
  step(6);

  const p = api.player;
  p.aim = 0; p.vx = 0;
  p.crouch = POSE === 'crouch' ? 1 : 0;
  p.prone = POSE === 'prone' ? 1 : 0;
  p.muzzle = 0.06;                       /* 开火那一帧：看得见枪口在哪 */

  /* 不要在这里 step()：主循环的 crouchStep 会按真实输入把蹲量补间回 0，
     姿态图就永远不接管（表现为「枪按站姿挂点画，于是浮在蹲着的手上方」）。
     直接写状态，后面只调 DRAW，不再走帧。 */

  const art = vm.runInContext(`POSE_ART.hero.${POSE}`, ctxVm);
  const Z = api.VIEW_ZOOM;
  const base = { x: art.hand[0], y: art.hand[1] };

  /* 掌心世界坐标 —— 直接读游戏自己的 poseHand，别在这里抄一份公式 */
  const local = vm.runInContext(`poseHand(POSE_ART.hero.${POSE}, HERO_VH)`, ctxVm);
  const hsx = (p.x - api.camera.x + local.x) * Z;
  const hsy = (p.y + local.y) * Z + api.CAM_TY;

  /* 以掌心为中心裁，向右多给：枪身整根朝 +x 伸出去。
     蹲姿实测：立绘屏幕盒 x[239,295] y[548,642]，掌心 (288,598)，
     枪从掌心往右再铺 ~70px —— 框要盖住"整只手 + 整把枪"。 */
  const CX = Math.round(hsx - 70), CY = Math.round(hsy - 70);
  const CW = 200, CH = 140, K = 4;

  const D = [-0.06, -0.03, 0, 0.03, 0.06];
  const cells = [];
  for (const d of D) {
    const hx = base.x + (SWEEP_X ? d : 0);
    const hy = base.y + (SWEEP_X ? 0 : d);
    vm.runInContext(`POSE_ART.hero.${POSE}.hand = [${hx}, ${hy}]`, ctxVm);
    vm.runInContext(DRAW, ctxVm);

    /* 当前这档的掌心屏幕坐标（扫哪轴哪轴会动） */
    const lc = vm.runInContext(`poseHand(POSE_ART.hero.${POSE}, HERO_VH)`, ctxVm);
    const ax = (p.x - api.camera.x + lc.x) * Z;
    const ay = (p.y + lc.y) * Z + api.CAM_TY;

    const c = createCanvas(CW * K, CH * K);
    const g = c.getContext('2d');
    g.fillStyle = '#10161d'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(canvas, CX, CY, CW, CH, 0, 0, CW * K, CH * K);

    /* 锚点十字：画在裁剪后的局部坐标上 */
    const lx = (ax - CX) * K, ly = (ay - CY) * K;
    g.strokeStyle = 'rgba(0,240,255,0.95)'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(lx - 16, ly); g.lineTo(lx + 16, ly);
    g.moveTo(lx, ly - 16); g.lineTo(lx, ly + 16);
    g.stroke();
    g.beginPath(); g.arc(lx, ly, 4, 0, Math.PI * 2); g.stroke();

    cells.push({ c: c, v: (SWEEP_X ? hx : hy), d: d });
  }

  const W = CW * K, H = CH * K, PAD = 10, LBL = 40;
  const out = createCanvas(PAD + (W + PAD) * cells.length, LBL + H + PAD + 26);
  const g = out.getContext('2d');
  g.fillStyle = '#0b0f14'; g.fillRect(0, 0, out.width, out.height);
  g.textBaseline = 'top';
  cells.forEach((it, i) => {
    const x = PAD + i * (W + PAD);
    g.drawImage(it.c, x, LBL);
    g.fillStyle = it.d === 0 ? '#8fe3b0' : '#7ee0ff';
    g.font = 'bold 22px "Microsoft YaHei"';
    g.fillText((SWEEP_X ? 'hand.x=' : 'hand.y=') + it.v.toFixed(4) +
      '  (' + (it.d >= 0 ? '+' : '') + it.d.toFixed(2) + ')', x + 6, 8);
  });
  g.fillStyle = '#7f8b99';
  g.font = '18px "Microsoft YaHei"';
  g.fillText('十字 = 游戏实际读到的掌心挂点。握把压住十字 = 这一档就是对的。  姿态 ' + POSE +
    '   盾：掌心屏幕坐标 (' + hsx.toFixed(1) + ', ' + hsy.toFixed(1) + ')', PAD + 4, LBL + H + 4);

  const name = '_gunfit_' + POSE + (SWEEP_X ? '_x' : '') + '.png';
  fs.writeFileSync(path.join(OUT, name), out.toBuffer('image/png'));
  console.log('→ shots/' + name + '  ' + out.width + 'x' + out.height);
  console.log('  本地掌心 local=(' + local.x.toFixed(2) + ', ' + local.y.toFixed(2) + ')  屏幕=(' +
    hsx.toFixed(1) + ', ' + hsy.toFixed(1) + ')');

  /* 第二张：贴着手部的特写。远景图看整体是否成立，
     特写图才看得清握把有没有嵌进掌心那一道浅窝。 */
  const TX = Math.round(hsx - 52), TY = Math.round(hsy - 44);
  const TW = 108, TH = 84, TK = 8;
  const tight = createCanvas(PAD + (TW * TK + PAD) * cells.length, LBL + TH * TK + PAD + 26);
  const tg = tight.getContext('2d');
  tg.fillStyle = '#0b0f14'; tg.fillRect(0, 0, tight.width, tight.height);
  tg.textBaseline = 'top';
  let ti = 0;
  for (const d of D) {
    const hx = base.x + (SWEEP_X ? d : 0);
    const hy = base.y + (SWEEP_X ? 0 : d);
    vm.runInContext(`POSE_ART.hero.${POSE}.hand = [${hx}, ${hy}]`, ctxVm);
    vm.runInContext(DRAW, ctxVm);
    const lc = vm.runInContext(`poseHand(POSE_ART.hero.${POSE}, HERO_VH)`, ctxVm);
    const ax = (p.x - api.camera.x + lc.x) * Z;
    const ay = (p.y + lc.y) * Z + api.CAM_TY;
    const c = createCanvas(TW * TK, TH * TK);
    const g2 = c.getContext('2d');
    g2.fillStyle = '#10161d'; g2.fillRect(0, 0, c.width, c.height);
    g2.imageSmoothingEnabled = false;
    g2.drawImage(canvas, TX, TY, TW, TH, 0, 0, TW * TK, TH * TK);
    const lx = (ax - TX) * TK, ly = (ay - TY) * TK;
    g2.strokeStyle = 'rgba(0,240,255,0.95)'; g2.lineWidth = 2;
    g2.beginPath();
    g2.moveTo(lx - 13, ly); g2.lineTo(lx + 13, ly);
    g2.moveTo(lx, ly - 13); g2.lineTo(lx, ly + 13);
    g2.stroke();
    const x = PAD + ti * (TW * TK + PAD);
    tg.drawImage(c, x, LBL);
    tg.fillStyle = d === 0 ? '#8fe3b0' : '#7ee0ff';
    tg.font = 'bold 20px "Microsoft YaHei"';
    tg.fillText((SWEEP_X ? 'x=' : 'y=') + (SWEEP_X ? hx : hy).toFixed(4), x + 6, 8);
    ti++;
  }
  tg.fillStyle = '#7f8b99';
  tg.font = '17px "Microsoft YaHei"';
  tg.fillText('特写：十字是掌心挂点。握把中段压住十字、枪身不要把手背切穿 —— 那一档就对。', PAD + 4, LBL + TH * TK + 4);
  const tn = '_gunfit_' + POSE + (SWEEP_X ? '_x' : '') + '_tight.png';
  fs.writeFileSync(path.join(OUT, tn), tight.toBuffer('image/png'));
  console.log('→ shots/' + tn + '  ' + tight.width + 'x' + tight.height);
})();
