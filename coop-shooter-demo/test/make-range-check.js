/* 射程验收：把「准星超出射程」和 HUD 的「射程 N」拍进截图。
   参数走查询串，一个文件拍所有姿势：
     range_check.html?v=hud&w=0   → 看 HUD 武器行（射程数字有没有和弹药撞位）
     range_check.html?v=aim&w=1&d=1050  → 准星在射程内（亮的琥珀色）
     range_check.html?v=aim&w=1&d=1300  → 准星超出射程（灰圈 + 叉 + 「超出射程」）
     range_check.html?v=aim&w=3&d=1300  → 同一距离换狙击：又变回亮的
   v=aim 时镜头会把准星推到屏幕 72% 处，保证圈完整落在画面里。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const single = fs.readFileSync(path.join(root, '..', 'coop-demo.html'), 'utf8');

const scene = `
<div id="diag" style="position:fixed;left:8px;top:8px;z-index:99;padding:8px 10px;
  background:rgba(0,0,0,.82);border:1px solid #4a6a8a;border-radius:4px;
  font:15px/1.5 Consolas,monospace;color:#7fe3ff;white-space:pre;pointer-events:none"></div>
<script>
(function () {
  var log = [];
  var box = document.getElementById('diag');
  function show(err) {
    box.style.color = err ? '#ff8a8a' : '#7fe3ff';
    box.textContent = log.join('\\n') + (err ? '\\n!! ' + err : '');
  }
  try {
    var q = new URLSearchParams(location.search);
    var MODE = q.get('v') || 'hud';
    var WID  = Number(q.get('w') || 0);
    var DIST = Number(q.get('d') || 600);

    startStage(Number(q.get('s') || 1));
    aiPanelOpen = false;
    game.wave = 2; game.waveActive = false; game.spawnQueue = [];
    enemies.length = 0;
    game.state = 'playing';

    /* 找一段平地站好 */
    var px = 420;
    for (var d0 = 0; d0 < 900 && !groundAt(px); d0 += 8) px += 8;
    player.weapon = WID;
    player.x = px; player.y = world.groundY; player.onGround = true;
    player.vx = 0; player.vy = 0; player.plat = null;
    player.hp = player.maxHp; player.downed = false;
    player.facing = 1; player.aim = 0; player.crouch = 0;
    player.bloom = 0; player.muzzle = 0; player.ads = false;
    player.mags[WID] = (WEAPONS[WID].mag === undefined ? 30 : WEAPONS[WID].mag);
    player.reloading = 0;

    buddy.x = px - 150; buddy.y = world.groundY; buddy.onGround = true;
    buddy.vx = 0; buddy.vy = 0; buddy.plat = null;
    buddy.cmd = 'hold'; buddy.holdX = buddy.x; buddy.bubbleTimer = 0; buddy.bubble = '';

    var ox = player.x + Math.cos(player.aim) * 30;
    var oy = player.y - player.h * 0.62 + Math.sin(player.aim) * 30;

    /* 准星放到指定世界距离上：屏幕 x 由 camera 反推 */
    var aimSX = MODE === 'aim' ? W * 0.72 : W * 0.52;
    if (MODE === 'aim') {
      camera.x = Math.max(0, ox + DIST - aimSX / VIEW_ZOOM);
    } else {
      camera.x = Math.max(0, player.x - W * 0.22);
    }
    input.mx = (ox + (MODE === 'aim' ? DIST : 300) - camera.x) * VIEW_ZOOM;
    input.my = oy * VIEW_ZOOM + CAM_TY;

    for (var i = 0; i < 4; i++) update(1 / 60);

    /* 这 4 帧会把玩家推来推去，位置重设一次再冻住 */
    player.x = px; player.y = world.groundY; player.vx = 0; player.vy = 0;
    player.onGround = true; player.bloom = 0; player.muzzle = 0;
    if (MODE === 'aim') camera.x = Math.max(0, ox + DIST - aimSX / VIEW_ZOOM);
    else camera.x = Math.max(0, player.x - W * 0.22);
    input.mx = (ox + (MODE === 'aim' ? DIST : 300) - camera.x) * VIEW_ZOOM;
    input.my = oy * VIEW_ZOOM + CAM_TY;
    camera.shake = 0;

    game.msg = ''; game.msgTimer = 0;
    for (var k = 0; k < texts.length; k++) texts[k].life = 0;

    update = function () {};

    var wp = WEAPONS[WID];
    var mw = mouseWorld();
    var realD = Math.round(Math.hypot(mw.x - ox, mw.y - oy));
    log.push('weapon=' + wp.name + '  range=' + wp.range + '  dist=' + realD
           + '  over=' + (wp.range > 0 && realD > wp.range));
    log.push('spread=' + Math.round(aimRadiusPx(wp, realD, 1)) + 'px'
           + '  drop=' + Math.round(aimDropPx(wp, realD, player.aim)) + 'px');
    log.push('crosshair screen=(' + Math.round(input.mx) + ',' + Math.round(input.my) + ')');
    show(null);
  } catch (e) {
    show(e && (e.message + ' @' + ((e.stack || '').split('\\n')[1] || '')));
  }
})();
</script>
`;

const out = single.replace('</body>', scene + '</body>');
if (out === single) { console.error('注入失败：没找到 </body>'); process.exit(1); }
const f = path.join(__dirname, 'range_check.html');
fs.writeFileSync(f, out, 'utf8');
console.log('生成 ' + path.basename(f) + '  ' + Math.round(out.length / 1024) + ' KB');
