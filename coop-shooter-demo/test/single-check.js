/* 单文件产物验收：不跑分文件，直接把打包后的内联脚本抽出来，
   用同一套浏览器桩件跑一遍「趴下」链路 —— 打包最怕的就是
   某段代码在新作用域里丢了常量，而分文件测试永远发现不了。

   跑法： node test/single-check.js
   依赖： 先执行 node build-single.js 生成 ../coop-demo.html */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const noop = () => {};
const grad = { addColorStop: noop };

function makeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 90 });
      if (p === 'canvas') return canvasEl;
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

const canvasEl = {
  width: 1280, height: 720,
  style: {},
  getContext: () => makeCtx(),
  addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};

globalThis.document = { getElementById: () => canvasEl, querySelector: () => null };
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.requestAnimationFrame = noop;

/* ---------- 从单文件里抠出内联脚本 ---------- */
const htmlPath = path.join(__dirname, '..', '..', 'coop-demo.html');
const html = fs.readFileSync(htmlPath, 'utf8');
/* 定位「打包后的那个 <script>」：以 util.js 的分节注释为锚，往前找最近的 <script> 开标签 */
const anchor = html.indexOf('/* ===== util.js ===== */');
if (anchor < 0) {
  console.error('✗ 单文件里找不到内联脚本块，打包可能没生效');
  process.exit(1);
}
const from = html.lastIndexOf('<script>', anchor) + '<script>'.length;
const to = html.indexOf('</script>', anchor);
if (from < 0 || to < 0) {
  console.error('✗ 内联脚本块边界异常，打包格式可能被改动');
  process.exit(1);
}
const bundle = html.slice(from, to);
console.log('单文件脚本 ' + Math.round(bundle.length / 1024) + ' KB / 全包 ' + Math.round(html.length / 1024) + ' KB');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

try {
  vm.runInThisContext(bundle, { filename: 'single-bundle.js' });
} catch (e) {
  console.error('✗ 内联脚本执行失败：' + e.message);
  process.exit(1);
}

const g = vm.runInThisContext('({ get game(){return game}, get player(){return player}, get buddy(){return buddy}, get enemies(){return enemies}, get enemies2(){return enemies}, startStage, update, render, get cqEff(){return cqEff}, get pronePose(){return pronePose}, get stanceH(){return stanceH}, get stanceHitW(){return stanceHitW}, get PRONE_FLAT(){return PRONE_FLAT}, get proneK(){return proneK}, get ENEMY_TYPES(){return ENEMY_TYPES}, createEnemy, suppressPass, get world(){return world} })');

console.log('--- 单文件 · 趴下常量在包内可见 ---');
ok('PRONE_DROP 已进包（h 基准 58）', typeof g.stanceH === 'function');
ok('PRONE_FLAT = 84.6°', Math.abs(g.PRONE_FLAT * 180 / Math.PI - 84.6) < 0.2,
  (g.PRONE_FLAT * 180 / Math.PI).toFixed(1) + '°');

startStage(1);
g.game.state = 'playing';
const p = g.player;
const step = 1 / 60;

function run(n) { for (let i = 0; i < n; i++) { update(step); render(); } }

console.log('--- 单文件 · 站立基线 ---');
run(6);
ok('站立 h=58', Math.abs(p.h - 58) < 0.5, 'h=' + p.h.toFixed(2));
ok('站立 hitW=30', Math.abs(p.hitW - 30) < 0.5, 'hitW=' + p.hitW.toFixed(2));

console.log('--- 单文件 · 趴下（按住 Z，和真实操作同一条链路）---');
const U = vm.runInThisContext('({ keys, get player(){return player} })');
U.keys['KeyZ'] = true;      /* 趴下由 updatePlayer 每帧读键推进，直接写 prone 会被覆盖 */
run(40);                     /* 0.0004 插值约 0.35s 到位，给足 40 帧 */
ok('趴下 h=28', Math.abs(p.h - 28) < 0.6, 'h=' + p.h.toFixed(2));
ok('趴下 hitW=66', Math.abs(p.hitW - 66) < 0.6, 'hitW=' + p.hitW.toFixed(2));
ok('蹲趴互斥：cqEff=0', g.cqEff(p) < 0.001, 'cqEff=' + g.cqEff(p).toFixed(3));
ok('proneK 已满值', g.proneK(p) > 0.98, 'prone=' + p.prone.toFixed(3));
const pp = g.pronePose(p, 96, 1);
ok('躺倒角≈84.6°', Math.abs(pp.ang * 180 / Math.PI - 84.6) < 0.5, (pp.ang * 180 / Math.PI).toFixed(1) + '°');
ok('整体抬升 > 0', pp.lift > 5, 'lift=' + pp.lift.toFixed(1));

console.log('--- 单文件 · 趴着连跑 120 帧不炸（四套 painter 都被调用）---');
let err = null;
try { run(120); } catch (e) { err = e; }
ok('120 帧无异常', !err, err ? err.message : '');
ok('跑动后仍趴着（h 未回弹）', p.h < 34, 'h=' + p.h.toFixed(2));

console.log('--- 单文件 · 起身 ---');
U.keys['KeyZ'] = false;
run(40);
ok('起身 h 回 58', Math.abs(p.h - 58) < 1.2, 'h=' + p.h.toFixed(2));
ok('起身 hitW 回 30', Math.abs(p.hitW - 30) < 1.2, 'hitW=' + p.hitW.toFixed(2));

/* ---------- 通用卧倒：全兵种 + 压制感知，也必须活到包里 ----------
   分段测试跑的是源码，打包换了一层作用域；`prone: true` 写在 ENEMY_TYPES 里、
   `suppressPass` 挂在 updateBullets 里，这两处最容易在打包时被漏掉。 */
console.log('--- 单文件 · 卧倒是通用动作（不是机枪兵专属）---');
const ALL = ['grunt', 'rusher', 'gunner', 'thrower', 'boss', 'boss2', 'boss3'];
const missing = ALL.filter(k => !g.ENEMY_TYPES[k] || !g.ENEMY_TYPES[k].prone);
ok('全兵种 prone=true（' + ALL.length + ' 个）', missing.length === 0,
  missing.length ? '缺: ' + missing.join(',') : '');

const gy = g.world.groundY;
g.enemies.length = 0;
const probe = g.createEnemy('grunt', p.x + 320, 1);
probe.x = p.x + 320; probe.y = gy; probe.vy = 0; probe.onGround = true;
probe.spawnGuard = 0; probe.suppress = 0; probe.suppressCd = 0;
probe.proneT = 0; probe.proneCd = 0; probe.fireCd = 5;
g.enemies.push(probe);                       /* 压制判定遍历 enemies，先入列 */
const whY = probe.y - probe.h * 0.7 + 20;
g.suppressPass(probe.x - 220, whY, probe.x + 220, whY, 'player');
ok('suppressPass 已进包并点亮探针', probe.suppress > 0, 'suppress=' + probe.suppress.toFixed(2));
ok('擦身判定带采样冷却', probe.suppressCd > 0, 'cd=' + probe.suppressCd.toFixed(2));

let sawProne = 0;
for (let i = 0; i < 40; i++) {
  probe.x = p.x + 320; probe.vx = 0; probe.y = gy; probe.vy = 0; probe.onGround = true;
  update(step); render();
  sawProne = Math.max(sawProne, g.proneK(probe));
}
ok('被压制 → 就地卧倒', sawProne > 0.5, 'prone=' + sawProne.toFixed(2));

console.log('');
if (fail) { console.log('单文件验收失败：' + fail + ' 项 ✗ / ' + (pass + fail) + ' 项'); process.exit(1); }
console.log('单文件验收通过 ✓  ' + pass + ' 项');
