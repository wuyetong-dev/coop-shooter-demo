/* 六人立绘一字排开：上排游戏内实际尺寸（192px 高），下排 ×2 放大。
   ------------------------------------------------------------------
   为什么需要它：单张体检图（_castcheck）只回答「这一张自己认不认得出」，
   回答不了「六个人放在一起谁跟谁像」。剪影 IoU 那个数字也不是答案 ——
   它量的是 drawSoldier 的程序化骨架，不是这六张立绘。

   底色用深色（关卡里最常出现的底），因为立绘要在深底上读得出来才有用。

   用法：node test/_castline.js
   → shots/castline.png
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'art', 'cast');
const OUT = path.join(ROOT, 'shots');
const H = 192;

for (const f of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf']) {
  if (fs.existsSync(f)) { GlobalFonts.registerFromPath(f, 'CN'); break; }
}

/* 顺序按「横向宽度」排，宽的放右边 —— 一眼就能看出谁最占地方 */
const ORDER = [
  { id: 'grok', name: '格克', note: '白双马尾·金尖黑冠·深红花瓣摆' },
  { id: 'gpt', name: '枢机', note: '龙角·深色翼内侧·腰间绿带' },
  { id: 'claude', name: '小克', note: '橘色图标花·橘长发·橙垂布' },
  { id: 'kimi', name: '奇米', note: '月牙·银白长发·星空深蓝' },
  { id: 'glm', name: '知源', note: '狐耳·巨尾·黑底白围裙' },
  { id: 'gemini', name: '双子', note: '四角星·猫尾·粉紫渐变' }
];

const PAD = 26, CW = 150, ZOOM = 2;
const W = PAD * 2 + CW * ORDER.length;
const ROW1 = 54;                       /* 第一排 y */
const ROW2 = ROW1 + H + 96;            /* 第二排 y（第一排下面留三行标注） */
const H2 = H * ZOOM;
const TOTAL = ROW2 + H2 + 46;

const BG = '#12161d';
const c = createCanvas(W, TOTAL), g = c.getContext('2d');
g.fillStyle = BG; g.fillRect(0, 0, W, TOTAL);

function TEXT(s, x, y, size, color, bold) {
  g.font = (bold ? 'bold ' : '') + size + 'px CN, sans-serif';
  g.fillStyle = color; g.textAlign = 'center'; g.fillText(s, x, y);
}

(async () => {
  TEXT('六人立绘对照　上排 = 192px 游戏内实际尺寸　下排 = ×2', W / 2, 30, 14, '#c8d4e0', true);

  for (let i = 0; i < ORDER.length; i++) {
    const it = ORDER[i];
    const img = await loadImage(path.join(ART, it.id + '.png'));
    const w = Math.round(img.width * H / img.height);
    const cx = PAD + CW * i + CW / 2;

    /* 第一排：实际尺寸，竖直对齐底线（脚踩同一条线才好比身高） */
    g.drawImage(img, Math.round(cx - w / 2), ROW1 + (H - H), w, H);

    /* 第二排：×2，画布容不下时按列宽缩，别裁头 */
    const z = Math.min(ZOOM, (CW - 8) / w, (H2 + 40 - 8) / H);
    const zw = Math.round(w * z), zh = Math.round(H * z);
    g.drawImage(img, Math.round(cx - zw / 2), Math.round(ROW2 + (H2 - zh) / 2), zw, zh);

    /* 名字 + 尺寸 + 三个识别词（第一排下面，三行依次往下） */
    const ty = ROW1 + H + 24;
    TEXT(it.name, cx, ty, 15, '#e8eef6', true);
    TEXT(w + '×' + H + '　宽 ' + Math.round(w / H * 100) + '%', cx, ty + 19, 11, '#8fa3b8');
    TEXT(it.note, cx, ty + 38, 10, '#6b7f94');
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'castline.png'), await c.encode('png'));
  console.log('✓ shots/castline.png  ' + W + '×' + TOTAL);
})();
