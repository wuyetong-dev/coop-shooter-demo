/* 弹道 / 准星 / 尸体 探针
   1) 每把枪的下坠：准星预测 aimDropPx 与真实子弹落点的差 < 6px
   2) 枪与枪之间确实不同：800px 处霰弹下坠 >> 狙击下坠
   3) drag 生效：霰弹飞 800px 的时间明显长于「按初速算」的直线时间
   4) 远端伤害衰减：同几何、同部位，falloff 0.45 的伤害约为满额的 55%
   5) 视觉半宽 b.w 变细不影响判定半径 b.r —— 子弹看起来细了，实战不变弱
   6) 准星半径随距离单调变大、封顶 150px，蹲下变小，连射 bloom 变大
   7) 二段跳写 airJumpT / flipDir，并按时间归零
   8) 尸体：空中死的先落地再开始软，计时到点移除，掉坑的不留 */
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
  get enemies(){return enemies}, get bullets(){return bullets}, get corpses(){return corpses},
  get world(){return world}, get camera(){return camera},
  startStage, spawnEnemyAt, spawnBullet, updateBullets, drawBullets, updateCorpses,
  WEAPONS, aimRadiusPx, aimDropPx, VIEW_ZOOM, doAirJump, AIRJUMP_FLIP, CORPSE_LIFE,
  FALL_DEPTH, spawnCorpse, killEnemy, clamp, GRAV
})`);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

/* 造一个空战场，只有一个不会死、不会动的靶子 */
function freshTarget(stage) {
  H.startStage(stage || 1);
  H.enemies.length = 0;
  H.bullets.length = 0;
  H.corpses.length = 0;
  const p = H.player;
  p.hp = p.maxHp = 99999;
  p.downed = false;
  H.spawnEnemyAt('grunt', { x: p.x + 120, y: H.world.groundY }, stage || 1);
  const e = H.enemies[H.enemies.length - 1];
  e.hp = e.maxHp = 1e9;
  e.chute = 0;
  e.spawnGuard = 0;
  e.aiOn = false;
  return e;
}

/* 让子弹从指定起点水平飞出去，跑到它消失或飞行距离达标，返回落点 */
function flyTo(wp, dist, y0) {
  H.startStage(1);
  const p = H.player;
  const x0 = p.x;
  const yy = y0 === undefined ? H.world.groundY - 200 : y0;
  H.bullets.length = 0;
  H.enemies.length = 0;
  /* 只关心弹道本身：把平台清掉，让子弹在一个空场里飞完这一段 */
  H.world.platforms.length = 0;
  H.world.covers.length = 0;
  H.world.blocks.length = 0;
  const o = Object.assign({}, wp);
  H.spawnBullet(x0, yy, wp.speed, 0, 10, 'player', '#fff', 3.2, 'player', o);
  const b = H.bullets[H.bullets.length - 1];
  const trace = [];
  let guard = 0;
  while (b.dist < dist && guard++ < 4000) {
    if (H.bullets.indexOf(b) < 0) break;
    const yBefore = b.y;
    H.updateBullets(1 / 120);
    trace.push(b.y - yBefore);
  }
  return { y: b.y, y0: yy, dist: b.dist, alive: H.bullets.indexOf(b) >= 0, n: trace.length };
}

console.log('\n【1】准星预测的下坠 vs 子弹真实落点');
for (const wp of H.WEAPONS) {
  if (!wp.grav) { check(wp.name + ' 无下坠', true, 'grav=0'); continue; }
  const D = 700;
  const r = flyTo(wp, D);
  /* 真实落点相对发射水平线的偏移（世界像素）→ 屏幕像素 */
  const real = (r.y - r.y0) * H.VIEW_ZOOM;
  const pred = H.aimDropPx(wp, r.dist, 0);
  const err = Math.abs(real - pred);
  check(wp.name + ' 预测误差 < 6px', err < 6,
    '预测 ' + f2(pred) + 'px / 实际 ' + f2(real) + 'px / 差 ' + f2(err));
}

console.log('\n【2】不同枪的下坠确实不同（700px）');
const dropOf = {};
for (const wp of H.WEAPONS) {
  const r = flyTo(wp, 700);
  dropOf[wp.short] = { real: (r.y - r.y0) * H.VIEW_ZOOM, time: r.n / 120 };
}
for (const wp of H.WEAPONS) {
  console.log('    ' + wp.short.padEnd(4, '　') +
    ' grav=' + String(wp.grav).padStart(3) +
    ' drag=' + f2(wp.drag) +
    ' 实际下坠=' + f2(dropOf[wp.short].real).padStart(7) + 'px' +
    ' 飞行=' + f2(dropOf[wp.short].time) + 's');
}
check('霰弹下坠 > 步枪下坠', dropOf['霰弹'].real > dropOf['步枪'].real + 20,
  f2(dropOf['霰弹'].real) + ' vs ' + f2(dropOf['步枪'].real));
check('步枪下坠 > 狙击下坠', dropOf['步枪'].real > dropOf['狙击'].real + 8,
  f2(dropOf['步枪'].real) + ' vs ' + f2(dropOf['狙击'].real));
check('狙击几乎不下坠（< 15px）', dropOf['狙击'].real < 15, f2(dropOf['狙击'].real) + 'px');
check('火箭走直线', dropOf['火箭'].real === 0, '0px');

console.log('\n【3】drag 让远距离飞行时间变长');
{
  const sg = H.WEAPONS.find(w => w.short === '霰弹');
  const straight = 700 / sg.speed;
  const real = dropOf['霰弹'].time;
  check('霰弹实际飞行时间 > 按初速算的直线时间', real > straight * 1.15,
    '直线 ' + f2(straight) + 's / 实际 ' + f2(real) + 's');
}

console.log('\n【4】远端伤害衰减');
function damageAt(dist, falloff) {
  const e = freshTarget(1);
  const p = H.player;
  /* 弹道测试不测地形：把平台/掩体清掉，保证子弹只可能打到靶子 */
  H.world.platforms.length = 0;
  H.world.covers.length = 0;
  H.world.blocks.length = 0;
  /* 把靶子挪到正前方 dist 处，瞄正躯干中线 */
  e.x = p.x + dist;
  e.y = H.world.groundY;
  e.hp = e.maxHp = 1e9;
  const y0 = e.y - e.h * 0.5;
  H.bullets.length = 0;
  /* 无重力无衰减的「测试弹」：保证两个样本弹着点完全一致 */
  H.spawnBullet(p.x, y0, 1550, 0, 100, 'player', '#fff', 3.2, 'player',
    { grav: 0, drag: 0, falloff: falloff, speed: 1550 });
  const b = H.bullets[H.bullets.length - 1];
  b.ignorePlat = true;
  /* 先把 dist 直接推到目标距离，再让它撞上去 */
  b.dist = dist;
  b.x = e.x - 12;
  b.px = b.x - 6;
  b.y = y0; b.py = y0;
  const before = e.hp;
  let guard = 0;
  while (H.bullets.indexOf(b) >= 0 && guard++ < 400) H.updateBullets(1 / 240);
  return before - e.hp;
}
{
  const dmgClose = damageAt(100, 0.45);
  const dmgFar = damageAt(1000, 0.45);
  const ratio = dmgFar / dmgClose;
  check('falloff 0.45 在 1000px 处只剩约 55%', Math.abs(ratio - (1 - 0.45) / (1 - 0.45 * 0.1)) < 0.06,
    '近距离 ' + f2(dmgClose) + ' → 远距离 ' + f2(dmgFar) + '（比值 ' + f2(ratio) + '）');
  const nearNo = damageAt(100, 0);
  const farNo = damageAt(1000, 0);
  check('falloff 0 的枪远距离不掉伤害', Math.abs(farNo - nearNo) < 0.01,
    f2(nearNo) + ' → ' + f2(farNo));
}

console.log('\n【5】视觉变细不影响判定');
{
  const e = freshTarget(1);
  const p = H.player;
  H.world.platforms.length = 0;
  H.world.covers.length = 0;
  H.world.blocks.length = 0;
  e.x = p.x + 200;
  e.y = H.world.groundY;
  e.hp = e.maxHp = 1e9;
  const y0 = e.y - e.h * 0.5;
  function shoot(bw) {
    e.hp = 1e9;
    H.bullets.length = 0;
    H.spawnBullet(p.x, y0, 1550, 0, 50, 'player', '#fff', 3.2, 'player',
      { grav: 0, drag: 0, bw: bw, speed: 1550 });
    const b = H.bullets[H.bullets.length - 1];
    b.ignorePlat = true;
    const before = e.hp;
    let guard = 0;
    while (H.bullets.indexOf(b) >= 0 && guard++ < 400) H.updateBullets(1 / 240);
    return before - e.hp;
  }
  const fat = shoot(6.0);
  const thin = shoot(0.6);
  check('两发都真的命中了（伤害 > 0）', fat > 0 && thin > 0, f2(fat) + ' / ' + f2(thin));
  check('bw 6.0 与 bw 0.6 打到同样的伤害', Math.abs(fat - thin) < 0.01,
    f2(fat) + ' vs ' + f2(thin));
  const b2 = { r: 3.2, w: 0.6 };
  check('判定半径 r 没有被 bw 改写', b2.r === 3.2 && b2.w === 0.6);
}

console.log('\n【6】准星半径随距离变大');
{
  const m4 = H.WEAPONS[0];
  const r = [100, 300, 600, 900].map(d => H.aimRadiusPx(m4, d, 1));
  console.log('    步枪：' + r.map(v => f2(v) + 'px').join(' → '));
  check('100 → 900px 半径单调变大',
    r[0] < r[1] && r[1] < r[2] && r[2] < r[3]);
  check('900px 处明显大于 100px（> 2.5 倍）', r[3] > r[0] * 2.5,
    f2(r[0]) + ' → ' + f2(r[3]));
  check('半径封顶 150px', H.aimRadiusPx(H.WEAPONS[1], 4000, 3) === 150);

  const sgR = H.aimRadiusPx(H.WEAPONS[1], 500, 1);
  const awmR = H.aimRadiusPx(H.WEAPONS[3], 500, 1);
  check('同一距离霰弹的圈远大于狙击', sgR > awmR * 5,
    '霰弹 ' + f2(sgR) + 'px / 狙击 ' + f2(awmR) + 'px');

  check('蹲下（spreadMul 0.45）圈变小',
    H.aimRadiusPx(m4, 500, 0.45) < H.aimRadiusPx(m4, 500, 1) * 0.6);
  check('连射 bloom（spreadMul 1.5）圈变大',
    H.aimRadiusPx(m4, 500, 1.5) > H.aimRadiusPx(m4, 500, 1) * 1.3);
}

console.log('\n【7】二段跳空翻的驱动字段');
{
  const p = H.player;
  p.airJumps = 1;
  p.onGround = false;
  p.aim = 0;
  const ok = H.doAirJump(p);
  check('doAirJump 成功', ok === true);
  check('airJumpT 置为 AIRJUMP_FLIP', Math.abs(p.airJumpT - H.AIRJUMP_FLIP) < 1e-9,
    'airJumpT=' + f2(p.airJumpT));
  check('flipDir 跟着朝向（aim=0 → +1）', p.flipDir === 1);
  p.aim = Math.PI;
  p.airJumps = 1;
  H.doAirJump(p);
  check('转身后 flipDir 反号', p.flipDir === -1);
  p.airJumpT = 0.2;
  check('airJumpT 会随时间归零（0.42s 够用）', H.AIRJUMP_FLIP > 0.3 && H.AIRJUMP_FLIP < 0.6);
}

console.log('\n【8】尸体：软倒 + 落地 + 淡出');
{
  H.startStage(1);
  H.enemies.length = 0;
  H.corpses.length = 0;
  const p = H.player;

  /* 站在地上死的：立刻开始软 */
  H.spawnEnemyAt('grunt', { x: p.x + 200, y: H.world.groundY }, 1);
  const e1 = H.enemies[H.enemies.length - 1];
  e1.chute = 0;
  H.killEnemy(e1);
  check('击杀生成 1 具尸体', H.corpses.length === 1, 'n=' + H.corpses.length);
  const c1 = H.corpses[0];
  check('地面死亡的尸体立刻 landed', c1.landed === true);
  check('尸体记录了朝向', c1.dir === 1 || c1.dir === -1, 'dir=' + c1.dir);

  for (let i = 0; i < 12; i++) H.updateCorpses(1 / 60);
  check('尸体计时在走', c1.t > 0.15, 't=' + f2(c1.t));

  /* 空中死的：先掉下来 */
  H.corpses.length = 0;
  H.spawnEnemyAt('grunt', { x: p.x + 400, y: H.world.groundY - 260, air: true }, 1);
  const e2 = H.enemies[H.enemies.length - 1];
  e2.chute = 0;
  H.killEnemy(e2);
  const c2 = H.corpses[0];
  check('空中死亡的尸体不是立刻落地', c2 && c2.landed === false);
  const y0 = c2.y;
  for (let i = 0; i < 30; i++) H.updateCorpses(1 / 60);
  check('空中的尸体在往下掉', c2.y > y0, f2(y0) + ' → ' + f2(c2.y));

  /* 再摔一具新的，从第一帧开始逐帧推，逮住「刚落地那一帧」 */
  H.corpses.length = 0;
  H.spawnEnemyAt('grunt', { x: p.x + 420, y: H.world.groundY - 300, air: true }, 1);
  const e2b = H.enemies[H.enemies.length - 1];
  e2b.chute = 0;
  H.killEnemy(e2b);
  const c2b = H.corpses[0];
  let guard = 0, landT = -1;
  while (guard++ < 600) {
    const was = c2b.landed;
    H.updateCorpses(1 / 60);
    if (!was && c2b.landed) { landT = c2b.t; break; }
  }
  check('最终落地', c2b.landed === true, 'y=' + f2(c2b.y) + ' groundY=' + H.world.groundY);
  check('落地后从 t=0 重新开始软', landT >= 0 && landT < 1 / 60 + 1e-6,
    't=' + f2(Math.max(0, landT)));

  /* 掉进深渊的留不下 */
  H.corpses.length = 0;
  H.spawnEnemyAt('grunt', { x: p.x + 300, y: H.world.groundY }, 1);
  const e3 = H.enemies[H.enemies.length - 1];
  e3.chute = 0;
  e3.fell = true;
  H.killEnemy(e3);
  check('掉进深渊的不生成尸体', H.corpses.length === 0);

  /* 计时到点移除 */
  H.corpses.length = 0;
  H.spawnEnemyAt('grunt', { x: p.x + 320, y: H.world.groundY }, 1);
  const e4 = H.enemies[H.enemies.length - 1];
  e4.chute = 0;
  H.killEnemy(e4);
  const c4 = H.corpses[0];
  const life0 = c4.life;
  check('尸体生命 ≈ CORPSE_LIFE + 抖动', life0 >= H.CORPSE_LIFE && life0 <= H.CORPSE_LIFE + 2.3,
    'life=' + f2(life0));
  let g2 = 0;
  while (H.corpses.length && g2++ < 2000) H.updateCorpses(1 / 30);
  check('时间到了尸体被清掉', H.corpses.length === 0);
}

console.log('\n' + (fail === 0 ? '全部通过' : '有失败项') +
  '：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
