
/* ============================================================
   主角：黑甲战士（位图通道，2026-10-28 接入）
   ------------------------------------------------------------
   和大肥鱼同一条路子：发明细立绘 → 抠白底 → 归一化到 192px 高
   （游戏内 96px 的 2 倍超采样）→ base64 内联，代码只做搬运和变形。

   为什么不能用路径画：1280×720、1.22 倍视角下人只有 56~96px，
   头盔上的一道分模线不到 0.5px，参数调到头也画不出设定稿的金属感。

   两张底图：
     · hold —— 双手抱在胸前的持握姿势，手臂已经画进图里。
       枪由代码挂在手上，于是枪跟着准星转、手不动，读起来是「手在稳枪」。
     · idle —— 垂手站姿，兜底（握枪图解码失败、或以后过场用）。

   物理碰撞盒 h=58 一个数字都不动，视觉用 HERO_VH=96 —— 和 大肥鱼 同尺，
   两人并排是一个世界里的角色；敌兵仍按 h 画，天然比主角矮一截。
   ============================================================ */

const HERO_SPRITE_IDLE_B64 = '@@IDLE_B64@@';
const HERO_SPRITE_HOLD_B64 = '@@HOLD_B64@@';

const HERO_SPRITE = (typeof Image !== 'undefined') ? new Image() : null;
if (HERO_SPRITE) HERO_SPRITE.src = HERO_SPRITE_IDLE_B64;
const HERO_SPRITE_HOLD = (typeof Image !== 'undefined') ? new Image() : null;
if (HERO_SPRITE_HOLD) HERO_SPRITE_HOLD.src = HERO_SPRITE_HOLD_B64;

function heroSpriteReady() {
  return !!HERO_SPRITE && HERO_SPRITE.complete && HERO_SPRITE.naturalWidth > 0;
}
function heroHoldReady() {
  return !!HERO_SPRITE_HOLD && HERO_SPRITE_HOLD.complete && HERO_SPRITE_HOLD.naturalWidth > 0;
}

const HERO_VH = 96;              /* 屏幕上的视觉身高 */
const HERO_ART_W_HOLD = 87;      /* 素材归一化后的宽度（hold，192 高） */
const HERO_ART_W_IDLE = 78;      /* 同上（idle） */
const HERO_AR_HOLD = HERO_ART_W_HOLD / 192;
const HERO_AR_IDLE = HERO_ART_W_IDLE / 192;

/* 脚底锚点：按「两只鞋的中点」量，不是按图的几何中心 ——
   图左边还挂着背包，用图心当锚点人会整体前移。 */
const HERO_FOOT_HOLD = 0.414;
const HERO_FOOT_IDLE = 0.551;

/* 蹲下两段压缩：头段几乎不压（盔是圆的，压了就扁），身段压得狠。
   切点在下巴/衣领之间（y≈34%），压缩时接缝落在真实的结构线上。 */
const HERO_NECK = 0.34;
const HERO_HEAD_K = 0.93;
const HERO_BODY_K = 0.58;

function heroBands(cq) {
  const headH = HERO_VH * HERO_NECK * (1 - cq * (1 - HERO_HEAD_K));
  const bodyH = HERO_VH * (1 - HERO_NECK) * (1 - cq * (1 - HERO_BODY_K));
  return { headH, bodyH, total: headH + bodyH };
}
function heroRowY(rowFrac, cq) {
  if (cq <= 0.01) return -HERO_VH + rowFrac * HERO_VH;
  const { headH, bodyH, total } = heroBands(cq);
  if (rowFrac < HERO_NECK) return -total + (rowFrac / HERO_NECK) * headH;
  return -bodyH + ((rowFrac - HERO_NECK) / (1 - HERO_NECK)) * bodyH;
}

/* 前手（扣扳机那只）的掌心，量自 art/hero_hold.png：art 像素 (70, 92)。
   枪的挂点就是这里 —— 数字是量出来的，不是猜的。 */
const HERO_HAND_ROW_HOLD = 92 / 192;
const HERO_HAND_XFRAC_HOLD = 70 / HERO_ART_W_HOLD;
/* 枪的尺寸系数。按身高 96/58≈1.65 等比放大会让他端着一门炮：
   这张立绘头占了三分之一，等比缩放后枪比小臂还粗。0.92 是「顺手的一把步枪」。 */
const HERO_GUN_K = 0.92;

/* 拆腿：把立绘拆成「躯干 + 前腿 + 后腿」三片，腿要动就必须单独摆。
   腿片的上缘故意伸进胯部（y=112，比切口 128 高 16），画的时候先腿后躯干，
   伸进胯里的那 16px 被躯干盖住 —— 腿不管摆多大，切口永远藏在里面。
   矩形全部写在 87×192 的立绘坐标里，按 naturalWidth/87 自动缩放。 */
const HERO_LEG = {
  front: { sx: 37, sy: 112, sw: 50, sh: 80, cutX0: 37, cutX1: 87, cutY: 128, pivotX: 50, pivotY: 126 },
  back:  { sx: 0,  sy: 112, sw: 37, sh: 80, cutX0: 0,  cutX1: 37, cutY: 128, pivotX: 27, pivotY: 126, dim: 0.10 }
};
const _heroSplit = new Map();
function heroLegParts(img) { return legPartsOf(img, HERO_LEG, HERO_ART_W_HOLD, _heroSplit); }

/* 摆幅要按「看得见的量」定，不是按角度手感定：髋到脚 66 立绘像素 = 33 屏幕像素，
   0.16rad 让脚前后挪 10 立绘像素 = 5 屏幕像素，两只靴子来回差一个靴宽 ——
   刚够读出「在迈步」，再大就开始像踢正步（这张是开腿站姿，腿本来就分得开）。 */
const HERO_GAIT_K = {
  stepRot: 0.16, stepLift: 10,
  idleRot: 0.038, idleLift: 2.6,
  airFront: 0.15, airBack: -0.12, airLiftF: 8.0, airLiftB: 9.0
};

/* 受击红闪的纯红剪影（按图缓存，一张一张来） */
const _heroTint = new Map();
function heroTint(img) {
  if (!img) return null;
  let t = _heroTint.get(img);
  if (t === undefined) { t = whaleTintFor(img); _heroTint.set(img, t); }
  return t;
}

/* 枪：和大肥鱼共用同一把（whaleGunBody 是按「局部 +x 朝前」画的通用步枪），
   只换挂点和缩放。part='back' 先画枪托弹匣（被手挡住），'front' 再画机匣枪管。 */
function heroGunProp(a, cq, lean, part) {
  ctx.save();
  const pitch = whalePitch(a);
  const hx = (HERO_HAND_XFRAC_HOLD - HERO_FOOT_HOLD) * (HERO_VH * HERO_AR_HOLD);
  const hy = heroRowY(HERO_HAND_ROW_HOLD, cq || 0);
  ctx.translate(hx, hy);
  /* 外层已经 scale(facing,1) 镜像过，这里的 +x 就是面朝方向；
     外层还整体倾了 lean，这里要扣掉，否则枪会比准星多转那 3° */
  ctx.rotate(pitch - (lean || 0));
  ctx.scale(HERO_GUN_K, HERO_GUN_K);
  ctx.translate(-9, -5);                                          /* 握把咬住掌心 */
  ctx.translate(-Math.min(1, (a.muzzle || 0) * 12) * 1.5, 0);     /* 后坐 */
  whaleGunBody(a, part);
  ctx.restore();
}

function drawHero(a, isBuddy) {
  if (a.dead) return;
  if (a.downed) { drawDowned(a); return; }

  const sx = a.x - camera.x;
  const facing = Math.cos(a.aim) >= 0 ? 1 : -1;
  const sq = clamp(a.landSquash || 0, 0, 1);
  const t = game.time;

  /* 承托面阴影 */
  const under = surfaceBelow(a.x, a.y);
  const gap = clamp((under - a.y) / 190, 0, 1);
  const sk = 1 - gap * 0.68;
  ctx.fillStyle = 'rgba(0,0,0,' + (0.42 * sk).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + facing * 2, under + 1, 17 * sk, 4.8 * sk, 0, 0, Math.PI * 2);
  ctx.fill();

  /* 冲刺残影：暗块 + 一点冷调，比纯色块更像残影 */
  if ((a.dashTime || 0) > 0) {
    const dir = Math.sign(a.vx) || facing;
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.10 * i;
      ctx.fillStyle = '#1a2733';
      roundRect(sx - dir * i * 10 - 8, a.y - 96 * 0.86, 17, 96 * 0.78, 8);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* 二段跳空翻：与士兵/大肥鱼共用 AIRJUMP_FLIP 时钟 */
  let flipK = 0, flipAng = 0;
  if ((a.airJumpT || 0) > 0) {
    flipK = clamp(1 - a.airJumpT / AIRJUMP_FLIP, 0, 1);
    const e = flipK * flipK * (3 - 2 * flipK);
    flipAng = (a.flipDir || facing) * Math.PI * 2 * e;
  }
  const pivot = HERO_VH * 0.56;
  if (flipK > 0 && flipK < 0.82) {
    const al = 0.34 * (1 - flipK / 0.82);
    ctx.strokeStyle = 'rgba(120,226,255,' + al.toFixed(3) + ')';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const a0 = flipAng - 1.7 - i * 0.5;
      ctx.beginPath();
      ctx.arc(sx, a.y - pivot, HERO_VH * 0.42 - i * 5, a0, a0 + 1.15);
      ctx.stroke();
    }
  }

  const blink = a.invuln > 0 && Math.floor(a.invuln * 18) % 2 === 0;

  ctx.save();
  ctx.translate(sx, a.y);
  ctx.scale(1 + sq * 0.11, 1 - sq * 0.15);
  if (flipAng) {
    ctx.translate(0, -pivot);
    ctx.rotate(flipAng);
    ctx.translate(0, pivot);
  }
  if (blink) ctx.globalAlpha = 0.5;

  const cq = clamp(a.crouch || 0, 0, 1);

  /* ---------- 位图通道 ---------- */
  const holdUse = heroHoldReady();
  const img0 = holdUse ? HERO_SPRITE_HOLD : HERO_SPRITE;
  const spH = HERO_VH, spW = spH * (holdUse ? HERO_AR_HOLD : HERO_AR_IDLE);
  const dx = -spW * (holdUse ? HERO_FOOT_HOLD : HERO_FOOT_IDLE);
  const natW = img0.naturalWidth, natH = img0.naturalHeight;
  const u = spH / natH;                    /* 立绘像素 → 屏幕像素（等比） */

  ctx.scale(facing, 1);

  /* 倾身：绕脚底转一点点，头、肩、枪一起跟着准星走 */
  const lean = whaleLean(a);
  if (lean) ctx.rotate(lean);

  /* 枪托 + 弹匣：先铺在立绘底下（等下的人会盖住它） */
  heroGunProp(a, cq, lean, 'back');

  const blit = (img) => {
    if (!img) return;
    if (cq <= 0.01) { ctx.drawImage(img, dx, -spH, spW, spH); return; }
    const { headH, bodyH, total } = heroBands(cq);
    const nk = HERO_NECK * natH;
    ctx.save();
    ctx.scale(1 + cq * 0.10, 1);         /* 蹲下时横向略胖，重心才稳 */
    /* 身段先画（贴地）：+0.5 是补缝，避免两条 drawImage 之间露 1px 背景 */
    ctx.drawImage(img, 0, nk, natW, natH - nk, dx, -bodyH, spW, bodyH + 0.5);
    /* 头段压在身段上：只压到 0.93，盔还是圆的 */
    ctx.drawImage(img, 0, 0, natW, nk, dx, -total, spW, headH + 0.5);
    ctx.restore();
  };

  const parts = holdUse ? heroLegParts(img0) : null;
  const splitOn = !!parts && cq <= 0.02;

  const blitLeg = (key, useSil, gait) => {
    const R = HERO_LEG[key];
    const g = gait[key];
    const cv = useSil ? whalePartSil(parts, key) : parts.legs[key];
    if (!cv) return;
    const ox = dx + R.sx * u;
    const oy = -spH + R.sy * u - g.lift * u;
    /* 旋转中心 = 髋点，换算成「相对腿片左上角」的偏移；
       translate 已经把腿片左上角挪到原点，所以 drawImage 必须画在 (0,0) */
    const px = (R.pivotX - R.sx) * u, py = (R.pivotY - R.sy) * u;
    ctx.save();
    ctx.translate(ox + px, oy + py);
    ctx.rotate(g.rot);
    ctx.translate(-px, -py);
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, R.sw * u, R.sh * u);
    ctx.restore();
  };

  const blitLegs = (useSil) => {
    const gait = gaitFor(a, t, cq, HERO_GAIT_K);
    blitLeg('back', useSil, gait);
    blitLeg('front', useSil, gait);
  };

  if (splitOn) {
    blitLegs(false);
    blit(parts.body);
  } else {
    blit(img0);
  }

  /* 机匣与枪管后画：从手背上方穿出去 */
  heroGunProp(a, cq, lean, 'front');

  /* 受击红闪：用 sprite 的 alpha 当遮罩的纯红剪影，叠上去。
     拆件时两块腿也要各自红一遍，否则红影子会顶着一双不动的腿。 */
  if (a.flash > 0) {
    ctx.globalAlpha = Math.min(0.5, a.flash * 2.2);
    if (splitOn) {
      blitLegs(true);
      blit(whalePartSil(parts, 'body'));
    } else {
      blit(heroTint(img0));
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (isBuddy) drawBuddyPlate(a, sx, a.y + heroRowY(0, cq) - 8);
}
