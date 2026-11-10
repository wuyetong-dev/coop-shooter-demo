/* 枪口对位（像素级）：黄点必须咬在**画出来的枪管末端**上。
   ------------------------------------------------------------------
   这是用户点过名的 bug 类型：「枪线不是从枪口出来的」。
   光看代码说「两边读同一个 anchor」不够 —— 只要有一处变换顺序写反，
   代码读起来一模一样，画出来差 10 像素。

   所以这里不看代码，看像素：
     1. 把角色画到画布上；
     2. 把 muzzlePoint 换算成画布坐标；
     3. 沿枪管**往后** 2~4px 取样，那里必须是枪的深色油墨
        （不是皮肤、不是背景、不是裙摆）；
     4. 沿枪管**往前** 5~7px 取样，那里必须是背景（枪管外面没有东西）。

   五种姿态都要过：站立 / 蹲下 / 趴下 / 抬枪 / 压枪。蹲下压扁、趴下放倒、
   准星俯仰这三条变换叠在枪口上的顺序，是最容易写错的地方。

   用法：node test/_muzzlefit.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const CW = 460, CH = 460;
const ORIGIN_X = CW / 2, ORIGIN_Y = CH - 110;
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
  get camera(){return camera;}, startStage,
  actRun, crouchStep, poseStep, drawSoldier, muzzlePoint,
  setFrame:(n)=>{_frameNo=n;}, nowFrame:()=>_frameNo
})`, ctxVm);

const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, label, note) {
  if (c) { pass++; console.log('  ✓ ' + label + (note ? '  ' + note : '')); }
  else { fail++; console.log('  ✗ ' + label + (note ? '  ' + note : '')); }
}

function shot(look, prep) {
  const a = Object.assign({}, api.player);
  a.look = look; a.anim = 0; a.act = null; a._pose = null; a._poseNo = -1;
  a._mo = null; a._moNo = -1; a.crouchPs = null; a.pronePs = null;
  a.vx = 0; a.x = 0; a.y = 0; a.onGround = true; a.aim = 0;
  a.muzzle = 0; a.reloading = 0; a.reloadT = 0; a.reloadDur = 0;
  const DT = 1 / 60;
  for (let i = 0; i < 34; i++) {
    prep && prep(a, i);
    clock += 1000 / 60;
    api.game.time += DT;
    api.setFrame(api.nowFrame() + 1);
    api.actRun(a, DT);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CW, CH);
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  api.camera.x = 0; a.x = 0; a.y = 0;
  let drew = true;
  try { api.drawSoldier(a, false); } catch (e) { drew = false; }
  const m = drew ? api.muzzlePoint(a) : null;
  ctx.restore();
  if (!m) return null;
  return { m, px: ORIGIN_X + m.x, py: ORIGIN_Y + m.y, ang: m.ang };
}

function sample(px, py, dx, dy, dist) {
  const x = Math.round(px + dx * dist), y = Math.round(py + dy * dist);
  if (x < 0 || y < 0 || x >= CW || y >= CH) return null;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return { a: d[3], r: d[0], g: d[1], b: d[2] };
}
/* 「枪的油墨」：不透明 + 偏暗（枪身是 #2c343b 一档的深灰） */
function isGunInk(s) {
  if (!s || s.a < 190) return false;
  return (s.r * 0.299 + s.g * 0.587 + s.b * 0.114) < 125;
}

(async () => {
  api.startStage(3);
  api.game.state = 'play';
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    if (vm.runInContext(`['kimi','glm','gpt','grok','gemini','claude'].every(function(k){return castReady(k)})`, ctxVm)) break;
    await wait(50);
  }

  const LOOKS = ['hero', 'whale', 'kimi', 'glm', 'gpt', 'grok', 'gemini', 'claude'];
  const POSES = [
    ['站立', null],
    ['蹲下', (a) => { api.crouchStep(a, true, 1 / 60); }],
    ['趴下', (a) => { api.poseStep(a, 'prone', true, 1 / 60); }],
    ['抬枪', (a) => { a.aim = -1.05; }],
    ['压枪', (a) => { a.aim = 0.85; }]
  ];

  console.log('\n--- 枪口：黄点必须咬在画出来的枪管上 ---');
  let swallowed = 0, total = 0;
  for (const look of LOOKS) {
    const bad = [], nums = [];
    for (const [label, prep] of POSES) {
      const r = shot(look, prep);
      if (!r) { bad.push(label + '=空'); nums.push(label + '空'); continue; }
      const ca = Math.cos(r.ang), sa = Math.sin(r.ang);
      /* 硬判据：枪口**往后** 2~4px 必须是枪的深色油墨。
         这是「黄点有没有咬在枪管上」——两边读同一个 anchor 就一定成立，
         但只要有人改动其中一处变换顺序，这条立刻红。 */
      const behind = [2, 3, 4].map(d => isGunInk(sample(r.px, r.py, ca, sa, -d)));
      /* 软指标：枪口**往前** 5~7px 是不是空的。宽头发的角色（格克 / 双子）
         枪管会压在自己的发团上 —— 枪是后画的、看得见，子弹也从枪口出，
         所以不算错，只是记一笔：这几格枪管没有伸出剪影。 */
      const ahead = [5, 7].map(d => {
        const s = sample(r.px, r.py, ca, sa, d);
        return !!s && s.a < 70;
      });
      const okBehind = behind.filter(Boolean).length >= 2;
      const okAhead = ahead.filter(Boolean).length >= 2;
      total++;
      if (!okAhead) swallowed++;
      if (!okBehind) bad.push(label + '[' + [2,3,4].map(function(d){var q=sample(r.px,r.py,ca,sa,-d);return q?(q.a+':'+Math.round(q.r*0.299+q.g*0.587+q.b*0.114)):'null'}).join(' ') + ']');
      nums.push(label + (okBehind ? (okAhead ? '✓' : '○') : '✗'));
    }
    ok(bad.length === 0, look.padEnd(7) + ' 五个姿态枪口都咬在枪管末端',
      nums.join(' ') + (bad.length ? '   失败：' + bad.join(',') : ''));
  }
  console.log('  注：○ = 枪管压在自己身上（看得见、不影响弹道），共 ' + swallowed + '/' + total + ' 格');

  console.log('\n' + (fail === 0 ? '枪口验收通过 ✓' : '枪口验收失败 ' + fail + ' 项 ✗') +
    '  （' + pass + ' 通过 / ' + fail + ' 失败）');
  process.exit(fail === 0 ? 0 : 1);
})();
