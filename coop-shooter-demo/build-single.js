/* 打包：把 index.html + js/*.js 合并成单文件，双击即可玩 */
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const files = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js'];
let bundle = '';
for (const f of files) {
  bundle += '\n/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(root, 'js', f), 'utf8') + '\n';
}

const tags = files.map(f => '<script src="js/' + f + '"></script>').join('\n');
if (!html.includes(tags)) {
  console.error('未找到脚本标签块，检查 index.html');
  process.exit(1);
}
html = html.replace(tags, '<script>\n' + bundle + '\n</script>');
html = html.replace('<div id="hint">点击画面开始 · 全屏体验更佳</div>',
  '<div id="hint">点击画面开始 · 全屏体验更佳（F11 全屏）</div>');

const out = path.join(root, '..', 'coop-demo.html');
fs.writeFileSync(out, html, 'utf8');
console.log('已生成单文件版: ' + out + '  (' + Math.round(html.length / 1024) + ' KB)');
