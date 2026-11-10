/* 第十一轮地形探针：二段跳 / 上升气流 / 深渊 / 场景机关
   1) 二段跳：空中再跳一次必须真的更高，但不能高到破坏三层平台设计
   2) 气流：跳进风口能被托到高台高度，且落地后能踩到 TIER_HIGH 木箱台
   3) 深渊：踩空一路掉、标记 fell、玩家结算成 gameover；AI 在崖边会刹住
   4) 机关：地刺掉血 + 弹开；喷火口先预警后窜火，火里站着掉血
   5) 布局：深渊宽度 < 满跳射程、机关不压坑不压风、敌人不刷在坑里        */
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
  get buddy(){return buddy}, get enemies(){return enemies},
  buildStage, startStage, createPlayer, createBuddy, createEnemy, spawnEnemyAt,
  doJump, doAirJump, moveEntity, update, updateHazards, updateFalls, damageFriendly,
  groundAt, windAt, surfaceBelow, tryJump, crossPit, steelLeg,
  JUMP_V, JUMP_V2, GRAV, MAX_AIR_JUMPS, FALL_DEPTH, WIND_RISE_MAX,
  TIER_HIGH, TIER_MID, TIER_LOW, VIEW_W
})`);
const dt = 1 / 60;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')); }
}

/* 造一个「干净」的关卡：只留地面，自己摆地形 */
function cleanStage(stage) {
  ENV.buildStage(stage || 1);
  ENV.world.platforms = [{ x: 0, y: ENV.world.groundY, w: ENV.world.w, h: 200, ground: true }];
  ENV.world.blocks = [];
  ENV.world.covers = [];
  ENV.world.pits = [];
  ENV.world.hazards = [];
  ENV.world.winds = [];
}
function actorAt(x, y) {
  const a = ENV.createPlayer(x);
  a.y = y === undefined ? ENV.world.groundY : y;
  a.vy = 0; a.onGround = true; a.plat = null; a.jumpBuffer = 0; a.dropTimer = 0;
  return a;
}

/* =================== 1. 二段跳 =================== */
console.log('=========== 1. 二段跳 ===========');
cleanStage(1);
const GY = ENV.world.groundY;
const jumpH1 = ENV.JUMP_V * ENV.JUMP_V / (2 * ENV.GRAV);
const jumpH2 = jumpH1 + ENV.JUMP_V2 * ENV.JUMP_V2 / (2 * ENV.GRAV);

/* 原地满跳的最高点 */
function apex(useAir) {
  const a = actorAt(400);
  ENV.doJump(a);
  let top = a.y, used = false;
  for (let i = 0; i < 400; i++) {
    ENV.moveEntity(a, dt);
    if (a.y < top) top = a.y;
    /* 升到最高点（vy 刚要转正）时补一段二段跳 */
    if (useAir && !used && a.vy > -60 && !a.onGround) { ENV.doAirJump(a); used = true; }
    if (a.onGround && i > 10) break;
  }
  return GY - top;
}
const hOne = apex(false);
const hTwo = apex(true);
/* 欧拉积分每帧漏一点速度，实测会比解析解低 5~10px，这里给 16px 容差 */
ok(Math.abs(hOne - jumpH1) < 16, '单跳高度符合理论值', `实测 ${hOne.toFixed(0)}px / 理论 ${jumpH1.toFixed(0)}px`);
ok(hTwo > hOne + 90, '二段跳明显更高', `${hOne.toFixed(0)}px → ${hTwo.toFixed(0)}px（+${(hTwo - hOne).toFixed(0)}）`);

/* 单跳从地面够不到最高台（600 → 296 要 304px），所以三层平台必须一级一级上；
   二段跳刚好够直接上顶台 —— 这是「二段跳」这个能力本身带来的副作用，可以接受，
   但不能高到飞出关卡构图（最高台之上还有 100px 以上的余量）。 */
const needTop = ENV.world.groundY - ENV.TIER_HIGH;
const tierSteps = [ENV.TIER_LOW - ENV.TIER_MID, ENV.TIER_MID - ENV.TIER_HIGH];
ok(hOne < needTop, '单跳够不到最高台（三层必须逐级上）',
  `单跳 ${hOne.toFixed(0)} < 需要 ${needTop}`);
ok(hTwo < 560, '二段跳总高度仍在关卡构图内', `总高 ${hTwo.toFixed(0)}px，最高台之上余量 ${(560 - hTwo).toFixed(0)}px`);
console.log(`     层差：低→中 ${tierSteps[0]}  中→高 ${tierSteps[1]}  地面→高台 ${needTop}`);

/* 空中只能再跳一次 */
const a3 = actorAt(400);
ENV.doJump(a3);
for (let i = 0; i < 6; i++) ENV.moveEntity(a3, dt);
const j1 = ENV.doAirJump(a3);
const j2 = ENV.doAirJump(a3);
ok(j1 === true && j2 === false, '空中只允许再跳一次', `第一次 ${j1} 第二次 ${j2}`);

/* 落地回满 */
let refilled = false;
for (let i = 0; i < 400; i++) {
  ENV.moveEntity(a3, dt);
  if (a3.onGround) { refilled = a3.airJumps === ENV.MAX_AIR_JUMPS; break; }
}
ok(refilled, '落地后二段跳次数回满');

/* 从高台往下掉，也能用二段跳救一下：不掉进坑里 */
console.log('\n=========== 2. 上升气流 ===========');
cleanStage(1);
const wx = 600, WW = 104;
ENV.world.winds.push({ x: wx, w: WW, y: GY, top: ENV.TIER_HIGH - 64, phase: 0 });
let wTop = GY, inWindFrames = 0;
const aw = actorAt(wx + WW / 2);
ENV.doJump(aw);                       /* 「跳进去」才起飞，站着不动是吹不起来的 */
for (let i = 0; i < 400; i++) {
  ENV.moveEntity(aw, dt);
  if (aw.y < wTop) wTop = aw.y;
  if (aw.inWind) inWindFrames++;
}
ok(wTop < ENV.TIER_HIGH + 40, '跳进风口能被托到高台高度',
  `最高 ${wTop.toFixed(0)}（高台面 ${ENV.TIER_HIGH}）`);
ok(inWindFrames > 20, '气流里确实处于 inWind 状态', `${inWindFrames} 帧`);

/* 风里跳不能比风外跳还矮 */
const outside = actorAt(wx + 900);
ENV.doJump(outside);
let oTop = GY;
for (let i = 0; i < 200; i++) { ENV.moveEntity(outside, dt); if (outside.y < oTop) oTop = outside.y; }
ok(wTop <= oTop - 40, '风里起跳比平地起跳升得更高',
  `风里 ${(GY - wTop).toFixed(0)}px / 平地 ${(GY - oTop).toFixed(0)}px`);

/* 气流上方要真的能落到 TIER_HIGH 木箱台 */
ENV.world.platforms.push({ x: wx + 46, y: ENV.TIER_HIGH, w: 160, h: 18, mat: 'crate' });
const aw2 = actorAt(wx + WW / 2);
ENV.doJump(aw2);
let landedPlat = null;
for (let i = 0; i < 500; i++) {
  ENV.moveEntity(aw2, dt);
  /* 到顶了往右挪一点，模拟玩家「松手往高台上飘」 */
  aw2.vx = aw2.y < ENV.TIER_HIGH - 24 ? 150 : 0;
  if (aw2.plat && aw2.plat.mat === 'crate') { landedPlat = aw2.plat; break; }
}
ok(!!landedPlat, '借助气流能踩上高台木箱', landedPlat ? `y=${landedPlat.y}` : '没踩上');

/* 风口站着不会被吸起来（站在铁栅上不该自己飞） */
const aw3 = actorAt(wx + WW / 2);
let lift = 0;
for (let i = 0; i < 60; i++) { ENV.moveEntity(aw3, dt); lift = GY - aw3.y; }
ok(Math.abs(lift) < 2, '站在风口不跳不会被吸起来', `位移 ${lift.toFixed(1)}px`);

/* 敌人不吃气流 */
cleanStage(1);
ENV.world.winds.push({ x: wx, w: WW, y: GY, top: ENV.TIER_HIGH - 64, phase: 0 });
const en = ENV.createEnemy('grunt', wx + WW / 2, 1);
en.y = GY; en.vy = 0; en.onGround = false;
for (let i = 0; i < 40; i++) ENV.moveEntity(en, dt);
ok(en.y >= GY - 1, '敌人不会被气流吹起来', `y=${en.y.toFixed(0)}`);

/* =================== 3. 深渊 =================== */
console.log('\n=========== 3. 深渊 ===========');
cleanStage(1);
const PX = 900, PW = 140;
ENV.world.pits.push({ x: PX, w: PW, kind: 'crater' });
ok(ENV.groundAt(PX - 10) === true && ENV.groundAt(PX + PW / 2) === false
  && ENV.groundAt(PX + PW + 10) === true, 'groundAt 正确区分实地与深渊');

/* 走进坑里 → 一路掉 → fell 标记 */
const ap = actorAt(PX - 30);
ap.vx = 200;
let fellAt = -1, minY = GY;
for (let i = 0; i < 300; i++) {
  ap.vx = 200;
  ENV.moveEntity(ap, dt);
  if (ap.y > minY) minY = ap.y;
  if (ap.fell && fellAt < 0) fellAt = i;
  if (ap.y > GY + ENV.FALL_DEPTH + 200) break;
}
ok(fellAt > 0, '踩空后掉下去并打上 fell 标记', `第 ${fellAt} 帧坠落 ${(ap.y - GY).toFixed(0)}px`);
ok(minY > GY + ENV.FALL_DEPTH, '真的掉到地面线以下很远', `${(minY - GY).toFixed(0)}px`);

/* 深渊处不应该被地面兜住 */
const ap2 = actorAt(PX + PW / 2, GY);
ap2.vx = 0;
for (let i = 0; i < 5; i++) ENV.moveEntity(ap2, dt);
ok(ap2.y > GY + 1, '深渊上方不会被地面兜住');

/* 玩家坠渊 → gameover */
ENV.startStage(1);
ENV.world.pits = [{ x: 700, w: 140, kind: 'crater' }];
ENV.player.x = 760; ENV.player.y = GY + ENV.FALL_DEPTH + 40; ENV.player.fell = true;
ENV.updateFalls(dt);
ok(ENV.player.downed, '玩家坠渊判定为倒地并立即结算');
for (let i = 0; i < 5; i++) ENV.update(dt);
ok(ENV.game.state === 'gameover', '玩家坠渊后进入 gameover', '状态=' + ENV.game.state);

/* 敌人坠渊 → 死亡 */
ENV.startStage(1);
ENV.world.pits = [{ x: 700, w: 140, kind: 'crater' }];
const bad = ENV.createEnemy('grunt', 760, 1);
bad.y = GY + ENV.FALL_DEPTH + 40;
bad.fell = true;
bad.hp = 999;
ENV.enemies.push(bad);
ENV.updateFalls(dt);
ok(bad.dead === true, '敌兵坠渊直接判死');

/* AI 崖边刹车 */
cleanStage(1);
ENV.world.pits.push({ x: PX, w: PW, kind: 'crater' });
const ab = ENV.createBuddy(PX - 80);
ab.vx = 240;
let stopped = 0;
for (let i = 0; i < 120; i++) {
  ab.vx = 240;                          /* 一直往坑里推 */
  ENV.moveEntity(ab, dt);
  if (ab.pitEdge) stopped++;
}
ok(stopped > 0 && !ab.fell, '八哥走到崖边会被顶住、不会掉下去',
  `pitEdge 帧数 ${stopped}，y=${ab.y.toFixed(0)}`);
ok(Math.abs(ab.x - (PX - ab.w / 2)) < 3, '八哥停在坑口边缘', `x=${ab.x.toFixed(1)} / 期望 ${(PX - ab.w / 2).toFixed(1)}`);

/* 八哥跨坑 */
const ab2 = ENV.createBuddy(PX - 60);
ab2.y = GY; ab2.onGround = true; ab2.jumpCd = 0;
const crossed = ENV.crossPit(ab2, 1);
let reached = false;
for (let i = 0; i < 120; i++) {
  if (ab2.pitJump > 0) { ab2.pitJump -= dt; ab2.vx = 330; }
  ENV.moveEntity(ab2, dt);
  if (ab2.onGround && ab2.x > PX + PW) { reached = true; break; }
}
ok(crossed && reached, '八哥能起跳跨过缺口', `落点 x=${ab2.x.toFixed(0)}（坑 ${PX}~${PX + PW}）`);

/* 满速满跳必须能跨过最宽的坑 */
console.log('\n=========== 4. 深渊布局 ===========');
const airTime = 2 * ENV.JUMP_V / ENV.GRAV;
const reach = 290 * airTime;
let widest = 0, widestLabel = '';
for (const st of [1, 2, 3, 4, 5]) {
  ENV.buildStage(st);
  for (const p of ENV.world.pits) {
    if (p.w > widest) { widest = p.w; widestLabel = '第' + st + '关 ' + p.kind; }
  }
}
ok(widest < reach - 60, '最宽深渊仍留足跳跃余量',
  `最宽 ${widest}px（${widestLabel}）/ 满速射程 ${reach.toFixed(0)}px`);
console.log(`     滞空 ${airTime.toFixed(2)}s，水平射程 ${reach.toFixed(0)}px`);

/* 每关至少有 1 个坑 + 1 个气流 + 2 个机关 */
for (const st of [1, 2, 3]) {
  ENV.buildStage(st);
  const nt = ENV.world.theme.key;
  console.log(`  [第${st}关 ${nt}] 深渊 ${ENV.world.pits.length} · 气流 ${ENV.world.winds.length} · 机关 ${ENV.world.hazards.length}` +
    `（地刺 ${ENV.world.hazards.filter(h => h.kind === 'spike').length}` +
    ` 喷火 ${ENV.world.hazards.filter(h => h.kind === 'flame').length}）`);
  ok(ENV.world.pits.length > 0, `第${st}关有深渊`);
  ok(ENV.world.winds.length > 0, `第${st}关有上升气流`);
  ok(ENV.world.hazards.length >= 2, `第${st}关有场景机关`);
}

/* 机关与深渊 / 气流不许重叠；箱子沙袋也不许压在上面 */
for (const st of [1, 2, 3, 4, 5]) {
  ENV.buildStage(st);
  const W = ENV.world;
  let overlap = 0;
  const isect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x;
  for (const hz of W.hazards) {
    for (const p of W.pits) if (isect(hz, p)) overlap++;
    for (const wd of W.winds) if (isect(hz, wd)) overlap++;
  }
  for (const b of W.blocks) {
    for (const p of W.pits) if (isect(b, p)) overlap++;
  }
  for (const c of W.covers) {
    for (const p of W.pits) if (isect(c, p)) overlap++;
  }
  /* 气流同样不许压在深渊上：坑右边缘一旦落在风口里就成了蹦床，
     掉下去会被顶回来 —— 本该摔死的地方摔不死，比看着难看严重得多 */
  for (const wd of W.winds) {
    for (const p of W.pits) if (isect(wd, p)) overlap++;
  }
  ok(overlap === 0, `第${st}关机关/箱子/沙袋/气流没有压着深渊或风口`, overlap ? overlap + ' 处重叠' : '');

  /* 每个风口下方必须是实地：风口要在「能站人的地」上方才谈得上跳进去 */
  let windOverPit = 0;
  for (const wd of W.winds) {
    if (!ENV.groundAt(wd.x + wd.w * 0.5)) windOverPit++;
  }
  ok(windOverPit === 0, `第${st}关每个风口都立在实地上`, windOverPit ? windOverPit + ' 个风口悬空' : '');

  /* 钢架立柱不许伸到坑口以下。坑上方 surfaceBelow() 给的是假底（groundY+236），
     早期直接拿它当柱长，坑里会插进两根三百多像素的钢柱 —— 画面上就是一根棍子立在坑中。
     约束写成「柱脚最低到 groundY」，跟具体实现无关，改画法也不会误报。 */
  let legIntoPit = 0;
  for (const p of W.platforms) {
    if (p.ground || p.mat !== 'steel') continue;
    const legTop = p.y + p.h;
    for (const wx of [p.x + 17, p.x + p.w - 17]) {
      if (legTop + ENV.steelLeg(p, wx).h > ENV.world.groundY + 1) legIntoPit++;
    }
  }
  ok(legIntoPit === 0, `第${st}关钢架立柱没有伸进深渊`, legIntoPit ? legIntoPit + ' 根柱脚过界' : '');
}

/* 敌兵刷新点不能落在坑里 */
ENV.startStage(1);
let badSpawn = 0, spawns = 0;
for (let i = 0; i < 2400; i++) {
  ENV.player.invuln = 99;
  ENV.update(dt);
  for (const e of ENV.enemies) {
    if (e.spawnGuard > 0.69) { spawns++; if (!ENV.groundAt(e.x)) badSpawn++; }
  }
}
ok(badSpawn === 0, '敌兵没有刷在深渊上方', `抽查 ${spawns} 个刷新点，异常 ${badSpawn}`);

/* =================== 5. 机关 =================== */
console.log('\n=========== 5. 场景机关 ===========');
cleanStage(1);
ENV.startStage(1);
ENV.world.hazards = [{ kind: 'spike', x: 500, y: GY, w: 96, h: 22, dmg: 16, cd: 0, seed: 0 }];
ENV.player.x = 548; ENV.player.y = GY; ENV.player.hp = 100; ENV.player.invuln = 0;
ENV.buddy.x = 2000;
const hp0 = ENV.player.hp;
ENV.updateHazards(dt);
const hurt = hp0 - ENV.player.hp;
ok(hurt > 0, '地刺踩上去会掉血', `-${hurt.toFixed(0)} HP`);
ok(ENV.player.vy < 0 || !ENV.player.onGround, '地刺会把踩到的人顶开', `vy=${ENV.player.vy.toFixed(0)}`);

/* 离开地刺就不再掉血 */
ENV.player.invuln = 0;
ENV.player.x = 200; ENV.player.y = GY; ENV.player.onGround = true;
const hp1 = ENV.player.hp;
for (let i = 0; i < 20; i++) ENV.updateHazards(dt);
ok(ENV.player.hp === hp1, '走开地刺后不再持续掉血');

/* 喷火口：周期里必须有「没火」和「有火」两段 */
cleanStage(1);
ENV.startStage(1);
ENV.world.hazards = [{
  kind: 'flame', x: 900, y: GY, w: 68, h: 178,
  t: 0, period: 2.8, warn: 1.0, dmg: 12, firing: 0, seed: 0
}];
ENV.player.x = 300; ENV.player.y = GY;
ENV.buddy.x = 2400;
let fireFrames = 0, idleFrames = 0;
for (let i = 0; i < 200; i++) {
  ENV.updateHazards(dt);
  if (ENV.world.hazards[0].firing) fireFrames++; else idleFrames++;
}
ok(fireFrames > 10 && idleFrames > 40, '喷火口有喷发期与静默期',
  `喷 ${fireFrames} 帧 / 静 ${idleFrames} 帧（共 200）`);

/* 火里站着掉血 */
const FZ = ENV.world.hazards[0];
ENV.player.x = 900 + 34; ENV.player.y = GY; ENV.player.hp = 100; ENV.player.invuln = 0;
let burned = 0;
for (let i = 0; i < 400; i++) {
  FZ.t = (FZ.t + dt) % FZ.period;
  ENV.player.hp = 100; ENV.player.invuln = 0; FZ.cd = 0;
  ENV.updateHazards(dt);
  if (ENV.player.hp < 100) burned++;
}
ok(burned > 0, '站在火柱里会掉血', `${burned} 次命中`);

/* =================== 6. 掉落物与地表 =================== */
console.log('\n=========== 6. 深渊上方的地表高度 ===========');
cleanStage(1);
ENV.world.pits.push({ x: 900, w: 140, kind: 'crater' });
const gyIn = ENV.surfaceBelow(970, GY - 100);
const gyOut = ENV.surfaceBelow(600, GY - 100);
ok(gyIn > GY + 100, '深渊上方的「地表」被推得很深（掉落物会掉进坑）', `坑内 ${gyIn} / 实地 ${gyOut}`);

console.log('\n================================');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
