/* 参考图压力测试
   ------------------------------------------------------------------
   六张参考图是插画，不是 sprite。说「不能直接用」必须给出数字，
   否则下一个人（或下一轮的我）还会想着"缩一下就能用"。

   这一份只回答两个问题：
     ① 缩到游戏内真实尺寸（192px 高）后，还剩多少信息？
     ② Claude 头上那朵花该长什么样？
   ================================================================== */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const OUT = path.join(__dirname, '..', 'shots');
const REF = path.join(__dirname, '..', 'art', 'ref');
const ART = path.join(__dirname, '..', 'art');

/* 统一缩到的高度 —— 和现役立绘一致 */
const SPRITE_H = 192;

/* 从四边漫水填充抠白底。
   JPEG 的白不是纯 255，阈值放到 232；只删与画面边缘连通的白，
   这样白裙、白龙翼、白书页这些「内部的白」会保留。 */
function cutWhite(img) {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, img.width, img.height);
  const d = id.data;
  const W = img.width, H = img.height;
  const seen = new Uint8Array(W * H);
  const stack = [];
  const isWhite = (i) => d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232;

  for (let x = 0; x < W; x++) { stack.push(x); stack.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W); stack.push(y * W + W - 1); }

  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!isWhite(i)) continue;
    d[i + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  g.putImageData(id, 0, 0);
  return c;
}

function bboxOf(c) {
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 24) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* 缩到统一高度，返回 {canvas, w, h} */
function fit(c, bb, H) {
  const k = H / bb.h;
  const w = Math.max(1, Math.round(bb.w * k));
  const o = createCanvas(w, H);
  const g = o.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, bb.x, bb.y, bb.w, bb.h, 0, 0, w, H);
  return { canvas: o, w, h: H };
}

/* 说明：这里本来想用「边缘密度」量化"缩到 192 后有多糊"。
   实测基准（大肥鱼，已经是在用的 sprite）就有 54%，说明阈值取错了 ——
   渐层头发的高光被算成了边缘。一把量不准的尺子比没有尺子更糟，
   所以删掉，只报尺寸这类确定性的数。 */
function void0() {}

const NAME = { kimi: '奇米', glm: '知源', gpt: '枢机', claude: '小克', gemini: '双子', grok: '格克' };
const ORDER = ['kimi', 'glm', 'gpt', 'claude', 'gemini', 'grok'];
const NOTES = {'kimi': '月牙·银白长发·长笛', 'glm': '狐耳·大尾巴·抱书', 'gpt': '龙角·龙翼·白发', 'claude': '图标花·橘发', 'gemini': '四角星·双色瞳·猫耳', 'grok': '尖冠·巨斧·双马尾'};

(async () => {
  const rows = [];

  /* 基准：现役立绘 */
  {
    const im = await loadImage(path.join(ART, 'v2', 'idle_cut.png'));
    const c = cutWhite(im);
    const bb = bboxOf(c) || { x: 0, y: 0, w: im.width, h: im.height };
    const f = fit(c, bb, SPRITE_H);
    rows.push({ key: '_base', name: '大肥鱼', tag: '现役 sprite', ...f, note: '鲸鳍·蓝渐变·鲸尾' });
  }

  for (const k of ORDER) {
    const im = await loadImage(path.join(REF, k + '.jpg'));
    const c = cutWhite(im);
    const bb = bboxOf(c);
    const f = fit(c, bb, SPRITE_H);
    rows.push({ key: k, name: NAME[k], tag: '参考图', ...f, note: NOTES[k] });
  }

  /* ---------------- 出图 ---------------- */
  const PAD = 14, CELL = 150, TOP = 96, IMG_H = SPRITE_H, BOT = 132;
  const W = PAD * 2 + CELL * rows.length;
  const H = TOP + IMG_H + BOT;
  const canvas = createCanvas(W, H + 386);
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b1117';
  g.fillRect(0, 0, W, H + 386);

  function TEXT(s, x, y, size, color, bold, center) {
    g.fillStyle = color || '#9fb3c6';
    g.font = (bold ? 'bold ' : '') + size + 'px "Microsoft YaHei",sans-serif';
    g.textBaseline = 'top';
    g.textAlign = center ? 'center' : 'left';
    g.fillText(s, x, y);
    g.textAlign = 'left';
  }

  TEXT('① 缩到游戏内真实尺寸（高 192px）—— 这就是玩家看到的大小', PAD, 12, 16, '#7ee0a0', true);
  TEXT('判断标准不是好不好看，而是「缩到这么小还剩几个特征读得出来」。', PAD, 36, 12, '#7c8b99');
  TEXT('最左＝现役大肥鱼（基准线），右边六个＝参考图缩到同高', PAD, 56, 12, '#5d6f80');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cx = PAD + CELL * i + CELL / 2;
    const x0 = PAD + CELL * i + 6;

    g.fillStyle = i === 0 ? '#131f18' : '#0d1620';
    g.fillRect(x0, TOP, CELL - 12, IMG_H);

    const dx = cx - r.w / 2, dy = TOP + IMG_H - r.h;
    g.drawImage(r.canvas, dx, dy);

    /* 脚底线 */
    g.strokeStyle = 'rgba(255,80,80,0.4)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, TOP + IMG_H - 0.5);
    g.lineTo(x0 + CELL - 12, TOP + IMG_H - 0.5);
    g.stroke();

    TEXT(r.name, cx, TOP + IMG_H + 10, 15, '#e6eef7', true, true);
    TEXT(r.tag + '  ' + r.w + '×' + r.h, cx, TOP + IMG_H + 30, 11, '#6f8296', false, true);

    TEXT(r.note, cx, TOP + IMG_H + 48, 11, i === 0 ? '#7ee0a0' : '#8899a8', false, true);
  }

  /* ---------------- 第二块：Claude 的花 ---------------- */
  let Y = H + 30;
  TEXT('② 小克头上的花：现在是写实的万寿菊，应该是 Anthropic 的橘色图标花', PAD, Y, 16, '#7ee0a0', true);
  Y += 28;
  TEXT('左边裁自参考图左上角；右边是按官方图标画的几何花 —— 八瓣放射、圆头细长条、中心留小孔。', PAD, Y, 12, '#7c8b99');
  Y += 30;

  /* 裁参考图的头部左上角（花的位置） */
  /* 四格横向对比：写实菊 / 8 瓣图标 / 8 瓣缩到真实头饰尺寸 / 5 瓣缩到真实头饰尺寸
     192px 高的角色头宽约 60px，头顶那朵花的直径约 24px —— 就用 24px 做压力测试。
     第一次我在这里写了「26px 放大了还认得出」，图上根本认不出，是一句想当然。 */
  const BOX = 210;
  const XS = [PAD, PAD + 230, PAD + 460, PAD + 690];

  function frame(x) {
    g.fillStyle = '#0d1620';
    g.fillRect(x, Y, BOX, BOX);
  }
  function label(x, s, color) {
    TEXT(s, x, Y + BOX + 6, 12, color || '#c89188');
  }
  /* 按真实像素尺寸画好，再平滑放大到 210 —— 放大是给我看，24px 才是玩家看到的 */
  function flower(x, size, spokes) {
    const c = createCanvas(size, size);
    const fg = c.getContext('2d');
    const r = size / 2;
    fg.strokeStyle = '#d97757';
    fg.lineWidth = size * (spokes >= 8 ? 0.19 : 0.26);
    fg.lineCap = 'round';
    for (let i = 0; i < spokes; i++) {
      const a = (Math.PI * 2 * i) / spokes - Math.PI / 2;
      fg.beginPath();
      fg.moveTo(r + Math.cos(a) * r * 0.22, r + Math.sin(a) * r * 0.22);
      fg.lineTo(r + Math.cos(a) * r * 0.86, r + Math.sin(a) * r * 0.86);
      fg.stroke();
    }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, 0, 0, size, size, x, Y, BOX, BOX);
  }

  {
    const im = await loadImage(path.join(REF, 'claude.jpg'));
    frame(XS[0]);
    g.drawImage(im, 250, 40, 420, 420, XS[0], Y, BOX, BOX);
    label(XS[0], '现在：写实菊花 + 流苏');

    frame(XS[1]); flower(XS[1], 210, 8);
    label(XS[1], '图标：8 瓣（大尺寸下成立）', '#d9a08c');

    frame(XS[2]); flower(XS[2], 24, 8);
    label(XS[2], '8 瓣 · 真头饰大小 24px');

    frame(XS[3]); flower(XS[3], 24, 5);
    label(XS[3], '5 瓣 · 真头饰大小 24px', '#7ee0a0');
  }

  TEXT('结论：花瓣数在 24px 下守不住 —— 八瓣糊成一团橘斑，五瓣还能看出「是个放射状的星」。',
    PAD, Y + 244, 12, '#d8e6f2');
  TEXT('所以小克在 sprite 里能被读到的是「橘色 + 在头侧 + 一团放射」，不是「一朵花」。要保住形状就得用 5 瓣、并放到 30px。',
    PAD, Y + 264, 12, '#8899a8');

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'ref-pressure.png');
  fs.writeFileSync(file, await canvas.encode('png'));

  console.log('\n缩到游戏内尺寸（高 ' + SPRITE_H + 'px）后的实际占位');
  console.log('─'.repeat(56));
  for (const r of rows) {
    console.log(r.name.padEnd(5, '　') + String(r.w + '×' + r.h).padStart(10) + '  ' + r.note);
  }
  console.log('─'.repeat(56));
  const ws = rows.slice(1).map(r => r.w);
  console.log('参考图宽 ' + Math.min(...ws) + '–' + Math.max(...ws) + '，大肥鱼 ' + rows[0].w +
    ' → 同一套立绘的横向占位差 ' + ((Math.max(...ws) / rows[0].w - 1) * 100).toFixed(0) + '%');
  console.log('\n✓ shots/ref-pressure.png');
})();
