/* 趴姿解剖：只画一个角色，紧贴人裁切、放大 6 倍。
   ------------------------------------------------------------------
   为什么不用 _pose.js：_pose.js 是「两个人同框、300×130 的世界裁切」，
   大肥鱼在画面左边界外面半截，趴下时头到底朝哪边完全看不出来。
   这个脚本一次只画一个角色，裁切框按角色中心给，放大 6 倍。
   用法：node test/_prone.js [whale|hero|agent] [输出前缀]
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');
const WHO = process.argv[2] || 'whale';
const PREFIX = process.argv[3] || ('prone-' + WHO);

for (const f of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc']) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) {}
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

const api = vm.runInContext(`({
  get game(){ return game; }, get player(){ return player; }, get buddy(){ return buddy; },
  get enemies(){ return enemies; }, get camera(){ return camera; }, get world(){ return world; },
  get VIEW_ZOOM(){ return VIEW_ZOOM; }, frame
})`, ctxVm);

function step(n) { for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); } }

/* 只画目标角色：清空 → 世界层变换 → 一个 painter */
function drawOnly(actor, isBuddy) {
  sandbox.__actor = actor;
  vm.runInContext(`(function(){
    ctx.clearRect(0, 0, 1280, 720);
    ctx.save();
    ctx.translate(0, CAM_TY);
    ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
    __paint(__actor, ${isBuddy});
    ctx.restore();
  })()`, ctxVm);
}
const PAINT = WHO === 'whale' ? 'drawWhaleGirl(a, b)' : (WHO === 'hero' ? 'drawHero(a, b)' : 'drawAgent(a, b)');
vm.runInContext(`function __paint(a, b){ ${PAINT}; }`, ctxVm);

async function settle(maxMs = 3000) {
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < maxMs) {
    ok = vm.runInContext(
      `(typeof whaleHoldReady==='function'&&whaleHoldReady())&&(typeof heroHoldReady==='function'&&heroHoldReady())`,
      ctxVm);
    if (ok) break;
    await new Promise(r => setTimeout(r, 60));
  }
  return ok;
}

const toScreenY = wy => (wy - api.world.groundY) * api.VIEW_ZOOM + (720 - 78);

(async () => {
  const okSprite = await settle();
  console.log('立绘就绪：' + (okSprite ? '✓' : '✗（退化了，图不可信）'));
  fs.mkdirSync(OUT, { recursive: true });

  api.game.state = 'play';
  vm.runInContext('startStage(5)', ctxVm);
  step(40);
  api.enemies.length = 0;
  step(4);

  const p = api.player;
  const actor = WHO === 'whale' ? api.buddy : p;
  /* 名牌/对话气泡会被一起画进来挡住脸，解剖图里一律关掉 */
  const isBuddy = false;
  actor.x = 640 / api.VIEW_ZOOM;
  actor.vx = 0;
  actor.aim = 0;

  const poses = [
    ['stand', { crouch: 0, prone: 0 }],
    ['crouch', { crouch: 1, prone: 0 }],
    ['prone', { crouch: 0, prone: 1 }],
    ['prone+fire', { crouch: 0, prone: 1, muzzle: 0.06 }]
  ];

  const frames = [];
  const Z = 6, CW = 230, CH = 150;

  for (const [name, st] of poses) {
    actor.crouch = st.crouch; actor.prone = st.prone;
    actor.muzzle = st.muzzle || 0;
    step(1);
    /* frame() 会重算 aim/h，姿态要在这之后再写一次 */
    actor.x = 640 / api.VIEW_ZOOM;
    actor.vx = 0;
    actor.aim = 0;
    actor.crouch = st.crouch; actor.prone = st.prone;
    actor.muzzle = st.muzzle || 0;
    drawOnly(actor, isBuddy);

    /* 世界 → 屏幕：drawWhaleGirl 内部已经把 x 减掉了 camera.x，
       外层再乘 VIEW_ZOOM，所以屏幕 x 是 (wx - camera.x) * Z */
    const px = (actor.x - api.camera.x) * api.VIEW_ZOOM;
    const gy = toScreenY(actor.y);
    const x = Math.round(px - CW / 2), y = Math.round(gy - CH + 34);

    const c = createCanvas(CW * Z, CH * Z + 26);
    const g = c.getContext('2d');
    g.fillStyle = '#0d1218'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(canvas, x, y, CW, CH, 0, 0, CW * Z, CH * Z);
    /* 地面线参考：趴下时人应该贴着它 */
    const gl = (gy - y) * Z;
    g.strokeStyle = 'rgba(255,90,90,0.6)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, gl); g.lineTo(c.width, gl); g.stroke();
    g.fillStyle = '#7ee0a0'; g.font = '16px "Microsoft YaHei",sans-serif'; g.textBaseline = 'top';
    g.fillText(name, 8, CH * Z + 4);
    frames.push(c);
  }

  const W2 = CW * Z, H2 = frames.reduce((s, c) => s + c.height + 8, 0);
  const sheet = createCanvas(W2, H2);
  const sg = sheet.getContext('2d');
  sg.fillStyle = '#05080b'; sg.fillRect(0, 0, W2, H2);
  let yy = 0;
  for (const c of frames) { sg.drawImage(c, 0, yy); yy += c.height + 8; }
  const file = path.join(OUT, PREFIX + '.png');
  fs.writeFileSync(file, await sheet.encode('png'));
  console.log('✓ → shots/' + PREFIX + '.png  (' + sheet.width + '×' + sheet.height + ')');
})();
