/* ==================================================================
   把 art/cast/*.png 内联进 js/chars.js 的 CASTART 区
   ------------------------------------------------------------------
   单文件版必须自包含（双击 HTML 就能玩，不带 art 目录），
   所以六张立绘和 whale/hero 一样走 base64。

   只替换 /* ==CASTART:BEGIN== * / 和 /* ==CASTART:END== * / 之间的内容，
   外面的代码一个字都不碰。

   用法：node tools/gen-castart.js            ← 重新内联
         node tools/gen-castart.js --check    ← 只比对，不一致就退 1
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'art', 'cast');
const SRC = path.join(ROOT, 'js', 'chars.js');
const NAMES = ['kimi', 'glm', 'gpt', 'grok', 'gemini', 'claude'];

const lines = [];
let total = 0;
for (const n of NAMES) {
  const f = path.join(ART, n + '.png');
  if (!fs.existsSync(f)) { console.error('缺图 ' + f); process.exit(1); }
  const b = fs.readFileSync(f);
  total += b.length;
  lines.push('  ' + n + ': \'data:image/png;base64,' + b.toString('base64') + '\'');
}

const src0 = fs.readFileSync(SRC, 'utf8');
/* 换行符跟着文件走。这个仓库的 .js 是 CRLF，但生成器写进去的是 LF 的话，
   文件就变成混合换行 —— 功能上没差，可 --check 会一直报「不一致」，
   于是这个检查会被当成噪音关掉，比没有检查更糟。 */
const EOL = src0.indexOf('\r\n') >= 0 ? '\r\n' : '\n';

const block =
  '/* ==CASTART:BEGIN== */' + EOL +
  '/* 六张干员立绘，art/cast/*.png 原样内联（tools/gen-castart.js 生成，别手改）。' + EOL +
  '   192px 高：游戏里画 96px，正好是 2 倍超采样 —— 缩放时不会糊。 */' + EOL +
  'const CAST_SPRITE_B64 = {' + EOL + lines.join(',' + EOL) + EOL + '};' + EOL +
  '/* ==CASTART:END== */';

const src = src0;
const re = /\/\* ==CASTART:BEGIN== \*\/[\s\S]*?\/\* ==CASTART:END== \*\//;
const m = src.match(re);
if (!m) { console.error('chars.js 里找不到 CASTART 标记'); process.exit(1); }

/* --check：内联块和 art/cast/*.png 是否还逐字节对得上。
   换图忘了重跑生成器，画面上是旧脸、代码里也是旧图 —— 两份都旧，看截图看不出来。 */
if (process.argv.includes('--check')) {
  if (m[0] === block) {
    console.log('✓ 六张内联与 art/cast/*.png 逐字节一致');
  } else {
    console.error('✗ 内联块和 art/cast/*.png 不一致，跑 node tools/gen-castart.js 重生成');
    process.exit(1);
  }
  process.exit(0);
}

fs.writeFileSync(SRC, src.replace(re, block));

console.log('已内联 ' + NAMES.length + ' 张，PNG 合计 ' + (total / 1024).toFixed(0) +
  ' KB → base64 ' + (block.length / 1024).toFixed(0) + ' KB');
