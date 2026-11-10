/* 临时排查：第 1 关深渊附近到底有没有装饰件被画出来（用完即删） */
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
for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'hud.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}
const g = vm.runInThisContext('({ get world(){return world}, buildStage, groundAt })');

g.buildStage(1);
const W = g.world;
console.log('pits: ' + W.pits.map(p => p.x + '+' + p.w).join('  '));
for (const p of W.pits) {
  const near = W.props.filter(pr => pr.x > p.x - 60 && pr.x < p.x + p.w + 60);
  console.log(`坑 ${p.x}~${p.x + p.w}: 附近装饰件 ${near.length}`);
  for (const pr of near) console.log(`   ${pr.kind} @${Math.round(pr.x)} y=${pr.y} groundAt=${g.groundAt(pr.x)}`);
}
console.log('全部装饰件:');
for (const pr of W.props) console.log(`   ${pr.kind} @${Math.round(pr.x)} groundAt=${g.groundAt(pr.x)}`);
