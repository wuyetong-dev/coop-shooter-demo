/* ==================================================================
   敌兵通行性探针
   目的：废墟（砖墙）与指挥部（集装箱 / 铁丝网）里塞了大量硬掩体，
        如果敌人不会翻越，就会成排堵在掩体前面 —— 这是最容易被
        「截图看起来正常」掩盖掉的问题，必须用数据验证。
   指标：① 单个敌人连续被挡的帧数（>100 帧≈1.7秒 = 卡在掩体前）
        ② 是否有敌人长期静止（>120 帧位移不足 0.05px）
        ③ 结束时仍与玩家相距 >700px 的敌人数量
   ================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 浏览器桩件（与 headless.js 保持一致）---------- */
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

/* ---------- 装载 7 个模块 ---------- */
const base = path.join(__dirname, '..', 'js');
const files = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'hud.js'];
for (const f of files) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}

/* headless.js 的 g 是局部常量，这里单独取一份句柄 */
const g = vm.runInThisContext(
  '({ get game(){return game}, get player(){return player}, get buddy(){return buddy},' +
  '   get enemies(){return enemies}, get world(){return world},' +
  '   get bullets(){return bullets}, startStage, update })'
);

const STAGES = [1, 2, 3];
const SECONDS = 40;
const FRAMES = Math.round(SECONDS * 60);

console.log('=========== 敌兵通行性（玩家定点不动、不打枪）===========');

let fail = 0;
let probeId = 0;

for (const st of STAGES) {
  g.startStage(st);
  g.game.state = 'playing';

  /* 玩家原地站着挨打，让敌人按自己的逻辑跑过来 */
  vm.runInThisContext('keys')['KeyA'] = false;
  vm.runInThisContext('keys')['KeyD'] = false;
  vm.runInThisContext('input').firing = false;

  const stuck = new Map();       // id -> 当前连续被挡帧数
  const maxBlocked = new Map();  // id -> 历史最长连续被挡帧数
  const stillFrames = new Map(); // id -> 当前连续静止帧数
  const lastX = new Map();
  const seen = new Set();
  let peakEnemies = 0;

  for (let f = 0; f < FRAMES; f++) {
    /* 玩家与八哥都不死，避免提前 gameover 打断采样 */
    if (g.player) { g.player.hp = 1e9; g.player.downed = false; }
    if (g.buddy) g.buddy.hp = 1e9;

    g.update(1 / 60);
    if (g.game.state !== 'playing' && g.game.state !== 'stageclear') g.game.state = 'playing';

    const es = g.enemies;
    if (es.length > peakEnemies) peakEnemies = es.length;

    for (const e of es) {
      const id = e.__pid || (e.__pid = ++probeId);
      seen.add(id);

      const px = lastX.get(id);
      stillFrames.set(id, (px !== undefined && Math.abs(e.x - px) < 0.05)
        ? (stillFrames.get(id) || 0) + 1 : 0);
      lastX.set(id, e.x);

      if (e.blocked) {
        const n = (stuck.get(id) || 0) + 1;
        stuck.set(id, n);
        if (n > (maxBlocked.get(id) || 0)) maxBlocked.set(id, n);
      } else {
        stuck.set(id, 0);
      }
    }
    /* 换波时敌人数组会被替换，lastX 里旧的留着无所谓 */
  }

  /* ---------- 汇总 ---------- */
  let worstBlocked = 0, idleLong = 0, far = 0;
  for (const e of g.enemies) {
    const id = e.__pid;
    if (!id) continue;
    const mb = maxBlocked.get(id) || 0;
    if (mb > worstBlocked) worstBlocked = mb;
    if ((stillFrames.get(id) || 0) > 120) idleLong++;
    if (Math.abs(e.x - g.player.x) > 700) far++;
  }
  /* 也曾出现过的最长被挡（含已阵亡的） */
  let worstEver = 0;
  for (const v of maxBlocked.values()) if (v > worstEver) worstEver = v;

  const th = g.world.theme ? g.world.theme.name : '?';
  const bad = worstEver > 100;
  if (bad) fail++;
  console.log(
    '第 ' + st + ' 关 [' + th + ']' +
    '  敌人峰值=' + peakEnemies +
    '  出场总数=' + seen.size +
    '  最长连续被挡=' + worstEver + '帧' +
    '  原地超2秒=' + idleLong +
    '  距玩家>700px=' + far +
    (bad ? '  ✗ 有敌人卡在掩体前' : '  ✓')
  );
}

console.log(fail === 0 ? '\n✓ 三关通行性全部通过' : '\n✗ ' + fail + ' 关存在卡死');
