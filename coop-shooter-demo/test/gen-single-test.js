/* 验收用：把打包后的单文件整体注入，再补一段「同步定格」脚本 ——
   不用 rAF、不等 virtual-time：加载时就把目标帧一次跑完，最后渲染一次，
   然后把 update/render 置空，画布就永久停在那一帧。
   这样无论无头 Chrome 什么时候截图，拍到的都是同一张，不会有竞态。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const single = fs.readFileSync(path.join(root, '..', 'coop-demo.html'), 'utf8');

const boot = `
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var stage = Number(q.get('stage') || 1);
  var mode = q.get('mode') || 'intro';
  var target = Number(q.get('t') || 40);

  var log = [];

  startStage(stage);
  game.state = 'playing';
  game.wave = game.maxWave - 1;
  beginWave();
  if (mode === 'fight' || mode === 'kill') {
    game.spawnQueue.forEach(function (s) { s.at = 0; });
    game.spawnTimer = 0;
  }

  var step = 1 / 60;
  var killed = false;
  /* 第 0 帧 BOSS 还躺在 spawnQueue 里，第 1 帧才出生，所以定位要放到 i===1 */
  var placeBoss = function (dx) {
    var bs = enemies.find(function (e) { return e.boss; });
    if (!bs) return false;
    bs.x = player.x + dx;
    bs.y = world.groundY;
    bs.vx = 0;
    bs.vy = 0;
    bs.chute = 0;        /* 落地：否则伞降状态会一直把 y 拉回天上 */
    bs.chuteVis = 0;
    return true;
  };
  for (var i = 0; i < target; i++) {
    if (i === 1 && mode !== 'intro') {
      if (placeBoss(360)) log.push('place@' + i);
    }
    if (mode === 'kill' && i === target - 50) {
      /* 提前把 BOSS 拉到镜头前，让它有几十帧走到位 */
      if (placeBoss(240)) log.push('placeKill@' + i);
    }
    if (mode === 'fight' && i === Math.floor(target * 0.55)) {
      var b2 = enemies.find(function (e) { return e.boss && !e.dead; });
      if (b2) { b2.hp = b2.maxHp * 0.62; log.push('setHp@' + i + '=' + Math.round(b2.hp) + '/' + b2.maxHp); }
      else log.push('noBoss@' + i);
    }
    if (mode === 'kill' && i === target - 16) {
      var b3 = enemies.find(function (e) { return e.boss && !e.dead; });
      if (b3) {
        /* 同一帧里先落回地面再结算伤害：爆炸坐标取的就是这一下的 e.y */
        b3.y = world.groundY; b3.vy = 0; b3.vx = 0; b3.chute = 0;
        log.push('y@kill=' + Math.round(b3.y) + ' ground=' + world.groundY);
        killEnemy(b3);
        killed = true;
        log.push('kill@' + i);
      }
    }
    update(step);
  }

  /* 血条平滑依赖 _dt，这里补够帧数让残影收敛到位再定格 */
  _dt = step;
  for (var k = 0; k < 200; k++) render();

  /* 定格：之后游戏自己的 frame() 再跑也不会改动画面 */
  update = function () {};
  render = function () {};

  var bi = game.bossIntro;
  var dbg = document.createElement('div');
  dbg.id = 'dbg';
  dbg.style.cssText = 'position:fixed;left:2px;bottom:0;z-index:99;font:10px monospace;color:#0f0';
  dbg.textContent = 'DBG stage=' + game.stage + ' mode=' + mode + ' frames=' + target
    + ' intro=' + (bi ? bi.t.toFixed(2) + '/' + bi.dur + ' ' + bi.name : 'null')
    + ' boss=' + enemies.filter(function (e) { return e.boss; }).length
    + ' hp=' + (function () { var b = enemies.find(function (e) { return e.boss; }); return b && !b.dead ? Math.round(b.hp / b.maxHp * 100) + '%' : '-'; })()
    + ' slowmo=' + (game.slowmo || 0).toFixed(2) + ' flash=' + (game.screenFlash || 0).toFixed(2)
    + ' fires=' + fires.length + ' ' + log.join(',');
  document.body.appendChild(dbg);
})();
</script>
`;

const out = single.replace('</body>', boot + '</body>');
fs.writeFileSync(path.join(__dirname, 'single-boss.html'), out, 'utf8');
console.log('已生成 test/single-boss.html  (' + Math.round(out.length / 1024) + ' KB)');
