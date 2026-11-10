/* 位图干员的「试衣间」：游戏内真实尺寸（96px 高）× 4 倍最近邻放大，
   一次看一个人在六个姿势下的样子。用来判断立绘缩到 96px 后糊不糊、
   拆腿/蹲下/趴下有没有崩、枪口黄点是不是落在枪管末端。

   用法：node test/_cast-look.js [kimi|glm|gpt|grok|gemini|claude] [tag]
        → shots/castlook-<tag>.png
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const WHO = process.argv[2] || 'kimi';
const TAG = process.argv[3] || WHO;
const ONLY = process.argv[4] || '';
const ZOOM = Number(process.argv[5] || 4);
for (const f of ['C:/Windows/Fonts/msyh.ttc']) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) {}
}
const CW = 460, CH = 460;
const canvas = createCanvas(CW, CH);
const ctx = canvas.getContext('2d');
let clock = 0;
const canvasEl = {
  width: CW, height: CH, style: {}, getContext: () => ctx, addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: CW, height: CH })
};
const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams, Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock }, requestAnimationFrame: () => 0,
  addEventListener: () => {}, innerWidth: CW, innerHeight: CH, devicePixelRatio: 1,
  document: { getElementById: () => canvasEl, createElement: () => createCanvas(8, 8) }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);
for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js'])
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });

const api = vm.runInContext(`({
  get game(){return game;}, get player(){return player;}, get buddy(){return buddy;},
  get camera(){return camera;}, startStage, createEnemy, update,
  actRun, actPlay, crouchStep, poseStep, drawSoldier, muzzlePoint, castReady,
  setFrame:(n)=>{_frameNo=n;}, nowFrame:()=>_frameNo
})`, ctxVm);

const wait = ms => new Promise(r => setTimeout(r, ms));

function paint(look, prep, frames) {
  const a = Object.assign({}, api.player);
  a.look = look; a.anim = 0; a.act = null; a._pose = null; a._poseNo = -1;
  a._mo = null; a._moNo = -1; a.crouchPs = null; a.pronePs = null;
  a.vx = 0; a.x = 0; a.y = 0; a.onGround = true; a.aim = 0;
  const DT = 1 / 60;
  const N = frames || 34;
  for (let i = 0; i < N; i++) {
    prep && prep(a, i);
    clock += 1000 / 60;
    api.game.time += DT;
    api.setFrame(api.nowFrame() + 1);
    api.actRun(a, DT);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CW, CH);
  ctx.translate(CW / 2, CH - 90);
  api.camera.x = 0; a.x = 0; a.y = 0;
  api.drawSoldier(a, false);
  let muzzle = null;
  try { muzzle = api.muzzlePoint(a); } catch (e) {}
  if (muzzle) {
    ctx.beginPath(); ctx.arc(muzzle.x, muzzle.y, 1.3, 0, 6.29);
    ctx.fillStyle = '#ffe14d'; ctx.fill();
  }
  ctx.restore();
  const d = ctx.getImageData(0, 0, CW, CH).data;
  let x0 = CW, x1 = 0, y0 = CH, y1 = 0;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    if (d[(y * CW + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  return { a, muzzle, x0, y0, x1, y1 };
}

(async () => {
  api.startStage(3);
  api.game.state = 'play';
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    if (api.castReady(WHO)) break;
    await wait(50);
  }
  console.log(WHO, '立绘就绪', api.castReady(WHO));

  const DT = 1 / 60;
  const CASES = [
    ['站立', null],
    ['跑步', (a) => { a.vx = 290; a.anim = Math.PI / 2; }],
    ['蹲下', (a) => { api.crouchStep(a, true, DT); }],
    ['趴下', (a) => { api.poseStep(a, 'prone', true, DT); }],
    ['上膛', (a, i) => { if (i === 0) api.actPlay(a, 'reload', 0.9); }],
    ['举手枪', (a) => { a.aim = -1.15; }],
  ];
  const S = ZOOM, PAD = 10;
  const cells = [];
  for (const [label, prep] of CASES) {
    if (ONLY && label !== ONLY) continue;
    const r = paint(WHO, prep);
    if (!r) { console.log('无墨', label); continue; }
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    const c = createCanvas(w, h);
    c.getContext('2d').drawImage(canvas, r.x0, r.y0, w, h, 0, 0, w, h);
    cells.push({ label: label, c, w, h, r });
    console.log(label.padEnd(4), WHO, 'w=' + w, 'h=' + h,
      'muzzle=' + (r.muzzle ? r.muzzle.x.toFixed(1) + ',' + r.muzzle.y.toFixed(1) : 'null'));
  }
  const TW = cells.reduce((s, c) => s + c.w * S + PAD, PAD);
  const TH = Math.max(...cells.map(c => c.h * S)) + 26 + PAD;
  const out = createCanvas(TW, TH);
  const g = out.getContext('2d');
  g.fillStyle = '#1a1e24'; g.fillRect(0, 0, TW, TH);
  g.imageSmoothingEnabled = false;
  let x = PAD;
  for (const c of cells) {
    g.drawImage(c.c, 0, 0, c.w, c.h, x, 26, c.w * S, c.h * S);
    g.fillStyle = '#9fe8ff'; g.font = '13px "Microsoft YaHei"';
    g.fillText(c.label + '  ' + c.w + 'x' + c.h, x, 18);
    x += c.w * S + PAD;
  }
  const file = path.join(ROOT, 'shots', 'castlook-' + TAG + '.png');
  fs.writeFileSync(file, out.toBuffer('image/png'));
  console.log('已出', file, '(' + out.width + 'x' + out.height + ')');
})();
