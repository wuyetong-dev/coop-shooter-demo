/* 验收用：把「命中部位倍率」和「空中平台挡弹」在**打包后的单文件**里跑一遍并定格。
   和 gen-single-test.js 同一套思路：不用 rAF、不等 virtual-time，
   加载时就把场景同步跑完，最后把 update/render 置空，画布永久停在那一帧。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const single = fs.readFileSync(path.join(root, '..', 'coop-demo.html'), 'utf8');

const boot = `
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var mode = q.get('mode') || 'hit';
  var log = [];

  startStage(1);
  game.state = 'playing';
  game.waveDelay = 999;          /* 别让波次自己刷人打乱画面 */
  game.spawnQueue.length = 0;

  var E = null;

  /* ---------------- 场景一：三个部位各吃一发 ----------------
     同一把枪、同一距离，只有落点高度不同：头 / 躯干 / 腿。
     数字大小是这套系统唯一的「说明书」。 */
  if (mode === 'hit') {
    player.x = 300;
    player.y = world.groundY;
    player.vy = 0;
    player.onGround = true;
    player.aim = 0;

    var spots = [470, 640, 760];
    var fracs = [0.11, 0.42, 0.85];
    E = [];
    for (var i = 0; i < spots.length; i++) {
      spawnEnemyAt('grunt', { x: spots[i], y: world.groundY }, 1);
      var e = enemies[enemies.length - 1];
      e.x = spots[i];
      e.y = world.groundY;
      e.vx = 0; e.vy = 0;
      e.hp = 4000; e.maxHp = 4000;       /* 别让他死，数字才是重点 */
      e.aim = Math.PI;
      E.push(e);
    }

    camera.x = 610 - VIEW_W / 2;

    /* 每颗子弹就从自己目标的左前方 56px 出发 —— 排成一条直线的话，
       三发都会被最前面那个兵吃掉，数字就分不出来了。 */
    for (var j = 0; j < E.length; j++) {
      var t = E[j];
      var hy = t.y - t.h + t.h * fracs[j];
      spawnBullet(t.x - 56, hy, 1500, 0, 20, 'ally', '#ffd166', 3.2, 'player',
        { ignorePlat: player.plat });
    }

    /* 跑到子弹全部结算完（每颗只走 200 多像素，十几帧足够） */
    var step = 1 / 60;
    for (var k = 0; k < 16 && bullets.length; k++) updateBullets(step);
    for (var m = 0; m < 6; m++) update(step);

    log.push('头 ' + Math.round(4000 - E[0].hp) + ' 躯干 ' + Math.round(4000 - E[1].hp) +
      ' 腿 ' + Math.round(4000 - E[2].hp));
  }

  /* ---------------- 场景二：空中平台挡子弹 ----------------
     从下往上、从左边平射，全部撞在台阶的实心梁上。 */
  if (mode === 'plat') {
    player.x = 430;
    player.y = world.groundY;
    player.vy = 0;
    player.onGround = true;
    player.aim = -Math.PI / 2;

    camera.x = 470 - VIEW_W / 2;

    var step2 = 1 / 60;
    var fired = 0;

    /* 仰射钢板台（x 300~496，顶面 y=476，厚 20） */
    for (var a = 0; a < 5; a++) {
      spawnBullet(340 + a * 38, world.groundY - 20, 0, -1100, 20, 'ally', '#ffd166', 3.2, 'player',
        { ignorePlat: player.plat });
      fired++;
    }
    /* 侧射混凝土台（x 552~728，顶面 y=384，厚 26），打左缘 */
    for (var b = 0; b < 3; b++) {
      spawnBullet(500, 390 + b * 7, 1400, 0, 20, 'ally', '#ffd166', 3.2, 'player',
        { ignorePlat: player.plat });
      fired++;
    }

    for (var s = 0; s < 20 && bullets.length; s++) updateBullets(step2);
    log.push('射出 ' + fired + ' 发 剩余 ' + bullets.length + ' 发 粒子 ' + particles.length);

    /* 白热闪光只有 0.09 秒，定格帧必须紧跟在命中后面 */
    for (var n = 0; n < 2; n++) update(step2);
  }

  /* 先把画面画出来，再定格 —— 顺序反了就只剩一块黑板 */
  for (var r = 0; r < 3; r++) render();
  update = function () {};
  render = function () {};

  var dbg = document.createElement('div');
  dbg.id = 'dbg';
  dbg.style.cssText = 'position:fixed;left:2px;bottom:0;z-index:99;font:11px monospace;color:#0f0;text-shadow:0 0 3px #000';
  dbg.textContent = 'DBG mode=' + mode + ' | ' + log.join(' | ');
  document.body.appendChild(dbg);
})();
</script>
`;

const out = single.replace('</body>', boot + '</body>');
fs.writeFileSync(path.join(__dirname, 'single-hit.html'), out, 'utf8');
console.log('已生成 test/single-hit.html  (' + Math.round(out.length / 1024) + ' KB)');
