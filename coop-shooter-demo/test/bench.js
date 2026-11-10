/* A/B 对照：同一关卡、同一随机种子下，旧版 vs 新版八哥 AI 的实战数据
   用法： node bench.js [aiA] [aiB]   默认 test/ai-v1.js  vs  js/ai.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');

const canvasEl = {
  width: 1280, height: 720, style: {},
  getContext: () => new Proxy({}, {
    get: (t, p) => (p === 'canvas' ? canvasEl
      : p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} })
      : p === 'measureText' ? () => ({ width: 60 })
      : () => {}),
    set: (t, p, v) => (t[p] = v, true)
  }),
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeSim(aiPath, seed) {
  const sandbox = {
    console, isFinite, parseFloat, parseInt,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
    document: { getElementById: () => canvasEl }
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const files = [
    path.join(JS, 'util.js'),
    path.join(JS, 'world.js'),
    aiPath,
    path.join(JS, 'game.js'),
    path.join(JS, 'render.js'),
    path.join(JS, 'chars.js'),
    path.join(JS, 'render2.js'),
    path.join(JS, 'hud.js')
  ];
  for (const f of files) {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.basename(f) });
  }
  sandbox.__rng = mulberry32(seed);
  vm.runInContext('Math.random = __rng;', ctx);
  return ctx;
}

function run(aiPath, seed, stage, seconds) {
  const ctx = makeSim(aiPath, seed);
  const api = vm.runInContext('({ game, player, buddy, startStage, update, damageFriendly, keys, input })', ctx);

  const st = { buddyHits: 0, playerHits: 0, buddyDowns: 0, playerDowns: 0, enemyShots: 0 };
  const orig = ctx.damageFriendly;
  ctx.damageFriendly = function (actor, dmg) {
    if (actor && !actor.dead && !actor.downed && !(actor.invuln > 0)) {
      if (actor.kind === 'buddy') { st.buddyHits++; if (actor.hp - dmg <= 0) st.buddyDowns++; }
      else if (actor.kind === 'player') {
        st.playerHits++;
        if (actor.hp - dmg <= 0) st.playerDowns++;
        /* 沙包模式：血量兜底，保证两边都跑满同样的时长 */
        if (actor.hp < 40) actor.hp = 40;
      }
    }
    return orig(actor, dmg);
  };
  const origBullet = ctx.spawnBullet;
  ctx.spawnBullet = function (x, y, vx, vy, dmg, team, color, size, owner) {
    if (team === 'enemy') st.enemyShots++;
    return origBullet(x, y, vx, vy, dmg, team, color, size, owner);
  };

  api.startStage(stage);

  /* 玩家完全挂机：不移动、不开枪、不按键 —— 只有八哥在打 */
  const dt = 1 / 60;
  const total = Math.round(seconds * 60);
  let gameoverAt = -1;

  for (let i = 0; i < total; i++) {
    api.update(dt);
    if (api.game.state !== 'playing') {
      if (gameoverAt < 0 && api.game.state === 'gameover') gameoverAt = i / 60;
      break;
    }
  }

  const t = api.game.tele || {};
  const tele = api.game.tele ? api.game.tele : { buddyShots: 0, buddyHits: 0, buddyDmg: 0, buddyKills: 0, dodges: 0 };
  return {
    seed, stage,
    killed: api.game.kills,
    wave: api.game.wave,
    state: api.game.state,
    gameoverAt,
    buddyHits: st.buddyHits,
    buddyDowns: st.buddyDowns,
    playerHits: st.playerHits,
    playerDowns: st.playerDowns,
    enemyShots: st.enemyShots,
    shots: tele.buddyShots || 0,
    hits: tele.buddyHits || 0,
    dmg: Math.round(tele.buddyDmg || 0),
    kills: tele.buddyKills || 0,
    dodges: tele.dodges || 0,
    death: api.buddy && api.buddy.dead ? 1 : 0
  };
}

function bench(label, aiPath, seeds, stage, seconds) {
  const rows = [];
  for (const s of seeds) rows.push(run(aiPath, s, stage, seconds));
  const avg = k => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const acc = sum('shots') > 0 ? sum('hits') / sum('shots') : 0;
  return {
    label, rows,
    killed: avg('killed'),
    wave: avg('wave'),
    buddyHits: avg('buddyHits'),
    buddyDowns: avg('buddyDowns'),
    playerHits: avg('playerHits'),
    playerDowns: avg('playerDowns'),
    enemyShots: avg('enemyShots'),
    shots: sum('shots'),
    hits: sum('hits'),
    acc,
    dmg: avg('dmg'),
    dodges: avg('dodges'),
    death: avg('death'),
    gameoverAt: avg('gameoverAt')
  };
}

function fmt(n, d) { return (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toString(); }

function report(a, b) {
  const rows = [
    ['八哥独立击杀 / 90s', fmt(a.killed, 1), fmt(b.killed, 1)],
    ['推到第几波', fmt(a.wave, 1), fmt(b.wave, 1)],
    ['敌方开枪总数', fmt(a.enemyShots, 0), fmt(b.enemyShots, 0)],
    ['八哥被击中次数', fmt(a.buddyHits, 0), fmt(b.buddyHits, 0)],
    ['八哥中弹率(每百发)', fmt(a.enemyShots ? a.buddyHits / a.enemyShots * 100 : 0, 1), fmt(b.enemyShots ? b.buddyHits / b.enemyShots * 100 : 0, 1)],
    ['八哥倒地次数', fmt(a.buddyDowns, 1), fmt(b.buddyDowns, 1)],
    ['八哥命中率', a.shots ? fmt(a.acc * 100, 1) + '%' : '-', b.shots ? fmt(b.acc * 100, 1) + '%' : '-'],
    ['八哥总输出伤害', fmt(a.dmg, 0), fmt(b.dmg, 0)],
    ['躲弹动作次数', fmt(a.dodges, 0), fmt(b.dodges, 0)],
    ['玩家被击中次数', fmt(a.playerHits, 0), fmt(b.playerHits, 0)],
    ['玩家倒地次数', fmt(a.playerDowns, 1), fmt(b.playerDowns, 1)]
  ];
  const w0 = 18, w1 = 14, w2 = 14;
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length * 1.0));
  console.log('\n' + pad('指标', w0) + pad('A 旧版', w1) + pad('B 新版', w2) + '变化');
  console.log('-'.repeat(w0 + w1 + w2 + 10));
  for (const r of rows) console.log(pad(r[0], w0) + pad(r[1], w1) + pad(r[2], w2));
}

const aiA = process.argv[2] || path.join(__dirname, 'ai-v1.js');
const aiB = process.argv[3] || path.join(JS, 'ai.js');
const seeds = [11, 22, 33, 44, 55];
const seconds = 90;

let A = { killed: 0, wave: 0, buddyHits: 0, buddyDowns: 0, playerHits: 0, playerDowns: 0, enemyShots: 0, shots: 0, hits: 0, acc: 0, dmg: 0, dodges: 0, death: 0 };
let B = { killed: 0, wave: 0, buddyHits: 0, buddyDowns: 0, playerHits: 0, playerDowns: 0, enemyShots: 0, shots: 0, hits: 0, acc: 0, dmg: 0, dodges: 0, death: 0 };

/* 混合两层关卡，各跑 5 个种子 */
for (const stage of [1, 2]) {
  const a = bench('A', aiA, seeds, stage, seconds);
  const b = bench('B', aiB, seeds, stage, seconds);
  console.log('\n=========== 第 ' + stage + ' 关 · 玩家全程挂机 ' + seconds + 's · 5 个随机种子 ===========');
  report(a, b);
  for (const k of ['killed', 'wave', 'buddyHits', 'buddyDowns', 'playerHits', 'playerDowns', 'enemyShots', 'dmg', 'dodges', 'death']) {
    A[k] += a[k] / 2; B[k] += b[k] / 2;
  }
  A.shots += a.shots; A.hits += a.hits;
  B.shots += b.shots; B.hits += b.hits;
}
A.acc = A.shots ? A.hits / A.shots : 0;
B.acc = B.shots ? B.hits / B.shots : 0;
console.log('\n=========== 两关平均 ===========');
report(A, B);
