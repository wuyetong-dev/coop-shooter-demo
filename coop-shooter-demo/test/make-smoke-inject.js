/* 冒烟用：给单文件产物追加一段「自动开局 + 报错上屏」的脚本，生成临时副本
   只为截图验证打包后的代码在真实浏览器里能跑，不参与正式产物 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'coop-demo.html');
const out = path.join(__dirname, 'smoke_single_stage1.html');

let html = fs.readFileSync(src, 'utf8');

const inject = `
<div id="__err" style="position:fixed;left:0;top:0;right:0;z-index:99999;background:#c00;color:#fff;
  font:14px/1.5 monospace;padding:6px 10px;display:none;white-space:pre-wrap"></div>
<script>
(function () {
  const box = document.getElementById('__err');
  function show(msg) { box.style.display = 'block'; box.textContent += msg + '\\n'; }
  window.onerror = (m, s, l, c) => { show('ERR ' + m + ' @' + l + ':' + c); };
  window.addEventListener('load', function () {
    try { startStage(1); } catch (e) { show('START ERR ' + e.message); }
  });
})();
</script>
`;

html = html.replace('</body>', inject + '</body>');
fs.writeFileSync(out, html, 'utf8');
console.log('已生成冒烟副本: ' + out);
