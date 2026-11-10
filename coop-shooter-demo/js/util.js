'use strict';

/* ==================================================================
   双人闯关 Demo   —— 基础层：常量 / 工具 / 输入 / 音效
   ================================================================== */

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const W = 1280, H = 720;

/* ------------------------------------------------------------------
   物理参数：全部手感调优集中在这里
   跳跃高度 = JUMP_V² / (2·GRAV) = 1000² / 4200 ≈ 238px
   ------------------------------------------------------------------ */
const GRAV          = 2100;   // 重力加速度
const VY_MAX        = 1900;   // 最大下落速度
const JUMP_V        = 1000;   // 满跳初速 → 跳高约 238px（原版只有 123px，跳不上平台）
const JUMP_CUT      = 0.42;   // 松开跳跃键时残余速度的截断系数（可变跳高）
const JUMP_V2       = 880;    // 二段跳初速 → 空中再抬约 184px（比首跳低一档，够上高台但不越过设计高度）
const MAX_AIR_JUMPS = 1;      // 空中还能再跳几次（1 = 二段跳）
const COYOTE_TIME   = 0.12;   // 土狼时间：走出平台边缘后仍允许起跳
const JUMP_BUFFER   = 0.14;   // 跳跃缓冲：落地前提前按跳，落地瞬间自动起跳
const WIND_ACCEL    = 2750;   // 上升气流托举力（> GRAV，站在里面就会被顶起来）
const WIND_RISE_MAX = 560;    // 气流里的最大上升速度
const FALL_DEPTH    = 176;    // 掉到地面线以下这么深就算坠入深渊（此时人已在画面外）
const AIRJUMP_FLIP  = 0.42;   // 二段跳空翻时长（秒）：蹬腿、团身、转体、展开
const CORPSE_LIFE   = 7.0;    // 尸体在场上停留多久（之后淡出，只留血迹）
const MOVE_SPEED    = 290;    // 地面移动速度
const MOVE_ACCEL    = 5200;   // 地面加速度（不是瞬间满速，有轻微推重感）
const MOVE_FRICTION = 6400;   // 地面摩擦
const AIR_ACCEL     = 2700;   // 空中控制力
const DROP_TIME     = 0.20;   // 按下 + 跳 穿过单向平台的时长

/* ---------- 数学工具 ---------- */
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function angleLerp(a, b, t) {
  return a + angleDiff(a, b) * clamp(t, 0, 1);
}
function distTo(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/* ==================================================================
   姿态三档：站 / 蹲 / 趴
   ------------------------------------------------------------------
   蹲和趴都是 0→1 的连续量，不是布尔 —— 起身、蹲下、躺下都有过渡，
   一帧切状态会读成「瞬移」。两者互斥：趴下时蹲姿自动淡出，
   所以到处用的都是「有效蹲量」cqEff，而不是 a.crouch 本身。

   三样东西必须由同一份数据推出来，否则会出现「看着趴下了、
   判定还是站着」这种最伤人的错位：
     · h      受击盒高度（全局唯一的高度判定来源）
     · hitW   受击盒宽度（趴下横向变长 —— 这是趴下的代价）
     · 绘制   各 painter 用同一个 cqEff 和同一个躺倒角 pronePose
   ================================================================== */
const PRONE_DROP = 30;    /* 站立身高之外再下压多少（按身高等比，58→28） */
const PRONE_ADD_W = 36;   /* 趴下受击宽 30 → 66：躲高处子弹，但侧身更好打 */

function proneK(a) { return clamp(a.prone || 0, 0, 1); }

/* 有效蹲量：趴下去的过程中蹲姿淡出，两个姿态不会同时满值 */
function cqEff(a) { return clamp(a.crouch || 0, 0, 1) * (1 - proneK(a)); }

/* ------------------------------------------------------------------
   姿态过渡：扑倒和起身不是同一个动作
   ------------------------------------------------------------------
   原来是「每帧按固定比例逼近目标」的指数插值，而且扑倒与起身共用
   同一条曲线。数学上连续，读起来是软的：
     · 起步就在全速（速度不连续，读成「弹射」），越靠近越磨（尾巴拖沓）
     · 躺下去和站起来一样费劲 —— 这不成立，站起来要收重心、撑手、抬身
   所以改成「记时长 + 缓动」的补间：时长管节奏、缓动管手感。
   两条方向给两条曲线：
     · 扑倒 0.24 秒，二次加速 —— 越倒越快，着地一拍停住（有砸下去的重量）
     · 起身 0.36 秒，S 形缓动 —— 起手慢（收重心）、中段快（撑起来）、
       站定收（稳住），比扑倒慢 50%，这就是姿态的代价之一
   为什么扑倒用二次而不是三次：三次在头半段几乎不动（前 0.12 秒只转
   10°），后半段 60 毫秒里甩完剩下的 75° —— 读起来是「先发呆再砸」，
   换一种生硬。二次曲线是恒力矩下的真实角位移（θ ∝ t²），前段能看见
   人在往下倒，后段又有重量。
   半路反悔（趴到一半松手、松手又按住）从当前值重新起一段，不会跳变。
   返回 {u, done, dir, from}，done 只在那一步「刚好到位」的那一帧为真 ——
   落地扬土、起身的音效都挂在 done 上，而不是靠比较浮点数。 */
const POSE_FALL_T = 0.24;
const POSE_RISE_T = 0.36;

function poseIn(u) { return u * u; }                   /* 加速：越倒越快，着地急停 */
function poseInOut(u) { return u * u * (3 - 2 * u); }  /* 两头慢、中间快：撑起来 */

function poseStep(a, field, want, dt, fallT, riseT) {
  const key = field + 'Ps';
  let s = a[key];
  const dir = want ? 1 : -1;
  if (!s || s.dir !== dir) {
    s = a[key] = {
      dir: dir,
      from: a[field] || 0,
      t: 0,
      dur: want ? (fallT === undefined ? POSE_FALL_T : fallT)
                : (riseT === undefined ? POSE_RISE_T : riseT)
    };
  }
  const t0 = s.t;
  s.t = Math.min(s.dur, t0 + dt);
  const u = s.dur > 0 ? s.t / s.dur : 1;
  a[field] = want ? s.from + (1 - s.from) * poseIn(u)
                  : s.from * (1 - poseInOut(u));
  return { u: u, done: t0 < s.dur && s.t >= s.dur, dir: dir, from: s.from };
}

/* 当前身高。cDrop 是这一档蹲下压掉多少（玩家/大肥鱼 17，敌兵 15） */
function stanceH(a, cDrop) {
  const base = a.baseH === undefined ? a.h : a.baseH;
  const pr = proneK(a);
  return base - (cDrop === undefined ? 17 : cDrop) * cqEff(a)
              - PRONE_DROP * (base / 58) * pr;
}

/* 当前受击宽。只给子弹判定用：物理碰撞仍然吃 a.w，
   否则贴着木箱趴下会被「变宽的自己」挤出半个身位。 */
function stanceHitW(a) { return (a.w || 30) + PRONE_ADD_W * proneK(a); }

/* 躺倒角 + 后移量 + 抬起量。
   早先的角度是解出来的：令 cos(ang) = h / visH，绕脚底转过去，头顶正好
   咬住受击盒顶边。数字很漂亮，画出来却不对 —— 那是把人「斜插」在地上：
   头在 24 高处、脚原地不动，像根被钉住的木板，而且脚背转进地里一截。

   现在是真躺平：角度直接给到接近 90°，身高由身体厚度决定（20 出头），
   跟 PRONE_DROP 之后的 h 是一个量级。躺平之后胸口会陷进地面，所以再
   整体抬 lift —— 抬完「胸腹贴地」，只剩鞋尖压进土里一点点，正好当
   陷进泥里看。
   shift 是把躺平后的身体往回挪半个身长，让身体中心压在 a.x 上。 */
const PRONE_FLAT = Math.PI * 0.47;     /* 84.6°：再往上人就躺穿地心了 */
const PRONE_LIFT = 0.135;              /* 抬升 = 身体半厚（按立绘高换算） */

/* 趴下时名牌的抬升量：躺倒后人矮了，但长发 / 尾鳍 / 背包会甩到头顶方向，
   按 a.h（只有 28）算名牌会正好压在身上，所以趴下改用一个固定高度。 */
const PRONE_PLATE = 46;

function pronePose(a, visH, liftK) {
  const pr = proneK(a);
  if (pr <= 0.001) return { pr: 0, ang: 0, shift: 0, lift: 0 };
  const ang = pr * PRONE_FLAT;
  return {
    pr: pr,
    ang: ang,
    shift: -0.46 * visH * Math.sin(ang),
    /* liftK 给「横过来比人厚」的角色用（大肥鱼整个人是一坨，裙摆会陷地） */
    lift: pr * visH * PRONE_LIFT * (liftK === undefined ? 1 : liftK)
  };
}

/* ==================================================================
   趴下时的「头」：身段照旧放倒，头只跟一部分
   ------------------------------------------------------------------
   原来整张图绕脚底转 84.6°。位图是照「站着、脸朝 +x」画的，
   转完这 84.6° 之后，脸的法线也跟着转了 84.6° —— 正好指向地面。
   侧面看过去就是「一头栽进土里」，玩家读到的信息是「他死了」，
   而不是「他趴着架枪」。

   真人趴射不是这样的：胸口贴地、腰塌下去，脖子反向伸展、
   脸朝前咬着准星。所以头这一段要单独拆出来，只跟着身段转 k 倍，
   剩下的角度绕「颈部切口」反着抬回去。

   为什么 k 不取 0（完全直立）：这张立绘的头占了身高的一半，
   完全立起来会变成「身子躺在地上、脑袋直挺挺竖着」的怪比例。
   留一点点跟随，头是斜着抬的 —— 读起来才是「趴着抬头看」，不是「立正」。

   抬头之后颈部切口会露出来（那头长后发是连着头皮画的，
   切口正好横穿发团）。所以再顺着脖子方向压进去 pull 个像素，
   让下巴埋进衣领，切口被上半身的轮廓吃掉。
   ================================================================== */
const PRONE_HEAD = {
  k: 0.30,     /* 头段跟随放倒的比例：0=完全直立、1=跟着身段一起躺平 */
  pull: 3.2    /* 抬头后顺着脖子往下压多少，藏住切口 */
};

/* neckX / neckY = 颈部切口中心在「立绘本地坐标」里的位置（脚底为原点）。
   返回头段该画在哪儿、转多少 —— 位置已经把身段的平移和旋转算进去了。 */
function proneHead(pp, neckX, neckY) {
  if (!pp || pp.pr <= 0.002) return null;
  const c = Math.cos(pp.ang), s = Math.sin(pp.ang);
  return {
    x: pp.shift + neckX * c - neckY * s,
    y: -pp.lift + neckX * s + neckY * c,
    ang: pp.ang * PRONE_HEAD.k
  };
}

/* ==================================================================
   统一动作层（ACT）
   ------------------------------------------------------------------
   以前「会动」这件事是四个人各写一遍的：
     · 玩家    game.js   自己的 poseStep + 一条 crouch 的指数插值
     · 大肥鱼  ai.js     poseStep + 另一条系数不同的 crouch 插值
     · 敌兵    ai.js     两条 lerp，连快慢都和上面两个不一样
     · 步频    anim += |vx|*dt*0.055 抄了四份，系数还不完全相同
   于是同一句「蹲下」，三个人蹲出三种节奏；同一句「跑起来」，腿的摆动
   频率也不一样。玩家说不出这些数字，但一眼能看出「这几个人不像同一个
   游戏里的」—— 这正是这一层要消掉的东西。

   这一层只做三件事，多了不做：
     ① 把「现在在干什么」收敛成一份**归一化姿态**（0~1 的通道）。
        谁画都用同一份：位图立绘、程序化骨架、敌兵、Boss 全吃同一个数，
        所以「批量应用」不是给每个人各调一套，而是**只有一套**；
     ② 步频 / 起伏 / 前倾 由一个地方推进，四套画法自动同步；
     ③ 一次性动作（上膛 / 开火 / 受击 / 阵亡 / 落地 / 二段跳）走
        「有起点、有终点、两头归零」的包络，和循环动作分开处理。

   为什么用「权重」而不是「当前动作 id」：
   跑步切跳跃如果只换 id，就得在一帧之内把腿从「迈步」摆到「收腿」——
   那就是跳变。权重法里两段是同时存在的，用指数曲线交叉：0.12 秒内
   比例从 100/0 换到 0/100，没有一帧是错的。这是唯一能同时满足
   「切换不跳变」和「节奏协调」的做法：过渡期间两套节奏都还在，
   只是比例在换。
   ================================================================== */

/* 动觉三自由度（原在 chars.js，跟着动作层一起搬过来 —— 它现在是全局量） */
const BOB_AMP = 2.4;            /* 跑动起伏幅度（屏幕像素） */
const BREATH_AMP = 0.9;         /* 待机呼吸幅度 */
const ACCEL_REF = 2600;         /* 参考加速度：全速起步的量级 */
const ACCEL_LEAN_MAX = 0.062;   /* 起步/急停倾角上限 ≈3.6°，叠在 whaleLean 的 4.9° 之外 */

/* ------------------------------------------------------------------
   片段表
   ------------------------------------------------------------------
   kind = 这一条动作该怎么「结束」：
     loop —— 循环。权重由速度 / 姿态混合，永不独占，也不会被打断排队。
     once —— 一次性。有固定时长，播完自己归零（上膛 / 开火 / 受击 /
             阵亡 / 落地 / 二段跳）。这类动作不许循环，否则「死」会复活。
     hold —— 按住型。持有者自己决定什么时候松（蹲、趴、救援）。

   fade  = 权重追上目标要多久（秒）。这是「不跳变」的那一个旋钮：
           0.05 是硬切但只有 3 帧，0.20 肉眼读成「过渡」。
           全部走同一条指数曲线（actApproach），所以任何两个动作之间
           的过渡速度都是可预期的。

   cadence = 步频系数。同样一步，蹲行 / 匍匐 / 冲刺的步频不一样 ——
             以前这个差异是靠「各人抄一份 anim +=」调出来的，
             现在它是一条数据，四套画法读同一个值。
   ------------------------------------------------------------------ */
const ACT_CLIPS = {
  /* cadence 是这一层唯一会改「动作长相」的参数。起伏幅度不用给 ——
     它由 (1-cq)(1-pr) 和速度决定，再乘一个 bobMul 就是同一个量算两遍：
     蹲行会矮两次、匍匐会矮两次，最后谁的幅度都对不上。 */
  idle:    { label: '待机',   kind: 'loop', fade: 0.22, cadence: 0.00 },
  walk:    { label: '行走',   kind: 'loop', fade: 0.14, cadence: 0.86 },
  run:     { label: '奔跑',   kind: 'loop', fade: 0.12, cadence: 1.00 },
  sprint:  { label: '冲刺',   kind: 'loop', fade: 0.08, cadence: 1.22 },
  crouchW: { label: '蹲行',   kind: 'loop', fade: 0.16, cadence: 0.74 },
  crawl:   { label: '匍匐',   kind: 'loop', fade: 0.18, cadence: 1.30 },
  jump:    { label: '起跳',   kind: 'loop', fade: 0.09, cadence: 0.00 },
  fall:    { label: '下落',   kind: 'loop', fade: 0.14, cadence: 0.00 },

  crouch:  { label: '蹲下',   kind: 'hold', fade: 0.16 },
  prone:   { label: '趴下',   kind: 'hold', fade: 0.06 },
  revive:  { label: '救援',   kind: 'hold', fade: 0.14 },

  land:    { label: '落地',   kind: 'once', dur: 0.30, fade: 0.05 },
  airjump: { label: '二段跳', kind: 'once', dur: AIRJUMP_FLIP, fade: 0.05 },
  reload:  { label: '上膛',   kind: 'once', fade: 0.10 },
  fire:    { label: '开火',   kind: 'once', dur: 0.16, fade: 0.04 },
  hit:     { label: '受击',   kind: 'once', dur: 0.34, fade: 0.05 },
  death:   { label: '阵亡',   kind: 'once', dur: 0.58, fade: 0.04 }
};

/* 循环动作的权重键（互斥的一组：同时最多两三个非零，加起来归一） */
const ACT_W_KEYS = ['idle', 'walk', 'run', 'sprint', 'crouchW', 'crawl', 'jump', 'fall'];

/* 还没跑过一帧的实体（菜单立绘 / 首帧）读到的空姿态。
   必须是完整的形状，painter 里不写 `P.x || 0` 也不该崩。 */
const ACT_EMPTY = (() => {
  const p = { w: {}, crouch: 0, prone: 0, reload: 0, fire: 0, hit: 0, death: 0,
              revive: 0, land: 0, airjump: 0, magPhase: 0, reloadOn: false,
              bob: 0, lean: 0, cadence: 0, walkK: 0, runK: 0 };
  for (const k of ACT_W_KEYS) p.w[k] = (k === 'idle') ? 1 : 0;
  return p;
})();

/* 指数逼近：半衰期 = fade 秒。dt 无关，帧率变了节奏也不变。
   两端都平滑 —— 不会出现「第一帧跳 30%」那种起步顿一下。 */
function actApproach(cur, tgt, dt, fade) {
  if (!(fade > 0)) return tgt;
  const k = 1 - Math.pow(0.5, dt / fade);
  const nv = cur + (tgt - cur) * k;
  /* 收尾：逼近到 1/500 就直接落位。不是为了让数字好看 ——
     权重永远差 0.001 时，painter 里所有 `if (x > 0.01)` 都会一直成立，
     腿会一直带着一丝摆幅，人站不住。 */
  if (Math.abs(nv - tgt) < 0.002) return tgt;
  return nv;
}

/* 换弹包络（纯函数，不读缓存）。
   玩家 / 大肥鱼用 reloading+reloadDur，敌兵用 reloadT+reload ——
   两套字段名不一样，「还剩多少 / 一共多少」是同一件事。
   包络取 sin(π·u)：中段最深、两头正好归零。用进度本身当强度的话，
   换完弹那一帧枪还停在下沉位置，会「啪」地弹回去。
   AT_RELOAD_OFF 是共享的常量对象：不换弹时每帧返回同一份，不产生垃圾。 */
const ACT_RELOAD_OFF = { on: false, phase: 0, k: 0 };
function actReloadEnvelope(a) {
  let rp = -1;
  if ((a.reloadDur || 0) > 0 && (a.reloading || 0) > 0) rp = 1 - clamp(a.reloading / a.reloadDur, 0, 1);
  else if ((a.reloadT || 0) > 0 && (a.reload || 0) > 0) rp = 1 - clamp(a.reloadT / a.reload, 0, 1);
  if (rp < 0) return ACT_RELOAD_OFF;
  return { on: true, phase: rp, k: Math.sin(Math.PI * rp) };
}

function actInit(a) {
  const w = {};
  for (const k of ACT_W_KEYS) w[k] = (k === 'idle') ? 1 : 0;
  a.act = { w: w, forced: {}, init: true };
  return a.act;
}

/* 主循环：每帧每个角色调一次。
   只读物理量（vx / onGround / crouch / prone / 计时器），
   写三样东西：a.anim（步频相位）、a._pose（本帧姿态）、a._accSm（起步加速度）。
   姿态本身（蹲/趴的 0→1）仍然由各自的控制器用 poseStep 决定 ——
   那是玩法量（影响碰撞盒），不该藏在表现层里偷偷改。 */
function actRun(a, dt) {
  /* 一帧只结算一次：update 里调一次，显示层（motionOf / muzzlePoint）
     可能同一帧再问一次 —— 没有这道闸门，步频相位会被推进两遍，
     160ms 一帧的卡顿里那条腿会走到两倍远。做法和 motionOf 原来那套
     _moNo 一样，只是搬到了动作层这一层上。 */
  const fno = (typeof _frameNo === 'number') ? _frameNo : -1;
  if (fno >= 0 && a._poseNo === fno && a._pose) return a._pose;
  const A = a.act || actInit(a);
  const gnd = a.onGround !== false;
  const sp = Math.abs(a.vx || 0);
  const cq = cqEff(a), pr = proneK(a);
  const dash = (a.dashTime || 0) > 0;
  const P = a._pose || (a._pose = { w: {} });
  for (const k of ACT_W_KEYS) if (P.w[k] === undefined) P.w[k] = 0;

  /* ---- ① 基础移动权重：先决定「目标」，再让所有权重朝它逼近 ---- */
  let target;
  if (!gnd) target = ((a.vy || 0) < -20) ? 'jump' : 'fall';
  else if (pr > 0.55) target = 'crawl';
  else if (dash && sp > 60) target = 'sprint';
  else if (sp > 26) target = (cq > 0.5) ? 'crouchW' : (sp > 200 ? 'run' : 'walk');
  else target = (cq > 0.5) ? 'crouchW' : 'idle';
  /* 趴着不动时 target 也是 crawl：权重给腿的摆幅是 0（vx=0），
     但步频分支还在「匍匐」那一档，起身时相位是接得上的。 */
  for (const k of ACT_W_KEYS) {
    const tgt = (k === target) ? 1 : 0;
    P.w[k] = actApproach(P.w[k], tgt, dt, ACT_CLIPS[k].fade);
  }
  /* 归一化：交叉过渡的正中间两边各 0.5，加起来本来是 1；
     但两段 fade 不同时总和会短暂偏离 1，不归一化会让人忽胖忽瘦 */
  let sum = 0;
  for (const k of ACT_W_KEYS) sum += P.w[k];
  if (sum > 1e-6) for (const k of ACT_W_KEYS) P.w[k] /= sum;
  else { for (const k of ACT_W_KEYS) P.w[k] = 0; P.w.idle = 1; }

  let walkK = 0, runK = 0, cadence = 0;
  for (const k of ACT_W_KEYS) {
    const w = P.w[k], c = ACT_CLIPS[k];
    walkK += w * (k === 'walk' ? 1 : 0);
    runK += w * ((k === 'run' || k === 'sprint') ? 1 : 0);
    cadence += w * (c.cadence || 0);
  }

  /* ---- ② 步频：全项目只有一个地方推进 anim ----
     0.055 是原来玩家 / 敌兵各抄一份的那个系数，保持不变 —— 它调出来
     的步幅是对的，这一层不重调手感，只把「谁在推」收成一个。
     不另存一份相位（a.act.gait）：测试和调试会直接写 a.anim 把腿拨到
     指定相位，另存一份就会出现「拨了没反应、下一帧又被覆盖回去」。 */
  if (gnd && sp > 8 && dt > 0) {
    a.anim = (a.anim || 0) + sp * dt * 0.055 * (cadence || 1);
  } else if (a.anim === undefined) {
    a.anim = 0;
  }

  /* ---- ③ 起伏 ---- */
  let bob = 0;
  if (gnd) {
    const wk = clamp((sp - 26) / 110, 0, 1);
    if (wk > 0.01) {
      /* (1 - 0.15·cq)：蹲行的重心起伏。
         这一项原来是 (1 - cq)，蹲着走时起伏被归零 —— 那是对的，
         前提是「蹲 = 站定不动」，蹲下根本没有移动这回事。
         蹲行放开之后这个前提不成立了：归零就等于整个人贴着地面平移。
         现在蹲行的腿是真在走的（chars.js 的 poseWarpLegs 把立绘里
         前后两条腿分开反向摆），起伏这一下就从「唯一线索」退成了
         「配重」—— 只留 15% 的抑制，还它一个沉一点的鸭子步。
         蹲着**不动**时仍然没有起伏 —— 那条路径走的是呼吸分支，
         它的门槛是 cq < 0.02，蹲下就进不去。 */
      bob = Math.abs(Math.cos(a.anim || 0)) * BOB_AMP * wk * (1 - 0.15 * cq) * (1 - pr);
    } else if (cq < 0.02 && pr < 0.02) {
      /* 呼吸读全局时钟，不读 a._breath —— 每个人各记一份相位的话，
         整队站着时胸腔是各吸各的，反而显得更假 */
      const gt = (typeof game === 'object' && game) ? (game.time || 0) : 0;
      bob = Math.sin(gt * 2.0) * BREATH_AMP * 0.5;
    }
  }

  /* ---- ④ 倾角：加速度（起步/急停）+ 跑动前倾 + 上膛前倾 - 受击后仰 ---- */
  if (dt > 0) {
    const vx = a.vx || 0;
    if (a._vxPrev === undefined) a._vxPrev = vx;
    const raw = clamp((vx - a._vxPrev) / dt, -ACCEL_REF * 1.5, ACCEL_REF * 1.5);
    a._vxPrev = vx;
    a._accSm = lerp(a._accSm || 0, raw, 1 - Math.pow(0.0025, dt));
  }
  let lean = 0;
  if (dt > 0) {
    const facing = Math.cos(a.aim || 0) >= 0 ? 1 : -1;
    lean = clamp((a._accSm || 0) * facing / ACCEL_REF, -1, 1) * ACCEL_LEAN_MAX;
    lean *= (1 - 0.9 * pr) * (1 - 0.45 * cq);
  }

  /* ---- ⑤ 一次性动作：包络 + 进度，两头都落在 0 上 ----
     这一组和上面的循环动作是**分开处理**的：循环永远有权重、可以无限
     叠加；一次性有明确起止，播完就归零，不会自己重来一遍。
     死亡是唯一「播完停在终点」的一条（人死了不会自己站起来）。 */

  /* 上膛：读同一个纯函数，不在姿态缓存里另算一份 ——
     画枪的 gunDip 和画弹匣的 gunMag 会在任意时刻问它，
     如果它们读 P.reload，就得先保证这一帧 actRun 已经跑过，
     否则换弹的第一帧枪不动。纯函数没有这个时序问题。 */
  const rl = actReloadEnvelope(a);
  P.reloadOn = rl.on;
  P.magPhase = rl.phase;
  P.reload = rl.k;

  /* 开火：muzzle 计时器就是后坐的时间窗。0.06 是多数枪的 muzzle 初值。 */
  P.fire = clamp((a.muzzle || 0) / 0.06, 0, 1);

  /* 受击：flash 是受击闪的计时器（友军 0.16、敌兵 0.12），归到 0.14 这条线上 */
  P.hit = clamp((a.flash || 0) / 0.14, 0, 1);

  /* 落地：landSquash 本身就是「落地后 0.2 秒塌一下」，直接当权重用 */
  P.land = clamp(a.landSquash || 0, 0, 1);

  /* 二段跳：暴露进度（0→1），画法各自有各自的旋转中心，但时间轴共用 */
  P.airjump = (a.airJumpT || 0) > 0 ? 1 - clamp(a.airJumpT / AIRJUMP_FLIP, 0, 1) : 0;

  /* 阵亡：一次性，播完停在终点。downedAt 由倒地逻辑写，没有就当作已完成 */
  if (a.dead) P.death = 1;
  else if (a.downed) {
    const td = (a.downedAt === undefined) ? 99 : (game.time - a.downedAt);
    P.death = clamp(td / 0.58, 0, 1);
  } else P.death = 0;

  /* 救援：按住型，由救人那一方写 reviveK（在别人的倒地判定里）。
     读一次就清掉 —— 不清的话救完人他会一直半蹲着，像在给人上坟。 */
  P.revive = actApproach(P.revive || 0, a.reviveK ? 1 : 0, dt, 0.14);
  if (P.revive < 0.002) P.revive = 0;
  a.reviveK = 0;

  /* 上膛 / 受击 的倾角要等上面算完才能加 */
  lean += P.reload * 0.018 - P.hit * 0.05 - P.death * 0.10;

  P.crouch = cq;
  P.prone = pr;
  /* 上膛压肩、救援下蹲，都挂在 bob 这一个通道上。
     为什么不另开一个 dy：painter 里 bob 的含义就是「重心上下动」，
     换弹时肩膀往下压 1.9px、救人时整个人矮 4.5px，说的都是同一件事。
     多开一条通道，四套画法就多四行 `if (P.dy) translate(...)`，
     而且迟早有一家忘了写 —— 这正是这一层要消灭的东西。 */
  P.bob = bob - P.reload * 1.9 - P.revive * 4.5;
  P.lean = lean;
  P.cadence = cadence;
  P.walkK = walkK;
  P.runK = runK;
  a._poseNo = fno;
  return P;
}

/* 本帧姿态。painter 只读这个，不自己算。
   没跑过一帧的（菜单立绘）拿到一份全零的空姿态。 */
function actPose(a) { return a._pose || ACT_EMPTY; }

/* 手动播一条一次性动作（受击 / 阵亡 / 挥手…）。
   走的是同一条主动权重的路：写一个「强制」权重，它在 fade 里升起来，
   dur 之后落回去。已经播着同一条时只刷新时间，不会叠加两层。 */
function actPlay(a, id, dur) {
  const A = a.act || actInit(a);
  const clip = ACT_CLIPS[id];
  if (!clip) return false;
  A.forced[id] = { t: 0, dur: dur || clip.dur || 0.3 };
  return true;
}
function actPlaying(a, id) {
  const A = a.act;
  return !!(A && A.forced[id] && A.forced[id].t < A.forced[id].dur);
}

/* ------------------------------------------------------------------
   阵亡曲线：一条时间轴，四个角色共用
   ------------------------------------------------------------------
   倒地是最容易被写四遍的动作，原本也确实是四份：士兵 / 大肥鱼 /
   主角 / 干员各有一段 if (td < 0.20) … else if (td < 0.55) …
   数字略有出入（大肥鱼慢 40 毫秒、量大 5%），但**结构完全一样**：
     ① 膝盖先软（二次加速，只往前送一点，人还没倒）
     ② 上身歪出去（S 形，这一段是大头，占了全场一半时间）
     ③ 落地余震（衰减正弦，半秒停）
   结构统一、幅度按角色体型给 —— 这才是「统一」该有的粒度。
   把四个人的数字硬掰成一样反而是错的：大肥鱼比士兵重，倒得就该慢一点。

   opt 里的每一个量都是「这个人有多重」的换算，不是随便调的魔法数。
   ------------------------------------------------------------------ */
function actDeathCurve(td, opt) {
  const o = opt || {};
  const t1 = o.t1 === undefined ? 0.20 : o.t1;          /* 软倒段结束 */
  const t2 = o.t2 === undefined ? 0.55 : o.t2;          /* 歪倒段结束 */
  const soft = o.soft === undefined ? 0.16 : o.soft;    /* ① 段末的角 */
  const fold = o.fold === undefined ? 1.30 : o.fold;    /* ② 段补的角 */
  const s1 = o.sink1 === undefined ? 10 : o.sink1;
  const s2 = o.sink2 === undefined ? 2.5 : o.sink2;
  const sEnd = o.sinkEnd === undefined ? 12.5 : o.sinkEnd;
  const tuckEnd = o.tuckEnd === undefined ? 0.55 : o.tuckEnd;
  if (td < t1) {
    const k = td / t1;
    return { ang: soft * k * k, sink: s1 * k * k, tuck: k, done: false };
  }
  if (td < t2) {
    const k = (td - t1) / (t2 - t1);
    const e = k * k * (3 - 2 * k);
    return { ang: soft + fold * e, sink: s1 + s2 * e, tuck: 1 - 0.3 * e, done: false };
  }
  const k = td - t2;
  return {
    ang: soft + fold + Math.sin(k * 15) * Math.exp(-k * 4.6) * 0.075,
    sink: sEnd, tuck: tuckEnd, done: true
  };
}

/* 蹲下也走补间，和扑倒同一族曲线：蹲下去 0.16 秒二次加速（重心往下砸），
   站起来 0.22 秒 S 形（收一下就起）—— 起来比蹲下慢 37%，和趴下那条
   「起身比扑倒慢 50%」的规矩同源。以前这个数是三份指数插值。 */
const CROUCH_DOWN_T = 0.16;
const CROUCH_UP_T = 0.22;

function crouchStep(a, want, dt) {
  const s = poseStep(a, 'crouch', !!want, dt, CROUCH_DOWN_T, CROUCH_UP_T);
  return s;
}

/* ---------- 全局世界对象 ---------- */
const world = {
  w: 3200,
  groundY: 600,
  platforms: [],
  covers: [],      // 沙袋掩体（可挡子弹、可打坏）
  blocks: [],      // 实体障碍：木箱 / 油桶 / 路障 / 集装箱（挡人挡弹）
  props: [],       // 纯装饰物
  pits: [],        // 深渊：地面被炸开的缺口，掉下去直接死
  hazards: [],     // 场景机关：地刺 / 喷火口
  winds: [],       // 上升气流（跳进去能被托到高处）
  theme: null      // 当前关卡主题（buildStage 里设置）
};

const camera = { x: 0, y: 0, shake: 0 };

/* ------------------------------------------------------------------
   画面缩放：世界渲染整体放大，人物与近景细节更清晰
   · 地面永远落在屏幕 H-78 处（构图稳定）
   · 水平方向玩家居中（相机自己负责）
   屏幕 → 世界： wx = sx / Z + camera.x      wy = (sy - CAM_TY) / Z
   ------------------------------------------------------------------ */
const VIEW_ZOOM = 1.22;
const VIEW_W = W / VIEW_ZOOM;     // 可视世界宽度
const VIEW_H = H / VIEW_ZOOM;     // 可视世界高度
const CAM_TY = (H - 78) - world.groundY * VIEW_ZOOM;


/* ---------- 实体容器 ---------- */
let player = null;
let buddy = null;
let enemies = [];
let bullets = [];
let grenades = [];
let pickups = [];
let particles = [];
let texts = [];
let casings = [];
let decals = [];   // 弹孔 / 血迹（贴地痕迹，随时间淡出）
let fires = [];    // 燃烧瓶留下的火焰地带（焦土纵火者专用）
let corpses = [];  // 尸体：倒下的人不会瞬间消失，会先软下来、再躺一会儿

/* ---------- 输入 ---------- */
const keys = Object.create(null);
const input = { mx: W / 2, my: H / 2, firing: false, aiming: false, started: false };
let jumpHeld = false;

const BLOCK_KEYS = ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'KeyR', 'KeyE'];

const JUMP_KEYS = ['Space', 'KeyW', 'ArrowUp'];

addEventListener('keydown', e => {
  if (BLOCK_KEYS.indexOf(e.code) >= 0) e.preventDefault();
  if (!keys[e.code]) {
    if (JUMP_KEYS.indexOf(e.code) >= 0) {
      jumpHeld = true;
      for (const a of [player, buddy]) if (a) a.jumpBuffer = JUMP_BUFFER;
    }
    onKeyPress(e.code);
  }
  keys[e.code] = true;
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (JUMP_KEYS.indexOf(e.code) >= 0) {
    jumpHeld = false;
    /* 松键截断：短按 = 小跳，长按 = 满跳 */
    if (player && player.vy < -420) player.vy *= JUMP_CUT;
  }
});

cvs.addEventListener('mousemove', e => {
  const r = cvs.getBoundingClientRect();
  input.mx = (e.clientX - r.left) * (W / r.width);
  input.my = (e.clientY - r.top) * (H / r.height);
});
cvs.addEventListener('mousedown', e => {
  if (e.button === 0) {
    ensureAudio();
    input.started = true;
    /* 菜单页的鼠标就是回车键：大厅 / 选关 / 武器库 / 干员 / 档案 /
       剧情 / 结算都可以直接点，不用先摸键盘。战斗里左键仍然是开火。 */
    const st = (typeof game !== 'undefined' && game) ? game.state : '';
    if (st === 'title' || st === 'lobby' || st === 'deploy' || st === 'armory' ||
        st === 'operators' || st === 'archive' || st === 'story' ||
        st === 'stageclear' || st === 'gameover') { onKeyPress('Enter'); return; }
    input.firing = true;
  }
  if (e.button === 2) { input.aiming = true; e.preventDefault(); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) input.firing = false;
  if (e.button === 2) input.aiming = false;
});
cvs.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => {
  input.firing = false;
  input.aiming = false;
  jumpHeld = false;
  for (const k in keys) keys[k] = false;
});

/* 世界坐标下的鼠标位置（要考虑画面缩放） */
function mouseWorld() {
  return {
    x: input.mx / VIEW_ZOOM + camera.x,
    y: (input.my - CAM_TY) / VIEW_ZOOM
  };
}

/* ------------------------------------------------------------------
   准星与弹道的换算 —— 准星不是画一个固定大小的圈，
   它画的是「按这把枪的散布，打到这里时子弹可能落在一个多大的范围里」。
   角散布 × 距离 = 线散布，所以同一个圈在远处会自动变大。
   ------------------------------------------------------------------ */

/* 屏幕上的散布半径（像素）：dist 是玩家到准星的世界距离 */
function aimRadiusPx(wp, dist, spreadMul) {
  const ang = Math.max(0, wp.spread || 0) * (spreadMul === undefined ? 1 : spreadMul);
  /* 远处封顶：不然霰弹枪点 900px 外的天，圈会大得遮住半个屏幕 */
  return clamp(Math.tan(ang) * Math.max(0, dist) * VIEW_ZOOM + 5, 5, 150);
}

/* 屏幕上的下坠量（像素）：子弹飞到 dist 处时偏离瞄准线多少。

   不能直接 t = dist / speed —— 有 drag 的枪后半段会明显变慢，飞行时间比
   直线算的长得多，霰弹枪的下坠会被少算一半。所以这里按子弹的真实积分
   方式（先衰减速度、再累加位移）一步步走到 dist，拿到准确的飞行时间。
   偏移只取垂直于瞄准线的那一份重力：朝天打的时候子弹不会「掉」。 */
function aimDropPx(wp, dist, ang) {
  const g0 = wp.grav || 0;
  if (g0 <= 0 || !wp.speed || dist <= 0) return 0;

  const a = ang === undefined ? 0 : ang;
  /* 只有垂直于瞄准线的那一份重力让弹道偏离瞄准线：水平打满，
     朝天打几乎为零（子弹只会飞得慢一点，不会「掉」）。 */
  const g = g0 * Math.abs(Math.cos(a));

  const step = 1 / 240;
  const k = wp.drag > 0 ? Math.pow(1 - wp.drag, step) : 1;

  let s = 0, sp = wp.speed, vy = 0, y = 0;
  let guard = 0;
  while (s < dist && guard++ < 5000) {
    /* 与 updateBullets 完全同一套积分顺序：先走位移、再加重力、最后一起衰减，
       dist 取衰减后的速度 —— 不是「大概算一下」，是同一段代码的复刻。 */
    y += vy * step;
    vy += g * step;
    sp *= k; vy *= k;
    s += Math.hypot(sp, vy) * step;
  }
  return y * VIEW_ZOOM;
}

/* ==================================================================
   音频引擎 A：总线 / 合成元件 / 音效
   ------------------------------------------------------------------
   为什么不是「每个音效直连 destination」：
   交火时同时十几个 voice，峰值振幅会直接叠加，超过 1.0 就是削波 ——
   耳朵听到的是「噼啪爆麦」，不是枪声。所以统一走一条总线：

     sfxBus ┐
            ├→ masterGain(0.55) → DynamicsCompressor(-18dB / 4:1) → 喇叭
     bgmBus ┘

   · masterGain 只留一个：静音、切后台降音量只需要 ramp 一个参数，
     不用挨个去找正在发声的节点（那根本找不全）。
   · compressor 是「自动用手压住峰值」：加了新音效不用重新平衡全局响度，
     密集火力段的总响度也不会随人数线性上涨。threshold -18dB 大约对应
     振幅 0.126，正好在常见枪声峰值附近，ratio 4 把超出的部分压到 1/4。
   · sfx / bgm 分成两条子总线：以后想让 BGM 在爆炸时自动让路（ducking），
     改 bgmBus 一个 gain 就行，不用碰音效代码。
   ================================================================== */

const AUDIO_MASTER = 0.55;   /* 总线默认音量 */
const AUDIO_DUCK   = 0.32;   /* 切到后台时降到 32%，别让玩家切窗口还被吵 */

let actx = null;             /* AudioContext：null = 没有音频能力，全线静默 */
let busReady = false;
let masterGain = null, sfxBus = null, bgmBus = null, noiseBuf = null;
let audioMuted = false;
let audioDucked = false;
let voices = 0;              /* 正在发声的节点数（软上限，防极端情况炸 CPU） */
const VOICE_SOFT_CAP = 40;

/* 初始化：任何一步失败都退化成「没有声音」，绝不让音频把游戏带崩。
   Node + vm 里没有 window.AudioContext，这里直接 return，后面所有
   sfx* 都会在第一行 return，不抛异常。 */
function ensureAudio() {
  if (busReady) { resumeAudio(); return; }
  try {
    if (!actx) {
      const AC = (typeof window !== 'undefined') &&
                 (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      actx = new AC();
    }
    if (!busReady) buildAudioBus();
    resumeAudio();
    audioKick();
  } catch (e) {
    actx = null;
    busReady = false;
  }
}

function resumeAudio() {
  try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {}
}

function buildAudioBus() {
  masterGain = actx.createGain();
  masterGain.gain.value = masterTarget();

  /* 压缩器：阈值 / 比率按需求固定，attack 给 4ms 让枪声的瞬态先过去，
     release 180ms 保证连发时不会「一压一放」地抽气。 */
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;

  sfxBus = actx.createGain(); sfxBus.gain.value = 1;
  bgmBus = actx.createGain(); bgmBus.gain.value = 1;

  sfxBus.connect(masterGain);
  bgmBus.connect(masterGain);
  masterGain.connect(comp);
  comp.connect(actx.destination);

  noiseBuf = makeNoiseBuffer(1.0);
  busReady = true;
  initMusicLayers();
}

/* 预生成 1 秒白噪声，所有噪声类音色都从这里「随机取片段」——
   现场 createBuffer + 填 random 太贵（每次几百微秒），连发时就是卡顿源。 */
function makeNoiseBuffer(sec) {
  const n = Math.max(1, Math.floor(actx.sampleRate * sec));
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function masterTarget() {
  if (audioMuted) return 0;
  return AUDIO_MASTER * (audioDucked ? AUDIO_DUCK : 1);
}

/* 静音 / 切后台：0.15s 线性滑过去。硬切会有「啪」的直流跳变，
   喇叭越大越明显，而且听起来像 bug 不像静音。 */
function setMasterLevel(v) {
  if (!busReady || !masterGain) return;
  const now = actx.currentTime;
  const g = masterGain.gain;
  try {
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(v, now + 0.15);
  } catch (e) {}
}

/* 页面失焦：玩家在看别处，没必要全音量轰炸；回来立刻恢复。 */
try {
  if (typeof addEventListener === 'function') {
    addEventListener('blur', () => { audioDucked = true; setMasterLevel(masterTarget()); });
    addEventListener('focus', () => { audioDucked = false; setMasterLevel(masterTarget()); });
  }
} catch (e) {}

function canVoice() { return voices < VOICE_SOFT_CAP; }

/* 节点回收：stop() 之后必须 disconnect，否则一条长会话里
   几十万个 gain 节点会把 AudioContext 的图撑爆（Chrome 上表现为逐渐卡顿）。 */
function aRelease(nodes) {
  voices = Math.max(0, voices - 1);
  for (let i = 0; i < nodes.length; i++) {
    try { nodes[i].disconnect(); } catch (e) {}
  }
}

/* ---- 合成元件 1：单音 ----
   type / 起频 / 终频 / 起点 / 时长 / 音量 / 目的地。
   起音给 2~8ms 的小斜坡：从 0 直接跳到 0.2 会产生一个宽频「咔」，
   听起来像点击而不是音头。 */
function aTone(type, f0, f1, t0, dur, vol, dest) {
  if (!busReady || !canVoice()) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), t0);
  if (f1 && Math.abs(f1 - f0) > 0.5) {
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  }
  const att = Math.min(0.008, dur * 0.25);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest || sfxBus);
  voices++;
  o.onended = () => aRelease([o, g]);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/* ---- 合成元件 2：噪声 burst ----
   offset 随机取片段是关键：同一段白噪声重复播 20 次，耳朵会听出「同一个样本」，
   连发就像复读机；每次换起点，频率成分就换了。 */
function aNoise(t0, dur, vol, filterType, f0, f1, q, rate, dest) {
  if (!busReady || !noiseBuf || !canVoice()) return;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = clamp(rate || 1, 0.5, 2);

  const flt = actx.createBiquadFilter();
  flt.type = filterType || 'lowpass';
  flt.frequency.setValueAtTime(Math.max(40, f0), t0);
  if (f1 && Math.abs(f1 - f0) > 1) {
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  }
  flt.Q.value = q === undefined ? 0.8 : q;

  const g = actx.createGain();
  /* 噪声本身就是瞬态，起音不淡入（淡入会把「炸」削成「噗」） */
  g.gain.setValueAtTime(Math.max(0.0002, vol), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(flt); flt.connect(g); g.connect(dest || sfxBus);
  voices++;
  src.onended = () => aRelease([src, flt, g]);
  src.start(t0, Math.random() * Math.max(0, noiseBuf.duration - 0.15));
  src.stop(t0 + dur + 0.02);
}

/* ---- 兼容层：beep ----
   另外 5 个文件里还有几十处 beep(...) 调用（UI 提示音、脚步细节），
   签名一个都不能变。内部改成走总线 + 轻微随机音高，起码不再刺耳。 */
function beep(freq, dur, type, gain, endFreq) {
  if (!busReady) return;
  const p = rand(0.97, 1.03);
  aTone(type || 'square', freq * p, endFreq ? endFreq * p : 0,
        actx.currentTime, dur, gain || 0.045);
}

/* ---- 枪声 ----
   结构 = 噪声 burst（瞬态）+ lowpass 扫频（枪口的「唰」）+ 低频 sine thump
   （胸口那一记）。三样各有各的频段，缺一样就不像枪：
   只有噪声像放气，只有扫频像电子音，只有 thump 像敲桌子。 */
function gunShot(f0, f1, nDur, thumpHz, vol, tail) {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);          /* ±5% 随机音高：连发不是复读机 */
  aNoise(t, nDur, vol, 'lowpass', f0 * p, f1 * p, 0.9, p);
  /* 低频冲击：从 1.6 倍频滑到 0.62 倍频，衰减 0.06~0.07s，
     给的是「推力」而不是「音高」，所以听不出调。 */
  aTone('sine', thumpHz * 1.6 * p, thumpHz * 0.62 * p, t, 0.07, vol * 0.95);
  if (tail) {
    /* 尾巴：衰减更慢、更闷的一段低通噪声，模拟墙面的第一反射 */
    aNoise(t + nDur * 0.55, tail, vol * 0.26, 'lowpass', 700 * p, 160, 0.6, 0.72);
  }
}

function sfxShot()    { gunShot(2200, 900, 0.060, 130, 0.22, 0); }
function sfxShotBig() { gunShot(1400, 300, 0.140, 70, 0.32, 0.22); }

/* 命中：短促高频 ping + 一点点噪声。0.04s 的高频不会盖住枪声的尾巴，
   是「确认打中了」而不是「又响了一声」。 */
function sfxHit() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);
  aTone('triangle', 1200 * p, 600 * p, t, 0.04, 0.12);
  aNoise(t, 0.03, 0.05, 'highpass', 3000 * p, 2200, 0.7, p);
}

/* 玩家受伤：低频闷响 + 一声压抑的噪声。要「疼」不要「响」，
   所以能量全压在 1.2kHz 以下，不跟枪声抢耳朵。 */
function sfxHurt() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);
  aNoise(t, 0.20, 0.16, 'lowpass', 1100 * p, 180, 0.7, p);
  aTone('sine', 170 * p, 65 * p, t, 0.20, 0.15);
}

/* 爆炸：噪声 800→80Hz 走 0.5 秒，加一条 45Hz 的 sine 下扫。
   45Hz 是「胸腔被推一下」的频段 —— 它在小音箱上几乎听不见，
   但在耳机/低音炮上会让人下意识缩一下肩。 */
function sfxBoom() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);
  aNoise(t, 0.50, 0.40, 'lowpass', 800 * p, 80, 0.9, p);
  aTone('sine', 45 * p, 26, t, 0.55, 0.38);
  /* 中频的「碎屑」：没有这一层，爆炸听起来像远处的闷雷 */
  aNoise(t + 0.02, 0.16, 0.10, 'bandpass', 1600 * p, 600, 1.2, p);
}

function sfxPick() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  aTone('sine', 880, 1320, t, 0.09, 0.10);
  aTone('triangle', 1320, 1760, t + 0.03, 0.07, 0.045);
}

/* 换弹：两声金属咔哒（带通噪声），间隔 90ms —— 这是「弹匣落位」的节奏，
   玩家不用看 HUD 也能听出还有多久能开枪。 */
function sfxReload() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);
  aNoise(t, 0.035, 0.09, 'bandpass', 2400 * p, 1800, 1.6, p);
  aNoise(t + 0.09, 0.045, 0.07, 'bandpass', 1600 * p, 1100, 1.4, p);
  aTone('square', 420 * p, 260, t, 0.05, 0.05);
}

/* 复活 / 增益：两级上行，比单条滑音更有「东西回来了」的指向性 */
function sfxRevive() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  aTone('sine', 520, 780, t, 0.10, 0.11);
  aTone('sine', 780, 1040, t + 0.06, 0.12, 0.09);
}

function sfxJump() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);
  aTone('sine', 240 * p, 420 * p, t, 0.07, 0.06);
  aNoise(t, 0.04, 0.022, 'highpass', 1400, 900, 0.6, p);
}

function sfxLand() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const p = rand(0.95, 1.05);
  aTone('sine', 120 * p, 70 * p, t, 0.08, 0.09);
  aNoise(t, 0.06, 0.05, 'lowpass', 400, 120, 0.7, p);
}

/* 震地蓄力：低频上滑的闷响，是「快跑」的唯一听觉提示。
   和开枪的高频完全错开，混战时也能听清。 */
function sfxCharge() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  aTone('sawtooth', 70, 190, t, 0.50, 0.10);
  aTone('sine', 40, 58, t, 0.50, 0.12);
  aNoise(t, 0.48, 0.05, 'lowpass', 200, 700, 0.8, 1);
}

/* 防空警报：两声短 + 一声长，BOSS 入场专用。
   不用采样音，纯合成就能压过枪声，玩家一听就知道「大块头来了」。
   三声全部用音频时钟排期（不用 setTimeout）—— 切后台不会漂。 */
function sfxAlarm() {
  if (!busReady) return;
  const t = actx.currentTime + 0.001;
  const blast = (at, dur) => {
    aTone('sawtooth', 540, 360, at, dur, 0.10);
    aTone('sawtooth', 543, 363, at, dur, 0.06);   /* 微失谐：双音更有「喇叭」味 */
    aNoise(at, dur * 0.7, 0.03, 'bandpass', 900, 620, 1.4, 1);
  };
  blast(t, 0.20);
  blast(t + 0.25, 0.20);
  blast(t + 0.50, 0.34);
}

/* ---------- 粒子 / 飘字 / 痕迹 ---------- */
function spawnParticles(x, y, n, color, speed, life, size, grav) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(speed * 0.25, speed);
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - speed * 0.25,
      life: rand(life * 0.5, life),
      max: life,
      color,
      size: rand(size * 0.5, size),
      grav: grav === undefined ? 900 : grav
    });
  }
}
/* 飘字：size 用于爆头这类需要「一眼看出来」的数字，默认与原来完全一致 */
function spawnText(x, y, str, color, opts) {
  const o = opts || {};
  texts.push({
    x, y, str, color: color || '#fff',
    life: o.life || 0.9,
    vy: o.vy === undefined ? -46 : o.vy,
    size: o.size || 1
  });
}
function addShake(v) { camera.shake = Math.min(22, camera.shake + v); }

/* 弹孔 / 血迹：贴在地面或平台表面的装饰痕迹 */
function addDecal(x, y, kind) {
  if (decals.length > 90) decals.shift();
  decals.push({ x, y, kind, life: kind === 'hole' ? 14 : 9, max: kind === 'hole' ? 14 : 9, r: kind === 'hole' ? rand(2, 3.4) : rand(5, 11) });
}

/* ------------------------------------------------------------------
   通用物理（单向平台，脚底坐标 e.y = 站立面高度）
   ------------------------------------------------------------------ */
function moveEntity(e, dt) {
  const prevBottom = e.y;
  const prevX = e.x;
  const wasOnGround = e.onGround;

  if (e.dropTimer > 0) e.dropTimer -= dt;
  if (e.jumpBuffer > 0) e.jumpBuffer -= dt;
  if (e.landSquash > 0) e.landSquash = Math.max(0, e.landSquash - dt * 5);

  e.vy += GRAV * dt;
  if (e.vy > VY_MAX) e.vy = VY_MAX;
  /* 挂伞缓降：下降速度锁死，落地自动收伞 */
  if (e.chute > 0 && e.vy > 92) e.vy = 92;

  /* 上升气流：托举力大于重力，在气流里只要离开地面就会被往上顶。
     要求「已经在空中」——站在风口的铁栅上不会被莫名其妙吸起来，
     但往里跳一下就飞了，跟用户说的「在上面跳可以飞到高处」一致。 */
  if ((e.kind === 'player' || e.kind === 'buddy') && !e.onGround) {
    const wind = windAt(e.x, e.y - e.h * 0.5);
    if (wind) {
      /* 只在「上升速度还没到上限」时补推力：
         否则会把刚起跳的 -1000 直接压回 -560，风里跳反而比外面矮。 */
      if (e.vy > -WIND_RISE_MAX) {
        e.vy -= WIND_ACCEL * dt;
        if (e.vy < -WIND_RISE_MAX) e.vy = -WIND_RISE_MAX;
      }
      e.inWind = true;
    } else {
      e.inWind = false;
    }
  } else if (e.inWind) {
    e.inWind = false;
  }

  e.x += e.vx * dt;
  const half = e.w / 2;

  /* 深渊崖边：AI 不会自己走下去（玩家不设限，踩空是他自己的事）。
     这里只做「脚下一半悬空就顶回去」，跨过缺口由 AI 层的起跳逻辑负责。 */
  e.pitEdge = 0;
  if (e.avoidPits && wasOnGround && !e.plat) {
    for (let i = 0; i < world.pits.length; i++) {
      const pit = world.pits[i];
      if (prevX + half <= pit.x + 1 && e.x + half > pit.x) {
        e.x = pit.x - half - 0.5;
        e.pitEdge = 1;
      } else if (prevX - half >= pit.x + pit.w - 1 && e.x - half < pit.x + pit.w) {
        e.x = pit.x + pit.w + half + 0.5;
        e.pitEdge = -1;
      }
    }
  }

  /* 实体障碍（木箱 / 油桶 / 路障）：脚底低于顶面时挡人，想过必须跳 */
  e.blocked = false;
  for (let i = 0; i < world.blocks.length; i++) {
    const b = world.blocks[i];
    if (b.hp <= 0) continue;
    if (e.y <= b.y + 2) continue;                 /* 站在顶面或更高处，不挡 */
    if (e.x + half <= b.x || e.x - half >= b.x + b.w) continue;
    if (prevX + half <= b.x + 1) e.x = b.x - half - 0.5;
    else if (prevX - half >= b.x + b.w - 1) e.x = b.x + b.w + half + 0.5;
    else {
      const toL = e.x - b.x, toR = b.x + b.w - e.x;
      e.x = toL < toR ? b.x - half - 0.5 : b.x + b.w + half + 0.5;
    }
    e.blocked = true;
  }

  e.x = clamp(e.x, half + 6, world.w - half - 6);

  const fallVy = e.vy;
  e.y += e.vy * dt;
  e.onGround = false;
  e.plat = null;

  /* 单向平台：只能从上方落到平台上，从下方可穿过 */
  if (e.vy >= 0 && !(e.dropTimer > 0)) {
    for (let i = 0; i < world.platforms.length; i++) {
      const p = world.platforms[i];
      if (p.ground) continue;
      if (e.x + half > p.x && e.x - half < p.x + p.w) {
        if (prevBottom <= p.y + 2 && e.y >= p.y) {
          e.y = p.y;
          e.vy = 0;
          e.onGround = true;
          e.plat = p;
        }
      }
    }
  }

  /* 障碍物顶面也能站（木箱上、集装箱顶） */
  if (e.vy >= 0 && !(e.dropTimer > 0) && !e.onGround) {
    for (let i = 0; i < world.blocks.length; i++) {
      const b = world.blocks[i];
      if (b.hp <= 0) continue;
      if (e.x + half > b.x + 1 && e.x - half < b.x + b.w - 1) {
        if (prevBottom <= b.y + 2 && e.y >= b.y) {
          e.y = b.y;
          e.vy = 0;
          e.onGround = true;
          e.plat = b;
        }
      }
    }
  }

  /* 地面：深渊那一段没有兜底，踩空就一直往下掉 */
  if (e.y >= world.groundY && groundAt(e.x)) {
    e.y = world.groundY;
    e.vy = 0;
    e.onGround = true;
    e.plat = null;
  }

  /* 落地收伞 */
  if (e.chute > 0 && e.onGround) e.chute = 0;
  if (e.chute !== undefined) {
    e.chuteVis = lerp(e.chuteVis || 0, e.chute > 0 ? 1 : 0, 1 - Math.pow(0.0004, dt));
  }

  /* 站到实地就把二段跳还给他（平台、地面、箱子顶都算） */
  if (e.onGround) e.airJumps = e.maxAirJumps === undefined ? MAX_AIR_JUMPS : e.maxAirJumps;

  /* 掉进深渊：标记一下，由 game.js 统一结算（那里才有伤害与结算逻辑） */
  if (!e.fell && e.y > world.groundY + FALL_DEPTH) e.fell = true;

  /* 落地反馈：下坠越快，压得越低 */
  if (e.onGround && !wasOnGround && fallVy > 280) {
    e.landSquash = clamp(fallVy / 1300, 0.25, 1);
    spawnParticles(e.x, e.y - 2, 5, '#9c8f78', 130, 0.3, 3, 700);
    if (fallVy > 700) {
      sfxLand();
      addShake(2);
    }
  }
}

/* 起跳：统一的入口，保证玩家与 AI 行为一致 */
function doJump(e) {
  e.vy = -JUMP_V;
  e.onGround = false;
  e.jumpBuffer = 0;
  sfxJump();
  spawnParticles(e.x, e.y - 2, 4, '#b8a98c', 110, 0.26, 3, 600);
}

/* 二段跳：空中再蹬一脚。用一格气浪环 + 短促的高频音，提醒「这一格用掉了」。
   空翻动画靠 airJumpT 驱动：起跳瞬间置满，渲染层据此团身转体。 */
function doAirJump(e) {
  if (!(e.airJumps > 0)) return false;
  e.airJumps--;
  e.vy = -JUMP_V2;
  e.jumpBuffer = 0;
  e.onGround = false;
  e.airJumpT = AIRJUMP_FLIP;
  e.flipDir = Math.cos(e.aim) >= 0 ? 1 : -1;
  particles.push({
    x: e.x, y: e.y - e.h * 0.55, vx: 0, vy: 0,
    life: 0.26, max: 0.26, color: 'rgba(206,232,255,0.9)', size: 16, grav: 0, ring: true
  });
  spawnParticles(e.x, e.y - e.h * 0.45, 6, '#bcd8f0', 160, 0.3, 3, 520);
  beep(430, 0.07, 'sine', 0.022, 760);
  return true;
}

/* x 处有没有实地（深渊处没有） */
function groundAt(x) {
  for (let i = 0; i < world.pits.length; i++) {
    const p = world.pits[i];
    if (x > p.x + 2 && x < p.x + p.w - 2) return false;
  }
  return true;
}

/* (x, y) 是否在上升气流的柱子里（y 用身体中段） */
function windAt(x, y) {
  for (let i = 0; i < world.winds.length; i++) {
    const wd = world.winds[i];
    if (x > wd.x && x < wd.x + wd.w && y > wd.top && y < wd.y + 6) return wd;
  }
  return null;
}

/* 指定 x、y 下方最近的可站立面（平台或地面）。
   深渊正上方返回一个很深的假底，让手雷 / 补给掉进洞里而不是浮在半空。 */
function surfaceBelow(x, y) {
  let best = groundAt(x) ? world.groundY : world.groundY + FALL_DEPTH + 60;
  for (const p of world.platforms) {
    if (p.ground) continue;
    if (x > p.x && x < p.x + p.w && p.y >= y - 6 && p.y < best) best = p.y;
  }
  return best;
}

/* 圆点是否命中脚底坐标实体。
   横向吃 stanceHitW（趴下会变宽），纵向吃 e.h —— 所以「趴下能不能躲子弹」
   只由姿态更新那一处决定，这里不需要知道任何姿势细节。 */
function pointHitEntity(bx, by, r, e) {
  if (e.dead || e.downed) return false;
  const half = (e.hitW || e.w) / 2 + r;
  return bx > e.x - half && bx < e.x + half && by > e.y - e.h - r && by < e.y + r;
}

/* ==================================================================
   音频引擎 B：程序化 BGM（没有音符文件、没有采样）
   ------------------------------------------------------------------
   核心是一个「前瞻调度器」：每帧只把未来 0.15 秒内该响的音符排进
   WebAudio 的采样时钟，排完就不再管。为什么不用 setInterval：
     · 定时器分辨率只有几毫秒并且会被主线程拖慢，间隔越短漂得越明显，
       一首 40 秒的循环听两遍就会「打摆」；
     · 切后台浏览器把定时器压到 1 次/秒，回来时是一串补发的音；
     · 而 AudioContext.currentTime 是在音频线程里走的，排进去的时间点
       精确到采样 —— 主线程再卡，出来的节奏也不会抖。
   前瞻取 0.15s：比一帧（16ms）大一个数量级，掉两帧也不会漏音；
   但又小于切后台的最小间隔，回来时最多只多响 0.15 秒的旧音符。

   和声：A 小调 Am - F - C - G，每和弦 4 小节（40 秒一轮），
   四和弦进行是「不结尾」的，循环接缝处没有终止感 —— 这是它不露痕迹的原因。
   分层按 intensity 叠加，音量全写在音符包络里（各层 gain 只做 0/1 门控），
   这样调平衡只改一个数字，不会出现「层一加满就整体变响」。
   ================================================================== */

const BGM_LOOKAHEAD = 0.15;          /* 前瞻窗口（秒） */

const BGM_BPM = { menu: 78, combat: 96, boss: 112, result: 70, off: 96 };

/* 四和弦：根音（八度 2）+ 三和弦（八度 3/4） */
const BGM_ROOT = [110.00, 87.31, 130.81, 98.00];      /* A2  F2  C3  G2  */
const BGM_PAD  = [
  [220.00, 261.63, 329.63],   /* Am: A C E */
  [174.61, 220.00, 261.63],   /* F : F A C */
  [261.63, 329.63, 392.00],   /* C : C E G */
  [196.00, 246.94, 293.66]    /* G : G B D */
];
/* BOSS：同一个根音换减和弦，颜色立刻变脏 */
const BGM_DIM = [
  [220.00, 261.63, 311.13],   /* Am dim   */
  [174.61, 207.65, 246.94],   /* F  dim   */
  [261.63, 311.13, 369.99],   /* C  dim   */
  [196.00, 233.08, 277.18]    /* G  dim   */
];

const MUS = {
  mode: 'off',
  next: 0,        /* 下一个 16 分音符的绝对时间（AudioContext 时钟） */
  step: 0,        /* 全局 16 分音符计数 */
  bar: 0,
  intensity: 0,   /* 内部平滑后的值 */
  target: 0,      /* 外部传进来的目标值 */
  victory: false, /* result 的「胜利动机」只播一次 */
  rumbleAt: 0,
  layers: null,
  /* 层门控的目标值 / 上一次目标 / 方向参考。
     门控看「目标」而不是看 gain.value —— 不同浏览器对
     AudioParam.value 是否回读自动化值的实现并不一致，拿它当开关
     有把 BGM 整条静音掉的风险。 */
  gate: [0, 0, 0, 0],
  lastTgt: [0, 0, 0, 0]
};

/* 四条层的门控 gain + 固定滤波器。滤波器做成常驻节点而不是每个音符
   建一个 —— 一个音符建一个 biquad 的话，密集段每秒几十次分配，GC 会抖。 */
function initMusicLayers() {
  if (!busReady || MUS.layers) return;

  const bass = actx.createGain(); bass.gain.value = 0;
  const bassF = actx.createBiquadFilter();
  bassF.type = 'lowpass'; bassF.frequency.value = 400; bassF.Q.value = 0.9;
  bass.connect(bassF); bassF.connect(bgmBus);

  const pad = actx.createGain(); pad.gain.value = 0;
  pad.connect(bgmBus);

  const hat = actx.createGain(); hat.gain.value = 0;
  const hatF = actx.createBiquadFilter();
  hatF.type = 'highpass'; hatF.frequency.value = 6500; hatF.Q.value = 0.7;
  hat.connect(hatF); hatF.connect(bgmBus);

  const arp = actx.createGain(); arp.gain.value = 0;
  const arpF = actx.createBiquadFilter();
  arpF.type = 'lowpass'; arpF.frequency.value = 2400; arpF.Q.value = 1.0;
  arp.connect(arpF); arpF.connect(bgmBus);

  MUS.layers = { bass, pad, hat, arp };
}

/* 每层要多少（0..1 门控）：模式 × 强度 */
function layerTargets() {
  const m = MUS.mode, iv = MUS.intensity;
  const mul = m === 'menu' ? 0.7 : 1;   /* 菜单整体降 30%：玩家在看字，不需要催 */
  let b = 0, p = 0, h = 0, a = 0;
  if (m === 'menu') {
    b = 1; p = 1;
  } else if (m === 'combat') {
    b = 1;
    p = iv > 0.25 ? 1 : 0;
    h = iv > 0.5 ? 1 : 0;
    a = iv > 0.75 ? 1 : 0;
  } else if (m === 'boss') {
    /* BOSS 不靠强度才「有东西」，但也不一次全开：留一点上推空间 */
    b = 1;
    p = iv > 0.25 ? 1 : 0.45;
    h = iv > 0.40 ? 1 : 0.45;
    a = iv > 0.50 ? 1 : 0.50;
  } else if (m === 'result') {
    p = 1;
  }
  return [b * mul, p * mul, h * mul, a * mul];
}

/* 层间过渡：升 0.6s / 降 0.4s。
   用 setTargetAtTime（指数逼近）而不是「排一个 linearRamp」——
   每帧都可能改目标，排 ramp 会互相覆盖、出现折线；指数逼近天然连续，
   而且不会因为目标反复变化就产生阶跃。τ 取 0.13 / 0.09，约 3τ≈95%。 */
function applyLayers(now) {
  if (!busReady || !MUS.layers) return;
  const t = layerTargets();
  const L = MUS.layers;
  const nodes = [L.bass, L.pad, L.hat, L.arp];
  for (let i = 0; i < 4; i++) {
    MUS.gate[i] = t[i];
    if (Math.abs(t[i] - MUS.lastTgt[i]) < 0.004) continue;  /* 目标没变就别再写自动化 */
    const up = t[i] > MUS.lastTgt[i];
    MUS.lastTgt[i] = t[i];
    try { nodes[i].gain.setTargetAtTime(t[i], now, up ? 0.13 : 0.09); } catch (e) {}
  }
}

/* 铺底和弦：三个略微失谐的三角波。
   失谐（±8 音分）制造缓慢拍频，听感是「一片」，不是「三个音」；
   完全对准的话反而像廉价的电子琴和弦。 */
function padChord(t0, dur, freqs, vol, dest, bright) {
  if (!busReady) return;
  for (let i = 0; i < freqs.length; i++) {
    if (!canVoice()) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = bright ? 'sawtooth' : 'triangle';
    o.frequency.setValueAtTime(freqs[i], t0);
    o.detune.setValueAtTime(rand(-8, 8), t0);
    const att = Math.min(0.8, dur * 0.3);
    const rel = Math.min(0.5, dur * 0.25);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + att);                  /* attack 0.8s */
    g.gain.setValueAtTime(vol, t0 + Math.max(att, dur - rel));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || bgmBus);
    voices++;
    o.onended = () => aRelease([o, g]);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
}

/* 上行三音：结算页的「胜利动机」，只播一次 */
function victoryMotif(t0) {
  const ns = [523.25, 659.25, 783.99];   /* C5 E5 G5 */
  for (let i = 0; i < 3; i++) {
    aTone('triangle', ns[i], ns[i], t0 + i * 0.22, 0.34, 0.10, bgmBus);
    aTone('sine', ns[i] * 2, ns[i] * 2, t0 + i * 0.22, 0.24, 0.038, bgmBus);
  }
}

/* 远景隆隆：极轻的低频噪声，只在高强度战斗里偶尔出现。
   它的作用是「战场比屏幕大」，不能有音头，否则会被当成一次爆炸。 */
function bgmRumble(t0) {
  if (!busReady) return;
  aNoise(t0, 1.2, 0.030, 'lowpass', 140, 70, 0.6, rand(0.6, 0.9), bgmBus);
  aTone('sine', rand(28, 36), 24, t0, 1.0, 0.045, bgmBus);
}

/* 排一个 16 分音符格子里该发生的事。
   注意：门控在层 gain 上，这里照样排 —— 门关着的时候音符静音通过，
   这样 intensity 刚跨过阈值时和弦已经在响，不会等下一个和弦才进来。 */
function scheduleStep(t, step, bar, mode) {
  const L = MUS.layers;
  const inBar = step % 16;
  const ch = Math.floor(bar / 4) % 4;       /* 每和弦 4 小节 */
  const root = BGM_ROOT[ch];

  /* 层 1：bass 脉冲。战斗/菜单是四分音符（96bpm → 0.625s，接近「半秒一下」），
     BOSS 改十六分音符，密度直接翻四倍，压迫感是这么来的。 */
  if (mode === 'boss' || inBar % 4 === 0) {
    if (MUS.gate[0] > 0.02) {
      const f = root * rand(0.992, 1.008);
      const dur = mode === 'boss' ? 0.09 : Math.min(0.24, 60 / BGM_BPM[mode]);
      aTone('sawtooth', f, f * 0.995, t, dur, 0.10, L.bass);
    }
  }

  /* 层 2：pad，只在和弦头补一次，撑满 4 小节 */
  if (inBar === 0 && bar % 4 === 0) {
    const dur = 64 * (60 / BGM_BPM[mode] / 4);      /* 4 小节 × 16 个 16 分 */
    const freqs = (mode === 'boss') ? BGM_DIM[ch] : BGM_PAD[ch];
    padChord(t, dur + 0.4, freqs, 0.017, L.pad);
    if (mode === 'boss') {
      /* 小二度：根音升半音，和 pad 长期打架。不去解决它 ——
         一直挂着才是「不对劲」，解决了就变成「换个和弦」了。 */
      padChord(t, dur + 0.4, [root * Math.pow(2, 1 / 12)], 0.015, L.pad, true);
    }
  }

  /* 层 3：hat，八分音符 */
  if (inBar % 2 === 0 && MUS.gate[2] > 0.02) {
    aNoise(t, 0.03, 0.03, 'highpass', 7200, 5200, 0.7, rand(0.95, 1.08), L.hat);
  }

  /* 层 4：arp，八分音符，后半小节翻高八度找一点起伏 */
  if (inBar % 2 === 0 && MUS.gate[3] > 0.02) {
    const tri = (mode === 'boss') ? BGM_DIM[ch] : BGM_PAD[ch];
    const idx = (inBar >> 1) % 3;
    const oct = inBar >= 8 ? 4 : 2;
    const f = tri[idx] * oct * rand(0.997, 1.003);
    aTone('square', f, f * 0.99, t, 0.11, 0.04, L.arp);
  }

  /* 结算页：进模式后第一格播一次胜利动机 */
  if (mode === 'result' && !MUS.victory && step === 0) {
    MUS.victory = true;
    victoryMotif(t + 0.05);
  }
}

/* ---- 对外的四个接口 ---- */

/* 切模式。幂等：game.js 每次进战斗都会调 audioMode('combat')，
   每次都重置节拍的话，BGM 会被反复打回第一拍。 */
function audioMode(m) {
  const ok = (m === 'menu' || m === 'combat' || m === 'boss' ||
              m === 'result' || m === 'off') ? m : 'off';
  if (MUS.mode === ok) return ok;
  MUS.mode = ok;
  MUS.victory = false;
  MUS.step = 0;
  MUS.bar = 0;
  MUS.next = 0;                 /* 由下一次 audioTick 重新对齐到「现在」 */
  MUS.rumbleAt = 0;
  if (busReady) {
    /* 立刻把层增益推向新目标：即使这一帧 audioTick 还没来，
       旧层也已经开始淡出，不会「啪」地停在一个残响上。 */
    applyLayers(actx.currentTime);
    audioKick();
  }
  return ok;
}

/* 强度：只记目标值，实际跟随在 audioTick 里 lerp。
   外部（game.js 按存活敌人数）每秒调几十次，硬跳会听到音量阶梯。 */
function audioIntensity(v) {
  MUS.target = clamp(v || 0, 0, 1);
}

/* 每帧一次的空转成本很低（几个 if + 可能零个音符），
   所以没有音频环境时直接返回，不给主循环添任何负担。 */
function audioTick(dt) {
  if (!busReady) return;
  if (!(dt > 0)) dt = 1 / 60;
  if (dt > 0.25) dt = 0.25;              /* 切后台回来的巨大 dt 不做一次拉满 */

  const now = actx.currentTime;

  /* 强度跟随：τ≈0.45s。开放窗口拉得太快会「一层一层跳上来」，
     太慢又跟不上波次节奏。 */
  MUS.intensity += (MUS.target - MUS.intensity) * (1 - Math.pow(0.1, dt));

  /* 自愈：万一某个节点的 onended 没触发（个别浏览器的老 bug），
     计数器会把所有声音锁死。超过软上限两倍就归零重来。 */
  if (voices > VOICE_SOFT_CAP * 2) voices = 0;

  applyLayers(now);

  if (MUS.mode === 'off' || !MUS.layers) { MUS.next = 0; return; }

  if (!MUS.next) MUS.next = now + 0.05;
  /* 排期落后太多（切后台 / 长卡顿）：不补历史音符，直接对齐到现在。
     补发的话回前台会听到「一串憋着的音」一起炸出来。 */
  if (MUS.next < now - 0.35) MUS.next = now + 0.02;

  let guard = 0;
  const bpm = BGM_BPM[MUS.mode] || 96;
  while (MUS.next < now + BGM_LOOKAHEAD && guard++ < 24) {
    scheduleStep(MUS.next, MUS.step, MUS.bar, MUS.mode);
    MUS.next += 60 / bpm / 4;             /* 16 分音符 */
    MUS.step++;
    if (MUS.step % 16 === 0) MUS.bar++;
  }

  /* 环境层：只在真正热闹的战斗里出现，6~12 秒一次，音量 0.03 */
  if ((MUS.mode === 'combat' || MUS.mode === 'boss') && MUS.intensity > 0.72) {
    if (!MUS.rumbleAt) MUS.rumbleAt = now + rand(6, 12);
    else if (now >= MUS.rumbleAt) {
      bgmRumble(now + 0.03);
      MUS.rumbleAt = now + rand(6, 12);
    }
  } else {
    MUS.rumbleAt = 0;
  }
}

/* 静音开关：返回「现在是不是静音」。game.js 的 M 键按这个返回值弹 toast。 */
function audioToggle() {
  audioMuted = !audioMuted;
  setMasterLevel(masterTarget());
  return audioMuted;
}

/* ---- 自驱动兜底 ----
   hud.js 的主循环本应每帧调 audioTick(dt)。为了不让「另一条纵队还没接上」
   变成「BGM 完全没有」，这里用 rAF 起一条仅在有音频时存在的驱动。
   两条驱动同时调 audioTick 是安全的：调度器只排「比现在晚」的音符，
   第二次进来时 next 早已越过前瞻窗口，什么都不会重复排。 */
let audioRafOn = false;
function audioKick() {
  if (audioRafOn || !busReady) return;
  if (typeof requestAnimationFrame !== 'function') return;
  audioRafOn = true;
  let last = 0;
  const loop = (ts) => {
    if (!audioRafOn) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016;
    last = ts;
    try { audioTick(dt); } catch (e) {}
    try { requestAnimationFrame(loop); } catch (e) { audioRafOn = false; }
  };
  try { requestAnimationFrame(loop); } catch (e) { audioRafOn = false; }
}
