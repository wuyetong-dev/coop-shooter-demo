'use strict';

/* ==================================================================
   渲染层 1：画布适配 / 背景 / 地形 / 角色
   ================================================================== */

function resizeCanvas() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cvs.style.width = Math.floor(W * s) + 'px';
  cvs.style.height = Math.floor(H * s) + 'px';
}
addEventListener('resize', resizeCanvas);

function seeded(n) {
  let s = n * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
const _rnd = seeded(7);

/* 稳定哈希：同一个输入永远得到同一个 [0,1) 值，用来给障碍物加「不重复的随机」细节 */
function hash01(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/* ------------------------------------------------------------------
   两段腿反解（IK）
   给一个脚的目标落点，算出大腿摆角与膝弯角，喂给 drawLeg。
   蹲下靠它把脚钉在地面上，而不是让腿被压成滑铲。
   ------------------------------------------------------------------ */
const LEG_TH = 13, LEG_SH = 15;
function legIK(hipX, hipY, footX, footY) {
  let dx = footX - hipX, dy = footY - hipY;
  let d = Math.sqrt(dx * dx + dy * dy) || 0.001;
  const dmin = Math.abs(LEG_TH - LEG_SH) + 1.2, dmax = LEG_TH + LEG_SH - 0.6;
  if (d < dmin) { dx *= dmin / d; dy *= dmin / d; d = dmin; }
  else if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; }
  const base = Math.atan2(dx, dy);
  const cosH = clamp((LEG_TH * LEG_TH + d * d - LEG_SH * LEG_SH) / (2 * LEG_TH * d), -1, 1);
  const hipA = Math.acos(cosH);
  const swing = base + hipA;
  const kx = Math.sin(swing) * LEG_TH, ky = Math.cos(swing) * LEG_TH;
  const knee = swing - Math.atan2(dx - kx, dy - ky);
  return { swing: swing, knee: knee };
}

/* 远景平铺周期（世界比这个宽，靠取模循环贴） */
const SKY_PERIOD = 9000;

const farCity = [];
for (let i = 0; i < 90; i++) {
  const w = 50 + _rnd() * 90;
  farCity.push({
    x: i * 100 + _rnd() * 40,
    w: w,
    h: 70 + _rnd() * 210,
    rnd: _rnd()
  });
}
const midRuins = [];
for (let i = 0; i < 45; i++) {
  midRuins.push({
    x: i * 200 + _rnd() * 70,
    w: 96 + _rnd() * 104,
    h: 88 + _rnd() * 172,
    broken: _rnd() > 0.45,
    tilt: (_rnd() - 0.5) * 0.03,
    seed: _rnd()
  });
}
const stars = [];
for (let i = 0; i < 110; i++) {
    stars.push({ x: _rnd() * SKY_PERIOD, y: 90 + _rnd() * 460, r: _rnd() * 1.5 + 0.4, a: _rnd() * 0.7 + 0.2, tw: _rnd() * 6.28 });
}
const clouds = [];
for (let i = 0; i < 24; i++) {
  clouds.push({
    x: _rnd() * SKY_PERIOD,
    y: 120 + _rnd() * 380,
    w: 200 + _rnd() * 380,
    h: 9 + _rnd() * 22,
    a: 0.035 + _rnd() * 0.06,
    sp: 2 + _rnd() * 5
  });
}
const groundRocks = [];
for (let i = 0; i < 320; i++) {
  groundRocks.push({ x: _rnd() * 4200, d: _rnd(), r: 1 + _rnd() * 3.2, a: 0.08 + _rnd() * 0.26 });
}
const grassTufts = [];
for (let i = 0; i < 90; i++) {
  grassTufts.push({ x: _rnd() * 4200, h: 5 + _rnd() * 11, lean: (_rnd() - 0.5) * 8, a: 0.3 + _rnd() * 0.4 });
}

/* ==================================================================
   2.0 场景层：视差数据 / 主题色 / 缓存精灵
   ------------------------------------------------------------------
   这一层只做四件事：拉开纵深、加空气、给地面质感、最后压一层后处理。
   三条硬规矩，违反任意一条都会在 60fps 红线上翻车：

   1) 场景随机一律走 hash01(i)，不用 Math.random。
      地面每帧重掷随机数 = 满屏闪烁，是最典型的观感杀手。
   2) 坐标固定的渐变（天空 / 地面 / 雾带 / 暗角）按主题缓存成对象，
      换关才重建一次；这些渐变与相机无关，缓存不会过期。
   3) 「一团光」一律预烘成离屏精灵再 drawImage 缩放，
      绝不在绘制循环里 createRadialGradient —— 一屏 40 颗子弹就是 40 个
      渐变对象，GC 直接吃掉帧率。
   ================================================================== */

const SC_FAR_P  = SKY_PERIOD;   /* 远景平铺周期 */
const SC_MID_P  = SKY_PERIOD;   /* 中景平铺周期 */
const SC_NEAR_P = 1560;         /* 近景（比世界更快）平铺周期 */
const SC_FAR_K  = 0.12;         /* 远景视差：几乎不动，只做「很远」 */
const SC_MID_K  = 0.38;         /* 中景视差：可读的建筑群 */
const SC_NEAR_K = 1.12;         /* 近景视差：比世界更快 = 贴脸框景 */

/* 中景的塔吊 / 广告牌：楼群之间插几根细线，天际线才不像一排积木 */
const scCranes = [];
for (let i = 0; i < 11; i++) {
  scCranes.push({
    x: i * 820 + _rnd() * 360,
    h: 190 + _rnd() * 150,
    arm: 84 + _rnd() * 96,
    side: _rnd() > 0.5 ? 1 : -1,
    hang: _rnd(),
    ph: _rnd() * 6.28
  });
}
const scSigns = [];
for (let i = 0; i < 15; i++) {
  scSigns.push({
    x: i * 600 + _rnd() * 280,
    dy: _rnd(),
    w: 52 + _rnd() * 46,
    h: 26 + _rnd() * 26,
    lit: _rnd() > 0.45,
    ph: _rnd() * 6.28
  });
}

/* 浮尘：一次生成、永不 new。位置完全由 game.time 推出来，
   所以既不用每帧改对象，也不会因为暂停/回放出现跳变。 */
const scDust = [];
for (let i = 0; i < 58; i++) {
  scDust.push({
    x: _rnd() * 1400,
    y: _rnd(),
    sp: 8 + _rnd() * 24,
    r: 0.7 + _rnd() * 1.5,
    a: 0.05 + _rnd() * 0.16,
    warm: _rnd() > 0.35,
    ph: _rnd() * 6.28
  });
}
const SC_DUST_P = 1400;

/* 近景框景件：废墟断角 / 钢筋束 / 沙袋堆 / 管线。
   只在屏幕左右两侧的画框带里出现（中间遮住玩家 = 直接判死）。 */
const scNearProps = [];
for (let i = 0; i < 12; i++) {
  scNearProps.push({
    x: i * (SC_NEAR_P / 12) + (_rnd() - 0.5) * 60,
    kind: i % 4,
    w: 96 + _rnd() * 118,
    h: 26 + _rnd() * 32,
    seed: _rnd()
  });
}

/* ---------- 离屏画布：无头测试里没有 document.createElement ---------- */
function scOffscreen(w, h) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv.getContext('2d') ? cv : null;
  } catch (e) { return null; }
}
function scSprite(w, h, painter) {
  const cv = scOffscreen(w, h);
  if (!cv) return null;
  try { painter(cv.getContext('2d'), w, h); } catch (e) { return null; }
  return cv;
}

/* 一团暖光 / 一团冷光：子弹光晕、枪口光池、爆炸余辉全部复用这两张 */
const scGlowWarm = scSprite(96, 96, (g, w, h) => {
  const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  rg.addColorStop(0, 'rgba(255,248,222,1)');
  rg.addColorStop(0.20, 'rgba(255,212,140,0.72)');
  rg.addColorStop(0.52, 'rgba(255,152,66,0.20)');
  rg.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
});
const scGlowCool = scSprite(96, 96, (g, w, h) => {
  const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.22, 'rgba(206,232,255,0.62)');
  rg.addColorStop(0.55, 'rgba(150,196,255,0.16)');
  rg.addColorStop(1, 'rgba(120,170,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
});

/* 弹道拖尾：一张横向「透明 → 白」的条，旋转后拉伸贴到弹道两点之间。
   比每颗子弹每帧 createLinearGradient 便宜一个数量级。 */
const scTrailWarm = scSprite(64, 16, (g, w, h) => {
  const lg = g.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, 'rgba(255,180,90,0)');
  lg.addColorStop(0.5, 'rgba(255,196,110,0.28)');
  lg.addColorStop(0.86, 'rgba(255,230,170,0.72)');
  lg.addColorStop(1, 'rgba(255,252,225,1)');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
});
const scTrailCool = scSprite(64, 16, (g, w, h) => {
  const lg = g.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, 'rgba(150,200,255,0)');
  lg.addColorStop(0.5, 'rgba(168,214,255,0.26)');
  lg.addColorStop(0.86, 'rgba(214,238,255,0.70)');
  lg.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
});

/* 体积光柱：一根「两头透明、末端最亮」的白光条，靠 rotate + drawImage 摆斜 */
function scBeamSprite(r, gg, bb) {
  return scSprite(112, 620, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
    lg.addColorStop(0.42, 'rgba(' + r + ',' + gg + ',' + bb + ',0.85)');
    lg.addColorStop(0.5, 'rgba(' + r + ',' + gg + ',' + bb + ',1)');
    lg.addColorStop(0.58, 'rgba(' + r + ',' + gg + ',' + bb + ',0.85)');
    lg.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + bb + ',0)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    const vg = g.createLinearGradient(0, h, 0, 0);
    vg.addColorStop(0, 'rgba(255,255,255,1)');
    vg.addColorStop(0.30, 'rgba(255,255,255,0.52)');
    vg.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  });
}
const scBeamWarm = scBeamSprite(255, 206, 156);
const scBeamCool = scBeamSprite(188, 218, 255);

/* 一簇火苗：底端最亮、往上化开。远处火堆用它贴三次（大中小），
   比每堆火每帧建 5 个渐变便宜得多。 */
const scFlame = scSprite(48, 128, (g, w, h) => {
  const rg = g.createRadialGradient(w / 2, h, 2, w / 2, h, h);
  rg.addColorStop(0, 'rgba(255,244,206,0.95)');
  rg.addColorStop(0.28, 'rgba(255,192,98,0.52)');
  rg.addColorStop(0.66, 'rgba(252,120,40,0.15)');
  rg.addColorStop(1, 'rgba(200,66,18,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, w, h);
});

/* 颗粒：256×256 的噪点，模块加载时烘一次，之后每 3 帧换一次平移 */
let scNoisePat = null;
let scNoiseOn = false;
(function () {
  const cv = scOffscreen(256, 256);
  if (!cv) return;
  try {
    const g = cv.getContext('2d');
    const img = g.createImageData ? g.createImageData(256, 256) : null;
    if (!img || !img.data) return;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 240;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const pat = g.createPattern ? g.createPattern(cv, 'repeat') : null;
    if (!pat) return;
    scNoisePat = pat;
    scNoiseOn = true;
  } catch (e) { scNoisePat = null; scNoiseOn = false; }
})();

/* ---------- 主题色 ---------- */
function scRGB(c, al) {
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (al === undefined ? 1 : al) + ')';
}
function scMix(a, b, k, al) {
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return 'rgba(' + r + ',' + g + ',' + bl + ',' + (al === undefined ? 1 : al) + ')';
}

/* 从 world.theme.grade 拆 RGB，派生雾色 / 边缘光色 / 明度阶梯。
   五套主题（破晓蓝 / 焦土橙 / 指挥部青 / 夜袭深蓝 / 终局赤红）靠这一处统一，
   别的地方一律读返回值，不许再硬编码颜色。 */
let scTCache = null, scTKey = '';
function scTheme() {
  const th = world.theme || {};
  const key = (th.grade || 'none') + '|' + (world.groundY | 0);
  if (scTCache && scTKey === key) return scTCache;
  const m = /rgba?\(([^)]+)\)/.exec(th.grade || '');
  let r = 92, g = 128, b = 168, a = 0.14;
  if (m) {
    const p = m[1].split(',');
    if (p.length >= 3) {
      r = +p[0] || 0; g = +p[1] || 0; b = +p[2] || 0;
      if (p.length > 3) a = +p[3] || 0;
    }
  }
  const warm = 0.30;
  const wr = Math.round(r * (1 - warm) + 198 * warm);
  const wg = Math.round(g * (1 - warm) + 170 * warm);
  const wb = Math.round(b * (1 - warm) + 134 * warm);
  /* 地平线余晖：主题暖色再往橙偏一档，破晓偏冷金、终局偏赤橙 */
  const hor = [
    Math.round(wr * 0.42 + 255 * 0.58),
    Math.round(wg * 0.42 + 150 * 0.58),
    Math.round(wb * 0.42 + 72 * 0.58)
  ];
  const tint = clamp(0.30 + a * 1.6, 0.26, 0.70);
  /* 远景明度阶梯：越高越冷越淡（空气透视）。预生成 6 档，
     绘制时按下标取，避免每栋楼每帧拼 rgb 字符串。 */
  const far = [], mid = [];
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    far.push(scMix([13, 20, 28], [wr, wg, wb], 0.10 + (1 - k) * tint * 0.55));
    mid.push(scMix([9, 14, 19], [wr, wg, wb], 0.05 + (1 - k) * tint * 0.34));
  }
  scTCache = {
    key: key,
    rgb: [r, g, b],
    warm: [wr, wg, wb],
    hor: hor,
    horA: (al) => scRGB(hor, al),
    a: a,
    tint: tint,
    cold: r + b > g * 2 ? true : false,
    fireMul: th.fireMul === undefined ? 1 : th.fireMul,
    beamMul: th.beamMul === undefined ? 1 : th.beamMul,
    far: far,
    mid: mid,
    fog: (al) => 'rgba(' + wr + ',' + wg + ',' + wb + ',' + al + ')',
    edge: (al) => 'rgba(' + Math.min(255, wr + 54) + ',' + Math.min(255, wg + 44) + ',' + Math.min(255, wb + 26) + ',' + al + ')'
  };
  scTKey = key;
  return scTCache;
}

/* 坐标固定的渐变缓存。key 里必须带主题，否则换关还是上一关的颜色。 */
const scGradCache = Object.create(null);
function scGrad(key, build) {
  const c = scGradCache[key];
  if (c) return c;
  const g = build();
  scGradCache[key] = g;
  return g;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ---------------- 大气层：探照灯 / 火光 / 烟柱 ----------------
   战场夜色最缺的两样东西：扫过天空的探照灯，和远处还在烧的火。
   两者都用「视差 0.10 + 周期取模」定位，和远景城市同一层，几乎不增加开销。
   顺序上画在中景废墟之前，被楼体挡住一半才像「在楼后面」。            */
const BEAMS = [
  { fx: 0.16, len: 760, w0: 7, w1: 96, sway: 0.42, spd: 0.27, ph: 0.0 },
  { fx: 0.47, len: 620, w0: 5, w1: 74, sway: 0.34, spd: 0.19, ph: 2.1 },
  { fx: 0.79, len: 840, w0: 8, w1: 110, sway: 0.50, spd: 0.23, ph: 4.2 }
];
const FIRES = [
  { fx: 0.28, r: 88, i: 1.00 },
  { fx: 0.63, r: 62, i: 0.75 },
  { fx: 0.91, r: 110, i: 0.90 }
];

/* 探照灯光锥：把「窄口 → 宽口 + 沿长度淡出」整根锥子烘成一张图，
   每帧只做 translate + rotate + drawImage 拉伸缩放，一个渐变都不建。
   参考尺寸 = 半宽 96 / 长度 640，各条光束按自己的 w1 与 len 缩放。 */
const scSearchCone = scSprite(224, 640, (g, w, h) => {
  g.beginPath();
  g.moveTo(w * 0.5 - 7, h);
  g.lineTo(w * 0.5 + 7, h);
  g.lineTo(w * 0.5 + 96, 0);
  g.lineTo(w * 0.5 - 96, 0);
  g.closePath();
  const lg = g.createLinearGradient(0, h, 0, 0);
  lg.addColorStop(0, 'rgba(178,210,238,0.16)');
  lg.addColorStop(0.35, 'rgba(152,192,226,0.075)');
  lg.addColorStop(1, 'rgba(120,170,215,0)');
  g.fillStyle = lg;
  g.fill();
});

function drawAtmosphere(gy, farBase) {
  /* 位置按「屏幕宽度周期」重复，而不是按 SKY_PERIOD：
     这两样东西必须常在视野里，否则大部分时间根本看不到。
     周期比可视宽度大一点，再左移 450，保证画面里始终有一到两道光束。 */
  const BEAT_B = VIEW_W + 900;
  const drift = camera.x * 0.10;
  const srcY = gy + 16;   /* 灯源埋在地表以下，会被 drawGround 盖住 → 读成「光从掩体后打上来」 */

  /* --- 探照灯：锥形光束 + 地面上的小灯芯 --- */
  const th = scTheme();
  const bm = th.beamMul;
  if (bm < 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(bm, 0.15, 1);
  for (let i = 0; i < BEAMS.length; i++) {
    const b = BEAMS[i];
    let ox = (b.fx * BEAT_B - drift) % BEAT_B;
    if (ox < 0) ox += BEAT_B;
    ox -= 450;
    if (ox > VIEW_W + 760) continue;

    const ang = -Math.PI / 2 + Math.sin(game.time * b.spd + b.ph) * b.sway;

    if (scSearchCone) {
      /* 精灵的「上」对准光束方向：先转 90°，再按 (w1, len) 拉伸 */
      const sx = b.w1 / 96, sy = b.len / 640;
      ctx.save();
      ctx.translate(ox, srcY);
      ctx.rotate(ang + Math.PI / 2);
      ctx.drawImage(scSearchCone, -112 * sx, -640 * sy, 224 * sx, 640 * sy);
      ctx.restore();
    } else {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const px = -dy, py = dx;
      const ex = ox + dx * b.len, ey = srcY + dy * b.len;
      ctx.fillStyle = 'rgba(170,204,236,0.06)';
      ctx.beginPath();
      ctx.moveTo(ox + px * b.w0, srcY + py * b.w0);
      ctx.lineTo(ox - px * b.w0, srcY - py * b.w0);
      ctx.lineTo(ex - px * b.w1, ey - py * b.w1);
      ctx.lineTo(ex + px * b.w1, ey + py * b.w1);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* --- 远处火光：中景楼层之间还在烧的东西 ---
   必须画在中景废墟「之后」，光才会糊到楼面上；画在前面只会被楼挡掉。 */
function drawFires(gy, farBase) {
  const BEAT_F = VIEW_W + 720;
  const drift = camera.x * 0.10;
  const fm = (world.theme && world.theme.fireMul !== undefined) ? world.theme.fireMul : 1;
  for (let i = 0; i < FIRES.length; i++) {
    const f = FIRES[i];
    let ox = (f.fx * BEAT_F - drift * 1.3) % BEAT_F;
    if (ox < 0) ox += BEAT_F;
    ox -= 360;
    if (ox > VIEW_W + 320) continue;
    const fi = clamp(f.i * fm, 0, 1.6);
    if (fi < 0.02) continue;
    const fy = gy - 7;               /* 火头压在地平线上，读成「街尾还在烧的残骸」 */
    const fl = 0.82 + Math.sin(game.time * 5.3 + i * 1.9) * 0.10 + Math.sin(game.time * 11.7 + i) * 0.05;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* 光团 / 火苗全部用模块加载时烘好的离屏精灵，
       这里只做 drawImage 缩放 —— 每帧 0 个渐变对象。 */
    const R = f.r * fl * 2.1;
    if (scGlowWarm) {
      ctx.globalAlpha = clamp(0.95 * fi, 0, 1.2);
      ctx.drawImage(scGlowWarm, ox - R * 0.5, fy - R * 0.5, R, R);
    }
    /* 火苗：三簇底端锚在地平线的火花，宽度/高度/相位各不相同，
       叠起来才像「在烧」，单贴一个圆只会像「贴了个圆」。 */
    if (scFlame) {
      for (let k = 0; k < 3; k++) {
        const fx2 = ox + Math.sin(game.time * (3 + k) + i * 2 + k) * (9 + k * 6);
        const hh = (86 - k * 22) * fl;
        const ww = (30 - k * 5) * fl;
        ctx.globalAlpha = clamp((0.34 + k * 0.14) * fi, 0, 0.95);
        ctx.drawImage(scFlame, fx2 - ww * 0.5, fy + 4 - hh, ww, hh);
      }
      /* 火芯：一条几乎不动的亮黄短焰 */
      ctx.globalAlpha = clamp(0.55 * fi, 0, 1);
      ctx.drawImage(scFlame, ox - 5.5 * fl, fy + 4 - 34 * fl, 11 * fl, 34 * fl);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    /* 烟柱：几团按时间往上飘的椭圆，越往上越大越淡 */
    ctx.save();
    for (let s = 0; s < 5; s++) {
      const t = (game.time * 0.16 + s * 0.2 + i * 0.37) % 1;
      const sy = fy - 26 - t * 300;
      const sx = ox + Math.sin(t * 3.4 + s + i) * (10 + t * 46);
      const sr = 12 + t * 44;
      ctx.globalAlpha = (1 - t) * 0.16 * fi;
      ctx.fillStyle = '#4a4038';
      ctx.beginPath(); ctx.ellipse(sx, sy, sr * 1.35, sr * 0.82, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawBackground() {
  const gy = world.groundY;
  const th = scTheme();
  /* 天空带：地面以上 640，地面以下 90（足够盖住可视区域） */
  const skyTop = gy - 640;
  const skyBot = gy + 90;
  /* 主题越浓、火光越旺，星月越该退场 —— 终局火海顶上挂个满月亮最出戏 */
  const starMul = clamp(1.18 - th.a * 3.4, 0.10, 1);
  const moonA = clamp(1.06 - th.fireMul * 0.36, 0.14, 0.95);

  /* ---------- 1. 天空 ----------
     整条竖向渐变按主题缓存：坐标只跟 groundY 有关，换关才重建一次。 */
  const sky = scGrad('sky|' + th.key, () => {
    const g = ctx.createLinearGradient(0, skyTop, 0, skyBot);
    g.addColorStop(0, scMix([6, 9, 14], th.warm, 0.14));
    g.addColorStop(0.34, scMix([16, 26, 38], th.warm, 0.26));
    g.addColorStop(0.60, scMix([38, 48, 54], th.warm, 0.38));
    g.addColorStop(0.80, scMix([74, 72, 62], th.warm, 0.42));
    g.addColorStop(0.875, scMix([104, 88, 66], th.warm, 0.50));
    g.addColorStop(1, scMix([120, 100, 76], th.warm, 0.56));
    return g;
  });
  ctx.fillStyle = sky;
  ctx.fillRect(-200, skyTop, W + 400, skyBot - skyTop);

  /* 星星（视差最慢，带呼吸闪烁） */
  const so = -(camera.x * 0.02) % SKY_PERIOD;
  if (starMul > 0.14) {
    for (const s of stars) {
      let x = s.x + so;
      if (x < -20) x += SKY_PERIOD;
      if (x > W + 20) continue;
      const tw = 0.55 + 0.45 * Math.sin(game.time * 1.7 + s.tw);
      ctx.globalAlpha = s.a * tw * starMul;
      ctx.fillStyle = '#cfe4ff';
      ctx.fillRect(x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  /* 月亮 + 光晕：月晕是一团冷光，直接贴预烘精灵，不建渐变 */
  const mx = W * 0.74, my = 172;
  if (moonA > 0.18) {
    if (scGlowCool) {
      ctx.globalAlpha = 0.34 * moonA;
      ctx.drawImage(scGlowCool, mx - 195, my - 195, 390, 390);
    }
    ctx.globalAlpha = moonA;
    ctx.fillStyle = '#e8f0fb';
    ctx.beginPath(); ctx.arc(mx, my, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(188,203,224,0.8)';
    ctx.beginPath(); ctx.arc(mx - 11, my - 8, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 12, my + 9, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 4, my - 15, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* 云层：扁平的风吹云带，越贴近地平线越暖 */
  const co = -(camera.x * 0.05 + game.time * 4) % SKY_PERIOD;
  for (const c of clouds) {
    let x = c.x + co;
    while (x < -520) x += SKY_PERIOD;
    if (x > VIEW_W + 520) continue;
    const k = clamp((c.y - 120) / 380, 0, 1);          /* 0 = 高空，1 = 贴地 */
    ctx.globalAlpha = c.a * (0.55 + 0.45 * starMul);
    ctx.fillStyle = k > 0.62 ? '#8b8078' : '#6f8496';
    ctx.beginPath(); ctx.ellipse(x, c.y, c.w * 0.5, c.h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x - c.w * 0.26, c.y + c.h * 0.16, c.w * 0.3, c.h * 0.44, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + c.w * 0.28, c.y - c.h * 0.12, c.w * 0.26, c.h * 0.46, 0, 0, Math.PI * 2); ctx.fill();
    /* 底缘被落日扫到的一条暖边 */
    if (k > 0.5) {
      ctx.globalAlpha = c.a * 1.6;
      ctx.fillStyle = 'rgba(255,168,104,0.55)';
      ctx.beginPath(); ctx.ellipse(x, c.y + c.h * 0.36, c.w * 0.4, c.h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  /* 地平线余晖：主题暖色，按主题缓存（坐标固定，不随相机变） */
  const hg = scGrad('hglow|' + th.key, () => {
    const rg = ctx.createRadialGradient(W * 0.62, gy - 67, 30, W * 0.62, gy - 67, 640);
    rg.addColorStop(0, th.horA(0.30));
    rg.addColorStop(0.42, th.horA(0.09));
    rg.addColorStop(1, th.horA(0));
    return rg;
  });
  ctx.fillStyle = hg;
  ctx.fillRect(-200, skyTop, W + 400, skyBot - skyTop);

  /* ---------- 4. 远景城市（视差 0.12） ----------
     楼体一律用主题明度阶梯里的**平色**，不再一栋一个 createLinearGradient；
     上下层次交给画完之后压的一整条雾化渐变，空气透视反而更统一。 */
  const fo = -(camera.x * SC_FAR_K) % SC_FAR_P;
  const farBase = gy - 26;
  for (let rep = 0; rep < 2; rep++) {
    for (const b of farCity) {
      const x = b.x + fo + rep * SC_FAR_P;
      if (x > W + 260 || x + b.w < -260) continue;
      const topY = farBase - b.h;
      ctx.fillStyle = th.far[Math.min(5, (b.h / 56) | 0)];
      ctx.fillRect(x, topY, b.w, b.h);
      /* 楼顶轮廓亮边 */
      ctx.fillStyle = 'rgba(150,178,198,0.07)';
      ctx.fillRect(x, topY, b.w, 1.4);
      /* 窗灯：远景只留最稀疏的几点，对比压到最低 */
      for (let wy = topY + 16; wy < farBase - 22; wy += 27) {
        for (let wx = x + 7; wx < x + b.w - 9; wx += 21) {
          if (((wx * 3 + wy * 7) | 0) % 19 < 2) {
            ctx.fillStyle = 'rgba(255,196,124,0.13)';
            ctx.fillRect(wx, wy, 4, 6);
          }
        }
      }
      if (b.rnd > 0.82) {
        ctx.fillStyle = 'rgba(18,26,36,0.95)';
        ctx.fillRect(x + b.w * 0.5 - 1, topY - 30, 2, 30);
        ctx.fillStyle = 'rgba(255,80,70,' + (0.32 + Math.sin(game.time * 3 + b.x) * 0.28) + ')';
        ctx.fillRect(x + b.w * 0.5 - 2, topY - 33, 4, 4);
      }
    }
  }

  /* 远景雾化：楼脚被地平线雾吃掉，越贴地越淡 —— 一层渐变覆盖整排楼 */
  const farFade = scGrad('farfade|' + th.key, () => {
    const gg = ctx.createLinearGradient(0, gy - 380, 0, gy - 18);
    gg.addColorStop(0, th.fog(0));
    gg.addColorStop(0.58, th.fog(0.09));
    gg.addColorStop(1, th.fog(0.26));
    return gg;
  });
  ctx.fillStyle = farFade;
  ctx.fillRect(-200, gy - 380, W + 400, 362);

  /* 城市与废墟之间的雾带（拉出空气透视） */
  const haze = scGrad('haze|' + th.key, () => {
    const gg = ctx.createLinearGradient(0, farBase - 190, 0, farBase + 20);
    gg.addColorStop(0, th.fog(0));
    gg.addColorStop(0.7, th.fog(0.10));
    gg.addColorStop(1, th.fog(0.17));
    return gg;
  });
  ctx.fillStyle = haze;
  ctx.fillRect(-200, farBase - 190, W + 400, 210);

  /* 大气层：探照灯 + 远处火光烟柱（画在中景废墟之前，被楼体遮挡才像「在楼后面」） */
  drawAtmosphere(gy, farBase);

  /* ---------- 5. 中景废墟（视差 0.38） ----------
     塔吊先画，楼体压上去遮住下半截，才像「楼群中间立着塔吊」。 */
  drawCranes(gy, th);

  const mo = -(camera.x * SC_MID_K) % SC_MID_P;
  const midBase = gy + 26;
  for (let rep = 0; rep < 2; rep++) {
    for (const b of midRuins) {
      const x = b.x + mo + rep * SC_MID_P;
      if (x > W + 340 || x + b.w < -340) continue;
      ctx.save();
      ctx.translate(x + b.w / 2, midBase);
      ctx.rotate(b.tilt);
      ctx.translate(-(x + b.w / 2), -midBase);

      const rTop = midBase - b.h;
      /* 中景同样走主题明度阶梯的平色，靠底部的雾化渐变收出层次 */
      ctx.fillStyle = th.mid[Math.min(5, (b.seed * 5.9) | 0)];
      ctx.beginPath();
      if (b.broken) {
        /* 只有「缺角」没有「山峰」：破口控制在 4%~10% 楼高 */
        const d = b.h * 0.055;
        ctx.moveTo(x, midBase);
        ctx.lineTo(x, rTop + b.h * 0.06);
        ctx.lineTo(x + b.w * 0.14, rTop + b.h * 0.02);
        ctx.lineTo(x + b.w * 0.26, rTop + d);
        ctx.lineTo(x + b.w * 0.40, rTop + d * 0.35);
        ctx.lineTo(x + b.w * 0.54, rTop + d * 1.7);
        ctx.lineTo(x + b.w * 0.68, rTop + d * 0.6);
        ctx.lineTo(x + b.w * 0.82, rTop + d * 1.25);
        ctx.lineTo(x + b.w, rTop + b.h * 0.03);
        ctx.lineTo(x + b.w, midBase);
      } else {
        ctx.rect(x, rTop, b.w, b.h);
      }
      ctx.closePath();
      ctx.fill();

      /* 楼板分层：每 34px 一道极淡的横带，读起来是「一层一层的楼」 */
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let fy = midBase - 34; fy > rTop + 12; fy -= 34) {
        ctx.fillRect(x, fy, b.w, 2);
      }

      /* 迎月一侧的竖直亮边（月亮在画面右上方）：三段平色代替每帧渐变 */
      ctx.fillStyle = 'rgba(150,180,205,0.11)';
      ctx.fillRect(x + b.w - 5, rTop, 5, b.h);
      ctx.fillStyle = 'rgba(150,180,205,0.06)';
      ctx.fillRect(x + b.w - 11, rTop, 6, b.h);
      ctx.fillStyle = 'rgba(150,180,205,0.03)';
      ctx.fillRect(x + b.w - 17, rTop, 6, b.h);

      /* 窗洞（少数还亮着暖光） */
      for (let wy = rTop + 16; wy < midBase - 26; wy += 30) {
        for (let wx = x + 12; wx < x + b.w - 16; wx += 24) {
          const hsh = ((wx * 7 + wy * 13) | 0) % 17;
          if (hsh < 3) {
            ctx.fillStyle = 'rgba(255,170,96,0.14)';
            ctx.fillRect(wx, wy, 9, 12);
          } else if (hsh < 7) {
            ctx.fillStyle = 'rgba(8,13,18,0.6)';
            ctx.fillRect(wx, wy, 9, 12);
          }
        }
      }
      /* 贴地暖反光 */
      ctx.fillStyle = 'rgba(255,150,80,0.05)';
      ctx.fillRect(x, midBase - b.h * 0.18, b.w, b.h * 0.18);
      /* 墙脚碎砖堆，把楼「按」在地上 */
      ctx.fillStyle = 'rgba(9,13,16,0.9)';
      ctx.beginPath();
      ctx.moveTo(x - 10, midBase);
      ctx.lineTo(x + b.w * 0.12, midBase - 7);
      ctx.lineTo(x + b.w * 0.34, midBase - 3);
      ctx.lineTo(x + b.w * 0.6, midBase - 9);
      ctx.lineTo(x + b.w + 8, midBase - 2);
      ctx.lineTo(x + b.w + 8, midBase);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* 广告牌画在楼群之后：杆子压在楼面上，读成「更近一层」 */
  drawSigns(gy, th);

  /* 火光画在废墟之后，光才能糊在楼面上 */
  drawFires(gy, farBase);

  /* ---------- 6. 体积光：3~5 条斜向光柱 ----------
     全部是预烘光柱贴图 + 'lighter'，透明度压在 0.03~0.07，
     只负责「空气里有光」，绝不能亮到抢角色的明度。 */
  drawGodRays(gy, th);

  /* ---------- 7. 浮尘：几十个极小亮点，位置全由 game.time 推出 ---------- */
  drawDust(gy, th);

  /* 近地薄雾：地面线以上 120~200px 的一条水平雾带，越贴地越浓 */
  const fg = scGrad('nearfog|' + th.key, () => {
    const gg = ctx.createLinearGradient(0, gy - 196, 0, gy + 62);
    gg.addColorStop(0, th.fog(0));
    gg.addColorStop(0.46, th.fog(0.055));
    gg.addColorStop(0.78, th.fog(0.13));
    gg.addColorStop(1, th.fog(0.24));
    return gg;
  });
  ctx.fillStyle = fg;
  ctx.fillRect(-200, gy - 196, W + 400, 258);
}

/* ---------------- 中景塔吊 ----------------
   几根细线插在楼群之间，天际线才不会读成一排积木。
   塔身 / 吊臂 / 配重 / 吊钩全部平色，不开任何渐变。 */
function drawCranes(gy, th) {
  const off = -(camera.x * SC_MID_K) % SC_MID_P;
  const baseY = gy - 6;
  const t = game.time;
  for (let rep = 0; rep < 2; rep++) {
    for (const c of scCranes) {
      const x = c.x + off + rep * SC_MID_P;
      if (x < -170 || x > VIEW_W + 170) continue;
      const topY = baseY - c.h;
      const sway = Math.sin(t * 0.42 + c.ph) * 0.045;

      ctx.fillStyle = th.mid[0];
      /* 塔身：两根竖杆 + 横档 = 桁架，一根棍只会读成「电线杆」 */
      ctx.fillRect(x - 4, topY, 2.4, c.h);
      ctx.fillRect(x + 2, topY, 2.4, c.h);
      for (let yy = topY + 12; yy < baseY; yy += 22) {
        ctx.fillRect(x - 4, yy, 8.4, 1.4);
      }
      /* 吊臂 + 配重 + 吊钩 */
      ctx.save();
      ctx.translate(x, topY + 4);
      ctx.rotate(sway);
      ctx.fillRect(0, -1.6, c.arm * c.side, 3.2);
      ctx.fillRect(-c.side * 18, -8, 15, 13);
      const hx = c.arm * 0.72 * c.side;
      const hy = 46 + c.hang * 62;
      ctx.fillRect(hx - 0.7, 0, 1.4, hy);
      ctx.fillRect(hx - 4.5, hy, 9, 5);
      ctx.restore();

      /* 顶端的红色航空灯：一闪一闪，给天际线一点「活着」的暗示 */
      ctx.fillStyle = 'rgba(255,86,64,' + (0.16 + 0.26 * (0.5 + 0.5 * Math.sin(t * 2.1 + c.ph))) + ')';
      ctx.fillRect(x - 1.5, topY - 3, 3, 3);
      ctx.fillStyle = th.edge(0.09);
      ctx.fillRect(x - 4, topY, 1, c.h);
    }
  }
}

/* ---------------- 中景广告牌 ----------------
   楼顶挂的破牌子。亮的那块有一点点呼吸，暗的那块只是一块深色板，
   两种混着放，城市才不像样板楼。 */
function drawSigns(gy, th) {
  const off = -(camera.x * SC_MID_K) % SC_MID_P;
  const t = game.time;
  for (let rep = 0; rep < 2; rep++) {
    for (const s of scSigns) {
      const cx = s.x + off + rep * SC_MID_P + s.w * 0.5;
      if (cx < -90 || cx > VIEW_W + 90) continue;
      const sy = gy - 52 - s.dy * 232;      /* 挂在楼体的高度带里 */
      const x = cx - s.w * 0.5;

      /* 立杆 */
      ctx.fillStyle = th.mid[1];
      ctx.fillRect(cx - 1.6, sy, 3.2, gy - sy + 12);
      /* 板面 */
      ctx.fillStyle = th.mid[2];
      ctx.fillRect(x, sy - s.h, s.w, s.h);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.fillRect(x, sy - 3, s.w, 3);

      if (s.lit) {
        const fl = 0.5 + 0.5 * Math.sin(t * 2.4 + s.ph);
        ctx.fillStyle = th.horA(0.08 + fl * 0.09);
        ctx.fillRect(x + 4, sy - s.h + 5, s.w - 8, s.h - 12);
        ctx.fillStyle = th.horA(0.24 + fl * 0.22);
        ctx.fillRect(x + s.w * 0.5 - 7, sy - s.h * 0.5 - 3, 14, 5);
      } else {
        ctx.fillStyle = 'rgba(120,134,144,0.09)';
        ctx.fillRect(x + 4, sy - s.h + 5, s.w - 8, s.h - 12);
      }
      /* 挂架 */
      ctx.strokeStyle = 'rgba(9,13,17,0.62)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 3, sy - 2); ctx.lineTo(x + 3, sy - s.h + 4);
      ctx.moveTo(x + s.w - 3, sy - 2); ctx.lineTo(x + s.w - 3, sy - s.h + 4);
      ctx.stroke();
    }
  }
}

/* ---------------- 体积光 ----------------
   3~5 条斜向光柱，全部是预烘的光柱贴图 + 'lighter'。
   透明度锁在 0.03~0.07：只交代「空气里有光」，绝不参与明度竞争。 */
function drawGodRays(gy, th) {
  const img = th.cold ? scBeamCool : scBeamWarm;
  if (!img) return;                       /* 离屏不可用时整层跳过 */
  const bm = clamp(th.beamMul, 0, 1.6);
  if (bm < 0.06) return;
  const n = clamp(Math.round(3 + bm * 2), 3, 5);
  const span = VIEW_W + 620;
  const t = game.time;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    let bx = ((i * 0.31 + 0.08) * span + camera.x * 0.045 + t * 6.5) % span;
    if (bx < 0) bx += span;
    bx -= 310;
    const ang = -0.26 + Math.sin(t * 0.15 + i * 1.9) * 0.055;
    const w = 82 + ((i * 53) % 48);
    ctx.globalAlpha = clamp((0.030 + 0.040 * ((i * 0.37) % 1)) * clamp(bm, 0.45, 1.2), 0.02, 0.07);
    ctx.save();
    ctx.translate(bx, gy + 10);
    ctx.rotate(ang);
    ctx.drawImage(img, -w * 0.5, -640, w, 660);
    ctx.restore();
  }
  ctx.restore();
}

/* ---------------- 浮尘 ----------------
   位置完全由 game.time 推出来：不 new、不改对象、暂停就停在原地。
   横向按风向缓慢左移，所以不需要存速度以外的任何状态。 */
function drawDust(gy, th) {
  const t = game.time;
  const drift = camera.x * 0.58;
  const warmC = th.horA(1);
  for (let i = 0; i < scDust.length; i++) {
    const d = scDust[i];
    let x = (d.x - drift - t * d.sp) % SC_DUST_P;
    if (x < 0) x += SC_DUST_P;
    if (x > VIEW_W + 8) continue;
    const y = gy - 26 - d.y * 320 + Math.sin(t * 0.7 + d.ph) * 13;
    const tw = 0.55 + 0.45 * Math.sin(t * 1.6 + d.ph * 2.3);
    ctx.globalAlpha = d.a * tw;
    ctx.fillStyle = d.warm ? warmC : 'rgba(198,214,240,1)';
    ctx.fillRect(x, y, d.r, d.r);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- 近景框景（视差 1.12，比世界更快） ----------------
   只允许出现在屏幕左右两侧、地平线以下的画框带里；
   内侧边界有 12% 宽的渐隐带，剪影不会突然「跳」进画面。
   中央 60% 高度以上一律不画 —— 任何时候都不许挡玩家。 */
function drawNearFrame() {
  const gy = world.groundY;
  const off = -(camera.x * SC_NEAR_K) % SC_NEAR_P;
  const edge = VIEW_W * 0.27;      /* 内侧边界 */
  const band = VIEW_W * 0.12;      /* 渐隐宽度 */

  for (let rep = 0; rep < 2; rep++) {
    for (const pr of scNearProps) {
      const x = pr.x + off + rep * SC_NEAR_P;
      const cx = x + pr.w * 0.5;
      if (cx < -180 || cx > VIEW_W + 180) continue;

      /* 只在两侧：越靠画面边缘越实，越靠近中央越淡 */
      let k = 0;
      if (cx < edge) k = clamp((edge - cx) / band, 0, 1);
      else if (cx > VIEW_W - edge) k = clamp((cx - (VIEW_W - edge)) / band, 0, 1);
      if (k < 0.04) continue;

      const top = gy - pr.h;
      const bot = gy + 46;
      const sd = pr.seed * 13.7;

      ctx.globalAlpha = 0.52 * k;
      ctx.fillStyle = '#080b0e';
      if (pr.kind === 0) {
        /* 断墙：顶上是参差的爆破口 */
        ctx.beginPath();
        ctx.moveTo(x - 24, bot);
        ctx.lineTo(x - 24, top + 18 + hash01(sd + 1) * 10);
        ctx.lineTo(x + pr.w * 0.12, top + 4);
        ctx.lineTo(x + pr.w * 0.30, top + 12 + hash01(sd + 2) * 9);
        ctx.lineTo(x + pr.w * 0.52, top);
        ctx.lineTo(x + pr.w * 0.74, top + 14 + hash01(sd + 3) * 8);
        ctx.lineTo(x + pr.w, top + 6);
        ctx.lineTo(x + pr.w + 24, bot);
        ctx.closePath();
        ctx.fill();
      } else if (pr.kind === 1) {
        /* 钢筋束：断梁 + 几根弯钩，从地面斜插出来 */
        ctx.fillRect(x + pr.w * 0.2, top + 16, pr.w * 0.36, bot - top - 16);
        ctx.strokeStyle = '#080b0e';
        ctx.lineWidth = 3.2;
        for (let i = 0; i < 5; i++) {
          const bx = x + pr.w * 0.1 + i * (pr.w * 0.16);
          ctx.beginPath();
          ctx.moveTo(bx, bot);
          ctx.quadraticCurveTo(bx - 6, top + 10, bx + hash01(sd + i) * 22 - 11, top - 6 - hash01(sd + i * 2) * 16);
          ctx.stroke();
        }
      } else if (pr.kind === 2) {
        /* 沙袋堆：四层叠上去，越往上越窄 */
        for (let i = 0; i < 4; i++) {
          const bw = pr.w * (0.46 - i * 0.05);
          const bx = x + pr.w * 0.5 - bw * 0.5 + (hash01(sd + i * 3) - 0.5) * 12;
          ctx.beginPath();
          ctx.ellipse(bx + bw * 0.5, bot - 22 - i * 17, bw * 0.5, 12, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        /* 管线：一根大口径管 + 一个立起来的弯头 */
        ctx.fillRect(x - 20, top + 26, pr.w + 40, 26);
        ctx.fillRect(x + pr.w * 0.42, top - 6, 30, 40);
        ctx.beginPath();
        ctx.ellipse(x - 20, top + 39, 9, 13, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 顶缘一点冷光：剪影也要有「被月光扫到」的边，否则就是一块死黑 */
      if (pr.kind === 0 || pr.kind === 1 || pr.kind === 3) {
        ctx.globalAlpha = 0.18 * k;
        ctx.fillStyle = 'rgba(160,182,205,1)';
        ctx.fillRect(x - 20, top + (pr.kind === 3 ? 25 : 1), pr.w + 40, 1.6);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/* ---------------- 地面 ---------------- */
/* 地面在屏幕上只露出约 78px（VIEW_ZOOM 1.22 之后），
   所以顶缘高光 / 湿反光 / 土层这三层必须全部压在这 78px 里。 */
function drawGround() {
  const gy = world.groundY;
  const vw = VIEW_W + 60;
  const th = scTheme();

  /* 主体暗面：按主题缓存的竖向渐变，换关才重建 */
  const g = scGrad('ground|' + th.key, () => {
    const gg = ctx.createLinearGradient(0, gy - 2, 0, gy + 72);
    gg.addColorStop(0, scMix([109, 90, 68], th.warm, 0.26));
    gg.addColorStop(0.09, scMix([77, 63, 47], th.warm, 0.20));
    gg.addColorStop(0.30, scMix([54, 44, 34], th.warm, 0.13));
    gg.addColorStop(0.62, scMix([37, 30, 23], th.warm, 0.09));
    gg.addColorStop(1, '#0b0908');
    return gg;
  });
  ctx.fillStyle = g;
  ctx.fillRect(-30, gy - 2, vw, 110);

  /* 顶部 3px 边缘高光：受主题色影响，把地面和背景彻底剥开 */
  ctx.fillStyle = th.edge(0.52);
  ctx.fillRect(-30, gy - 3, vw, 3);
  /* 高光下方的一小截散射（土坎被照亮） */
  const bloom = scGrad('gbloom|' + th.key, () => {
    const gg = ctx.createLinearGradient(0, gy - 5, 0, gy + 30);
    gg.addColorStop(0, th.edge(0.18));
    gg.addColorStop(0.30, th.edge(0.06));
    gg.addColorStop(1, th.edge(0));
    return gg;
  });
  ctx.fillStyle = bloom;
  ctx.fillRect(-30, gy - 5, vw, 35);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-30, gy + 3.6, vw, 2.6);

  /* 湿反光：地表往下 58px 的一条竖渐变，横向被不规则亮斑打断，
     才像「一滩一滩积水」，而不是一层均匀的塑料膜 */
  const wet = scGrad('wet|' + th.key, () => {
    const gg = ctx.createLinearGradient(0, gy + 1, 0, gy + 58);
    gg.addColorStop(0, th.edge(0.13));
    gg.addColorStop(0.32, th.edge(0.065));
    gg.addColorStop(1, th.edge(0));
    return gg;
  });
  ctx.fillStyle = wet;
  ctx.fillRect(-30, gy + 1, vw, 58);

  const step = 74;
  const base = Math.floor(camera.x / step) * step;
  for (let wx = base - step; wx < camera.x + vw + step; wx += step) {
    const h1 = hash01(wx * 0.0173);
    const h2 = hash01(wx * 0.0311 + 5.1);
    if (h1 < 0.45) continue;                 /* 间隔不规则：有亮斑、有断口 */
    ctx.globalAlpha = 0.05 + h2 * 0.07;
    ctx.fillStyle = th.edge(1);
    ctx.fillRect(wx - camera.x + h2 * 46, gy + 2.2, 12 + h1 * 36, 1.6 + h1 * 2.4);
  }
  ctx.globalAlpha = 1;

  /* 土层横纹（跟着世界滚动，有压实土的感觉） */
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const ly = gy + 16 + i * 19;
    ctx.strokeStyle = 'rgba(0,0,0,' + (0.20 - i * 0.05) + ')';
    ctx.beginPath();
    ctx.moveTo(-30, ly);
    for (let x = 0; x < vw; x += 42) {
      const wx = camera.x + x;
      ctx.lineTo(x, ly + Math.sin((wx + i * 210) * 0.011) * 2.2);
    }
    ctx.stroke();
  }

  /* 碎石：顶端带一点高光，看起来是有体积的石子而不是色点 */
  for (const r of groundRocks) {
    const x = r.x - camera.x;
    if (x < -20 || x > vw + 20) continue;
    const y = gy + 5 + r.d * 54;
    ctx.globalAlpha = r.a * (1 - r.d * 0.45);
    ctx.fillStyle = '#cbb797';
    ctx.fillRect(x, y, r.r * 1.6, r.r * 0.85);
    ctx.fillStyle = th.edge(0.55);
    ctx.fillRect(x, y, r.r * 1.6, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y + r.r * 0.85, r.r * 1.6, 1.2);
  }
  ctx.globalAlpha = 1;

  /* 草簇 / 枯草 */
  for (const t of grassTufts) {
    const x = t.x - camera.x;
    if (x < -20 || x > vw + 20) continue;
    ctx.globalAlpha = t.a;
    ctx.strokeStyle = '#63744a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, gy - 1);
    ctx.quadraticCurveTo(x + t.lean * 0.4, gy - t.h * 0.6, x + t.lean, gy - t.h);
    ctx.moveTo(x + 3, gy - 1);
    ctx.quadraticCurveTo(x + 4 + t.lean * 0.3, gy - t.h * 0.5, x + 6 + t.lean, gy - t.h * 0.8);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160,175,120,' + (t.a * 0.5) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, gy - 1);
    ctx.quadraticCurveTo(x + t.lean * 0.4, gy - t.h * 0.6, x + t.lean, gy - t.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* 地面裂纹（确定性哈希，滚动不闪） */
  ctx.strokeStyle = 'rgba(0,0,0,0.34)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 26; k++) {
    const seed = (k * 137) % 997;
    const wx = (seed * 3.1) % 3400;
    const x = wx - (camera.x % 3400);
    const xx = x < -60 ? x + 3400 : x;
    if (xx < -60 || xx > vw + 60) continue;
    const y = gy + 7 + ((seed * 7) % 44);
    const len = 9 + (seed % 17);
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx + len * 0.55, y + 3);
    ctx.lineTo(xx + len, y - 1.5);
    ctx.stroke();
  }

  /* 铁轨碎片：几条压进土里的旧钢轨，锈迹 + 螺栓。
     和裂纹共用「固定种子 + 3400 周期」的写法，滚动不闪、不用随机数。 */
  for (let k = 0; k < 9; k++) {
    const seed = (k * 419 + 53) % 3400;
    const x0 = seed - (camera.x % 3400);
    const xx = x0 < -80 ? x0 + 3400 : x0;
    if (xx < -80 || xx > vw + 80) continue;
    const y = gy + 13 + ((seed * 11) % 38);
    const len = 34 + (seed % 46);
    ctx.fillStyle = 'rgba(24,20,16,0.92)';
    ctx.fillRect(xx, y, len, 4.5);
    ctx.fillStyle = 'rgba(154,106,64,0.30)';
    ctx.fillRect(xx, y, len, 1.4);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(xx, y + 4, len, 1.2);
    for (let b = 6; b < len - 4; b += 16) {
      ctx.fillStyle = 'rgba(178,184,190,0.20)';
      ctx.fillRect(xx + b, y + 1.6, 2, 2);
    }
  }

  /* 地面碎石堆：贴着地表线的深色石块，顶面接一点月光 */
  const st = Math.floor(camera.x / 96) * 96;
  for (let wx = st - 96; wx < camera.x + VIEW_W + 96; wx += 96) {
    const s = ((wx * 2654435761) >>> 0) % 1000 / 1000;
    const x = wx - camera.x + s * 40;
    const h = 7 + s * 13;
    ctx.fillStyle = '#191410';
    ctx.beginPath();
    ctx.moveTo(x - 26, gy + 3);
    ctx.quadraticCurveTo(x - 10, gy - h, x + 9, gy - h * 0.72);
    ctx.quadraticCurveTo(x + 24, gy - h * 0.4, x + 34, gy + 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,144,108,0.22)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - 26, gy + 2);
    ctx.quadraticCurveTo(x - 10, gy - h, x + 9, gy - h * 0.72);
    ctx.stroke();
  }
}

/* ---------------- 平台 ---------------- */
function platformShadow(p) {
  const cx = p.x + p.w / 2;
  const gy = surfaceBelow(cx, p.y + 6);
  if (gy <= p.y + 8) return;
  const spread = clamp(p.w * 0.55, 40, 180) * (1 + (gy - p.y) / 1100);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx - camera.x, gy - 3, spread, 7 + (gy - p.y) * 0.016, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* 一根立柱该有多长、柱脚是不是踩在实地上。
   不能直接拿 surfaceBelow() 的返回值减 —— 它在深渊上方返回的是
   groundY + FALL_DEPTH + 60 的假底（那是给手雷、补给掉进洞里用的），
   照它画就是两根三百多像素的钢柱从钢架一路穿进坑里，像一根插在坑口的棍子。
   柱脚踩在坑上时：柱子截到坑口再往上收一截，留一个断口 ——
   地面都被炸开了，这根支撑当然是断的，比一根钢柱笔直顶到坑沿可信得多。 */
function steelLeg(p, wx) {
  const legTop = p.y + p.h;
  const solid = groundAt(wx);
  const footY = solid ? surfaceBelow(wx, legTop + 2) : world.groundY;
  const trim = solid ? 0 : 13 + hash01(wx * 0.43) * 15;
  return { h: Math.max(0, footY - legTop - trim), broken: !solid };
}

/* 立柱 + 柱脚。broken 时柱底撕几个锯齿、补一条冷光当断口。 */
function drawSteelLeg(x, legTop, leg, seed) {
  if (leg.h <= 2) return;
  ctx.fillStyle = '#1b2128';
  ctx.fillRect(x, legTop, 8, leg.h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(x, legTop, 2, leg.h);
  if (!leg.broken) return;

  const b = legTop + leg.h;
  for (let k = 0; k < 3; k++) {
    const r = hash01(seed + k * 4.7);
    ctx.fillRect(x + k * 2.7, b, 2.5, 1.4 + r * 4.6);
  }
  ctx.fillStyle = 'rgba(158,186,206,0.26)';
  ctx.fillRect(x, b - 1.6, 8, 1.6);
}

function drawSteelPlatform(x, p) {
  const legTop = p.y + p.h;
  const legL = steelLeg(p, p.x + 17);
  const legR = steelLeg(p, p.x + p.w - 17);
  const legH = Math.max(legL.h, legR.h);

  /* 支撑立柱（两根各自落地，长短可以不一样） */
  if (legH > 4) {
    drawSteelLeg(x + 13, legTop, legL, p.x * 0.11);
    drawSteelLeg(x + p.w - 21, legTop, legR, p.x * 0.29 + 9);
    /* 斜撑 */
    ctx.strokeStyle = 'rgba(27,33,40,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 17, legTop + 2);
    ctx.lineTo(x + p.w - 17, legTop + Math.min(52, legH));
    ctx.stroke();
  }

  /* 主梁 */
  const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
  g.addColorStop(0, '#5b6874');
  g.addColorStop(0.18, '#414d58');
  g.addColorStop(0.75, '#2b343c');
  g.addColorStop(1, '#1a2127');
  ctx.fillStyle = g;
  ctx.fillRect(x, p.y, p.w, p.h);

  /* 顶面高光 */
  ctx.fillStyle = 'rgba(180,200,215,0.55)';
  ctx.fillRect(x, p.y, p.w, 2);
  /* 主题色再罩一档：火光 / 天光会反到钢梁上，换关时这里跟着变 */
  ctx.fillStyle = scTheme().edge(0.20);
  ctx.fillRect(x, p.y + 2, p.w, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, p.y + p.h - 3, p.w, 3);
  /* 梁底接触阴影：把平台「压」在空气里，浮着的感觉少一半 */
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x + 2, p.y + p.h, p.w - 4, 5);

  /* 黄黑警示条 */
  ctx.save();
  ctx.beginPath(); ctx.rect(x, p.y + 5, p.w, 5); ctx.clip();
  ctx.fillStyle = '#b89334';
  ctx.fillRect(x, p.y + 5, p.w, 5);
  ctx.fillStyle = '#1c2126';
  for (let i = -8; i < p.w + 8; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, p.y + 10);
    ctx.lineTo(x + i + 7, p.y + 5);
    ctx.lineTo(x + i + 14, p.y + 5);
    ctx.lineTo(x + i + 7, p.y + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* 铆钉 */
  ctx.fillStyle = 'rgba(190,205,220,0.4)';
  for (let i = 9; i < p.w - 4; i += 21) {
    ctx.beginPath(); ctx.arc(x + i, p.y + p.h - 6, 1.6, 0, Math.PI * 2); ctx.fill();
  }

  /* 护栏 */
  if (p.rail) {
    ctx.strokeStyle = '#252d35';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 3, p.y - 30); ctx.lineTo(x + p.w - 3, p.y - 30);
    ctx.moveTo(x + 3, p.y - 16); ctx.lineTo(x + p.w - 3, p.y - 16);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (let i = 3; i < p.w - 3; i += 26) {
      ctx.beginPath();
      ctx.moveTo(x + i, p.y - 32);
      ctx.lineTo(x + i, p.y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,215,230,0.18)';
    ctx.fillRect(x + 3, p.y - 31, p.w - 6, 1);
  }
}

function drawConcretePlatform(x, p) {
  /* 混凝土：冷灰调，带水渍、裂纹、破口与露筋 */
  const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
  g.addColorStop(0, '#8d959b');
  g.addColorStop(0.14, '#737b82');
  g.addColorStop(0.55, '#565e65');
  g.addColorStop(0.88, '#3c4349');
  g.addColorStop(1, '#2b3136');
  ctx.fillStyle = g;
  ctx.fillRect(x, p.y, p.w, p.h);

  /* 顶面：受天光，最亮 */
  ctx.fillStyle = 'rgba(206,218,228,0.75)';
  ctx.fillRect(x, p.y, p.w, 2);
  ctx.fillStyle = scTheme().edge(0.16);
  ctx.fillRect(x, p.y + 2, p.w, 1.5);
  ctx.fillStyle = 'rgba(120,134,146,0.5)';
  ctx.fillRect(x, p.y + 2, p.w, 1);

  /* 水渍 / 污痕（竖向淡淡的不规则条） */
  for (let i = 6; i < p.w - 6; i += 23) {
    const hh = 4 + ((i * 5 + p.x) % 9);
    ctx.fillStyle = 'rgba(24,28,32,' + (0.10 + ((i * 3) % 5) * 0.02) + ')';
    ctx.fillRect(x + i, p.y + 3, 3, Math.min(hh, p.h - 4));
  }

  /* 底部破损：不规则掉块 */
  ctx.fillStyle = '#1e2327';
  ctx.beginPath();
  ctx.moveTo(x, p.y + p.h);
  let bx = 0;
  while (bx < p.w) {
    const k = ((bx * 13 + p.x * 7) | 0) % 5;
    const d = k === 0 ? p.h * 0.42 : (k === 1 ? 4 : 1);
    ctx.lineTo(x + bx, p.y + p.h - d);
    bx += 9 + (k * 3);
    ctx.lineTo(x + Math.min(bx, p.w), p.y + p.h - (k === 0 ? p.h * 0.3 : 2));
  }
  ctx.lineTo(x + p.w, p.y + p.h);
  ctx.closePath();
  ctx.fill();

  /* 不规则裂缝：每段折线随机偏移 */
  ctx.strokeStyle = 'rgba(18,22,26,0.6)';
  ctx.lineWidth = 1.4;
  for (let i = 16; i < p.w - 10; i += 44) {
    ctx.beginPath();
    ctx.moveTo(x + i, p.y + 2);
    let cy2 = p.y + 2;
    let cxx = x + i;
    for (let s = 0; s < 3; s++) {
      cxx += ((i * 7 + s * 11) % 9) - 4;
      cy2 += p.h * 0.28;
      ctx.lineTo(cxx, cy2);
    }
    ctx.stroke();
  }

  /* 钢筋 */
  ctx.strokeStyle = 'rgba(146,96,66,0.75)';
  ctx.lineWidth = 1.8;
  for (let i = 22; i < p.w - 16; i += 58) {
    ctx.beginPath();
    ctx.moveTo(x + i, p.y + p.h - 2);
    ctx.lineTo(x + i + 5, p.y + p.h + 4);
    ctx.lineTo(x + i + 11, p.y + p.h + 7);
    ctx.stroke();
  }

  /* 侧面阴影收边 */
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(x, p.y + 3, 2.5, p.h - 3);
  ctx.fillRect(x + p.w - 2.5, p.y + 3, 2.5, p.h - 3);
}

function drawCratePlatform(x, p) {
  /* 木箱/集装箱平台 */
  const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
  g.addColorStop(0, '#8a6c45');
  g.addColorStop(0.2, '#6d5335');
  g.addColorStop(1, '#3f2f1e');
  ctx.fillStyle = g;
  ctx.fillRect(x, p.y, p.w, p.h);

  /* 木板竖纹 */
  ctx.strokeStyle = 'rgba(30,20,12,0.4)';
  ctx.lineWidth = 1;
  for (let i = 12; i < p.w; i += 17) {
    ctx.beginPath();
    ctx.moveTo(x + i, p.y + 2);
    ctx.lineTo(x + i, p.y + p.h - 2);
    ctx.stroke();
  }

  /* 铁包角 */
  ctx.fillStyle = '#4e5862';
  ctx.fillRect(x, p.y, 10, p.h);
  ctx.fillRect(x + p.w - 10, p.y, 10, p.h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x, p.y, 10, 2);
  ctx.fillRect(x + p.w - 10, p.y, 10, 2);

  /* 顶部铁皮 */
  ctx.fillStyle = 'rgba(200,180,140,0.5)';
  ctx.fillRect(x, p.y, p.w, 2);
  ctx.fillStyle = scTheme().edge(0.18);
  ctx.fillRect(x, p.y + 2, p.w, 1.5);

  /* 底部阴影：木箱贴地那一圈不压暗，就会读成「悬在半空」 */
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(x, p.y + p.h - 4, p.w, 4);
  ctx.fillRect(x + 3, p.y + p.h, p.w - 6, 4);

  /* 护栏 */
  if (p.rail) {
    ctx.strokeStyle = '#33261a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 4, p.y - 28); ctx.lineTo(x + p.w - 4, p.y - 28);
    ctx.stroke();
    for (let i = 5; i < p.w - 4; i += 30) {
      ctx.beginPath();
      ctx.moveTo(x + i, p.y - 29);
      ctx.lineTo(x + i, p.y);
      ctx.stroke();
    }
  }
}

/* ==================================================================
   深渊 / 上升气流 / 机关  —— 本轮新增的四类场景要素
   ================================================================== */

function drawPlatforms() {
  drawGround();
  drawPits();          /* 顺着地面挖掉一块 —— 必须在 drawGround 之后 */
  drawWinds();         /* 气流柱压在平台与士兵之下 */

  for (const p of world.platforms) {
    if (p.ground) continue;
    if (p.x - camera.x > VIEW_W + 160 || p.x + p.w - camera.x < -160) continue;
    platformShadow(p);
  }

  for (const p of world.platforms) {
    if (p.ground) continue;
    const x = p.x - camera.x;
    if (x > VIEW_W + 160 || x + p.w < -160) continue;
    if (p.mat === 'crate') drawCratePlatform(x, p);
    else if (p.mat === 'concrete') drawConcretePlatform(x, p);
    else drawSteelPlatform(x, p);
  }
}

/* ---------------- 深渊 ----------------
   地面被炸开的口子：上口窄、往下张、越深越黑，底噪用土块断面收边。
   画在 drawGround() 之后，等于顺着地面「挖」掉一块。 */
function drawPits() {
  const gy = world.groundY;
  const vw = VIEW_W + 80;

  for (let i = 0; i < world.pits.length; i++) {
    const p = world.pits[i];
    const x = p.x - camera.x;
    if (x > vw || x + p.w < -80) continue;

    const w = p.w;
    const deep = 240;
    const flare = Math.min(16, w * 0.11);      /* 上口比底口窄一点，像塌方 */

    /* 坑体：顶上是纯黑，往下彻底吞光 */
    const g = ctx.createLinearGradient(0, gy - 6, 0, gy + deep);
    g.addColorStop(0, '#0b0906');
    g.addColorStop(0.22, '#070605');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 3, gy - 4);
    ctx.lineTo(x + flare, gy + deep);
    ctx.lineTo(x + w - flare, gy + deep);
    ctx.lineTo(x + w + 3, gy - 4);
    ctx.closePath();
    ctx.fill();

    /* 近侧坑壁：只有最上面一小截吃得到光，再往下就是黑洞。
       屏幕里地面只露出 78px，这一层要是铺到 90px、还不透明，
       整块坑体就被洗成「一种浅褐色的土」——那就不是坑了。 */
    const wg = ctx.createLinearGradient(0, gy - 2, 0, gy + 40);
    wg.addColorStop(0, 'rgba(110,88,62,0.58)');
    wg.addColorStop(0.20, 'rgba(52,40,29,0.26)');
    wg.addColorStop(0.58, 'rgba(18,13,10,0.08)');
    wg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(x - 4, gy - 2, w + 8, 42);

    /* 越深越暗：这一层是「洞口和实地一眼能分开」的关键，
       单靠坑体本身的黑色会被上方土层的暖褐调拉近，看着还是地不是坑。 */
    const dg = ctx.createLinearGradient(0, gy + 6, 0, gy + 96);
    dg.addColorStop(0, 'rgba(0,0,0,0)');
    dg.addColorStop(0.55, 'rgba(0,0,0,0.62)');
    dg.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = dg;
    ctx.fillRect(x - 2, gy + 6, w + 4, 92);

    /* 断面岩层：只留最上面两层 —— 再深就看不清了，画了也是脏 */
    ctx.strokeStyle = 'rgba(126,102,74,0.30)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) {
      const ly = gy + 7 + k * 15;
      ctx.globalAlpha = 0.42 - k * 0.20;
      ctx.beginPath();
      ctx.moveTo(x - 2, ly);
      for (let sx = 0; sx <= w; sx += 12) {
        ctx.lineTo(x + sx, ly + Math.sin((p.x + sx + k * 37) * 0.09) * 2.4);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 掉进坑里的碎砖：卡在壁上，给一点「这里塌过」的实感 */
    for (let k = 0; k < 5; k++) {
      const r1 = hash01(p.x * 0.37 + k * 13.1);
      const r2 = hash01(p.x * 0.71 + k * 7.7);
      const bx = x + 8 + r1 * (w - 16);
      const by = gy + 9 + r2 * 46;
      const bw = 5 + r1 * 7;
      ctx.globalAlpha = 0.55 - r2 * 0.35;
      ctx.fillStyle = '#5c4a34';
      ctx.fillRect(bx, by, bw, bw * 0.62);
      ctx.fillStyle = 'rgba(190,166,126,0.35)';
      ctx.fillRect(bx, by, bw, 1);
      ctx.globalAlpha = 1;
    }

    /* 坑口断边：两侧的土块被打碎，边缘不齐才像炸出来的 */
    ctx.fillStyle = '#efe0bd';
    ctx.globalAlpha = 0.34;
    ctx.fillRect(x - 3, gy - 4, 3.2, 1.6);
    ctx.fillRect(x + w - 0.2, gy - 4, 3.2, 1.6);
    ctx.globalAlpha = 1;

    /* 坑口的暗影：一点点向坑内收，让「下面是空的」更有分量 */
    const eg = ctx.createLinearGradient(x, 0, x + w, 0);
    eg.addColorStop(0, 'rgba(0,0,0,0.55)');
    eg.addColorStop(0.5, 'rgba(0,0,0,0)');
    eg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = eg;
    ctx.fillRect(x - 3, gy - 4, w + 6, 10);

    /* 警示：坑口两侧插一小段红白警戒带（一眼就知道这儿不能踩） */
    const stripY = gy - 26;
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? x - 12 : x + w - 4;
      ctx.strokeStyle = '#3a3128';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sx, gy + 1);
      ctx.lineTo(sx, stripY);
      ctx.stroke();
      ctx.save();
      ctx.translate(sx, stripY);
      ctx.fillStyle = 'rgba(214,86,72,0.85)';
      ctx.fillRect(0, 0, (s === 0 ? 18 : -18), 5);
      ctx.fillStyle = 'rgba(232,224,206,0.85)';
      ctx.fillRect(0, 5, (s === 0 ? 18 : -18), 4);
      ctx.restore();
    }
  }
}

/* ---------------- 上升气流 ----------------
   一根淡蓝的柱子 + 往上跑的条纹 + 底部卷起来的尘土。
   画在平台之前、士兵之前，所以人站进去是「在气流里」，不是「贴在玻璃上」。 */
function drawWinds() {
  const gy = world.groundY;

  for (let i = 0; i < world.winds.length; i++) {
    const wd = world.winds[i];
    const x = wd.x - camera.x;
    if (x > VIEW_W + 140 || x + wd.w < -140) continue;

    const top = wd.top;
    const bot = wd.y + 2;
    const h = bot - top;

    /* 柱体：底部浓、顶部淡，边缘再收一层 */
    const g = ctx.createLinearGradient(0, bot, 0, top);
    g.addColorStop(0, 'rgba(158,208,255,0.20)');
    g.addColorStop(0.45, 'rgba(150,200,255,0.11)');
    g.addColorStop(1, 'rgba(196,228,255,0.015)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, wd.w, h);

    const eg = ctx.createLinearGradient(x, 0, x + wd.w, 0);
    eg.addColorStop(0, 'rgba(150,205,255,0.16)');
    eg.addColorStop(0.18, 'rgba(150,205,255,0)');
    eg.addColorStop(0.82, 'rgba(150,205,255,0)');
    eg.addColorStop(1, 'rgba(150,205,255,0.16)');
    ctx.fillStyle = eg;
    ctx.fillRect(x, top, wd.w, h);

    /* 上升条纹：每根独立相位，往上跑的同时轻微摆动 */
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#cfe6ff';
    for (let k = 0; k < 11; k++) {
      const seedA = hash01(i * 31.7 + k * 4.3);
      const seedB = hash01(i * 17.1 + k * 9.9);
      const spd = 170 + seedB * 170;
      const ph = (game.time * spd + seedA * h) % h;
      const sx = x + 7 + seedA * (wd.w - 14);
      const sy = bot - ph;
      const len = 14 + seedB * 30;
      const fade = Math.sin((ph / h) * Math.PI);
      ctx.globalAlpha = 0.10 + 0.34 * fade;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.sin(ph * 0.04 + k * 1.7) * 5, sy - len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 底部涡流：贴地的一圈被卷起来的尘土环 */
    const swirl = 0.5 + 0.5 * Math.sin(game.time * 3.4 + wd.phase);
    ctx.globalAlpha = 0.16 + 0.12 * swirl;
    ctx.fillStyle = '#d8e9ff';
    ctx.beginPath();
    ctx.ellipse(x + wd.w * 0.5, gy - 2, wd.w * 0.48, 7 + swirl * 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 地面风口的铁栅：两撇弧线就够，别抢戏 */
    ctx.strokeStyle = 'rgba(30,36,42,0.8)';
    ctx.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      const gx = x + (wd.w * k) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, gy - 1);
      ctx.lineTo(gx, gy - 6);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(176,198,220,0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 2, gy - 6);
    ctx.lineTo(x + wd.w - 2, gy - 6);
    ctx.stroke();
  }
}

/* ---------------- 机关底座：地刺 / 喷火口 ----------------
   只画「地面上的东西」，喷出来的火柱另画（要盖在人前面）。 */
function drawHazardBases() {
  const gy = world.groundY;

  for (let i = 0; i < world.hazards.length; i++) {
    const hz = world.hazards[i];
    const x = hz.x - camera.x;
    if (x > VIEW_W + 80 || x + hz.w < -80) continue;

    if (hz.kind === 'spike') {
      /* 钉刺板：一块锈铁底板 */
      ctx.fillStyle = '#241f1a';
      ctx.fillRect(x - 2, gy - 7, hz.w + 4, 8);
      ctx.fillStyle = 'rgba(140,118,90,0.5)';
      ctx.fillRect(x - 2, gy - 7, hz.w + 4, 1.2);

      /* 一枚枚三棱尖刺，按确定哈希错开高度与锈色 */
      const n = Math.max(3, Math.round(hz.w / 13));
      for (let k = 0; k < n; k++) {
        const r = hash01(hz.seed * 13.7 + k * 5.1);
        const sx = x + 4 + (k + 0.5) * ((hz.w - 8) / n);
        const sh = 11 + r * 6;
        /* 根部压在铁板阴影里、只有刺尖吃到光 —— 纯色填充会变成一排白锥子。
           一屏几十枚刺，每枚都建一条渐变太浪费：按亮锈/暗锈烘两条「单位渐变」
           （0→-1），每枚刺只做一次 translate + scale，色阶完全一致。 */
        const sg = scGrad(r > 0.55 ? 'spikeA' : 'spikeB', () => {
          const g = ctx.createLinearGradient(0, 0, 0, -1);
          g.addColorStop(0, '#332f2b');
          g.addColorStop(0.45, r > 0.55 ? '#6a6068' : '#5a5450');
          g.addColorStop(1, r > 0.55 ? '#a9b0b6' : '#8d8a84');
          return g;
        });
        ctx.save();
        ctx.translate(sx, gy - 5);
        ctx.scale(1, sh);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(-3.4, 0);
        ctx.lineTo(3.4, 0);
        ctx.lineTo(0.4, -1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        /* 暗描边：把刺从背景里切出来，不然一排刺会糊成一片灰 */
        ctx.beginPath();
        ctx.moveTo(sx - 3.4, gy - 5);
        ctx.lineTo(sx + 3.4, gy - 5);
        ctx.lineTo(sx + 0.4, gy - 5 - sh);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(10,8,6,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        /* 尖端高光：冷白的一小撇，尖刺才有金属感 */
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - 0.6, gy - 6);
        ctx.lineTo(sx + 0.3, gy - 5 - sh);
        ctx.stroke();
        /* 尖上一点暗红：扎过人 */
        if (r > 0.7) {
          ctx.fillStyle = 'rgba(150,34,30,0.85)';
          ctx.fillRect(sx - 1.2, gy - 6 - sh, 2.2, 2.2);
        }
      }
      continue;
    }

    /* 喷火口：地上一圈裂开的铁口 */
    const cx = x + hz.w * 0.5;
    const heat = hz.firing ? 1 : 0;
    ctx.fillStyle = '#17130f';
    ctx.beginPath();
    ctx.ellipse(cx, gy - 3, hz.w * 0.52, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = heat ? 'rgba(255,150,60,0.9)' : 'rgba(120,86,54,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, gy - 3, hz.w * 0.52, 8, 0, 0, Math.PI * 2);
    ctx.stroke();

    /* 口里的余烬：预热阶段会亮起来，是「马上要喷」的第二个信号 */
    const warm = hz.firing ? 1 : clamp((hz.t - (hz.period - (hz.warn || 1.0) - 0.62)) / Math.max(0.01, (hz.warn || 1.0) + 0.62), 0, 1);
    if (warm > 0.02) {
      if (scGlowWarm) {
        /* 预烘暖光球压扁成椭圆，替掉每口每帧一条径向渐变 */
        const ew = hz.w * 1.5;
        ctx.globalAlpha = 0.45 + 0.45 * warm;
        ctx.save();
        ctx.translate(cx, gy - 4);
        ctx.scale(1, 22 / ew);
        ctx.drawImage(scGlowWarm, -ew * 0.5, -ew * 0.5, ew, ew);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        const em = ctx.createRadialGradient(cx, gy - 5, 1, cx, gy - 5, hz.w * 0.6);
        em.addColorStop(0, 'rgba(255,196,110,' + (0.35 + 0.5 * warm) + ')');
        em.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = em;
        ctx.beginPath();
        ctx.ellipse(cx, gy - 4, hz.w * 0.62, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    /* 铁篦子：几道竖条压在口上 */
    ctx.strokeStyle = 'rgba(52,58,64,0.85)';
    ctx.lineWidth = 2.2;
    for (let k = 1; k < 4; k++) {
      const gx = x + (hz.w * k) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, gy - 9);
      ctx.lineTo(gx, gy + 2);
      ctx.stroke();
    }
  }
}

/* ---------------- 火柱：盖在士兵前面 ----------------
   火是「糊在镜头上」的东西，画在人之后才有被吞进火里的感觉。 */
function drawHazardFire() {
  const gy = world.groundY;

  for (let i = 0; i < world.hazards.length; i++) {
    const hz = world.hazards[i];
    if (hz.kind !== 'flame' || !hz.firing) continue;
    const x = hz.x - camera.x;
    if (x > VIEW_W + 160 || x + hz.w < -160) continue;

    const cx = x + hz.w * 0.5;
    const h = hz.h * (0.86 + 0.14 * Math.sin(game.time * 26 + hz.seed));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    /* 主火柱：三层从宽到窄、从橙到亮黄 */
    for (let k = 0; k < 3; k++) {
      const wRatio = 1 - k * 0.30;
      const hRatio = 1 - k * 0.18;
      const g = ctx.createLinearGradient(0, gy, 0, gy - h * hRatio);
      if (k === 0) {
        g.addColorStop(0, 'rgba(120,36,10,0.75)');
        g.addColorStop(0.4, 'rgba(255,110,32,0.62)');
        g.addColorStop(1, 'rgba(255,180,60,0)');
      } else if (k === 1) {
        g.addColorStop(0, 'rgba(255,140,40,0.72)');
        g.addColorStop(0.45, 'rgba(255,196,86,0.58)');
        g.addColorStop(1, 'rgba(255,244,190,0)');
      } else {
        g.addColorStop(0, 'rgba(255,226,150,0.75)');
        g.addColorStop(0.5, 'rgba(255,248,220,0.42)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
      }
      ctx.fillStyle = g;
      const bw = hz.w * 0.5 * wRatio;
      ctx.beginPath();
      ctx.moveTo(cx - bw, gy);
      /* 左右各走一段带摆动的曲线，火苗才有舌头 */
      for (let s = 1; s <= 4; s++) {
        const ty = gy - (h * hRatio * s) / 4;
        const sway = Math.sin(game.time * 15 + s * 2.1 + hz.seed) * (4 + s * 3.5);
        ctx.lineTo(cx - bw * (1 - s * 0.16) + sway - 4, ty);
      }
      for (let s = 4; s >= 1; s--) {
        const ty = gy - (h * hRatio * s) / 4;
        const sway = Math.sin(game.time * 15 + s * 1.7 + hz.seed + 2) * (4 + s * 3.5);
        ctx.lineTo(cx + bw * (1 - s * 0.16) + sway + 4, ty);
      }
      ctx.lineTo(cx + bw, gy);
      ctx.closePath();
      ctx.fill();
    }

    /* 地面光斑：火柱脚下的一圈橙光 */
    const gl = ctx.createRadialGradient(cx, gy - 6, 2, cx, gy - 6, hz.w * 1.5);
    gl.addColorStop(0, 'rgba(255,170,70,0.40)');
    gl.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.ellipse(cx, gy - 6, hz.w * 1.5, 26, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/* ---------------- 沙袋掩体 ---------------- */
function drawCovers() {
  for (const c of world.covers) {
    const x = c.x - camera.x;
    if (x > VIEW_W + 130 || x + c.w < -130) continue;

    if (c.hp <= 0) {
      ctx.fillStyle = 'rgba(110,94,66,0.55)';
      ctx.fillRect(x + 4, c.y - 10, c.w - 8, 10);
      ctx.fillStyle = 'rgba(150,130,92,0.35)';
      ctx.fillRect(x + 14, c.y - 16, 18, 7);
      continue;
    }

    const dmg = 1 - c.hp / c.maxHp;
    const hitFlash = c.hit > 0 ? 0.5 : 0;
    const rows = 3, perRow = 4;
    const badW = c.w / perRow, badH = c.h / rows;

    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (badW * 0.5);
      for (let i = -1; i < perRow + 1; i++) {
        const bx = x + i * badW + offset;
        if (bx + badW < x - 4 || bx > x + c.w + 4) continue;
        /* 被打坏的沙袋缺失 */
        if (dmg > 0.55 && ((i * 3 + r * 5) % 7) < 2) continue;

        const by = c.y - (r + 1) * badH;
        const w = badW - 2, h = badH - 1.5;
        const shade = 0.72 + (r * 0.06) + (i % 2) * 0.04 - dmg * 0.18;

        ctx.fillStyle = 'rgb(' + Math.round(150 * shade) + ',' + Math.round(132 * shade) + ',' + Math.round(95 * shade) + ')';
        roundRect(bx, by, w, h, 4);
        ctx.fill();
        /* 顶部亮边 */
        ctx.fillStyle = 'rgba(226,210,172,' + (0.28 + hitFlash * 0.3) + ')';
        roundRect(bx + 1, by + 1, w - 2, 3, 2);
        ctx.fill();
        /* 缝线 */
        ctx.strokeStyle = 'rgba(70,58,38,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + w * 0.5, by + 3);
        ctx.lineTo(bx + w * 0.5, by + h - 2);
        ctx.stroke();
      }
    }
    /* 受损提示 */
    if (dmg > 0.35) {
      ctx.strokeStyle = 'rgba(255,120,70,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + c.w * 0.3, c.y - c.h);
      ctx.lineTo(x + c.w * 0.42, c.y - c.h * 0.5);
      ctx.stroke();
    }
  }
}

/* ---------------- 实体障碍 ----------------
   木箱 / 油桶 / 混凝土路障 / 集装箱：挡人、挡弹、能站上去
   -------------------------------------------- */
function drawBlocks() {
  for (const b of world.blocks) {
    const x = b.x - camera.x;
    if (x > W + 200 || x + b.w < -200) continue;

    /* 落地阴影 */
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x + b.w / 2, b.y + b.h + 3, b.w * 0.55, Math.min(10, b.h * 0.2), 0, 0, Math.PI * 2);
    ctx.fill();

    if (b.hp <= 0) { drawBlockDebris(x, b); continue; }

    const flash = b.hit > 0 ? Math.min(1, b.hit / 0.14) * 0.45 : 0;
    if (b.kind === 'crate') drawCrateBlock(x, b, flash);
    else if (b.kind === 'barrel') drawBarrelBlock(x, b, flash);
    else if (b.kind === 'container') drawContainerBlock(x, b, flash);
    else if (b.kind === 'rubblewall') drawRubbleWall(x, b, flash);
    else if (b.kind === 'wire') drawWire(x, b, flash);
    else drawBarrierBlock(x, b, flash);
  }
}

/* 半塌砖墙：一整面硬掩体，顶缘参差、砖缝透光、底部堆着掉下来的碎砖 */
function drawRubbleWall(x, b, flash) {
  const w = b.w, h = b.h, top = b.y;
  const seed = (b.x | 0) * 0.017;

  /* 墙体本体 */
  const g = ctx.createLinearGradient(0, top, 0, top + h);
  g.addColorStop(0, '#5d5951');
  g.addColorStop(0.5, '#4a463f');
  g.addColorStop(1, '#332f2a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, top + h);
  ctx.lineTo(x, top + 7);
  /* 顶缘：随机齿状的塌口 */
  const steps = Math.max(3, Math.round(w / 16));
  for (let i = 0; i <= steps; i++) {
    const px = x + (w * i) / steps;
    const py = top + 4 + Math.sin(seed + i * 2.3) * 3 + (hash01(seed * 13 + i) * 8);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x + w, top + h);
  ctx.closePath();
  ctx.fill();

  /* 砖缝：错缝排列的半透暗线 */
  ctx.strokeStyle = 'rgba(20,17,14,0.34)';
  ctx.lineWidth = 1;
  for (let ry = top + 15, row = 0; ry < top + h - 4; ry += 11, row++) {
    ctx.beginPath();
    ctx.moveTo(x + 1, ry);
    ctx.lineTo(x + w - 1, ry);
    ctx.stroke();
    for (let cx2 = x + (row % 2 ? 7 : 16); cx2 < x + w - 4; cx2 += 21) {
      ctx.beginPath();
      ctx.moveTo(cx2, ry);
      ctx.lineTo(cx2, ry + 11);
      ctx.stroke();
    }
  }

  /* 透光的弹孔 */
  for (let i = 0; i < 4; i++) {
    const hx = x + 10 + hash01(seed * 7 + i) * (w - 20);
    const hy = top + 14 + hash01(seed * 11 + i) * (h - 26);
    ctx.fillStyle = 'rgba(255,180,110,0.16)';
    ctx.beginPath(); ctx.arc(hx, hy, 1.8 + hash01(i + seed) * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(hx + 1, hy + 1, 1.4, 0, Math.PI * 2); ctx.fill();
  }

  /* 顶部受光边 + 掉下来的碎砖 */
  ctx.fillStyle = 'rgba(190,186,170,0.18)';
  ctx.fillRect(x, top + 5, w, 1.6);
  for (let i = 0; i < 5; i++) {
    const dx2 = x + hash01(seed * 3 + i * 5) * w;
    const dy2 = top + h - 2 - hash01(seed * 5 + i) * 5;
    const dw = 6 + hash01(i + seed * 2) * 7;
    ctx.fillStyle = i % 2 ? '#575349' : '#66615540';
    ctx.fillRect(dx2, dy2, dw, 4);
  }

  if (flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + flash.toFixed(3) + ')';
    ctx.fillRect(x, top, w, h);
  }
}

/* 铁丝网：两根立柱拉起的菱形网格，后面能看见、但子弹和人都过不去 */
function drawWire(x, b, flash) {
  const w = b.w, h = b.h, top = b.y;
  const px1 = x + 3, px2 = x + w - 3;

  /* 立柱 */
  ctx.fillStyle = '#3a3d40';
  ctx.fillRect(px1 - 2.5, top - 4, 5, h + 4);
  ctx.fillRect(px2 - 2.5, top - 4, 5, h + 4);
  ctx.fillStyle = 'rgba(180,190,200,0.16)';
  ctx.fillRect(px1 - 2.5, top - 4, 1.6, h + 4);
  ctx.fillRect(px2 - 2.5, top - 4, 1.6, h + 4);

  /* 菱形网：先横后斜，细线 + 极低透明度，读起来是「网」不是「墙」 */
  ctx.strokeStyle = 'rgba(196,206,214,0.30)';
  ctx.lineWidth = 1;
  const span = px2 - px1;
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const yy = top + (h * i) / 12;
    ctx.moveTo(px1, yy);
    ctx.lineTo(px2, yy);
  }
  for (let i = -h; i < span + h; i += 14) {
    ctx.moveTo(px1 + i, top);
    ctx.lineTo(px1 + i + h, top + h);
    ctx.moveTo(px1 + i, top);
    ctx.lineTo(px1 + i - h, top + h);
  }
  ctx.stroke();

  /* 顶上一道带刺的横杆 */
  ctx.strokeStyle = 'rgba(150,158,166,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(px1 - 3, top - 3); ctx.lineTo(px2 + 3, top - 3); ctx.stroke();
  for (let cx2 = px1 - 2; cx2 < px2 + 3; cx2 += 6) {
    ctx.beginPath();
    ctx.moveTo(cx2, top - 5); ctx.lineTo(cx2 + 3, top - 1);
    ctx.stroke();
  }

  if (flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.5).toFixed(3) + ')';
    ctx.fillRect(x, top, w, h);
  }
}

/* 被打爆之后的残骸 */
function drawBlockDebris(x, b) {
  const cx = x + b.w / 2, by = b.y + b.h;
  if (b.kind === 'barrel') {
    /* 油桶：只留焦痕和几片铁皮 */
    ctx.fillStyle = 'rgba(10,8,6,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx, by - 2, b.w * 0.85, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,44,34,0.9)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 13;
      ctx.save();
      ctx.translate(cx + ox, by - 3);
      ctx.rotate((hash01(i + b.x | 0) - 0.5) * 1.4);
      ctx.beginPath();
      ctx.moveTo(-7, 0); ctx.lineTo(7, -2);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  /* 木箱：散落的木板 */
  for (let i = 0; i < 5; i++) {
    const ox = (hash01(i * 7 + (b.x | 0)) - 0.5) * b.w * 1.1;
    const oy = -2 - hash01(i * 3 + 5) * 7;
    ctx.save();
    ctx.translate(cx + ox, by + oy);
    ctx.rotate((hash01(i * 11 + 2) - 0.5) * 0.9);
    ctx.fillStyle = i % 2 ? '#5a432a' : '#6b5132';
    ctx.fillRect(-11, -3, 22, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-11, 1, 22, 2);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(12,9,6,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, by - 1, b.w * 0.7, 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* 木箱：木板 + 铁包角 + 军用印字 */
function drawCrateBlock(x, b, flash) {
  const w = b.w, h = b.h, dmg = 1 - b.hp / b.maxHp;
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + h);
  g.addColorStop(0, '#8a6a44');
  g.addColorStop(0.45, '#775934');
  g.addColorStop(1, '#4b3720');
  ctx.fillStyle = g;
  ctx.fillRect(x, b.y, w, h);

  /* 木板缝 */
  ctx.strokeStyle = 'rgba(36,24,13,0.52)';
  ctx.lineWidth = 1.3;
  for (let i = 1; i < 4; i++) {
    const yy = b.y + (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x + 1, yy);
    ctx.lineTo(x + w - 1, yy);
    ctx.stroke();
  }
  /* 木纹：几条不规则弧线，避免死板 */
  ctx.strokeStyle = 'rgba(124,94,58,0.32)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const yy = b.y + 7 + i * (h - 14) / 5;
    ctx.beginPath();
    ctx.moveTo(x + 5, yy);
    ctx.bezierCurveTo(x + w * 0.32, yy - 2.2, x + w * 0.66, yy + 2.2, x + w - 5, yy);
    ctx.stroke();
  }

  /* 铁包角 */
  const s = Math.min(12, w * 0.19);
  const corners = [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]];
  for (let i = 0; i < 4; i++) {
    const ox = corners[i][0], oy = corners[i][1];
    ctx.fillStyle = '#3b3e42';
    ctx.fillRect(x + ox, b.y + oy, s, s);
    ctx.fillStyle = 'rgba(190,196,204,0.16)';
    ctx.fillRect(x + ox, b.y + oy, s, 1.6);
    /* 铆钉 */
    ctx.fillStyle = 'rgba(200,206,214,0.34)';
    ctx.beginPath();
    ctx.arc(x + ox + s * 0.5, b.y + oy + s * 0.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 军需印字 */
  if (w > 44) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#e8dcc0';
    ctx.font = 'bold 8px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('军需', x + w / 2, b.y + h * 0.56);
    ctx.fillRect(x + w * 0.24, b.y + h * 0.62, w * 0.52, 1.4);
    ctx.restore();
  }

  /* 顶面高光 */
  ctx.fillStyle = 'rgba(226,200,158,0.22)';
  ctx.fillRect(x, b.y, w, 2.6);

  /* 裂纹 */
  if (dmg > 0.25) {
    ctx.strokeStyle = 'rgba(18,11,5,' + (0.28 + dmg * 0.5).toFixed(2) + ')';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.28, b.y + 2);
    ctx.lineTo(x + w * 0.42, b.y + h * 0.42);
    ctx.lineTo(x + w * 0.33, b.y + h * 0.72);
    ctx.lineTo(x + w * 0.5, b.y + h);
    ctx.stroke();
  }
  if (flash > 0) {
    ctx.fillStyle = 'rgba(255,238,196,' + flash.toFixed(2) + ')';
    ctx.fillRect(x, b.y, w, h);
  }
}

/* 油桶：锈红桶身 + 双箍 + 警示标 */
function drawBarrelBlock(x, b, flash) {
  const w = b.w, h = b.h, dmg = 1 - b.hp / b.maxHp;
  const cx = x + w / 2;

  const rg = ctx.createLinearGradient(x, 0, x + w, 0);
  rg.addColorStop(0, '#4e2419');
  rg.addColorStop(0.26, '#a0432c');
  rg.addColorStop(0.58, '#8c3826');
  rg.addColorStop(1, '#46211a');
  ctx.fillStyle = rg;
  ctx.fillRect(x, b.y + 4, w, h - 4);

  /* 顶盖 */
  ctx.fillStyle = '#6f3120';
  ctx.beginPath();
  ctx.ellipse(cx, b.y + 4.5, w / 2, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9c452c';
  ctx.beginPath();
  ctx.ellipse(cx, b.y + 3.6, w / 2 - 3.2, 3.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,220,180,0.14)';
  ctx.beginPath();
  ctx.ellipse(cx - 3, b.y + 3, 6, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  /* 两道箍 */
  for (let i = 0; i < 2; i++) {
    const yy = b.y + h * (0.3 + i * 0.38);
    ctx.fillStyle = 'rgba(26,15,10,0.5)';
    ctx.fillRect(x, yy, w, 3.6);
    ctx.fillStyle = 'rgba(226,170,116,0.2)';
    ctx.fillRect(x, yy, w, 1.1);
  }

  /* 侧面高光 + 背光边 */
  ctx.fillStyle = 'rgba(255,196,150,0.1)';
  ctx.fillRect(x + w * 0.16, b.y + 6, 3.4, h - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + w * 0.84, b.y + 6, w * 0.16, h - 10);

  /* 警示标：黑黄斜纹块 */
  const wy = b.y + h * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 5, wy - 7, w - 10, 14);
  ctx.clip();
  ctx.fillStyle = '#d8b13c';
  ctx.fillRect(x + 5, wy - 7, w - 10, 14);
  ctx.fillStyle = '#1c1710';
  for (let i = -1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 5 + i * 8, wy + 7);
    ctx.lineTo(x + 5 + i * 8 + 4, wy + 7);
    ctx.lineTo(x + 5 + i * 8 + 11, wy - 7);
    ctx.lineTo(x + 5 + i * 8 + 7, wy - 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* 凹陷 / 漏液 */
  if (dmg > 0.35) {
    ctx.strokeStyle = 'rgba(30,16,10,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x + w * 0.62, b.y + h * 0.22, 6, 0.4, 2.9);
    ctx.stroke();
    ctx.fillStyle = 'rgba(16,12,8,' + (0.18 + dmg * 0.3).toFixed(2) + ')';
    ctx.fillRect(x + w * 0.1, b.y + h - 12, w * 0.3, 12);
  }
  if (flash > 0) {
    ctx.fillStyle = 'rgba(255,190,140,' + flash.toFixed(2) + ')';
    ctx.fillRect(x, b.y, w, h);
  }
}

/* 混凝土路障：梯形台身 + 黄黑警示条 + 反光片 */
function drawBarrierBlock(x, b, flash) {
  const w = b.w, h = b.h;
  const base = b.y + h, top = b.y, inset = w * 0.1;

  ctx.beginPath();
  ctx.moveTo(x + inset, top);
  ctx.lineTo(x + w - inset, top);
  ctx.lineTo(x + w, base);
  ctx.lineTo(x, base);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, top, 0, base);
  g.addColorStop(0, '#8e8b81');
  g.addColorStop(0.55, '#6f6c63');
  g.addColorStop(1, '#4a483f');
  ctx.fillStyle = g;
  ctx.fill();

  /* 顶面窄亮边 */
  ctx.fillStyle = 'rgba(206,202,190,0.4)';
  ctx.fillRect(x + inset, top, w - inset * 2, 2.4);

  /* 黄黑警示条 */
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + inset + 2, top + 6, w - inset * 2 - 4, 9);
  ctx.clip();
  ctx.fillStyle = '#d8b13c';
  ctx.fillRect(x, top + 6, w, 9);
  ctx.fillStyle = '#221d14';
  for (let i = -1; i < 22; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 11, top + 15);
    ctx.lineTo(x + i * 11 + 5, top + 15);
    ctx.lineTo(x + i * 11 + 14, top + 6);
    ctx.lineTo(x + i * 11 + 9, top + 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* 底部脏污 + 反光片 */
  ctx.fillStyle = 'rgba(26,22,16,0.3)';
  ctx.fillRect(x + 3, base - 5, w - 6, 5);
  ctx.fillStyle = 'rgba(255,120,60,0.34)';
  ctx.fillRect(x + w * 0.18, top + h * 0.55, 5, 4);
  ctx.fillRect(x + w * 0.78, top + h * 0.55, 5, 4);

  if (flash > 0) {
    ctx.fillStyle = 'rgba(255,244,214,' + (flash * 0.8).toFixed(2) + ')';
    ctx.fillRect(x, top, w, h);
  }
}

/* 集装箱：竖向波纹铁皮 + 锈迹 + 门闩 */
function drawContainerBlock(x, b, flash) {
  const w = b.w, h = b.h;
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + h);
  g.addColorStop(0, '#3f5560');
  g.addColorStop(0.4, '#34474f');
  g.addColorStop(1, '#1f2c31');
  ctx.fillStyle = g;
  ctx.fillRect(x, b.y, w, h);

  /* 波纹：每 9px 一条，用明暗两笔 */
  for (let i = 0; i < w; i += 9) {
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(x + i, b.y + 3, 3, h - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x + i + 4.5, b.y + 3, 2, h - 6);
  }

  /* 顶部与底部的加强梁 */
  ctx.fillStyle = 'rgba(150,170,180,0.16)';
  ctx.fillRect(x, b.y, w, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.fillRect(x, b.y + h - 6, w, 6);

  /* 右侧双开门 + 门闩 */
  const dx = x + w - 46;
  ctx.strokeStyle = 'rgba(12,18,20,0.6)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(dx, b.y + 4);
  ctx.lineTo(dx, b.y + h - 6);
  ctx.moveTo(dx + 23, b.y + 4);
  ctx.lineTo(dx + 23, b.y + h - 6);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(176,150,96,0.6)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(dx - 7, b.y + 12);
  ctx.lineTo(dx - 7, b.y + h - 16);
  ctx.moveTo(dx + 32, b.y + 12);
  ctx.lineTo(dx + 32, b.y + h - 16);
  ctx.stroke();

  /* 锈迹：从顶部往下拖 */
  for (let i = 0; i < 5; i++) {
    const rx = x + 12 + hash01(i * 13 + (b.x | 0)) * (w - 30);
    const rh = 10 + hash01(i * 7 + 3) * 34;
    const rg2 = ctx.createLinearGradient(0, b.y + 4, 0, b.y + 4 + rh);
    rg2.addColorStop(0, 'rgba(126,72,38,0.34)');
    rg2.addColorStop(1, 'rgba(126,72,38,0)');
    ctx.fillStyle = rg2;
    ctx.fillRect(rx, b.y + 4, 2.4 + hash01(i + 9) * 3, rh);
  }

  /* 编号喷漆 */
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#e6dfc8';
  ctx.font = 'bold 11px Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('CT-' + (100 + Math.floor(hash01((b.x | 0) + 1) * 899)), x + 12, b.y + h * 0.55);
  ctx.restore();

  if (flash > 0) {
    ctx.fillStyle = 'rgba(210,230,255,' + (flash * 0.7).toFixed(2) + ')';
    ctx.fillRect(x, b.y, w, h);
  }
}

/* ---------------- 场景装饰 ---------------- */
function drawProps() {
  for (const pr of world.props) {
    /* 装饰件不能长在深渊正上方：路灯立在空中、碎石浮在洞口，
       都会把「这儿是个坑」的画面语言直接打散 */
    if (!groundAt(pr.x)) continue;
    const x = pr.x - camera.x;
    if (x < -120 || x > W + 120) continue;
    const sd = pr.seed || 1;
    if (pr.kind === 'barrel') {
      ctx.fillStyle = '#4a3a24';
      ctx.fillRect(x, pr.y - 44, 26, 44);
      ctx.fillStyle = '#5c492c';
      ctx.fillRect(x, pr.y - 44, 26, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, pr.y - 26, 26, 4);
      ctx.fillRect(x, pr.y - 12, 26, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 3, pr.y - 42, 3, 40);
    } else if (pr.kind === 'crate') {
      ctx.fillStyle = '#5b452c';
      ctx.fillRect(x, pr.y - 30, 34, 30);
      ctx.strokeStyle = 'rgba(24,16,10,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 2, pr.y - 28); ctx.lineTo(x + 32, pr.y - 2);
      ctx.moveTo(x + 32, pr.y - 28); ctx.lineTo(x + 2, pr.y - 2);
      ctx.stroke();
      ctx.strokeRect(x + 1, pr.y - 29, 32, 28);
    } else if (pr.kind === 'rubble') {
      /* 碎石堆：几块大小不一的混凝土块 + 钢筋，纯装饰不挡人 */
      const n = 3 + (sd % 3);
      for (let i = 0; i < n; i++) {
        const ox = (hash01(sd * 7 + i * 5) - 0.5) * 34;
        const sz = 5 + hash01(sd * 11 + i * 3) * 8;
        const oy = -sz * 0.5 - hash01(sd * 3 + i) * 3;
        ctx.fillStyle = i % 2 ? '#585349' : '#6a655a';
        ctx.beginPath();
        ctx.moveTo(x + ox, pr.y + oy);
        ctx.lineTo(x + ox + sz, pr.y + oy - sz * 0.5);
        ctx.lineTo(x + ox + sz * 1.1, pr.y + oy + sz * 0.4);
        ctx.lineTo(x + ox + sz * 0.2, pr.y + oy + sz * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(190,184,170,0.16)';
        ctx.fillRect(x + ox + 1, pr.y + oy - sz * 0.4, sz * 0.7, 1.2);
      }
      ctx.strokeStyle = 'rgba(96,74,54,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - 8, pr.y - 2);
      ctx.lineTo(x + 2, pr.y - 9);
      ctx.lineTo(x + 12, pr.y - 4);
      ctx.stroke();
    } else {
      /* 路灯：弯臂 + 灯泡，投下暖光 */
      const hgt = 150;
      ctx.strokeStyle = '#22282e';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, pr.y);
      ctx.lineTo(x, pr.y - hgt);
      ctx.quadraticCurveTo(x, pr.y - hgt - 16, x + 26, pr.y - hgt - 16);
      ctx.stroke();
      const lx = x + 26, ly = pr.y - hgt - 12;
      if (scGlowWarm) {
        /* 灯罩光晕用预烘暖光球，一盏灯一条 drawImage 就够 */
        ctx.globalAlpha = 0.46;
        ctx.drawImage(scGlowWarm, lx - 66, ly - 66, 132, 132);
        ctx.globalAlpha = 1;
      } else {
        const lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, 130);
        lg.addColorStop(0, 'rgba(255,214,140,0.42)');
        lg.addColorStop(0.4, 'rgba(255,190,110,0.10)');
        lg.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, ly, 130, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffd98a';
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* ---------------- 地面痕迹 ---------------- */
function drawDecals() {
  for (const d of decals) {
    const x = d.x - camera.x;
    if (x < -40 || x > W + 40) continue;
    const a = clamp(d.life / d.max, 0, 1);
    if (d.kind === 'hole') {
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = '#0c0a08';
      ctx.beginPath(); ctx.arc(x, d.y + 3, d.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = '#b8a88c';
      ctx.beginPath(); ctx.arc(x, d.y + 3, d.r * 2.1, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = a * 0.42;
      ctx.fillStyle = '#7d1f1f';
      ctx.beginPath();
      ctx.ellipse(x, d.y + 2, d.r * 1.5, d.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  /* 近景框景：画在所有世界元素之后，才有「从掩体后方看出去」的纵深。
     它自己保证只在左右两侧、地平线以下出现。 */
  drawNearFrame();
}

/* ---------------- 主题调色 ----------------
   三关共用一套夜景素材，靠这一层把冷蓝（街区）/ 焦橙（废墟）/ 青绿（指挥部）
   分开。用 overlay 混合只推色相不动亮度，角色颜色不会被洗掉。
   ---------------------------------------------------- */
function drawThemeGrade() {
  const th = world.theme;
  if (!th || !th.grade) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = th.grade;
  ctx.fillRect(0, 0, W, H);

  /* 顶部再压一点同色雾，把地平线以上统一色调（按 grade 字符串缓存） */
  const g = scGrad('grade|' + th.grade, () => {
    const gg = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    const base = th.grade.replace(/[\d.]+\)$/, '');
    gg.addColorStop(0, base + '0.10)');
    gg.addColorStop(1, base + '0)');
    return gg;
  });
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.62);
  ctx.restore();
}

/* ---------------- 后处理：暗角 / 颗粒 / 受击红叠 ----------------
   全部在屏幕坐标里做，且在 drawHUD() 之前 —— HUD 永远是清晰的。
   暗角渐变按 W/H 缓存；颗粒是一张 256×256 的离屏噪点图案；
   红叠读 game.hurtFx（A 纵队落地前该字段不存在，必须守卫）。
   -------------------------------------------------------------- */
function drawVignette() {
  const vg = scGrad('vig|' + W + 'x' + H, () => {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.34, W * 0.5, H * 0.5, H * 0.98);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    return g;
  });
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  /* 颗粒：20Hz 换偏移（约每 3 帧一次），alpha 压到 0.032，
     只在暗部「沙沙」响一下，不会把画面糊成电视雪花 */
  if (scNoiseOn && scNoisePat) {
    const fi = Math.floor(game.time * 20);
    const ox = (hash01(fi * 1.7) * 256) | 0;
    const oy = (hash01(fi * 2.3 + 9.1) * 256) | 0;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.032;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = scNoisePat;
    ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.restore();
  }

  /* 受击红叠：极淡，且严格随 hurtFx 衰减 */
  const hfx = (typeof game.hurtFx === 'number') ? game.hurtFx : 0;
  if (hfx > 0.01) {
    ctx.fillStyle = 'rgba(148,18,10,' + Math.min(0.16, hfx * 0.16).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawDowned(a) {
  if (a.look === 'whale') { drawWhaleDowned(a); return; }
  if (a.look === 'hero') { drawHeroDowned(a); return; }
  if (castCfg(a.look)) { drawCastDowned(a); return; }
  if (a.look === 'kimi' || a.look === 'glm' || a.look === 'gpt') { drawAgentDowned(a); return; }
  const x = a.x - camera.x, y = a.y;

  /* 血泊 */
  ctx.fillStyle = 'rgba(110,24,24,0.42)';
  ctx.beginPath(); ctx.ellipse(x + 6, y + 1, 40, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x, y + 2, 30, 6, 0, 0, Math.PI * 2); ctx.fill();

  /* 软倒：倒地不是「啪」一下躺平。膝盖先折（整个人往下沉），
     上身再歪出去，落到地上还有一次余震才躺稳。
     时间从 a.downedAt 推，不占任何状态位。 */
  /* 和主角 / 干员 / 大肥鱼共用同一条倒地曲线（chars.js 的 actDownedCurve），
     这四份原本逐字相同 —— 差别只在各人文件的注释里 */
  const dc = actDownedCurve(a);
  const ang = -dc.ang, sink = dc.sink;

  ctx.save();
  ctx.translate(x, y - sink * 0.08);
  ctx.rotate(ang);

  /* 腿（弯曲） */
  ctx.strokeStyle = '#232a31';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(15, -6);
  ctx.lineTo(26, -2);
  ctx.stroke();

  /* 躯干 */
  ctx.fillStyle = a.bodyColor;
  roundRect(-10, -30, 20, 32, 5);
  ctx.fill();
  ctx.fillStyle = a.trim;
  ctx.fillRect(-10, -20, 20, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-4, -26, 8, 6);

  /* 手臂摊开 */
  ctx.strokeStyle = a.bodyColor;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, -27);
  ctx.lineTo(16, -33);
  ctx.stroke();

  /* 头 */
  ctx.fillStyle = a.skin;
  ctx.beginPath(); ctx.arc(0, -36, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = a.trim;
  ctx.beginPath(); ctx.arc(0, -39, 10.5, Math.PI, 0); ctx.fill();
  ctx.fillRect(-11, -40, 22, 3);
  ctx.restore();

  /* 呼救波纹 */
  const pulse = 0.5 + 0.5 * Math.sin(game.time * 4);
  ctx.strokeStyle = 'rgba(255,110,110,' + (0.16 + pulse * 0.22) + ')';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 18, 30 + pulse * 12, 0, Math.PI * 2);
  ctx.stroke();

  const total = a.kind === 'player' ? 2.2 : 2.0;
  if (a.reviveProgress > 0.02) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(x - 33, y - 68, 66, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#7ef0b0';
    roundRect(x - 31, y - 66, 62 * clamp(a.reviveProgress / total, 0, 1), 6, 3);
    ctx.fill();
  }
  ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff6b6b';
  ctx.fillText('倒地 ' + Math.ceil(a.downTimer) + 's', x, y - 76);
}

/* ---------------- 士兵 ---------------- */
function tone(hex, k) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((v >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((v >> 8) & 255) * k));
  const b = Math.min(255, Math.round((v & 255) * k));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function seg(x1, y1, x2, y2, w, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/* 一条腿：大腿 / 小腿 / 护膝 / 军靴 */
function drawLeg(hipX, hipY, swing, knee, thick, pants, bootCol, kneeCol) {
  const TH = 13, SH = 15;
  const kx = hipX + Math.sin(swing) * TH;
  const ky = hipY + Math.cos(swing) * TH;
  const fa = swing - knee;
  const fx = kx + Math.sin(fa) * SH;
  const fy = ky + Math.cos(fa) * SH;

  seg(hipX, hipY, kx, ky, thick, pants);
  seg(kx, ky, fx, fy, thick * 0.88, tone(pants, 0.84));

  ctx.fillStyle = kneeCol;
  ctx.beginPath();
  ctx.arc(kx, ky, thick * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.arc(kx - 1.4, ky - 1.4, thick * 0.24, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(fa * 0.5);
  ctx.fillStyle = bootCol;
  roundRect(-6.5, -3, 14.5, 9, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  roundRect(-5, -2.2, 12, 3, 1.5);
  ctx.fill();
  ctx.restore();
}

function drawSoldier(a, isBuddy) {
  if (a.dead) return;
  if (a.downed) { drawDowned(a); return; }
  /* 外观分派：大肥鱼走自己的 painter（阴影/空翻/名牌都在里面重做了一遍），
     人类士兵这条路一个像素都没动 */
  if (a.look === 'whale') { drawWhaleGirl(a, isBuddy); return; }
  if (a.look === 'hero') { drawHero(a, isBuddy); return; }
  /* 有立绘的干员走位图管线（动作层全共用，见 chars.js 的 CAST_CFG）；
     图没解码好时 drawCast 内部自己退回下面的程序化骨架 */
  if (castCfg(a.look)) { drawCast(a, isBuddy); return; }
  /* 三名 AI 干员（奇米 / 知源 / 枢机）共用一套程序化 painter，
     颜色全部来自 CHAR_LIST，换人只换 palette 不换骨架 */
  if (a.look === 'kimi' || a.look === 'glm' || a.look === 'gpt') { drawAgent(a, isBuddy); return; }
  const h = a.h, sx = a.x - camera.x;
  const facing = Math.cos(a.aim) >= 0 ? 1 : -1;
  const sq = clamp(a.landSquash || 0, 0, 1);

  /* 承托面阴影：离地越高越淡越小 */
  const under = surfaceBelow(a.x, a.y);
  const gap = clamp((under - a.y) / 190, 0, 1);
  const sk = 1 - gap * 0.68;
  ctx.fillStyle = 'rgba(0,0,0,' + (0.42 * sk).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + facing * 2, under + 1, (16 + 26 * proneK(a)) * sk, 4.6 * sk, 0, 0, Math.PI * 2);
  ctx.fill();

  /* 冲刺残影 */
  if ((a.dashTime || 0) > 0) {
    const dir = Math.sign(a.vx) || facing;
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.10 * i;
      ctx.fillStyle = a.bodyColor;
      roundRect(sx - dir * i * 9 - 8, a.y - h * 0.86, 16, h * 0.78, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* 二段跳空翻：蹬出去之后整段 0.42 秒翻满一圈。
     airJumpT 从 AIRJUMP_FLIP 线性掉到 0，flipK 是 0→1 的进度；
     角度走 smoothstep —— 起转那两帧不能已经横过来（不然像被抡飞的麻袋），
     中段团身时正好转到头下脚上，收尾把脚转回正下方，落地不会「倒着站」。
     flipDir 跟着朝向走，转身后自然反过来。 */
  let flipK = 0, flipAng = 0;
  if ((a.airJumpT || 0) > 0) {
    flipK = clamp(1 - a.airJumpT / AIRJUMP_FLIP, 0, 1);
    const e = flipK * flipK * (3 - 2 * flipK);
    flipAng = (a.flipDir || facing) * Math.PI * 2 * e;
  }

  /* 空翻时绕身体画一段旋涡弧：光靠人形自转，转得快时看不出是在翻，
     有这条跟着角度走的弧才读得出「转了一圈」。 */
  if (flipK > 0 && flipK < 0.82) {
    const al = 0.34 * (1 - flipK / 0.82);
    ctx.strokeStyle = 'rgba(255,238,206,' + al.toFixed(3) + ')';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const a0 = flipAng - 1.7 - i * 0.5;
      ctx.beginPath();
      ctx.arc(sx, a.y - h * 0.52, h * 0.4 - i * 5, a0, a0 + 1.15);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* 受击无敌闪烁 */
  const blink = a.invuln > 0 && Math.floor(a.invuln * 18) % 2 === 0;

  ctx.save();
  ctx.translate(sx, a.y);
  ctx.scale(1 + sq * 0.11, 1 - sq * 0.15);
  if (flipAng) {
    /* 绕身体中段转 —— 绕脚底转会像一根被抡起来的棍子 */
    ctx.translate(0, -h * 0.52);
    ctx.rotate(flipAng);
    ctx.translate(0, h * 0.52);
  }
  if (blink) ctx.globalAlpha = 0.5;

  /* 动觉：起伏 + 起步倾角。这一支是「没有专属 painter 的人形」兜底，
     但走的是和位图 / 干员 / 敌兵完全相同的一份姿态（util.js 动作层），
     所以哪天加了新角色忘了配 painter，他也不会是插在土里的立牌。 */
  const mo = motionOf(a);
  const lean = whaleLean(a) + mo.lean;
  if (lean) ctx.rotate(lean);
  if (mo.bob) ctx.translate(0, -mo.bob);

  const uniform = a.bodyColor;
  const uniformDark = tone(uniform, 0.74);
  const uniformDeep = tone(uniform, 0.54);
  const gear = '#2b323a';
  const gearLight = '#3c454f';
  const bootCol = '#191d22';
  const metal = '#39424b';
  const metalHi = '#59646f';

  const moving = a.onGround && Math.abs(a.vx) > 28;
  const ph = a.anim;
  /* 蹲下：胯/肩整体下沉 17px（碰撞盒 58→41），膝盖深弯把脚留在地面。
     趴下：蹲姿被 cqEff 压成 0，整身另走「绕脚底放倒」，
     角度由 cos(ang) = 受击高 / 视觉高 反解，和位图通道同一个约定。 */
  const cq = cqEff(a);
  const pp = pronePose(a, 60);
  const lying = pp.pr > 0.002;
  const drop = 17 * cq;
  const hipY = -34 + drop;
  const shY = -46.5 + drop;

  let swA, knA, swB, knB;
  if (!a.onGround) {
    swA = 0.44; knA = 0.92;
    swB = -0.42; knB = 0.26;
  } else if (moving) {
    swA = Math.sin(ph) * 0.52;
    swB = Math.sin(ph + Math.PI) * 0.52;
    knA = Math.max(0, Math.sin(ph + 2.1)) * 0.6;
    knB = Math.max(0, Math.sin(ph + Math.PI + 2.1)) * 0.6;
  } else {
    swA = -0.05; knA = 0.09;
    swB = 0.07; knB = 0.09;
  }
  if (cq > 0.02) {
    /* 脚钉在地面，前脚略前、后脚略后 —— 膝盖自然往前顶 */
    const fF = legIK(3 * facing, hipY, 3 * facing + 11 * facing, 0.5);
    const fB = legIK(-3 * facing, hipY, -3 * facing - 9 * facing, 0.5);
    swA = lerp(swA, fF.swing, cq); knA = lerp(knA, fF.knee, cq);
    swB = lerp(swB, fB.swing, cq); knB = lerp(knB, fB.knee, cq);
  }

  /* 空翻中段把腿收到胸前（团身）：不收腿的话，转起来只是「一根人会转的棍子」，
     收了腿才看得出是人在空中抱膝翻。sin 曲线让收腿在转身最快的时候最深。 */
  if (flipK > 0 && flipK < 1) {
    const tk = Math.sin(Math.PI * clamp(flipK, 0, 1));
    swA = lerp(swA, 1.05, tk * 0.9); knA = lerp(knA, 1.75, tk * 0.9);
    swB = lerp(swB, 0.85, tk * 0.9); knB = lerp(knB, 1.66, tk * 0.9);
  }

  /* 身体整体进一个变换：趴下时绕脚底倒下，站着时原样不动 */
  ctx.save();
  if (lying) {
    ctx.translate(facing * pp.shift, -pp.lift);
    ctx.rotate(facing * pp.ang);
  }

  /* ---- 后腿 ---- */
  drawLeg(-3 * facing, hipY, swB, knB, 8.6, uniformDeep, '#14171b', gear);
  /* ---- 前腿 ---- */
  drawLeg(3 * facing, hipY, swA, knA, 9.2, uniformDark, bootCol, gearLight);

  /* ---- 背包 ---- */
  const bpL = facing > 0 ? -15.5 : 4.5;
  ctx.fillStyle = tone(uniform, 0.6);
  roundRect(bpL, shY + 2, 11, 19, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(bpL + 1.5, shY + 12, 8, 7, 2.5);
  ctx.fill();
  /* 背包卷毯 */
  ctx.fillStyle = tone(uniform, 0.78);
  roundRect(bpL - 0.5, shY - 0.5, 12, 4, 2);
  ctx.fill();

  /* ---- 躯干 ---- */
  ctx.fillStyle = uniform;
  roundRect(-9, shY - 1, 18, 15, 4);
  ctx.fill();
  /* 战术背心 */
  ctx.fillStyle = tone(uniform, 0.9);
  roundRect(-7.6, shY + 1.5, 15.2, 11, 3);
  ctx.fill();
  /* 背心板缝 */
  ctx.strokeStyle = 'rgba(0,0,0,0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-7.6, shY + 6.5); ctx.lineTo(7.6, shY + 6.5);
  ctx.stroke();
  /* 弹匣包 */
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = gear;
    roundRect(-6.2 + i * 4.5, shY + 7.6, 3.8, 4.6, 1.4);
    ctx.fill();
  }
  /* 肩带 */
  ctx.fillStyle = uniformDeep;
  ctx.fillRect(-6.6, shY + 0.4, 2.6, 11);
  ctx.fillRect(4, shY + 0.4, 2.6, 11);
  /* 腰带 */
  ctx.fillStyle = gear;
  ctx.fillRect(-9, shY + 12.2, 18, 3.2);
  ctx.fillStyle = metalHi;
  ctx.fillRect(-2, shY + 12.2, 4, 3.2);
  /* 前缘暖色轮廓光（来自地平线余晖） */
  ctx.fillStyle = 'rgba(255,198,132,0.13)';
  ctx.fillRect(facing > 0 ? 7.2 : -9, shY, 1.8, 13);
  /* 顶部冷光 */
  ctx.fillStyle = 'rgba(180,214,255,0.10)';
  roundRect(-9, shY - 1, 18, 3, 2);
  ctx.fill();
  /* 肩章 */
  ctx.fillStyle = tone(uniform, 1.18);
  ctx.beginPath();
  ctx.arc(facing * 6.4, shY + 1.6, 3.4, 0, Math.PI * 2);
  ctx.fill();

  /* ---- 头部（蹲下时整组跟着沉，脑袋前倾一点像在瞄） ---- */
  ctx.save();
  ctx.translate(cq * 1.6, drop);
  ctx.fillStyle = tone(a.skin, 0.7);
  ctx.fillRect(-3, -52, 6, 5);
  ctx.fillStyle = a.skin;
  ctx.beginPath();
  ctx.arc(0, -53.4, 6.8, 0, Math.PI * 2);
  ctx.fill();
  /* 下颌阴影 */
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath();
  ctx.arc(0, -52.2, 6.4, 0.15, Math.PI - 0.15);
  ctx.fill();
  /* 护目镜 */
  ctx.fillStyle = '#0f1418';
  roundRect(-6.4 + facing * 1.2, -56.6, 12.8, 4.2, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,206,255,0.30)';
  roundRect(-5.4 + facing * 1.2, -56.1, 5, 1.5, 0.7);
  ctx.fill();
  /* 头盔 */
  ctx.fillStyle = tone(uniform, 0.86);
  ctx.beginPath();
  ctx.arc(0, -54.4, 8.6, Math.PI * 0.99, Math.PI * 2.01);
  ctx.fill();
  ctx.fillRect(-8.6, -55.2, 17.2, 3.2);
  /* 头盔前沿 */
  ctx.fillStyle = tone(uniform, 0.68);
  roundRect(facing > 0 ? 2 : -10.5, -56.6, 8.5, 2.4, 1);
  ctx.fill();
  /* 头盔高光 */
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.arc(-2.4, -57.4, 5.2, Math.PI * 1.06, Math.PI * 1.62);
  ctx.fill();
  /* 帽带 */
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-6.6, -53.6);
  ctx.lineTo(-5.4, -51.2);
  ctx.stroke();
  ctx.restore();

  /* 身体出变换 */
  ctx.restore();

  /* ---- 武器与手臂 ----
     身体倒着，枪不跟着倒：扣掉同样的角度，趴着的时候枪还是平架的 */
  ctx.save();
  ctx.translate(0, shY + 3);
  ctx.rotate(lying ? a.aim - facing * pp.ang : a.aim);
  if (facing < 0) ctx.scale(1, -1);

  const kick = Math.min(1, (a.muzzle || 0) * 12);
  ctx.translate(-kick * 1.6, 0);

  /* 后手（握把） */
  seg(0, 1.5, 8, 5, 7, uniformDeep);

  /* 枪托 + 机匣 */
  ctx.fillStyle = '#20262c';
  roundRect(-9, 0.5, 11, 6.5, 2);
  ctx.fill();
  ctx.fillStyle = '#2c343b';
  roundRect(-1, -2.4, 21, 7.2, 2);
  ctx.fill();
  /* 上导轨与瞄具 */
  ctx.fillStyle = metal;
  ctx.fillRect(2, -4.4, 13, 2);
  ctx.fillStyle = '#161c21';
  roundRect(5.5, -8.2, 7, 4, 1.2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,200,255,0.35)';
  ctx.fillRect(6.4, -7.4, 5.2, 1.4);
  /* 弹匣：和三名干员 / 主角共用同一个形状 + 同一套换弹动画
     （gunMag 在 chars.js，几何写在那儿） */
  gunMag(a, '#262d34');
  /* 枪管 */
  const bgr = ctx.createLinearGradient(18, -1.4, 18, 2.2);
  bgr.addColorStop(0, metalHi);
  bgr.addColorStop(1, '#22282e');
  ctx.fillStyle = bgr;
  ctx.fillRect(18, -1.4, 15, 3.4);
  ctx.fillStyle = '#1a2026';
  ctx.fillRect(32.5, -2, 5, 4.6);
  /* 前握把 */
  ctx.fillStyle = '#242b31';
  roundRect(22, 1.8, 4, 7.5, 1.5);
  ctx.fill();

  /* 前手 */
  seg(1.5, -2, 24, 3.6, 7, uniform);
  ctx.fillStyle = a.skin;
  ctx.beginPath();
  ctx.arc(24, 4, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(9, 5.4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.arc(24, 4.6, 1.6, 0, Math.PI * 2);
  ctx.fill();

  /* 枪口焰 */
  if ((a.muzzle || 0) > 0) {
    if (scGlowWarm) {
      ctx.drawImage(scGlowWarm, 38 - 24, -24, 48, 48);
    } else {
      const mg = ctx.createRadialGradient(38, 0, 1, 38, 0, 24);
      mg.addColorStop(0, 'rgba(255,248,214,0.95)');
      mg.addColorStop(0.35, 'rgba(255,186,72,0.55)');
      mg.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(38, 0, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,240,190,0.9)';
    ctx.beginPath();
    ctx.moveTo(37, 0);
    ctx.lineTo(46, -3.2);
    ctx.lineTo(43, 0);
    ctx.lineTo(46, 3.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* 受击红闪 */
  if (a.flash > 0) {
    ctx.globalAlpha = Math.min(0.34, a.flash * 2.2);
    ctx.fillStyle = '#ff6a4a';
    roundRect(-10, -63, 20, 64, 6);
    ctx.fill();
    ctx.globalAlpha = blink ? 0.5 : 1;
  }

  ctx.restore();

  if (!isBuddy) return;

  /* 队友名牌 / 血条 / 台词气泡（人类士兵与大肥鱼共用同一套） */
  drawBuddyPlate(a, sx, a.y - h - 12);
}
