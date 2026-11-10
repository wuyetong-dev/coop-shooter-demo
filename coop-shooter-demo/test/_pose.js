/* 姿态特写：把主角 / 大肥鱼的「站、蹲、趴」裁出来放大 4 倍，
   用来肉眼比对姿态改动（趴下抬头、枪口对齐）。

   为什么单独写一个脚本而不复用 shots.js：
   shots.js 拍的是整屏 1280×720，角色只有 96px 高、趴下只剩 30px，
   改了 3 个像素的抬头量在整屏图上根本看不出来。

   用法：node test/_pose.js [输出前缀]
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');
const PREFIX = process.argv[2] || 'pose';

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
  get buddy(){ return buddy; },
  get enemies(){ return enemies; },
  get keys(){ return keys; },
  get camera(){ return camera; },
  get world(){ return world; },
  get VIEW_ZOOM(){ return VIEW_ZOOM; },
  frame, render
})`, ctxVm);

function step(n) {
  for (let i = 0; i < n; i++) { clock += 1000 / 60; api.frame(clock); }
}

/* 只画世界层：不走 render()，因为 render() 底下会压 HUD ——
   血条面板正好盖住角色的腰以下，姿态对照图里下半身全看不见。 */
const DRAW_WORLD = `(function(){
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(0, CAM_TY);
  ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  drawBackground(); drawPlatforms(); drawProps();
  drawCovers(); drawBlocks();
  if (buddy) drawSoldier(buddy, false);   /* false：不画队友名牌，别挡脸 */
  if (player) drawSoldier(player, false);
  drawBullets();
  ctx.restore();
})()`;
const drawWorld = () => vm.runInContext(DRAW_WORLD, ctxVm);

/* 立绘解码要等一个事件循环 tick，否则全是矢量兜底。
   姿态图（蹲/趴那张专门的立绘）是同一类异步解码，一起等 —— 少等一张，
   拍出来的「蹲下」就还是旧的整图变形，看起来像修好了其实没走新路径。 */
async function settle(maxMs = 3000) {
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < maxMs) {
    ok = vm.runInContext(
      `(typeof whaleSpriteReady==='function'&&whaleSpriteReady())&&(typeof whaleHoldReady==='function'&&whaleHoldReady())` +
      `&&(typeof heroSpriteReady==='function'&&heroSpriteReady())&&(typeof heroHoldReady==='function'&&heroHoldReady())` +
      `&&(typeof POSE_IMG!=='undefined')` +
      `&&Object.keys(POSE_IMG).every(k=>Object.keys(POSE_IMG[k]).every(q=>{` +
      `  const m=POSE_IMG[k][q]; return m && m.complete && m.naturalWidth>0; }))`,
      ctxVm);
    if (ok) break;
    await new Promise(r => setTimeout(r, 60));
  }
  return ok;
}

/* 世界 y → 屏幕 y（和 render.js 的变换一致） */
const toScreenY = wy => (wy - api.world.groundY) * api.VIEW_ZOOM + (720 - 78);

/* 把一块屏幕区域裁出来放大 k 倍，并加边框 */
function crop(sx, sy, sw, sh, k, label) {
  const c = createCanvas(sw * k, sh * k + 26);
  const g = c.getContext('2d');
  g.fillStyle = '#10161d';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw * k, sh * k);
  g.fillStyle = '#7ee0a0';
  g.font = '16px "Microsoft YaHei",sans-serif';
  g.textBaseline = 'top';
  g.fillText(label, 8, sh * k + 4);
  return c;
}

(async () => {
  const sprites = await settle();
  console.log('立绘就绪：' + (sprites ? '✓' : '✗（退化了，下面的图不可信）'));
  fs.mkdirSync(OUT, { recursive: true });

  api.game.state = 'play';
  vm.runInContext('startStage(5)', ctxVm);     /* 第5关：地形平整、光线亮，姿态看得最清 */
  step(40);
  api.enemies.length = 0;                       /* 不要敌兵来抢镜 */
  step(6);

  const p = api.player, b = api.buddy;
  p.aim = 0;                                    /* 朝右，侧脸最清楚 */
  b.x = p.x - 96;                               /* 大肥鱼站主角左边，方便同框 */
  b.aim = 0;
  b.vx = 0;

  const px = p.x - api.camera.x;
  const gy = toScreenY(p.y);
  const W = 300, H = 130;
  const box = { x: Math.round(px - 96), y: Math.round(gy - 104) };

  const shots = [];

  /* 站立 */
  p.crouch = 0; p.prone = 0; b.crouch = 0; b.prone = 0;
  drawWorld();
  shots.push(['stand', crop(box.x, box.y, W, H, 4, '站立 — 主角（右） / 大肥鱼（左）')]);

  /* 蹲 */
  p.crouch = 1; p.prone = 0; b.crouch = 1; b.prone = 0;
  drawWorld();
  shots.push(['crouch', crop(box.x, box.y, W, H, 4, '蹲下')]);

  /* 趴下：先让 prone 走到 1（render 直接读 proneK，所以设值即生效） */
  p.crouch = 0; p.prone = 1; b.crouch = 0; b.prone = 1;
  drawWorld();
  shots.push(['prone', crop(box.x, box.y, W, H, 4, '趴下 — 头该朝前，不该脸朝地')]);

  /* 开火那一帧：看子弹起点和枪口焰对不对得上 */
  p.prone = 0; p.crouch = 0; b.prone = 0; b.crouch = 0;
  p.muzzle = 0.06; b.muzzle = 0.06;
  drawWorld();
  shots.push(['fire', crop(box.x, box.y, W, H, 4, '开火瞬间 — 枪口焰位置 = 子弹起点')]);

  /* 蹲着开火 / 趴着开火：姿态换了，枪的挂点也必须换。
     这两张是「枪线从枪口出」这条红线在新姿态图下的唯一凭据 ——
     蹲/趴各一张图，挂点各一份数据，哪一份标错了这里一眼看出来。 */
  p.muzzle = 0; b.muzzle = 0;
  p.crouch = 1; p.prone = 0; b.crouch = 1; b.prone = 0;
  p.muzzle = 0.06; b.muzzle = 0.06;
  drawWorld();
  shots.push(['crouchfire', crop(box.x, box.y, W, H, 4, '蹲下开火 — 枪口焰必须咬住枪管末端')]);

  const cqMu = vm.runInContext('muzzlePoint(player, player.aim)', ctxVm);

  p.crouch = 0; p.prone = 1; b.crouch = 0; b.prone = 1;
  p.muzzle = 0.06; b.muzzle = 0.06;
  drawWorld();
  shots.push(['pronefire', crop(box.x, box.y + 30, W, H, 4, '趴下开火 — 枪口焰必须咬住枪管末端')]);

  const prMu = vm.runInContext('muzzlePoint(player, player.aim)', ctxVm);
  p.muzzle = 0; b.muzzle = 0;

  /* 拼成一张竖排对照图 */
  const totalH = shots.reduce((s, x) => s + x[1].height + 8, 0);
  const sheet = createCanvas(W * 4, totalH);
  const sg = sheet.getContext('2d');
  sg.fillStyle = '#070a0d';
  sg.fillRect(0, 0, sheet.width, sheet.height);
  let y = 0;
  for (const [name, c] of shots) {
    sg.drawImage(c, 0, y);
    y += c.height + 8;
    c.name = name;
  }
  const file = path.join(OUT, PREFIX + '.png');
  fs.writeFileSync(file, await sheet.encode('png'));
  console.log('✓ → shots/' + PREFIX + '.png  (' + Math.round(sheet.width) + '×' + Math.round(sheet.height) + ')');

  /* 每段也单独存一份：合成图有 3000+ 高，读图工具会整体缩小，
     4 倍的细节全糊掉。单段文件才能 1:1 看清握把、枪口焰。 */
  for (const [name, c] of shots) {
    fs.writeFileSync(path.join(OUT, '_seg_' + name + '.png'), await c.encode('png'));
  }

  /* 同时把「子弹起点」和「枪口焰」的世界坐标打出来，做数值核对 */
  const mu = vm.runInContext('typeof muzzlePoint === "function" ? muzzlePoint(player, player.aim) : null', ctxVm);
  console.log('player: y=' + p.y.toFixed(1) + ' h=' + (p.h || 0).toFixed(1) +
    ' aim=0' + ' · muzzlePoint=' + (mu ? ('(' + mu.x.toFixed(1) + ',' + mu.y.toFixed(1) + ')') : '未定义（还在用旧公式）'));
  console.log('旧公式 fireWeapon 起点: x=' + (p.x + Math.cos(0) * 30).toFixed(1) +
    ' y=' + (p.y - p.h * 0.62).toFixed(1));
  /* 三档姿态的枪口，横向位移应当随姿态单调往前（蹲比站远、趴比蹲远） */
  console.log('枪口 蹲: ' + (cqMu ? '(' + cqMu.x.toFixed(1) + ',' + cqMu.y.toFixed(1) + ')' : '—') +
    '  趴: ' + (prMu ? '(' + prMu.x.toFixed(1) + ',' + prMu.y.toFixed(1) + ')' : '—'));
  /* 姿态图到底有没有被用上 —— 没有的话上面三张图看着「变好了」其实是错觉 */
  const art = vm.runInContext(
    `['crouch','prone'].map(q=>{const m=POSE_IMG.hero&&POSE_IMG.hero[q];` +
    `return q+':'+(m&&m.complete?'✓ '+m.naturalWidth+'x'+m.naturalHeight:'✗ 未解码');}).join('  ')`, ctxVm);
  console.log('姿态图 ' + art);

  /* ---------------- 真输入回归 ----------------
     上面所有截图都是「直接写 p.crouch=1 再画」，这条路绕过了主循环。
     一旦写成「写完再 step()」，crouchStep 会按真实输入把蹲量补间回 0，
     姿态图就永远不接管 —— 画面上表现为「枪按站姿挂点画，于是浮在
     蹲着的手上方」，很容易被误读成锚点标错。
     这一段按真实按键跑，专门证明「玩家真蹲下去，姿态图会接上」。 */
  for (const [key, frames, label] of [['KeyS', 26, '真按 S 蹲 0.43s'], ['KeyZ', 30, '真按 Z 趴 0.5s']]) {
    vm.runInContext(`keys['KeyS']=false; keys['KeyZ']=false;`, ctxVm);
    step(40);                                   /* 先回站姿 */
    vm.runInContext(`keys['${key}']=true`, ctxVm);
    step(frames);
    const r = vm.runInContext(`({cq: cqEff(player), pr: proneK(player),
      art: poseArtOf('hero', cqEff(player), proneK(player)),
      h: player.h, y: player.y})`, ctxVm);
    vm.runInContext(`keys['${key}']=false`, ctxVm);
    const ok = !!(r && r.art);
    console.log(label + ' → cq=' + r.cq.toFixed(3) + ' pr=' + r.pr.toFixed(3) +
      ' h=' + r.h.toFixed(1) + '  姿态图接管 ' + (ok ? '✓ ' + r.art.key : '✗ 退回整图变形'));
  }
  step(40);
})();
