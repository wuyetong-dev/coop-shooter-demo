/* 无头冒烟测试：用桩件模拟浏览器，跑完整游戏循环，检查运行时报错与关键数值 */
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

globalThis.document = { getElementById: () => canvasEl };
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.requestAnimationFrame = noop;

const base = path.join(__dirname, '..', 'js');
const files = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(base, f), 'utf8');
  vm.runInThisContext(code, { filename: f });
}

const g = vm.runInThisContext('({ get game(){return game}, get player(){return player}, get buddy(){return buddy}, get enemies(){return enemies}, get bullets(){return bullets}, startStage, update, render, onKeyPress, get particles(){return particles} })');

function simulate(label, frames, action) {
  const dt = 1 / 60;
  let err = null;
  for (let i = 0; i < frames; i++) {
    if (action) action(i);
    try {
      update(dt);
      g.render();
    } catch (e) {
      err = e;
      console.log('  ✗ 第 ' + i + ' 帧报错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
      break;
    }
    if (g.game.state === 'gameover' || g.game.state === 'stageclear') break;
  }
  const gs = g.game;
  console.log('[' + label + '] 状态=' + gs.state + ' 关卡=' + gs.stage + ' 波次=' + gs.wave +
    ' 击杀=' + gs.kills + ' 敌人剩=' + g.enemies.length +
    ' 玩家HP=' + (g.player ? Math.round(g.player.hp) : '-') +
    ' 八哥HP=' + (g.buddy ? Math.round(g.buddy.hp) : '-') +
    ' 八哥状态=' + (g.buddy ? g.buddy.state : '-') +
    ' 子弹=' + g.bullets.length + (err ? '  ❌' : '  ✓'));
  return gs;
}

console.log('--- 1) 加载完成，标题页渲染 ---');
g.render();

console.log('--- 2) 开局 + 玩家挂机 60 秒（看八哥能否独立作战） ---');
g.startStage(1);
let s = simulate('挂机', 60 * 60);

console.log('--- 3) 重开，玩家主动模拟操作（移动+开火+换枪）---');
g.startStage(1);
let frameNo = 0;
s = simulate('操作', 60 * 90, (i) => {
  frameNo = i;
  const p = g.player;
  if (!p) return;
  // 简单脚本：朝最近的敌人移动并开火
  let tgt = null, bd = 1e9;
  for (const e of g.enemies) {
    if (e.dead) continue;
    const d = Math.abs(e.x - p.x);
    if (d < bd) { bd = d; tgt = e; }
  }
  if (tgt) {
    const dir = Math.sign(tgt.x - p.x);
    vm.runInThisContext('keys')['KeyA'] = dir < 0;
    vm.runInThisContext('keys')['KeyD'] = dir > 0;
    const mw = vm.runInThisContext('mouseWorld')();
    vm.runInThisContext('input').firing = true;
    // 用真实鼠标坐标模拟瞄准：把鼠标设到目标屏幕坐标
    vm.runInThisContext('input').mx = tgt.x - vm.runInThisContext('camera').x;
    vm.runInThisContext('input').my = tgt.y - tgt.h * 0.55;
  } else {
    vm.runInThisContext('keys')['KeyA'] = false;
    vm.runInThisContext('keys')['KeyD'] = true;
    vm.runInThisContext('input').firing = false;
  }
  if (i % 240 === 0) g.onKeyPress(i % 480 === 0 ? 'Digit2' : 'Digit1');
  if (i % 300 === 0) g.onKeyPress('KeyG');
  if (i % 400 === 0) g.onKeyPress('KeyR');
});

console.log('--- 4) 强制玩家倒地，检查八哥救援逻辑 ---');
g.startStage(2);
simulate('热身', 120, null);
g.player.hp = 1;
vm.runInThisContext('damageFriendly')(g.player, 50);
console.log('  玩家倒地=' + g.player.downed + ' 八哥状态=' + g.buddy.state);
simulate('救援', 60 * 6, null);
console.log('  救援后 玩家倒地=' + g.player.downed + ' 玩家HP=' + Math.round(g.player.hp));

console.log('--- 5) 跳关到 BOSS 波，检查 BOSS 与召唤 ---');
g.startStage(3);
g.game.wave = 4;
vm.runInThisContext('beginWave')();
simulate('BOSS', 60 * 20, null);
console.log('  敌人构成: ' + g.enemies.map(e => e.type).join(','));

console.log('--- 6) 全部波次清完后是否进入过关 ---');
g.startStage(1);
g.game.wave = 4;
vm.runInThisContext('beginWave')();
for (let i = 0; i < 60 * 20; i++) {
  for (const e of g.enemies) vm.runInThisContext('killEnemy')(e);
  g.game.spawnQueue.forEach(sq => sq.done = true);
  update(1 / 60);
  g.render();
  if (g.game.state !== 'playing') break;
}
console.log('  状态=' + g.game.state + '（期望 stageclear）');
g.onKeyPress('Enter');
console.log('  回车后 关卡=' + g.game.stage + ' 状态=' + g.game.state);

console.log('--- 7) 长时间稳定性（每帧 render，1800 帧）---');
g.startStage(4);
simulate('稳定', 1800, null);
console.log('  粒子=' + g.particles.length + ' 子弹=' + g.bullets.length);

/* ------------------------------------------------------------------
   8) 趴下：唯一数据源 + 蹲趴互斥 + 爬行限速 + 冲刺禁用 + 敌兵架枪
   这一节是「趴下」的回归闸门。趴下的坑全在数值联动上 —— 蹲姿没淡出
   就会 58−17−30 = 11 叠成负身高，所以这里逐条钉死。
   ------------------------------------------------------------------ */
console.log('--- 8) 趴下姿态：h / hitW / 互斥 / 机动限制 ---');
{
  const U = vm.runInThisContext('({ proneK, cqEff, stanceH, stanceHitW, pronePose, PRONE_FLAT, keys, input })');
  const ok = (name, cond, extra) => console.log('  ' + (cond ? '✓' : '❌') + ' ' + name + (extra === undefined ? '' : '  ' + extra));

  g.startStage(1);
  const p = g.player;
  /* 清场 + 落地，免得刚出生的无敌/冲刺干扰 */
  g.enemies.length = 0;
  g.game.spawnQueue.length = 0;
  p.vy = 0; p.onGround = true; p.dashTime = 0;

  /* 8.1 按住 Z 若干帧 → prone 拉满、h 压到 28、hitW 涨到 66 */
  U.keys['KeyZ'] = true;
  for (let i = 0; i < 40; i++) { update(1 / 60); g.render(); }
  ok('Z 键趴下：prone≈1', U.proneK(p) > 0.98, 'prone=' + U.proneK(p).toFixed(3));
  ok('h 压到 28（58−30）', Math.abs(p.h - 28) < 0.6, 'h=' + p.h.toFixed(2));
  ok('hitW 涨到 66（30+36）', Math.abs(p.hitW - 66) < 0.6, 'hitW=' + p.hitW.toFixed(2));

  /* 8.2 蹲趴互斥：同时按住 S，蹲姿必须淡成 0，身高不能再往下掉 */
  U.keys['KeyS'] = true;
  for (let i = 0; i < 40; i++) { update(1 / 60); g.render(); }
  ok('蹲趴互斥：cqEff=0', U.cqEff(p) < 0.02, 'cqEff=' + U.cqEff(p).toFixed(3));
  ok('互斥后身高不叠加', Math.abs(p.h - 28) < 0.6, 'h=' + p.h.toFixed(2));

  /* 8.3 躺倒角：PRONE_FLAT 的 84.6°，且角度只跟 prone 走 */
  const pose = U.pronePose({ h: p.h, prone: 1 }, 96);
  ok('躺倒角≈84.6°', Math.abs(pose.ang - U.PRONE_FLAT) < 0.02,
    '(' + (pose.ang * 180 / Math.PI).toFixed(1) + '°)');

  /* 8.4 爬行限速：趴下后水平极速 ≈ 站立 38%
     注意这里要先**清掉所有方向键**再按 D。前面几节用 simulate() 跑过
     随机操作，很可能残留着 KeyA / ArrowLeft —— 那样 mv = 0，人会原地
     磨擦停住，runMax 只剩 3.5，这条断言就变成「怎么都过」的空检查
     （实测 15 次里有 2 次是这么假通过的）。所以再配一条「真的加速到上限」，
     用它来抓「按了没动」这种假通过。 */
  p.weapon = 0;
  U.keys['KeyS'] = false;
  U.keys['KeyA'] = false;
  U.keys['ArrowLeft'] = false;
  U.keys['ArrowRight'] = false;
  let runMax = 0;
  U.keys['KeyD'] = true;
  for (let i = 0; i < 90; i++) { update(1 / 60); g.render(); runMax = Math.max(runMax, Math.abs(p.vx)); }
  ok('趴下禁冲刺', p.dashTime <= 0, 'dashTime=' + (p.dashTime || 0).toFixed(2));
  ok('爬行极速 ≈ 站立 38%', runMax < 290 * 0.39, 'vx=' + runMax.toFixed(1) + ' / 站立 290');
  /* 卡上限 ≠ 加速坏了：只要 vx 顶到 110，说明「按 D 就真的在爬」。
     不用位移 ∆x 判，因为趴着可能正好被木箱挡住（实测 20 次里 3 次），
     那是地图几何，不是爬行逻辑。 */
  ok('爬行真的加速到上限（判据非空）', runMax > 290 * 0.36, 'vx=' + runMax.toFixed(1) + ' / 上限 110.2');
  U.keys['KeyD'] = false;

  /* 8.5 起身：松开 Z 之后 prone 要落回 0，身高回到 58 */
  U.keys['KeyZ'] = false;
  for (let i = 0; i < 90; i++) { update(1 / 60); g.render(); }
  ok('起身：prone=0', U.proneK(p) < 0.02, 'prone=' + U.proneK(p).toFixed(3));
  ok('起身：身高回 58', Math.abs(p.h - 58) < 0.6, 'h=' + p.h.toFixed(2));

  /* 8.6 全兵种都能趴 —— 卧倒是通用战术动作，不是机枪兵的职业特性。
      types 表里的 prone 现在只是个「结构上趴不下去」的后门，全员都该是 true。 */
  const TYPES = vm.runInThisContext('ENEMY_TYPES');
  const createEnemy = vm.runInThisContext('createEnemy');
  const suppressPass = vm.runInThisContext('suppressPass');
  const ALL = ['grunt', 'rusher', 'gunner', 'thrower', 'boss', 'boss2', 'boss3'];
  const missing = ALL.filter(k => !TYPES[k].prone);
  ok('全兵种都会趴（' + ALL.length + ' 个兵种）', missing.length === 0,
    missing.length ? '缺: ' + missing.join(',') : '');

  /* 8.7 压制感知：子弹擦身而过 → suppress 亮灯 → 下一次决策就地卧倒。
     这条是「AI 凭什么知道要趴」的唯一答案：不是血条、不是换弹，
     而是真的有一发子弹贴着它飞过去。 */
  g.startStage(2);
  const pl = g.player;
  g.enemies.length = 0;
  g.game.spawnQueue.length = 0;
  pl.vy = 0; pl.onGround = true;

  /* 所有探针统一钉在地面上：出生点可能正好压在坑口或平台边缘，一掉下去
     onGround 变 false，proneT 会被「离地即起身」就地清零 —— 断言就会随机翻红。 */
  const gy = vm.runInThisContext('world').groundY;
  const pin = (en, wx) => { en.x = wx; en.vx = 0; en.y = gy; en.vy = 0; en.onGround = true; };
  pl.y = gy; pl.vy = 0; pl.onGround = true;

  const grunt = createEnemy('grunt', pl.x + 320, 1);
  grunt.y = gy; grunt.spawnGuard = 0; grunt.onGround = true;
  grunt.proneT = 0; grunt.proneCd = 0; grunt.suppress = 0; grunt.suppressCd = 0;
  grunt.fireCd = 5;                       /* 别让它在测试期间开枪，免得干扰判定 */
  /* suppressPass 是遍历 enemies 打的标记，所以必须先入列 */
  g.enemies.push(grunt);
  /* 一条从它头顶 20px 处掠过的弹道（模拟玩家打过来的子弹） */
  const whY = grunt.y - grunt.h * 0.7 + 20;
  suppressPass(grunt.x - 220, whY, grunt.x + 220, whY, 'player');
  ok('子弹擦身 → suppress 亮灯', grunt.suppress > 0, 'suppress=' + grunt.suppress.toFixed(2));
  ok('擦身判定有采样冷却', grunt.suppressCd > 0, 'suppressCd=' + grunt.suppressCd.toFixed(2));

  let sawSuppProne = 0;
  for (let i = 0; i < 40; i++) {
    pin(grunt, pl.x + 320);               /* 钉在 320：要进 120~range 的「趴得下去」区间 */
    update(1 / 60); g.render();
    sawSuppProne = Math.max(sawSuppProne, U.proneK(grunt));
  }
  ok('被压制 → 就地卧倒', sawSuppProne > 0.5, 'prone=' + sawSuppProne.toFixed(2));

  /* 8.8 机枪兵：站定 + 有弹 = 架枪卧射（旧行为不能丢） */
  g.enemies.length = 0;
  const gunner = createEnemy('gunner', pl.x + 320, 1);
  gunner.y = gy; gunner.spawnGuard = 0; gunner.onGround = true;
  gunner.reloadT = 0; gunner.fireCd = 0; gunner.burstLeft = 2;
  gunner.proneT = 0; gunner.proneCd = 0;
  g.enemies.push(gunner);
  let sawProne = 0;
  for (let i = 0; i < 180; i++) {
    pin(gunner, pl.x + 320);
    update(1 / 60); g.render();
    sawProne = Math.max(sawProne, U.proneK(gunner));
  }
  ok('gunner 会趴下架枪', sawProne > 0.9, 'prone=' + sawProne.toFixed(2));

  /* 8.9 趴下的代价：趴着砍不到人。这条必须配一个对照组 ——
      站着能砍到、趴着砍不到，才说明是「趴下掐掉了近战」而不是距离不够。 */
  const meleeProbe = (proneIt) => {
    g.enemies.length = 0;
    const ru = createEnemy('rusher', pl.x + 30, 1);
    ru.y = gy; ru.spawnGuard = 0; ru.onGround = true;
    ru.meleeCd = 0; ru.suppress = 0;
    ru.prone = proneIt ? 1 : 0;
    ru.proneT = proneIt ? 2 : 0;
    ru.proneCd = 99;                       /* 测试期间别再自己趴下去 */
    g.enemies.push(ru);
    let cd = 0;
    for (let i = 0; i < 30; i++) {
      pin(ru, pl.x + 30);                  /* 钉在 46 以内，别让它把人顶开 */
      update(1 / 60);
      cd = Math.max(cd, ru.meleeCd);
    }
    return cd;
  };
  const cdStand = meleeProbe(false);
  ok('站立冲锋兵能砍到人（对照组）', cdStand > 0, 'meleeCd=' + cdStand.toFixed(2));
  const cdProne = meleeProbe(true);
  ok('趴着砍不到人（近战被掐）', cdProne <= 0, 'meleeCd=' + cdProne.toFixed(2));

  /* 8.10 趴下的代价：趴着不能跨坑 / 不能自救跳 / 只能爬 */
  const crawler = createEnemy('grunt', pl.x + 400, 1);
  crawler.y = gy; crawler.spawnGuard = 0; crawler.onGround = true;
  crawler.prone = 1; crawler.proneT = 3; crawler.proneCd = 3;
  crawler.pitJump = 0.5;                   /* 手动塞一个「正要跨坑」的意图 */
  g.enemies.length = 0; g.enemies.push(crawler);
  let maxVx = 0;
  for (let i = 0; i < 30; i++) {
    crawler.y = gy; crawler.vy = 0; crawler.onGround = true;
    update(1 / 60);
    maxVx = Math.max(maxVx, Math.abs(crawler.vx));
  }
  ok('趴下：跨坑意图被清掉', crawler.pitJump <= 0, 'pitJump=' + (crawler.pitJump || 0).toFixed(2));
  ok('趴下：爬行速度被压到 38% 以内', maxVx <= TYPES.grunt.speed * 0.42,
    'vx=' + maxVx.toFixed(1) + ' / 站立 ' + Math.round(TYPES.grunt.speed));
}
