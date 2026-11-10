/* 立绘清理：按墨线圈定主体 → 裁掉外围 → 抠白底 → 连通域去碎块。
 *
 * 为什么不能只靠「颜色阈值抠白」：
 *   1) 生成图的背景不是纯白，是 245~251 的"近白"；象牙白发色也在 217~240，
 *      两者挨得太近，阈值一开就把头发吃掉。
 *   2) 图生图删掉某个东西后，原位置会留一圈很淡的描边残线（几百像素长、
 *      一两个像素宽）。它不是白的，漫水填充进不去 —— 反而**把外圈背景封住**，
 *      结果是整张画布都被当成主体，包围盒量出满幅（格克删斧后从 100px 变 128px，
 *      就是这么来的）。
 *
 * 所以改成两步定位：
 *   第一步 墨线包围盒：线稿的每一个部分都带着自己的描边，取「明显不是白」的像素
 *          （min 通道 < 195）的外接矩形，就一定是主体的范围。残线是 200~230 的
 *          淡灰，天然落在这个阈值之外，于是被裁掉。
 *   第二步 在这个矩形里漫水抠白 + 按连通域面积删剩下的碎块。
 *
 * 第三步 killHoles —— 补抠「被轮廓圈住的背景洞」
 *   四边漫水只能清掉连到画布外的背景。长发从头顶垂下来，和肩膀、衣服之间
 *   会围出一块封闭的空隙，水进不去，于是整块留在图上。玩家看到的就是
 *   「头发和衣服中间有条白边没抠干净」。
 *   判据（三条同时成立才清）：
 *     a) 块内几乎全是「中性亮」：min 通道 > 232 且三通道极差 ≤ 10。
 *        象牙白发是暖白（R-B 差 10 以上），天然排除；纯白亮面是中性但有描边，
 *        会被 b 挡掉。
 *     b) 块内一个暗像素都没有（min 通道 < 180）。线稿的每一块肉都带着自己的
 *        描边和阴影，一整块纯亮不可能是内容。
 *     c) 面积 > HOLE（@1024 尺度）。头发过曝的高光只是几十像素的碎点。
 *
 * 第四步 defringe —— 去边缘白晕
 *   边界上留着一圈 alpha 不满的浅灰（背景白与描边的抗锯齿混合）。原图尺度下
 *   只有一两个像素，缩到 192 高时被平均成一圈浅色描边，看起来同样像没抠干净。
 *   做法：挨着透明、且自己中性亮的像素，颜色换成邻域里第一个非中性亮像素的颜色，
 *   alpha 保留 —— 等于把边缘颜色往内侧推，缩小后混出来的是描边色，不再是白。
 *
 * 用法：node test/_clean.js <输入png> <输出png> [最小面积=200] [背景亮度]
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const INK = 195;   /* 低于这个亮度算"墨"，残线（200~230）落在阈值之上 */
const WHITE = 232; /* 高于这个亮度算"白"，漫水填充的可通行条件 */
const NEUTRAL = 232; /* 洞与白晕用的"中性亮"门槛 */
const HSV_SPREAD = 10; /* 中性 = 三通道极差不超过这个值；暖象牙白发差 10 以上 */
const HOLE = 1200; /* @1024 尺度。门槛为什么这么高：眼睛的高光是纯白，和背景洞同色同平，
                     小面积的高光点只能靠「够大才算洞」放过。实测真洞都在 1500 以上
                     （格克 16128/2131/1557，小克 2017，枢机 22076），眼睛 440。 */
const DARK = 180;  /* 洞内出现一个这么暗的像素，就说明那是内容不是背景 */

function inkBox(g, W, H) {
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 200) continue;
    if (Math.min(d[i], d[i + 1], d[i + 2]) < INK) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return (x1 < 0) ? null : { x0, y0, x1, y1 };
}

function floodWhite(c) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const id = g.getImageData(0, 0, W, H), d = id.data;
  const seen = new Uint8Array(W * H), st = [];
  const isW = i => d[i] > WHITE && d[i + 1] > WHITE && d[i + 2] > WHITE;
  for (let x = 0; x < W; x++) { st.push(x); st.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W); st.push(y * W + W - 1); }
  while (st.length) {
    const p = st.pop(); if (seen[p]) continue; seen[p] = 1;
    const i = p * 4; if (!isW(i)) continue; d[i + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1);
    if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W);
  }
  g.putImageData(id, 0, 0);
  return d;
}

function despeckle(c, d, minArea) {
  const W = c.width, H = c.height;
  const lab = new Int32Array(W * H).fill(-1), comps = [], q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (d[s * 4 + 3] === 0 || lab[s] >= 0) continue;
    const id = comps.length;
    let qh = 0, qt = 0, area = 0;
    q[qt++] = s; lab[s] = id;
    while (qh < qt) {
      const p = q[qh++]; area++;
      const x = p % W, y = (p / W) | 0;
      const push = k => { if (d[k * 4 + 3] !== 0 && lab[k] < 0) { lab[k] = id; q[qt++] = k; } };
      if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W); if (y < H - 1) push(p + W);
    }
    comps.push({ area, id });
  }
  comps.sort((a, b) => b.area - a.area);
  const keep = new Set(comps.filter((c2, i) => i === 0 || c2.area >= minArea).map(c2 => c2.id));
  let dropped = 0, droppedArea = 0;
  for (let p = 0; p < W * H; p++) {
    const l = lab[p];
    if (l < 0 || keep.has(l)) continue;
    d[p * 4 + 3] = 0; dropped++; droppedArea++;
  }
  const g = c.getContext('2d');
  const id2 = g.createImageData(W, H);
  id2.data.set(d);
  g.putImageData(id2, 0, 0);
  return { comps: comps.length, kept: keep.size, dropped };
}

/* 中性亮：象牙白发是「暖白」（R-B 差 10 以上），背景是「中性白」（三通道几乎相等） */
function neutral(d, i) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn > NEUTRAL && mx - mn <= HSV_SPREAD;
}

/* 第三步：补抠「被轮廓圈住的背景洞」。
 * 判据是四条同时成立 —— 单靠颜色不行，因为象牙白发和背景只差十几个色阶：
 *   a) 整块都是中性亮；
 *   b) 块内亮度标准差 < 3.5 —— 背景是均匀受光的一片，头发和衣服哪怕纯白
 *      也有褶皱阴影，实测白衣 sd 普遍 5~6；
 *   c) 面积 >= HOLE；
 *   d) 块的真实边界上，**不属于背景色**的邻居占比 >= 50%。
 *      "不属于背景色"= 非「中性亮」（也就是不光、不中性：深描边、象牙白发、
 *      彩色的衣服都算）。洞是被主体围出来的，四周一定是这些东西；
 *      而被白尾巴包住的白高光，四周全是中性亮 —— 这一条把它挡掉。
 *      (d) 必须用逐像素邻接，不能用包围盒外扩：第一版用 bbox 外扩 3px 的矩形环，
 *      细长块的外接矩形会揽进隔壁的深色描边，暗占比虚高到 58%，结果枢机龙尾
 *      上被打出一个洞。
 *      也试过用「邻居里暗像素占比」代替：格克的头发边缘是过曝的浅色抗锯齿，
 *      一点都不暗，结果真洞一个都没抓到。所以判据是"非背景"而不是"暗"。
 *   e) 块的颜色与「画布外的背景色」相差不超过 4 —— 决定性判据。
 *      白裙也平、也亮、也被描边围着，和被围住的洞长得一模一样：(a)~(d) 全过。
 *      只有颜色能把它们分开：枢机白裙 241，背景 254.8，差 13.8；洞 254.2，差 0.6。
 *      背景色默认从画布四边框采样；已经抠过图的源图边框 RGB 会被归零（透明像素
 *      编码时预乘），那就必须用第 4 个参数显式传进来，否则本判据直接跳过。 */
function killHoles(c, d, minHole, bg) {
  const W = c.width, H = c.height, N = W * H;
  const lab = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  const blocks = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0) continue;
    const i0 = s * 4;
    if (d[i0 + 3] < 8 || !neutral(d, i0)) continue;
    const id = blocks.length;
    let qh = 0, qt = 0, area = 0, sum = 0, sum2 = 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const px = [];
    q[qt++] = s; lab[s] = id;
    while (qh < qt) {
      const p = q[qh++]; area++; px.push(p);
      const i = p * 4;
      const L = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += L; sum2 += L * L;
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const push = k => { if (lab[k] < 0 && d[k * 4 + 3] >= 8 && neutral(d, k * 4)) { lab[k] = id; q[qt++] = k; } };
      if (x > 0) push(p - 1); if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W); if (y < H - 1) push(p + W);
    }
    const mean = sum / area;
    blocks.push({ id, area, mean, sd: Math.sqrt(Math.max(0, sum2 / area - mean * mean)), x0, y0, x1, y1, px });
  }

  /* 块的真实边界：逐像素看 8 邻域里「不属于本块」的不透明像素，
     统计其中「非背景色」（= 非中性亮）的占比。
     不能用包围盒外扩 —— 细长块的外接矩形会揽进隔壁的深色描边。 */
  const nonBgRatioOf = b => {
    let n = 0, nonBg = 0;
    for (const p of b.px) {
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (lab[k] === b.id) continue;
        const i = k * 4;
        if (d[i + 3] < 8) continue;
        n++;
        if (!neutral(d, i)) nonBg++;
      }
    }
    return n ? nonBg / n : 0;
  };

  const killed = [];
  const marked = [];   /* 被清掉的像素，留着画审核图 */
  for (const b of blocks) {
    if (b.area < minHole || b.sd > 3.5) continue;
    /* e) 与画布外的背景同色 —— 这条才是真正决定性的。
       白色衣服（枢机的白裙）和背景洞一样「平、亮、被描边围住」，
       唯一的分野是颜色：洞 = 背景原色，白裙偏冷偏暗十几个色阶。 */
    if (bg !== null && Math.abs(b.mean - bg) > 4) continue;
    const nb = nonBgRatioOf(b);
    if (nb < 0.5) continue;
    /* 真的判成洞了，才去翻像素把它抹掉 */
    for (const p of b.px) { d[p * 4 + 3] = 0; marked.push(p); }
    killed.push({ area: b.area, sd: b.sd, dark: nb, at: b.x0 + ',' + b.y0 });
  }
  killHoles.marked = marked;
  const g = c.getContext('2d');
  const id2 = g.createImageData(W, H);
  id2.data.set(d);
  g.putImageData(id2, 0, 0);
  return killed;
}

/* 第四步：去边缘白晕。
 * 洞清掉之后，边界上还留着一圈亮度 200~240 的灰白（背景白和描边混出来的）。
 * 原图尺度下就一两个像素，缩到 192 高会被平均成一道浅线 —— 看着仍然像没抠净。
 *
 * 难点：象牙白发本身也在这个亮度区间（实测 217~240），单靠颜色切不开。
 * 所以判据换成「相对关系」：这个像素是否比它内侧 3px 内的深色邻居亮 25 以上？
 *   - 抗锯齿白边（230）挨着黑描边（80）→ 差 150，命中，换成描边色；
 *   - 头发边缘（235）挨着发色（230）→ 差 5，不动。
 * 纯白角色（枢机）边缘没有深色邻居，整条跳过 —— 它的白边和背景本来就没区别。 */
function defringe(c, d) {
  const W = c.width, H = c.height, N = W * H;
  const src = new Uint8ClampedArray(d);
  let fixed = 0;
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (src[i + 3] < 8) continue;
    const r = src[i], g2 = src[i + 1], b = src[i + 2];
    const mn = Math.min(r, g2, b), mx = Math.max(r, g2, b);
    if (mn <= 200 || mx - mn > 16) continue;
    const L = (r + g2 + b) / 3;
    const x = p % W, y = (p / W) | 0;
    let edge = false;
    if (x > 0 && src[(p - 1) * 4 + 3] < 8) edge = true;
    if (!edge && x < W - 1 && src[(p + 1) * 4 + 3] < 8) edge = true;
    if (!edge && y > 0 && src[(p - W) * 4 + 3] < 8) edge = true;
    if (!edge && y < H - 1 && src[(p + W) * 4 + 3] < 8) edge = true;
    if (!edge) continue;
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (src[k * 4 + 3] < 8) continue;
      const l2 = (src[k * 4] + src[k * 4 + 1] + src[k * 4 + 2]) / 3;
      if (l2 > L - 25) continue;
      n++; sr += src[k * 4]; sg += src[k * 4 + 1]; sb += src[k * 4 + 2];
    }
    if (!n) continue;
    d[i] = sr / n; d[i + 1] = sg / n; d[i + 2] = sb / n;
    fixed++;
  }
  const g = c.getContext('2d');
  const id3 = g.createImageData(W, H);
  id3.data.set(d);
  g.putImageData(id3, 0, 0);
  return fixed;
}

function trim(c, d) {  const W = c.width, H = c.height;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] < 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return c;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const o = createCanvas(w, h);
  o.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return o;
}

(async () => {
  const [, , inp, outp, minArg] = process.argv;
  if (!inp || !outp) { console.error('用法：node test/_clean.js <输入png> <输出png> [最小面积=200] [背景亮度]'); process.exit(1); }
  const minArea = +(minArg || 200);
  const bgArg = process.argv[5];
  const img = await loadImage(inp);

  /* 先整体取墨线框，再带一点余量裁出来 */
  const full = createCanvas(img.width, img.height);
  full.getContext('2d').drawImage(img, 0, 0);
  const ib = inkBox(full.getContext('2d'), img.width, img.height);
  if (!ib) { console.error('找不到墨线，可能不是线稿'); process.exit(1); }
  const M = 6;
  const cx = Math.max(0, ib.x0 - M), cy = Math.max(0, ib.y0 - M);
  const cw = Math.min(img.width - cx, ib.x1 - ib.x0 + 1 + M * 2);
  const ch = Math.min(img.height - cy, ib.y1 - ib.y0 + 1 + M * 2);
  const crop = createCanvas(cw, ch);
  crop.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

  /* 背景色采样：画布四边框 2px 环的 RGB 均值。
     已经抠过图的源图这里会拿到接近 0 的值（透明像素编码时 RGB 被归零），
     此时视为「未知」，除非命令行给了 bg。 */
  const sampleBg = cv => {
    const W2 = cv.width, H2 = cv.height;
    const dd = cv.getContext('2d').getImageData(0, 0, W2, H2).data;
    let n = 0, s2 = 0, aa = 0;
    const add = (x, y) => { const i = (y * W2 + x) * 4; s2 += (dd[i] + dd[i + 1] + dd[i + 2]) / 3; aa += dd[i + 3]; n++; };
    for (let x = 0; x < W2; x++) { add(x, 0); add(x, 1); add(x, H2 - 1); }
    for (let y = 0; y < H2; y++) { add(0, y); add(1, y); add(W2 - 1, y); }
    return { lum: s2 / n, alpha: aa / n };
  };
  let bg = bgArg !== undefined ? +bgArg : null;
  if (bg === null) {
    const sb = sampleBg(full);
    if (sb.alpha > 200 && sb.lum > 200) bg = sb.lum;
    else console.log('⚠ 边框已被清成透明（' + sb.lum.toFixed(1) + '），拿不到背景色 —— 「与背景同色」判据跳过。用第 4 个参数传背景亮度。');
  }

  /* 审核图：把「判成洞」的区域涂成品红，叠在原图上。判据每调一次都该看一眼，
     因为误伤的形态（尾巴被打洞、裙子被啃缺口）肉眼一秒能认出来，日志认不出来。 */
  const renderHoles = (srcCanvas, marked, w, h) => {
    const o = createCanvas(w, h), g2 = o.getContext('2d');
    g2.drawImage(srcCanvas, 0, 0);
    const id3 = g2.getImageData(0, 0, w, h);
    for (const p of marked) { id3.data[p * 4] = 255; id3.data[p * 4 + 1] = 0; id3.data[p * 4 + 2] = 255; id3.data[p * 4 + 3] = 255; }
    g2.putImageData(id3, 0, 0);
    return o;
  };
  const cropCopy = createCanvas(cw, ch);
  cropCopy.getContext('2d').drawImage(crop, 0, 0);

  const d = floodWhite(crop);
  const sp = despeckle(crop, d, minArea);
  /* 补抠封闭洞 —— 顺序很关键：必须在漫水之后（那时才知道哪些是背景），
     又必须在 trim 之前（洞会影响包围盒吗？不会，但会被后续裁剪带歪判断） */
  const holes = killHoles(crop, d, HOLE, bg);
  const fr = defringe(crop, d);
  const out = trim(crop, crop.getContext('2d').getImageData(0, 0, cw, ch).data);

  fs.mkdirSync(path.dirname(outp), { recursive: true });
  fs.writeFileSync(outp, await out.encode('png'));
  if (process.env.HOLE_DEBUG) {
    const hc = renderHoles(cropCopy, killHoles.marked || [], cw, ch);
    fs.writeFileSync(outp.replace(/\.png$/, '') + '-holes.png', await hc.encode('png'));
  }
  console.log('墨线框 ' + (ib.x1 - ib.x0 + 1) + '×' + (ib.y1 - ib.y0 + 1) + '（原图 ' + img.width + '×' + img.height + '）');
  console.log('连通域 ' + sp.comps + ' 个／保留 ' + sp.kept + ' 个');
  console.log('背景色 ' + (bg === null ? '未知' : bg.toFixed(1)));
  console.log('封闭洞 ' + holes.length + ' 处' + (holes.length ? '：' + holes.map(h => h.area + 'px@' + h.at + '(sd' + h.sd.toFixed(1) + ' 环暗' + Math.round(h.dark * 100) + '%)').join(' ') : ''));
  console.log('边缘白晕修正 ' + fr + ' 像素');
  console.log('✓ ' + outp + '  ' + out.width + '×' + out.height);
})();
