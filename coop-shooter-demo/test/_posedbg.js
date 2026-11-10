/* 姿态图落地诊断：算清「立绘包围盒 / 掌心锚点 / 枪口点」三者
   在屏幕上的确切位置，供 _gunfit.js 定裁框，也供人工判断对不对。

   用法：node test/_posedbg.js [crouch|prone|stand]
   ------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const POSE = ['crouch', 'prone', 'stand'].includes(process.argv[2]) ? process.argv[2] : 'crouch';

const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d');
let clock = 0;
const canvasEl = {
  width: 1280, height: 720, style: {}, getContext: () => ctx,
  addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};
const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams, Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock },
  requestAnimationFrame: () => 0, addEventListener: () => {},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  document: { getElementById: () => canvasEl, createElement: () => createCanvas(8, 8) }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);
for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js']) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });
}
const api = vm.runInContext(`({ get game(){return game;}, get player(){return player;},
  get enemies(){return enemies;}, get camera(){return camera;}, get world(){return world;},
  get VIEW_ZOOM(){return VIEW_ZOOM;}, get CAM_TY(){return CAM_TY;}, frame })`, ctxVm);

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
  step(40); api.enemies.length = 0; step(6);

  const p = api.player;
  p.aim = 0; p.vx = 0;
  p.crouch = POSE === 'crouch' ? 1 : 0;
  p.prone = POSE === 'prone' ? 1 : 0;
  p.muzzle = 0;
  /* 别 step：crouchStep 会按真实输入把蹲量拉回 0，poseArtOf 就返回 null */

  const Z = api.VIEW_ZOOM;
  const sx = p.x - api.camera.x, sy = p.y;

  const report = vm.runInContext(`(function(){
    const art = POSE_ART.hero['${POSE}'];
    const gm = poseGeom(art, HERO_VH);
    const hd = poseHand(art, HERO_VH);
    const an = gunAnchor(player);
    return {
      art: { w: art.w, h: art.h, foot: art.foot, hand: art.hand },
      geom: gm, hand: hd,
      anchor: an,
      poseArt: !!(an && an.poseArt)
    };
  })()`, ctxVm);

  console.log('姿态 =', POSE, ' VIEW_ZOOM =', Z.toFixed(3), ' CAM_TY =', api.CAM_TY.toFixed(2));
  console.log('玩家脚底 世界=(', p.x.toFixed(1), ',', p.y.toFixed(1), ') 屏幕=(', sx.toFixed(1), ',', (sy * Z + api.CAM_TY).toFixed(1), ')');
  console.log('立绘 geom  vh=' + report.geom.vh.toFixed(2) + '  w=' + report.geom.w.toFixed(2) + '  dx=' + report.geom.dx.toFixed(2));
  console.log('  屏幕包围盒 x [' + ((sx + report.geom.dx) * Z).toFixed(1) + ', ' + ((sx + report.geom.dx + report.geom.w) * Z).toFixed(1) + ']' +
    '   y [' + ((sy - report.geom.vh) * Z + api.CAM_TY).toFixed(1) + ', ' + (sy * Z + api.CAM_TY).toFixed(1) + ']');
  console.log('掌心 local=(' + report.hand.x.toFixed(2) + ', ' + report.hand.y.toFixed(2) + ')  屏幕=(' +
    ((sx + report.hand.x) * Z).toFixed(1) + ', ' + ((sy + report.hand.y) * Z + api.CAM_TY).toFixed(1) + ')');
  console.log('gunAnchor', JSON.stringify(report.anchor));
  console.log('poseArt =', report.poseArt);

  /* 枪口：直接问游戏 */
  const mz = vm.runInContext(`(function(){ const m = muzzlePoint ? muzzlePoint(player) : null; return m; })()`, ctxVm);
  if (mz) console.log('枪口 local=(' + mz.x.toFixed(2) + ', ' + mz.y.toFixed(2) + ')  屏幕=(' +
    ((sx + mz.x) * Z).toFixed(1) + ', ' + ((sy + mz.y) * Z + api.CAM_TY).toFixed(1) + ')');
})();
