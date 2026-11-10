/* 探针：玩家挂机时，八哥会不会离指挥官太远？逐秒打印位置与意图 */
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
const g = vm.runInThisContext('({ get game(){return game}, get player(){return player}, get buddy(){return buddy}, get enemies(){return enemies}, get camera(){return camera}, startStage, update, get world(){return world} })');

g.startStage(1);
const dt = 1 / 60;
let maxGap = 0, maxGapAt = 0;
for (let f = 0; f < 60 * 40; f++) {
  g.update(dt);
  const p = g.player, b = g.buddy;
  const gap = Math.abs(b.x - p.x);
  if (gap > maxGap) { maxGap = gap; maxGapAt = f / 60; }
  if (f % 120 === 0) {
    const tg = b.target;
    console.log(
      't=' + (f / 60).toFixed(0).padStart(2) + 's  wave=' + g.game.wave +
      '  p.x=' + p.x.toFixed(0).padStart(5) + '  b.x=' + b.x.toFixed(0).padStart(5) +
      '  间距=' + gap.toFixed(0).padStart(4) +
      '  意图=' + (b.intent || '-').padEnd(8) +
      '  目标=' + (tg ? Math.round(Math.abs(tg.x - b.x)) + 'px' : '无') +
      '  pHP=' + Math.max(0, Math.round(p.hp)) + '  bHP=' + Math.max(0, Math.round(b.hp))
    );
  }
  if (g.game.state !== 'playing') { console.log('  → 状态变为 ' + g.game.state + '，t=' + (f / 60).toFixed(1) + 's'); break; }
}
console.log('\n最大间距 ' + maxGap.toFixed(0) + 'px（发生在 ' + maxGapAt.toFixed(1) + 's）· 世界宽 ' + g.world.w);
