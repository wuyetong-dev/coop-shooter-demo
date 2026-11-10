/* 蹲行步态「读得出来吗」诊断。
   像素差只能证明腿在动，证明不了「一前一后」—— 用户第二次否掉的就是这个：
   「小腿没有前后交错，虽然在动」。所以这里出的是关键相位的放大序列，
   直接用眼睛判断，顺便把腿的透明度轮廓打出来（切点该在哪用数据定，不靠猜）。

   用法：node test/_legseq.js [tag]
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');
const TAG = process.argv[2] || 'now';

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
  get player(){ return player; }, get buddy(){ return buddy; },
  get enemies(){ return enemies; }, get keys(){ return keys; },
  get game(){ return game; }, get VIEW_ZOOM(){ return VIEW_ZOOM; },
  frame, poseWarpOf, poseGeom, POSE_ART
})`, ctxVm);
const step = n => { for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); } };

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

async function settle(maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = vm.runInContext(
      `(typeof POSE_IMG!=='undefined')&&Object.keys(POSE_IMG).every(k=>Object.keys(POSE_IMG[k]).every(q=>{` +
      `const m=POSE_IMG[k][q];return m&&m.complete&&m.naturalWidth>0;}))`, ctxVm);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 60));
  }
  return false;
}

function grab(sx, sy, sw, sh) {
  const c = createCanvas(sw, sh);
  c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

/* 立绘自己的 alpha 轮廓：每一行打印「哪些列有肉」，用来定切点 */
function silhouette() {
  const im = vm.runInContext('POSE_IMG.hero.crouch', ctxVm);
  const w = im.naturalWidth, h = im.naturalHeight;
  const c = createCanvas(w, h), g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  const col = i => { const n = []; for (let x = 0; x < w; x++) if (d[(i * w + x) * 4 + 3] > 40) n.push(x); return n; };
  const runs = xr => {
    const out = []; let s = null;
    for (let x = 0; x < w; x++) {
      const on = xr.includes(x);
      if (on && s === null) s = x;
      if (!on && s !== null) { out.push([s, x - 1]); s = null; }
    }
    if (s !== null) out.push([s, w - 1]);
    return out;
  };
  console.log(`crouch 画幅 ${w}x${h}  foot=${api.POSE_ART.hero.crouch.foot}`);
  console.log('行   v     有肉的列段（列号/宽度比 u）');
  for (let i = Math.round(h * 0.60); i < h; i += 2) {
    const r = runs(col(i));
    console.log(
      String(i).padStart(3) + '  ' + (i / h).toFixed(2).padStart(4) + '   ' +
      r.map(([a, b]) => `${a}-${b} (u ${(a / w).toFixed(2)}~${(b / w).toFixed(2)})`).join('  '));
  }
}

function grid(cells, k, label, cols) {
  const CW = cells[0].cv.width, CH = cells[0].cv.height;
  const rows = Math.ceil(cells.length / cols);
  const c = createCanvas(cols * CW * k, rows * (CH * k + 20));
  const g = c.getContext('2d');
  g.fillStyle = '#0e141b';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '14px sans-serif';
  g.textBaseline = 'top';
  cells.forEach((cell, i) => {
    const x = (i % cols) * CW * k, y = Math.floor(i / cols) * (CH * k + 20);
    g.drawImage(cell.cv, 0, 0, CW, CH, x, y, CW * k, CH * k);
    g.fillStyle = '#33414f';
    g.fillRect(x, y, CW * k, 1); g.fillRect(x, y, 1, CH * k);
    g.fillStyle = '#8fd0ff';
    g.fillText(cell.label, x + 5, y + CH * k + 3);
  });
  fs.writeFileSync(path.join(OUT, label + '.png'), c.toBuffer('image/png'));
  console.log('→ shots/' + label + '.png  ' + c.width + 'x' + c.height);
}

(async () => {
  const ok = await settle();
  console.log('姿态图就绪：' + (ok ? '✓' : '✗'));
  if (!ok) return;
  fs.mkdirSync(OUT, { recursive: true });
  silhouette();

  api.game.state = 'play';
  vm.runInContext('startStage(5)', ctxVm);
  step(50);
  api.enemies.length = 0;
  if (api.buddy) api.buddy.x = 60000;
  api.player.aim = 0;

  /* 按住 S+D 走到稳态，然后把 anim 钉死在四个关键相位再画 */
  for (const k in api.keys) api.keys[k] = false;
  api.keys.KeyS = true; api.keys.KeyD = true;
  step(40);

  const p = api.player;
  const VZ = api.VIEW_ZOOM;
  const snap = () => {
    const w = api.poseWarpOf(p);
    return { art: w ? w.kind : 'none', amp: w ? (w.amp || 0) : 0, vx: p.vx };
  };
  console.log('\n蹲行状态 vx=' + p.vx.toFixed(1) + '  warp=' + JSON.stringify(snap()));

  /* 裁腿带：角色钉在 (640, 518)，蹲图 vh≈77、w≈45.5，腿带 y 0.66~1.0 */
  const BX = 640 - 34, BY = 518 - 32, BW = 68, BH = 36;
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const th = i * Math.PI / 2;
    p.anim = th;
    drawOne();
    cells.push({ cv: grab(BX, BY, BW, BH), label: 'θ=' + (i * 90) + '° sin=' + Math.sin(th).toFixed(2) });
  }
  grid(cells, 11, '_legseq_' + TAG, 2);

  /* 真正该看的是「游戏里那么大」。放大会把 1px 的缝夸成一条疤，
     而玩家看到的就是下面这个尺寸 —— 两档都出，别只信放大图。 */
  const real = [];
  for (let i = 0; i < 8; i++) {
    p.anim = i * Math.PI / 4;
    drawOne();
    real.push({ cv: grab(BX, BY, BW, BH), label: (i * 45) + '°' });
  }
  grid(real, 5, '_legseq_' + TAG + '_5x', 4);
})();
