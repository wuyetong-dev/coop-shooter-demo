'use strict';

/* ==================================================================
   游戏层：状态机 / 玩家操作 / 波次 / 实体更新 / 摄像机
   ================================================================== */

const game = {
  state: 'title',           // title|lobby|armory|operators|archive|story|playing|paused|stageclear|gameover|victory
  stage: 1,
  wave: 0,
  maxWave: 5,
  spawnQueue: [],
  spawnTimer: 0,
  waveDelay: 0,
  waveActive: false,
  kills: 0,
  score: 0,
  time: 0,
  totalKills: 0,
  msg: '',
  msgTimer: 0,
  buddyDownAt: -99,
  grenadeCd: 0,
  combo: 0,
  comboTimer: 0,
  /* ---- 战斗节奏（A 纵队写入，渲染层只读） ----
     这些字段全部由本文件维护，HUD / render 只负责画。读的时候一律
     (game.x || 0) —— 存档旧档进不来，但跨模块契约要求这么写。 */
  hitStop: 0,             /* 定帧剩余时长（秒），> 0 时世界时间缩到 0.10 倍 */
  comboMax: 0,            /* 本局最高连杀（结算页展示） */
  hurtDir: 0,             /* 受击方向：-1 左 / 0 无 / 1 右 */
  hurtFx: 0,              /* 受击反馈强度 0..1，每帧衰减，HUD 画红边 */
  tutorialT: 0,           /* 新手引导提示剩余秒数 */
  stars: { clear: false, time: false, hp: false },   /* 三星明细 */
  grade: '-',             /* 评级 S / A / B / C */
  _taught: false,         /* 本次会话是否已经给过新手引导（不进存档） */
  /* ---- 元层联动（meta.js 的 SAVE 是唯一真相，这里是本局镜像） ---- */
  earned: 0,              // 本局金币收入（击杀 + 过关奖励）
  xpGain: 0,              // 本局经验
  level: 1,               // 本局实时等级
  levelUps: 0,            // 本局升级次数
  clearBonus: 0,          // 过关奖励（结算页展示）
  charId: 'hero',
  /* ---- 菜单状态 ---- */
  menu: 0,                // 大厅选中的入口下标
  menu2: 0,               // 二级页面（武器库 / 干员）选中的行下标
  pickStage: 1,           // 出击页选中的关卡
  dialog: null,           // 剧情对话运行时状态
  toast: '',              // 菜单内的临时提示（买不起 / 已装备）
  toastT: 0,
  /* ---- BOSS 演出状态 ---- */
  slowmo: 0,              /* > 0 时世界时间放慢（击破特写） */
  screenFlash: 0,         /* 全屏白闪强度 */
  bossIntro: null,        /* { t, dur, name, tag, accent } 入场横幅 */
  /* 大肥鱼作战数据（HUD 战术面板用，全部是真实统计，不是装饰） */
  tele: { decisions: 0, dodges: 0, grenades: 0, buddyShots: 0, buddyHits: 0, buddyDmg: 0, buddyKills: 0, playerKills: 0 }
};

let aiPanelOpen = true;

/* ---------------- 菜单提示 ---------------- */
function toast(text) {
  game.toast = text;
  game.toastT = 1.8;
}

/* 连杀里程碑：只有这四个数会弹头顶提示。
   挑的是「3 连有点意思、5 连开始爽、8 连开始飘、12 连正好封顶」四个心理点。 */
const COMBO_MILESTONES = [3, 5, 8, 12];

/* ---------------- 关卡启动 ---------------- */
function startStage(stage) {
  game.stage = stage;
  buildStage(stage);

  enemies = []; bullets = []; grenades = []; pickups = [];
  particles = []; texts = []; casings = []; decals = []; fires = []; corpses = [];

  player = createPlayer(220);
  buddy = createBuddy(150);
  buddy.cmd = 'follow';
  buddy.holdX = 150;

  /* 本局镜像：等级 / 经验从存档来，本局内的成长直接写回存档（meta.js） */
  game.level = SAVE.level;
  game.xpGain = 0;
  game.earned = 0;
  game.levelUps = 0;
  game.charId = SAVE.charId;

  game.wave = 0;
  game.kills = 0;
  game.spawnQueue = [];
  game.spawnTimer = 0;
  game.waveDelay = 1.2;
  game.waveActive = false;
  game.grenadeCd = 0;
  game.slowmo = 0;
  game.screenFlash = 0;
  game.bossIntro = null;

  /* 战斗节奏：上局的定帧 / 连杀 / 受击反馈 / 评级一律清零 ——
     不清的话重开一关会带着上局的「红边 + 连杀数」进场。 */
  game.hitStop = 0;
  game.combo = 0;
  game.comboTimer = 0;
  game.comboMax = 0;
  game.hurtDir = 0;
  game.hurtFx = 0;
  game.stars = { clear: false, time: false, hp: false };
  game.grade = '-';

  /* 新手引导：本次会话第一次进战斗，或者存档里一个人都还没杀过 —— 给 9 秒提示。
     用 _taught 记「这次开浏览器已经教过」，所以第二关起不再弹；
     而 totalKills === 0 是「新档」的信号，读档重开也还该教一遍。 */
  game.tutorialT = (!game._taught || SAVE.totalKills === 0) ? 9 : 0;
  game._taught = true;

  game.msg = '第 ' + stage + ' 关 · ' + (world.theme ? world.theme.name : '出发');
  game.msgTimer = 2.0;

  game.tele = { decisions: 0, dodges: 0, grenades: 0, buddyShots: 0, buddyHits: 0, buddyDmg: 0, buddyKills: 0, playerKills: 0 };

  camera.x = 0;
  camera.shake = 0;
  game.state = 'playing';
  /* 声音模式：进战斗切到战斗层（声音纵队在 util.js 落地，没落地就跳过） */
  if (typeof audioMode === 'function') audioMode('combat');
  say('buddy', '我跟着你，你打哪我打哪。');
}

/* ==================================================================
   元层流程：击杀结算 / 升级 / 页面路由
   —— 这一节是「关卡之间」的逻辑，和战斗更新完全分开写，
      好处是调经济/调曲线不需要碰 update 里的任何一行。
   ================================================================== */

/* 击杀结算：金币进存档（软写，落盘留给结算），经验立刻判等级。
   同时这里是「打击感」的唯一入口：定帧、连杀、里程碑提示全在这一次调用里做完，
   因为 world.js 的 killEnemy 是击杀的唯一链路，别处没有第二遍。 */
function onKillReward(e) {
  const t = ENEMY_TYPES[e.type] || {};
  const coin = t.coin || 2;
  const xp = t.xp || 6;
  grantCoinsSoft(coin);
  game.earned += coin;
  game.xpGain += xp;
  const ups = grantXp(xp);
  game.level = SAVE.level;
  if (ups > 0) applyLevelUp(ups);

  /* ---- 连杀：先记账，再按新连杀数算加成 ---- */
  game.combo = (game.combo || 0) + 1;
  game.comboTimer = 2.6;
  if (game.combo > (game.comboMax || 0)) game.comboMax = game.combo;

  /* 加成只给分数，不碰金币：金币是内容纵队的经济账，节奏纵队不掺和。
     killEnemy 已经加过一次基础分（在 world.js 里，我不能改），
     所以这里只补「加成的那一份」，否则同一只怪会被算两次分。
     8% × 连杀数，封顶 12 连（≈ +96%），再往上收益递减就不再给了。 */
  const baseScore = t.score || 10;
  const bonusK = 0.08 * Math.min(game.combo, 12);
  if (bonusK > 0) game.score += Math.round(baseScore * bonusK);

  /* ---- 定帧：击杀瞬间把世界时间压到 10%，制造「顿一下」的冲击感 ----
     BOSS 更重但必须更短 —— 停太久会被当成掉帧；0.09 是上限，
     免得盖过 killEnemy 里那段 1.15 秒的击破慢动作。 */
  if (e.boss) {
    game.hitStop = Math.min(0.09, Math.max(game.hitStop || 0, 0.085));
  } else {
    game.hitStop = Math.max(game.hitStop || 0, 0.055);
  }

  /* ---- 里程碑提示：只在「跨过门槛那一帧」刷 ----
     这里用值相等而不是 >=：清波时几十只怪同帧死，用 >= 会刷出一屏
     「连杀 x5」。相等判断天然去重，而且连杀数只会 +1，不跳号。 */
  const p = player;
  if (p && !p.downed && COMBO_MILESTONES.indexOf(game.combo) >= 0) {
    spawnText(p.x, p.y - p.h - 26, '连杀 x' + game.combo, '#ffd166',
      { size: 1.15, life: 1.1, vy: -52 });
  }
}

/* 升级即时生效：玩家当场就能感觉到血条变长、掉血变慢。
   注意 maxHp 是「按新等级重算」而不是「在旧值上累加」——
   否则连升两级会把干员系数乘两次。 */
function applyLevelUp(ups) {
  game.levelUps += ups;
  game.level = SAVE.level;
  const p = player;
  if (!p) return;
  const def = charDef(SAVE.charId);
  const newMax = Math.round(levelHp(SAVE.level) * (def.hpMul || 1));
  const gain = newMax - p.maxHp;
  p.maxHp = newMax;
  if (gain > 0) p.hp = Math.min(p.maxHp, p.hp + gain);
  p.armor = Math.min(0.60, levelArmor(SAVE.level) + (def.armorAdd || 0));

  spawnText(p.x, p.y - p.h - 36, 'Lv.' + SAVE.level + '　生命 +' + Math.max(0, gain), '#7ef0b0',
    { size: 1.35, life: 1.9, vy: -46 });
  spawnText(p.x, p.y - p.h - 14, '护甲 ' + Math.round(p.armor * 100) + '%', '#9fd8ff',
    { size: 1.0, life: 1.9, vy: -34 });
  spawnParticles(p.x, p.y - p.h * 0.5, 28, '#7ef0b0', 300, 0.75, 4.2, 380);
  game.screenFlash = Math.max(game.screenFlash || 0, 0.18);
  beep(720, 0.10, 'sine', 0.05, 1080);
  say('buddy', '你这家伙……又变硬了。');
  saveNow();
}

/* 过关结算：金币 = 固定过关奖励 + 残血奖励，然后一次性写盘 */
function commitStageClear() {
  const p = player;

  /* ---- 三星：判定规则交给 meta.js 的 computeStars（时间 / 残血 / 通关三把尺），
     这里只负责「把结果落到本局」。结算页、档案页都读 game.stars，不各算一套。
     没落地时回落到「通关即一星」——宁可少给星，也不要显示三个空框。 ---- */
  const hpRatio = p && p.maxHp > 0 ? p.hp / p.maxHp : 1;
  game.stars = (typeof computeStars === 'function')
    ? computeStars(game.stage, { cleared: true, timeSec: game.time, hpRatio: hpRatio })
    : { clear: true, time: false, hp: false };
  const got = (game.stars.clear ? 1 : 0) + (game.stars.time ? 1 : 0) + (game.stars.hp ? 1 : 0);
  game.grade = got >= 3 ? 'S' : (got === 2 ? 'A' : (got === 1 ? 'B' : 'C'));

  const hpBonus = p ? Math.round((p.hp / p.maxHp) * 40) : 0;
  const clearBonus = 80 * game.stage;
  grantCoinsSoft(clearBonus + hpBonus);
  game.earned += clearBonus + hpBonus;
  game.clearBonus = clearBonus + hpBonus;

  if (SAVE.cleared.indexOf(game.stage) < 0) SAVE.cleared.push(game.stage);
  /* 封顶在 MAX_STAGE：第 5 关打完 maxStage 仍是 5，选关页就不会多出
     一个「第 6 关」的空壳 —— 它和 buildStage 的 clamp 必须一致。 */
  if (game.stage + 1 > SAVE.maxStage) SAVE.maxStage = Math.min(MAX_STAGE, game.stage + 1);
  SAVE.totalKills += game.kills;
  SAVE.bestScore = Math.max(SAVE.bestScore, game.score);
  SAVE.runs++;
  saveNow();
  if (typeof audioMode === 'function') audioMode('result');
}

/* 失败也保留已到手的金币，但不算通关。
   评级同样写回：三星全灭 + C —— 结算页读的是 game.stars，不是「有没有调过」。 */
function commitGameOver() {
  game.stars = { clear: false, time: false, hp: false };
  game.grade = 'C';
  SAVE.totalKills += game.kills;
  SAVE.bestScore = Math.max(SAVE.bestScore, game.score);
  SAVE.runs++;
  saveNow();
}

/* ---------------- 页面路由 ---------------- */
function goLobby() {
  game.state = 'lobby';
  game.menu2 = 0;
  game.dialog = null;
  game.msgTimer = 0;
  game.pickStage = clamp(game.pickStage || 1, 1, SAVE.maxStage);
  enemies = []; bullets = []; grenades = []; pickups = [];
  particles = []; texts = []; casings = []; decals = []; fires = []; corpses = [];
  player = null; buddy = null;
  flushSave();
  if (typeof audioMode === 'function') audioMode('menu');
}

/* 出击：没看过的关卡剧情先播，看过的直接开打 */
function deploy(stage) {
  game.pickStage = stage;
  const lines = storyFor(stage);
  if (lines && lines.length && !storySeen(stage)) { openStory(stage, 'stage'); return; }
  startStage(stage);
}

function openStory(stage, returnTo) {
  const lines = storyFor(stage);
  if (!lines || !lines.length) {
    if (returnTo === 'stage') startStage(stage); else goLobby();
    return;
  }
  game.state = 'story';
  game.dialog = { stage: stage, idx: 0, chars: 0, lines: lines, returnTo: returnTo || 'stage' };
  markStorySeen(stage);
}

/* 逐字推进（在 frame 里调，因为剧情页不跑 update） */
function advanceDialog(dt) {
  const d = game.dialog;
  if (!d) return;
  const line = d.lines[d.idx];
  if (!line) return;
  if (d.chars < line.text.length) {
    d.chars = Math.min(line.text.length, d.chars + dt * 42);
  }
}

function dialogNext() {
  const d = game.dialog;
  if (!d) return;
  const line = d.lines[d.idx];
  if (line && d.chars < line.text.length) { d.chars = line.text.length; return; }  /* 先补全，再翻页 */
  d.idx++;
  d.chars = 0;
  if (d.idx >= d.lines.length) {
    const st = d.stage, back = d.returnTo;
    game.dialog = null;
    if (back === 'stage') startStage(st); else goLobby();
  }
}

function dialogSkip() {
  const d = game.dialog;
  if (!d) return;
  const st = d.stage, back = d.returnTo;
  game.dialog = null;
  if (back === 'stage') startStage(st); else goLobby();
}

/* ---------------- 战斗内换枪：只有主 / 副两把 ---------------- */
function switchWeapon(slot) {
  const p = player;
  if (!p) return;
  const id = SAVE[slot];
  if (!id) { game.msg = '这个槽位没有配枪'; game.msgTimer = 1.2; return; }
  const idx = weaponById(id);
  if (idx < 0 || idx === p.weapon) return;
  p.weapon = idx;
  /* 换枪打断换弹：reloading 和 reloadDur 一起清，否则 HUD 的进度环
     会挂在新枪上「继续换」，看起来像枪自己知道怎么装弹。 */
  p.reloading = 0;
  p.reloadDur = 0;
  /* 换枪要拉一下枪机，给个短硬直，避免贴脸无脑切枪 */
  p.fireCd = Math.max(p.fireCd, 0.22);
  beep(420, 0.06, 'square', 0.02, 300);
}

/* X 键快切到另一把枪（不改存档里的槽位顺序） */
function toggleWeapon() {
  const p = player;
  if (!p) return;
  const curId = WEAPONS[p.weapon] ? WEAPONS[p.weapon].id : null;
  const other = (curId === SAVE.primary) ? SAVE.secondary : SAVE.primary;
  if (!other) return;
  const idx = weaponById(other);
  if (idx < 0 || idx === p.weapon) return;
  p.weapon = idx;
  p.reloading = 0;
  p.reloadDur = 0;
  p.fireCd = Math.max(p.fireCd, 0.18);
  beep(460, 0.05, 'square', 0.02, 340);
}

/* ---------------- 波次 ---------------- */
function pickType(wave, i) {
  const r = Math.random();
  if (wave <= 1) return 'grunt';
  if (wave === 2) return r < 0.6 ? 'grunt' : 'rusher';
  if (wave === 3) return r < 0.45 ? 'grunt' : (r < 0.8 ? 'rusher' : 'gunner');
  if (wave === 4) return r < 0.30 ? 'grunt' : (r < 0.55 ? 'rusher' : (r < 0.80 ? 'gunner' : 'thrower'));
  return r < 0.24 ? 'grunt' : (r < 0.46 ? 'rusher' : (r < 0.76 ? 'gunner' : 'thrower'));
}

/* 投放方式随波次进化：先地面走进来，后面才有空降和抢高台 */
function pickMode(wave) {
  const r = Math.random();
  if (wave <= 2) return 'edge';
  if (wave <= 3) return r < 0.72 ? 'edge' : 'air';
  if (wave <= 5) return r < 0.52 ? 'edge' : (r < 0.86 ? 'air' : 'high');
  return r < 0.40 ? 'edge' : (r < 0.74 ? 'air' : 'high');
}

function beginWave() {
  game.wave++;
  const w = game.wave;
  const isBoss = w === game.maxWave;
  const count = isBoss ? 4 : Math.min(16, 3 + w * 2);

  game.spawnQueue = [];
  game.spawnTimer = 0;
  for (let i = 0; i < count; i++) {
    game.spawnQueue.push({
      type: pickType(w, i),
      at: i * 0.55 + rand(0, 0.35),
      side: Math.random() < 0.5 ? 'left' : 'right',
      mode: pickMode(w),
      done: false
    });
  }
  if (isBoss) {
    /* 每关的最终 BOSS 不一样：街区队长 / 废墟纵火者 / 指挥部典狱长 */
    const bt = bossForStage(game.stage);
    const info = ENEMY_TYPES[bt];
    game.spawnQueue.push({ type: bt, at: 1.5, side: 'right', mode: 'edge', done: false });

    /* 入场演出：警报 + 震屏 + 白闪 + 巨名横幅，和 BOSS 出场时间对齐 */
    game.bossIntro = { t: 0, dur: 2.9, name: info.name, tag: info.title || '敌方重装单位', accent: info.accent || 'red' };
    game.screenFlash = 0.34;
    addShake(10);
    sfxAlarm();
    /* 音乐层跟着切：BOSS 波的低音铺底和杂兵波是两套 */
    if (typeof audioMode === 'function') audioMode('boss');
  }

  game.waveActive = true;
  game.msg = isBoss ? ('第 ' + w + ' 波 · BOSS 出现！') : ('第 ' + w + ' 波 · 敌军 ' + (count + (isBoss ? 1 : 0)) + ' 人');
  game.msgTimer = 2.4;

  /* 大肥鱼上一波阵亡则归队 */
  if (buddy.dead) {
    buddy.dead = false;
    buddy.downed = false;
    buddy.x = player.x - 60;
    buddy.y = world.groundY;
    buddy.hp = buddy.maxHp * 0.6;
    buddy.bubble = '我回来了！';
    buddy.bubbleTimer = 2.2;
  }
  if (isBoss) say('buddy', '大块头来了，别站正面！');
  else if (w === 1) say('buddy', '敌人从两边来，稳住打。');
}

/* ------------------------------------------------------------------
   敌人投放
   规则（这是「敌人刷新位置」的还原重点）：
   1) 永远不贴脸——离玩家至少 SPAWN_MIN_D，玩家在屏幕边上时改从另一侧来
   2) 只落在实心地面或平台上，绝不卡进木箱 / 集装箱里
   3) 空降的先挂伞缓降，给你至少一秒的反应时间
   ------------------------------------------------------------------ */
const SPAWN_MIN_D = 420;

function spotFree(x, pad) {
  if (x < 70 || x > world.w - 70) return false;
  if (!groundAt(x)) return false;                      /* 深渊上方没法站人 */
  /* 落点被实体障碍占据就换地方 */
  if (blockedAt(x, world.groundY - 6, pad || 30)) return false;
  return true;
}

/* 在某一侧挑一个合法地面点；这一侧挤不下就返回 null */
function groundSpotOnSide(dir) {
  let x = dir < 0 ? camera.x - 70 : camera.x + VIEW_W + 70;
  if (dir < 0) x = Math.min(x, player.x - SPAWN_MIN_D);
  else x = Math.max(x, player.x + SPAWN_MIN_D);
  x = clamp(x, 70, world.w - 70);
  if (Math.abs(x - player.x) < SPAWN_MIN_D) return null;

  for (let k = 0; k < 26; k++) {
    const cx = clamp(x + dir * k * 34, 70, world.w - 70);
    if (spotFree(cx, 30)) return cx;
    if (cx <= 70 || cx >= world.w - 70) break;
  }
  return null;
}

/* 挑一个高处平台（中/高位，离玩家不近，宽度够站人） */
function highSpot() {
  const cand = [];
  for (const pl of world.platforms) {
    if (pl.ground) continue;
    if (pl.y > TIER_MID + 8) continue;                 /* 太低的台子没战术价值 */
    if (pl.w < 96) continue;
    const cx = pl.x + pl.w * 0.5;
    if (Math.abs(cx - player.x) < 300) continue;
    cand.push(cx);
  }
  if (!cand.length) return null;
  return cand[(Math.random() * cand.length) | 0];
}

/* 返回 { x, y, air } —— air 为真表示从天上挂伞下来 */
function pickSpawn(side, mode) {
  const dir = side === 'left' ? -1 : 1;

  if (mode === 'high') {
    const hx = highSpot();
    if (hx !== null) return { x: hx, y: camera.y - 90, air: true, high: true };
    mode = 'air';
  }

  if (mode === 'air') {
    /* 从玩家侧后方的空中落下，横向离玩家 240~540px */
    for (let t = 0; t < 16; t++) {
      const x = clamp(player.x - dir * rand(240, 540), 90, world.w - 90);
      if (Math.abs(x - player.x) > 230 && spotFree(x, 32)) {
        return { x, y: camera.y - 110, air: true };
      }
    }
    mode = 'edge';
  }

  let gx = groundSpotOnSide(dir);
  if (gx === null) gx = groundSpotOnSide(-dir);        /* 换边，绝不贴脸刷 */
  if (gx === null) {
    /* 极端地形兜底：直接甩到地图尽头 */
    gx = player.x < world.w * 0.5 ? world.w - 90 : 90;
  }
  return { x: gx, y: world.groundY, air: false };
}

function spawnEnemyAt(type, pos, stage) {
  const e = createEnemy(type, clamp(pos.x, 40, world.w - 40), stage);
  if (pos.air) {
    e.y = pos.y;
    e.vy = 60;
    e.onGround = false;
    e.chute = 1;                                       /* 挂伞缓降 */
    e.chuteVis = 0;
    e.state = 'drop';
    spawnParticles(e.x, e.y - 10, 5, '#cfe4ff', 90, 0.5, 2.6, 120);
  }
  enemies.push(e);
  spawnParticles(e.x, e.y - e.h * 0.5, 8, '#ffaa77', 160, 0.4, 4, 0);
}

function updateWaves(dt) {
  if (!game.waveActive) {
    game.waveDelay -= dt;
    if (game.waveDelay <= 0) {
      if (game.wave >= game.maxWave) {
        game.state = 'stageclear';
        game.score += 200 * game.stage;
        commitStageClear();
        sfxRevive();
      } else {
        beginWave();
      }
    }
    return;
  }

  /* 按时间表投放敌人 */
  game.spawnTimer += dt;
  for (let i = 0; i < game.spawnQueue.length; i++) {
    const s = game.spawnQueue[i];
    if (!s.done && game.spawnTimer >= s.at) {
      s.done = true;
      spawnEnemyAt(s.type, pickSpawn(s.side, s.mode), game.stage);
    }
  }

  const allSpawned = game.spawnQueue.every(s => s.done);
  const alive = enemies.some(e => !e.dead);
  if (allSpawned && !alive) {
    game.waveActive = false;
    game.waveDelay = 1.8;
    game.msg = '第 ' + game.wave + ' 波 清空';
    game.msgTimer = 1.6;
    if (game.wave >= game.maxWave) return;
    say('buddy', '这一波解决了，缓口气。');
  }
}

/* ---------------- 玩家 ---------------- */
function playerFire(p, wp) {
  p.mags[p.weapon]--;
  /* 蹲下更稳、趴下最稳、精确瞄准再稳；狙击枪抬枪慢但一发致命。
     bloom 是「连着打会越来越散」：机枪连射时准星会一圈圈张开，
     松手后自己收回去 —— 所以点射和扫射的手感是两回事。
     spreadMul / dmgMul 是干员系数（奇米散布 0.75、枢机伤害 0.94），
     乘在这里而不是改武器表：同一把枪换个人拿，手感差异才成立。

     趴下的收益按「静止程度」给：躺着不动 −0.82，边爬边打只剩约 −0.45 —
     爬着还能打出一个满地滚的狙击手，那就没人站着打了。 */
  const cq = cqEff(p);
  const crawling = Math.min(1, Math.abs(p.vx) / 130);
  /* 蹲行同理，但打折轻得多：蹲定 −0.55、蹲行满速只剩 −0.25。
     不照搬爬行那档（−0.45 的衰减）—— 蹲行速度本来就只有一半，
     再砍这么狠等于告诉玩家「蹲着走是错的」，那这个动作就白做了。
     现在的关系是三元交换：蹲行 = 更稳 + 更小 + 慢一半。
     站着走仍然是 1.0，所以蹲行不是无脑最优。 */
  const trudging = Math.min(1, Math.abs(p.vx) / 120);
  const proneGain = 0.82 * proneK(p) * (1 - 0.45 * crawling);
  const crouchGain = 0.55 * cq * (1 - 0.55 * trudging);
  const steady = (1 - crouchGain - proneGain - (p.ads && wp.scope ? 0.42 : 0)) * (p.spreadMul || 1);
  const spr = Math.max(0.10, steady * (1 + (p.bloom || 0)));

  /* 武器改装：meta.js 的 wStat 给的是「改装后的实际数值」，换算成乘数交给
     fireWeapon（大肥鱼也在用那个函数，所以不改它的签名，只把乘数乘进来）。
     RPG 的 dmg 是 0（伤害走 blastDmg + 132 半径溅射），必须挡住 ——
     否则 wp.dmg > 0 不成立时算出 Infinity，一发火箭能把整关清空。 */
  let dmgMulUp = 1;
  if (typeof wStat === 'function' && wp.dmg > 0) {
    const reel = wStat(wp.id, 'dmg');
    if (reel && reel > 0) dmgMulUp = reel / wp.dmg;
  }
  fireWeapon(p, wp, p.aim, spr, (p.dmgMul || 1) * dmgMulUp);
  const bloomK = proneK(p) > 0.5 ? 0.42 : (cq > 0.5 ? 0.7 : 1);
  p.bloom = Math.min(1, (p.bloom || 0) + (wp.bloom || 0) * bloomK);
  addShake(wp.recoil * 0.4 * (1 - 0.35 * cq - 0.62 * proneK(p)));
}

function updatePlayer(dt) {
  const p = player;

  /* ---- 受击检测：拿「上一帧记下的 hp」和这一帧比 ----
     伤害发生在 updatePlayer 之后的 updateEnemy / updateBullets 里（随机序），
     所以这里读到的是「上一帧有没有挨打」，差一帧肉眼看不出来，好处是
     同帧多段伤害只报一次，不会把屏幕闪成频闪灯。
     只认「掉血」：脱战自愈、升级加血都是正数，不会被误判成受击。 */
  const hpMark = p.hpMark === undefined ? p.hp : p.hpMark;
  if (p.hp < hpMark - 0.01 && !p.downed) {
    /* 方向优先取最近的活敌人 —— 打你的是谁，红边就从哪边亮。
       全场没敌人（比如被火焰 / 地刺烫到）时退回「朝向的反方向」。 */
    let src = 0;
    let bestD = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      const d = Math.abs(e.x - p.x);
      if (d < bestD) { bestD = d; src = e.x - p.x; }
    }
    game.hurtDir = src !== 0
      ? (Math.sign(src) || 0)
      : -(Math.sign(Math.cos(p.aim)) || 0);
    game.hurtFx = 1;
    /* 挨打也定一帧，但比击杀短：受击是「提醒」，不该抢走击杀的顿感 */
    game.hitStop = Math.min(0.09, Math.max(game.hitStop || 0, 0.035));
  }
  p.hpMark = p.hp;

  p.flash = Math.max(0, p.flash - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.muzzle = Math.max(0, p.muzzle - dt);
  p.airJumpT = Math.max(0, (p.airJumpT || 0) - dt);
  p.bloom = Math.max(0, (p.bloom || 0) - dt * 3.4);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.fireCd = Math.max(0, p.fireCd - dt);
  game.grenadeCd = Math.max(0, game.grenadeCd - dt);

  /* 倒地 */
  if (p.downed) {
    p.vx = lerp(p.vx, 0, 0.15);
    p.downTimer -= dt;
    p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.25);
    if (p.downTimer <= 0) {
      game.state = 'gameover';
      commitGameOver();
    }
    moveEntity(p, dt);
    return;
  }

  /* 脱战自愈（上限 55%，医疗包才能继续往上加） */
  if (game.time - (p.lastHurt || -99) > 5 && p.hp < p.maxHp * 0.55) {
    p.hp = Math.min(p.maxHp * 0.55, p.hp + 7 * dt);
  }

  /* 瞄准 */
  const mw = mouseWorld();

  /* 移动：带加速度与摩擦，有重量感但不是拖沓 */
  const left = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const down = keys['KeyS'] || keys['ArrowDown'];
  const mv = (right ? 1 : 0) - (left ? 1 : 0);

  /* ---------------- 姿态：站 / 蹲 / 趴 ----------------
     蹲：按住 S，碰撞盒 58 → 41。**可以蹲着走**，速度只剩 52%。
         这里原来是 `&& mv === 0`：蹲下就不许挪，一推方向整个人站起来。
         那是我自己加的约束，不是玩法需要 —— 蹲着挪步是这个姿态最常用
         的用法（贴掩体换位置、压枪时小范围修正），不许走等于逼玩家
         在「有掩体」和「能转身」之间二选一。
         代价必须同时给，否则蹲行变成纯赚：速度砍到 52%（见下面的 cap），
         开火的稳定收益按移动程度打折（见 playerFire 的 trudging）。
     趴：按住 Z，碰撞盒再压到 24，且可以爬（速度只剩 38%）——
         趴着不许挪动会变成「趴下就等死」，可爬又太强，
         所以这里是「爬得极慢 + 爬的时候枪口自己在晃」。
     两者互斥：趴下时蹲姿淡出，不会出现 58−17−34 叠出来的怪身高。
     抖动/散布/后坐的收益在 playerFire 里，判定盒在这里，绘制在 chars.js，
     三处都读同一套 cqEff / proneK，不会各算一套。 */
  const zHold = keys['KeyZ'];
  const wantProne = zHold && p.onGround && p.dashTime <= 0;
  const wantCrouch = down && p.onGround && p.dashTime <= 0 && !wantProne;

  /* 趴下比蹲下慢半拍：扑倒 0.24 秒、起身 0.36 秒 —— 起得慢是这个姿态的代价。
     曲线在 util.js 的 poseStep 里：扑倒是加速砸下去，起身是 S 形撑起来。

     这里原来还有一句 `if (p.prone < 0.01) p.prone = 0;`，是给旧的指数插值
     收尾用的。换成 poseStep 之后它只剩副作用：第一帧算出来是 0.0048，
     被它抹成 0 —— 按下 Z 的头 1 帧（16 毫秒）人是完全不动的。
     16 毫秒不长，但它正好落在「动作开始」的那个瞬间，读起来就是
     「按了没反应，然后突然开始倒」。poseStep 的补间在两端都精确落在
     0 / 1，不需要这个守卫了。 */
  const prStep = poseStep(p, 'prone', wantProne, dt);
  /* 着地的一拍：扬起一圈土、极轻的震屏。
     没有这一下，84.6° 转到底只是「转完了」；有了这一下，读起来才是
     「人砸在地上」。只在「从接近站姿倒下去」时触发 —— 趴着被子弹打断
     再压回去的那点抖动不该每次都扬土。 */
  if (prStep.done && prStep.dir > 0 && prStep.from < 0.4) {
    spawnParticles(p.x, p.y - 5, 7, '#c9b89a', 92, 0.32, 3.2, 620);
    addShake(1.1);
  }
  /* 蹲下也走补间（util.js 的 crouchStep）：蹲 0.16 秒砸下去、起 0.22 秒
     收一下 —— 和扑倒/起身同一族曲线。以前这里是 0.0006 的指数插值，
     快慢和趴下完全不搭：蹲是「软」，趴是「有重量」。 */
  crouchStep(p, wantCrouch, dt);

  p.h = stanceH(p, 17);
  p.hitW = stanceHitW(p);
  p.ads = !!input.aiming;

  p.aim = Math.atan2(mw.y - (p.y - p.h * 0.62), mw.x - p.x);

  if (p.dashTime > 0) {
    p.dashTime -= dt;
    p.vx = p.dashDir * 950;
    if (Math.random() < 0.7) {
      particles.push({
        x: p.x, y: p.y - p.h * 0.5, vx: -p.dashDir * rand(30, 90), vy: rand(-30, 30),
        life: 0.3, max: 0.3, color: '#8fd0ff', size: rand(3, 6), grav: 0
      });
    }
  } else {
    const accel = p.onGround ? MOVE_ACCEL : AIR_ACCEL;
    /* 姿态不同，移动上限不同：站着 100%、蹲着 52%、趴着 38%。
       这一行是「蹲着走」必须同时给的代价 —— 只放开移动不压速度，
       蹲行就变成纯赚（更小判定盒 + 更稳弹道 + 全速），没人会再站起来。
       0.48 取的是「明显慢于走、但不至于让人宁愿站起来跑」：
       蹲行走完一屏约 6 秒，站着 3 秒 —— 差别成立，又不磨人。
       cqEff 已经乘过 (1-proneK)，趴着时它归零，两档不会叠乘。 */
    const cqNow = cqEff(p);
    const cap = MOVE_SPEED * (p.speedMul || 1) * (1 - 0.48 * cqNow) * (1 - 0.62 * (p.prone || 0));
    if (mv !== 0) {
      const diff = mv * cap - p.vx;
      /* 加速也软一档：蹲着不是「小一号的跑」，是「挪」——
         瞬间满速会读成滑行，重量感全丢。 */
      const aMul = (1 - 0.45 * (p.prone || 0)) * (1 - 0.30 * cqNow);
      p.vx += clamp(diff, -accel * aMul * dt, accel * aMul * dt);
    } else {
      const fric = (p.onGround ? MOVE_FRICTION : MOVE_FRICTION * 0.3) * dt;
      p.vx = Math.abs(p.vx) <= fric ? 0 : p.vx - Math.sign(p.vx) * fric;
    }
  }

  /* 冲刺：趴着冲不起来，得先起身 —— 不然「趴着按 Shift」会让人贴着地飞出去 */
  if (keys['ShiftLeft'] || keys['ShiftRight']) {
    if (p.dashCd <= 0 && mv !== 0 && p.dashTime <= 0 && (p.prone || 0) <= 0.05) {
      p.dashTime = 0.15;
      p.dashDir = mv;
      p.dashCd = 1.0 * (p.dashCdMul || 1);
      beep(320, 0.09, 'sine', 0.03, 700);
    }
  }

  /* 跳跃：土狼时间 + 输入缓冲 + 可变跳高 + 下穿平台 + 二段跳 */
  p.coyote = p.onGround ? COYOTE_TIME : Math.max(0, p.coyote - dt);
  if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
    if (down && p.plat && !p.plat.solid) {
      /* 站在空中平台上按住下 + 跳 = 穿过平台跳下去 */
      p.dropTimer = DROP_TIME;
      p.y += 4;
      p.vy = 80;
      p.jumpBuffer = 0;
      p.coyote = 0;
      p.onGround = false;
      beep(150, 0.05, 'sine', 0.016, 90);
    } else {
      doJump(p);
      p.coyote = 0;
    }
  } else if (p.jumpBuffer > 0 && p.airJumps > 0) {
    /* 二段跳：空中再按一次跳。高度比首跳低一档（184 vs 238），
       所以它救急、救不了「一口气上最高台」，平台设计不会被它废掉。 */
    doAirJump(p);
  }

  /* 开火 */
  const wp = WEAPONS[p.weapon];
  const wantFire = input.firing && (wp.auto || !p.triggerHeld);
  if (wantFire && p.fireCd <= 0 && p.reloading <= 0) {
    if (p.mags[p.weapon] > 0) {
      playerFire(p, wp);
    } else {
      /* reloadDur 是「这次换弹一共要多久」，HUD 用它反推进度环。
         它和 reloading（剩余时间）必须成对写，只写一个环会一直满着。 */
      p.reloading = wp.reload * (p.reloadMul || 1);
      p.reloadDur = p.reloading;
      sfxReload();
    }
  }
  p.triggerHeld = input.firing;

  /* 打空自动换弹 */
  if (p.mags[p.weapon] === 0 && p.reloading <= 0) {
    p.reloading = wp.reload * (p.reloadMul || 1);
    p.reloadDur = p.reloading;
    sfxReload();
  }

  /* 换弹 */
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      p.mags[p.weapon] = magSize(p, p.weapon);
      p.reloadDur = 0;                 /* 换完归零，HUD 的环才收得回去 */
      sfxReload();
      spawnText(p.x, p.y - p.h - 10, '装填完毕', '#9ad0ff');
    }
  }

  /* 手雷 */
  if (keys['KeyG'] && game.grenadeCd <= 0) {
    game.grenadeCd = 2.6;
    const ang = p.aim - 0.35;
    spawnGrenade(p.x, p.y - p.h * 0.7, Math.cos(ang) * 760, Math.sin(ang) * 760 - 120, 90, 'player');
    beep(300, 0.1, 'triangle', 0.03, 500);
  }

  /* 救大肥鱼 */
  if (buddy.downed && Math.abs(p.x - buddy.x) < 70 && (keys['KeyE'] || keys['KeyF'])) {
    buddy.reviveProgress += dt;
    p.reviveK = 1;                   /* 救人的人要蹲下去拉 —— 站着隔空喊话不像在救 */
    if (Math.random() < dt * 10) spawnParticles(buddy.x, buddy.y - 20, 1, '#7ef0b0', 90, 0.5, 3, -60);
    if (buddy.reviveProgress >= 2.0) {
      buddy.downed = false;
      buddy.hp = buddy.maxHp * 0.55;
      buddy.reviveProgress = 0;
      buddy.invuln = 1.2;
      sfxRevive();
      spawnText(buddy.x, buddy.y - 70, '大肥鱼归队', '#7ef0b0');
      buddy.bubble = '多谢！';
      buddy.bubbleTimer = 2;
    }
  } else if (buddy.downed) {
    buddy.reviveProgress = Math.max(0, buddy.reviveProgress - dt * 0.3);
  }

  /* 动作层：步频 / 起伏 / 前倾 / 上膛 / 受击全在这里结算一次，
     painter 只读结果。位置放在 moveEntity 之前 —— 它读的是本帧的
     vx 与姿态，写的是 a.anim 与 a._pose，和物理先后无关。 */
  actRun(p, dt);
  moveEntity(p, dt);
}

/* ---------------- 其它实体 ---------------- */
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    /* 每把枪自己的弹道：grav 决定要抬多少枪，drag 决定这颗弹能飞多远。
       霰弹枪的 grav 是狙击的十几倍、drag 又是它的二十几倍 —— 三十米外
       一枪出去基本是撒了一把豆子，这正是散弹枪该有的样子。 */
    b.vy += (b.grav || 0) * dt;
    if (b.drag > 0) {
      const k = Math.pow(1 - b.drag, dt);
      b.vx *= k; b.vy *= k;
    }
    b.life -= dt;

    /* 压制：这一帧飞过的这一段有没有擦到谁的身边（只影响 AI 的卧倒决策）。
       放在移动之后、命中之前 —— 命中判定会 break，擦身而过恰恰是「没命中」。 */
    suppressPass(b.px, b.py, b.x, b.y, b.team);

    /* 已经飞过的距离：伤害衰减、曳光淡出都看它 */
    b.dist = (b.dist || 0) + Math.hypot(b.vx, b.vy) * dt;

    /* 远端伤害衰减：射程 55% 以内满伤，之后线性掉到底。
       注意参考距离用的是「这把枪自己的射程」而不是固定的 1000px ——
       以前 1000px 封顶时，霰弹在 820 的边缘只掉一半、步枪在 3800 还是满伤，
       短枪的「越远越软」完全体现不出来。现在按比例折算，
       每把枪的「最佳交战距离」才有意义。 */
    const fallRef = b.range > 0 ? b.range * 0.55 : 1000;
    const power = b.dmg * (1 - (b.falloff || 0) * clamp(b.dist / fallRef, 0, 1));

    /* 火箭尾迹 */
    if (b.rocket) {
      particles.push({
        x: b.x - b.vx * 0.006, y: b.y - b.vy * 0.006,
        vx: rand(-26, 26), vy: rand(-26, 26),
        life: 0.34, max: 0.34, color: '#ffb066', size: rand(3, 7), grav: -40
      });
      if (Math.random() < 0.4) {
        particles.push({
          x: b.x - b.vx * 0.012, y: b.y - b.vy * 0.012,
          vx: rand(-18, 18), vy: rand(-30, -6),
          life: 0.6, max: 0.6, color: '#8e8378', size: rand(5, 11), grav: -22
        });
      }
    }

    let hit = false;
    let hx = b.x, hy = b.y;

    /* 一帧能走 30px，而平台只有 18~26 厚、人只有几十高 —— 只测「当前点」会整段穿过去。
       沿这一帧的轨迹按 8px 采样，从近到远取最先命中的那个点。 */
    const dx = b.x - b.px, dy = b.y - b.py;
    const segLen = Math.hypot(dx, dy);
    const steps = clamp(Math.ceil(segLen / 8), 1, 10);

    for (let s = 1; s <= steps && !hit; s++) {
      const qx = b.px + dx * (s / steps);
      const qy = b.py + dy * (s / steps);

      /* 沙袋掩体 / 实体障碍先吃子弹，其次是空中平台的实心梁 */
      const cov = coverBlocks(qx, qy);
      if (cov) {
        hurtCover(cov, power, qx, qy);
        hx = qx; hy = qy; hit = true;
        break;
      }
      const plat = platformBlocks(qx, qy, b.ignorePlat);
      if (plat) {
        hitPlatform(plat, qx, qy);
        hx = qx; hy = qy; hit = true;
        break;
      }

      if (b.team === 'enemy') {
        /* 谁挡在弹道上谁先吃子弹（大肥鱼站在你身前时真的会替你挡） */
        const hitP = player && !player.downed && pointHitEntity(qx, qy, b.r, player);
        const hitB = buddy && !buddy.downed && !buddy.dead && pointHitEntity(qx, qy, b.r, buddy);
        if (hitP && hitB) {
          if (Math.abs(b.px - buddy.x) <= Math.abs(b.px - player.x)) {
            damageFriendly(buddy, power);
          } else {
            damageFriendly(player, power);
          }
          hx = qx; hy = qy; hit = true;
        } else if (hitP) {
          damageFriendly(player, power);
          hx = qx; hy = qy; hit = true;
        } else if (hitB) {
          damageFriendly(buddy, power);
          hx = qx; hy = qy; hit = true;
        }
      } else {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (e.dead) continue;
          if (b.hits && b.hits.indexOf(e) >= 0) continue;
          if (pointHitEntity(qx, qy, b.r, e)) {
            const before = e.hp;
            /* 弹着点用采样点，部位判定才准 */
            damageEnemy(e, power, qx, qy, b.owner);
            if (b.owner === 'buddy') {
              game.tele.buddyHits++;
              game.tele.buddyDmg += Math.max(0, before - Math.max(0, e.hp));
            }
            sfxHit();
            /* 狙击弹：打穿之后继续飞，最多穿 pierce 个 */
            if (b.pierce > 0) {
              b.pierce--;
              b.hits.push(e);
              spawnParticles(qx, qy, 5, '#bfe4ff', 220, 0.3, 3, 300);
              continue;
            }
            hx = qx; hy = qy; hit = true;
            break;
          }
        }
      }

      if (!hit && qy > world.groundY + 4) {
        spawnParticles(qx, world.groundY - 2, 3, '#c8b48a', 120, 0.25, 2.5, 500);
        hx = qx; hy = world.groundY; hit = true;
        break;
      }
    }

    /* 命中点回写，火箭在真实弹着点炸开才不会浮在半空 */
    if (hit) { b.x = hx; b.y = hy; }

    if (hit && b.rocket && b.blast > 0) {
      /* 火箭只吃溅射伤害，命中点直接炸开 */
      explode(b.x, b.y, b.blast, b.blastDmg, b.team === 'enemy' ? 'enemy' : 'player');
    }

    if (hit || b.life <= 0 || (b.range > 0 && b.dist > b.range) || b.x < -100 || b.x > world.w + 100) {
      bullets.splice(i, 1);
    }
  }
}

function explode(x, y, radius, dmg, team) {
  sfxBoom();
  addShake(12);

  /* 上升烟团：比火球活得久，炸完还留一团灰在空气里。
     必须最先塞进 particles —— 否则烟会盖在火球上面，整个爆炸看着发闷。 */
  const puffs = 4 + Math.min(4, Math.round(radius / 60));
  for (let i = 0; i < puffs; i++) {
    particles.push({
      x: x + rand(-radius * 0.40, radius * 0.40),
      y: y - rand(4, 20),
      vx: rand(-38, 38),
      vy: rand(-108, -48),
      life: rand(0.62, 0.95), max: 0.95,
      color: 'rgba(84,74,64,1)',
      size: rand(6, 10) + radius * 0.045,
      grav: -40, ball: true, smoke: true
    });
  }

  spawnParticles(x, y, 34, '#ffb347', 460, 0.7, 7, 700);
  spawnParticles(x, y, 16, '#6a5a4a', 300, 0.9, 9, 400);

  /* 火球本体：只有火花 + 冲击环的话，静止帧看起来像「放了个小烟花」。
     补一个加色柔光球，0.30 秒内膨胀一倍再散掉，才有「炸开」的体积感。 */
  particles.push({
    x, y: y - 4, vx: 0, vy: 0, life: 0.30, max: 0.30,
    color: '#ffcf7a', size: radius * 0.36, grav: 0, ball: true
  });

  /* 冲击环放最后，压在最上面才看得清边界 */
  particles.push({
    x, y, vx: 0, vy: 0, life: 0.28, max: 0.28,
    color: '#fff3c4', size: radius * 0.55, grav: 0, ring: true
  });

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    const d = distTo(x, y, e.x, e.y - e.h * 0.5);
    if (d < radius) damageEnemy(e, dmg * (1 - d / radius * 0.55), e.x, e.y - e.h * 0.5);
  }
  if (team === 'enemy') {
    if (player && !player.downed && distTo(x, y, player.x, player.y - 28) < radius) {
      damageFriendly(player, dmg * 0.45);
    }
  }
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.spin += dt * 10;
    g.vy += GRAV * dt * 0.8;
    g.x += g.vx * dt;
    g.y += g.vy * dt;

    const gy = surfaceBelow(g.x, g.y);
    if (g.y > gy) {
      g.y = gy;
      g.vy *= -0.42;
      g.vx *= 0.72;
      if (Math.abs(g.vy) < 40) g.vy = 0;
    }
    if (g.x < 20 || g.x > world.w - 20) g.vx *= -0.5;

    if (g.fuse <= 0) {
      /* 燃烧瓶：炸开的同时在地上留一摊火，封住这片走位 */
      explode(g.x, g.y, g.fire ? 92 : 120, g.dmg, g.team);
      if (g.fire) spawnFire(g.x, g.y + 4, 116, 5.4, 7);
      grenades.splice(i, 1);
    }
  }
}

/* ---------------- 火焰地带 ----------------
   焦土纵火者的燃烧瓶落地后留下的持续伤害区。
   只烧友方（玩家 / 大肥鱼），敌人自己踩着不疼 —— 不然小兵会把自己烧死。
   ---------------------------------------- */
function updateFires(dt) {
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i];
    f.life -= dt;
    if (f.life <= 0) { fires.splice(i, 1); continue; }

    /* 火苗粒子：越到后期越稀，视觉上「快烧完了」 */
    const rate = clamp(f.life / f.max, 0, 1);
    if (Math.random() < dt * 34 * rate) {
      particles.push({
        x: f.x + rand(-f.r * 0.85, f.r * 0.85),
        y: f.y - rand(0, 8),
        vx: rand(-16, 16), vy: rand(-92, -34),
        life: rand(0.28, 0.6), max: 0.6,
        color: Math.random() < 0.5 ? '#ffb347' : '#ff7a2a',
        size: rand(2.5, 5.5), grav: -50
      });
    }

    f.tick -= dt;
    if (f.tick > 0) continue;
    f.tick = 0.3;

    const inFire = (a) => a && !a.dead && !a.downed &&
      Math.abs(a.x - f.x) < f.r * 0.85 && a.y > f.y - 74 && a.y < f.y + 30;
    if (inFire(player)) damageFriendly(player, f.dmg);
    if (inFire(buddy)) damageFriendly(buddy, f.dmg);
  }
}

/* ---------------- 场景机关：地刺 / 喷火口 ----------------
   机关只对有血有肉的人生效（玩家、大肥鱼、敌兵），不挡子弹也不挡人，
   所以它带来的是「站位压力」而不是「路被堵了」。 */
function hazardHit(a, hz) {
  if (!a || a.dead || a.downed) return false;
  const half = a.w * 0.42;
  if (a.x + half < hz.x || a.x - half > hz.x + hz.w) return false;
  if (a.y < hz.y - hz.h * 0.9 || a.y > hz.y + 12) return false;
  return true;
}

function updateHazards(dt) {
  for (let i = 0; i < world.hazards.length; i++) {
    const hz = world.hazards[i];
    hz.cd = Math.max(0, (hz.cd || 0) - dt);

    if (hz.kind === 'spike') {
      /* 地刺：踩上去就掉血 + 被顶开，站不住，得跳过去或者绕开 */
      const hit = (a) => {
        if (hz.cd > 0 || !hazardHit(a, hz) || !a.onGround) return;
        hz.cd = 0.42;
        if (a.kind === 'player' || a.kind === 'buddy') {
          damageFriendly(a, hz.dmg);
          a.vy = -420;
          a.vx += (a.x < hz.x + hz.w * 0.5 ? -1 : 1) * 190;
          a.onGround = false;
          tickSpikes(hz);
        } else {
          damageEnemy(a, hz.dmg, a.x, a.y - 10, 'player');
        }
      };
      hit(player); hit(buddy);
      for (let k = 0; k < enemies.length; k++) hit(enemies[k]);
      continue;
    }

    /* 喷火口：一个周期里「静默 → 预警火星 → 窜火 → 收火」，
       预警阶段地面冒火星、有嘶嘶声，是给玩家的反应窗口。 */
    const period = hz.period || 2.8;
    hz.t = ((hz.t || 0) + dt) % period;
    const warnAt = period - (hz.warn || 1.0) - 0.62;   /* 冒火星 */
    const fireAt = period - 0.62;                       /* 窜火 */

    if (hz.t >= warnAt && hz.t < fireAt) {
      if (Math.random() < dt * 22) {
        particles.push({
          x: hz.x + rand(2, hz.w - 2), y: hz.y - rand(0, 6),
          vx: rand(-22, 22), vy: rand(-120, -60),
          life: rand(0.2, 0.45), max: 0.45,
          color: Math.random() < 0.5 ? '#ffcf6a' : '#ff9a3c',
          size: rand(1.6, 3), grav: 220
        });
      }
      if (hz.seed % 2 === 0 && Math.random() < dt * 3) beep(680, 0.05, 'sine', 0.008, 300);
      hz.firing = 0;
    } else if (hz.t >= fireAt) {
      hz.firing = 1;
      /* 火柱粒子：一路往上窜，到顶散开 */
      const n = Math.random() < dt * 90 ? 3 : (Math.random() < dt * 40 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        particles.push({
          x: hz.x + rand(4, hz.w - 4), y: hz.y - rand(0, 10),
          vx: rand(-40, 40), vy: rand(-760, -460),
          life: rand(0.26, 0.46), max: 0.46,
          color: Math.random() < 0.4 ? '#ffe6a8' : (Math.random() < 0.6 ? '#ff9a3c' : '#ff5a20'),
          size: rand(3, 7.5), grav: 260
        });
      }
      if (Math.random() < dt * 26) {
        particles.push({
          x: hz.x + rand(0, hz.w), y: hz.y - rand(20, hz.h),
          vx: rand(-30, 30), vy: rand(-90, -20),
          life: rand(0.3, 0.6), max: 0.6,
          color: 'rgba(90,70,60,0.55)', size: rand(8, 16), grav: -60
        });
      }
      if (hz.cd <= 0) {
        const burn = (a) => {
          if (!hazardHit(a, hz)) return false;
          if (a.kind === 'player' || a.kind === 'buddy') damageFriendly(a, hz.dmg);
          else damageEnemy(a, hz.dmg * 0.8, a.x, a.y - 20, 'player');
          return true;
        };
        let touched = false;
        if (burn(player)) touched = true;
        if (burn(buddy)) touched = true;
        for (let k = 0; k < enemies.length; k++) if (burn(enemies[k])) touched = true;
        if (touched) { hz.cd = 0.34; addShake(3); }
      }
    } else {
      hz.firing = 0;
    }
  }
}

/* 地刺被踩：溅一撮火星与尘，给「扎到脚了」的反馈 */
function tickSpikes(hz) {
  spawnParticles(hz.x + hz.w * 0.5, hz.y - 6, 7, '#d8c9a8', 180, 0.34, 2.6, 900);
  spawnText(hz.x + hz.w * 0.5, hz.y - 44, '扎脚！', '#ffb347');
  beep(190, 0.07, 'square', 0.02, 90);
  addShake(5);
}

/* ---------------- 深渊结算 ----------------
   掉下去不是掉血，是直接没了。玩家坠落 = 立刻 gameover，
   大肥鱼坠落 = 直接倒地（还能救回来），敌兵坠落 = 白送一个人头。 */
function updateFalls(dt) {
  const finish = (a, who) => {
    a.fell = false;
    if (who === 'player') {
      a.hp = 0;
      a.downed = true;
      a.downTimer = 0.001;      /* 下一帧就结算成 gameover */
      a.deathCause = 'fall';
      say('buddy', '指挥官——！掉下去了！');
      spawnText(a.x, a.y - 40, '坠入深渊', '#ff6b6b');
      addShake(16);
      sfxHurt();
    } else if (who === 'buddy') {
      a.hp = 0;
      a.downed = true;
      a.downTimer = 14;
      a.reviveProgress = 0;
      /* 掉坑里没法原地救，把他捞回最近的实地边缘 */
      const back = nearestGroundX(a.x);
      a.x = back;
      a.y = world.groundY - 2;
      a.vy = 0;
      a.vx = 0;
      spawnText(a.x, a.y - 70, '大肥鱼掉坑了', '#ffb347');
      say('buddy', '我掉坑里了……拉我一把！');
      addShake(10);
    } else {
      a.dead = true;
      killEnemy(a);
    }
  };

  if (player.fell) finish(player, 'player');
  if (buddy && buddy.fell && !buddy.downed) finish(buddy, 'buddy');
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.fell && !e.dead) finish(e, 'enemy');
  }
}

/* 离 x 最近的实地（用来把掉坑的大肥鱼捞回来） */
function nearestGroundX(x) {
  for (let d = 0; d < 900; d += 6) {
    if (groundAt(x - d)) return x - d;
    if (groundAt(x + d)) return x + d;
  }
  return x;
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.life -= dt;
    pk.bob += dt * 3;
    pk.vy += GRAV * dt;
    pk.x += pk.vx * dt;
    pk.y += pk.vy * dt;
    pk.vx *= 0.94;
    const gy = surfaceBelow(pk.x, pk.y) - 14;
    if (pk.y > gy) {
      pk.y = gy;
      pk.vy = 0;
      pk.vx *= 0.6;
    }

    let taken = false;
    const near = (a) => a && !a.dead && !a.downed && distTo(a.x, a.y - 28, pk.x, pk.y) < 44;
    const who = near(player) ? player : (near(buddy) ? buddy : null);
    if (who) {
      if (pk.type === 'health') {
        who.hp = Math.min(who.maxHp, who.hp + 32);
        spawnText(who.x, who.y - who.h - 8, '+32 HP', '#7ef0b0');
      } else {
        for (let k = 0; k < who.mags.length; k++) {
          if (who.mags[k] > 0) who.mags[k] = WEAPONS[k].mag;
        }
        who.reloading = 0;
        spawnText(who.x, who.y - who.h - 8, '弹药补充', '#ffd166');
      }
      sfxPick();
      taken = true;
    }
    if (taken || pk.life <= 0) pickups.splice(i, 1);
  }
}

function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (!p.ring) {
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > world.groundY) { p.y = world.groundY; p.vy *= -0.3; p.vx *= 0.7; }
    }
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= dt;
    t.y += t.vy * dt;
    t.vy += 40 * dt;
    if (t.life <= 0) texts.splice(i, 1);
  }
  for (let i = casings.length - 1; i >= 0; i--) {
    const c = casings[i];
    c.life -= dt;
    c.vy += GRAV * dt * 0.7;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.spin * dt;
    if (c.y > world.groundY) { c.y = world.groundY; c.vy *= -0.3; c.vx *= 0.6; }
    if (c.life <= 0) casings.splice(i, 1);
  }
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.life -= dt;
    if (d.life <= 0) decals.splice(i, 1);
  }
  for (let i = 0; i < world.covers.length; i++) {
    const c = world.covers[i];
    if (c.hit > 0) c.hit = Math.max(0, c.hit - dt);
  }
}

/* ---------------- 尸体 ---------------- */
/* 尸体只存「位置 + 计时」，软倒的姿态全部交给渲染层按 t 推。
   这样物理层不用维护一套状态机，想调动画只改渲染一处。 */
function updateCorpses(dt) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += dt;
    c.life -= dt;

    /* 空中被打死的要先掉下来，落地之后才开始软 */
    if (!c.landed) {
      c.vy += GRAV * dt;
      c.y += c.vy * dt;
      /* 掉进深渊的不留尸体 —— 坑里没有地面可以躺 */
      if (c.y > world.groundY + FALL_DEPTH) { corpses.splice(i, 1); continue; }
      const floor = surfaceBelow(c.x, c.y);
      if (c.y >= floor) {
        c.y = floor;
        c.vy = 0;
        c.landed = true;
        c.t = 0;                        /* 落地那一下重新计时，空中那截不算软倒 */
        spawnParticles(c.x, c.y - 4, 6, '#9a8e7e', 90, 0.42, 3, 320);
      }
    }

    if (c.life <= 0) corpses.splice(i, 1);
  }
}

/* ---------------- 摄像机 ---------------- */
function updateCamera(dt) {
  const p = player;
  const mw = mouseWorld();
  const lookAhead = clamp((mw.x - p.x) * 0.18, -170, 170);
  const targetX = clamp(p.x - VIEW_W / 2 + lookAhead, 0, Math.max(0, world.w - VIEW_W));
  camera.x = lerp(camera.x, targetX, 1 - Math.pow(0.0015, dt));
  camera.shake = Math.max(0, camera.shake - dt * 44);
}

/* ---------------- 主更新 ---------------- */
function update(dt) {
  /* BOSS 击破慢动作：把世界时间拧慢，白闪和连环爆才有特写感。
     注意先扣自己的计时器，再缩放 dt，否则慢动作会自己续命。 */
  if (game.slowmo > 0) {
    game.slowmo = Math.max(0, game.slowmo - dt);
    dt *= 0.32;
  }

  /* 定帧（hit-stop）：先扣自己的计时器，再把世界时间压到 10%。
     顺序不能反 —— 反过来扣的是缩放后的 dt，一帧 55ms 的定帧会被拖成 550ms。
     渲染层照常走，所以画面不卡，只是「世界停了半拍」。 */
  if (game.hitStop > 0) {
    game.hitStop = Math.max(0, game.hitStop - dt);
    dt *= 0.10;
  }

  game.time += dt;
  sayCooldown = Math.max(0, sayCooldown - dt);

  /* 连杀衰减：2.6 秒内没有下一次击杀就断连。
     放在 time 之后、state 判断之前，结算页上连杀也会自然归零，
     不会带着一串数字进下一关。 */
  if (game.comboTimer > 0) {
    game.comboTimer = Math.max(0, game.comboTimer - dt);
    if (game.comboTimer <= 0) game.combo = 0;
  }
  if (game.tutorialT > 0) game.tutorialT = Math.max(0, game.tutorialT - dt);
  if (game.hurtFx > 0) game.hurtFx = Math.max(0, game.hurtFx - dt * 2.6);

  game.screenFlash = Math.max(0, (game.screenFlash || 0) - dt * 1.5);
  if (game.bossIntro) {
    game.bossIntro.t += dt;
    if (game.bossIntro.t >= game.bossIntro.dur) game.bossIntro = null;
  }

  if (game.state !== 'playing') return;

  updatePlayer(dt);
  updateBuddy(dt);

  for (let i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);

  updateHazards(dt);
  updateFalls(dt);

  updateBullets(dt);
  updateGrenades(dt);
  updateFires(dt);
  updatePickups(dt);
  updateEffects(dt);
  updateCorpses(dt);
  updateWaves(dt);
  updateCamera(dt);

  /* 声音强度：按场上活着的敌人数把配乐往上推（8 个算满）。
     这不是装饰 —— 玩家看不见的「还剩几个」由音量替他数。
     声音纵队没落地时这里什么都不发生。 */
  if (typeof audioIntensity === 'function') {
    let alive = 0;
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].dead) alive++;
    audioIntensity(clamp(alive / 8, 0, 1));
  }

  if (game.msgTimer > 0) game.msgTimer -= dt;
}

/* ---------------- 按键 ----------------
   路由顺序 = 状态机的顺序：先按「当前在哪个页面」分发，
   每个页面一个独立的 keys 函数，互不干扰。
   -------------------------------------- */

const LOBBY_ITEMS = [
  { key: 'deploy',    name: '出　击', sub: '选择关卡　»' },
  { key: 'armory',    name: '武器库', sub: '购买 · 主/副武器 · 大肥鱼配枪' },
  { key: 'operators', name: '干　员', sub: '出战干员 · 招募' },
  { key: 'archive',   name: '档　案', sub: '进度 · 战绩 · 剧情回放' }
];

function onKeyPress(code) {
  ensureAudio();

  /* M = 静音 / 恢复。放在状态机之前 —— 任何页面都能按，
     玩家被吵到的时候不会先去大厅找开关。
     audioToggle 的返回约定：true 表示「现在静音」。util.js 没落地时
     这里整体跳过，不弹一个假的「已静音」。 */
  if (code === 'KeyM') {
    if (typeof audioToggle === 'function') {
      toast(audioToggle() ? '已静音' : '声音已开启');
    }
    return;
  }

  switch (game.state) {
    case 'title':
    case 'lobby': lobbyKeys(code); return;
    case 'deploy': deployKeys(code); return;
    case 'armory': armoryKeys(code); return;
    case 'operators': operatorsKeys(code); return;
    case 'archive': archiveKeys(code); return;
    case 'story':
      if (code === 'Enter' || code === 'Space') dialogNext();
      else if (code === 'Escape') dialogSkip();
      return;
    case 'stageclear':
      /* 最后一关打完没有「下一关」，Enter 直接回大厅，别把玩家丢进
         一个 stage 6（buildStage 会把它 clamp 回 5，看着像卡关） */
      if (code === 'Enter' || code === 'Space') {
        if (game.stage >= MAX_STAGE) goLobby(); else deploy(game.stage + 1);
      } else if (code === 'Escape') goLobby();
      return;
    case 'gameover':
      if (code === 'Enter' || code === 'Space') startStage(game.stage);
      else if (code === 'Escape') goLobby();
      return;
  }

  if (code === 'KeyP' || code === 'Escape') {
    game.state = game.state === 'paused' ? 'playing' : 'paused';
    return;
  }
  if (game.state !== 'playing') return;

  /* 1 = 主武器，2 = 副武器，X = 快切另一把。
     换枪只剩两把，但「带哪两把」是玩家在武器库里决定的 —— 这就是
     主/副武器自由搭配进入战斗的方式。 */
  if (code === 'Digit1') switchWeapon('primary');
  if (code === 'Digit2') switchWeapon('secondary');
  if (code === 'KeyX') toggleWeapon();
  if (code === 'KeyR' && player.reloading <= 0 && player.mags[player.weapon] < magSize(player, player.weapon)) {
    player.reloading = WEAPONS[player.weapon].reload * (player.reloadMul || 1);
    player.reloadDur = player.reloading;      /* 给 HUD 的进度环一个分母 */
    sfxReload();
  }
  /* 给大肥鱼下指令（就三个键，不用读屏幕） */
  if (code === 'KeyC') { buddy.cmd = 'follow'; buddy.bubble = '收到，跟着你！'; buddy.bubbleTimer = 1.8; }
  if (code === 'KeyV') { buddy.cmd = 'rush'; buddy.bubble = '好，我先上！'; buddy.bubbleTimer = 1.8; }
  if (code === 'KeyB') { buddy.cmd = 'hold'; buddy.holdX = buddy.x; buddy.bubble = '我守这儿。'; buddy.bubbleTimer = 1.8; }
  /* Q 切换大肥鱼性格：谨慎 / 均衡 / 突击 */
  if (code === 'KeyQ') {
    buddy.style = (buddy.style + 1) % 3;
    buddy.bubble = '切到「' + BUDDY_STYLES[buddy.style].name + '」打法。';
    buddy.bubbleTimer = 2.2;
    blog(buddy, '切换风格 → ' + BUDDY_STYLES[buddy.style].name);
  }
  /* Tab 展开/收起战术面板 */
  if (code === 'Tab') aiPanelOpen = !aiPanelOpen;
}

/* ---------------- 大厅 ---------------- */
function lobbyKeys(code) {
  if (game.state === 'title') { game.state = 'lobby'; game.menu = 0; }
  const n = LOBBY_ITEMS.length;
  if (code === 'ArrowLeft' || code === 'KeyA') game.menu = (game.menu + n - 1) % n;
  else if (code === 'ArrowRight' || code === 'KeyD') game.menu = (game.menu + 1) % n;
  else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code) >= 0) game.menu = +code.slice(5) - 1;
  else if (code === 'Enter' || code === 'Space') lobbyEnter();
}

function lobbyEnter() {
  const k = LOBBY_ITEMS[game.menu].key;
  if (k === 'deploy') {
    game.state = 'deploy';
    game.pickStage = clamp(game.pickStage || 1, 1, SAVE.maxStage);
    beep(520, 0.05, 'sine', 0.03, 640);
  } else if (k === 'armory') {
    game.state = 'armory';
    game.menu2 = Math.max(0, weaponById(SAVE.primary));
    beep(520, 0.05, 'sine', 0.03, 640);
  } else if (k === 'operators') {
    game.state = 'operators';
    game.menu2 = Math.max(0, CHAR_LIST.findIndex(c => c.id === SAVE.charId));
    beep(520, 0.05, 'sine', 0.03, 640);
  } else if (k === 'archive') {
    game.state = 'archive';
    game.confirmReset = false;
    beep(520, 0.05, 'sine', 0.03, 640);
  }
}

/* ---------------- 出击（选关） ---------------- */
function deployKeys(code) {
  if (code === 'Escape') { goLobby(); return; }
  if (code === 'ArrowLeft' || code === 'KeyA') game.pickStage = Math.max(1, game.pickStage - 1);
  else if (code === 'ArrowRight' || code === 'KeyD') game.pickStage = Math.min(SAVE.maxStage, game.pickStage + 1);
  else if (code === 'Enter' || code === 'Space') deploy(game.pickStage);
}

/* ---------------- 武器库（购买 + 主副 + 大肥鱼） ---------------- */
function armoryKeys(code) {
  if (code === 'Escape') { flushSave(); goLobby(); return; }
  const n = WEAPONS.length;
  if (code === 'ArrowUp' || code === 'KeyW') game.menu2 = (game.menu2 + n - 1) % n;
  else if (code === 'ArrowDown' || code === 'KeyS') game.menu2 = (game.menu2 + 1) % n;
  /* 数字键直达第 N 行。原来只认到 5 —— MP5 追加成第 6 把枪之后
     它就没了快捷键，而列表当时也只排得下 5 行，玩家根本不知道它存在。
     这里按 WEAPONS.length 截断，以后再追加枪不用回来改这个判断。 */
  else if (/^Digit[1-9]$/.test(code)) {
    const k = +code.slice(5) - 1;
    if (k < n) game.menu2 = k;
  }

  const idx = clamp(game.menu2, 0, n - 1);
  const id = WEAPONS[idx].id;
  const meta = weaponMeta(id);

  if (code === 'Enter') {
    if (!isUnlocked(id)) {
      if (unlockWeapon(id)) {
        toast('已购入 ' + WEAPONS[idx].name + '　-' + meta.price + ' 金币');
        beep(680, 0.09, 'sine', 0.045, 900);
      } else {
        toast('金币不足，还差 ' + (meta.price - SAVE.coins));
        beep(180, 0.09, 'square', 0.03, 140);
      }
    } else if (SAVE.primary === id) {
      toast('已经是主武器了');
    } else {
      setSlot('primary', id);
      toast('已设为主武器 · ' + WEAPONS[idx].name);
      beep(600, 0.06, 'sine', 0.035, 760);
    }
  }
  if (code === 'Space') {
    if (!isUnlocked(id)) { toast('先解锁这把枪'); return; }
    if (SAVE.secondary === id) { toast('已经是副武器了'); return; }
    setSlot('secondary', id);
    toast('已设为副武器 · ' + WEAPONS[idx].name);
    beep(600, 0.06, 'sine', 0.035, 760);
  }
  if (code === 'KeyB') {
    if (!isUnlocked(id)) { toast('先解锁这把枪'); return; }
    if (SAVE.buddyWeapon === id) { setBuddyWeapon('auto'); toast('大肥鱼改回自动挑枪'); }
    else { setBuddyWeapon(id); toast('大肥鱼固定使用 · ' + WEAPONS[idx].name); }
    beep(560, 0.06, 'sine', 0.03, 700);
  }
  if (code === 'KeyX') { swapSlots(); toast('主 / 副武器已互换'); }
}

/* ---------------- 干员 ---------------- */
function operatorsKeys(code) {
  if (code === 'Escape') { goLobby(); return; }
  const n = CHAR_LIST.length;
  if (code === 'ArrowLeft' || code === 'KeyA') game.menu2 = (game.menu2 + n - 1) % n;
  else if (code === 'ArrowRight' || code === 'KeyD') game.menu2 = (game.menu2 + 1) % n;
  else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code) >= 0) game.menu2 = Math.min(n - 1, +code.slice(5) - 1);

  const def = CHAR_LIST[clamp(game.menu2, 0, n - 1)];
  if (code === 'Enter' || code === 'Space') {
    const wasOwned = ownedChar(def.id);
    if (recruitChar(def.id)) {
      const u = def.unlock || {};
      const paid = (u.type === 'coins' && !wasOwned) ? ('　-' + u.price + ' 金币') : '';
      toast(wasOwned ? ('出战干员 · ' + def.name) : ('已招募 ' + def.name + paid));
      beep(660, 0.08, 'sine', 0.04, 860);
    } else {
      const u = def.unlock || {};
      if (u.type === 'stage') toast('通关第 ' + (u.stage - 1) + ' 关后自动解锁');
      else toast('金币不足，还差 ' + ((u.price || 0) - SAVE.coins));
      beep(180, 0.09, 'square', 0.03, 140);
    }
  }
}

/* ---------------- 档案 ---------------- */
function archiveKeys(code) {
  if (code === 'Escape' || code === 'Enter' || code === 'Space') { goLobby(); return; }
  if (code === 'KeyR') {
    if (game.confirmReset) { resetSave(); game.confirmReset = false; toast('存档已重置'); }
    else { game.confirmReset = true; toast('再按一次 R 确认清空存档'); }
  }
  /* 数字键回放对应关卡剧情（1~5，与 MAX_STAGE 对齐） */
  if (/^Digit[1-5]$/.test(code)) {
    const st = +code.slice(5);
    if (storyFor(st)) openStory(st, 'lobby');
    else toast('第 ' + st + ' 关还没有剧情');
  }
}
