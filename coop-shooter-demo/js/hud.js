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

/* ------------------------------------------------------------------
   五角星：结算页 26px、选关卡 10px、档案行 12px 共用一套路径。
   内径取 0.42（标准五角星是 0.382，稍胖一点小尺寸才不糊成一团）。
   ------------------------------------------------------------------ */
function starPath(cx, cy, r) {
  const inner = r * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = (i % 2) ? inner : r;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/* filled=false 走空心描边；glow 只给「点亮」用，别给每个空星都开阴影 */
function drawStar(cx, cy, r, filled, color, glow) {
  starPath(cx, cy, r);
  if (filled) {
    if (glow > 0) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(160,182,198,0.42)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/* 定宽小字：先缩字号，缩到底还放不下就截断加省略号。
   目标名来自 meta 的数据，不能假设它一定是四个字。 */
function drawFitText(text, cx, y, maxW, size, color) {
  let s = size;
  ctx.font = s + 'px ' + UI.font;
  while (ctx.measureText(text).width > maxW && s > 7.5) {
    s -= 0.5;
    ctx.font = s + 'px ' + UI.font;
  }
  let t = String(text);
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(t, cx, y);
}

/* 弹性放大：0→1 的过程中略微冲过头再落回，用来做「一颗颗亮起来」 */
function easeBack(k) {
  const c = 1.70158;
  const t = k - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

/* ---- 三星 / 改装：全部跨模块取值，缺函数时一律降级，不许抛 ---- */
function hudStageStars(stage) {
  const s = (typeof SAVE !== 'undefined' && SAVE && SAVE.stars) ? SAVE.stars[stage] : null;
  return { clear: !!(s && s.clear), time: !!(s && s.time), hp: !!(s && s.hp) };
}
function hudWeaponLv(id) {
  if (typeof weaponLv !== 'function') return 0;
  return clamp(Math.round(+weaponLv(id) || 0), 0, 3);
}
function hudWeaponStat(id, key, fallback) {
  if (typeof wStat !== 'function') return fallback;
  const v = wStat(id, key);
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
}

function drawHUD() {
  const p = player, b = buddy;

  /* 低血脉动压在最底层：它要在战场之上、所有 HUD 元素之下。
     中间留空（准星与角色都在画面中心），只压画面四周一圈。 */
  drawLowHpVignette();

  /* --- 玩家卡片 ---
     92 → 104 高：原来武器槽（slotY=H-31，高 17）底边落在 H-14，
     比卡片底边 H-20 低 6px，两个胶囊是**挂在框外面**的 —— 3 倍放大一眼就看见。
     整卡向上长 12px，底边仍在 H-20，和右下角大肥鱼卡对齐。

     不透明度 0.62 → 0.82：战场底下什么都有，第 3 关那条黄黑警示条正好横穿
     卡片中段，62% 的底压不住它，从血条后面透出来的一道道斜纹把
     「170 / 170」的读数搅成一团。状态卡是读数区，宁可挡死背景。 */
  ctx.fillStyle = 'rgba(10,16,22,0.82)';
  roundRect(20, H - 124, 300, 104, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,180,235,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const cdef = charDef(SAVE.charId);
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#8fc4f0';
  ctx.fillText('指挥官 · ' + cdef.name, 36, H - 98);

  /* 等级徽记常驻：升级发生在击杀瞬间（不是打完一关），
     玩家必须能在 HUD 上一眼看到「我几级了」，否则那串飘字白放 */
  ctx.textAlign = 'right';
  ctx.font = 'bold 13px Consolas,monospace';
  ctx.fillStyle = '#ffd166';
  ctx.fillText('Lv.' + game.level, 300, H - 98);

  /* 血条宽度 268 → 200：右边那 68px 是留给「护甲 N%」的。
     原来血条铺满到 304，护甲文字右对齐到 300，整串字直接压在血条尾巴上 ——
     两个数字叠在一起，谁都读不出。血条短一点，两条成长曲线才能并排站。 */
  bar(36, H - 90, 200, 12, p.hp / p.maxHp, p.hp / p.maxHp > 0.35 ? '#4fbf7a' : '#e0553f');
  /* 读数压在血条上：白字配中绿（#4fbf7a）只有 2.4:1，血量越低条越红越糊。
     给字号描一圈暗影，不换颜色也不挪位置，任何条色上都读得出来。 */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#eaf2f8';
  ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, 46, H - 80);
  ctx.restore();

  /* 护甲：等级成长的第二条曲线。不写出来，玩家只会觉得「怪好像变软了」。
     字体必须显式给：上面那段读数用 save/restore 包着，restore 之后
     字号退回的是更早那句 'bold 13px Consolas,monospace' —— Consolas 没有中文字形，
     「护甲」两个字会掉成两个豆腐块，而同行的 「16%」 是数字照常显示，
     于是一眼看过去像「[] [] 16%」。（浏览器里会吃到系统兜底字体，反而看不出来；
     离屏截图用的是真 2D context，才把这个隐患逼出来。） */
  if ((p.armor || 0) > 0.001) {
    ctx.textAlign = 'right';
    ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#9fd8ff';
    ctx.fillText('护甲 ' + Math.round(p.armor * 100) + '%', 300, H - 80);
  }

  /* 低血心跳：贴着血条尾巴闪，位置在 236（血条右端）与 255（护甲文字左缘）
     之间那 19px 的空隙里 —— 血条和护甲都还在原位，不用为它挪别的元素。 */
  if (p.hp / p.maxHp < 0.30 && !p.dead) {
    const beat = 0.5 + 0.5 * Math.sin(game.time * 5);
    drawHeart(243, H - 84, 8.5 * (1 + 0.14 * beat),
      'rgba(255,90,74,' + (0.55 + 0.45 * beat).toFixed(3) + ')');
  }

  const wp = WEAPONS[p.weapon];
  const mag = p.mags[p.weapon];
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#e8dcc0';
  ctx.fillText(wp.name, 36, H - 54);

  /* 射程：写在武器名右边，用 px 和战术面板保持同一单位。
     这是「枪与枪的区别」里最该被看见的一项 —— 不写出来，
     玩家只会觉得「这把枪怎么打不着」，而不会想到「这是它的设计」。 */
  if (wp.range > 0) {
    const nameW = ctx.measureText(wp.name).width;
    ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(150,190,220,0.80)';
    ctx.fillText('射程 ' + wp.range, 36 + nameW + 9, H - 54);
  }

  ctx.textAlign = 'right';
  ctx.font = 'bold 18px Consolas,monospace';
  ctx.fillStyle = p.reloading > 0 ? '#ffb347' : (mag > 0 ? '#f2e6c8' : '#ff5a4a');
  /* 分母必须走 magSize()，不能直接用 wp.mag：
     干员的 magMul 会改真实弹匣（大肥鱼天赋 / 干员乘区），
     直接用底数会画出「9 / 5」这种自相矛盾的读数。 */
  ctx.fillText(p.reloading > 0 ? '装填中' : (mag + ' / ' + magSize(p, p.weapon)), 300, H - 52);

  /* 武器槽：只有两格 —— 主武器 / 副武器。
     格子里写的是「这个槽装的是哪把」，而不是「一共有几把枪」：
     这一关只能带两把，HUD 再列 5 格就是在骗玩家。
     装备关系读的是 SAVE（元层），弹药读的是 p.mags（战斗层）。 */
  const slotW = 74, slotGap = 6, slotY = H - 43;
  const slots = [['1', 'primary'], ['2', 'secondary']];
  for (let i = 0; i < slots.length; i++) {
    const sx = 38 + i * (slotW + slotGap);
    const wid = SAVE[slots[i][1]];
    const idx = wid ? weaponById(wid) : -1;
    const empty = idx < 0;
    const on = !empty && p.weapon === idx;
    ctx.fillStyle = on ? 'rgba(255,200,110,0.92)'
      : (empty ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.13)');
    roundRect(sx, slotY, slotW, 17, 4);
    ctx.fill();
    if (!on) {
      ctx.strokeStyle = empty ? 'rgba(255,255,255,0.10)'
        : (p.mags[idx] > 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,90,74,0.36)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.font = 'bold 9.5px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? '#1a1208'
      : (empty ? '#5a646e' : (p.mags[idx] > 0 ? '#b9c6d2' : '#7a6a5a'));
    ctx.fillText(slots[i][0] + ' ' + (empty ? '空槽' : WEAPONS[idx].short), sx + slotW / 2, slotY + 12.5);
  }
  ctx.textAlign = 'right';
  ctx.font = '9.5px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#8b9aa6';
  ctx.fillText('X 快切', 300, slotY + 12.5);

  /* --- 大肥鱼卡片 --- */
  /* 卡片高度 92 → 132，改成「一项一行」：
     ① 底部按键提示原来一行约 580px，可用宽度只有 268px，必须拆两行；
     ② 「状态：交战中」和右对齐的「性格 均衡（Q）…」在 268px 里也放不下，实测从中间互相压字。
     下面所有基线都是从 H-20（卡片底边）往上推的，改动时整组一起动。 */
  /* 0.62 → 0.82，同玩家卡：这张卡的条形血条正好压在关卡的黄黑警示条上，
     半透明底会让底下的斜纹穿条而过。 */
  ctx.fillStyle = 'rgba(10,16,22,0.82)';
  roundRect(W - 320, H - 152, 300, 132, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,170,80,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 15px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ffb257';
  ctx.fillText('大肥鱼（AI 战友）', W - 304, H - 126);

  bar(W - 304, H - 118, 268, 12, b.hp / b.maxHp, b.hp / b.maxHp > 0.34 ? '#e0a04a' : '#e0553f');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 3;
  ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#eaf2f8';
  ctx.fillText(Math.ceil(b.hp) + ' / ' + b.maxHp, W - 296, H - 108);
  ctx.restore();

  const stateText = b.dead ? '阵亡（下波归队）'
    : b.downed ? '倒地！快按住 E 救我'
    : ({ FOLLOW: '跟随', ENGAGE: '交战中', RETREAT: '后撤回血', REVIVE: '赶来救你', HOLD: '守点', GRAB: '去捡补给' }[b.intent] || '待命');
  const cmdText = { follow: '跟随', rush: '突击', hold: '守点' }[b.cmd];
  const styleText = (typeof BUDDY_STYLES !== 'undefined' && BUDDY_STYLES[b.style]) ? BUDDY_STYLES[b.style].name : '均衡';
  ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ffd7a3';
  ctx.fillText('状态：' + stateText, W - 304, H - 84);

  ctx.font = '12px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#9fb0bf';
  ctx.fillText('性格 ' + styleText + '（Q）·  指令 ' + cmdText + '（C / V / B）', W - 304, H - 64);

  /* 两行按键提示：右对齐 + 自动缩字号兜底，文案以后再长也不会冲出画布 */
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7d8c99';
  const hints = ['G 手雷 · R 换弹 · S 蹲下 · Z 趴下 · M 静音',
                 'Shift 冲刺 · 空格 二段跳 · E 救大肥鱼 · P 暂停'];
  hints.forEach(function (line, i) {
    let hf = 11;
    ctx.font = hf + 'px "Microsoft YaHei",sans-serif';
    while (ctx.measureText(line).width > 268 && hf > 8.5) {
      hf -= 0.5;
      ctx.font = hf + 'px "Microsoft YaHei",sans-serif';
    }
    /* 基线从 H-42 上提到 H-46：最后一行原来贴到卡片下边框只剩 3px，
       11px 字的降部几乎压线，卡片看起来像「框切字」。 */
    ctx.fillText(line, W - 36, H - 46 + i * 16);
  });

  /* --- 顶部关卡 / 波次 --- */
  const th = world.theme;
  ctx.fillStyle = 'rgba(10,16,22,0.55)';
  roundRect(W / 2 - 190, 16, 380, 40, 20);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#e9e2cf';
  ctx.fillText('第 ' + game.stage + ' 关  ·  波次 ' + Math.max(1, game.wave) + ' / ' + game.maxWave, W / 2, 42);
  if (th && th.name) {
    ctx.font = '12px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(233,226,207,0.62)';
    ctx.fillText(th.name, W / 2, 55);
  }

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

  /* --- 中央提示 ---
     BOSS 入场横幅自己会喊「敌方重装单位接近」，这时候再叠一句波次提示
     两行字会撞在一起，所以横幅期间让路。 */
  if (game.msgTimer > 0 && !game.bossIntro) {
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

  /* 演出层：受击方向贴边、连杀读数。都画在 HUD 元素之后、准星之前，
     所以既盖不住准星，也不会被左侧卡片吃掉。 */
  drawTutorialCard();
  drawHurtEdge();
  drawCombo();
}

/* ==================================================================
   新手引导卡（game.tutorialT 驱动）
   ------------------------------------------------------------------
   位置挑在 60%~78% 高度这一条带：脚下是地面（角色头顶约在 79%），
   上面是准星常驻区，620×92 的卡片正好卡在两不管的空档里。
   卡片自己不持有计时器 —— tutorialT 由 game.js 每秒衰减，
   淡入用「已经过了多久」反推，淡出用「还剩多久」，两边都对得上。
   ================================================================== */
const TUTORIAL_ITEMS = [
  ['A D', '移动'], ['鼠标', '瞄准射击'], ['空格', '二段跳'],
  ['S / Z', '蹲下 / 趴下'], ['R', '换弹'], ['C V B', '指挥队友']
];

function drawTutorialCard() {
  const t = game.tutorialT || 0;
  if (t <= 0) return;
  if (game.state !== 'playing') return;   // 暂停/结算时不要贴在卡片上

  /* 进来 0.3s 淡入（9-t 就是已存在的时间），剩 1s 淡出 */
  const a = Math.min(1, (9 - t) / 0.3) * Math.min(1, t);
  if (a <= 0.01) return;

  const W2 = 620, H2 = 92;
  const x = (W - W2) / 2;
  const y = H * 0.60 - (1 - Math.min(1, (9 - t) / 0.3)) * 10;

  ctx.save();
  ctx.globalAlpha = a;

  /* 玻璃卡：底色比菜单面板淡一档，战斗中不能抢视线 */
  ctx.fillStyle = 'rgba(10,16,22,0.72)';
  roundRect(x, y, W2, H2, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255,209,102,0.30)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  /* 顶部一条金色细线，和选中的菜单卡同一个语汇 */
  ctx.fillStyle = 'rgba(255,209,102,0.55)';
  ctx.fillRect(x + W2 / 2 - 40, y, 80, 2);

  ctx.textAlign = 'right';
  ctx.font = '11px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.75)';
  ctx.fillText('继续战斗即消失', x + W2 - 18, y + 20);

  /* 两行三列：列宽 = (620 - 2×24) / 3，行基线 46 / 74 */
  const colW = (W2 - 48) / 3;
  for (let i = 0; i < TUTORIAL_ITEMS.length; i++) {
    const col = i % 3, row = (i / 3) | 0;
    const bx = x + 24 + col * colW;
    const by = y + 30 + row * 30;
    const [key, label] = TUTORIAL_ITEMS[i];

    /* 键帽：深底 + 细边，金字的宽度就是键帽宽度 */
    ctx.font = 'bold 11px ' + UI.font;
    const kw = ctx.measureText(key).width + 14;
    ctx.fillStyle = 'rgba(255,209,102,0.10)';
    roundRect(bx, by, kw, 19, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.34)';
    ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.fillText(key, bx + kw / 2, by + 13.5);

    ctx.textAlign = 'left';
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = '#b9c9d6';
    ctx.fillText(label, bx + kw + 8, by + 13.5);
  }

  ctx.restore();
}

/* ==================================================================
   BOSS 专属血条
   顶部一条长血条 + 名字 + 称号。掉落时有一条「残影」慢慢追下来，
   打空的瞬间能看出这一枪削掉多少血 —— 普通怪的小血条做不到这个。
   ================================================================== */
let bossBarShown = 1;    /* 当前显示的血量比例（平滑追随） */
let bossBarGhost = 1;    /* 白色残影（慢慢追下来） */
let bossBarKey = '';     /* 换 BOSS 时重置 */

const BOSS_ACCENT = {
  red: { a: '#ff7a5a', b: '#b8231f', glow: 'rgba(255,90,60,0.55)' },
  fire: { a: '#ffb066', b: '#a8420c', glow: 'rgba(255,150,50,0.55)' },
  steel: { a: '#9fd8ff', b: '#2b5871', glow: 'rgba(120,200,255,0.5)' }
};

function drawBossBar() {
  const dt = _dt;
  const boss = enemies.find(e => e.boss && !e.dead);
  const intro = game.bossIntro;

  if (!boss && !intro) {
    bossBarShown = bossBarGhost = 1;
    bossBarKey = '';
    return;
  }

  const name = boss ? (boss.name || '重装单位') : intro.name;
  const tag = boss ? (ENEMY_TYPES[boss.type].title || '') : (intro.tag || '');
  const accent = BOSS_ACCENT[(boss ? boss.accent : intro.accent) || 'red'] || BOSS_ACCENT.red;
  const key = name + '|' + tag;
  if (bossBarKey !== key) { bossBarKey = key; bossBarShown = bossBarGhost = 1; }

  const ratio = boss ? clamp(boss.hp / boss.maxHp, 0, 1) : 1;
  /* 入场时血条从 0 涨满，给一个「正在抵达战场」的仪式感 */
  const rise = boss ? 1 : clamp((intro ? intro.t : 0) / 0.7, 0, 1);

  bossBarShown += (ratio - bossBarShown) * Math.min(1, dt * 9);
  bossBarGhost = bossBarGhost > bossBarShown
    ? Math.max(bossBarShown, bossBarGhost - dt * 0.42)
    : bossBarShown;

  /* 宽度 440 是被左侧战术面板「挤」出来的：
     面板占 x 20~392（展开态 372 宽），底板左缘必须 ≥ 392 才不压字。
     520 宽时底板左缘 = 640-260-8 = 372，会和面板重叠 20px，
     名字头两个字正好落在面板背景上。440 宽时底板 412~868，
     左右留白对称，且最长的「钢铁典狱长」+ 称号也排得下。 */
  const bw = 440, bh = 15;
  /* y 位置要让开顶部的关卡药丸（16~56）和波次圆点（66），否则会压住主题名 */
  const bx = W / 2 - bw / 2, by = 106;
  const appear = boss ? 1 : clamp((intro ? intro.t : 0) / 0.35, 0, 1);

  ctx.save();
  ctx.globalAlpha = appear;

  /* 外框底板 */
  ctx.fillStyle = 'rgba(8,12,16,0.78)';
  roundRect(bx - 8, by - 26, bw + 16, 58, 9);
  ctx.fill();
  ctx.strokeStyle = accent.glow;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* 名字 + 称号 */
  ctx.textAlign = 'left';
  ctx.font = 'bold 17px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = accent.a;
  ctx.fillText(name, bx, by - 10);
  if (tag) {
    const nw = ctx.measureText(name).width;
    ctx.font = '11px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(210,220,230,0.6)';
    ctx.fillText(tag, bx + nw + 10, by - 10);
  }
  ctx.textAlign = 'right';
  ctx.font = 'bold 11px Consolas,monospace';
  ctx.fillStyle = 'rgba(230,238,245,0.72)';
  ctx.fillText(Math.ceil(ratio * 100) + '%', bx + bw, by - 10);

  /* 血槽 */
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(bx, by, bw, bh, bh / 2);
  ctx.fill();

  /* 残影：宽一圈的浅色，被血量追着走 */
  if (bossBarGhost > bossBarShown + 0.001) {
    ctx.fillStyle = 'rgba(255,235,210,0.42)';
    roundRect(bx, by, bw * bossBarGhost * rise, bh, bh / 2);
    ctx.fill();
  }

  /* 主体血条 */
  const w2 = bw * bossBarShown * rise;
  if (w2 > 1) {
    const g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, accent.a);
    g.addColorStop(0.55, accent.b);
    g.addColorStop(1, accent.a);
    ctx.fillStyle = g;
    roundRect(bx, by, w2, bh, bh / 2);
    ctx.fill();
    /* 顶部高光 */
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(bx + 2, by + 2, Math.max(0, w2 - 4), 3.5, 2);
    ctx.fill();
  }

  /* 分段刻度：把长血条切成 10 段，读血更直观 */
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 10; i++) {
    const sx = bx + (bw / 10) * i;
    ctx.beginPath();
    ctx.moveTo(sx, by + 1);
    ctx.lineTo(sx, by + bh - 1);
    ctx.stroke();
  }
  ctx.restore();
}

/* ==================================================================
   BOSS 入场横幅：两道斜切光带夹住名字，从两侧收拢
   ================================================================== */
function drawBossIntro() {
  const bi = game.bossIntro;
  if (!bi) return;

  const p = bi.t / bi.dur;
  /* 0→0.14 推进场，0.14→0.78 停留，之后淡出 */
  const inK = clamp(p / 0.14, 0, 1);
  const outK = clamp((p - 0.82) / 0.18, 0, 1);
  const alpha = inK * (1 - outK);
  const slide = (1 - inK) * 180 + outK * 90;
  const accent = BOSS_ACCENT[bi.accent] || BOSS_ACCENT.red;

  /* 纵向栈（自上而下）：警告 162 / 光带 178 / 名字 234 / 称号 266 / 光带 278
     每个元素都算好占位，光带只夹在名字外面的空隙里，不压字。 */
  const cy = 224;

  ctx.save();
  ctx.globalAlpha = alpha;

  /* 两条斜切光带：从中间向两侧展开，夹住名字。
     用加色混合，光带才会「亮」而不是画一条深色横杠。 */
  const bandW = (W / 2 + 120) * inK;
  const drawBand = (top) => {
    ctx.beginPath();
    ctx.moveTo(W / 2 - bandW, cy + top);
    ctx.lineTo(W / 2 + bandW, cy + top - 8);
    ctx.lineTo(W / 2 + bandW, cy + top + 6);
    ctx.lineTo(W / 2 - bandW, cy + top + 14);
    ctx.closePath();
    const g = ctx.createLinearGradient(W / 2 - bandW, 0, W / 2 + bandW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.16, accent.glow);
    g.addColorStop(0.5, 'rgba(255,138,96,0.95)');
    g.addColorStop(0.84, accent.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fill();
  };
  ctx.globalCompositeOperation = 'lighter';
  drawBand(-46);
  drawBand(54);

  /* 光带边缘补一条细亮线，让斜切更有金属感 */
  ctx.strokeStyle = accent.a;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = alpha * 0.75;
  for (const top of [-46, 60]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 - bandW, cy + top);
    ctx.lineTo(W / 2 + bandW, cy + top - 8);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;

  /* 名字：大字 + 描边阴影 */
  ctx.textAlign = 'center';
  ctx.font = 'bold 46px "Microsoft YaHei",sans-serif';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.72)';
  ctx.strokeText(bi.name, W / 2 - slide * 0.4, cy + 10);
  ctx.fillStyle = '#fff4e2';
  ctx.fillText(bi.name, W / 2 - slide * 0.4, cy + 10);

  /* 称号 */
  ctx.font = 'bold 15px "Microsoft YaHei",sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(bi.tag, W / 2 + slide * 0.4, cy + 42);
  ctx.fillStyle = accent.a;
  ctx.fillText(bi.tag, W / 2 + slide * 0.4, cy + 42);

  /* 顶部小字：警告 */
  const blink = 0.55 + 0.45 * Math.sin(bi.t * 14);
  ctx.globalAlpha = alpha * blink;
  ctx.font = 'bold 12px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ff6b5a';
  ctx.fillText('▲  敌 方 重 装 单 位 接 近  ▲', W / 2, cy - 62);

  ctx.restore();
}

/* ==================================================================
   全屏白闪（BOSS 击破 / 入场共用）
   ================================================================== */
function drawScreenFlash() {
  const f = game.screenFlash || 0;
  if (f <= 0.001) return;
  ctx.fillStyle = 'rgba(255,244,228,' + (clamp(f, 0, 1) * 0.62).toFixed(3) + ')';
  ctx.fillRect(0, 0, W, H);
}

/* ==================================================================
   大肥鱼战术面板：把他的思考过程真的画出来（Tab 收起 / 展开）
   ================================================================== */
const INTENT_COLOR = {
  ENGAGE: '#ff9a5c', RETREAT: '#e0553f', REVIVE: '#7ef0b0',
  GRAB: '#6fc2ff', FOLLOW: '#a8bccb', HOLD: '#ffd166'
};

function drawAIPanel() {
  const b = buddy;
  if (!b) return;

  /* Tab 的开关归 game.js 管，这里只读 —— hud.js 里绝不能给 aiPanelOpen 赋值，
     否则两边同时写，按一次 Tab 会连翻两下。 */
  const open = (typeof aiPanelOpen !== 'undefined') ? aiPanelOpen : false;

  const x = 20, y = 76;
  const t = game.tele || {};
  const acc = t.buddyShots > 0 ? Math.min(100, Math.round(t.buddyHits / t.buddyShots * 100)) : 0;
  const intent = b.dead ? '阵亡' : (b.downed ? '倒地' : (INTENT_NAMES[b.intent] || '待命'));
  const icolor = b.dead || b.downed ? '#e0553f' : (INTENT_COLOR[b.intent] || '#a8bccb');

  /* --- 折叠态：232×30 的玻璃胶囊，一行读完「谁 · 什么指令 · 什么姿态」 ---
     默认就该是这个状态：战斗中玩家需要的是视野，不是大肥鱼的思考过程。
     想看过程按 Tab，展开态下面那段照旧。 */
  if (!open) {
    const cw = 232, ch = 30;
    const cmd = { follow: '跟随', rush: '突击', hold: '守点' }[b.cmd] || '跟随';
    const prone = proneK(b), crouch = cqEff(b);
    const stance = b.dead ? '阵亡'
      : b.downed ? '倒地呼救'
      : prone > 0.5 ? '压枪稳定'
      : prone > 0.15 ? '正在卧倒'
      : crouch > 0.5 ? '压低身位'
      : crouch > 0.15 ? '正在下蹲'
      : '站立';
    const stanceColor = (b.dead || b.downed) ? '#e0553f'
      : (prone > 0.15 || crouch > 0.15 ? '#9fd8ff' : '#8fa6b6');

    ctx.fillStyle = 'rgba(10,16,22,0.60)';
    roundRect(x, y, cw, ch, ch / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,80,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 分段上色：名字金、指令灰白、姿态按姿态着色。
       整行宽度先量再缩字号（唯一的长句是「大肥鱼 · 突击 · 正在卧倒」），
       宁可小半号，也不许压到右边的 Tab 键帽上。 */
    const segs = [
      ['大肥鱼', '#ffb257'],
      [' · ', '#4e6070'],
      [cmd, '#cfdbe4'],
      [' · ', '#4e6070'],
      [stance, stanceColor]
    ];
    const maxW = cw - 54;
    let fs = 11;
    const widthOf = () => {
      ctx.font = 'bold ' + fs + 'px "Microsoft YaHei",sans-serif';
      let sum = 0;
      for (let i = 0; i < segs.length; i++) sum += ctx.measureText(segs[i][0]).width;
      return sum;
    };
    while (widthOf() > maxW && fs > 8.5) fs -= 0.5;

    ctx.textAlign = 'left';
    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei",sans-serif';
    let tx = x + 12;
    for (let i = 0; i < segs.length; i++) {
      ctx.fillStyle = segs[i][1];
      ctx.fillText(segs[i][0], tx, y + 19.5);
      tx += ctx.measureText(segs[i][0]).width;
    }

    /* Tab 键帽：提示「这里还能展开」，但用键帽形状压低存在感 */
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(x + cw - 38, y + 8, 28, 14, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '9px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#6b7d8b';
    ctx.fillText('Tab', x + cw - 24, y + 18.5);
    return;
  }

  const threat = b.dead || b.downed ? { count: 0 } : scanIncoming(b, 0.45);
  const tg = b.target;
  const logs = b.log.slice(-3);
  /* 展开态收窄到 300：底部两张卡（左下 320 / 右下 300）已经占了横向，
     面板再宽就伸进战场中央。收窄靠两件事补回来 —— 行距 20→18、alpha 0.82。 */
  const w = 300, rowH = 18, logH = 16;
  const h = 42 + rowH * 5 + 15 + logH * Math.max(1, logs.length) + 12;

  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(9,14,19,0.92)';
  roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,170,80,0.26)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  /* 标题栏 */
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#ffb257';
  ctx.fillText('大肥鱼 · 战术面板', x + 12, y + 19);
  ctx.textAlign = 'right';
  ctx.font = '10px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#64798a';
  ctx.fillText('决策 ' + (t.decisions || 0) + ' · Tab 收起', x + w - 12, y + 19);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(x + 10, y + 26);
  ctx.lineTo(x + w - 10, y + 26);
  ctx.stroke();

  /* 收窄之后值列只剩 224px：「重机枪兵　距 320px　剩 84HP」这类长串放不下。
     先降字号到 9，再截断 —— 截断是下策，但它只作用在本来就多余的尾数上。 */
  const fit = (text, maxW, size) => {
    let s = size;
    ctx.font = 'bold ' + s + 'px "Microsoft YaHei",sans-serif';
    if (ctx.measureText(text).width <= maxW) return text;
    while (s > 9 && ctx.measureText(text).width > maxW) {
      s -= 0.5;
      ctx.font = 'bold ' + s + 'px "Microsoft YaHei",sans-serif';
    }
    let out = text;
    while (out.length > 4 && ctx.measureText(out).width > maxW) {
      out = out.slice(0, -2) + '…';
    }
    return out;
  };

  let ly = y + 42;
  const line = (label, value, color) => {
    ctx.textAlign = 'left';
    ctx.font = '10px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#6e8393';
    ctx.fillText(label, x + 12, ly);
    const v = fit(value, w - 76, 12);
    ctx.fillStyle = color || '#dfe9f1';
    ctx.fillText(v, x + 64, ly);
    ly += rowH;
  };

  line('当前意图', intent + (b.reason ? '　' + b.reason : ''), icolor);

  line('锁定目标', tg
    ? (ENEMY_TYPES[tg.type].name + '　' + Math.round(Math.abs(tg.x - b.x)) + 'px　' + Math.round(tg.hp) + 'HP')
    : '（视野内无敌人）', tg ? '#ffd7a3' : '#7d8c99');

  line('弹药武器', WEAPONS[b.weapon].name + (b.reloading > 0 ? '　装填中' : '　' + b.mags[b.weapon] + ' 发'),
    b.reloading > 0 ? '#ffb347' : '#dfe9f1');

  line('弹道预警', threat.count > 0
    ? ('▲ ' + threat.count + ' 发来袭（' + threat.minT.toFixed(2) + 's）')
    : '无来袭弹道', threat.count > 0 ? '#ff6b5a' : '#6f8a7d');

  line('本关战绩', '命中 ' + acc + '%　伤害 ' + Math.round(t.buddyDmg) + '　击杀 ' + t.buddyKills,
    acc >= 45 ? '#7ef0b0' : '#dfe9f1');

  /* 决策日志 */
  ctx.textAlign = 'left';
  ctx.font = '10px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#5d7183';
  ctx.fillText('决策日志  躲弹 ' + (t.dodges || 0) + ' · 手雷 ' + (t.grenades || 0), x + 12, ly - 3);
  ly += 15;

  for (let i = 0; i < logs.length; i++) {
    const e = logs[i];
    ctx.textAlign = 'left';
    ctx.font = '10px Consolas,monospace';
    ctx.fillStyle = '#4f6272';
    ctx.fillText(e.t.toFixed(1) + 's', x + 12, ly);
    ctx.font = '11px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = i === logs.length - 1 ? '#c8d6e0' : '#7e90a0';
    ctx.fillText(e.text.length > 22 ? e.text.slice(0, 22) + '…' : e.text, x + 50, ly);
    ly += logH;
  }
}

/* ==================================================================
   战斗演出层：低血 / 受击方向 / 连杀 / 换弹环
   ------------------------------------------------------------------
   这一层的三个原则：
   ① 全部只读 game 上的字段，读的时候一律 (game.x || 0)；
   ② 一律不画在画面正中 —— 准星和角色在那里；
   ③ 恒定强度来自数据，不新增任何计时器字段（comboTimer 除外，它是已有的）。
   ================================================================== */

/* 小血滴/心跳：一个 12px 的心形，只出现在低血时 */
function drawHeart(x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 0.36);
  ctx.bezierCurveTo(-0.66, -0.12, -0.38, -0.76, 0, -0.38);
  ctx.bezierCurveTo(0.38, -0.76, 0.66, -0.12, 0, 0.36);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/* 低血警告：画面四周一圈暗红脉动。
   用径向渐变从中心透明过渡到边缘暗红，中心 34% 半径完全干净 ——
   准星、角色、脚下的地都在那个范围里，警告不会盖住任何要瞄准的东西。 */
function drawLowHpVignette() {
  const p = player;
  if (!p || p.dead) return;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  if (ratio >= 0.30) return;

  /* 0.10 ~ 0.22 之间随 5Hz 正弦呼吸：够明显，但不至于让人看不清边角的地形 */
  const pulse = 0.16 + 0.06 * Math.sin(game.time * 5);
  /* 越接近死亡越浓：30% 时只到 0.6，10% 以下拉满 */
  const k = clamp((0.30 - ratio) / 0.20, 0, 1);
  const a = pulse * (0.62 + 0.38 * k);

  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.92);
  g.addColorStop(0, 'rgba(120,12,8,0)');
  g.addColorStop(0.55, 'rgba(130,14,10,' + (a * 0.42).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(150,16,10,' + a.toFixed(3) + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* 受击方向：从挨打的那一侧贴边压进来一道弧形红晕。
   形状用「横向压扁的径向渐变」做 —— 圆心放在屏幕外的边线中点上，
   横向半径 90px、纵向接近整屏，天然是一道中段浓、上下收淡的弧。
   强度契约是 alpha = hurtFx * 0.55，不往上加，只把色相提亮、把
   纵向拉满，让同一份 alpha 在橙红战场上也有对比度。 */
function drawHurtEdge() {
  const dir = game.hurtDir || 0;
  const fx = clamp(game.hurtFx || 0, 0, 1);
  if (dir === 0 || fx <= 0.002) return;

  const a = fx * 0.55;
  const right = dir > 0;
  const edgeX = right ? W : 0;
  const R = 400;              /* 渐变的基准半径，缩放前 */
  const band = 90;            /* 向内 90px 渐隐 */
  const ry = H * 0.95;        /* 纵向拉到几乎整屏：上中下三段都盖得住 */

  ctx.save();
  /* 只在这一侧 110px 里画，其余裁掉 —— 免得渐变尾巴扫到画面中间 */
  ctx.beginPath();
  ctx.rect(right ? W - 110 : 0, 0, 110, H);
  ctx.clip();

  /* 主层：压扁的椭圆。缩放比把横半径收到 90、纵半径拉到 684，
     所以离边 90px 处淡到 0，而纵向在 y=0 / y=H 仍有 ~0.5 的浓度。 */
  ctx.translate(edgeX, H / 2);
  ctx.scale(band / R, ry / R);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, 'rgba(255,74,50,' + a.toFixed(3) + ')');
  g.addColorStop(0.32, 'rgba(238,56,34,' + (a * 0.74).toFixed(3) + ')');
  g.addColorStop(0.70, 'rgba(200,36,24,' + (a * 0.28).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(170,32,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();

  /* 第二层：最外侧 24px 一道亮刃（lighter 叠色）。
     主层是「一片红」，这一层才是「刚被打了」的锐利感；
     没有它，红晕在暖色战场上会被背景吃掉。 */
  ctx.save();
  ctx.beginPath();
  ctx.rect(right ? W - 24 : 0, 0, 24, H);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createLinearGradient(right ? W : 0, 0, right ? W - 24 : 24, 0);
  lg.addColorStop(0, 'rgba(255,104,70,' + (a * 0.55).toFixed(3) + ')');
  lg.addColorStop(1, 'rgba(255,104,70,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(right ? W - 24 : 0, 0, 24, H);
  ctx.restore();
}

/* 连杀：x5 大字 + 细条窗口。
   位置在波次药丸（16~72）与波次标题（150）之间那一段空白里；
   BOSS 血条（80~138）出现时整组下移到 176，两个都不压。 */
function drawCombo() {
  const combo = game.combo || 0;
  if (combo < 2) return;
  /* BOSS 入场横幅自己就是一场演出，连杀让路 —— 和波次提示同一条规矩 */
  if (game.bossIntro) return;

  const total = 2.6;
  const timer = clamp(game.comboTimer || 0, 0, total);
  /* 每加一次连杀，comboTimer 都被重置回 2.6：用它反推「刚加多久」，
     0~200ms 内从 1.15 弹回 1.0。不再单开一个计时器字段。 */
  const since = total - timer;
  const pop = 1 + 0.15 * Math.pow(clamp(1 - since / 0.2, 0, 1), 2);

  const hot = combo >= 8;
  const col = hot ? '#ff8a4c' : '#ffd166';
  const alpha = timer < 0.6 ? clamp(timer / 0.6, 0, 1) : 1;

  const bossOn = (typeof enemies !== 'undefined') && enemies.some(e => e.boss && !e.dead);
  const cy = bossOn ? 176 : 104;

  const numTxt = 'x' + combo;
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = 'bold 34px Consolas,monospace';
  const nw = ctx.measureText(numTxt).width;
  ctx.font = 'bold 12px "Microsoft YaHei",sans-serif';
  const lw = ctx.measureText('连杀').width;
  const gap = 7;
  const gx = W / 2 - (nw + gap + lw) / 2;

  /* 缩放锚在整组中心：弹一下不会让字「从右边长出来」 */
  ctx.translate(W / 2, cy);
  ctx.scale(pop, pop);
  ctx.translate(-W / 2, -cy);

  ctx.textAlign = 'left';
  ctx.font = 'bold 34px Consolas,monospace';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(numTxt, gx, cy);
  if (hot) {
    ctx.shadowColor = 'rgba(255,120,50,0.9)';
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = col;
  ctx.fillText(numTxt, gx, cy);
  ctx.shadowBlur = 0;

  ctx.font = 'bold 12px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = hot ? 'rgba(255,170,120,0.95)' : 'rgba(255,209,102,0.72)';
  ctx.fillText('连杀', gx + nw + gap, cy - 9);

  /* 连杀窗口剩余：60px 细条，跟着 comboTimer 一起收 */
  const bw = 60, bh = 3;
  const bx = W / 2 - bw / 2, by = cy + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(bx, by, bw, bh, bh / 2);
  ctx.fill();
  const rw = bw * (timer / total);
  if (rw > 1) {
    ctx.fillStyle = col;
    roundRect(bx, by, rw, bh, bh / 2);
    ctx.fill();
  }

  ctx.restore();
}

/* 换弹环：画在准星位置，把「还要多久」从一块文字变成一圈可见的进度。
   reloadDur 是这次换弹的总时长、reloading 是剩余 —— 两个都由 game.js 成对维护，
   只读不写。装完的瞬间闪一个扩散环，是把「可以打了」做成肌肉记忆。 */
let _reloadPrev = 0;
let _reloadFlash = 0;

function drawReloadRing() {
  const p = player;
  if (!p) return;
  if (_reloadFlash > 0) _reloadFlash = Math.max(0, _reloadFlash - _dt);

  const left = p.reloading || 0;
  const dur = p.reloadDur || 0;
  /* 完成 = 剩余归零且弹匣真的满了。换枪打断也会把 reloading 清 0，
     但那时弹匣没满，不该闪 —— 所以判据看的是 mags，不是 reloadDur。 */
  if (_reloadPrev > 0.0001 && left <= 0.0001 &&
      p.mags[p.weapon] >= magSize(p, p.weapon)) {
    _reloadFlash = 0.22;
  }
  _reloadPrev = left;

  const x = input.mx, y = input.my;

  if (_reloadFlash > 0) {
    const k = 1 - _reloadFlash / 0.22;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 24 + k * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (left <= 0 || dur <= 0.02) return;
  const prog = clamp(1 - left / dur, 0, 1);

  ctx.save();
  /* 底环：即使在深色背景上也要能看出「这里有一圈」 */
  ctx.strokeStyle = 'rgba(0,0,0,0.42)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,179,71,0.95)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
  ctx.stroke();

  /* 进度的头部点一个亮点：眼睛会追着它转，比读数字快 */
  if (prog > 0.02) {
    const ang = -Math.PI / 2 + Math.PI * 2 * prog;
    ctx.fillStyle = '#ffe6a8';
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * 24, y + Math.sin(ang) * 24, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  ctx.fillText('双人闯关 · 你 + 大肥鱼 AI 战友', W / 2, 228);

  const lines = [
    ['移动', 'A / D  或  ← →'],
    ['跳跃 / 二段跳', '空格 / W（空中再按一次）'],
    ['瞄准射击', '鼠标瞄准 · 左键开火'],
    ['换枪', '1 主武器  2 副武器  X 快切'],
    ['蹲下 / 趴下 / 精瞄', 'S 蹲下 · Z 趴下 · 按住右键精确瞄准'],
    ['换弹 / 冲刺 / 手雷', 'R / Shift / G'],
    ['救队友', '靠近按住 E'],
    ['指挥大肥鱼', 'C 跟随   V 突击   B 守点'],
    ['大肥鱼性格 / 面板', 'Q 轮换性格 · Tab 战术面板'],
    ['升级 / 招募 / 配枪', '战斗中击杀即升级 · 大厅里买枪、招干员'],
    ['暂停', 'P 或 Esc']
  ];
  ctx.font = '16px "Microsoft YaHei",sans-serif';
  for (let i = 0; i < lines.length; i++) {
    const y = 276 + i * 26;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8fa6b6';
    ctx.fillText(lines[i][0], W / 2 - 24, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8f0f6';
    ctx.fillText(lines[i][1], W / 2 + 24, y);
  }

  /* 地形提示：这一关会遇到的四种新东西，一次说清楚 */
  ctx.textAlign = 'center';
  ctx.font = '14px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#7f97a8';
  ctx.fillText('地形警告：地刺会扎脚 · 喷火口先冒火星再喷 · 蓝色气流能把你托上高台 · 掉进深渊直接阵亡（贴崖边不会失足，走出去了才掉）',
    W / 2, H - 128);

  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = (Math.floor(game.time * 1.6) % 2 === 0) ? '#ffd166' : 'rgba(255,209,102,0.35)';
  ctx.fillText('点击画面 / 按 Enter 进入大厅', W / 2, H - 96);
  ctx.font = '13px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#6e8393';
  ctx.fillText('大肥鱼全自动作战：跟人、躲子弹、挑武器、血少后退、顺路捡补给、你倒了他会冲过来救', W / 2, H - 62);
}

/* ==================================================================
   菜单层：大厅 + 五个二级页（出击 / 武器库 / 干员 / 档案 / 剧情）
   ------------------------------------------------------------------
   这一节只负责「画」。所有能按的键都定义在 game.js 的
   lobbyKeys / deployKeys / armoryKeys / operatorsKeys / archiveKeys 里，
   这里的每一行提示必须和那边一一对应 —— 否则会出现
   「屏幕上写着 Enter，按下去没反应」。

   统一走 uiPanel / uiTopBar / uiHint 三个件，页面函数只排版不配色，
   以后换皮肤改 UI 这一张表就够。
   ================================================================== */

const UI = {
  panel: 'rgba(9,14,19,0.90)',   /* 0.84 → 0.90：城市背景里那些亮窗会从玻璃面板里透出来，
                                      看起来像面板里飘着一块多余的浅色小卡 */
  panelHi: 'rgba(20,29,39,0.94)',
  line: 'rgba(120,180,235,0.26)',
  gold: '#ffd166', cyan: '#78e2ff', whale: '#ffb257', green: '#7ef0b0',
  red: '#ff6b6b', mute: '#8fa6b6', ink: '#eaf2f8',
  font: '"Microsoft YaHei",sans-serif'
};

/* 兵种色（#9c2b2b 军装红 / #c26a22 焦土橙）是照着 3D 士兵装甲调的，
   直接当 12px 文字色摆在深底上几乎读不出来。往白里混 40%：
   色相不动，还是那个兵种的颜色，亮度够扫读了。 */
function bossInk(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return UI.mute;
  const v = parseInt(m[1], 16);
  const mix = function (c) { return Math.round(c + (255 - c) * 0.40); };
  return 'rgb(' + mix((v >> 16) & 255) + ',' + mix((v >> 8) & 255) + ',' + mix(v & 255) + ')';
}

function uiPanel(x, y, w, h, r, hi) {
  ctx.fillStyle = hi ? UI.panelHi : UI.panel;
  roundRect(x, y, w, h, r === undefined ? 12 : r);
  ctx.fill();
  ctx.strokeStyle = hi ? 'rgba(255,209,102,0.72)' : UI.line;
  ctx.lineWidth = hi ? 2 : 1;
  ctx.stroke();
}

/* 逐字换行：只按字符宽度折，中文没有空格可断，够用了 */
function uiWrap(text, x, y, maxW, lineH, size, color, align) {
  ctx.font = size + 'px ' + UI.font;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  /* 逐字折行，但记住最近一个断句标点的位置：如果硬折之后尾行只剩一两个字
     （「单发伤 | 害略低」这种），就退回到标点处断，读起来才不别扭。 */
  const BRK = '，。！？；：、,.!?;:';
  /* 避头点：这些字符绝不能出现在行首。中文排版里「行首不许有标点」是硬规矩，
     英文里则是不能以分隔符开头 —— 「金币 / 等级 / 武器 /」折成
     「/ 关卡进度」那一行，读者会以为少了一段。碰到就往前多带一个字。 */
  const NO_HEAD = '，。！？；：、,.!?;:）)】」』》/／·…';
  let line = '', ly = y, brk = -1;
  for (let i = 0; i < text.length; i++) {
    const test = line + text[i];
    if (ctx.measureText(test).width > maxW && line) {
      let out = line, rest = text[i];
      if (brk > 0 && text.length - i <= 3) {
        out = line.slice(0, brk + 1);
        rest = line.slice(brk + 1) + text[i];
      }
      /* 换行后行首是标点 → 不能就这么断。
         行首还可能是空格：「金币 / 等级 / 武器 /」这种写法里斜杠前面带空格，
         折行恰好落在空格上时 text[i] 就是那个空格，直接判标点等于没判
         （上一版就栽在这，图上第二行还是「/ 关卡进度…」）。
         所以往后找第一个「真字符」，它是分隔符就往回退：退到上一个空格处，
         让下一行以一个完整的词开头（「干员 / 关卡进度…」）；
         实在没有空格可退，就只把上一个字带下来。 */
      let k = i;
      while (k < text.length && text[k] === ' ') k++;
      if (out.length > 1 && k < text.length && NO_HEAD.indexOf(text[k]) >= 0) {
        const sp = out.lastIndexOf(' ');
        if (sp > 0) {
          rest = out.slice(sp + 1) + rest;
          out = out.slice(0, sp + 1);
        } else {
          rest = out.slice(-1) + rest;
          out = out.slice(0, -1);
        }
      }
      ctx.fillText(out, x, ly);
      line = rest;
      ly += lineH;
      brk = -1;
    } else {
      line = test;
      if (BRK.indexOf(text[i]) >= 0) brk = line.length - 1;
    }
  }
  if (line) ctx.fillText(line, x, ly);
  return ly;
}

/* 顶部状态条：金币 / 等级经验 / 关卡进度。
   六个菜单页共用同一条，好处是「金币变了」在任何页面都能立刻看到 ——
   这就是需求里「数据联动」在界面上的最直接体现。 */
function uiTopBar(page) {
  ctx.fillStyle = 'rgba(6,10,14,0.78)';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillStyle = 'rgba(120,180,235,0.18)';
  ctx.fillRect(0, 61, W, 1);

  ctx.textAlign = 'left';
  ctx.font = 'bold 22px ' + UI.font;
  ctx.fillStyle = UI.gold;
  ctx.fillText('COOP DEMO', 36, 40);
  ctx.font = '14px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText('· ' + page, 146, 40);

  /* --- 金币 --- */
  uiPanel(724, 10, 168, 42, 10);
  ctx.textAlign = 'left';
  ctx.font = '12px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText('金币', 742, 37);
  ctx.beginPath();
  ctx.arc(786, 31, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#d8a13c'; ctx.fill();
  ctx.beginPath();
  ctx.arc(786, 31, 5.4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd166'; ctx.fill();
  ctx.textAlign = 'right';
  ctx.font = 'bold 19px ' + UI.font;
  ctx.fillStyle = '#ffe6a8';
  ctx.fillText(String(SAVE.coins), 878, 39);

  /* --- 等级 + 经验条 ---
     原来把「240 / 255」右对齐压在 84px 的青蓝进度条上：数字落在条的
     填充段里，深灰字配亮青底，对比度不到 1.5:1，等于没写。
     改成两行 —— 第一行放字，第二行放条，条也从 84px 撑到 180px，
     「还差多少」一眼就能估出来。 */
  uiPanel(902, 10, 216, 42, 10);
  const need = xpNeed(SAVE.level);
  const ratio = SAVE.level >= MAX_LEVEL ? 1 : clamp(SAVE.xp / need, 0, 1);
  ctx.textAlign = 'left';
  ctx.font = '11px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText('等级', 920, 32);
  ctx.font = 'bold 15px ' + UI.font;
  ctx.fillStyle = UI.ink;
  ctx.fillText('Lv.' + SAVE.level, 950, 33);
  ctx.textAlign = 'right';
  ctx.font = '10px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText(SAVE.level >= MAX_LEVEL ? 'MAX' : (SAVE.xp + ' / ' + need), 1100, 33);
  const bx = 920, bw = 180;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(bx, 39, bw, 7, 3.5); ctx.fill();
  ctx.fillStyle = SAVE.level >= MAX_LEVEL ? UI.green : UI.cyan;
  roundRect(bx, 39, Math.max(3, bw * ratio), 7, 3.5); ctx.fill();

  /* --- 关卡进度 --- */
  uiPanel(1128, 10, 116, 42, 10);
  ctx.textAlign = 'left';
  ctx.font = '12px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText('进度', 1144, 37);
  ctx.textAlign = 'right';
  ctx.font = 'bold 18px ' + UI.font;
  ctx.fillStyle = UI.ink;
  ctx.fillText(SAVE.cleared.length + ' / ' + MAX_STAGE, 1230, 39);
}

/* 底部按键提示 */
function uiHint(text) {
  ctx.textAlign = 'center';
  ctx.font = '13px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.9)';
  ctx.fillText(text, W / 2, H - 26);
}

/* 菜单内的临时提示（买不起 / 已装备 / 存钱罐已清空），1.8 秒自己淡出 */
function uiToast() {
  if (!(game.toastT > 0) || !game.toast) return;
  const a = Math.min(1, game.toastT / 0.4);
  ctx.globalAlpha = a;
  ctx.font = 'bold 16px ' + UI.font;
  const w = Math.max(180, ctx.measureText(game.toast).width + 48);
  ctx.fillStyle = 'rgba(12,18,24,0.96)';
  roundRect(W / 2 - w / 2, H - 96, w, 40, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,209,102,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = UI.gold;
  ctx.fillText(game.toast, W / 2, H - 70);
  ctx.globalAlpha = 1;
}

/* 立绘：直接复用战斗里的那套程序化 painter。
   三个前提：camera.x 临时归零（画布坐标 = 世界坐标）、
   flatShadow（不查地形找影子）、伪实体只带绘制需要的字段。
   这样菜单里的角色和关卡里的是同一套代码，改了战斗立绘菜单自动跟着改。 */
function portrait(look, x, y, sc, aim) {
  const cx = camera.x;
  camera.x = 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  const fake = {
    x: 0, y: 0, h: 58, baseH: 58, look: look,
    aim: aim === undefined ? 0.42 : aim,
    crouch: 0, prone: 0, landSquash: 0, muzzle: 0, flatShadow: true,
    invuln: 0, dead: false, downed: false, weapon: 0,
    mags: [9, 9, 9, 9, 9], reloading: 0, vx: 0, vy: 0, onGround: true,
    hp: 100, maxHp: 100, behavior: 'menu'
  };
  /* isBuddy 传 false：菜单立绘不要头顶那块「名字 + 绿血条」——
     那是战场里给队友看的标记，摆在剧情页会和右边的对话名牌撞车。 */
  if (look === 'whale') drawWhaleGirl(fake, false);
  else if (look === 'xiaoke') drawXiaoke(fake);
  else if (look === 'hero') drawHero(fake, false);
  else if (castCfg(look)) drawCast(fake, false);
  else drawAgent(fake, false);
  ctx.restore();
  camera.x = cx;
}

/* ---------------- 主页面（大厅） ---------------- */
function drawLobby() {
  drawBackground();
  overlay(0.74);
  uiTopBar('大厅');

  lobbyPortraitPanel();

  /* --- 右侧 2×2 入口卡 --- */
  const CW = 400, CH = 176, GAP = 20;
  for (let i = 0; i < LOBBY_ITEMS.length; i++) {
    const col = i % 2, row = (i / 2) | 0;
    const x = 400 + col * (CW + GAP);
    const y = 84 + row * (CH + GAP);
    const on = game.menu === i;
    uiPanel(x, y - (on ? 4 : 0), CW, CH, 14, on);
    const yy = y - (on ? 4 : 0);

    ctx.textAlign = 'left';
    ctx.font = 'bold 13px ' + UI.font;
    ctx.fillStyle = on ? UI.gold : 'rgba(120,180,235,0.55)';
    ctx.fillText('0' + (i + 1), x + 26, yy + 34);

    ctx.font = 'bold 32px ' + UI.font;
    ctx.fillStyle = on ? UI.ink : '#c3d2de';
    ctx.fillText(LOBBY_ITEMS[i].name, x + 26, yy + 84);

    ctx.font = '13px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(LOBBY_ITEMS[i].sub, x + 26, yy + 114);

    /* 选中态的右下角回车指示：不选中的卡片不显示，避免满屏闪烁 */
    if (on) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 13px ' + UI.font;
      ctx.fillStyle = (Math.floor(game.time * 2) % 2 === 0) ? UI.gold : 'rgba(255,209,102,0.35)';
      ctx.fillText('Enter »', x + CW - 24, yy + CH - 22);
    }
  }

  lobbyDetail();

  uiHint('← → 选择入口　Enter 进入　（战斗中：1/2 换枪 · X 快切 · Esc 暂停）');
  uiToast();
}

/* 大厅左栏：当前出战干员的立绘 + 属性，让「角色选择」在主页面上有存在感 */
function lobbyPortraitPanel() {
  const def = charDef(SAVE.charId);
  uiPanel(40, 84, 336, 512, 14);

  ctx.textAlign = 'left';
  ctx.font = '13px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText('出 战 干 员', 64, 116);

  /* 右上角一行星数：顶栏那三块（金币/等级/进度）已经排到 1244，
     再往里塞就压字了，所以挂在立绘面板的同一行标题右侧。 */
  const ts = (typeof totalStars === 'function') ? Math.round(+totalStars() || 0) : 0;
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px ' + UI.font;
  ctx.fillStyle = ts > 0 ? 'rgba(255,209,102,0.85)' : 'rgba(143,166,182,0.55)';
  ctx.fillText('★ ' + ts + ' / ' + (MAX_STAGE * 3), 352, 116);
  ctx.textAlign = 'left';

  portrait(def.look, 208, 400, 2.4);
  /* 立绘的脚下一道光，把人从深色面板里托出来 */
  const g = ctx.createLinearGradient(0, 400, 0, 420);
  g.addColorStop(0, 'rgba(120,180,235,0.20)');
  g.addColorStop(1, 'rgba(120,180,235,0)');
  ctx.fillStyle = g;
  ctx.fillRect(96, 400, 224, 20);

  ctx.textAlign = 'center';
  ctx.font = 'bold 30px ' + UI.font;
  ctx.fillStyle = def.color;
  ctx.fillText(def.name, 208, 444);
  ctx.font = '13px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText(def.title, 208, 468);

  ctx.strokeStyle = 'rgba(120,180,235,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, 486); ctx.lineTo(336, 486); ctx.stroke();

  ctx.textAlign = 'left';
  uiWrap(def.perk, 76, 510, 268, 20, 13, '#cfdbe4');

  /* 三项星级：横向量化，不参与任何计算 */
  const keys = ['生存', '火力', '机动'];
  for (let i = 0; i < keys.length; i++) {
    const y = 552 + i * 18;
    ctx.textAlign = 'left';
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(keys[i], 76, y);
    for (let s = 0; s < 5; s++) {
      const lit = s < def.star[keys[i]];
      ctx.fillStyle = lit ? def.color : 'rgba(255,255,255,0.10)';
      roundRect(112 + s * 14, y - 9, 10, 9, 2);
      ctx.fill();
    }
  }
}

/* 大厅中栏下方的说明条：把「这个入口到底能干什么」讲清楚一次，
   玩家不用点进去才知道武器库里能改大肥鱼的枪 */
function lobbyDetail() {
  const lines = [
    ['出击', '选关进入战斗。没看过的关卡会先播剧情；通关后解锁下一战区，最多 ' + MAX_STAGE + ' 关。'],
    ['武器库', '买枪 → Enter 设为主武器 / Space 设为副武器 / B 指定大肥鱼的枪 / X 主副互换。'],
    ['干员', '四名干员各有 6 个乘区差异（生命·移速·伤害·换弹·散布·护甲），金币招募一次买断。'],
    ['档案', '等级经验、累计击杀、最高分、通关记录、剧情回放，以及清空存档。']
  ];
  const d = lines[clamp(game.menu, 0, 3)];
  uiPanel(400, 476, 820, 120, 14);
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px ' + UI.font;
  ctx.fillStyle = UI.gold;
  ctx.fillText(d[0], 428, 508);
  uiWrap(d[1], 428, 536, 760, 24, 14, '#c3d2de');
}

/* ---------------- 出击：选关页 ----------------
   关卡数封顶在 MAX_STAGE（见 meta.js）。已通关的关卡可以重打刷金币，
   未解锁的只画一个锁 —— 不给玩家「点进去发现不能打」的机会。
   ---------------------------------------------- */
const STAGE_TIPS = {
  street: '地形警告：地刺扎脚，喷火口先冒火星再喷，蓝色气流能把你托上高台，掉进深渊直接阵亡。',
  ruins:  '地形警告：火焰地带会把血条一格一格舔掉；纵火者的燃烧瓶专封走位，别在开阔地停留。',
  hq:     '地形警告：守军全是重甲，正面打不动；踏板与高台多，绕到背后打装甲缝隙。'
};

function drawDeploy() {
  drawBackground();
  overlay(0.8);
  uiTopBar('出击 · 选关');

  const CW = 208, GAP = 16, x0 = 88, y = 190, CH = 250;

  for (let s = 1; s <= MAX_STAGE; s++) {
    const x = x0 + (s - 1) * (CW + GAP);
    const on = game.pickStage === s;
    const unlocked = s <= SAVE.maxStage;
    const done = SAVE.cleared.indexOf(s) >= 0;
    const th = STAGE_THEMES[(s - 1) % STAGE_THEMES.length];
    const bt = ENEMY_TYPES[bossForStage(s)] || {};

    const yy = y - (on ? 8 : 0);
    uiPanel(x, yy, CW, CH, 14, on && unlocked);

    /* 关卡序号：数字本身就是这页的视觉主角 */
    ctx.textAlign = 'left';
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText('第 ' + s + ' 关', x + 22, yy + 32);

    ctx.font = 'bold 52px ' + UI.font;
    ctx.fillStyle = unlocked ? (on ? UI.gold : '#e8f0f6') : 'rgba(232,240,246,0.18)';
    ctx.fillText(String(s).padStart(2, '0'), x + 20, yy + 92);

    ctx.font = 'bold 18px ' + UI.font;
    ctx.fillStyle = unlocked ? '#cfdbe4' : 'rgba(207,219,228,0.30)';
    ctx.fillText(th ? th.name : '未知战区', x + 22, yy + 126);

    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = unlocked ? bossInk(bt.color) : 'rgba(143,166,182,0.35)';
    ctx.fillText('守将 · ' + (bt.name || '—'), x + 22, yy + 150);

    if (!unlocked) {
      /* 锁：一个框 + 一段弧，比画图标省事，96px 尺度下也认得出 */
      ctx.strokeStyle = 'rgba(200,214,226,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x + CW - 44, yy + 42, 9, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(200,214,226,0.30)';
      roundRect(x + CW - 56, yy + 42, 24, 20, 4); ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = '12px ' + UI.font;
      ctx.fillStyle = 'rgba(143,166,182,0.6)';
      ctx.fillText('通关第 ' + (s - 1) + ' 关后解锁', x + CW / 2, yy + CH - 46);
    } else {
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px ' + UI.font;
      if (done) { ctx.fillStyle = UI.green; ctx.fillText('√ 已通关', x + CW / 2, yy + CH - 46); }
      else if (on) { ctx.fillStyle = (Math.floor(game.time * 2) % 2 === 0) ? UI.gold : 'rgba(255,209,102,0.35)'; ctx.fillText('Enter 出击', x + CW / 2, yy + CH - 46); }
      else { ctx.fillStyle = UI.mute; ctx.fillText('待攻克', x + CW / 2, yy + CH - 46); }

      /* 三颗 10px 小星：这一关拿过几颗，不用点进档案就知道。
         间距 18 = 直径 10 + 8，摆在状态行下面 20px，离卡底还有 24。 */
      const ss = hudStageStars(s);
      const ks = ['clear', 'time', 'hp'];
      for (let k = 0; k < 3; k++) {
        const lit = !!ss[ks[k]];
        drawStar(x + CW / 2 + (k - 1) * 18, yy + CH - 26, 5, lit, lit ? UI.gold : null, lit ? 6 : 0);
      }
    }
  }

  /* 底部详情：这一关会遇到的守将 / 地形 / 剧情条数 */
  const s = clamp(game.pickStage, 1, SAVE.maxStage);
  const th = STAGE_THEMES[(s - 1) % STAGE_THEMES.length];
  const bt = ENEMY_TYPES[bossForStage(s)] || {};
  const lines = storyFor(s);

  uiPanel(88, 470, 1104, 150, 14);
  ctx.textAlign = 'left';
  ctx.font = 'bold 22px ' + UI.font;
  ctx.fillStyle = UI.ink;
  ctx.fillText('第 ' + s + ' 关 · ' + (th ? th.name : '未知战区'), 116, 510);

  ctx.font = '14px ' + UI.font;
  ctx.fillStyle = bossInk(bt.color);
  ctx.fillText('守将 ' + (bt.name || '—') + (bt.title ? '（' + bt.title + '）' : ''), 116, 540);

  ctx.fillStyle = UI.mute;
  ctx.font = '13px ' + UI.font;
  ctx.fillText('奖励　击杀 ' + (bt.coin || 60) + ' / ' + (bt.xp || 100) + ' xp　·　过关 ' + (80 * s) + ' 金币 + 残血奖励', 116, 568);

  uiWrap(STAGE_TIPS[th ? th.key : 'street'], 116, 594, 1040, 20, 13, '#a9bccb');

  ctx.textAlign = 'right';
  ctx.font = '12px ' + UI.font;
  ctx.fillStyle = storySeen(s) ? UI.mute : UI.gold;
  ctx.fillText(lines ? (storySeen(s) ? '剧情已看过（档案可回放）' : '出击时先播 ' + lines.length + ' 句剧情') : '本关无剧情', 1160, 510);

  uiHint('← → 选择关卡　Enter 出击　Esc 返回大厅');
  uiToast();
}

/* ---------------- 剧情对话页 ----------------
   纯数据驱动：一行 = { look, name, tone, text }，页面不认识任何具体角色。
   逐字推进靠 game.dialog.chars，由 frame() 里的 advanceDialog 驱动，
   所以这一页自己不带任何计时器。
   ------------------------------------------ */
function drawStory() {
  const d = game.dialog;
  drawBackground();
  overlay(0.86);

  /* 底部再压一层暗角，让文字区和立绘分开 */
  const g = ctx.createLinearGradient(0, H - 300, 0, H);
  g.addColorStop(0, 'rgba(4,7,10,0)');
  g.addColorStop(1, 'rgba(4,7,10,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 300, W, 300);

  if (!d) { uiHint('Esc 返回'); return; }
  const line = d.lines[d.idx] || { name: '', text: '', look: 'hero', tone: UI.cyan };

  /* 立绘：说话的人在中间稍偏左，非说话的一方不画，避免画面打架。
     先铺一层冷光背光 —— 夜景背景本来就暗，纯黑装甲压上去会糊成一团。 */
  const rg = ctx.createRadialGradient(320, 380, 40, 320, 380, 260);
  rg.addColorStop(0, 'rgba(120,180,235,0.12)');
  rg.addColorStop(1, 'rgba(120,180,235,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(40, 120, 560, 520);
  portrait(line.look, 320, 560, 3.0, 0.42);

  ctx.save();
  ctx.strokeStyle = 'rgba(120,180,235,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(430, 180); ctx.lineTo(430, 560); ctx.stroke();
  ctx.restore();

  /* 名牌 */
  ctx.fillStyle = 'rgba(12,18,24,0.95)';
  roundRect(478, 186, 296, 44, 10);
  ctx.fill();
  ctx.strokeStyle = line.tone;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = 'bold 20px ' + UI.font;
  ctx.fillStyle = line.tone;
  ctx.fillText(line.name, 502, 215);

  /* 正文：只画 d.chars 个字，逐字效果就出来了 */
  const shown = line.text.slice(0, Math.floor(d.chars));
  const cy = uiWrap(shown, 478, 274, 720, 34, 20, '#e8f0f6');

  /* 光标：打完了就闪一个 »，提示可以翻页 */
  if (Math.floor(d.chars) >= line.text.length && Math.floor(game.time * 2) % 2 === 0) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 18px ' + UI.font;
    ctx.fillStyle = UI.gold;
    ctx.fillText('»', 478, cy + 40);
  }

  /* 页码 */
  ctx.textAlign = 'right';
  ctx.font = '13px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText((d.idx + 1) + ' / ' + d.lines.length, 1198, 215);

  /* 底部操作条 */
  ctx.fillStyle = 'rgba(6,10,14,0.7)';
  ctx.fillRect(0, H - 56, W, 56);
  ctx.textAlign = 'left';
  ctx.font = '13px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText('第 ' + d.stage + ' 关 · ' + (STAGE_THEMES[(d.stage - 1) % STAGE_THEMES.length] || {}).name, 40, H - 24);
  ctx.textAlign = 'right';
  ctx.fillStyle = UI.gold;
  ctx.fillText('Enter 继续　Esc 跳过', W - 40, H - 24);
}

/* ---------------- 武器库 ----------------
   这一页同时承担四件事：买枪 / 设主武器 / 设副武器 / 给大肥鱼配枪。
   所以每行右侧永远显示三个标记位（主·副·鱼），玩家一眼能看出
   「这把枪现在归谁用」，不用记刚才按过什么。
   ---------------------------------------- */
let _armMax = null;
function armoryStatMax() {
  if (_armMax) return _armMax;
  const m = { dmg: 1, rate: 1, range: 1, mag: 1 };
  for (const w of WEAPONS) {
    m.dmg = Math.max(m.dmg, (w.blastDmg || w.dmg) * (w.pellets || 1));
    m.rate = Math.max(m.rate, 1 / w.rate);
    m.range = Math.max(m.range, w.range);
    m.mag = Math.max(m.mag, w.mag);
  }
  _armMax = m;
  return m;
}

function drawArmory() {
  drawBackground();
  overlay(0.84);
  uiTopBar('武器库');

  /* 行高 64→58、行距 8→6 是为了塞下第 6 把枪（MP5 追加在 WEAPONS 末尾）。
     6 行 × 58 + 5 × 6 = 378，104 起排到 482 —— 配装条就跟着下移到 490。
     旧尺寸是 5 行的排版（5×72 = 360，正好排到 464），MP5 追加进表之后
     第 6 行落在 464..528，整个被 472 起的配装条盖住：行还在、还能被
     ↑↓ 选中，但玩家看不见，只有它的名字从半透明面板里透出来，
     在「主武器」那一行底下糊成一片幽灵字。 */
  const RW = 636, RH = 58, GAP = 6, X = 40, Y0 = 104;
  const idx = clamp(game.menu2, 0, WEAPONS.length - 1);

  for (let i = 0; i < WEAPONS.length; i++) {
    const w2 = WEAPONS[i];
    const meta = weaponMeta(w2.id);
    const on = idx === i;
    const own = isUnlocked(w2.id);
    const y = Y0 + i * (RH + GAP);
    /* 行内所有纵向位置都从行心 cy 推，不再写死 y+40 / y+22 这种绝对值：
       行高一改，徽章和标记位会跟着走，不会贴着上边缘或掉出去。
       （RH=64 时 cy+8 / cy-18 / cy-10 / cy+4 恰好还原成原来的 40 / 14 / 22 / 36） */
    const cy = y + RH / 2;
    uiPanel(X, y, RW, RH, 10, on);

    ctx.textAlign = 'left';
    ctx.font = 'bold 15px ' + UI.font;
    ctx.fillStyle = on ? UI.gold : 'rgba(120,180,235,0.5)';
    ctx.fillText(String(i + 1), X + 18, cy + 8);

    ctx.font = 'bold 19px ' + UI.font;
    ctx.fillStyle = own ? '#eaf2f8' : 'rgba(234,242,248,0.42)';
    ctx.fillText(w2.name, X + 44, cy + 8);

    /* 改装等级徽章紧贴武器名右侧，「类型 · 弹匣」跟着它顺排 ——
       用流的排法而不是固定列，枪名再长一截也不会压到徽章上。
       未解锁的枪不显示等级（那还是 0 级），右侧照旧显示价格。 */
    let nx = X + 44 + ctx.measureText(w2.name).width;
    if (own) {
      const lv = hudWeaponLv(w2.id);
      const lvTxt = lv >= 3 ? 'MAX' : ('Lv.' + (lv + 1));
      ctx.font = 'bold 10px ' + UI.font;
      const lw = Math.max(30, ctx.measureText(lvTxt).width + 12);
      nx += 8;
      ctx.fillStyle = lv >= 3 ? 'rgba(255,209,102,0.20)' : 'rgba(120,180,235,0.10)';
      roundRect(nx, cy - 18, lw, 17, 4); ctx.fill();
      ctx.strokeStyle = lv >= 3 ? 'rgba(255,209,102,0.62)' : 'rgba(120,180,235,0.30)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = lv >= 3 ? UI.gold : (lv > 0 ? '#9fd8ff' : 'rgba(159,216,255,0.62)');
      ctx.fillText(lvTxt, nx + lw / 2, cy - 5.5);
      ctx.textAlign = 'left';
      nx += lw + 12;
    } else {
      nx = X + 176;
    }

    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = 'rgba(143,166,182,0.85)';
    /* 弹匣读改装后的真实弹匣（wStat 没落地就回落枪表原值） */
    const clsTxt = meta.cls + ' · ' + Math.round(hudWeaponStat(w2.id, 'mag', w2.mag)) + ' 发';
    /* 量过再画：宁可这一行不显示，也不许压到 292 起的三枚标记位 */
    if (nx + ctx.measureText(clsTxt).width <= X + 286) ctx.fillText(clsTxt, nx, cy + 8);

    /* 三个标记位：主 / 副 / 鱼 */
    const tags = [
      ['主', SAVE.primary === w2.id, UI.gold],
      ['副', SAVE.secondary === w2.id, UI.cyan],
      ['鱼', SAVE.buddyWeapon === w2.id, UI.whale]
    ];
    let tx = X + 292;
    for (const [lab, lit, col] of tags) {
      const tw = 26;
      ctx.fillStyle = lit ? col : 'rgba(255,255,255,0.07)';
      roundRect(tx, cy - 10, tw, 20, 5);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px ' + UI.font;
      ctx.fillStyle = lit ? '#12161a' : 'rgba(200,214,226,0.28)';
      ctx.fillText(lab, tx + tw / 2, cy + 4);
      tx += tw + 6;
    }

    /* 右侧价格 / 已拥有 */
    ctx.textAlign = 'right';
    if (own) {
      ctx.font = 'bold 13px ' + UI.font;
      ctx.fillStyle = 'rgba(126,240,176,0.85)';
      ctx.fillText('已解锁', X + RW - 20, cy + 7);
    } else {
      ctx.font = 'bold 16px ' + UI.font;
      ctx.fillStyle = SAVE.coins >= meta.price ? '#ffe6a8' : 'rgba(255,107,107,0.8)';
      ctx.fillText(meta.price + ' 金币', X + RW - 20, cy + 7);
    }
  }

  armoryDetail(WEAPONS[idx], idx);

  /* 当前配装：主 / 副 / 鱼，永远是「按 X 之前」的真实状态。
     472 → 490：列表改成 6 行之后要给它让位；下移这 18px 顺带把
     面板和底部提示条之间原来 112px 的空档收窄一点，版面反而更匀。 */
  uiPanel(40, 490, 1184, 106, 14);
  const slots = [
    ['主武器', SAVE.primary, UI.gold, 'Enter 装备'],
    ['副武器', SAVE.secondary, UI.cyan, 'Space 装备'],
    ['大肥鱼', SAVE.buddyWeapon === 'auto' ? null : SAVE.buddyWeapon, UI.whale, 'B 指定 / 取消']
  ];
  for (let i = 0; i < 3; i++) {
    const x = 66 + i * 392;
    const [lab, id, col, key] = slots[i];
    ctx.textAlign = 'left';
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(lab, x, 520);
    ctx.font = 'bold 21px ' + UI.font;
    ctx.fillStyle = id ? col : 'rgba(200,214,226,0.30)';
    ctx.fillText(id ? (WEAPONS[weaponById(id)] || {}).name : (i === 2 ? '自动挑枪' : '空'), x, 550);
    ctx.font = '11px ' + UI.font;
    ctx.fillStyle = 'rgba(143,166,182,0.75)';
    ctx.fillText(key, x, 574);
  }

  uiHint('↑ ↓ 选择　Enter 主武器　Space 副武器　B 给大肥鱼　X 主副互换　U 改装　Esc 返回');
  uiToast();
}

function armoryDetail(w2, idx) {
  const meta = weaponMeta(w2.id);
  const own = isUnlocked(w2.id);
  const m = armoryStatMax();
  /* PH 352 → 378：左边列表改成 6 行之后排到 482，右边这张卡如果还停在
     456，两栏下边缘会差出 26px —— 挨得这么近的差值是会被看出来的，
     像「右边这块没排完」。卡片底边与列表对齐，底部的改装行跟着下移
     （它锚的是 Y+PH-46），说明文字和改装行之间也就多出一段正常呼吸。 */
  const X = 700, Y = 104, PW = 524, PH = 378;
  uiPanel(X, Y, PW, PH, 14);

  ctx.textAlign = 'left';
  ctx.font = 'bold 26px ' + UI.font;
  ctx.fillStyle = own ? UI.ink : 'rgba(234,242,248,0.45)';
  ctx.fillText(w2.name, X + 26, Y + 44);

  ctx.font = '13px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.9)';
  ctx.fillText(meta.cls + '　·　适配：' + meta.fit, X + 26, Y + 72);

  /* 换弹时长单独挂在这一行右侧：改装三档里有一档专改换弹，
     塞进四根条里会多出一根语义相反的条（越短越好），放这里最省事。 */
  const rlBase = w2.reload || 1;
  const rlNow = hudWeaponStat(w2.id, 'reload', rlBase);
  const rlUp = rlNow < rlBase - 0.005;
  ctx.textAlign = 'right';
  ctx.font = '12px ' + UI.font;
  ctx.fillStyle = rlUp ? '#ffe6a8' : 'rgba(143,166,182,0.75)';
  ctx.fillText('换弹 ' + (Math.round(rlNow * 100) / 100) + 's' + (rlUp ? ' ↓' : ''), X + PW - 26, Y + 72);
  ctx.textAlign = 'left';

  /* 四根数值条：全部按「本作最强的那把」归一化，横向可比。
     数值优先取改装后的（meta.js 的 wStat），没落地就回落枪表原值。
     单发伤害用比值换算而不是直接取 wStat('dmg')：霰弹是「每颗 × 颗数」、
     火箭是「溅射伤害」，两种口径下比值都能落回同一根条上。 */
  const baseDmg = (w2.blastDmg || w2.dmg) * (w2.pellets || 1);
  let dmg = baseDmg;
  const statDmg = hudWeaponStat(w2.id, 'dmg', null);
  if (statDmg && w2.dmg > 0) dmg = baseDmg * (statDmg / w2.dmg);
  const mag = hudWeaponStat(w2.id, 'mag', w2.mag);

  const rows = [
    ['单发伤害', dmg, m.dmg, UI.red, dmg > baseDmg + 0.5],
    ['射速', 1 / w2.rate, m.rate, UI.gold, false],
    ['有效射程', w2.range, m.range, UI.cyan, false],
    ['弹匣', mag, m.mag, UI.green, mag > w2.mag + 0.5]
  ];
  for (let i = 0; i < rows.length; i++) {
    const [lab, val, max, col, up] = rows[i];
    const y = Y + 104 + i * 30;
    ctx.textAlign = 'left';
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(lab, X + 26, y + 9);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    roundRect(X + 116, y, 268, 8, 4); ctx.fill();
    ctx.fillStyle = col;
    roundRect(X + 116, y, Math.max(4, 268 * clamp(val / max, 0, 1)), 8, 4); ctx.fill();
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px ' + UI.font;
    /* 改装后比原值高的那一栏换成暖色，钱花在哪一眼看得见 */
    ctx.fillStyle = up ? '#ffe6a8' : '#cfdbe4';
    ctx.fillText(Math.round(val), X + PW - 26, y + 9);
  }

  ctx.strokeStyle = 'rgba(120,180,235,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X + 26, Y + 232); ctx.lineTo(X + PW - 26, Y + 232); ctx.stroke();

  uiWrap(meta.desc, X + 26, Y + 258, PW - 52, 21, 13, '#b9c9d6');

  /* 改装行：等级 × 价格 × 满级 × 未解锁，四种状态都必须有话说，
     否则玩家按了 U 没反应会以为按键坏了。 */
  const uy = Y + PH - 46;
  const lv = hudWeaponLv(w2.id);
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px ' + UI.font;
  if (!own) {
    ctx.fillStyle = 'rgba(143,166,182,0.7)';
    ctx.fillText('U 改装 · 先购买', X + 26, uy);
  } else if (lv >= 3) {
    ctx.fillStyle = UI.gold;
    ctx.fillText('U 改装 · 已满改', X + 26, uy);
  } else if (typeof upgradeWeapon !== 'function' || typeof upgradeCost !== 'function') {
    ctx.fillStyle = 'rgba(143,166,182,0.55)';
    ctx.fillText('U 改装 · 尚未启用', X + 26, uy);
  } else {
    const cost = upgradeCost(w2.id);
    if (typeof cost !== 'number' || cost < 0) {
      ctx.fillStyle = UI.gold;
      ctx.fillText('U 改装 · 已满改', X + 26, uy);
    } else {
      ctx.fillStyle = SAVE.coins >= cost ? '#ffe6a8' : 'rgba(255,107,107,0.85)';
      ctx.fillText('U 改装 · 需要 ' + cost + ' 金币', X + 26, uy);
    }
  }

  ctx.textAlign = 'left';
  ctx.font = 'bold 14px ' + UI.font;
  if (own) { ctx.fillStyle = 'rgba(126,240,176,0.9)'; ctx.fillText('已拥有　可自由装备', X + 26, Y + PH - 22); }
  else {
    ctx.fillStyle = SAVE.coins >= meta.price ? '#ffe6a8' : 'rgba(255,107,107,0.85)';
    ctx.fillText('售价 ' + meta.price + ' 金币' + (SAVE.coins >= meta.price ? '　Enter 购入' : '　（还差 ' + (meta.price - SAVE.coins) + '）'), X + 26, Y + PH - 22);
  }
}

/* ---------------- 干员：角色选择 ----------------
   四张卡横向排开，卡里就是战斗里那套立绘（同一个 painter），
   所见即所得 —— 换干员不是换一张贴图，是换六个乘区。
   ---------------------------------------------- */
function drawOperators() {
  drawBackground();
  overlay(0.84);
  uiTopBar('干员');

  /* 纵向节奏（相对卡顶 y）：立绘 67~230 / 名字 272 / 称号 293 /
     分隔线 305 / 特长 326（最多两行到 344）/ 星级 372~385 / 状态 424。
     卡片高度按「状态条基线 + 14px 内边距」反推，星级与状态之间留 27px，
     这样任何一条 perk 换行都不会把底部那行顶穿。 */
  const CW = 276, GAP = 20, X0 = 58, Y0 = 100, CH = 440;
  const idx = clamp(game.menu2, 0, CHAR_LIST.length - 1);

  /* 一屏只放 4 张：1280 宽正好塞下 4×276 + 3×20 + 左右各 58。
     第 5 张之后整排左移（选中的永远在最右那一格），不再缩小卡片 ——
     卡片再窄一点，「立绘 + 名字 + 特长两行 + 星级 + 状态」就挤不下了。 */
  const VIS = 4;
  const start = clamp(idx - (VIS - 1), 0, Math.max(0, CHAR_LIST.length - VIS));
  const end = Math.min(CHAR_LIST.length, start + VIS);

  /* 窗口指示：让玩家知道「后面还有人」，否则选到第 4 张时看起来像到头了 */
  if (CHAR_LIST.length > VIS) {
    ctx.textAlign = 'right';
    ctx.font = '11px ' + UI.font;
    ctx.fillStyle = 'rgba(143,166,182,0.75)';
    ctx.fillText('干员 ' + (start + 1) + '–' + end + ' / ' + CHAR_LIST.length, X0 + VIS * (CW + GAP) - GAP, Y0 - 18);
    ctx.textAlign = 'left';
  }

  for (let i = start; i < end; i++) {
    const def = CHAR_LIST[i];
    const on = idx === i;
    const own = ownedChar(def.id);
    const lockedStage = charLocked(def);
    const x = X0 + (i - start) * (CW + GAP);
    const y = Y0 - (on ? 8 : 0);
    uiPanel(x, y, CW, CH, 14, on);

    /* 立绘：选中的人抬起来一点点，重心高的角色不会糊到名字上 */
    portrait(def.look, x + CW / 2, y + 230, 1.70);

    ctx.textAlign = 'center';
    ctx.font = 'bold 25px ' + UI.font;
    ctx.fillStyle = lockedStage ? 'rgba(234,242,248,0.35)' : def.color;
    ctx.fillText(def.name, x + CW / 2, y + 272);
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(def.title, x + CW / 2, y + 293);

    ctx.strokeStyle = 'rgba(120,180,235,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 22, y + 305); ctx.lineTo(x + CW - 22, y + 305); ctx.stroke();

    uiWrap(def.perk, x + CW / 2, y + 326, CW - 44, 18, 12, '#b9c9d6', 'center');

    /* 三星横排：装饰性量纲，真正的数值在下面那排乘区里 */
    const keys = ['生存', '火力', '机动'];
    ctx.textAlign = 'center';
    ctx.font = '11px ' + UI.font;
    for (let k = 0; k < 3; k++) {
      const cx = x + 44 + k * 84;
      ctx.fillStyle = UI.mute;
      ctx.fillText(keys[k], cx, y + 372);
      for (let s = 0; s < 5; s++) {
        ctx.fillStyle = s < def.star[keys[k]] ? def.color : 'rgba(255,255,255,0.09)';
        roundRect(cx - 27 + s * 11, y + 378, 8, 7, 2);
        ctx.fill();
      }
    }

    /* 底部状态条：出战中 / 已招募 / 招募价 / 未解锁。
       关卡解锁型（unlock.type === 'stage'）一旦满足条件就是免费招募，
       不能去读 unlock.price —— 那个字段根本不存在，读出来是 0。 */
    const sty = y + CH - 16;
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ' + UI.font;
    if (lockedStage) {
      ctx.fillStyle = 'rgba(255,107,107,0.7)';
      ctx.fillText(charUnlockText(def), x + CW / 2, sty);
    } else if (SAVE.charId === def.id) {
      ctx.fillStyle = UI.green;
      ctx.fillText('√ 出战中', x + CW / 2, sty);
    } else if (own) {
      ctx.fillStyle = on ? UI.gold : UI.cyan;
      ctx.fillText(on ? 'Enter 出战' : '已招募', x + CW / 2, sty);
    } else if ((def.unlock || {}).type === 'stage') {
      ctx.fillStyle = on ? UI.gold : '#ffe6a8';
      ctx.fillText(on ? 'Enter 招募（免费）' : '招募免费', x + CW / 2, sty);
    } else {
      const price = (def.unlock && def.unlock.price) || 0;
      const can = SAVE.coins >= price;
      ctx.fillStyle = can ? (on ? UI.gold : '#ffe6a8') : 'rgba(255,107,107,0.85)';
      ctx.fillText('招募 ' + price + ' 金币' + (can ? '' : '（差 ' + (price - SAVE.coins) + '）'), x + CW / 2, sty);
    }
  }

  operatorStats(CHAR_LIST[idx]);
  uiHint('← → 选择干员　Enter 出战 / 招募　Esc 返回大厅');
  uiToast();
}

/* 六个乘区摊开写：玩家要能直接看到「换人到底换了什么」 */
function operatorStats(def) {
  const X = 58, Y = 552, PW = 1164, PH = 92;
  uiPanel(X, Y, PW, PH, 14);

  const rows = [
    ['生命', def.hpMul, 'x'], ['移速', def.speedMul, 'x'], ['伤害', def.dmgMul, 'x'],
    ['换弹', def.reloadMul, 'x'], ['散布', def.spreadMul, 'x'], ['护甲', def.armorAdd, '+']
  ];
  for (let i = 0; i < rows.length; i++) {
    const [lab, v, unit] = rows[i];
    const x = X + 30 + i * 190;
    /* 判定好坏：换弹/散布是「越小越好」，其余越大越好 */
    const better = (lab === '换弹' || lab === '散布') ? v < 1 : (unit === '+' ? v > 0 : v > 1);
    const worse = (lab === '换弹' || lab === '散布') ? v > 1 : (unit === '+' ? v < 0 : v < 1);
    ctx.textAlign = 'left';
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(lab, x, Y + 34);
    ctx.font = 'bold 19px ' + UI.font;
    ctx.fillStyle = better ? UI.green : (worse ? '#ff9b8a' : '#cfdbe4');
    const txt = unit === '+' ? ('+' + Math.round(v * 100) + '%') : (v.toFixed(2) + 'x');
    ctx.fillText(txt, x, Y + 62);
  }

  /* 说明文字压到数值行下面（Y+84），不再和「散布 / 护甲」抢同一行高度。
     内容必须对玩家有用：告诉他绿/红是什么意思、什么时候生效。 */
  ctx.textAlign = 'right';
  ctx.font = '11px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.7)';
  ctx.fillText('绿字=比标准兵强　红字=更弱　·　换弹与散布越低越好　·　选定后下一局出击生效', X + PW - 30, Y + 84);
}

/* ---------------- 档案 ----------------
   存档里有什么，这里就显示什么 —— 这一页是「数据联动」的自检面板：
   金币在顶栏、等级在这里、通关记录在中栏、剧情回放在底栏，
   任何一处不同步，玩家一眼就能看出来。
   ---------------------------------------- */
function drawArchive() {
  drawBackground();
  overlay(0.86);
  uiTopBar('档案');

  /* --- 左：四项生涯统计 --- */
  uiPanel(40, 104, 560, 362, 14);

  /* 面板头：左边一句标题，右边战区星数（上限 = 关数 × 3）。
     放在 104~144 这段原本空着的 40px 里，不动下面 2×2 的四格节奏。 */
  ctx.textAlign = 'left';
  ctx.font = '11px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.7)';
  ctx.fillText('生 涯 统 计', 64, 126);
  const ts = (typeof totalStars === 'function') ? Math.round(+totalStars() || 0) : 0;
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px ' + UI.font;
  ctx.fillStyle = ts > 0 ? UI.gold : 'rgba(143,166,182,0.65)';
  ctx.fillText('战区星数 ' + ts + ' / ' + (MAX_STAGE * 3), 576, 126);
  ctx.textAlign = 'left';

  const stats = [
    ['等级', 'Lv.' + SAVE.level, SAVE.level >= MAX_LEVEL ? '已满级' : ('经验 ' + SAVE.xp + ' / ' + xpNeed(SAVE.level)), UI.cyan],
    ['累计击杀', String(SAVE.totalKills), '所有场次的敌人总数', UI.red],
    ['最高分', String(SAVE.bestScore), '单局最高得分', UI.gold],
    ['出击次数', String(SAVE.runs), '含失败与重打', UI.green]
  ];
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2, row = (i / 2) | 0;
    const x = 64 + col * 268, y = 128 + row * 168;
    ctx.textAlign = 'left';
    ctx.font = '13px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(stats[i][0], x, y + 16);
    ctx.font = 'bold 40px ' + UI.font;
    ctx.fillStyle = stats[i][3];
    ctx.fillText(stats[i][1], x, y + 66);
    ctx.font = '12px ' + UI.font;
    ctx.fillStyle = 'rgba(143,166,182,0.8)';
    ctx.fillText(stats[i][2], x, y + 92);
  }

  /* 两排之间补一条极淡的分隔线：40px 的大数字占住了上下两头，
     中间 76px 的空白不画点东西，面板看起来像少了半张图。 */
  ctx.strokeStyle = 'rgba(120,180,235,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 258.5);
  ctx.lineTo(576, 258.5);
  ctx.stroke();

  /* 经验条：和顶栏是同一份数据，只是这里给足宽度 */
  const bx = 64, bw = 512, by = 424;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(bx, by, bw, 12, 6); ctx.fill();
  const ratio = SAVE.level >= MAX_LEVEL ? 1 : clamp(SAVE.xp / xpNeed(SAVE.level), 0, 1);
  ctx.fillStyle = SAVE.level >= MAX_LEVEL ? UI.green : UI.cyan;
  roundRect(bx, by, Math.max(6, bw * ratio), 12, 6); ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = '12px ' + UI.font;
  ctx.fillStyle = UI.mute;
  ctx.fillText(SAVE.level >= MAX_LEVEL ? '满级' : ('升到 Lv.' + (SAVE.level + 1) + ' 还需 ' + (xpNeed(SAVE.level) - SAVE.xp) + ' 经验'), bx, by + 32);

  /* --- 右：通关记录 --- */
  uiPanel(624, 104, 616, 362, 14);
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px ' + UI.font;
  ctx.fillStyle = UI.ink;
  ctx.fillText('通关记录', 650, 136);

  for (let s = 1; s <= MAX_STAGE; s++) {
    const y = 160 + (s - 1) * 56;
    const done = SAVE.cleared.indexOf(s) >= 0;
    const unlocked = s <= SAVE.maxStage;
    const th = STAGE_THEMES[(s - 1) % STAGE_THEMES.length] || { name: '—' };

    ctx.fillStyle = done ? 'rgba(126,240,176,0.10)' : 'rgba(255,255,255,0.04)';
    roundRect(650, y, 564, 46, 8); ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = 'bold 15px ' + UI.font;
    ctx.fillStyle = unlocked ? '#e8f0f6' : 'rgba(232,240,246,0.30)';
    ctx.fillText('第 ' + s + ' 关 · ' + th.name, 668, y + 29);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13px ' + UI.font;
    if (done) { ctx.fillStyle = UI.green; ctx.fillText('√ 已通关', 1192, y + 29); }
    else if (unlocked) { ctx.fillStyle = UI.mute; ctx.fillText('未通关', 1192, y + 29); }
    else { ctx.fillStyle = 'rgba(143,166,182,0.4)'; ctx.fillText('未解锁', 1192, y + 29); }

    /* 每关三颗星：12px，摆在名字与右侧状态之间那段空白里。
       未解锁的关画空星，让「这一关有几颗能拿」从第一关就说得清。 */
    const ss = hudStageStars(s);
    const ks = ['clear', 'time', 'hp'];
    for (let k = 0; k < 3; k++) {
      const lit = !!ss[ks[k]];
      drawStar(1072 + k * 22, y + 23, 6, lit, lit ? UI.gold : null, lit ? 7 : 0);
    }
  }

  /* --- 底：剧情回放 + 清档 ---
     5 关各有一条剧情，所以这里排 5 格；清档块只需要两行字，
     把宽度让给回放格，1~5 的数字键才和屏幕上的格子一一对上。 */
  uiPanel(40, 486, 890, 146, 14);
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px ' + UI.font;
  ctx.fillStyle = UI.ink;
  ctx.fillText('剧情回放', 66, 518);

  for (let s = 1; s <= MAX_STAGE; s++) {
    const x = 66 + (s - 1) * 170;
    const has = !!storyFor(s);
    const seen = storySeen(s);
    ctx.fillStyle = has ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
    roundRect(x, 534, 158, 76, 10); ctx.fill();
    ctx.strokeStyle = has ? 'rgba(120,180,235,0.28)' : 'rgba(120,180,235,0.10)';
    ctx.lineWidth = 1; ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 13px ' + UI.font;
    ctx.fillStyle = has ? UI.gold : 'rgba(143,166,182,0.4)';
    ctx.fillText(s + '　第 ' + s + ' 关', x + 12, 560);
    ctx.font = '11px ' + UI.font;
    ctx.fillStyle = UI.mute;
    ctx.fillText(has ? (seen ? (storyFor(s).length + ' 句 · 已看过') : (storyFor(s).length + ' 句 · 未看过')) : '暂无剧情', x + 12, 584);
  }

  uiPanel(950, 486, 290, 146, 14, game.confirmReset);
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px ' + UI.font;
  ctx.fillStyle = game.confirmReset ? UI.red : UI.ink;
  ctx.fillText('清空存档', 976, 518);
  uiWrap(game.confirmReset ? '再按一次 R 立即清空：金币、等级、武器、干员、关卡进度全部归零，无法撤销。'
    : '按 R 清空存档：金币 / 等级 / 武器 / 干员 / 关卡进度全部归零。', 976, 548, 238, 20, 13,
    game.confirmReset ? '#ffb3a8' : '#a9bccb');

  uiHint('1~5 回放剧情　R 清空存档　Enter 或 Esc 返回大厅');
  uiToast();
}

/* rows：可选的结算明细（本局金币 / 升级 / 过关奖励），
   卡片高度不变，明细挤在副标题和按键提示之间 —— 结算页最该看清的
   不是「你死了」，而是「这一把赚了多少、长了多少」。 */
function drawCenterCard(title, titleColor, sub, tip, rows) {
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
  ctx.fillText(title, W / 2, H / 2 - 76);

  ctx.font = '17px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#cfdbe4';
  ctx.fillText(sub, W / 2, H / 2 - 34);

  if (rows && rows.length) {
    const step = rows.length > 2 ? 26 : 30;
    for (let i = 0; i < rows.length; i++) {
      const y = H / 2 + 6 + i * step;
      ctx.font = '15px "Microsoft YaHei",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#8fa6b6';
      ctx.fillText(rows[i][0], W / 2 - 10, y);
      ctx.textAlign = 'left';
      ctx.font = 'bold 16px "Microsoft YaHei",sans-serif';
      ctx.fillStyle = rows[i][2] || '#ffd166';
      ctx.fillText(rows[i][1], W / 2 + 10, y);
    }
  }

  ctx.textAlign = 'center';
  ctx.font = 'bold 18px "Microsoft YaHei",sans-serif';
  ctx.fillStyle = (Math.floor(game.time * 1.6) % 2 === 0) ? '#ffd166' : 'rgba(255,209,102,0.35)';
  ctx.fillText(tip, W / 2, H / 2 + 112);
}

function render() {
  /* 菜单页必须先分派：这六种状态里没有 player，
     漏一个就会掉进下面的 !player 短路，整页只剩一块背景。 */
  if (game.state === 'title') { drawTitle(); return; }
  if (game.state === 'lobby') { drawLobby(); return; }
  if (game.state === 'deploy') { drawDeploy(); return; }
  if (game.state === 'armory') { drawArmory(); return; }
  if (game.state === 'operators') { drawOperators(); return; }
  if (game.state === 'archive') { drawArchive(); return; }
  if (game.state === 'story') { drawStory(); return; }

  if (!player) { drawBackground(); return; }

  ctx.save();
  const sh = camera.shake;
  if (sh > 0.2) ctx.translate(rand(-sh, sh), rand(-sh, sh) * 0.7);

  /* 世界层：整体缩放（震屏之后再缩放，保证抖动幅度一致） */
  ctx.translate(0, CAM_TY);
  ctx.scale(VIEW_ZOOM, VIEW_ZOOM);

  drawBackground();
  drawPlatforms();
  drawProps();
  drawCovers();
  drawBlocks();
  drawHazardBases();   /* 地刺 / 喷火口的铁口贴地画 */
  drawFire();          /* 火焰地带贴地画，必须压在士兵脚下 */
  drawPickups();
  drawGrenades();

  /* 尸体压在活人下面：人踩在尸体上走过去，不会「浮」在尸堆上面 */
  drawCorpses();

  for (const e of enemies) drawEnemy(e);
  if (buddy) drawSoldier(buddy, true);
  if (player) drawSoldier(player, false);

  drawHazardFire();    /* 火柱盖在人身上，才有被吞进火里的感觉 */
  drawBullets();
  drawEffects();
  drawDecals();
  ctx.restore();

  drawThemeGrade();
  drawVignette();

  /* 结算 / 失败页只留卡片：战场上的击杀计数、波次横幅、剩余敌人、
     队友面板要是还在跑，一是跟卡片抢注意力（420ms 后遮罩才盖上来，
     遮罩底下那行「第 1 波 · 敌军 5 人」还是亮的），二是自相矛盾 ——
     人都过关了，屏幕上还写着「敌军 5 人」。 */
  const inEnd = game.state === 'stageclear' || game.state === 'gameover';
  if (!inEnd) {
    drawHUD();
    drawBossBar();
    if (game.state !== 'title') drawAIPanel();
  }
  drawBossIntro();
  drawScreenFlash();

  if (game.state === 'playing') {
    drawCrosshair();
    drawReloadRing();   /* 换弹环叠在准星外圈，两者共用 input.mx/my */
  }
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
    const last = game.stage >= MAX_STAGE;
    const nt = STAGE_THEMES[game.stage % STAGE_THEMES.length];
    drawCenterCard('第 ' + game.stage + ' 关 完成', '#7ef0b0',
      '击杀 ' + game.kills + '　得分 ' + game.score,
      last ? '全部战区已清空 · 按 Enter 回大厅' : ('按 Enter 进入第 ' + (game.stage + 1) + ' 关 · ' + (nt ? nt.name : '下一战区')),
      [
        ['本关金币', '+' + game.earned, '#ffe6a8'],
        ['过关奖励', '+' + game.clearBonus + '（含残血加成）', '#7ef0b0'],
        game.levelUps > 0 ? ['升级', 'Lv.' + SAVE.level + '　+生命 / +护甲', '#78e2ff']
          : ['经验', '+' + game.xpGain + '　累计 ' + SAVE.xp + ' / ' + xpNeed(SAVE.level), '#9fb4c4']
      ]);
    /* 评级牌与三星挂在卡片两侧，不动卡片里现成的击杀/金币/经验排版 */
    drawClearRating();
  }
  if (game.state === 'gameover') {
    drawCenterCard('任务失败', '#ff6b6b',
      '你在第 ' + game.stage + ' 关第 ' + Math.max(1, game.wave) + ' 波倒下，大肥鱼没能赶上',
      '按 Enter 重新挑战本关　Esc 回大厅',
      [
        ['本局金币', '+' + game.earned + '（失败也保留）', '#ffe6a8'],
        ['当前等级', 'Lv.' + SAVE.level + '　护甲 ' + Math.round(levelArmor(SAVE.level) * 100) + '%', '#78e2ff']
      ]);
  }
}

/* ==================================================================
   结算页：左侧评级牌 + 右侧三星
   ------------------------------------------------------------------
   结算卡本体 560×280 居中（360~920），卡片里已经被击杀/得分/金币/
   经验占满了，再往里塞东西必然压字。所以评级与三星各占一侧的
   164×130 竖条：176~340 与 940~1104，加上卡片正好 928 宽、左右对称，
   与卡片留 20px 呼吸。竖向对齐卡片中线（360）。
   计时用 _clearT（进结算后累加），只服务这一页的入场动画。
   ================================================================== */
const GRADE_COLOR = { S: '#ffd166', A: '#b9d9f2', B: '#d08a4a', C: '#9aa8b4' };
let _clearT = 0;

function drawClearRating() {
  const grade = GRADE_COLOR[game.grade] ? game.grade : 'C';
  const st = game.stars || {};
  const keys = ['clear', 'time', 'hp'];
  const fallback = ['完成战区', '限时通关', '保存战力'];
  const goals = (typeof stageGoals === 'function') ? stageGoals(game.stage) : null;
  const names = fallback.slice();
  if (goals && goals.length) {
    for (let i = 0; i < 3 && i < goals.length; i++) {
      if (goals[i] && goals[i].name) names[i] = goals[i].name;
    }
  }

  /* 164 → 196：三个 4 字标签（完成战区 / 限时通关 / 保存战力）在
     164 宽的面板里只能分到 46px 一格，字宽 38px —— 标签间距实测只剩 4px，
     一句「完成战区 限时通关 保存战力」会读成连成一串的十二个字。
     加宽到 196、星距 46 → 56 之后，每格 56px，标签之间留出 18px 呼吸。
     面板宽度由 LX/SX 反推，左右仍然对称。 */
  const PW = 196, PH = 130, PY = H / 2 - PH / 2;
  const LX = W / 2 - 280 - 20 - PW;    /* 176 */
  const SX = W / 2 + 280 + 20;         /* 940 */

  /* 入场：0.22s 淡入，右侧三星比左侧晚 0.08s */
  const aL = clamp(_clearT / 0.22, 0, 1);
  const aS = clamp((_clearT - 0.08) / 0.22, 0, 1);
  const dyL = (1 - aL) * 8;

  ctx.save();
  ctx.globalAlpha = aL;
  uiPanel(LX, PY + dyL, PW, PH, 12, grade === 'S');
  ctx.textAlign = 'center';
  ctx.font = 'bold 64px ' + UI.font;
  const col = GRADE_COLOR[grade];
  if (grade === 'S') {
    ctx.save();
    ctx.shadowColor = 'rgba(255,209,102,0.85)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = col;
    ctx.fillText(grade, LX + PW / 2, PY + dyL + 82);
    ctx.restore();
  }
  ctx.fillStyle = col;
  ctx.fillText(grade, LX + PW / 2, PY + dyL + 82);
  ctx.font = '11px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.85)';
  ctx.fillText('本次评级', LX + PW / 2, PY + dyL + 108);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = aS;
  uiPanel(SX, PY, PW, PH, 12);
  /* 26px 星，中心间距 56：三颗跨度 112，两侧各留 42，标签有 56 的格子放 */
  const cy = PY + 44;
  let got = 0;
  for (let i = 0; i < 3; i++) {
    const cx2 = SX + PW / 2 + (i - 1) * 56;
    const on = !!st[keys[i]];
    if (on) got++;
    /* 逐个点亮：0.25s 起，每颗隔 0.4s，0.24s 内弹到位 */
    const k = clamp((_clearT - 0.25 - i * 0.4) / 0.24, 0, 1);
    if (on) drawStar(cx2, cy, 13 * (0.55 + 0.45 * easeBack(k)), true, '#ffd166', 14 * k);
    else drawStar(cx2, cy, 13, false, null, 0);
    drawFitText(names[i], cx2, PY + 78, 56, 9.5, on ? 'rgba(255,214,150,0.92)' : 'rgba(143,166,182,0.75)');
  }
  ctx.textAlign = 'center';
  ctx.font = '10px ' + UI.font;
  ctx.fillStyle = 'rgba(143,166,182,0.7)';
  ctx.fillText('达成 ' + got + ' / 3', SX + PW / 2, PY + 108);
  ctx.restore();
}

/* ==================================================================
   武器改装（U）
   ------------------------------------------------------------------
   契约在 meta.js：weaponLv / upgradeCost / upgradeWeapon，
   任意一个没落地都要能按下去不炸、且给玩家一句人话。

   按键派发在 game.js 的 armoryKeys 里。本轮 hud.js 独占文件，
   所以用一个「无侵入包装」补上 KeyU：原函数原样调用，返回什么就返回什么，
   只多接一个分支。两条自我保护：
     1) `__hudU` 标记 —— 重复打包 / 二次执行都不会套两层；
     2) 原函数源码里一旦出现 KeyU（说明整合时已经搬进 game.js），
        本包装立刻退化成纯转发，绝不会「按一次升两级」。
   整合建议：把 KeyU 分支搬进 game.js 的 armoryKeys，然后删掉这个包装。
   ================================================================== */
function armoryUpgradeSelected() {
  const w = WEAPONS[clamp(game.menu2, 0, WEAPONS.length - 1)];
  if (!w) return;
  if (!isUnlocked(w.id)) { toast('先购买这把枪'); return; }
  if (typeof upgradeWeapon !== 'function') { toast('改装系统未启用'); return; }
  const r = upgradeWeapon(w.id) || {};
  toast(r.msg || (r.ok ? '改装完成' : '改装失败'));
  if (r.ok) {
    if (typeof saveNow === 'function') saveNow();
    beep(700, 0.09, 'sine', 0.045, 980);
  } else {
    beep(180, 0.09, 'square', 0.03, 140);
  }
}

(function hookArmoryUpgradeKey() {
  if (typeof armoryKeys !== 'function' || armoryKeys.__hudU) return;
  const base = armoryKeys;
  const owned = String(base).indexOf('KeyU') < 0;   /* 原函数没接管才补 */
  const wrapped = function (code) {
    const r = base(code);
    if (owned && code === 'KeyU') armoryUpgradeSelected();
    return r;
  };
  wrapped.__hudU = true;
  armoryKeys = wrapped;
})();

/* ---------------- 主循环 ---------------- */
let _last = performance.now();
/* 渲染层也需要知道这一帧过了多久（血条平滑、横幅计时都要用） */
let _dt = 0;
/* 帧号：绘制期算姿态（起步倾角、呼吸）时用来「一帧只更新一次」。
   同一帧里 fireWeapon（子弹起点）和 render（画枪）都要问姿态，
   没有这道闸门，加速度会被积分两遍，人和子弹就会各走各的。 */
let _frameNo = 0;

function frame(ts) {
  let dt = (ts - _last) / 1000;
  _last = ts;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);
  _dt = dt;
  _frameNo++;

  /* 音频每帧一次（E 纵队写在 util.js）：程序化 BGM 的步进要靠它推，
     缺函数时静默跳过 —— 声音永远不会把游戏拦下来。 */
  if (typeof audioTick === 'function') audioTick(dt);

  /* 结算页的入场计时：只在 stageclear 累加，其余状态归零，
     这样重进结算页时评级牌与三星会重新演一遍。 */
  if (game.state === 'stageclear') _clearT += dt; else _clearT = 0;

  if (game.state === 'playing') {
    update(dt);
  } else {
    game.time += dt;
    /* 菜单里的 toast 与剧情逐字都挂在这个时钟上：
       剧情页不跑 update，不在这里推进就永远只有一个字。 */
    game.toastT = Math.max(0, game.toastT - dt);
    if (game.state === 'story') advanceDialog(dt);
    sayCooldown = Math.max(0, sayCooldown - dt);
    if (game.state !== 'title') updateEffects(dt);

    /* BOSS 击破的慢动作 / 白闪 / 入场横幅在结算卡片上必须继续走完，
       否则玩家在 stageclear 界面会看到一片永久残留的白屏。 */
    if (game.slowmo > 0) game.slowmo = Math.max(0, game.slowmo - dt);
    game.screenFlash = Math.max(0, (game.screenFlash || 0) - dt * 1.5);
    if (game.bossIntro) {
      game.bossIntro.t += dt;
      if (game.bossIntro.t >= game.bossIntro.dur) game.bossIntro = null;
    }
  }

  render();
  requestAnimationFrame(frame);
}

resizeCanvas();
requestAnimationFrame(frame);
