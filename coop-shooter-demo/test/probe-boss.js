/* BOSS 专属行为探针：验证三个 BOSS 的「打法动词」真的不同。
   1) boss1 铁血队长  → 召唤 t.summon 指定的兵种（不写死 grunt）
   2) boss2 焦土纵火者 → 投燃烧瓶 → 生成火焰地带 → 只烧友方
   3) boss3 钢铁典狱长 → 正面装甲减伤 + 近身震地冲击波
   4) 入场演出 / 击破慢动作 的状态字段确实被点亮 */
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
for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'hud.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}

const H = vm.runInThisContext(`({
  get game(){return game}, get player(){return player}, get buddy(){return buddy},
  get enemies(){return enemies}, get fires(){return fires}, get grenades(){return grenades},
  get particles(){return particles},
  startStage, update, render, beginWave, spawnEnemyAt, updateEnemy, damageEnemy, killEnemy,
  bossForStage, ENEMY_TYPES, world, clamp
})`);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

/* 造一个只含目标 BOSS 的干净战场：玩家站在地面，BOSS 在给定距离 */
function sandbox(stage, bossType, dist) {
  H.startStage(stage);
  H.game.waveActive = true;
  H.game.spawnQueue = [];
  H.enemies.length = 0;
  H.fires.length = 0;
  H.grenades.length = 0;
  const p = H.player;
  p.hp = p.maxHp = 99999;
  p.downed = false;
  const b = H.buddy;
  b.hp = b.maxHp = 99999;
  b.downed = false;
  const boss = H.spawnEnemyAt(bossType, { x: p.x + dist, y: H.world.groundY }, stage);
  const e = H.enemies[H.enemies.length - 1];
  e.spawnGuard = 0;
  e.chute = 0;
  return e;
}

const DT = 1 / 60;

/* ============ 1) 三关 BOSS 指派是否正确 ============ */
console.log('\n=========== 1) 关卡 → BOSS 映射 ============');
const expect = ['boss', 'boss2', 'boss3', 'boss'];
for (let s = 1; s <= 4; s++) {
  check('第 ' + s + ' 关 BOSS = ' + expect[s - 1],
    H.bossForStage(s) === expect[s - 1], '实际 ' + H.bossForStage(s));
}

/* ============ 2) boss1 召唤兵种走 t.summon ============ */
console.log('\n=========== 2) 铁血队长：召唤 t.summon 指定的兵种 ============');
{
  const e = sandbox(1, 'boss', 320);
  e.minionCd = 0;
  const before = H.enemies.length;
  for (let i = 0; i < 30; i++) H.updateEnemy(e, DT);
  const minions = H.enemies.slice(before).map(x => x.type);
  check('召唤出 2 个兵', minions.length >= 2, '实际 ' + minions.join(','));
  check('兵种等于 t.summon（grunt）', minions.every(m => m === H.ENEMY_TYPES.boss.summon),
    '期望 ' + H.ENEMY_TYPES.boss.summon + ' 实际 ' + minions.join(','));
}

/* ============ 3) boss2 燃烧瓶 → 火焰地带 ============ */
console.log('\n=========== 3) 焦土纵火者：燃烧瓶 + 火焰地带 ============');
{
  const e = sandbox(2, 'boss2', 360);
  e.throwCd = 0;
  let sawMolotov = false;
  for (let i = 0; i < 40; i++) {
    H.updateEnemy(e, DT);
    if (H.grenades.some(g => g.fire)) sawMolotov = true;
  }
  check('投出带 fire 标记的燃烧瓶', sawMolotov, '手中燃烧瓶=' + H.grenades.filter(g => g.fire).length);

  /* 让它落地：直接把引信清零走完 updateGrenades 的爆炸分支 */
  for (const g of H.grenades) g.fuse = 0;
  H.update(DT);
  check('燃烧瓶炸开后生成火焰地带', H.fires.length > 0, 'fires=' + H.fires.length);
  check('火焰地带带伤害与灼烧间隔',
    H.fires.length > 0 && H.fires[0].dmg > 0 && H.fires[0].tick > 0,
    H.fires.length ? ('dmg=' + H.fires[0].dmg + ' tick=' + H.fires[0].tick) : '-');
}

/* ============ 4) 火焰只烧友方，不烧敌人 ============ */
console.log('\n=========== 4) 火焰地带只烧友方（不然纵火者会烧死自己的小弟）============');
{
  const e = sandbox(2, 'boss2', 360);
  /* 在 BOSS 脚下和玩家脚下各点一把火 */
  H.fires.length = 0;
  vm.runInThisContext('spawnFire')(e.x, H.world.groundY, 116, 6, 9);
  vm.runInThisContext('spawnFire')(H.player.x, H.world.groundY, 116, 6, 9);
  const hpBoss = e.hp, hpPlayer = H.player.hp;
  /* 只驱动火焰更新：跑完整 update() 的话八哥会开枪，血量变化就分不清来源了 */
  const updateFires = vm.runInThisContext('updateFires');
  for (let i = 0; i < 90; i++) updateFires(DT);
  check('站在火里的玩家掉血', H.player.hp < hpPlayer, '玩家 ' + hpPlayer + ' → ' + Math.round(H.player.hp));
  check('站在火里的 BOSS 不掉血', e.hp === hpBoss, 'BOSS ' + hpBoss + ' → ' + Math.round(e.hp));
}

/* ============ 5) boss3 正面装甲：正面 vs 背后 ============ */
console.log('\n=========== 5) 钢铁典狱长：正面装甲减伤 ============');
{
  /* 正面：子弹从 BOSS 面朝的一侧打来 */
  const e = sandbox(3, 'boss3', 300);
  e.aim = 0;                       /* 面朝右 → 正面是 x 更大的一侧 */
  const armor = H.ENEMY_TYPES.boss3.armor;
  let hp0 = e.hp;
  H.damageEnemy(e, 100, e.x + 20, e.y - 50, 'player');
  const frontDmg = hp0 - e.hp;

  hp0 = e.hp;
  H.damageEnemy(e, 100, e.x - 20, e.y - 50, 'player');
  const backDmg = hp0 - e.hp;

  check('正面伤害被压到 ' + Math.round(armor * 100) + '%', Math.abs(frontDmg - 100 * armor) < 0.01,
    '正面 ' + frontDmg.toFixed(1));
  check('背后伤害保持 100%', Math.abs(backDmg - 100) < 0.01, '背后 ' + backDmg.toFixed(1));
  check('绕背收益 ≈ ' + (100 / (armor * 100)).toFixed(2) + ' 倍', backDmg > frontDmg * 2,
    (backDmg / frontDmg).toFixed(2) + ' 倍');
}

/* ============ 6) boss3 震地：蓄力 → 结算 ============ */
console.log('\n=========== 6) 钢铁典狱长：近身震地冲击波 ============');
{
  /* 触发半径 320、爆圈 186。这里站 150：既要触发蓄力，又要真的落在爆圈里
     —— 站 200 是「刚出圈」的位置，测不到扣血，测到的是「跑掉就没事」 */
  const e = sandbox(3, 'boss3', 150);      /* 320px 内会触发 */
  e.slamCd = 0;
  e.onGround = true;
  let charged = false;
  for (let i = 0; i < 30; i++) {
    H.updateEnemy(e, DT);
    if (e.slamFx > 0) { charged = true; break; }
  }
  check('近距离触发震地蓄力', charged, 'slamFx=' + (e.slamFx || 0).toFixed(2));

  const hp = H.player.hp;
  let boomed = false;
  for (let i = 0; i < 90; i++) {
    H.updateEnemy(e, DT);
    if (e.slamFx <= 0 && e.slamCd > 5) { boomed = true; break; }
  }
  check('蓄力结束炸开并进入长冷却', boomed, 'slamCd=' + e.slamCd.toFixed(1));
  check('站在冲击波里的玩家被扣血', H.player.hp < hp, '玩家 ' + hp + ' → ' + Math.round(H.player.hp));
}

/* ============ 7) 入场演出 / 击破演出 ============ */
console.log('\n=========== 7) 入场横幅 与 击破慢动作 ============');
{
  H.startStage(2);
  H.game.wave = H.game.maxWave - 1;
  H.beginWave();
  check('BOSS 波触发入场横幅', !!H.game.bossIntro,
    H.game.bossIntro ? H.game.bossIntro.name + ' / ' + H.game.bossIntro.tag : '-');
  check('入场同时白闪', H.game.screenFlash > 0, 'flash=' + (H.game.screenFlash || 0).toFixed(2));

  const introName = H.game.bossIntro ? H.game.bossIntro.name : '';
  check('第 2 关横幅是焦土纵火者', introName === H.ENEMY_TYPES.boss2.name, introName);

  /* 横幅会自己走完 */
  for (let i = 0; i < 200; i++) H.update(DT);
  check('横幅到时自动消失', H.game.bossIntro === null);

  /* 击破：慢动作 + 白闪 */
  H.game.slowmo = 0; H.game.screenFlash = 0;
  const e = sandbox(2, 'boss2', 300);
  e.hp = 1;
  H.killEnemy(e);
  check('BOSS 倒下触发慢动作', H.game.slowmo > 0.5, 'slowmo=' + H.game.slowmo.toFixed(2));
  check('BOSS 倒下触发白闪', H.game.screenFlash > 0.3, 'flash=' + H.game.screenFlash.toFixed(2));
  check('BOSS 倒下清空入场横幅', H.game.bossIntro === null);
  check('慢动作会自己衰减到 0', (() => {
    for (let i = 0; i < 200; i++) H.update(DT);
    return H.game.slowmo === 0;
  })());
}

/* ============ 8) 三关 BOSS 波全流程（每帧 render，抓渲染异常）============ */
console.log('\n=========== 8) 三关 BOSS 波全流程渲染 ============');
for (let stage = 1; stage <= 3; stage++) {
  H.startStage(stage);
  H.game.wave = H.game.maxWave - 1;
  H.beginWave();
  let err = null;
  for (let i = 0; i < 60 * 12; i++) {
    try { H.update(DT); H.render(); } catch (ex) { err = ex; break; }
    if (H.game.state !== 'playing') break;
  }
  const boss = H.enemies.find(x => x.boss);
  check('第 ' + stage + ' 关 BOSS 波渲染 12 秒无异常', !err,
    err ? err.message : ('BOSS=' + (boss ? boss.type : '已阵亡') + ' fires=' + H.fires.length));
}

console.log('\n=========== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===========');
process.exit(fail ? 1 : 0);
