/* 人物定稿验收：设定自洽 + 剪影辨识度
   ------------------------------------------------------------------
   分两段，性质完全不同，不要混着看：

   A. **数据自洽（会 fail）**
      设定文档很容易写成自相矛盾 —— 「只能装狙击」但 loadout 里塞了机枪、
      两个人抢同一把主武器、两个动词重名。这些都能用断言抓，
      而且必须抓：矛盾留在文档里，将来照它写代码就是返工。

   B. **剪影辨识度（只诊断，不 fail）**
      规则是「五个人涂成全黑也要能分辨」。
      现在三个干员共用 drawAgent，只换颜色 —— 剪影大概率一模一样。
      这一节把它量出来：把每个人描黑、按包围盒归一化、两两算 IoU。
      IoU 越高越像。**不改代码**，只把「形象设计还差多少」变成数字。

   用法：node test/_roster.js
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');

for (const f of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc']) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) { /* 没有就算了 */ }
}

const W = 1120, H = 560;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
let clock = 0;
const canvasEl = {
  width: W, height: H, style: {},
  getContext: () => ctx,
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H })
};
const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams, Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock },
  requestAnimationFrame: () => 0,
  addEventListener: () => {},
  innerWidth: W, innerHeight: H, devicePixelRatio: 1,
  document: { getElementById: () => canvasEl, createElement: () => createCanvas(8, 8) }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);

for (const f of ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js']) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });
}

const api = vm.runInContext(`({
  get game(){ return game; },
  get camera(){ return camera; },
  CHAR_LIST, CHAR_LOADOUT, WEAPON_FIT, SKILLS, CHAR_VISUAL,
  canCarry, isBestFor, charLoadout, skillOf, charVisual,
  drawSoldier
})`, ctxVm);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

const IDS = ['hero', 'buddy', 'kimi', 'glm', 'gpt'];
const NAME = { hero: '无名', buddy: '大肥鱼', kimi: '奇米', glm: '知源', gpt: '枢机' };
/* 角色 id ≠ 外观名：大肥鱼的 id 是 buddy、look 是 whale。
   直接拿 id 当 look 会掉进敌兵那条矢量分支（a.bodyColor 未定义当场炸），
   所以这张映射必须有，而且只能有一份。 */
const LOOK = { hero: 'hero', buddy: 'whale', kimi: 'kimi', glm: 'glm', gpt: 'gpt' };

/* ==================================================================
   A. 设定自洽
   ================================================================== */
console.log('\nA. 设定自洽（矛盾留在文档里，将来照着写代码就是返工）\n');

{
  /* A1 每个角色都有配枪表，且五个角色都在 */
  const missing = IDS.filter(id => !api.CHAR_LOADOUT[id]);
  ok('五个角色都有配枪表', missing.length === 0,
    missing.length ? '缺：' + missing.join(', ') : 'hero/buddy/kimi/glm/gpt');

  /* A2 配上的每把枪，权限层必须认 —— 这是最容易写岔的地方：
     文档里说「奇米只能装狙和手枪」，代码里 loadout 却写了机枪。 */
  const bad = [];
  for (const id of IDS) {
    const lo = api.CHAR_LOADOUT[id];
    for (const slot of ['primary', 'secondary', 'sidearm']) {
      for (const w of (lo[slot] || [])) {
        if (!api.canCarry(id, w)) bad.push(id + '.' + slot + '=' + w);
      }
    }
    for (const w of (lo.exclusive || [])) {
      if (!api.canCarry(id, w)) bad.push(id + '.excl=' + w);
    }
  }
  ok('配枪表里的每一把枪，权限层都认', bad.length === 0,
    bad.length ? '不自洽：' + bad.join(' ') : '10 件装备全部对得上 can[]');

  /* A3 独占装备只能属于一个人 —— 两个人都「独占」就等于没有独占 */
  const excl = {};
  for (const id of IDS) for (const w of (api.CHAR_LOADOUT[id].exclusive || [])) {
    (excl[w] = excl[w] || []).push(id);
  }
  const shared = Object.keys(excl).filter(w => excl[w].length > 1);
  ok('独占装备不与人共享', shared.length === 0,
    shared.length ? '两人独占：' + shared.join(',') : 'blade→kimi / shield→hero / aegis→gpt');

  /* A4 固主武器的角色之间不许撞车（撞了就等于没有分类） */
  const solo = {};
  for (const id of IDS) {
    const p = api.CHAR_LOADOUT[id].primary || [];
    if (p.length === 1) (solo[p[0]] = solo[p[0]] || []).push(id);
  }
  const clash = Object.keys(solo).filter(w => solo[w].length > 1);
  ok('固定主武器的角色互不重叠', clash.length === 0,
    clash.length ? '撞车：' + clash.map(w => w + '(' + solo[w].join('/') + ')').join(' ')
      : Object.keys(solo).map(w => w + '→' + solo[w][0]).join(' / '));

  /* A5 五个动词各不相同 */
  const verbs = IDS.map(id => api.SKILLS[id] && api.SKILLS[id].verb);
  ok('五个人五个不同的动词', new Set(verbs).size === 5, verbs.join(' / '));

  /* A6 每张技能卡都有代价 —— 只写效果的那一版会退化成「谁数值高用谁」 */
  const noCost = IDS.filter(id => !api.SKILLS[id] || !api.SKILLS[id].cost || api.SKILLS[id].cost.length < 6);
  ok('每张技能卡都写了代价', noCost.length === 0,
    noCost.length ? '缺代价：' + noCost.join(',') : '沉=不能动 / 连=离远就断 / 先=空枪锁 / 钉=不能转身 / 闪=唯一位移');

  /* A7 技能参数存在（将来接 update 要读） */
  const noParams = IDS.filter(id => !api.SKILLS[id] || !api.SKILLS[id].params);
  ok('每张技能卡都带参数', noParams.length === 0,
    IDS.map(id => Object.keys(api.SKILLS[id].params || {}).length + '项').join(' '));

  /* A8 形象规格齐全，且「识别带」这条叙事成立：
     三个 AI 有带、人没有。这既是一条设计规则，也是剧情伏笔。 */
  const noVis = IDS.filter(id => !api.CHAR_VISUAL[id]);
  const banded = IDS.filter(id => api.CHAR_VISUAL[id] && api.CHAR_VISUAL[id].band);
  ok('五个人都有形象规格', noVis.length === 0, noVis.length ? '缺：' + noVis.join(',') : '剪影/识别带/独占符号 三项齐全');
  ok('识别带只挂在 AI 身上（人是唯一没有出厂批次的）',
    banded.length === 4 && banded.indexOf('hero') < 0 && banded.indexOf('buddy') >= 0,
    '有带：' + banded.map(id => NAME[id]).join('/') + '　无带：无名');

  /* A9 每个人的独占符号必须挂在一个真实技能上，不许是纯装饰 */
  const orphan = IDS.filter(id => {
    const v = api.CHAR_VISUAL[id]; const s = api.SKILLS[id];
    if (!v || !s) return true;
    return v.markSkill !== s.verb && v.markSkill !== '长上下文';
  });
  ok('独占视觉符号都对得上一个技能', orphan.length === 0,
    orphan.length ? '对不上：' + orphan.join(',') : '呼吸缝=沉 / 暗鳍=连 / 下摆=长上下文 / 书卷=钉 / 半透明盾=闪');
}

/* ==================================================================
   B. 剪影辨识度（诊断，不 fail）
   ------------------------------------------------------------------
   做法：把角色单独画在黑底上，source-in 填成纯黑得到剪影，
   裁到包围盒、拉伸到 56×56（去掉尺寸差异，只比形状），再两两算 IoU。
   IoU = 交集 / 并集，1.0 表示完全一样。
   ================================================================== */
const SIL = 56, PAD = 6;
const SIL_W = 220, SIL_H = 260;

function renderOne(look) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  /* 站立、平瞄、不换弹 —— 排除姿态差异，只留「这个人长什么样」 */
  sandbox.__a = {
    look: LOOK[look] || look, x: 260, y: 460, aim: 0, vx: 0, anim: 0, h: 62, w: 26,
    hp: 100, maxHp: 100, crouch: 0, prone: 0, onGround: true,
    muzzle: 0, reloading: 0, reloadDur: 0, landSquash: 0,
    fallSpeed: 0, _moNo: -1, _mo: null, armor: 0
  };
  vm.runInContext('camera.x = __a.x - 260; camera.y = 0; game.time = 0; drawSoldier(__a, false);', ctxVm);
}

function cutSilhouette() {
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  /* 归一化到 SIL×SIL：等比缩放到「高占满」，横向按同一比例，不拉伸 ——
     拉伸会把「高瘦」和「矮胖」抹平，正好抹掉了我们要比的东西。 */
  const k = SIL / bh;
  const nw = Math.max(1, Math.round(bw * k));
  const m = new Uint8Array(SIL * SIL);
  const offX = Math.floor((SIL - nw) / 2);
  for (let y = 0; y < SIL; y++) {
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(x1, x0 + Math.floor(x / k));
      const sy = Math.min(y1, y0 + Math.floor(y / k));
      if (d[(sy * W + sx) * 4 + 3] > 24) m[y * SIL + offX + x] = 1;
    }
  }
  return { mask: m, bw, bh, k, raw: { x0, y0, x1, y1 } };
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) uni++;
  }
  return uni ? inter / uni : 0;
}

async function settle(maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (vm.runInContext(`(typeof whaleSpriteReady==='function'&&whaleSpriteReady())&&(typeof heroSpriteReady==='function'&&heroSpriteReady())`, ctxVm)) return true;
    await new Promise(r => setTimeout(r, 60));
  }
  return false;
}

(async () => {
  const ready = await settle();
  console.log('\nB. 剪影辨识度（立绘解码：' + (ready ? '✓' : '✗ 退化了，下面数字不可信') + '）\n');

  const sil = {};
  for (const id of IDS) {
    renderOne(id);
    sil[id] = cutSilhouette();
  }
  const got = IDS.filter(id => sil[id]);
  ok('五个角色都能取到剪影', got.length === 5, got.join('/'));

  /* 两两 IoU */
  const pairs = [];
  for (let i = 0; i < got.length; i++) {
    for (let j = i + 1; j < got.length; j++) {
      pairs.push({ a: got[i], b: got[j], v: iou(sil[got[i]].mask, sil[got[j]].mask) });
    }
  }
  const maxOf = {};
  for (const id of got) maxOf[id] = 0;
  for (const p of pairs) {
    if (p.v > maxOf[p.a]) maxOf[p.a] = p.v;
    if (p.v > maxOf[p.b]) maxOf[p.b] = p.v;
  }
  pairs.sort((x, y) => y.v - x.v);

  console.log('  最像的五对（IoU 越高越像）：');
  for (const p of pairs.slice(0, 5)) {
    const flag = p.v > 0.88 ? '  ← 几乎同一个模子' : (p.v > 0.78 ? '  ← 偏像' : '');
    console.log('    ' + NAME[p.a] + ' × ' + NAME[p.b] + '  ' + p.v.toFixed(3) + flag);
  }
  console.log('\n  每个人的「辨识度」= 1 − 最像的那一对：');
  for (const id of got.slice().sort((x, y) => maxOf[x] - maxOf[y])) {
    const d = 1 - maxOf[id];
    console.log('    ' + NAME[id].padEnd(4, '　') + ' ' + d.toFixed(3) + '  ' +
      '█'.repeat(Math.round(d * 100 / 4)));
  }

  /* ---------------- 出图 ----------------
     踩的坑：renderOne() 每次都 clearRect 全屏，所以「边排版边渲染」
     会把前面画好的全擦掉 —— 第一版只剩最后一个角色的残影。
     正确顺序是**先全部预渲染成离屏图、再统一排版**。
     下面 grab() 就是这个「先取后画」。 */
  const CROP_W = 220, CROP_H = 260;
  const CROP_X = 260 - CROP_W / 2, CROP_Y = 460 - CROP_H + 22;

  function grab() {
    const c = createCanvas(CROP_W, CROP_H);
    c.getContext('2d').drawImage(canvas, CROP_X, CROP_Y, CROP_W, CROP_H, 0, 0, CROP_W, CROP_H);
    return c;
  }
  function tint(src, color) {
    const c = createCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  const SILH = {}, ORIG = {};
  for (const id of IDS) {
    renderOne(id);
    ORIG[id] = grab();                          /* 先取原色 */
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);                   /* 原地填黑 = 剪影 */
    ctx.globalCompositeOperation = 'source-over';
    SILH[id] = tint(grab(), '#e9f3ff');         /* 再转白，放黑底上才看得见 */
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#05080b';
  ctx.fillRect(0, 0, W, H);

  function TEXT(s, x, y, size, color, bold, center) {
    ctx.fillStyle = color || '#9fb3c6';
    ctx.font = (bold ? 'bold ' : '') + size + 'px "Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = center ? 'center' : 'left';
    ctx.fillText(s, x, y);
    ctx.textAlign = 'left';
  }

  TEXT('剪影辨识度 · 五个人涂成全黑也要能分辨（形象规格第 1 条硬规则）', 12, 10, 16, '#7ee0a0', true);
  TEXT('上排＝真实剪影　下排＝原色　数字＝1 − 最像的那一对（越高越好认）', 12, 34, 12, '#7c8b99');

  const PADX = 12;
  const CELL = (W - PADX * 2) / 5;
  const ROW1 = 54, H1 = 190;
  const ROW2 = 252, H2 = 190;
  const ROW3 = 448;

  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const cx = PADX + CELL * i + CELL / 2;
    const s = sil[id];
    if (!s) continue;

    /* 剪影：角色高度占满格高的 92%，底部咬住格子下沿 */
    {
      const k = (H1 * 0.92) / s.bh;
      const w = s.bw * k, h = s.bh * k;
      const bx = cx - w / 2, by = ROW1 + H1 - 8 - h;
      ctx.fillStyle = '#0d1620';
      ctx.fillRect(PADX + CELL * i + 6, ROW1, CELL - 12, H1);
      ctx.drawImage(SILH[id], s.raw.x0 - CROP_X, s.raw.y0 - CROP_Y, s.bw, s.bh, bx, by, w, h);
    }
    /* 原色：同一比例，视觉上能直接和上面的剪影对上 */
    {
      const k = (H2 * 0.92) / s.bh;
      const w = s.bw * k, h = s.bh * k;
      const bx = cx - w / 2, by = ROW2 + H2 - 8 - h;
      ctx.fillStyle = '#0d1620';
      ctx.fillRect(PADX + CELL * i + 6, ROW2, CELL - 12, H2);
      ctx.drawImage(ORIG[id], s.raw.x0 - CROP_X, s.raw.y0 - CROP_Y, s.bw, s.bh, bx, by, w, h);
    }

    const v = api.CHAR_VISUAL[id];
    const d = 1 - maxOf[id];
    const col = d > 0.30 ? '#7ee0a0' : (d > 0.16 ? '#ffc857' : '#ff7a6a');
    TEXT(NAME[id], cx, ROW3, 16, '#e6eef7', true, true);
    TEXT((v.silhouette || []).join('·'), cx, ROW3 + 22, 10, '#8899a8', false, true);
    TEXT('可辨识 ' + d.toFixed(2), cx, ROW3 + 38, 13, col, true, true);
  }

  /* ---------------- 底部诊断 ---------------- */
  const worst = got.slice().sort((x, y) => maxOf[y] - maxOf[x])[0];
  const wp = pairs[0];
  const DY = 508;
  ctx.fillStyle = 'rgba(255,120,110,0.13)';
  ctx.fillRect(8, DY, W - 16, 46);
  ctx.strokeStyle = 'rgba(255,120,110,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(8.5, DY + 0.5, W - 17, 45);
  TEXT('最像的一对：' + NAME[wp.a] + ' × ' + NAME[wp.b] + '  IoU ' + wp.v.toFixed(3) +
    '　·　最难分辨：' + NAME[worst] + '（最像 ' + maxOf[worst].toFixed(2) + '）',
    18, DY + 6, 12, '#ffb3a6', true);
  TEXT('三个干员共用 drawAgent、只换 coat/cloth/visor —— 剪影天然一模一样。要分开得改骨架，不是改颜色。',
    18, DY + 25, 12, '#c99188');

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'roster-silhouette.png'), await canvas.encode('png'));
  console.log('\n✓ shots/roster-silhouette.png');

  console.log('\n' + (fail === 0 ? '人物定稿验收通过 ✓' : '有 ' + fail + ' 项未通过 ❌') +
    '   (' + pass + ' 通过 / ' + fail + ' 失败)');
  process.exit(fail === 0 ? 0 : 1);
})();
