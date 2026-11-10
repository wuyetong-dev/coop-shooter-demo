/* 菜单层冒烟测试：把六个菜单页与两个结算页各渲染若干帧，
   专门抓「页面里引用了不存在的字段 / 函数」这类只在画的时候才炸的错误。
   与 headless.js 共用同一套 canvas 桩，但只跑渲染，不跑战斗。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const noop = () => {};
const grad = { addColorStop: noop };

const canvasEl = {
  width: 1280, height: 720, style: {},
  getContext: () => new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      if (p === 'measureText') return () => ({ width: 90 });
      if (p === 'canvas') return canvasEl;
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  }),
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
for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });

const g = vm.runInThisContext('({ get game(){return game}, get SAVE(){return SAVE}, render, frame, onKeyPress, startStage, resetSave, deploy, goLobby })');

/* 直接摆好状态再渲染：不依赖按键顺序，报错就一定是绘制层的问题 */
function show(label, setup) {
  try {
    setup();
    g.render();
    console.log('[' + label + '] 状态=' + g.game.state + '  ✓');
    return true;
  } catch (e) {
    console.log('[' + label + ']  ✗ ' + e.message);
    console.log((e.stack || '').split('\n').slice(1, 4).join('\n'));
    return false;
  }
}

let ok = true;
g.resetSave();
/* 造一份「玩过一阵」的存档：有金币、有等级、解锁了后面几关，
   否则页面上的「已通关 / 已招募 / 可购买」这些分支根本走不到 */
g.SAVE.coins = 1600;
g.SAVE.level = 4;
g.SAVE.xp = 30;
g.SAVE.maxStage = 4;
g.SAVE.cleared = [1, 2, 3];
g.SAVE.seenStory = [1];
g.SAVE.totalKills = 231;
g.SAVE.bestScore = 8420;
g.SAVE.runs = 9;
g.SAVE.chars = ['hero', 'kimi', 'glm'];
g.SAVE.weapons = ['m4', 'm870', 'm249', 'awm'];
g.SAVE.primary = 'awm';
g.SAVE.secondary = 'm249';
g.SAVE.buddyWeapon = 'm870';

ok = show('标题页', () => { g.game.state = 'title'; }) && ok;
ok = show('大厅', () => { g.game.state = 'lobby'; g.game.menu = 0; }) && ok;

/* 每个入口都点一遍：详情条是按 menu 下标取文案的，四个都要能画 */
for (let i = 0; i < 4; i++) {
  ok = show('大厅 · 第 ' + (i + 1) + ' 项', () => { g.game.menu = i; }) && ok;
}

ok = show('选关页', () => { g.game.state = 'deploy'; g.game.pickStage = 4; g.game.menu = 0; }) && ok;
ok = show('选关页 · 第 1 关', () => { g.game.state = 'deploy'; g.game.pickStage = 1; }) && ok;

/* 武器库：每一行都选一遍，确认 meta 查得到、价格分支都走过 */
for (let i = 0; i < 5; i++) {
  ok = show('武器库 · 第 ' + (i + 1) + ' 行', () => { g.game.state = 'armory'; g.game.menu2 = i; }) && ok;
}

/* 干员：四张卡各选一遍（含未解锁的枢机 → 走 locked 分支） */
for (let i = 0; i < 4; i++) {
  ok = show('干员 · 第 ' + (i + 1) + ' 位', () => { g.game.state = 'operators'; g.game.menu2 = i; }) && ok;
}

ok = show('档案', () => { g.game.state = 'archive'; g.game.confirmReset = false; }) && ok;
ok = show('档案 · 清档确认', () => { g.game.state = 'archive'; g.game.confirmReset = true; }) && ok;

/* 剧情：逐字推进到中段，检查切片后的文本也能画 */
g.game.state = 'story';
g.game.dialog = { stage: 1, idx: 1, chars: 3, lines: vm.runInThisContext('storyFor(1)'), returnTo: 'stage' };
ok = show('剧情页 · 逐字中', () => {}) && ok;
ok = show('剧情页 · 末句', () => { g.game.dialog.idx = 3; g.game.dialog.chars = 999; }) && ok;

/* 结算页需要 player，先开一关再强切状态 */
g.startStage(1);
g.game.kills = 27;
g.game.score = 5300;
g.game.earned = 214;
g.game.clearBonus = 164;
g.game.levelUps = 2;
g.game.xpGain = 310;
ok = show('过关结算', () => { g.game.state = 'stageclear'; }) && ok;
ok = show('失败结算', () => { g.game.state = 'gameover'; }) && ok;

/* frame() 里的菜单时钟：剧情逐字与 toast 都必须真的在走 */
g.game.state = 'story';
g.game.dialog = { stage: 1, idx: 0, chars: 0, lines: vm.runInThisContext('storyFor(1)'), returnTo: 'stage' };
g.game.toast = '测试提示';
g.game.toastT = 1.0;
let t0 = 0;
g.frame(t0 += 16); g.frame(t0 += 16); g.frame(t0 += 16);
const advanced = g.game.dialog.chars > 0;
const ticked = g.game.toastT < 1.0;
console.log('[菜单时钟] 逐字推进=' + advanced + ' toast 衰减=' + ticked + ((advanced && ticked) ? '  ✓' : '  ✗'));
ok = ok && advanced && ticked;

console.log(ok ? '\n菜单层全部通过 ✓' : '\n菜单层有失败项 ❌');
process.exit(ok ? 0 : 1);
