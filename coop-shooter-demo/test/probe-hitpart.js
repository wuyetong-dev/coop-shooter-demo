/* 命中部位 + 平台挡弹 探针
   1) 普通兵：头 2.0 / 躯干 1.0 / 腿 0.68，用真实 damageEnemy 量化
   2) BOSS：头 1.45 / 腿 0.85，且与正面装甲叠乘（正面爆头 < 背面爆头）
   3) 蹲下时部位跟随当前身高
   4) 空中平台挡弹：仰射 / 侧射 / 高速穿帧都不漏
   5) 站在平台上水平射击不会被脚下那块吃掉 */
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
  get enemies(){return enemies}, get bullets(){return bullets}, get particles(){return particles},
  startStage, spawnEnemyAt, damageEnemy, hitPart, HIT_PARTS, platformBlocks, fireWeapon,
  spawnBullet, updateBullets, world, clamp
})`);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.05 : tol);

/* 造一个干净战场，返回一个血很厚、不动的敌兵 */
function freshEnemy(type, stage) {
  H.startStage(stage || 1);
  H.enemies.length = 0;
  const p = H.player;
  p.hp = p.maxHp = 99999;
  p.downed = false;
  H.spawnEnemyAt(type, { x: p.x + 260, y: H.world.groundY }, stage || 1);
  const e = H.enemies[H.enemies.length - 1];
  e.hp = e.maxHp = 100000;
  e.chute = 0;
  e.spawnGuard = 0;
  return e;
}

/* 打一枪，返回实际掉血；frac 是从头顶往下数的比例 */
function shoot(e, frac, dmg, hx) {
  const before = e.hp;
  const hy = e.y - e.h + e.h * frac;
  H.damageEnemy(e, dmg || 20, hx === undefined ? e.x + 60 : hx, hy, 'player');
  const d = before - e.hp;
  e.hp = 100000;
  return d;
}

console.log('\n=========== 1) 普通兵部位倍率 ===========');
{
  const e = freshEnemy('grunt', 1);
  const head = shoot(e, 0.08);
  const torso = shoot(e, 0.42);
  const legs = shoot(e, 0.85);
  check('头部 ×2.0', near(head, 40), `20 → ${head.toFixed(1)}`);
  check('躯干 ×1.0', near(torso, 20), `20 → ${torso.toFixed(1)}`);
  check('腿部 ×0.68', near(legs, 13.6), `20 → ${legs.toFixed(1)}`);
  check('爆头是腿部伤害的 2.94 倍', near(head / legs, 2.94, 0.05), (head / legs).toFixed(2));
  check('部位比例表存在三段', H.HIT_PARTS.length === 3, H.HIT_PARTS.map(p => p.key).join(','));
}

console.log('\n=========== 2) BOSS 部位与装甲叠乘 ===========');
{
  const b1 = freshEnemy('boss', 1);
  const h1 = shoot(b1, 0.08);
  const l1 = shoot(b1, 0.85);
  check('铁血队长 爆头 ×1.45', near(h1, 29), `20 → ${h1.toFixed(1)}`);
  check('铁血队长 腿部 ×0.85', near(l1, 17), `20 → ${l1.toFixed(1)}`);

  const b3 = freshEnemy('boss3', 3);
  b3.aim = 0;                                   /* 朝右，正面在右边 */
  const frontHead = shoot(b3, 0.08, 20, b3.x + 60);
  const backHead = shoot(b3, 0.08, 20, b3.x - 60);
  check('典狱长 正面爆头 = 1.45×0.45', near(frontHead, 13.05, 0.1), `20 → ${frontHead.toFixed(2)}`);
  check('典狱长 背面爆头 = 1.45', near(backHead, 29), `20 → ${backHead.toFixed(2)}`);
  check('绕背爆头收益 2.22 倍', near(backHead / frontHead, 2.22, 0.03), (backHead / frontHead).toFixed(2));
}

console.log('\n=========== 3) 蹲下后部位跟随身高 ===========');
{
  const e = freshEnemy('grunt', 1);
  const hStand = e.h;
  e.crouch = 1;
  e.h = (e.baseH || e.h) - 15;
  const part = H.hitPart(e, e.y - e.h + e.h * 0.08);
  check('蹲下后碰撞盒变矮', e.h < hStand, `${hStand} → ${e.h}`);
  check('按新身高算仍是头部', part.key === 'head', part.key);
  const legs = H.hitPart(e, e.y - e.h + e.h * 0.85);
  check('按新身高算仍是腿部', legs.key === 'legs', legs.key);
}

console.log('\n=========== 4) 空中平台挡弹 ===========');
function platoon() {
  H.startStage(1);
  H.enemies.length = 0;
  H.bullets.length = 0;
  H.world.blocks.length = 0;
  /* 只留地面 + 一块测试平台，避免关卡自带的平台混进弹道 */
  const g = H.world.platforms[0];
  H.world.platforms.length = 0;
  H.world.platforms.push(g);
  H.world.platforms.push({ x: 500, y: 400, w: 200, h: 24, mat: 'steel', rail: true });
}
/* 把子弹跑到消失，返回最后一帧的位置 */
function runBullet(x, y, vx, vy, opts) {
  H.spawnBullet(x, y, vx, vy, 10, 'player', '#fff', 3, 'player', opts);
  const b = H.bullets[H.bullets.length - 1];
  for (let i = 0; i < 20 && H.bullets.length; i++) H.updateBullets(1 / 60);
  return { alive: H.bullets.length > 0, x: b.x, y: b.y };
}
{
  platoon();
  check('平台判定函数能找到该点', !!H.platformBlocks(600, 412));
  check('平台顶面之上不算遮挡', !H.platformBlocks(600, 380));
  check('平台之外的 x 不算遮挡', !H.platformBlocks(760, 412));

  /* 仰射：从平台下方朝上打，必须撞底面 */
  const up = runBullet(600, 500, 0, -2400);
  check('仰射被平台底面挡住', !up.alive, `停在 y=${up.y.toFixed(0)}（底面 424）`);
  check('停在平台厚度内', up.y >= 400 && up.y <= 424, `y=${up.y.toFixed(1)}`);

  /* 侧射：水平撞侧面 */
  const side = runBullet(420, 410, 2400, 0);
  check('水平侧射被平台挡住', !side.alive, `停在 x=${side.x.toFixed(0)}（左缘 500）`);

  /* 高速穿帧：一帧 40px，单点判定必漏，靠采样救回来 */
  platoon();
  const fast = runBullet(600, 430, 0, -2400);
  check('一帧 40px 也不会穿透平台', !fast.alive, `40px/帧 → 停在 y=${fast.y.toFixed(0)}`);

  /* 站在平台上水平射击：枪口在顶面之上，不该被自己脚下挡住 */
  platoon();
  const flat = runBullet(600, 360, 2400, 0);
  check('站在平台上平射不被误挡', flat.alive && flat.x > 760, `飞到 x=${flat.x.toFixed(0)}`);

  /* 从平台上方垂直落下：应落在顶面 */
  platoon();
  const down = runBullet(600, 320, 0, 1600);
  check('从上方垂直落入平台顶面即停', !down.alive && near(down.y, 400, 1), `y=${down.y.toFixed(1)}`);

  /* 火箭撞平台也要炸 */
  platoon();
  const before = H.particles.length;
  const rocket = runBullet(600, 500, 0, -1200, { rocket: true, blast: 70, blastDmg: 30 });
  check('火箭撞平台会爆炸', !rocket.alive && H.particles.length > before,
    `粒子 ${before} → ${H.particles.length}`);
}

console.log('\n=========== 5) 掩体优先于平台（不冲突）===========');
{
  platoon();
  /* 木箱摆在平台左缘之前（470~530 与平台 500 起重叠），子弹从 420 打过来 */
  const blk = { x: 470, y: 380, w: 60, h: 44, hp: 100, maxHp: 100, kind: 'crate' };
  H.world.blocks.push(blk);
  H.spawnBullet(420, 410, 2400, 0, 10, 'player', '#fff', 3, 'player');
  for (let i = 0; i < 6 && H.bullets.length; i++) H.updateBullets(1 / 60);
  check('木箱在平台前面时先吃子弹', blk.hp < 100, `木箱 hp ${blk.hp}`);
}

console.log('\n=========== 6) 站在平台上往下打（忽略自己脚下那块）===========');
{
  /* 端到端：玩家站平台中央、敌人正下方地面，朝正下方开火应当打中 */
  platoon();
  const pl = H.world.platforms[1];
  const p = H.player;
  p.x = 600; p.y = 400; p.plat = pl; p.onGround = true;
  p.hp = p.maxHp = 99999; p.downed = false;
  H.enemies.length = 0;
  H.spawnEnemyAt('grunt', { x: 610, y: H.world.groundY }, 1);
  const e = H.enemies[0];
  e.hp = e.maxHp = 1000; e.chute = 0; e.spawnGuard = 0;
  const before = e.hp;
  const wp = { speed: 1500, dmg: 10, color: '#fff', pellets: 1, spread: 0, rate: 0.1, sfx: 'small' };
  H.fireWeapon(p, wp, Math.PI / 2, 1, 1);
  for (let i = 0; i < 40 && H.bullets.length; i++) H.updateBullets(1 / 60);
  check('高台上朝下打能命中地面敌人', e.hp < before, `${before} → ${e.hp}`);

  /* 反过来：地面的人仰射高台上的目标，平台应当护住他 */
  H.startStage(1);
  H.world.platforms.push({ x: 500, y: 400, w: 200, h: 24, mat: 'steel', rail: true });
  H.world.blocks.length = 0;
  H.bullets.length = 0;
  H.enemies.length = 0;
  const pl2 = H.world.platforms[H.world.platforms.length - 1];
  p.x = 600; p.y = H.world.groundY; p.plat = null; p.onGround = true;
  H.spawnEnemyAt('grunt', { x: 600, y: 400 }, 1);
  const e2 = H.enemies[0];
  e2.hp = e2.maxHp = 1000; e2.chute = 0; e2.spawnGuard = 0; e2.plat = pl2;
  const b2 = e2.hp;
  H.fireWeapon(p, wp, -Math.PI / 2, 1, 1);
  for (let i = 0; i < 40 && H.bullets.length; i++) H.updateBullets(1 / 60);
  check('地面仰射高台目标被平台挡住', e2.hp === b2, `敌人仍是 ${e2.hp}`);
}

console.log('\n=========== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===========');
process.exit(fail ? 1 : 0);
