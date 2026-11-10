'use strict';

/* ==================================================================
   渲染层 3：HUD / 菜单 / 主循环
   ================================================================== */

function bar(x, y, w, h, ratio, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(x, y, w, h, h / 2);
  ctx.fill();
  const rw = w * clamp(ratio, 0, 1);
  if (rw > 1) {
    ctx.fillStyle = color;
    roundRect(x, y, rw, h, h / 2);
    ctx.fill();
  }
}

function drawHUD() {
  const p = player, b = buddy;

  /* --- 玩家卡片 --- */
  ctx.fillStyle = 'rgba(10,16,22,0.62)';
  roundRect(20, H - 112, 300, 92, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,180,235,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 15px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#8fc4f0';
  ctx.fillText('指挥官（你）', 36, H - 86);

  bar(36, H - 78, 268, 12, p.hp / p.maxHp, p.hp / p.maxHp > 0.35 ? '#4fbf7a' : '#e0553f');
  ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#eaf2f8';
  ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, 46, H - 68);

  const wp = WEAPONS[p.weapon];
  const mag = p.mags[p.weapon];
  ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#e8dcc0';
  ctx.fillText(wp.name, 36, H - 42);

  ctx.textAlign = 'right';
  ctx.font = 'bold 18px Consolas,monospace';
  ctx.fillStyle = p.reloading > 0 ? '#ffb347' : (mag > 0 ? '#f2e6c8' : '#ff5a4a');
  ctx.fillText(p.reloading > 0 ? '装填中' : (mag + ' / ' + wp.mag), 300, H - 40);

  for (let i = 0; i < WEAPONS.length; i++) {
    const sx = 38 + i * 46, sy = H - 30;
    ctx.fillStyle = p.weapon === i ? 'rgba(255,200,110,0.92)' : 'rgba(255,255,255,0.13)';
    roundRect(sx, sy, 42, 16, 4);
    ctx.fill();
    ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = p.weapon === i ? '#1a1208' : '#b9c6d2';
    ctx.fillText((i + 1) + ' ' + ['步枪', '霰弹', '机枪'][i], sx + 21, sy + 12);
  }

  /* --- 八哥卡片 --- */
  ctx.fillStyle = 'rgba(10,16,22,0.62)';
  roundRect(W - 320, H - 112, 300, 92, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,170,80,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 15px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ffb257';
  ctx.fillText('八哥（AI 战友）', W - 304, H - 86);

  bar(W - 304, H - 78, 268, 12, b.hp / b.maxHp, b.hp / b.maxHp > 0.34 ? '#e0a04a' : '#e0553f');
  ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#eaf2f8';
  ctx.fillText(Math.ceil(b.hp) + ' / ' + b.maxHp, W - 296, H - 68);

  const stateText = b.dead ? '阵亡（下波归队）'
    : b.downed ? '倒地！快按住 E 救我'
    : ({ FOLLOW: '跟随', ENGAGE: '交战中', RETREAT: '后撤回血', REVIVE: '赶来救你', HOLD: '守点' }[b.state] || '待命');
  const cmdText = { follow: '跟随', rush: '突击', hold: '守点' }[b.cmd];
  ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ffd7a3';
  ctx.fillText('状态：' + stateText, W - 304, H - 46);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9fb0bf';
  ctx.font = '12px "Microsoft YaHei",sans-serif';
  ctx.fillText('指令 ' + cmdText + '（C/V/B 切换）', W - 36, H - 46);

  ctx.textAlign = 'left';
  ctx.font = '11px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#7d8c99';
  ctx.fillText('G 手雷 · R 换弹 · Shift 冲刺 · E 救八哥 · P 暂停', W - 304, H - 26);

  /* --- 顶部关卡 / 波次 --- */
  ctx.fillStyle = 'rgba(10,16,22,0.55)';
  roundRect(W / 2 - 190, 16, 380, 40, 20);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#e9e2cf';
  ctx.fillText('第 ' + game.stage + ' 关  ·  波次 ' + Math.max(1, game.wave) + ' / ' + game.maxWave, W / 2, 42);

  for (let i = 0; i < game.maxWave; i++) {
    const px = W / 2 - (game.maxWave - 1) * 11 + i * 22;
    ctx.beginPath();
    ctx.arc(px, 66, 4, 0, Math.PI * 2);
    ctx.fillStyle = i < game.wave ? (i === game.maxWave - 1 ? '#ff6b5a' : '#ffc857') : 'rgba(255,255,255,0.2)';
    ctx.fill();
  }

  /* --- 左上信息 --- */
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(233,226,207,0.85)';
  ctx.fillText('击杀 ' + game.kills, 24, 34);
  ctx.fillStyle = 'rgba(255,200,120,0.85)';
  ctx.fillText('得分 ' + game.score, 24, 56);

  const alive = enemies.filter(e => !e.dead).length;
  const pending = game.spawnQueue.filter(s => !s.done).length;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,150,130,0.9)';
  ctx.fillText('剩余敌人 ' + (alive + pending), W - 24, 34);

  /* --- 中央提示 --- */
  if (game.msgTimer > 0) {
    ctx.globalAlpha = Math.min(1, game.msgTimer);
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px "Microsoft YaHei",sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(game.msg, W / 2, 150);
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(game.msg, W / 2, 150);
    ctx.globalAlpha = 1;
  }
}

/* --- 通用遮罩 --- */
function overlay(alpha) {
  ctx.fillStyle = 'rgba(6,10,14,' + alpha + ')';
  ctx.fillRect(0, 0, W, H);
}

function drawTitle() {
  drawBackground();
  overlay(0.62);

  ctx.textAlign = 'center';
  ctx.font = 'bold 76px "Microsoft YaHei",sans-serif';
  const g = ctx.createLinearGradient(0, 120, 0, 200);
  g.addColorStop(0, '#ffd98a');
  g.addColorStop(1, '#e07b3a');
  ctx.fillStyle = g;
  ctx.fillText('战 火 英 雄', W / 2, 190);
  ctx.font = 'bold 20px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#9fb4c4';
  ctx.fillText('双人闯关 · 你 + 八哥 AI 战友', W / 2, 228);

  const lines = [
    ['移动', 'A / D  或  ← →'],
    ['跳跃', '空格 / W'],
    ['瞄准射击', '鼠标瞄准 · 左键开火'],
    ['换枪', '1 步枪   2 霰弹   3 机枪'],
    ['换弹 / 冲刺 / 手雷', 'R / Shift / G'],
    ['救队友', '靠近按住 E'],
    ['指挥八哥', 'C 跟随   V 突击   B 守点'],
    ['暂停', 'P 或 Esc']
  ];
  ctx.font = '16px "Microsoft YaHei",sans-serif';
  for (let i = 0; i < lines.length; i++) {
    const y = 288 + i * 30;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8fa6b6';
    ctx.fillText(lines[i][0], W / 2 - 24, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8f0f6';
    ctx.fillText(lines[i][1], W / 2 + 24, y);
  }

  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = (Math.floor(game.time * 1.6) % 2 === 0) ? '#ffd166' : 'rgba(255,209,102,0.35)';
  ctx.fillText('点击画面 / 按 Enter 开始', W / 2, H - 96);
  ctx.font = '13px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#6e8393';
  ctx.fillText('八哥全自动作战：跟人、打最近的敌人、血少后退、你倒了他会冲过来救', W / 2, H - 62);
}

function drawCenterCard(title, titleColor, sub, tip) {
  overlay(0.6);
  ctx.fillStyle = 'rgba(12,18,24,0.9)';
  roundRect(W / 2 - 280, H / 2 - 140, 560, 280, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,120,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = 'bold 44px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = titleColor;
  ctx.fillText(title, W / 2, H / 2 - 60);

  ctx.font = '17px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#cfdbe4';
  ctx.fillText(sub, W / 2, H / 2 - 10);

  ctx.font = 'bold 18px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = (Math.floor(game.time * 1.6) % 2 === 0) ? '#ffd166' : 'rgba(255,209,102,0.35)';
  ctx.fillText(tip, W / 2, H / 2 + 90);
}

function render() {
  if (game.state === 'title') { drawTitle(); return; }
  if (!player) { drawBackground(); return; }

  ctx.save();
  const sh = camera.shake;
  if (sh > 0.2) ctx.translate(rand(-sh, sh), rand(-sh, sh) * 0.7);

  drawBackground();
  drawPlatforms();
  drawPickups();
  drawGrenades();

  for (const e of enemies) drawEnemy(e);
  if (buddy) drawSoldier(buddy, true);
  if (player) drawSoldier(player, false);

  drawBullets();
  drawEffects();
  ctx.restore();

  drawHUD();

  if (game.state === 'playing') drawCrosshair();
  if (game.state === 'paused') {
    overlay(0.5);
    ctx.textAlign = 'center';
    ctx.font = 'bold 48px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#ffd166';
    ctx.fillText('已暂停', W / 2, H / 2);
    ctx.font = '18px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#b8c8d4';
    ctx.fillText('按 P 或 Esc 继续', W / 2, H / 2 + 44);
  }
  if (game.state === 'stageclear') {
    drawCenterCard('第 ' + game.stage + ' 关 完成', '#7ef0b0',
      '本关击杀 ' + game.kills + '   总得分 ' + game.score,
      '按 Enter 进入第 ' + (game.stage + 1) + ' 关（难度提升）');
  }
  if (game.state === 'gameover') {
    drawCenterCard('任务失败', '#ff6b6b',
      '你在第 ' + game.stage + ' 关第 ' + Math.max(1, game.wave) + ' 波倒下，八哥没能赶上',
      '按 Enter 重新挑战本关');
  }
}

/* ---------------- 主循环 ---------------- */
let _last = performance.now();

function frame(ts) {
  let dt = (ts - _last) / 1000;
  _last = ts;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);

  if (game.state === 'playing') {
    update(dt);
  } else {
    game.time += dt;
    sayCooldown = Math.max(0, sayCooldown - dt);
    if (game.state !== 'title') updateEffects(dt);
  }

  render();
  requestAnimationFrame(frame);
}

resizeCanvas();
requestAnimationFrame(frame);
