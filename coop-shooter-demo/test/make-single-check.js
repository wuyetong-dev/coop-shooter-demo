/* 用打包好的单文件产物再做一次「地形验收」：
   把一段场景脚本注到 </body> 前面，验证内联后的 groundAt / drawPits / 气流 / 机关
   在单文件环境里和分模块环境表现一致（打包时最怕的就是某处依赖脚本加载顺序）。
   参数走 URL 查询串，所以只生成一个文件：
     single_check.html?s=2&v=pit|wind|spike|flame
   左上角会画一块诊断浮层，把关键数值直接写进截图里 —— 不靠标题栏也能自证。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const single = fs.readFileSync(path.join(root, '..', 'coop-demo.html'), 'utf8');

const scene = `
<div id="diag" style="position:fixed;left:8px;top:8px;z-index:99;padding:8px 10px;
  background:rgba(0,0,0,.82);border:1px solid #4a6a8a;border-radius:4px;
  font:15px/1.5 Consolas,monospace;color:#7fe3ff;white-space:pre;pointer-events:none"></div>
<script>
/* ===== 单文件地形验收脚本（仅测试用，不改原产物） ===== */
(function () {
  var log = [];
  var box = document.getElementById('diag');
  function show(err) {
    box.style.color = err ? '#ff8a8a' : '#7fe3ff';
    box.textContent = log.join('\\n') + (err ? '\\n!! ' + err : '');
  }
  try {
    var q = new URLSearchParams(location.search);
    var STAGE = Number(q.get('s') || 2);
    var VIEW = q.get('v') || 'pit';

    log.push('single-file  stage=' + STAGE + '  view=' + VIEW);

    startStage(STAGE);
    aiPanelOpen = false;
    game.wave = 2;
    game.waveActive = false;
    game.spawnQueue = [];
    enemies.length = 0;
    game.state = 'playing';

    var target = null;
    if (VIEW === 'pit')        target = world.pits[0];
    else if (VIEW === 'wind')  target = world.winds[0];
    else                       target = world.hazards.filter(function (h) { return h.kind === VIEW; })[0]
                                     || world.hazards[0];

    log.push('pits=' + world.pits.length + '  winds=' + world.winds.length + '  haz=' + world.hazards.length);
    log.push('target=' + (target ? target.kind + ' @' + Math.round(target.x) + ' w' + Math.round(target.w) : 'NONE'));
    if (target) {
      log.push('groundAt(center)=' + groundAt(target.x + target.w * 0.5)
             + '  surfaceBelow=' + Math.round(surfaceBelow(target.x + target.w * 0.5, 0)));
    }

    if (target) {
      var cx = target.x + target.w * 0.5;
      var px = cx - 150;
      for (var d = 0; d < 420 && !groundAt(px); d += 6) px -= 6;
      player.x = px; player.y = world.groundY; player.onGround = true; player.vx = 0;
      player.vy = 0; player.plat = null; player.hp = player.maxHp; player.downed = false;
      player.facing = 1; player.aim = 0;
      buddy.x = px - 90; buddy.y = world.groundY; buddy.onGround = true;
      buddy.vx = 0; buddy.vy = 0; buddy.plat = null;
      buddy.cmd = 'hold'; buddy.holdX = buddy.x;
    }
    input.mx = 900; input.my = 300;

    for (var i = 0; i < 4; i++) update(1 / 60);

    if (VIEW === 'pit') {
      player.x = target.x - player.w * 0.5 - 6;
      player.y = world.groundY; player.onGround = true; player.vy = 0;
      buddy.x = player.x - 74; buddy.y = world.groundY; buddy.onGround = true;
    } else if (VIEW === 'wind') {
      player.x = target.x + target.w * 0.5;
      doJump(player);
      for (var j = 0; j < 26; j++) update(1 / 60);
      log.push('气流托举后 player.y=' + Math.round(player.y) + '（平地 600）');
    } else if (VIEW === 'flame') {
      for (var m = 0; m < world.hazards.length; m++) {
        if (world.hazards[m].kind === 'flame') { world.hazards[m].t = world.hazards[m].period - 0.30; world.hazards[m].firing = 1; }
      }
    }
    player.vx = 0; buddy.vx = 0;

    if (target) camera.x = Math.max(0, target.x + target.w * 0.5 - VIEW_W * 0.5);
    camera.shake = 0;
    game.msg = ''; game.msgTimer = 0;
    buddy.bubbleTimer = 0; buddy.bubble = "";
    for (var k = 0; k < texts.length; k++) texts[k].life = 0;

    /* 冻住逻辑，只留渲染 */
    update = function () {};

    log.push('camera.x=' + Math.round(camera.x) + '  playerY=' + Math.round(player.y));
    log.push('airJumps=' + player.airJumps + '/' + player.maxAirJumps
           + '  JUMP_V2=' + JUMP_V2 + '  FALL_DEPTH=' + FALL_DEPTH);
    log.push('pits: ' + world.pits.map(function (p) { return p.kind + '@' + Math.round(p.x) + '+' + Math.round(p.w); }).join('  '));
    log.push('winds: ' + world.winds.map(function (w) { return '@' + Math.round(w.x) + '+' + Math.round(w.w); }).join('  '));
    log.push('player.x=' + Math.round(player.x));

    /* 把目标框出来：单文件环境里最容易出问题的是「渲染层看不到这个物件」，
       一个洋红框就能分清「没画」和「画在别处」 */
    var _render = render;
    render = function () {
      _render();
      if (!target || !q.get('dbg')) return;
      ctx.save();
      ctx.translate(0, CAM_TY);
      ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(target.x - camera.x, world.groundY - 8, target.w, 64);
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(target.kind, target.x - camera.x + 4, world.groundY - 16);
      ctx.restore();
    };

    show(null);
  } catch (e) {
    show(e && (e.message + ' @' + (e.stack || '').split('\\n')[1] || e));
  }
})();
</script>
`;

const out = single.replace('</body>', scene + '</body>');
if (out === single) {
  console.error('注入失败：没找到 </body>');
  process.exit(1);
}
const f = path.join(__dirname, 'single_check.html');
fs.writeFileSync(f, out, 'utf8');
console.log('生成 ' + path.basename(f) + '  ' + Math.round(out.length / 1024) + ' KB');
