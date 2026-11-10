/* ==================================================================
   AI 娘立绘：裁切 → 统一到游戏内尺寸 → 拼对照表
   ------------------------------------------------------------------
   为什么必须统一到 192 高再比：
   生成图是 1024×1536，直接并排看是「五张插画」，看不出它们是不是
   同一套 sprite。缩到游戏内实际高度（192px）再并排，才是玩家真正
   会看到的画面 —— 细节够不够、剪影分不分得开，在这一步才成立。

   跑法：node test/_cast.js
   ================================================================== */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'shots');
const CAST = path.join(ROOT, 'art', 'cast');

/* 五个角色：文件、名字、网络上流传的形象锚点（写图里，防止以后忘了为什么这么画） */
const ROSTER = [
  {
    key: 'buddy', name: '大肥鱼', real: 'DeepSeek',
    file: path.join(ROOT, 'art', 'v2', 'idle_cut.png'),
    canon: '蓝渐变长发·鲸头鳍·鲸尾',
    note: '已在用'
  },
  {
    key: 'kimi', name: '奇米', real: 'Kimi / 月之暗面',
    file: path.join(CAST, 'Japanese_chibi_anime_game_spri_2026-10-29T12-24-47.png'),
    canon: '银白长发·深蓝白礼服·K 字徽章·月轮',
    note: '国模一姐 / 高冷'
  },
  {
    key: 'glm', name: '知源', real: 'GLM / 智谱',
    file: path.join(CAST, 'Japanese_chibi_anime_game_spri_2026-10-29T12-27-25.png'),
    canon: '黑发猫耳·黑猫女仆·Z 徽章·抱手册',
    note: '清华学霸 / 勤快'
  },
  {
    key: 'gpt', name: '枢机', real: 'GPT / OpenAI',
    file: path.join(CAST, 'Japanese_chibi_anime_game_spri_2026-10-29T12-25-28.png'),
    canon: '白龙娘·龙角·龙翼·华服',
    note: '核弹霸主 / 傲慢'
  },
  {
    key: 'claude', name: '小克', real: 'Claude / Anthropic',
    file: path.join(CAST, 'Japanese_chibi_anime_game_spri_2026-10-29T12-25-41.png'),
    canon: '橘发·葵花发饰·荆棘冠·白裙',
    note: '审核修罗 / 被囚的圣女'
  },
  {
    key: 'gemini', name: '双子', real: 'Gemini / Google',
    file: path.join(CAST, 'Japanese_chibi_anime_game_spri_2026-10-29T12-28-07.png'),
    canon: '彩虹发·四角星猫耳·反戴棒球帽·四色运动服',
    note: '故障萌妹 / 什么都会但会宕机'
  },
  {
    key: 'grok', name: '格克', real: 'Grok / xAI',
    file: path.join(CAST, 'Japanese_chibi_anime_game_spri_2026-10-29T12-28-21.png'),
    canon: '金发双马尾·小皇冠·魅魔翅·扛巨斧',
    note: '嘴臭叛逆 / 无审核'
  }
];

const SPRITE_H = 192;   /* 游戏内实际立绘高度 */

/* 白底抠图：**不能按颜色直接删白**。
   角色身上的白裙、白围裙、白龙翼、白手册也是白的，一刀切会把它们挖空。
   正确做法是从画面四边向内漫水填充：只删「和边缘连通的近白区域」。
   角色内部的白色一定是被轮廓封住的，填不进去，于是自动保住。
   （第一版就是漏了这一步，结果剪影行五格里四格是整块白矩形） */
function cutout(cv) {
  const c = createCanvas(cv.width, cv.height);
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0);
  const W = c.width, H = c.height;
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  const nearWhite = i => d[i + 3] > 8 && d[i] > 236 && d[i + 1] > 236 && d[i + 2] > 236;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1);
  for (let y = 0; y < H; y++) stack.push(0, y, W - 1, y);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (seen[p]) continue;
    const i = p * 4;
    if (!nearWhite(i)) continue;
    seen[p] = 1;
    d[i + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  g.putImageData(im, 0, 0);
  return c;
}

/* 裁到角色包围盒。抠过之后 alpha 就是唯一真相，不用再判白。 */
function bboxOf(cv) {
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      if (d[(y * cv.width + x) * 4 + 3] < 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* 裁出来 + 缩到统一高度，返回离屏 canvas。
   顺序不能反：先抠白底（cutout）→ 再算包围盒（bboxOf）→ 再缩放。
   反过来的话包围盒会按「整张白底矩形」算，缩出来的人只有指甲盖大。 */
function normalize(img, H) {
  const raw = createCanvas(img.width, img.height);
  const rg = raw.getContext('2d');
  rg.drawImage(img, 0, 0);
  const cut = cutout(raw);
  const bb = bboxOf(cut);
  if (!bb) return null;
  const k = H / bb.h;
  const w = Math.max(1, Math.round(bb.w * k));
  const c = createCanvas(w, H);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cut, bb.x, bb.y, bb.w, bb.h, 0, 0, w, H);
  return { canvas: c, w, h: H, src: bb };
}

/* ---------------- 剪影：把不透明像素全涂黑，只看轮廓 ---------------- */
function silhouetteOf(cv) {
  const c = createCanvas(cv.width, cv.height);
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#dfe9f5';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/* IoU：两张同高剪影的并集/交集。这是个诚实的距离 —— 不用调参，
   涂黑重叠面积就完事。 */
function iou(a, b) {
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height);
  function mask(cv) {
    const c = createCanvas(W, H);
    const g = c.getContext('2d');
    /* 底部对齐、水平居中：姿势图都是站着的，脚底对齐才有意义 */
    g.drawImage(cv, Math.round((W - cv.width) / 2), H - cv.height);
    return g.getImageData(0, 0, W, H).data;
  }
  const A = mask(a), B = mask(b);
  let inter = 0, uni = 0;
  for (let i = 3; i < A.length; i += 4) {
    const pa = A[i] > 60, pb = B[i] > 60;
    if (pa && pb) inter++;
    if (pa || pb) uni++;
  }
  return uni ? inter / uni : 0;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const items = [];
  for (const r of ROSTER) {
    if (!fs.existsSync(r.file)) { console.log('缺图: ' + r.file); continue; }
    const img = await loadImage(r.file);
    const n = normalize(img, SPRITE_H);
    if (!n) { console.log('裁不出角色: ' + r.key); continue; }
    items.push({ ...r, ...n });
    console.log(
      (r.name + '        ').slice(0, 8) +
      '源 ' + img.width + '×' + img.height +
      '  →  ' + n.w + '×' + n.h +
      '  (宽高比 ' + (n.w / n.h).toFixed(2) + ')'
    );
    /* 顺手存一份裁好的成图，后面接位图立绘直接用 */
    if (r.key !== 'buddy') {
      fs.writeFileSync(path.join(CAST, r.key + '.png'), await n.canvas.encode('png'));
    }
  }

  /* ---------------- 两两 IoU ---------------- */
  const sil = items.map(it => silhouetteOf(it.canvas));
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push({ a: items[i].name, b: items[j].name, v: iou(sil[i], sil[j]) });
    }
  }
  pairs.sort((x, y) => y.v - x.v);
  console.log('\n剪影相似度（IoU，越低越容易区分）:');
  for (const p of pairs.slice(0, 6)) {
    console.log('  ' + p.a + ' × ' + p.b + '  ' + p.v.toFixed(3));
  }

  /* ---------------- 出图 ---------------- */
  const COLS = items.length;
  const PAD = 16, CELL_W = 176, CELL_H = 250;
  const W = COLS * CELL_W + PAD * 2;
  const TOP = 64, SIL_ROW = TOP, ORIG_ROW = TOP + CELL_H + 30;
  const H = ORIG_ROW + CELL_H + 118;

  const sheet = createCanvas(W, H);
  const g = sheet.getContext('2d');
  g.fillStyle = '#070b10';
  g.fillRect(0, 0, W, H);

  const T = (s, x, y, size, color, bold, center) => {
    g.fillStyle = color || '#9fb3c6';
    g.font = (bold ? 'bold ' : '') + size + 'px "Microsoft YaHei",sans-serif';
    g.textBaseline = 'top';
    g.textAlign = center ? 'center' : 'left';
    g.fillText(s, x, y);
    g.textAlign = 'left';
  };

  T('AI 娘 · 统一到游戏内尺寸（192px 高）后的真实观感', PAD, 10, 17, '#7ee0a0', true);
  T('上排＝剪影　下排＝原色　·　每格宽度就是实际占地宽度', PAD, 34, 12, '#7c8b99');

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cx = PAD + CELL_W * i + CELL_W / 2;
    const bx = Math.round(cx - it.w / 2);

    /* 剪影格 */
    g.fillStyle = '#0d1620';
    g.fillRect(PAD + CELL_W * i + 6, SIL_ROW, CELL_W - 12, CELL_H);
    g.drawImage(sil[i], Math.round(cx - sil[i].width / 2), SIL_ROW + CELL_H - SPRITE_H);

    /* 原色格 */
    g.fillStyle = '#101a24';
    g.fillRect(PAD + CELL_W * i + 6, ORIG_ROW, CELL_W - 12, CELL_H);
    g.drawImage(it.canvas, bx, ORIG_ROW + CELL_H - SPRITE_H);

    /* 脚底基准线：所有人脚底必须落在同一条线上 */
    const footY = ORIG_ROW + CELL_H - 1;
    g.strokeStyle = 'rgba(255,90,90,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD + CELL_W * i + 6, footY + 0.5);
    g.lineTo(PAD + CELL_W * i + CELL_W - 6, footY + 0.5);
    g.stroke();

    /* 名字 + 现实对应 + 网络形象锚点 */
    const y0 = ORIG_ROW + CELL_H + 8;
    T(it.name, cx, y0, 17, '#e6eef7', true, true);
    T(it.real, cx, y0 + 22, 11, '#7c8b99', false, true);
    T(it.canon, cx, y0 + 40, 10, '#5f8ba8', false, true);
    T(it.note, cx, y0 + 56, 10, 'rgba(126,224,160,0.75)', false, true);
  }

  /* 底部：最像的一对，直接指出该改谁 */
  const worst = pairs[0];
  const DY = H - 34;
  g.fillStyle = worst.v > 0.85 ? 'rgba(255,120,110,0.14)' : 'rgba(126,224,160,0.12)';
  g.fillRect(8, DY, W - 16, 26);
  T('最像的一对：' + worst.a + ' × ' + worst.b + '　IoU ' + worst.v.toFixed(3) +
    (worst.v > 0.85 ? '　← 仍然撞了，得改骨架' : '　← 可以靠颜色和武器分开'),
    18, DY + 6, 12, worst.v > 0.85 ? '#ffb3a6' : '#9fe0b8', true);

  fs.writeFileSync(path.join(OUT, 'cast-sheet.png'), await sheet.encode('png'));
  console.log('\n✓ shots/cast-sheet.png  (' + W + '×' + H + ')');
  console.log('✓ art/cast/{kimi,glm,gpt,claude}.png');
})();
