'use strict';

/* ==================================================================
   世界层：武器表 / 敌兵表 / 关卡地形 / 角色工厂 / 子弹 / 伤害
   ================================================================== */

/* ---------------- 武器 ----------------
   short：HUD 小标签
   rocket：抛射火箭弹，命中后 range 内溅射
   pierce：一发可以连续打穿几个敌人
   scope ：按住右键精确瞄准（散布再降一半）

   ---- 弹道字段（这一版的重点：枪与枪的差别不只在伤害数字）----
   range  ：★ 极限射程（世界像素）。子弹飞到这么远就消散。
            这一项必须显式写出来 —— 以前射程是「speed × 2.2 秒」算出来的副产物，
            结果步枪 3009 / 机枪 2691 / 火箭 2244 三把挤在同一档（只差 11%，
            玩家分不出谁是谁），而狙击因为有 tracer 加成直接跑到 7858
            （整张地图才 3800 宽，等于没有限制）。
            现在按 1150 / 2100 / 2900 / 4000 / 5600 五档排开，
            相邻两档都 ≥1.38 倍，每一档对应一种打法：
            贴脸 → 中距爆炸 → 压制 → 全能 → 跨图点名。
            spawnBullet 会按 range 反推 life，所以「表上写多远，场上就打多远」。
   speed  ：初速。同样的 range 下速度越快，飞行时间越短、提前量越好算
   spread ：基础散布（弧度）。半径 = tan(spread) × 距离，所以同一个圈远处更大
   grav   ：子弹下坠加速度（px/s²）。越小弹道越直、越远还能「指着谁打中谁」；
            霰弹是 300，狙击只有 18 —— 这个差就是「要不要抬枪」的差
   drag   ：每秒速度衰减比例。霰弹掉得最快，打远处像在撒豆子
   bw     ：曳光视觉半宽（像素）。只影响画面，不影响判定半径
   bloom  ：每打一发准星扩多少（机枪连射会越打越散）
   falloff：伤害衰减。自身射程 55% 以内满伤，之后线性掉到 (1-falloff)
            —— 按「自己的射程」折算而不是固定 1000px，短枪在射程边缘最软才说得通
   -------------------------------------- */
const WEAPONS = [
  /* 全能位：射程最长的一把「常规枪」，整张地图一端打到另一端（地图最宽 3800）。
     代价是单发 14、后坐和散布都要自己控，吃的是「我会瞄」这件事。 */
  { id: 'm4', name: 'M4 步枪',   short: '步枪', dmg: 14, rate: 0.105, speed: 1750, spread: 0.035, mag: 30,  reload: 1.5, pellets: 1, color: '#ffd88a', recoil: 2.0, auto: true,  sfx: 'small',
    grav: 95,  drag: 0.075, bw: 1.5,  bloom: 0.055, falloff: 0.10, range: 4000 },
  /* 贴脸位：射程只有步枪的三成，而且 grav 300 让它真的「出了门就散」——
     660px 处就要抬 5° 才够得着人。但八发弹匣一发六颗、每颗 10 ——
     站在门口等它进来，收益比任何枪都高。 */
  { id: 'm870', name: 'M870 霰弹', short: '霰弹', dmg: 10, rate: 0.72,  speed: 1180, spread: 0.17,  mag: 8,   reload: 1.9, pellets: 6, color: '#ffb066', recoil: 6.0, auto: false, sfx: 'big',
    grav: 300, drag: 0.50, bw: 1.15, bloom: 0.30,  falloff: 0.45, range: 1150 },
  /* 压制位：弹匣 100、射速 16/s，射程卡在步枪和火箭之间 ——
     它的优势不是「打得远」而是「不用停」，用密度换精度。 */
  { id: 'm249', name: 'M249 机枪', short: '机枪', dmg: 10, rate: 0.062, speed: 1620, spread: 0.075, mag: 100, reload: 3.0, pellets: 1, color: '#ffe89a', recoil: 1.2, auto: true,  sfx: 'small',
    grav: 120, drag: 0.115, bw: 1.35, bloom: 0.075, falloff: 0.14, range: 2900 },
  /* 点名位：5600 已经超出地图宽度，等于「全图无死角」。伤害不衰减、能穿两个人，
     grav 只有 18（1 屏距离几乎不掉），换来 1.02s 的射速和 8.5 的后坐 —— 打不中就是空一枪。 */
  { id: 'awm', name: 'AWM 狙击',  short: '狙击', dmg: 88, rate: 1.02,  speed: 3000, spread: 0.005, mag: 5,   reload: 2.4, pellets: 1, color: '#bfe4ff', recoil: 8.5, auto: false, sfx: 'big',   pierce: 2, scope: true, tracer: true,
    grav: 18,  drag: 0.02, bw: 1.15, bloom: 0.42,  falloff: 0,   tracerLen: 300, range: 5600 },
  /* 爆炸位：弹速最慢（820）但走直线，射程比霰弹还远一倍。
     它的优势是「不用打准」—— 132 半径的溅射把瞄准这件事整个省掉。 */
  { id: 'rpg', name: 'RPG 火箭',  short: '火箭', dmg: 0,  rate: 1.55,  speed: 820,  spread: 0.012, mag: 3,   reload: 3.2, pellets: 1, color: '#ffb066', recoil: 13,  auto: false, sfx: 'big',   rocket: true, blast: 132, blastDmg: 105,
    grav: 0,   drag: 0,    bw: 4.2,  bloom: 0.20,  falloff: 0, range: 2100 },
  /* 近中距压制位（2.0 新增）：卡在 M4 和 M870 中间的那一档 ——
     射速 13.9/s（步枪 9.5/s）、弹匣 32、单发 9，用「打得快打得久」换「打得疼」。
     spread 0.055 比步枪松、grav 110 比步枪狠、射程 1800 只有步枪的四成半：
     它是「贴脸到半条街」的枪，出了这段距离就得抬枪算提前量 ——
     不是更弱的步枪，是更省事的步枪。

     ★ 为什么追加在数组末尾而不是插在 m4 后面：
       ai.js 的挑枪逻辑里写死了 b.mags[1] = 霰弹、b.mags[2] = 机枪，
       插队会把大肥鱼的「贴脸霰弹 / 人多机枪」全部指错枪。
       加枪只能追加，改档才动顺序。 */
  { id: 'mp5', name: 'MP5 冲锋枪', short: '冲锋', dmg: 9, rate: 0.072, speed: 1500, spread: 0.055, mag: 32, reload: 1.35, pellets: 1, color: '#cfe6ff', recoil: 1.6, auto: true,
    bloom: 0.05, falloff: 0.16, range: 1800, grav: 110, drag: 0.09, bw: 1.4 }
];

/* ---------------- 敌兵 ----------------
   mag / reload：敌人也有弹匣，打空要换弹 —— 这就是玩家的进攻窗口
   -------------------------------------- */
const ENEMY_TYPES = {
  /* prone: true 现在人人都有 —— 卧倒是通用战术动作，不是机枪兵的职业特性。
     这个开关留着只是给「以后可能出现的、结构上趴不下去的兵种」留个后门。 */
  grunt: {
    hp: 62, speed: 78, w: 30, h: 56, dmg: 9, fireRate: 1.15, range: 560, keep: 300,
    mag: 18, reload: 1.9, score: 10, color: '#b5484a', dark: '#7d2f31', name: '步兵',
    prone: true
  },
  rusher: {
    hp: 48, speed: 195, w: 26, h: 52, dmg: 15, melee: true, range: 40,
    score: 12, color: '#c0763a', dark: '#8a4f22', name: '冲锋兵',
    /* 近战兵也趴：只在被子弹压住的那一下卧倒（冲不上去时先保命），
       起来继续冲。权重在 ai.js 里按 t.melee 单独调。 */
    prone: true
  },
  gunner: {
    hp: 105, speed: 52, w: 32, h: 60, dmg: 11, fireRate: 0.72, range: 660, keep: 380, burst: 3,
    mag: 36, reload: 2.8, score: 20, color: '#8a5fa8', dark: '#5c3d72', name: '重机枪兵',
    /* 架枪姿势就是趴下：脚架一撑开，散布收紧一半，代价是横着躺一米七 */
    prone: true
  },
  thrower: {
    hp: 58, speed: 74, w: 28, h: 54, dmg: 8, fireRate: 2.4, range: 620, keep: 420,
    mag: 8, reload: 1.6, thrower: true, score: 16, color: '#5b7f4a', dark: '#37502b', name: '掷弹兵',
    prone: true
  },
  boss: {
    hp: 900, speed: 66, w: 62, h: 96, dmg: 16, fireRate: 1.5, range: 820, keep: 380,
    mag: 26, reload: 2.4, score: 220, color: '#9c2b2b', dark: '#5c1414', name: '铁血队长',
    boss: true, accent: 'red', summon: 'grunt', prone: true,
    title: '第 1 关守将 · 街区块头目'
  },
  /* 第 2 关 BOSS：血少一点、跑得更快，靠燃烧瓶封走位。
     不跟你正面对枪 —— 它把地烧起来，逼你离开掩体。 */
  boss2: {
    hp: 780, speed: 96, w: 56, h: 92, dmg: 13, fireRate: 2.6, range: 780, keep: 340,
    mag: 12, reload: 2.8, score: 260, color: '#c26a22', dark: '#7a3d0e', name: '焦土纵火者',
    boss: true, accent: 'fire', summon: 'rusher', molotov: true, prone: true,
    title: '第 2 关守将 · 废墟焚化班'
  },
  /* 第 3 关 BOSS：最硬，正面装甲吃掉 55% 伤害，靠近会跳起震地 */
  boss3: {
    hp: 1200, speed: 58, w: 68, h: 100, dmg: 18, fireRate: 1.35, range: 840, keep: 360,
    mag: 30, reload: 2.6, score: 320, color: '#3f5f6e', dark: '#20343d',
    name: '小克', look: 'xiaoke',
    boss: true, accent: 'steel', summon: 'gunner', armor: 0.45, slam: true,
    /* 智械主脑也能卧倒（瓷甲 painter 里有对应的整体放平变换），
       但她是「结构上趴不下去」的样板：抬升系数比人类大 1.6 倍，见 chars.js */
    prone: true,
    /* 横幅是 name + title 拼接，title 里不能再带一次名字，否则显示「小克 智械主脑 · 小克」 */
    title: '智械主脑'
  }
};

/* ---------------- 击杀收益（金币 / 经验） ----------------
   单独一张表而不是塞进 ENEMY_TYPES：调经济不用翻五百行去找每个兵种。
   数值依据：一关约 30 个杂兵 + 1 个 BOSS ≈ 120 金币 + 过关奖励 80×关卡，
   也就是一关净收入 200~300，对应武器价 0 / 260 / 380 / 520 / 880 / 1400
   （新枪 ≈ 攒 1~4 关）。经验同理：一关约 370 xp，一级要 55~375，
   所以「一关内必升 1~2 级」，和需求里「大量击杀后随之升级」对得上。

   2.0：BOSS 三档各 +10（60/70/90 → 70/80/100）。
   为什么只加 BOSS 不加杂兵：改装线是「重复挑战」的消费口，它该由
   「认真打完一关」来买单，而不是由「反复刷杂兵」来买单 ——
   杂兵单价一动，前期节奏（一关 200~300）整个会变形，BOSS 那一份只是加厚尾款。 */
const KILL_REWARD = {
  grunt:   { coin: 3,  xp: 8 },
  rusher:  { coin: 4,  xp: 9 },
  gunner:  { coin: 7,  xp: 16 },
  thrower: { coin: 5,  xp: 12 },
  boss:    { coin: 70, xp: 100 },
  boss2:   { coin: 80, xp: 120 },
  boss3:   { coin: 100, xp: 160 }
};
for (const _k in KILL_REWARD) {
  if (ENEMY_TYPES[_k]) {
    ENEMY_TYPES[_k].coin = KILL_REWARD[_k].coin;
    ENEMY_TYPES[_k].xp = KILL_REWARD[_k].xp;
  }
}

/* 每关的最终 BOSS：1 街区 → 2 废墟 → 3 指挥部，打完循环 */
const BOSS_BY_STAGE = ['boss', 'boss2', 'boss3'];
function bossForStage(stage) {
  return BOSS_BY_STAGE[(clamp(stage, 1, 9) - 1) % BOSS_BY_STAGE.length];
}

/* ------------------------------------------------------------------
   关卡地形
   三层高度全部保证「从下层跳得上去」：
     地面 600 → 低台 476（差 124，跳高 238）
     地面 600 → 中台 384（差 216，需要满跳，留 22px 余量）
     低台 476 → 中台 384（差  92）
     中台 384 → 高台 296（差  88）
     低台 476 → 高台 296（差 180，水平重叠，可直接上）
   ------------------------------------------------------------------ */
const TIER_LOW = 476;
const TIER_MID = 384;
const TIER_HIGH = 296;

/* ---------------- 关卡主题 ----------------
   前期三关不只是「更长更硬」，地形构成和色调都要换：
     1 破晓街区 —— 街面开阔、路灯亮着、油桶木箱沙袋，教学关
     2 焦土废墟 —— 半塌砖墙当硬掩体、火点多、路灯全灭，视线最差
     3 敌方指挥部 —— 集装箱成组、铁丝网、探照灯扫射，硬掩体最多
   4/5 关是同一套地形的「变体场次」：key 复用（地图骨架一致），
   但名字、整屏调色、远景火光/探照灯强度全换，难度继续涨。
   —— 不这么做的话，4、5 关会顶着「破晓街区 / 焦土废墟」的名字
   和第 1、2 关长得一模一样，选关页一眼就露馅。
   grade：整屏调色（overlay 混合），fireMul / beamMul：远处火光与探照灯强度
   ------------------------------------------ */
const STAGE_THEMES = [
  { key: 'street', name: '破晓街区', grade: 'rgba(88,132,186,0.13)', fireMul: 0.65, beamMul: 0.45 },
  { key: 'ruins',  name: '焦土废墟', grade: 'rgba(206,104,44,0.16)', fireMul: 1.75, beamMul: 0.20 },
  { key: 'hq',     name: '敌方指挥部', grade: 'rgba(70,176,146,0.12)', fireMul: 0.45, beamMul: 1.70 },
  { key: 'street', name: '夜袭街区', grade: 'rgba(58,86,150,0.26)', fireMul: 0.30, beamMul: 1.35 },
  { key: 'ruins',  name: '终局火海', grade: 'rgba(226,84,42,0.22)', fireMul: 2.30, beamMul: 0.08 }
];

function stageTheme(st) {
  return STAGE_THEMES[(clamp(st, 1, 5) - 1) % STAGE_THEMES.length];
}

function buildStage(stage) {
  const st = clamp(stage, 1, 5);
  const theme = stageTheme(st);
  world.theme = theme;
  world.w = 3200 + Math.min(600, (st - 1) * 120);
  const w = world.w;
  const gy = world.groundY;

  world.platforms = [{ x: 0, y: gy, w: w, h: 200, ground: true }];
  world.covers = [];
  world.blocks = [];
  world.props = [];
  world.pits = [];
  world.hazards = [];
  world.winds = [];

  /* 深渊：地面缺一段。掉进去直接死（不是掉血，是这局就没了）。 */
  const pitAt = (x, pw, kind) => {
    world.pits.push({ x: x, w: pw, kind: kind || 'crater' });
  };
  /* 这个矩形是否压着深渊 / 气流口 —— 压着就不许放箱子、沙袋、装饰，
     否则会出现「木箱浮在坑上」「沙袋埋在气流里」这种一眼假的画面。 */
  const overPit = (x, bw) => {
    for (let i = 0; i < world.pits.length; i++) {
      const p = world.pits[i];
      if (x < p.x + p.w + 12 && x + bw > p.x - 12) return true;
    }
    return false;
  };
  const overWind = (x, bw) => {
    for (let i = 0; i < world.winds.length; i++) {
      const wd = world.winds[i];
      if (x < wd.x + wd.w + 10 && x + bw > wd.x - 10) return true;
    }
    return false;
  };
  /* 这块地能不能放机关：不能压着深渊、气流、已有障碍 */
  const freeGround = (x, bw) => {
    if (overPit(x, bw) || overWind(x, bw)) return false;
    for (let i = 0; i < world.blocks.length; i++) {
      const b = world.blocks[i];
      if (x < b.x + b.w + 8 && x + bw > b.x - 8) return false;
    }
    for (let i = 0; i < world.covers.length; i++) {
      const c = world.covers[i];
      if (x < c.x + c.w + 8 && x + bw > c.x - 8) return false;
    }
    return true;
  };

  /* 实体障碍：y 是「顶面」，和平台一样可以站上去 */
  const block = (kind, x, top, bw, bh, hp, extra) => {
    if (overPit(x, bw) || overWind(x, bw)) return;      /* 深渊与风口上不放箱子 */
    world.blocks.push(Object.assign({
      kind: kind, x: x, y: top, w: bw, h: bh, hp: hp, maxHp: hp, hit: 0, dead: false, solid: true
    }, extra || {}));
  };
  const cover = (x, bw, bh, hp) => {
    if (overPit(x, bw) || overWind(x, bw)) return;
    world.covers.push({ x: x, y: gy, w: bw, h: bh, hp: hp, maxHp: hp, hit: 0 });
  };

  let idx = 0;
  for (let bx = 300; bx < w - 380; bx += 640, idx++) {
    const lowW = 196 + (idx % 3) * 34;

    /* --- 深渊：本关最重要的地形压力 ---
       街道是炸弹坑，废墟是整片塌陷的楼板，指挥部是被炸开的后勤壕沟。
       宽度控制在 150 以内（满速起跳的水平射程约 270px），跳得过去但不敢乱跳。 */
    if (theme.key === 'street' && idx % 2 === 1) pitAt(bx + 604, 132, 'crater');
    else if (theme.key === 'ruins' && idx % 2 === 0) pitAt(bx + 596, 168, 'chasm');
    else if (theme.key === 'hq' && idx % 2 === 1) pitAt(bx + 600, 150, 'trench');

    /* --- 三层平台：高度恒定，只改宽度和数量，跳跃可达性不会被破坏 --- */
    world.platforms.push({ x: bx, y: TIER_LOW, w: lowW, h: 20, mat: 'steel', rail: true });
    world.platforms.push({ x: bx + lowW + 56, y: TIER_MID, w: 176 + (idx % 2) * 46, h: 26, mat: 'concrete' });
    if (idx % 2 === 0) {
      world.platforms.push({ x: bx + 92, y: TIER_HIGH, w: 160, h: 18, mat: 'crate', rail: true });
      /* --- 上升气流：正好托到高台边上。
         风口垫在低位钢架下面，人跳进去被顶到 296 以上，松开就能落到木箱台上；
         站偏了（x < 392）会落在低位钢架上，属于「差一点」的正常失手。

         但风口不能压在深渊上：段距 640 < 坑口末端 736，上一段的坑正好咬住
         bx+58 这个默认位置 38px（废墟坑更宽，咬 66px）。压上去有两个后果——
         坑右边缘成了蹦床（掉进去被气流顶回来，本该摔死却摔不死），
         画面上还立着一根蓝柱子直插坑口。所以按 26px 往右让，让到整段落在实地上；
         让不出去（缺口太长）就干脆不放风口，绝不留一个「坑里冒风」的现场。 */
      let wx = bx + 58;
      for (let t = 0; t < 5 && overPit(wx - 24, 104); t++) wx += 26;
      if (!overPit(wx - 24, 104)) {
        world.winds.push({ x: wx, w: 104, y: gy, top: TIER_HIGH - 64, phase: idx * 1.7 });
      }
    }
    /* 废墟：塌了半边的楼板，比别的关卡少一层高台 */
    if (theme.key === 'ruins' && idx % 3 === 0) {
      world.platforms.push({ x: bx + 300, y: TIER_MID, w: 128, h: 24, mat: 'concrete' });
    }
    /* 指挥部：火线最立体，几乎每段都补一层中台 */
    if (theme.key === 'hq' && idx % 2 === 1) {
      world.platforms.push({ x: bx + 470, y: TIER_MID, w: 140, h: 24, mat: 'concrete' });
    }

    /* --- 沙袋掩体（挡子弹、可打坏） --- */
    if (theme.key === 'street') {
      if (idx % 2 === 1) cover(bx + 40, 98, 44, 280);
    } else if (theme.key === 'ruins') {
      /* 废墟里沙袋被掀了大半，只剩零星几堆 */
      if (idx % 3 === 0) cover(bx + 56, 80, 38, 190);
    } else {
      /* 指挥部：沙袋码得更规整、更结实 */
      if (idx % 2 === 0) cover(bx + 40, 104, 48, 360);
    }

    /* --- 实体障碍：挡人、挡弹，木箱油桶能打爆 --- */
    if (theme.key === 'street') {
      /* 街区：油桶 + 木箱 + 条纹路障，通道最宽 */
      if (idx % 2 === 0) block('barrel', bx - 96, gy - 58, 38, 58, 80, { explode: 108, explodeDmg: 74 });
      block('crate', bx + lowW + 6, gy - 52, 52, 52, 170);
      block('barrier', bx + 468, gy - 40, 112, 40, 9999);
      if (idx % 3 === 1) block('crate', bx + 300, gy - 52, 52, 52, 170);
    } else if (theme.key === 'ruins') {
      /* 废墟：半塌砖墙当硬掩体，高度够蹲也能挡弹，但挡不完视线 */
      block('rubblewall', bx + 452, gy - 74, 96 + (idx % 3) * 22, 74, 9999);
      if (idx % 2 === 0) block('rubblewall', bx + 148, gy - 56, 84, 56, 9999);
      if (idx % 2 === 1) block('barrel', bx - 96, gy - 58, 38, 58, 80, { explode: 118, explodeDmg: 82 });
      if (idx % 3 === 0) block('crate', bx + lowW + 6, gy - 52, 52, 52, 150);
    } else {
      /* 指挥部：集装箱成组堆叠 + 铁丝网，硬掩体最多 */
      block('container', bx + 466, gy - 88, 152, 88, 9999);
      if (idx % 2 === 0) block('container', bx + 300, gy - 88, 100, 88, 9999);
      block('wire', bx + 118, gy - 52, 26, 52, 9999);
      if (idx % 2 === 1) block('barrel', bx - 96, gy - 58, 38, 58, 80, { explode: 112, explodeDmg: 78 });
      if (idx % 3 === 1) block('crate', bx + lowW + 6, gy - 52, 52, 52, 170);
    }

    /* --- 纯装饰：路灯亮度与碎石密度按主题走 --- */
    if (theme.key === 'street') {
      if (idx % 2 === 0) world.props.push({ x: bx + 250, y: gy, kind: 'lamp', seed: idx + 3 });
      world.props.push({ x: bx + 150, y: gy, kind: 'rubble', seed: idx * 5 + 2 });
    } else if (theme.key === 'ruins') {
      /* 路灯全灭，满地碎石与断钢筋 */
      world.props.push({ x: bx + 132, y: gy, kind: 'rubble', seed: idx * 5 + 2 });
      world.props.push({ x: bx + 268, y: gy, kind: 'rubble', seed: idx * 7 + 9 });
      world.props.push({ x: bx + 392, y: gy, kind: 'rubble', seed: idx * 3 + 5 });
    } else {
      if (idx % 3 === 0) world.props.push({ x: bx + 250, y: gy, kind: 'lamp', seed: idx + 3 });
      world.props.push({ x: bx + 208, y: gy, kind: 'rubble', seed: idx * 5 + 2 });
    }
  }

  /* ---------------- 场景机关 ----------------
     地刺：贴地一排尖刺，踩上去持续掉血并被弹开；
     喷火口：地面裂口周期性喷火，先冒火星预警、再窜出火柱，窜火时烫伤。
     两者都不挡子弹，纯粹是地形压力，逼着人别在一条水平线上站着对枪。 */
  const hazClear = (x, bw) => {
    if (!freeGround(x, bw)) return false;
    for (let i = 0; i < world.pits.length; i++) {
      const p = world.pits[i];
      /* 坑口前后各留一段空地：起跳要有助跑、落地要有站的地方 */
      if (x < p.x + p.w + 88 && x + bw > p.x - 40) return false;
    }
    for (let i = 0; i < world.hazards.length; i++) {
      const hz = world.hazards[i];
      if (x < hz.x + hz.w + 104 && x + bw > hz.x - 104) return false;   /* 机关之间别挨太近 */
    }
    return true;
  };
  const spikeAt = (x, bw) => world.hazards.push({
    kind: 'spike', x: x, y: gy, w: bw, h: 22, dmg: 16, cd: 0, seed: world.hazards.length
  });
  const flameAt = (x, bw, phase) => world.hazards.push({
    kind: 'flame', x: x, y: gy, w: bw, h: 178,
    t: phase, period: 2.8, warn: 1.0, dmg: 12,
    firing: 0, seed: world.hazards.length
  });

  /* 各关的密度差：街道零星钉刺板，废墟断气管一路漏气，指挥部到处是油火 */
  const wantSpike = theme.key === 'street' ? 3 : theme.key === 'ruins' ? 2 : 2;
  const wantFlame = theme.key === 'street' ? 1 : theme.key === 'ruins' ? 2 : 3;
  for (let i = 0, placed = 0; i < 500 && placed < wantSpike; i++) {
    const x = 470 + i * 26;
    if (x > w - 470) break;
    if (!hazClear(x, 96)) continue;
    spikeAt(x, 96);
    placed++;
  }
  for (let i = 0, placed = 0; i < 500 && placed < wantFlame; i++) {
    const x = 640 + i * 30;
    if (x > w - 470) break;
    if (!hazClear(x, 68)) continue;
    flameAt(x, 68, (i * 0.83) % 2.8);
    placed++;
  }

  /* 关卡尽头收尾平台 */
  world.platforms.push({ x: w - 320, y: TIER_LOW, w: 240, h: 20, mat: 'steel', rail: true });
}

/* ---------------- 角色工厂 ----------------
   这一层是「存档 → 实体」的唯一转换点：
     · 生命 / 护甲来自等级曲线（meta.js），再乘干员系数
     · 武器来自主/副武器配置，只有这两把是「身上带着的」
     · 弹匣容量、换弹耗时、散布、伤害乘区全部落到实体字段上，
       战斗层（game.js）只读字段，不再回头查角色定义
   -------------------------------------- */

/* 某个角色的真实弹匣容量：干员 magMul（知源 +25%）在这里生效。
   换弹、HUD、打空判定都必须走这个函数，否则三处数字会对不上。

   2.0：弹匣还要吃武器改装（meta.js 的 wStat('mag')）。
   容器 = 改装后的弹匣 × 干员 magMul —— 两个乘区叠乘，互不覆盖：
   同一把满改 M4 在知源手上是 41×1.25，在无名手上是 41。
   meta 加载在本文件之后，运行期一定已经就绪，仍然 typeof 守一次：
   只想测 world 的探针不该因为少一个元层函数就崩。 */
function magSize(a, i) {
  const wp = WEAPONS[i];
  if (!wp) return 0;
  let mag = wp.mag;
  if (typeof wStat === 'function') {
    const v = wStat(wp.id, 'mag');
    if (v > 0) mag = v;
  }
  return Math.round(mag * (a && a.magMul ? a.magMul : 1));
}

function createPlayer(x) {
  const def = charDef(SAVE.charId);
  const maxHp = Math.round(levelHp(SAVE.level) * (def.hpMul || 1));
  const magMul = def.magMul || 1;
  const pIdx = weaponById(SAVE.primary);
  return {
    kind: 'player', name: def.name, charName: def.name, charTitle: def.title,
    /* look 决定用哪套绘制：'hero' 走 chars.js 的位图战士 painter，
       'kimi' / 'glm' / 'gpt' 走程序化干员 painter。
       碰撞盒 w/h 与物理参数一律不动，换皮不影响手感与关卡可达性 */
    look: def.look, charId: def.id, seed: Math.random() * 6.28,
    x: x, y: world.groundY, vx: 0, vy: 0, w: 30, h: 58, baseH: 58, onGround: true,
    hp: maxHp, maxHp: maxHp,
    /* 护甲：等级成长 + 干员加成，最终在 damageFriendly 里做一次乘算 */
    armor: Math.min(0.60, levelArmor(SAVE.level) + (def.armorAdd || 0)),
    armorBase: levelArmor(SAVE.level), armorAdd: def.armorAdd || 0,
    aim: 0, weapon: pIdx >= 0 ? pIdx : 0,
    /* 初始弹匣直接走 magSize()，不自己再算一遍：否则「开局 30 / 上限 41」
       会一直挂到第一次换弹才对齐，HUD 上就是一个自相矛盾的读数。 */
    mags: WEAPONS.map((wp, i) => magSize({ magMul: magMul }, i)),
    magMul: magMul,
    reloadMul: def.reloadMul || 1,
    spreadMul: def.spreadMul || 1,
    dmgMul: def.dmgMul || 1,
    speedMul: def.speedMul || 1,
    dashCdMul: def.dashCdMul || 1,
    reloading: 0, fireCd: 0, dashCd: 0, dashTime: 0,
    invuln: 0, flash: 0, anim: 0, muzzle: 0,
    crouch: 0, prone: 0, hitW: 30, blocked: false, ads: false,
    downed: false, downTimer: 0, reviveProgress: 0, dead: false,
    jumpBuffer: 0, dropTimer: 0, coyote: COYOTE_TIME, plat: null, landSquash: 0,
    /* 玩家不要 avoidPits —— 踩空掉下去是这个关卡设计的一部分 */
    pitEdge: 0, pitJump: 0, pitDir: 0, airJumps: MAX_AIR_JUMPS,
    bodyColor: def.color, trim: def.coat, skin: def.skin
  };
}

function createBuddy(x) {
  /* 大肥鱼的配枪：'auto' 就是原来那套「按距离/人数自己挑」，
     指定了具体武器就锁死这一把（打空只换弹，不切枪）—— 这是玩家在
     武器库里「为大肥鱼搭配武器」的落地方式，接入点在 ai.js 的 chooseWeapon */
  const bw = SAVE.buddyWeapon;
  const lockIdx = (bw && bw !== 'auto') ? weaponById(bw) : -1;
  return {
    kind: 'buddy', name: '大肥鱼', plateName: '大肥鱼',
    /* look 决定用哪套绘制：'whale' 走 chars.js 的鲸鱼娘 painter，
       碰撞盒 / 物理参数一律不动，换皮不影响任何手感与关卡可达性 */
    look: 'whale', seed: Math.random() * 6.28,
    x: x, y: world.groundY, vx: 0, vy: 0, w: 30, h: 58, baseH: 58, onGround: true,
    hp: 100, maxHp: 100, aim: 0,
    weapon: lockIdx >= 0 ? lockIdx : 0,
    gunLock: lockIdx,     /* -1 = 自由挑枪；>=0 = 玩家指定的那一把 */
    mags: WEAPONS.map(wp => wp.mag),
    magMul: 1, reloadMul: 1, spreadMul: 1, dmgMul: 1,
    reloading: 0, fireCd: 0, flash: 0, anim: 0, muzzle: 0,
    crouch: 0, prone: 0, hitW: 30, blocked: false,
    /* 卧倒计时与压制标记：和敌兵同一套语义（见 createEnemy 的注释） */
    proneT: 0, proneCd: 0, suppress: 0, suppressCd: 0,
    downed: false, downTimer: 0, reviveProgress: 0, dead: false,
    state: 'FOLLOW', intent: 'FOLLOW', reason: '待命', intentSince: 0,
    think: 0, target: null, log: [],
    grenadeCd: 0, cmd: 'follow', holdX: 0,
    bubble: '', bubbleTimer: 0, bubbleCd: 0,
    accuracy: 0.85, reaction: 0.14, aimNoise: 0,
    style: 1, dodgeCd: 0, jumpCd: 0, react: 0, reselect: 0, coyote: COYOTE_TIME,
    jumpBuffer: 0, dropTimer: 0, plat: null, landSquash: 0,
    /* 大肥鱼会走位：崖边会刹住，真需要过就起跳 */
    avoidPits: true, pitEdge: 0, pitJump: 0, pitDir: 0, airJumps: MAX_AIR_JUMPS,
    grabTarget: null, strafeDir: 1, strafeTimer: 0,
    bodyColor: '#d9822b', trim: '#9c5a15', skin: '#e8c39a'
  };
}

function createEnemy(type, x, stage) {
  const t = ENEMY_TYPES[type];
  const scale = 1 + (stage - 1) * 0.16;
  const e = {
    kind: type, type: type, name: t.name,
    x: x, y: world.groundY, vx: 0, vy: 0, w: t.w, h: t.h, baseH: t.h, onGround: true,
    hp: Math.round(t.hp * scale), maxHp: Math.round(t.hp * scale),
    dmg: t.dmg * (1 + (stage - 1) * 0.1),
    speed: t.speed * (1 + (stage - 1) * 0.04),
    aim: 0, fireCd: rand(0.3, 1.2), burstLeft: 0, burstCd: 0,
    flash: 0, anim: 0, meleeCd: 0, dead: false, downed: false,
    spawnGuard: 0.7, boss: !!t.boss, strafe: Math.random() < 0.5 ? 1 : -1,
    strafeTimer: rand(1, 2.4), minionCd: 5, throwCd: rand(1.6, 3),
    slamCd: rand(2.5, 4), slamFx: 0,     /* 典狱长震地：冷却 + 蓄力倒计时 */
    /* 弹匣：敌人打空要换弹，玩家因此有反打窗口 */
    mag: t.mag || 0, magMax: t.mag || 0, reloadT: 0,
    crouch: 0, prone: 0, hitW: t.w, blocked: false, coverX: 0, coverT: 0,
    /* 卧倒的三个计时器：
       proneT    —— 还要趴多久（到期才起身，避免每帧重算导致趴/站抖动）
       proneCd   —— 距离下次允许卧倒还要多久（防止刚起身又趴下）
       suppress  —— 被子弹擦身之后的压制标记（>0 表示「正在被压着打」）
       suppressCd—— 压制标记的采样冷却，不然一梭子子弹会把计时器刷成常亮 */
    proneT: 0, proneCd: rand(0.6, 1.8), suppress: 0, suppressCd: 0,
    jumpBuffer: 0, dropTimer: 0, coyote: COYOTE_TIME, plat: null, jumpCd: 0,
    /* 敌兵不许把自己的二段跳用掉（它们只跨坑，不做空中补救），崖边照样会刹住 */
    avoidPits: true, pitEdge: 0, pitJump: 0, pitDir: 0, airJumps: 0, maxAirJumps: 0,
    hideX: 0, hideT: 0, coverCd: 0,        /* 躲掩体的目标点与计时 */
    chute: 0,            /* 空降时降落伞展开时间 */
    chuteVis: 0,
    look: t.look || null,   /* 外观分支（'xiaoke' → chars.js 的瓷装甲 painter） */
    color: t.color, dark: t.dark
  };
  return e;
}

/* ---------------- 子弹 ----------------
   opts 直接吃武器表（rocket / blast / blastDmg / pierce / tracer / range）
   弹道三项：grav（下坠）/ drag（减速）/ falloff（远端伤害衰减）
   bw 只是画面上的粗细，r 才是判定半径 —— 曳光再细，判定也不缩水
   ---------------------------------- */

/* 按「极限射程」反推子弹寿命。
   为什么不让表里直接写 life：drag 会让速度指数衰减，射程和寿命不是线性关系，
   每改一次 speed/drag 就得手算一遍 life，很容易出现「表上写 3800 实际只飞 2400」。
   这里直接解出来：
     有 drag 时 距离(t) = v0/k × (1 − e^(−kt))，k = −ln(1−drag)
     反解 t = −ln(1 − 目标距离 × k / v0) / k
   括号里的值逼近 0 说明射程已经接近理论上限 v0/k，物理上到不了 —— 这时按直线算，
   子弹会提前散掉（表现是「这把枪打不了那么远」），比悄悄飞不到要诚实。 */
function lifeForRange(range, speed, drag) {
  const need = range * 1.04;                  /* 多给 4%，免得残差刚好卡在边缘 */
  const k = drag > 0 ? -Math.log(1 - drag) : 0;
  let t;
  if (k > 0 && need * k / speed < 0.96) {
    t = -Math.log(1 - need * k / speed) / k;
  } else {
    t = need / Math.max(120, speed);
  }
  return Math.min(t, 6);                      /* 上限 6 秒，避免极端参数让子弹挂着不走 */
}

function spawnBullet(x, y, vx, vy, dmg, team, color, size, owner, opts) {
  const o = opts || {};
  const spd = Math.hypot(vx, vy) || 1;
  const range = o.range || 0;
  bullets.push({
    x, y, vx, vy, dmg, team,
    color: color || '#ffd88a',
    r: size || 3.2,
    w: o.bw || size || 3.2,
    /* 玩家武器按 range 反推寿命；敌人子弹没有 range，回落到旧的三档硬编码 */
    life: o.life || (range > 0 ? lifeForRange(range, spd, o.drag || 0)
      : (o.rocket ? 3.4 : (o.tracer ? 3.0 : 2.2))),
    range: range,                /* 飞到这里就消散 —— 这就是「极限射程」 */
    owner: owner || team,
    px: x, py: y,
    rocket: !!o.rocket,
    blast: o.blast || 0,
    blastDmg: o.blastDmg || 0,
    pierce: o.pierce || 0,
    tracer: !!o.tracer,
    tracerLen: o.tracerLen || 300,
    grav: o.grav || 0,
    drag: o.drag || 0,
    falloff: o.falloff || 0,
    dist: 0,                     /* 已经飞了多远（伤害衰减、曳光衰减都看它） */
    /* 射手站的那块平台不挡自己的子弹（见 platformBlocks） */
    ignorePlat: o.ignorePlat || null,
    hits: o.pierce ? [] : null
  });
}

function spawnGrenade(x, y, vx, vy, dmg, team, opts) {
  grenades.push(Object.assign(
    { x, y, vx, vy, dmg, team, fuse: 1.6, spin: 0, r: 6, fire: false },
    opts || {}
  ));
}

/* 火焰地带：燃烧瓶炸开后留在地上的持续伤害区域。
   dmg 是每次灼烧的伤害，tick 是灼烧间隔 —— 站着不动会被慢慢烧死。 */
function spawnFire(x, y, r, life, dmg) {
  fires.push({ x, y, r, life, max: life, dmg, tick: 0.3, seed: Math.random() * 6.28 });
}

function spawnPickup(x, y, type) {
  pickups.push({
    x, y, vx: rand(-60, 60), vy: -260, type,
    life: 20, bob: rand(0, 6.28), onGround: false
  });
}

/* ---------------- 沙袋掩体 / 实体障碍 ----------------
   两者字段一致（x, y=顶面, w, h, hp），统一按同一条链路处理：
   挡子弹 → 掉血 → 打穿后爆成碎块
   -------------------------------------------------- */
function coverBlocks(x, y) {
  for (let i = 0; i < world.covers.length; i++) {
    const c = world.covers[i];
    if (c.hp <= 0) continue;
    if (x > c.x && x < c.x + c.w && y > c.y - c.h && y < c.y) return c;
  }
  for (let i = 0; i < world.blocks.length; i++) {
    const b = world.blocks[i];
    if (b.hp <= 0) continue;
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return b;
  }
  return null;
}

/* ---------------- 空中平台也挡子弹 ----------------
   台阶、钢板台、混凝土台都是实心梁，弹道撞上就该停 —— 不只是木箱油桶才挡。
   判定只取「顶面以下的实体部分」：站在平台上开枪时枪口在顶面之上，
   不会被自己脚下这块吃掉；而从下方仰射、从侧面平射都会实打实撞上。 */
function platformBlocks(x, y, ignore) {
  for (let i = 0; i < world.platforms.length; i++) {
    const p = world.platforms[i];
    if (p.ground) continue;
    /* 射手自己脚下这块不挡自己 —— 否则站在高台上对下方等于完全失明，
       大肥鱼和敌兵也会隔着脚下的板子打一整局空枪。 */
    if (ignore && p === ignore) continue;
    if (x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h) return p;
  }
  return null;
}

/* 打在平台上：钢结构迸白火星，混凝土掉灰渣，顺带留一点弹着痕迹 */
function hitPlatform(p, x, y) {
  const steel = p.mat === 'steel';
  /* 弹着点先来一下白热闪光：光靠几颗 2px 的小火星，在暗掉的街景里几乎看不见。
     闪光只有 0.09 秒，不会在画面上留下长期的脏点。 */
  particles.push({
    x: x, y: y, vx: 0, vy: 0, life: 0.09, max: 0.09,
    color: '#fff6d8', size: 7, grav: 0, ball: true
  });
  /* 火星速度收窄到 170，打出来的是一小簇而不是散一屏的粉末 */
  spawnParticles(x, y, steel ? 5 : 4, steel ? '#d6ecff' : '#ded4c4', 170, 0.26, 2.6, 900);
  spawnParticles(x, y, 2, '#8a8175', 70, 0.45, 3.2, 260);
  /* 金属叮声只是偶尔来一下，连着打满屏会很吵 */
  if (steel && Math.random() < 0.22) beep(rand(1500, 2000), 0.04, 'square', 0.01, 700);
}

/* 某个矩形是否和实体障碍重叠（敌人/大肥鱼走位前用） */
function blockedAt(x, y, w) {
  const half = w * 0.5;
  for (let i = 0; i < world.blocks.length; i++) {
    const b = world.blocks[i];
    if (b.hp <= 0) continue;
    if (x + half > b.x && x - half < b.x + b.w && y > b.y + 2) return b;
  }
  return null;
}

function hurtCover(c, dmg, x, y) {
  c.hit = 0.14;
  spawnParticles(x, y, 3, c.kind === 'container' || c.kind === 'barrier' ? '#b9b3a4' : '#c2ab7a', 170, 0.32, 2.6, 780);
  if (c.hp >= 9999) return;            /* 混凝土 / 集装箱：只掉火星，打不穿 */
  c.hp -= dmg;
  if (c.hp <= 0) {
    c.hp = 0;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    if (c.explode) {
      /* 油桶：炸开，连带伤害周围 */
      explode(cx, cy, c.explode, c.explodeDmg, 'world');
    } else {
      sfxBoom();
      addShake(4);
      spawnParticles(cx, cy, 22, '#b39b6a', 320, 0.75, 6, 780);
      spawnParticles(cx, cy, 12, '#6b5c42', 200, 0.95, 8, 500);
    }
    spawnText(cx, c.y - 8, c.kind === 'barrel' ? '油桶爆炸' : '掩体被打穿', '#ffb066');
  }
}

/* ---------------- 命中部位 ----------------
   人形按「脚底坐标 e.y、身高 e.h」从头顶往下切三段：
   头 0~22% / 躯干 22~62% / 腿 62~100%（和 drawEnemy 里 -58~0 的比例对得上）。
   爆头 2 倍是这套系统的意义所在 —— 让「瞄得准」比「按得久」更划算；
   腿 0.68 倍不是惩罚，压枪扫腿能更快把冲上来的兵打停。
   BOSS 也分部位，但头上有头盔，倍率收到 1.45 而不是 2.0。 */
const HIT_PARTS = [
  { key: 'head', hi: 0.22, mul: 2.00, mulBoss: 1.45 },
  { key: 'torso', hi: 0.62, mul: 1.00, mulBoss: 1.00 },
  { key: 'legs', hi: 9.99, mul: 0.68, mulBoss: 0.85 }
];

/* 命中点落在哪个部位（hy 是世界坐标的弹着点） */
function hitPart(e, hy) {
  const h = e.h || 1;
  const frac = clamp((hy - (e.y - h)) / h, 0, 0.999);
  for (let i = 0; i < HIT_PARTS.length; i++) {
    if (frac < HIT_PARTS[i].hi) return HIT_PARTS[i];
  }
  return HIT_PARTS[1];
}

/* ---------------- 伤害 ---------------- */
function damageEnemy(e, dmg, hx, hy, src) {
  if (e.dead) return;
  e.lastSrc = src || e.lastSrc;

  const t = ENEMY_TYPES[e.type] || {};
  let d = dmg;

  /* 部位倍率：只有拿到弹着点才算，爆炸溅射走的是躯干中心，天然 1.0 倍 */
  const part = (typeof hy === 'number') ? hitPart(e, hy) : HIT_PARTS[1];
  const mul = e.boss ? part.mulBoss : part.mul;
  d *= mul;
  e.lastPart = part.key;

  /* 钢铁典狱长：正面装甲吃掉 55% 伤害。
     必须先算「子弹从哪边来」，所以 hx 不能省 —— 绕到背后打才疼。
     装甲和部位倍率是叠乘的：正面爆头 1.45×0.45 ≈ 0.65，绕背爆头就是实打实 1.45。 */
  if (t.armor && typeof hx === 'number') {
    const facing = Math.cos(e.aim) >= 0 ? 1 : -1;
    if (Math.sign(hx - e.x) === facing) {
      d *= t.armor;
      if (Math.random() < 0.4) spawnText(hx, hy - 16, '叮', '#9fd8ff');
    }
  }

  e.hp -= d;
  e.flash = 0.12;

  if (part.key === 'head') {
    /* 爆头：血雾更浓、数字更大，玩家不看数字也知道这一枪打对了地方 */
    spawnParticles(hx, hy, 9, '#ff6b5a', 260, 0.45, 3.4, 640);
    spawnParticles(hx, hy, 4, '#ffd166', 190, 0.3, 2.4, 520);
    spawnText(hx, hy - 12, '爆头 ' + Math.round(d), '#ffe08a', { size: 1.3, life: 1.1, vy: -54 });
  } else if (part.key === 'legs') {
    spawnParticles(hx, hy, 3, '#c9534a', 180, 0.3, 2.6, 640);
    spawnText(hx, hy - 10, Math.round(d), '#a8c4d4', { size: 0.9 });
  } else {
    spawnParticles(hx, hy, 4, '#ff6b5a', 220, 0.35, 3, 600);
    spawnText(hx, hy - 10, Math.round(d), '#ffd166');
  }

  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  game.kills++;
  game.score += ENEMY_TYPES[e.type].score;
  /* 金币 / 经验结算：实现放在 game.js（要动存档和等级），这里只报一个事件 */
  onKillReward(e);
  if (e.lastSrc === 'buddy') game.tele.buddyKills++;
  else if (e.lastSrc === 'player') game.tele.playerKills++;
  /* 尸体：被打死的人不会「啪」一下消失。留一具会软下去的躯体，
     等它躺稳了再淡出 —— 掉进深渊的除外（坑里没有地面可以躺）。 */
  if (!e.fell) spawnCorpse(e, player && player.x > e.x ? -1 : 1);
  spawnParticles(e.x, e.y - e.h / 2, e.boss ? 60 : 22, '#ff7b54', e.boss ? 520 : 320, 0.8, e.boss ? 8 : 5, 900);
  spawnParticles(e.x, e.y - e.h / 2, e.boss ? 30 : 10, '#3a3a3a', 260, 0.7, e.boss ? 9 : 6, 700);
  addShake(e.boss ? 16 : 3);
  addDecal(e.x, e.y - 2, 'blood');

  if (e.boss) {
    /* ---- BOSS 击破演出：慢动作 + 白闪 + 连环爆 ----
       普通敌人倒地是「啪」一下，BOSS 必须给三秒钟的开香槟时间。 */
    game.slowmo = 1.15;
    game.screenFlash = Math.max(game.screenFlash || 0, 0.62);
    game.bossIntro = null;
    addShake(20);
    sfxBoom();
    /* 沿躯干补爆三点，配合慢动作能看清火球一层层炸开 */
    const top = e.y - e.h;
    for (let i = 0; i < 3; i++) {
      const ex = e.x + rand(-e.w * 0.45, e.w * 0.45);
      const ey = top + e.h * (0.18 + i * 0.30);
      explode(ex, ey, 86 + i * 14, 26, 'player');
    }
    spawnText(e.x, top - 46, 'BOSS 击破', '#ffd166');
    say('buddy', '倒下了！这家伙终于躺了！');
    spawnPickup(e.x - 42, e.y - 40, 'health');
    spawnPickup(e.x + 42, e.y - 40, 'health');
    spawnPickup(e.x, e.y - 54, 'ammo');
    return;
  }

  const r = Math.random();
  if (r < 0.22) spawnPickup(e.x, e.y - 30, 'health');
  else if (r < 0.55) spawnPickup(e.x, e.y - 30, 'ammo');
}

/* ---------------- 尸体 ----------------
   不是为了「更血腥」，是为了让击杀有重量：人被打中会先失去支撑，
   膝盖折下去、上身歪倒、手臂最后才落下 —— 落地还有一次余震。
   这些全部由 t 一个计时器推出来，渲染层不做状态机。
   -------------------------------------- */
function spawnCorpse(e, dir) {
  const ty = ENEMY_TYPES[e.type] || {};
  corpses.push({
    x: e.x,
    y: e.y,
    h: e.baseH || e.h,
    dir: dir >= 0 ? 1 : -1,
    color: e.color || ty.color || '#8a4a4a',
    dark: e.dark || ty.dark || '#5a3030',
    boss: !!e.boss,
    look: e.look || null,
    vy: 0,
    t: 0,
    life: CORPSE_LIFE + rand(0, 2.2),
    seed: Math.random() * 6.28,
    /* 站在地上死的立刻开始软；空中打下来的要先掉一段再塌 */
    landed: (surfaceBelow(e.x, e.y) - e.y) < 8
  });
}

function damageFriendly(actor, dmg) {
  if (actor.dead || actor.downed || actor.invuln > 0) return;
  /* 护甲减伤：只做一次乘算，飘字显示的是「实际掉的血」。
     玩家护甲来自等级成长 + 干员加成；大肥鱼没有 armor 字段 → 0。
     不作用在敌人身上（敌人走 damageEnemy 自己的 armor 逻辑）。 */
  if (actor.armor > 0) dmg *= (1 - actor.armor);
  actor.hp -= dmg;
  actor.flash = 0.16;
  actor.invuln = 0.18;
  actor.lastHurt = game.time;
  sfxHurt();
  addShake(4);
  spawnParticles(actor.x, actor.y - actor.h * 0.6, 8, '#d94a4a', 200, 0.4, 3.5, 700);
  spawnText(actor.x, actor.y - actor.h - 6, '-' + Math.round(dmg), '#ff5a5a');
  addDecal(actor.x + rand(-8, 8), actor.y - 2, 'blood');
  if (actor.hp <= 0) {
    actor.hp = 0;
    actor.downed = true;
    actor.downedAt = game.time;      /* 倒地动画的起点：从站姿软下去，不是瞬间躺平 */
    actor.downTimer = actor.kind === 'player' ? 12 : 14;
    actor.reviveProgress = 0;
    actor.vx = 0;
    if (actor.kind === 'player') say('buddy', '指挥官倒下了！撑住，我过来了！');
    else say('buddy', '本鱼挂彩了……掩护我！');
    addShake(10);
    if (actor.kind === 'buddy') game.buddyDownAt = game.time;
  }
}

/* ---------------- 大肥鱼气泡 ---------------- */
let sayCooldown = 0;
function say(who, text) {
  if (!buddy || buddy.dead) return;
  if (sayCooldown > 0 && buddy.bubble !== text) return;
  buddy.bubble = text;
  buddy.bubbleTimer = 2.6;
  sayCooldown = 2.2;
}
