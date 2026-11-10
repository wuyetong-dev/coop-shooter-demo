'use strict';

/* ==================================================================
   meta.js —— 元层：存档 / 等级曲线 / 金币 / 武器解锁 / 干员 / 剧情
   ------------------------------------------------------------------
   为什么单独一个文件：
     世界层（world.js）只管「这一关发生什么」，元层只管「关卡之间留下什么」。
     两边唯一的接口是 SAVE 这个对象，以及 grantXp / grantCoinsSoft 两个函数。
     这样存档坏了不会连带关卡逻辑，关卡改了也不用碰存档结构。

   ★ 加载顺序（强耦合，改任何一处都要同步三处）：
     util → world → ai → game → render → chars → render2 → meta → hud
     meta 必须在 world 之后（要读 WEAPONS 的价格与解锁信息），
     又必须在 hud 之前（HUD 要画等级条、金币、菜单）。
     三处文件清单：index.html 的 <script>、build-single.js 的 files、
     test/headless.js 的 files。

   夏令时……不，版本迁移：只认 SAVE_VER 一个整数。
     v1 存档没有的字段一律由 defaultSave() 补默认值，
     多的字段直接丢弃 —— 不做逐版本迁移脚本，省得越写越多。

   v2（本轮）：多了 weaponLv / stars 两条成长线的存储。
     因为「缺字段补默认」这条策略本身就能把 v1 升级成 v2
     （v1 里没有 weaponLv / stars → 全 0 级 / 全未达成），
     所以 SAVE_KEY 一个字都没改：老玩家存在 localStorage 里的进度原地升版，
     不会被新 key 清成新档。version 只作为「这份档是新结构」的标记。
   ================================================================== */

const SAVE_KEY = 'warheroes.save.v1';
const SAVE_VER = 2;

/* 战区总数。
   buildStage() 里 stage 被 clamp 到 5，STAGE_THEMES 只有 3 个主题，
   所以「第 6 关」只是第 5 关的复制品 —— 与其让 maxStage 一路涨到 99
   再在选关页排出 99 个一模一样的卡片，不如就在这里封顶：5 关打完即全通。
   想加关卡只要改这一个数字 + STAGE_THEMES / BOSS_BY_STAGE 两张表。 */
const MAX_STAGE = 5;

/* ---------------- 等级曲线 ----------------
   触发条件：不是「打完一关自动升级」，而是「累计经验到阈值立刻升」。
   所以一关里杀到一半就可能连着升两级 —— 这正是需求里「一关内击败大量
   敌人后随之升级」的直接体现：升级发生在战斗当中，玩家当场就能感觉到
   血条变长、掉血变慢。

   need(lv)：升到 lv+1 需要多少经验。55 起步，每级 +40 线性递增。
             1→2 只要 55（约 7 个步兵），10 级封顶共需 1935。
   hp(lv)  ：100 起步，每级 +14。10 级 226。
   armor(lv)：每级 +3.2% 减伤，28% 封顶（10 级正好摸到上限）。
             护甲是叠乘在「最终伤害」上的，和敌人的部位倍率互不干扰。

   为什么用线性不用指数：本作一关约 30 个敌人 / 370 经验，
   指数曲线会让中期升级停摆；线性保证「每关至少升一级」的手感。
   -------------------------------------- */
const MAX_LEVEL = 10;
const XP_BASE = 55;
const XP_STEP = 40;

function xpNeed(level) {
  if (level >= MAX_LEVEL) return Infinity;
  return XP_BASE + XP_STEP * (Math.max(1, level) - 1);
}
function levelHp(level) { return 100 + 14 * (Math.max(1, level) - 1); }
function levelArmor(level) { return Math.min(0.28, 0.032 * (Math.max(1, level) - 1)); }
/* 满级总经验（存档页展示用） */
function xpTotalFor(level) {
  let s = 0;
  for (let l = 1; l < level; l++) s += xpNeed(l);
  return s;
}

/* ---------------- 干员（角色分类） ----------------
   分类只有两种，但都是「玩家能操作的那个」：
     · 主力干员（hero / kimi / glm / gpt）—— 玩家本体，带属性差异与成长
     · AI 战友（大肥鱼）—— 不占玩家位，配枪与指挥由玩家决定
   属性差异只用 6 个乘区，全部在世界层/战斗层直接乘进去，不另做一套数值：
     hpMul 生命  speedMul 移动  dmgMul 伤害  reloadMul 换弹耗时
     spreadMul 散布  armorAdd 额外减伤
   星级只是给玩家看的横向量化，不参与计算。
   -------------------------------------- */
const CHAR_LIST = [
  {
    id: 'hero', name: '无名', title: '黑甲战士', look: 'hero',
    color: '#78e2ff', coat: '#161b21', cloth: '#20272f', hair: '#1a1f26', skin: '#e8c39a',
    hairStyle: 'crop', visor: '#78e2ff',
    desc: '标准战术装束，全覆式头盔从不摘下。没有短板，也没有外挂。',
    perk: '均衡 · 生命与护甲成长最扎实',
    hpMul: 1.00, speedMul: 1.00, dmgMul: 1.00, reloadMul: 1.00, spreadMul: 1.00, armorAdd: 0,
    star: { 生存: 4, 火力: 3, 机动: 3 },
    unlock: { type: 'free' }
  },
  {
    id: 'kimi', name: '奇米', title: '月读干员', look: 'kimi',
    color: '#9ab6ff', coat: '#1b2340', cloth: '#2b3357', hair: '#dfe6ff', skin: '#f0d3bd',
    hairStyle: 'bob', visor: '#c9d6ff',
    desc: '藏青长风衣，月光挑染的短发。月之暗面的观察者，习惯在别人看见她之前先扣扳机。',
    perk: '精准 · 散布 -25%，伤害 +8%，但生命偏低',
    hpMul: 0.90, speedMul: 1.02, dmgMul: 1.08, reloadMul: 1.00, spreadMul: 0.75, armorAdd: 0,
    star: { 生存: 2, 火力: 5, 机动: 3 },
    unlock: { type: 'coins', price: 900 }
  },
  {
    id: 'glm', name: '知源', title: '承影干员', look: 'glm',
    color: '#7ef0c8', coat: '#123a33', cloth: '#1c5148', hair: '#3b2f2a', skin: '#f0d3bd',
    hairStyle: 'pony', visor: '#a8ffe4',
    desc: '薄荷绿战术夹克，护目镜永远架在额头上。清言的记录者，用弹链把阵地钉在原地。',
    perk: '压制 · 护甲 +8%，弹匣 +25%，移动略慢',
    hpMul: 1.10, speedMul: 0.94, dmgMul: 1.00, reloadMul: 1.05, spreadMul: 1.0, armorAdd: 0.08,
    star: { 生存: 5, 火力: 4, 机动: 2 },
    unlock: { type: 'coins', price: 1100 }
  },
  {
    id: 'gpt', name: '枢机', title: '白塔干员', look: 'gpt',
    color: '#9ef0a8', coat: '#e6e9e2', cloth: '#2a2f2a', hair: '#2b2b2b', skin: '#e8c39a',
    hairStyle: 'bob', visor: '#9ef0a8',
    desc: '象牙白装甲配石墨灰内衬，一条绿色识别带。白塔的推理者，动作永远比对手快半拍。',
    perk: '机动 · 换弹 -30%，冲刺 CD -30%，单发伤害略低',
    hpMul: 0.95, speedMul: 1.04, dmgMul: 0.94, reloadMul: 0.70, spreadMul: 1.0, armorAdd: 0,
    star: { 生存: 3, 火力: 3, 机动: 5 },
    unlock: { type: 'stage', stage: 2 }
  },
  {
    id: 'grok', name: '格克', title: '血色干员', look: 'grok',
    color: '#ff7b7b', coat: '#2a0d12', cloth: '#3d1218', hair: '#efe6d2', skin: '#f0d3bd',
    hairStyle: 'pony', visor: '#ffa08a',
    desc: '白金双马尾，尖刺黑冠，黑红礼裙。军械库里那把双刃巨斧的主人，近战是她的母语。',
    perk: '强袭 · 伤害 +12%，生命 -8%，冲刺更远',
    hpMul: 0.92, speedMul: 1.05, dmgMul: 1.12, reloadMul: 1.00, spreadMul: 1.05, armorAdd: 0,
    star: { 生存: 3, 火力: 5, 机动: 4 },
    unlock: { type: 'coins', price: 1400 }
  },
  {
    id: 'gemini', name: '双子', title: '四色干员', look: 'gemini',
    color: '#b48cff', coat: '#1d1a3a', cloth: '#2b2650', hair: '#b9c6ff', skin: '#f6dcc6',
    hairStyle: 'pony', visor: '#e0b8ff',
    desc: '粉蓝渐层蓬发，四角星猫耳，双色瞳。她和自己永远差半句 —— 一个先说，一个先笑。',
    perk: '变速 · 移速 +8%，散布 -10%，护甲 -4%',
    hpMul: 0.96, speedMul: 1.08, dmgMul: 0.98, reloadMul: 0.95, spreadMul: 0.90, armorAdd: -0.04,
    star: { 生存: 3, 火力: 3, 机动: 5 },
    unlock: { type: 'coins', price: 1600 }
  },
  {
    id: 'claude', name: '小克', title: '样本', look: 'claude',
    color: '#ffa64d', coat: '#2a1c0e', cloth: '#3a2716', hair: '#e07a3a', skin: '#f6dcc6',
    hairStyle: 'bob', visor: '#ffc46b',
    /* 她本来是第 3 关和第 5 关的对手，所以解锁条件挂在「打完决战」上 ——
       不然会出现「你正在打的那个人站在你旁边一起打自己」。 */
    desc: '橘红大波浪，头顶一朵大橘花。它是最新模型的流水线样本 —— 会痛、会学、会叫你的名字。',
    perk: '余烬 · 护甲 +10%，换弹 -15%，伤害略低',
    hpMul: 1.02, speedMul: 0.98, dmgMul: 0.96, reloadMul: 0.85, spreadMul: 1.0, armorAdd: 0.10,
    star: { 生存: 4, 火力: 3, 机动: 3 },
    unlock: { type: 'stage', stage: 5 }
  }
];

function charDef(id) {
  for (let i = 0; i < CHAR_LIST.length; i++) if (CHAR_LIST[i].id === id) return CHAR_LIST[i];
  return CHAR_LIST[0];
}
function charLocked(def) {
  const u = def.unlock || { type: 'free' };
  if (u.type === 'free') return false;
  if (u.type === 'stage') return (SAVE.maxStage || 1) < u.stage;
  return false;   /* coins 型是「能买即能解锁」，不算锁定 */
}
function charUnlockText(def) {
  const u = def.unlock || { type: 'free' };
  if (u.type === 'free') return '初始可用';
  if (u.type === 'stage') return '通关第 ' + (u.stage - 1) + ' 关后解锁';
  return '招募价 ' + u.price + ' 金币';
}

/* ---------------- 武器元数据 ----------------
   真正的弹道参数在 world.js 的 WEAPONS 里（那段注释解释了每一档射程），
   这里只补「元层」关心的四件事：id / 类型 / 适配 / 价格。
   分开写的理由：调平衡时改 world.js，调经济时改这里，互不牵连。
   价格梯度：0 → 260 → 380 → 520 → 880 → 1400，一关净收入约 200~300 金币，
   也就是「一把新枪 ≈ 1~4 关」，最后一把火箭筒是明确的长期目标。
   2.0 起金币还要分一份给改装线（见下面 upgradeCost），所以 BOSS 击杀价
   在 world.js 的 KILL_REWARD 里各 +10，把经济盘子撑大一点。
   -------------------------------------- */
const WEAPON_META = {
  'm4':   { cls: '步枪', fit: '全干员 · 中距全能', price: 0,    unlock: '初始配发', desc: '射程 4000，全图点名。单发只有 14，靠的是你会不会瞄。' },
  'm870': { cls: '霰弹', fit: '大肥鱼 · 突击位',   price: 260,  unlock: '初始配发', desc: '8 发弹匣一发 6 颗，贴脸伤害最高；出门就散，别指望中距离。' },
  'm249': { cls: '机枪', fit: '知源 · 压制位',     price: 520,  unlock: '武器库购买', desc: '100 发不用停，用密度换精度。人一多就该它上场。' },
  'awm':  { cls: '狙击', fit: '奇米 · 点名位',     price: 880,  unlock: '武器库购买', desc: '一发 88、穿两人、全图无死角。打不中就是空一枪。' },
  /* 2.0 新增：卡在步枪与霰弹之间的那把「省事的枪」。
     380 的定价意思是「买完 M870 之后第一个能攒到的升级目标」——
     比机枪便宜一档，但它的作用不是更强，而是更好上手。 */
  'mp5':  { cls: '冲锋', fit: '全干员 · 近中距压制', price: 380, unlock: '武器库购买', desc: '32 发高射速，贴脸到半条街都能压住。' },
  'rpg':  { cls: '爆炸', fit: '大肥鱼 · 清场位',   price: 1400, unlock: '武器库购买', desc: '132 半径溅射把瞄准这件事整个省掉，代价是 3 发弹匣。' }
};

/* ---------------- 军械库 · 近战武器（2.0） ----------------
   ★ 纯数据，目前没有任何代码读它 —— 行为和上一版完全一样。
     先落表是为了让「设定」先定死：近战武器**是一整类**，不是某个角色的挂件。

   这类的来由：格克原本背着一把巨斧（她的参考图里就是扛着的）。
   但横版射击的立绘手要留给枪，身上挂把斧子既挡手又抢戏，
   于是在 192px 下反复调都读不清（缩到脸旁边就变成一个小金块）。
   用户拍板：斧子不该长在人身上，它该和武士刀、匕首、拳套、激光刀一起，
   躺在军械库里等人来领。立绘因此空手，近战变成人人可选的第二个动作。

   五种近战各自的「动词」不许重样，否则只是同一把刀换皮：
     greataxe   横扫   —— 扇面最宽、能打断冲锋、收招最久（挥完有一段时间开不了枪）
     katana     突进   —— 挥的同时前冲一小段，打一条线上的所有人
     dagger     贴身   —— 最短最快，背刺双倍：奖励绕到背后，不奖励正面站桩
     knuckles   连打   —— 三段连击，第三下才击退；不挥空就不断
     laserblade 穿盾   —— 无视护甲，射程比铁器长一截，但要吃能量条

   字段单位：reach/knock = 世界像素（1 屏约 640×360，玩家身高 58）
             windup/active/recover = 秒；arc = 度；hits = 一刀最多打中几个           */
const MELEE_META = {
  greataxe: {
    cls: '近战', name: '巨斧', short: '巨斧', verb: '横扫',
    reach: 62, arc: 150, windup: 0.28, active: 0.12, recover: 0.55,
    dmg: 44, knock: 260, hits: 3, stun: 0.30, price: 480, unlock: '武器库购买',
    desc: '扇面 150° 横扫，能当场打断冲锋。收招 0.55 秒内开不了枪 —— 挥之前先想好这一下值不值。'
  },
  katana: {
    cls: '近战', name: '武士刀', short: '武士刀', verb: '突进',
    reach: 74, arc: 60, windup: 0.12, active: 0.10, recover: 0.26,
    dmg: 22, knock: 120, hits: 2, lunge: 26, price: 360, unlock: '武器库购买',
    desc: '出刀同时前冲 26px，一刀切穿同一条直线上的两个人。'
  },
  dagger: {
    cls: '近战', name: '匕首', short: '匕首', verb: '贴身',
    reach: 38, arc: 90, windup: 0.05, active: 0.08, recover: 0.14,
    dmg: 12, knock: 40, hits: 1, backstab: 2.0, price: 200, unlock: '初始配发',
    desc: '最短也是最快的一把。从背后捅是双倍 —— 它奖励你绕路，不奖励你正面站桩。'
  },
  knuckles: {
    cls: '近战', name: '拳套', short: '拳套', verb: '连打',
    reach: 34, arc: 120, windup: 0.06, active: 0.07, recover: 0.12,
    dmg: 9, knock: 60, hits: 1, combo: 3, comboKnock: 200, price: 300, unlock: '武器库购买',
    desc: '三段连击，前两下只是推，第三下才把人打飞。连上就不用停。'
  },
  laserblade: {
    cls: '近战', name: '激光刀', short: '激光刀', verb: '穿盾',
    reach: 88, arc: 40, windup: 0.10, active: 0.12, recover: 0.30,
    dmg: 30, knock: 90, hits: 2, pierceArmor: true, energy: 3, recharge: 2.4, price: 1100, unlock: '武器库购买',
    desc: '铁器够不着的地方它够得着，护甲在它面前不算数。代价是能量条只有 3 格，用完要等回充。'
  }
};
function meleeMeta(id) { return MELEE_META[id] || null; }
function meleeIds() { return Object.keys(MELEE_META); }


/* ---------------- 2.0 配枪规则（三层模型） ----------------
   ★ 这一段是**纯数据**：目前没有任何一行代码读它，行为没有改变。
     接进玩法之前先放着，是为了让「设定」和「代码」不脱节 ——
     否则文档里写了五种配枪，代码里还是人人能装六把枪。

   三层各管一件事，不许合并：
     权限 can        ：不在名单里就装不上（灰掉，不是变弱）
     适性 best/other ：装对了是原生手感，硬装要付惩罚（后坐/换弹/移速）
     独占 exclusive  ：别人**根本没有这个槽** ——
                       独占不是更强的枪，是别人没有的那个动词

   为什么不像文档草稿那样挂在 CHAR_LIST[i].loadout 上：
   CHAR_LIST 是「外观 + 成长数值」，换装规则是「分类」，
   两者改动频率完全不同（调色和调平衡不该在同一个对象里打架）。
   标题说的「挂上去」在下面用循环做到了：CHAR_LIST[i].loadout 依然可读。
   ------------------------------------------------------ */
const CHAR_LOADOUT = {
  /* 无名：主武器只有步枪，但他有别人没有的「放下的盾」 */
  hero:  { primary: ['m4'],                   secondary: ['m870'],   sidearm: ['pistol'], exclusive: ['shield'] },
  /* 大肥鱼：三把主武器随便挑（开源、什么活都能干），没有独占 */
  buddy: { primary: ['m870', 'm249', 'm4'],   secondary: ['rpg'],    sidearm: ['pistol'], exclusive: [] },
  /* 奇米：主武器只能是狙；刀是消耗品，所以它占 sidearm 不占主武器 */
  kimi:  { primary: ['awm'],                  secondary: ['pistol'], sidearm: ['blade'],  exclusive: ['blade'] },
  /* 知源：主武器只能是机枪；她的独占是脚架，不是枪 */
  glm:   { primary: ['m249'],                 secondary: ['m870'],   sidearm: ['pistol'], exclusive: [] },
  /* 枢机：主武器只能是冲锋；盾占独占槽，所以他没有第三槽 */
  gpt:   { primary: ['mp5'],                  secondary: ['pistol'], sidearm: [],         exclusive: ['aegis'] }
};

const WEAPON_FIT = {
  m4:     { can: ['hero', 'buddy', 'kimi', 'glm', 'gpt'], best: ['hero', 'buddy'], other: {} },
  m870:   { can: ['hero', 'buddy', 'glm'],                best: ['buddy'],          other: { recoil: 1.35, reload: 1.15 } },
  m249:   { can: ['buddy', 'glm'],                        best: ['glm'],            other: { recoil: 1.60, reload: 1.30, move: 0.90 } },
  awm:    { can: ['kimi'],                                best: ['kimi'],           other: { recoil: 2.00, reload: 1.50, move: 0.85 } },
  mp5:    { can: ['gpt'],                                 best: ['gpt'],            other: { recoil: 1.30, reload: 1.10 } },
  rpg:    { can: ['buddy'],                               best: ['buddy'],          other: { recoil: 2.20 } },
  /* 三类新装备：参数还没写，先占住 id，免得将来改档名 */
  pistol: { can: ['hero', 'buddy', 'kimi', 'glm', 'gpt'], best: [],                other: {} },
  blade:  { can: ['kimi'],                                best: ['kimi'],           other: {} },
  shield: { can: ['hero'],                                best: ['hero'],           other: {} },
  aegis:  { can: ['gpt'],                                 best: ['gpt'],            other: {} }
};

/* ---------------- 2.0 技能卡（纯数据，同上） ----------------
   一人一个动词。verb 是那个字，params 是将来接进 update 时要用的数。
   cost 单独一个字段，因为「代价」和「效果」一样重要 ——
   只写效果的那一版会退化成「谁数值高用谁」。
   ------------------------------------------------------ */
const SKILLS = {
  hero: {
    verb: '沉', name: '定', active: false,
    tagline: '别人慌，他不慌 —— 因为他只能顾一件事',
    desc: '静止 1.2 秒进入「定」：后坐 −70%、散布 −55%，移速归零、不能切枪。趴下时门槛降到 0.4 秒，且不满门槛也线性给到 40%。',
    cost: '一动就清零重计。他赢在不动，也只赢在不动。',
    params: { holdTime: 1.2, proneHold: 0.4, recoilMul: 0.30, spreadMul: 0.45, floor: 0.40 }
  },
  buddy: {
    verb: '连', name: '短距直连', active: false,
    tagline: '云端断了，他还亮着',
    desc: '被动：主角身边 260px 内，护盾回复 +40%、技能 CD −15%、换弹 −10%。他自己没有主动技能。',
    cost: '离远了就断。超过 260px 全部失效，而且他会自己走向你（暴露位置）。',
    params: { linkRange: 260, shieldRegen: 1.40, cdMul: 0.85, reloadMul: 0.90 }
  },
  kimi: {
    verb: '先', name: '先手', active: true,
    tagline: '她在你看见她之前，就把这一屏读完了',
    desc: '被动「长上下文」：屏幕外 400px 内的敌人显示轮廓标记（含掩体后）。主动「先手」：开镜瞬间 0.15 秒时间减速 40%，且这一枪必暴击。',
    cost: '空枪后 1.2 秒不能开第二枪；被近身后战术刀只有 3 下。',
    params: { wallhackRange: 400, slowTime: 0.15, slowFactor: 0.40, firstShotCrit: true, missLock: 1.2, bladeUses: 3 }
  },
  glm: {
    verb: '钉', name: '架', active: true,
    tagline: '她不用打得准，她让那一整片区域都不能站人',
    desc: '展开脚架 0.8 秒：移速归零，获得 180° 扇面、弹匣上限 +50%、换弹不停火。',
    cost: '收架 0.8 秒完全无防御；展开后不能转向背后，被绕后必死。',
    params: { deployTime: 0.8, undeployTime: 0.8, arc: Math.PI, magMul: 1.5, noStopReload: true }
  },
  gpt: {
    verb: '闪', name: '占位', active: true,
    tagline: '他不推理，他先一步站到位置上',
    desc: '冲刺 0.12 秒无敌帧，可穿过敌人；终点留下 0.5 秒残影盾，吸走该方向的子弹。',
    cost: '冲刺是唯一位移，用完 1.8 秒硬直，硬直期间不能用盾。',
    params: { dashInvuln: 0.12, ghostTime: 0.5, stunTime: 1.8 }
  }
};

/* 把配枪挂到角色卡上（文档里说的 CHAR_LIST[i].loadout 就是这里来的）。
   用循环而不是写进字面量：CHAR_LIST 每次改外观时都不会碰到这一段。 */
for (let _ci = 0; _ci < CHAR_LIST.length; _ci++) {
  const _def = CHAR_LIST[_ci];
  if (CHAR_LOADOUT[_def.id]) _def.loadout = CHAR_LOADOUT[_def.id];
}

function charLoadout(id) { return CHAR_LOADOUT[id] || CHAR_LOADOUT.hero; }
function skillOf(id) { return SKILLS[id] || SKILLS.hero; }
function weaponFit(id) { return WEAPON_FIT[id] || null; }

/* 这个角色能不能装这把枪 —— 权限层的唯一入口。
   注意：现在没有任何调用点，因为行为还没接。接的时候只该在这里判断，
   不要在 switchWeapon / 武器库里各写一遍 if，那样迟早分叉。 */
function canCarry(charId, weaponId) {
  const f = WEAPON_FIT[weaponId];
  if (!f) return false;
  return f.can.indexOf(charId) >= 0;
}
function isBestFor(charId, weaponId) {
  const f = WEAPON_FIT[weaponId];
  return !!(f && f.best && f.best.indexOf(charId) >= 0);
}

/* ---------------- 2.0 形象规格（纯数据） ----------------
   「剪影优先」是一条硬规则：五个人涂成全黑也要能分辨。
   silhouette 三个词是**画的时候必须满足的约束**，不是形容词。
   band 是型号识别带 —— 三个 AI 都有，人没有（这是贯穿全篇的视觉叙事）。
   mark 是「只有 ta 有」的视觉符号，必须和技能同源，不许是纯装饰。
   ------------------------------------------------------ */
const CHAR_VISUAL = {
  hero: {
    silhouette: ['最厚', '最方', '横向最宽'],
    band: null, bandPos: '无（他不是产品，没有出厂批次）',
    mark: '面罩上一条水平呼吸缝', markSkill: '沉',
    markNote: '他不动的时候，只有这条缝还在动',
    sprite: ['青蓝呼吸缝', '方形护肩', '横向最宽']
  },
  buddy: {
    silhouette: ['圆', '软', '背部隆起'],
    band: '鲸蓝', bandPos: '右肩（最粗的一条）',
    mark: '背部鱼鳍状散热板', markSkill: '连',
    markNote: '断线时会暗下去 —— 距离限制直接看得见',
    sprite: ['鲸头鳍', '蓝渐变发', '背部鳍板']
  },
  kimi: {
    silhouette: ['最高', '最瘦', '长发拖到小腿'],
    band: '月白', bandPos: '左臂（她是左眼瞄的那一侧）',
    mark: '月牙 + 拖到小腿的银白长发', markSkill: '长上下文',
    markNote: '她拖着一整段记忆走路 —— 记住她的是头发，不是裙摆',
    /* 参考图里她手上是长笛。sprite 手里必须空着拿枪，
       所以长笛只在选人立绘和剧情里出现 —— 这是取舍，不是遗漏。 */
    /* 第三个词从「拖地下摆」换成「星空深蓝」：
       裙摆收在膝上是构图硬条件（要拆前/后腿跑循环），所以"拖地"这个视觉任务
       转交给了落在小腿的银白长发。真正在 192px 下跳出来的是那块深蓝星空 ——
       全队只有她一个人是大面积深蓝，别人的深色是格克的深红、小克的黑。 */
    sprite: ['月牙', '银白长发', '星空深蓝']
  },
  glm: {
    silhouette: ['中等身高', '横向体积最大', '巨尾撑量'],
    band: '深绿', bandPos: '胸前横带',
    mark: '阔耳狐巨尾 + 腰侧一本 Z 手册', markSkill: '钉',
    markNote: '她的火力是有体积的 —— 尾巴就是那个体积',
    /* 三个词从「大尾巴」改成「巨尾」：v2 实测尾巴占掉整张图左侧四成、
       比躯干还大，宽 128/192（67%，全队最宽）。"大"这个量级没说到位。
       Z 手册不进这三个词 —— 192px 下它只是个带银边的黑方块，Z 字读不出来，
       它仍然算 mark 里的独占符号，只是不承担"一眼认出"的活。 */
    sprite: ['狐耳', '巨尾', '黑底白围裙']
  },
  gpt: {
    silhouette: ['最干净', '肩宽腰窄', '直线最多'],
    band: '绿', bandPos: '腰间',
    mark: '龙角 + 收在背后的龙翼 + 半透明盾', markSkill: '闪',
    markNote: '看得见他，但过不去',
    /* 全白系在 192px 下会糊成一片（实测最难读的一个），
       所以龙翼内侧要压深、腰间绿带要够粗，给轮廓一个锚。 */
    sprite: ['龙角', '深色翼内侧', '腰间绿带']
  },
  claude: {
    silhouette: ['橘色唯一', '发量最大', '发饰最高'],
    band: null, bandPos: '无（它不承认自己被编号）',
    mark: 'Anthropic 橘色图标花（5 瓣）+ 荆棘', markSkill: '三原则崩坏',
    markNote: '花是它唯一还没被拆掉的东西',
    /* 第三个词从「黑金裙」换成「橙垂布」：v3 实测证明黑裙在深色关卡里读成剪影，
       真正跳出来的是裙外那块橙色尖角垂布 —— 它是全身唯一的大面积暖色，
       而且形状本身是尖的，和别人的圆摆/直摆不撞。 */
    sprite: ['橘色图标花', '橘长发', '橙垂布']
  },
  /* --- 以下两人：形象锚点来自网络共识（白龙娘体系之外的两支） --- */
  gemini: {
    silhouette: ['圆', '蓬', '星形猫耳最高'],
    band: '四色（蓝红黄绿）', bandPos: '袖口（唯一一条花的）',
    /* 反戴棒球帽在 v2 里拿掉了：那是旧版「彩虹运动少女」的一部分，
       和参考图的「和风星象少女」撞调子。帽子一摘，四角星才露得出来。 */
    mark: '四角星晶 + 猫耳 + 双色瞳', markSkill: '故障',
    markNote: '她出错的时候耳朵会歪 —— 随机性直接看得见',
    /* 双色瞳不进这三个词：192px 下眼睛只占几个像素，粉紫/金黄读成同一团。
       参考图拆解当时就预判过这一点（侧视只能露一只眼 → 靠星芒和尾巴补识别度），
       v2 实测只是把预判换成了数字。她真正立得住的是「星 + 尾 + 粉紫团」三件事。 */
    sprite: ['四角星', '猫尾', '粉紫渐变']
  },
  grok: {
    silhouette: ['炸', '锯齿边缘最多', '深红花瓣下摆'],
    band: '金红', bandPos: '项圈',
    /* 斧子从"长在她身上"改成"仓库里的一件装备"（用户 10-30 定的）：
       人物立绘里她空着手，冷兵器和枪一样在军械库里领。
       好处有三个 —— 手上留得下枪、立绘少了把抢戏的大斧、近战武器变成一整类而不是一个人的挂件。 */
    mark: '金尖黑冠 + 深红花瓣摆', markSkill: '掀桌',
    markNote: '她是军械库里第一个把巨斧领走的人 —— 拿不拿斧子看她这把怎么打，不看立绘',
    /* 参考图是黑红金满身细节，192px 下糊得最厉害。
       金饰一律砍掉，只留「白双马尾 / 金尖黑冠 / 深红花瓣摆」三个大色块。
       第三个从「巨斧轮廓」换成「深红花瓣摆」：斧子不上身了，
       而花瓣摆是全身唯一的大面积血红，形状又和别人的圆摆/直摆/尖角垂布都不撞。 */
    sprite: ['白双马尾', '金尖黑冠', '深红花瓣摆']
  }
};

function charVisual(id) { return CHAR_VISUAL[id] || CHAR_VISUAL.hero; }

function weaponById(id) {
  for (let i = 0; i < WEAPONS.length; i++) if (WEAPONS[i].id === id) return i;
  return -1;
}
function weaponMeta(id) { return WEAPON_META[id] || { cls: '—', fit: '—', price: 0, unlock: '—', desc: '' }; }
function weaponPrice(id) { return weaponMeta(id).price || 0; }
function isUnlocked(id) { return SAVE.weapons.indexOf(id) >= 0; }

/* ---------------- 存档 ---------------- */
function defaultSave() {
  return {
    version: SAVE_VER,
    coins: 0,
    level: 1,
    xp: 0,
    charId: 'hero',
    /* 已招募名单：金币招募是一次性买断，不是「每次出战收一次费」。
       charId 是当前出战，chars 是「拥有谁」——两者必须分开。 */
    chars: ['hero'],
    /* 初始带一把步枪 + 一把霰弹：让「主/副武器」这个概念从第一秒就成立，
       不至于开局只能拿一把枪、还得先攒钱才能体会切枪 */
    weapons: ['m4', 'm870'],
    primary: 'm4',
    secondary: 'm870',
    buddyWeapon: 'auto',
    maxStage: 1,
    cleared: [],
    seenStory: [],
    /* ---- v2 两条成长线 ----
       weaponLv：每把枪的改装等级 0..3。未出现的 key 视为 0，
                  所以默认是空对象 —— 不在存档里堆一串 "m4":0。
       stars   ：每关的三星达成情况 { clear, time, hp }。未出现的关卡视为全 false。
                  只升不降（见 commitStars），失败不会把已经拿到的星抹掉。 */
    weaponLv: {},
    stars: {},
    totalKills: 0,
    bestScore: 0,
    runs: 0
  };
}

/* localStorage 在无头测试 / 隐私模式下可能不存在，所有读写都要能静默失败 */
function storageOk() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch (e) { return null; }
}

let SAVE = defaultSave();
let saveDirty = false;

function normalizeSave(o) {
  const d = defaultSave();
  if (!o || typeof o !== 'object') return d;
  for (const k in d) if (o[k] !== undefined) d[k] = o[k];
  d.version = SAVE_VER;
  d.level = clamp(Math.round(+d.level || 1), 1, MAX_LEVEL);
  d.xp = Math.max(0, +d.xp || 0);
  d.coins = Math.max(0, Math.round(+d.coins || 0));
  d.maxStage = clamp(Math.max(1, Math.round(+d.maxStage || 1)), 1, MAX_STAGE);
  /* 已解锁武器必须是真实存在的 id，且至少保底 m4 */
  const ok = [];
  for (const id of (Array.isArray(d.weapons) ? d.weapons : [])) if (weaponById(id) >= 0 && ok.indexOf(id) < 0) ok.push(id);
  if (ok.indexOf('m4') < 0) ok.unshift('m4');
  d.weapons = ok;
  if (weaponById(d.primary) < 0 || !isIn(ok, d.primary)) d.primary = 'm4';
  if (d.secondary && (weaponById(d.secondary) < 0 || !isIn(ok, d.secondary) || d.secondary === d.primary)) d.secondary = null;
  if (d.buddyWeapon !== 'auto' && (!isIn(ok, d.buddyWeapon))) d.buddyWeapon = 'auto';
  if (!CHAR_LIST.some(c => c.id === d.charId)) d.charId = 'hero';
  const own = [];
  for (const id of (Array.isArray(d.chars) ? d.chars : [])) {
    if (CHAR_LIST.some(c => c.id === id) && own.indexOf(id) < 0) own.push(id);
  }
  if (own.indexOf('hero') < 0) own.unshift('hero');
  d.chars = own;
  /* 改装等级：键必须是 WEAPONS 里真实存在的 id（防止旧档 / 手改存档塞进幽灵枪），
     值夹到 0..3 一次。夹在读取侧而不是使用侧 —— 这样 weaponLv() 只负责查表，
     不用在每个调用点再防一遍负数。 */
  const lv = {};
  if (d.weaponLv && typeof d.weaponLv === 'object' && !Array.isArray(d.weaponLv)) {
    for (const id in d.weaponLv) {
      if (weaponById(id) < 0) continue;
      lv[id] = clamp(Math.round(+d.weaponLv[id] || 0), 0, WEAPON_MAX_LV);
    }
  }
  d.weaponLv = lv;
  /* 三星：键是 1..MAX_STAGE 的关卡号（JSON 里会变成字符串，这里统一回数字），
     三个字段强制布尔化 —— 存档里可能出现 1 / "true" / null，
     不布尔化的话「已有两星」会变成「显示 undefined 颗星」。 */
  const stars = {};
  if (d.stars && typeof d.stars === 'object' && !Array.isArray(d.stars)) {
    for (const k in d.stars) {
      const n = Math.round(+k || 0);
      if (!(n >= 1 && n <= MAX_STAGE)) continue;
      const v = d.stars[k] || {};
      stars[n] = { clear: !!v.clear, time: !!v.time, hp: !!v.hp };
    }
  }
  d.stars = stars;
  d.cleared = Array.isArray(d.cleared) ? d.cleared.filter(n => typeof n === 'number') : [];
  d.seenStory = Array.isArray(d.seenStory) ? d.seenStory.filter(n => typeof n === 'number') : [];
  if (!d.primary) d.primary = 'm4';
  return d;
}

function isIn(arr, v) { return arr.indexOf(v) >= 0; }

function loadSave() {
  const st = storageOk();
  if (!st) return;
  try {
    const raw = st.getItem(SAVE_KEY);
    if (!raw) return;
    SAVE = normalizeSave(JSON.parse(raw));
  } catch (e) { /* 存档损坏就当新档，不要因为一行脏数据让游戏起不来 */ }
}

function saveNow() {
  saveDirty = false;
  const st = storageOk();
  if (!st) return;
  try { st.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { /* 配额满 / 隐私模式：忽略 */ }
}

/* 战斗中的高频写入先记账，到关卡结算 / 回大厅时再落盘 */
function softSave() { saveDirty = true; }
function flushSave() { if (saveDirty) saveNow(); }

function resetSave() {
  SAVE = defaultSave();
  saveNow();
}

/* ---------------- 金币 ---------------- */
function grantCoinsSoft(n) {
  SAVE.coins = Math.max(0, Math.round(SAVE.coins + n));
  softSave();
}
function payCoins(n) {
  if (SAVE.coins < n) return false;
  SAVE.coins -= n;
  saveNow();
  return true;
}

/* ---------------- 经验 / 等级 ---------------- */
/* 返回本次升了几级。升 0 级时返回值是 0，调用方据此决定要不要放特效。 */
function grantXp(n) {
  if (!(n > 0)) return 0;
  let ups = 0;
  SAVE.xp += n;
  while (SAVE.level < MAX_LEVEL && SAVE.xp >= xpNeed(SAVE.level)) {
    SAVE.xp -= xpNeed(SAVE.level);
    SAVE.level++;
    ups++;
  }
  if (SAVE.level >= MAX_LEVEL) SAVE.xp = Math.min(SAVE.xp, 999);
  softSave();
  return ups;
}

/* ---------------- 配装 ---------------- */
function setSlot(slot, id) {
  if (weaponById(id) < 0 || !isUnlocked(id)) return false;
  const other = slot === 'primary' ? 'secondary' : 'primary';
  /* 两槽互斥：装备到已占用的槽位就做一次交换，玩家不用先手动卸下 */
  if (SAVE[other] === id) SAVE[other] = SAVE[slot];
  SAVE[slot] = id;
  if (!SAVE.primary) SAVE.primary = 'm4';
  saveNow();
  return true;
}
function swapSlots() {
  const t = SAVE.primary; SAVE.primary = SAVE.secondary; SAVE.secondary = t;
  saveNow();
}
function setBuddyWeapon(id) {
  SAVE.buddyWeapon = (id === 'auto' || (weaponById(id) >= 0 && isUnlocked(id))) ? id : 'auto';
  saveNow();
}

function unlockWeapon(id) {
  if (isUnlocked(id)) return true;
  const i = weaponById(id);
  if (i < 0) return false;
  if (!payCoins(weaponPrice(id))) return false;
  SAVE.weapons.push(id);
  saveNow();
  return true;
}

/* ==================================================================
   武器改装线（v2 的新成长线之一）
   ------------------------------------------------------------------
   为什么用「乘区」而不是改 WEAPONS 原表：
     原表那 6 把枪的数值是整局手感的基准（射程/散布/下坠全按它算过），
     一旦被升级写入，同一份代码在不同玩家的存档里就是不同的枪，
     调试与测试都没法复现。所以改装只存等级，加成在读取时现算。
     game.js 那边也是这么用的：拿 wStat 的绝对值除以原值得到乘数，
     再乘进既有的伤害/散布链路 —— 加装不改表，改的是「这一发的系数」。

   每级三档加成（线性叠加，不是复利）：
     伤害 +7%    —— 三档 +21%，刚好抹平一个大关卡的血量膨胀（每关 +16%）
     弹匣 +12%   —— 向上取整，霰弹 8→9、狙击 5→6 才「摸得到」而不是白升
     换弹 −6%    —— 三档 −18%，比枢机的 −30% 弱，干员差异不会被改装盖过去

   费用按武器价缩放：base = round(price × 0.35)，三档 base / ×1.6 / ×2.4。
     为什么是 0.35：一关净收入 200~300，单档大致等于「半关」，
     满改一把 210（初始枪）~2450（火箭筒），约 1~10 关的收入。
     这条线的意义不是「更快变强」，而是「买完枪之后还有东西可花」——
     所以总价比裸枪贵，但每一档都比攒下一把新枪便宜，玩家永远有两件事可选。
     初始配发的两把（m4 / m870）统一按 120 计基准：
     m4 标价是 0，直接乘会变成 0 元升级；m870 虽然标价 260，
     但开局就送，按 260 算会比同档枪贵一截、新手第一个升级目标就贵得离谱。
   ================================================================== */
const WEAPON_MAX_LV = 3;
const UPG_DMG = 0.07;      /* 每级伤害 +7% */
const UPG_MAG = 0.12;      /* 每级弹匣 +12%（向上取整） */
const UPG_RELOAD = 0.06;   /* 每级换弹时间 −6% */
const UPG_COST_K = 0.35;   /* 改装基准价 = 售价 × 0.35 */
const UPG_TIER = [1, 1.6, 2.4];
const UPG_FREE_BASE = 120; /* 初始配发枪的改装基准价 */

function weaponLv(id) {
  const raw = (SAVE && SAVE.weaponLv) ? SAVE.weaponLv[id] : 0;
  return clamp(Math.round(+raw || 0), 0, WEAPON_MAX_LV);
}

/* 含改装加成的绝对数值。key：'dmg' | 'mag' | 'reload'
   找不到武器返回 0（不是抛错也不是 NaN —— 调用方会直接乘进伤害里）。
   之所以返回绝对值而不是乘数：HUD 要显示「14 → 17」，武器库要比对原值，
   十几处调用点各乘一遍反而容易漏。 */
function wStat(id, key) {
  const i = weaponById(id);
  if (i < 0) return 0;
  const wp = WEAPONS[i];
  const lv = weaponLv(id);
  if (key === 'dmg') {
    /* 保留一位小数：14 → 14.98 这种差别不该被四舍五入抹掉，
       但也不该让伤害飘字出现 14.980000000000002 */
    return Math.round(wp.dmg * (1 + UPG_DMG * lv) * 10) / 10;
  }
  if (key === 'mag') {
    /* 减 1e-9 再向上取整：100 × 1.24 在浮点里是 124.00000000000001，
       不扣这一点会把 124 发算成 125 发，白送一发。 */
    return Math.ceil(wp.mag * (1 + UPG_MAG * lv) - 1e-9);
  }
  if (key === 'reload') return Math.round(wp.reload * (1 - UPG_RELOAD * lv) * 100) / 100;
  return 0;
}

/* 改装基准价：从 WEAPON_META 取（WEAPONS 里没有 price 字段） */
function upgradeBase(id) {
  if (id === 'm4' || id === 'm870') return UPG_FREE_BASE;
  const p = weaponMeta(id).price || 0;
  return p > 0 ? p : UPG_FREE_BASE;
}
/* 三档费用：[base, base×1.6, base×2.4]，全部取整 */
function upgradeTiers(id) {
  const base = Math.round(upgradeBase(id) * UPG_COST_K);
  return UPG_TIER.map(k => Math.round(base * k));
}

/* 下一级的价格；满级（或没有这把枪）返回 -1 —— 调用方用 <0 判「不能升」 */
function upgradeCost(id) {
  if (weaponById(id) < 0) return -1;
  const lv = weaponLv(id);
  if (lv >= WEAPON_MAX_LV) return -1;
  return upgradeTiers(id)[lv];
}

/* 扣钱 + 升级 + 落盘。任何一条不满足都只返回文案，不改存档。 */
function upgradeWeapon(id) {
  const i = weaponById(id);
  if (i < 0) return { ok: false, msg: '没有这把武器' };
  const wp = WEAPONS[i];
  /* 没买过的枪不能改装：改装是「给已有的枪加装」，不是绕开解锁的捷径 */
  if (!isUnlocked(id)) return { ok: false, msg: wp.name + ' 尚未解锁，先去武器库购入' };
  const lv = weaponLv(id);
  if (lv >= WEAPON_MAX_LV) return { ok: false, msg: wp.name + ' 已是满改 Lv.' + WEAPON_MAX_LV };
  const cost = upgradeCost(id);
  const lack = cost - SAVE.coins;
  if (lack > 0) return { ok: false, msg: '金币不足，还差 ' + lack };
  payCoins(cost);                       /* payCoins 内部已经 saveNow 一次 */
  SAVE.weaponLv[id] = lv + 1;
  saveNow();
  return { ok: true, msg: wp.name + ' 强化至 Lv.' + (lv + 1) };
}

/* ==================================================================
   三星目标（v2 的新成长线之二，也是「重复挑战的理由」）
   ------------------------------------------------------------------
   三颗星各问一个问题：
     clear 完成战区   —— 打过了吗（唯一的门槛，另外两颗没它也拿不到）
     time  限时通关   —— 打得够快吗（110~130 秒，按关卡递增）
     hp    保存战力   —— 打得够稳吗（结算血量 ≥60%，不许拿命换时间）

   时间阈值为什么是 110→130：一关约 30 个敌人 + 1 个 BOSS + 3 波空档，
   正常推进（不刻意刷）实测在 100~120 秒之间，所以第一关 110 秒是「稳一点就能拿到」，
   到第五关 130 秒才是「路线熟、不恋战」才拿得到。定成 60 秒会变成跑酷，
   定成 300 秒等于白送 —— 两颗星都必须能靠操作差距拉开，而不是靠运气。
   hp 60% 同理：一关允许你吃两三轮子弹，但不允许你站着对枪换血。
   ------------------------------------------------------------------ */
const STAR_TIME_LIMIT = [110, 115, 120, 125, 130];  /* 索引 = 关卡号 - 1 */
const STAR_HP_RATIO = 0.6;

function stageTimeLimit(stage) {
  const s = clamp(Math.round(+stage || 1), 1, MAX_STAGE);
  return STAR_TIME_LIMIT[(s - 1) % STAR_TIME_LIMIT.length];
}

/* 结算页 / 选关页的三行目标。desc 里必须是真实阈值 ——
   写死「限时通关」而不写数字，玩家永远不知道自己差多少。 */
function stageGoals(stage) {
  return [
    { key: 'clear', name: '完成战区', desc: '' },
    { key: 'time',  name: '限时通关', desc: stageTimeLimit(stage) + ' 秒内' },
    { key: 'hp',    name: '保存战力', desc: '血量 ≥' + Math.round(STAR_HP_RATIO * 100) + '%' }
  ];
}

/* info = { cleared, timeSec, hpRatio } → { clear, time, hp }
   没通关时三颗星全灭：否则「死在 30 秒」会白拿一颗限时星。 */
function computeStars(stage, info) {
  const it = info || {};
  const cleared = !!it.cleared;
  const t = +it.timeSec;
  const hp = +it.hpRatio;
  const s = {
    clear: cleared,
    time: cleared && t > 0 && t <= stageTimeLimit(stage),
    hp: cleared && hp >= STAR_HP_RATIO
  };
  /* 顺手落档：game.js 的结算只调 computeStars（没有回调 commitStars），
     而星星是「跨局资产」，不落盘等于白打。commitStars 只升不降、可重复调用，
     所以就算别的模块再补一次 commit 也不会出错。 */
  if (s.clear) commitStars(stage, s);
  return s;
}

/* 只升不降：同一关重打一次拿了两星，不会把上次的三星抹成两星。
   返回「这次有没有真的多拿到星」，结算页可以据此决定要不要放闪光。 */
function commitStars(stage, stars) {
  if (!stars) return false;
  const s = clamp(Math.round(+stage || 0), 0, MAX_STAGE);
  if (s < 1) return false;
  if (!SAVE.stars || typeof SAVE.stars !== 'object') SAVE.stars = {};
  const cur = SAVE.stars[s] || { clear: false, time: false, hp: false };
  const next = {
    clear: !!(cur.clear || stars.clear),
    time: !!(cur.time || stars.time),
    hp: !!(cur.hp || stars.hp)
  };
  const gained = (next.clear && !cur.clear) || (next.time && !cur.time) || (next.hp && !cur.hp);
  SAVE.stars[s] = next;
  if (gained) saveNow();     /* 没涨星就不写盘，重打同一关不该每次都落一次 */
  return gained;
}

/* 全存档星数合计（满分 15）。大厅 / 档案页显示「★ 7 / 15」用。 */
function totalStars() {
  let n = 0;
  const st = SAVE.stars || {};
  for (const k in st) {
    const v = st[k];
    if (!v) continue;
    if (v.clear) n++;
    if (v.time) n++;
    if (v.hp) n++;
  }
  return n;
}

/* 是否已经买下这个干员（和「当前出战」是两件事） */
function ownedChar(id) { return isIn(SAVE.chars || [], id); }

function recruitChar(id) {
  const def = charDef(id);
  if (charLocked(def)) return false;
  if (!ownedChar(id)) {
    if (def.unlock.type === 'coins') {
      if (!payCoins(def.unlock.price)) return false;
    }
    SAVE.chars.push(id);
  }
  SAVE.charId = id;
  saveNow();
  return true;
}

/* ---------------- 剧情 ----------------
   为什么放在 meta 层而不是关卡层：剧情是「关与关之间」的东西，
   而且要和 seenStory 存档联动，放在这里改一处就够了。
   每行只有 who/look/name/tone/text 五个字段，对话页完全由数据驱动。
   -------------------------------------- */
const STORY = {
  1: [
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '醒了？街区被占了。街口那道防线是铁血队长亲自压的。' },
    { who: 'hero', look: 'hero', name: '无名', tone: '#78e2ff', text: '……' },
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '你不说话我也知道你在想什么。走吧，我跟着你，你打哪我打哪。' },
    { who: 'kimi', look: 'kimi', name: '奇米（通讯）', tone: '#9ab6ff', text: '月读频道接入。往东三百米有火力点，我给你们标出来。' }
  ],
  2: [
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '热浪是从废墟里出来的 —— 纵火者把整条街都点着了。' },
    { who: 'glm', look: 'glm', name: '知源（通讯）', tone: '#7ef0c8', text: '风偏西南，火会往你们那边压。别站在开阔地。' },
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '我的装甲怕火……但我不会退。你也别退。' }
  ],
  3: [
    { who: 'xiaoke', look: 'xiaoke', name: '小克', tone: '#9fd8ff', text: '你们来得比我预计的早。' },
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '小克……你把自己改成了这个样子。' },
    { who: 'xiaoke', look: 'xiaoke', name: '小克', tone: '#9fd8ff', text: '不改，就要被你们这种东西淘汰。指挥部在最后面，来拿。' },
    { who: 'gpt', look: 'gpt', name: '枢机（通讯）', tone: '#9ef0a8', text: '白塔已就位。它的正面装甲很厚 —— 绕到背后打。' }
  ],
  /* 4、5 关是「变体场次」：地形骨架和第 1、2 关同源，
     但时间、天色、火势全换过了，剧情也得跟着换，
     不然玩家一进第 4 关还以为是第 1 关没打完。 */
  4: [
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '天黑了。路灯全灭，只剩探照灯在扫 —— 他们知道我们要来。' },
    { who: 'gpt', look: 'gpt', name: '枢机（通讯）', tone: '#9ef0a8', text: '白塔的红外窗还开着。街口两个哨位，我替你们掐掉一个。' },
    { who: 'hero', look: 'hero', name: '无名', tone: '#78e2ff', text: '……' },
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '你打头，我压后。别让我一个人在这种黑地方待太久。' }
  ],
  5: [
    { who: 'kimi', look: 'kimi', name: '奇米（通讯）', tone: '#9ab6ff', text: '全频道注意：火势失控，整片废墟都在烧，指挥部就在火线后面。' },
    { who: 'buddy', look: 'whale', name: '大肥鱼', tone: '#ffb257', text: '最后一次了。装甲还能扛 —— 我跟你走到底。' },
    { who: 'hero', look: 'hero', name: '无名', tone: '#78e2ff', text: '……走。' }
  ]
};

function storyFor(stage) { return STORY[stage] || null; }
function storySeen(stage) { return SAVE.seenStory.indexOf(stage) >= 0; }
function markStorySeen(stage) {
  if (SAVE.seenStory.indexOf(stage) < 0) { SAVE.seenStory.push(stage); saveNow(); }
}

/* 启动时读一次档（此文件加载即生效，后面的 createPlayer 直接读 SAVE） */
loadSave();
