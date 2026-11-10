/* 运行时射程探针：不是复刻公式，是把整个游戏跑起来，用真实的 fireWeapon
   开一枪，再看每一颗子弹身上到底挂没挂 range、飞到哪里消失。
   ------------------------------------------------------------------
   probe-range.js 验的是「物理上飞得到设计射程」，这个探针验的是另一件事：
   range 有没有从武器表一路传到子弹上。两者缺一不可 ——
   公式对、链路断，桌上数值好看，场上还是老的 2.2 秒。

   断言：
     ① 玩家开出的每一颗子弹，b.range 必须等于这把枪的 range；
     ② 任何一帧都不许出现 b.dist > b.range（封顶必须真的生效）；
     ③ 每把枪都要有子弹因为「打到射程尽头」而消失。
   ------------------------------------------------------------------ */
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
const files = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'hud.js'];
for (const f of files) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}

const G = vm.runInThisContext(`({
  get game(){return game}, get player(){return player}, get buddy(){return buddy},
  get enemies(){return enemies}, get bullets(){return bullets},
  get world(){return world}, get camera(){return camera},
  WEAPONS, startStage, update, fireWeapon, groundAt, input,
  coverBlocks, platformBlocks
})`);

/* ---------- 布置一块干净的战场 ---------- */
G.startStage(1);
vm.runInThisContext('aiPanelOpen = false');
G.game.wave = 2;
G.game.waveActive = false;
G.game.spawnQueue = [];
G.enemies.length = 0;
G.game.state = 'playing';

const p = G.player;

/* 把建筑、沙袋、空中平台全撤掉，只留地面。
   这个探针量的是「射程封顶」，不是「地形怎么挡枪」——
   地图上建筑密到 400px 外必有一堵墙，留着它们量到的全是墙的距离。
   地形拦截本身由 probe-ballistic / probe-plat 负责，不在这里重复。 */
const w0 = G.world;
const nBlocks = (w0.blocks || []).length + (w0.covers || []).length;
w0.blocks.length = 0;
w0.covers.length = 0;
/* 地面本身也挂在 platforms 里（p.ground），不能整片清空，否则人直接掉进虚空 */
w0.platforms = w0.platforms.filter(pp => pp.ground);

let px = 360;
while (px < 2800 && !G.groundAt(px)) px += 8;

p.x = px;
p.y = G.world.groundY;
p.onGround = true;
p.vx = 0; p.vy = 0; p.plat = null;
p.hp = p.maxHp;
G.buddy.x = p.x - 260; G.buddy.y = G.world.groundY; G.buddy.onGround = true;
console.log('射击位 x=' + px + '，已撤掉 ' + nBlocks + ' 处建筑/掩体与空中平台\n');

const dt = 1 / 60;
const rows = [];
let bad = [];

/* ---------- 开一枪，跟到最后一颗子弹消失 ---------- */
function shoot(wp, angleDeg) {
  G.bullets.length = 0;

  /* 关掉散布再开火：fireWeapon 每一枪都会在 ±spread 里重掷仰角，
     机枪那 0.075 rad ≈ ±4.3°，同样「抬 5°」能打出 1690 也可能打出 2900，
     量出来的射程忽远忽近，根本没法判断封顶有没有生效。 */
  const save = wp.spread;
  wp.spread = 0;
  G.fireWeapon(p, wp, -angleDeg * Math.PI / 180, 1, 1);   /* 负号 = 向上，canvas 里 y 向下 */
  wp.spread = save;

  const linkErr = [];
  if (G.bullets.length === 0) linkErr.push('没开出子弹');
  for (const b of G.bullets) {
    if (b.range !== wp.range) linkErr.push('子弹 range=' + b.range + '，应为 ' + wp.range);
  }

  const seen = new Map();
  const end = { range: 0, life: 0, edge: 0, ground: 0 };   /* 消散原因分类 */
  let maxDist = 0, frames = 0, overshoot = 0, foreign = 0;

  while (G.bullets.length > 0 && frames < 60 * 12) {
    /* 跑久了会出两件意外，都会让测量作废：
       ① 地图自己开下一波，敌兵的子弹没有 range，混进来量成别人的弹道；
       ② 站着不动的玩家踩到机关倒地、game over，update 直接早退，
          子弹冻在半空，探测循环于是空转到 12 秒上限。 */
    G.game.waveActive = false;
    G.game.spawnQueue.length = 0;
    G.enemies.length = 0;
    p.hp = p.maxHp;
    p.downed = false;
    G.game.state = 'playing';

    for (const b of G.bullets) seen.set(b, { dist: b.dist, life: b.life });
    G.update(dt);
    frames++;
    for (const b of G.bullets) {
      if (b.range !== wp.range) { foreign++; continue; }
      if (b.dist > maxDist) maxDist = b.dist;
      if (b.range > 0 && b.dist > b.range * 1.02) overshoot++;
    }
    /* 这一帧消失的子弹，用上一帧的 dist/寿命 + 这一帧的位置判断它为什么没的 */
    for (const [b, snap] of seen) {
      if (!G.bullets.includes(b)) {
        seen.delete(b);
        if (b.range > 0 && snap.dist >= b.range * 0.96) end.range++;
        else if (snap.life <= dt * 1.5) end.life++;
        else if (b.x < -100 || b.x > G.world.w + 100) end.edge++;
        else end.ground++;
      }
    }
  }
  return { maxDist, end, frames, overshoot, foreign, linkErr };
}

/* ---------- 逐把枪试几个仰角，挑飞得最远的那个 ---------- */
const ANGLES = [0, 2, 4, 6, 8, 10, 12, 14, 16];
for (let w = 0; w < G.WEAPONS.length; w++) {
  const wp = G.WEAPONS[w];
  p.weapon = w;

  let best = null;
  for (const a of ANGLES) {
    const r = shoot(wp, a);
    r.angle = a;
    for (const e of r.linkErr) if (!bad.includes(wp.short + ' 的' + e)) bad.push(wp.short + ' 的' + e);
    if (r.overshoot > 0) {
      bad.push(wp.short + ' 在 ' + a + '° 有 ' + r.overshoot + ' 帧子弹飞过了射程（封顶失效）');
    }
    if (r.foreign > 0) bad.push(wp.short + ' 在 ' + a + '° 混进了别人的子弹（探针布置有问题）');
    /* 「打得远」优先，其次才是飞得远 */
    if (!best || r.end.range > best.end.range ||
        (r.end.range === best.end.range && r.maxDist > best.maxDist)) best = r;
  }

  /* 一张地图才 3200~3800 宽：步枪 4000、狙击 5600 本来就比地图长，
     它们当然会先飞出边界 —— 这正是「狙击全图无死角」的设计。
     所以在图内打得到射程的，必须看到 range 消散；比地图长的，必须飞出边界。 */
  const reachable = wp.range <= G.world.w - 200;
  if (reachable && best.end.range === 0) {
    bad.push(wp.short + ' 射程 ' + wp.range + ' 在地图内可达，却没有子弹打到尽头');
  }
  if (!reachable && best.end.range === 0 && best.end.edge === 0) {
    bad.push(wp.short + ' 既没打到射程也没飞出地图');
  }

  let verdict;
  if (best.end.range > 0) verdict = '打到射程尽头消散';
  else if (best.end.edge > 0) verdict = '先飞出地图边界（射程比地图长）';
  else if (best.end.ground > 0) verdict = '先落地';
  else verdict = '先耗光寿命';

  rows.push({
    name: wp.name, range: wp.range,
    angle: best.angle, lived: (best.frames / 60).toFixed(2) + 's',
    maxDist: Math.round(best.maxDist), end: best.end, verdict: verdict
  });
}

/* ---------- 输出 ---------- */
console.log('武器        设计射程  仰角   实飞最远   存活    消散(range/落地/出界/寿命)   结论');
console.log('─'.repeat(104));
for (const r of rows) {
  const e = r.end;
  console.log(
    r.name.padEnd(10) +
    String(r.range).padStart(8) +
    (r.angle + '°').padStart(6) +
    String(r.maxDist).padStart(10) +
    String(r.lived).padStart(8) +
    (String(e.range) + '/' + String(e.ground) + '/' + String(e.edge) + '/' + String(e.life)).padStart(18) +
    '   ' + r.verdict
  );
}
console.log('');

if (bad.length) {
  console.log('✗ 失败：');
  for (const b of bad) console.log('   · ' + b);
  process.exit(1);
}
console.log('✓ range 已从武器表传到子弹，逐帧封顶生效；地图内够得着的都打到了尽头，比地图长的都飞出了边界');
