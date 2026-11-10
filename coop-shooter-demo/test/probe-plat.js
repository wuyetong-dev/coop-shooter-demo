/* 平台可达性探针
   1) 静态：每块空中平台都必须存在一个「下层落脚面」，且层差 < 跳高
   2) 动态：用真实物理（doJump + moveEntity）真的跳一次，必须落在这块平台上
   3) 实战：跑一局，统计八哥踩上平台的次数与层高分布                         */
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
  width: 1280, height: 720, style: {},
  getContext: () => makeCtx(), addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};
globalThis.document = { getElementById: () => canvasEl };
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.requestAnimationFrame = noop;

const base = path.join(__dirname, '..', 'js');
for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'hud.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}

const ENV = vm.runInThisContext(`({
  get world(){return world}, get game(){return game}, get player(){return player},
  get buddy(){return buddy}, buildStage, createPlayer, doJump, moveEntity,
  startStage, update, JUMP_V, GRAV, BUDDY_JUMP_H, surfaceBelow
})`);
const dt = 1 / 60;

/* ---------- 1) 静态可达性 ---------- */
console.log('=========== 1. 静态可达性（层差 vs 跳高）===========');
ENV.buildStage(1);                    /* 先建关卡，再取平台数组 */
const PLATS = ENV.world.platforms;
const jumpH = ENV.JUMP_V * ENV.JUMP_V / (2 * ENV.GRAV);
console.log('理论跳高 = ' + jumpH.toFixed(1) + 'px，八哥规划上限 = ' + ENV.BUDDY_JUMP_H + 'px');

const air = PLATS.filter(p => !p.ground);
let worst = 0;
for (const p of air) {
  let support = null;
  for (const q of PLATS) {
    if (q === p || q.ground) continue;
    if (q.y <= p.y + 8) continue;
    if (p.x + p.w <= q.x || p.x >= q.x + q.w) continue;
    if (!support || q.y < support.y) support = q;
  }
  const baseY = support ? support.y : ENV.world.groundY;
  const need = baseY - p.y;
  const from = support ? (support.mat + '台') : '地面';
  if (need > worst) worst = need;
  const ok = need <= jumpH - 6;
  console.log(`  ${p.mat.padEnd(8)} x=${String(Math.round(p.x)).padStart(4)} w=${String(p.w).padStart(3)} y=${p.y}  ← ${from} 差 ${String(need).padStart(3)}  ${ok ? '✓' : '✗ 跳不到'}`);
}
console.log('  最大层差 = ' + worst + 'px（余量 ' + (jumpH - worst).toFixed(0) + 'px）');

/* ---------- 2) 动态：真的跳一次 ---------- */
/* 这一组测的是「纯跳跃物理」，所以先把上升气流临时摘掉：
   风口柱正对着高台，起跳点落进去会被托高一整层，测的就不是跳跃本身了。
   （气流本身在 probe-map.js 第 2 组里单独验证） */
const windBackup = ENV.world.winds;
const windCount = windBackup.length;
ENV.world.winds = [];
console.log('\n=========== 2. 动态跳跃验证（真实物理）===========');
console.log(`  （已临时移走 ${windCount} 道气流的干扰）`);
function actorAt(x, y) {
  const a = ENV.createPlayer(x);
  a.y = y; a.vy = 0; a.onGround = true; a.plat = null; a.dropTimer = 0; a.jumpBuffer = 0;
  return a;
}
function runJump(a, vxFn, frames) {
  ENV.doJump(a);
  for (let i = 0; i < (frames || 200); i++) {
    a.vx = vxFn ? vxFn(a) : 0;
    ENV.moveEntity(a, dt);
    if (a.onGround) return true;
  }
  return false;
}
function supportUnder(x, p) {
  let best = null;
  for (const q of PLATS) {
    if (q === p || q.ground) continue;
    if (q.y <= p.y + 8) continue;
    if (x < q.x || x > q.x + q.w) continue;
    if (!best || q.y < best.y) best = q;
  }
  return best;
}

let passA = 0, failA = 0;
for (const p of air) {
  /* A：站在正下方，原地起跳 */
  const xm = p.x + p.w / 2;
  const sup = supportUnder(xm, p);
  const a = actorAt(xm, sup ? sup.y : ENV.world.groundY);
  runJump(a, null);
  const okA = a.plat === p;
  if (okA) passA++; else failA++;
  if (!okA) console.log(`  ✗A ${p.mat} x=${p.x} 起跳点=${Math.round(xm)} 落点 y=${Math.round(a.y)}（期望 ${p.y}）`);
}

/* B：穷举「起跳点 × 水平速度」，只要有一条路径能落上去就算可达 */
let passB = 0, failB = 0;
const failList = [];
for (const p of air) {
  const sp = supportUnder(p.x + p.w / 2, p);
  const baseY = sp ? sp.y : ENV.world.groundY;
  const starts = [];
  for (let k = 0; k <= 8; k++) {
    starts.push(p.x - 40 + (p.w + 80) * k / 8);
  }
  let ok = false, bestPath = '';
  for (const sx of starts) {
    for (const vx of [-290, -190, -90, 0, 90, 190, 290]) {
      const a2 = actorAt(sx, baseY);
      runJump(a2, () => vx);
      if (a2.plat === p) { ok = true; bestPath = `从 ${Math.round(sx)} 速度 ${vx} → 落上`; break; }
    }
    if (ok) break;
  }
  if (ok) passB++; else { failB++; failList.push(`${p.mat} x=${p.x} y=${p.y}`); }
}
console.log(`  A 原地跳：通过 ${passA} / ${air.length} 失败 ${failA}`);
console.log(`  B 穷举路径：通过 ${passB} / ${air.length} 失败 ${failB}` +
  (failList.length ? '  ✗ ' + failList.join('；') : ''));
ENV.world.winds = windBackup;   /* 还原，后面的实战组要照常吹风 */

/* ---------- 3) 实战：八哥会不会上平台 ---------- */
console.log('\n=========== 3. 实战：八哥上平台统计 ============');
function playStage(stage, style, frames) {
  ENV.startStage(stage);
  const b = ENV.buddy;
  b.style = style;
  const tiers = {};
  let jumps = 0, stood = 0, prevPlat = null, prevGround = true;
  for (let i = 0; i < frames; i++) {
    /* 让玩家站在后面不动，全靠八哥打 */
    ENV.player.invuln = 99;
    ENV.update(dt);
    if (b.plat) {
      const k = b.plat.y;
      if (k !== prevPlat) { tiers[k] = (tiers[k] || 0) + 1; stood++; }
      prevPlat = k;
    } else prevPlat = null;
    if (prevGround && !b.onGround) jumps++;
    prevGround = b.onGround;
  }
  const climbs = b.log.filter(l => l.text.indexOf('钢架') >= 0).length;
  return { tiers, stood, jumps, climbs, game: ENV.game };
}

for (const st of [0, 1, 2]) {
  const r = playStage(2, st, 60 * 45);
  const names = { 476: '低台', 384: '中台', 296: '高台' };
  const desc = Object.keys(r.tiers).map(k => (names[k] || ('y' + k)) + '×' + r.tiers[k]).join(' ') || '（没上过平台）';
  console.log(`  风格[${['谨慎', '均衡', '突击'][st]}] 上平台 ${r.stood} 次，起跳 ${r.jumps} 次 → ${desc}`);
}
