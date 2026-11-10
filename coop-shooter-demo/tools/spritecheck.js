/* ==================================================================
   内联立绘 → 源 PNG 逐字节比对
   ------------------------------------------------------------------
   为什么需要它：立绘走 base64 内联（单文件必须自包含），于是
   「改了 art/*.png 但忘了重跑生成器」时，代码里是旧图、屏幕上也是
   旧图 —— 两份都旧，看截图永远看不出来。只有比对才能发现。

   覆盖：
     WHALE_SPRITE_B64        ← art/whale_idle.png
     WHALE_SPRITE_HOLD_B64   ← art/whale_hold.png
     HERO_SPRITE_IDLE_B64    ← art/hero_idle.png
     HERO_SPRITE_HOLD_B64    ← art/hero_hold.png
     六张干员                 ← 见 tools/gen-castart.js --check

   用法：node tools/spritecheck.js
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'chars.js');
const src = fs.readFileSync(SRC, 'utf8');

const CASES = [
  ['WHALE_SPRITE_B64', 'art/whale_idle.png'],
  ['WHALE_SPRITE_HOLD_B64', 'art/whale_hold.png'],
  ['HERO_SPRITE_IDLE_B64', 'art/hero_idle.png'],
  ['HERO_SPRITE_HOLD_B64', 'art/hero_hold.png']
];

let bad = 0;
for (const [name, rel] of CASES) {
  const re = new RegExp('const ' + name + '\\s*=\\s*\'data:image/png;base64,([A-Za-z0-9+/=]*)\'');
  const m = src.match(re);
  if (!m) { console.error('✗ ' + name + '：chars.js 里找不到'); bad++; continue; }
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) { console.error('✗ ' + name + '：缺源图 ' + rel); bad++; continue; }
  const want = fs.readFileSync(f).toString('base64');
  const ok = m[1] === want;
  if (!ok) {
    console.error('✗ ' + name + ' ≠ ' + rel + '（内联 ' + m[1].length +
      ' 字符 / 源图 ' + want.length + ' 字符）→ 重跑对应的生成器');
    bad++;
  } else {
    console.log('✓ ' + name.padEnd(22) + ' 与 ' + rel + ' 逐字节一致');
  }
}

const png = (n) => { try { return fs.readFileSync(path.join(ROOT, 'art', n)); } catch (e) { return null; } };
for (const n of ['whale_idle.png', 'hero_idle.png']) {
  const b = png(n);
  if (b) console.log('  ' + n.padEnd(16) + (b.readUInt32BE(16)) + '×' + b.readUInt32BE(20) + '  ' +
    (b.length / 1024 | 0) + ' KB');
}

console.log(bad ? '\n立绘内联校验失败 ' + bad + ' 项' : '\n立绘内联校验通过 ✓');
process.exit(bad ? 1 : 0);
