#!/usr/bin/env node
/* 立绘标准化：抠背景 → 裁内容框 → 补边到指定宽高比 → 阶梯降采样
 *
 * 为什么要走这一套：
 *   1) 生图工具只回不透明图，背景是烘进像素的浅色，必须自己抠。用「从四边泛洪」
 *      而不是「把所有近白像素变透明」—— 她的白围裙、白荷叶边也是近白色，全局色键
 *      会把围裙一起挖空。泛洪只吃与画布边缘连通的区域，围裙被黑轮廓线包住，碰不到。
 *   2) 一次 1024→192 是 5:1 降采样，浏览器/Canvas 双线性会跳采样，细轮廓断成一串
 *      虚线。逐级减半（1024→512→256→192 附近）等于手工做 box filter，轮廓才连续。
 *   3) 游戏里按 WHALE_VH 绘制，物理碰撞盒是另一套数。这里只管「视觉像素」，
 *      不动任何碰撞量，所以对玩法零影响。
 *
 * 用法:
 *   node tools/whale-prep.js --in art/v2/xxx.png --out art/whale_idle_v2.png
 *   node tools/whale-prep.js --in a.png --out b.png --ar 0.604 --vh 192
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/* 从四边泛洪，把与边缘连通的近背景色像素标成透明。
   容差按「到背景色的切比雪夫距离」算，比欧氏距离更快也够用。 */
function cutout(ctx, w, h, tol) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const seen = new Uint8Array(w * h);
  /* 背景色取四角的平均，别写死 249 —— 不同批次的图底色会飘一两级 */
  let br = 0, bg = 0, bb = 0, n = 0;
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const i = (y * w + x) * 4;
    br += d[i]; bg += d[i + 1]; bb += d[i + 2]; n++;
  }
  br /= n; bg /= n; bb /= n;

  const near = (i) =>
    Math.max(Math.abs(d[i] - br), Math.abs(d[i + 1] - bg), Math.abs(d[i + 2] - bb)) <= tol;

  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (seen[p]) return;
    if (!near(p * 4)) return;
    seen[p] = 1;
    q.push(x, y);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  while (q.length) {
    const y = q.pop(), x = q.pop();
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }

  /* 边缘羽化：只对「被标记为背景」但又不是纯背景色的像素保留部分 alpha。
     硬切会在描边外留一圈背景色残边，缩到 96px 就是一圈灰白毛刺。 */
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    if (!seen[p]) continue;
    const i = p * 4;
    const dist = Math.max(Math.abs(d[i] - br), Math.abs(d[i + 1] - bg), Math.abs(d[i + 2] - bb));
    if (dist <= tol * 0.45) d[i + 3] = 0;
    else { d[i + 3] = Math.round(255 * (dist / tol - 0.45) / 0.55); }
    cleared++;
  }
  ctx.putImageData(id, 0, 0);
  return { cleared, bg: [Math.round(br), Math.round(bg), Math.round(bb)] };
}

function bboxOf(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* 阶梯降采样：每次最多减半，避免一次大比例跳采样 */
function stepDown(src, tw, th) {
  let cur = src;
  while (cur.width / 2 > tw && cur.height / 2 > th) {
    const c = createCanvas(Math.max(tw, Math.round(cur.width / 2)), Math.max(th, Math.round(cur.height / 2)));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const c = createCanvas(tw, th);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, tw, th);
  return c;
}

(async () => {
  const inPath = arg('in');
  const outPath = arg('out');
  const AR = parseFloat(arg('ar', '0.604'));   /* 116/192 */
  const VH = parseInt(arg('vh', '192'), 10);
  const TOL = parseInt(arg('tol', '30'), 10);
  if (!inPath || !outPath) { console.error('需要 --in 与 --out'); process.exit(1); }
  if (!fs.existsSync(inPath)) { console.error('找不到 ' + inPath); process.exit(1); }

  const img = await loadImage(inPath);
  const src = createCanvas(img.width, img.height);
  const sx = src.getContext('2d');
  sx.drawImage(img, 0, 0);

  const cut = cutout(sx, img.width, img.height, TOL);
  const bb = bboxOf(sx, img.width, img.height);
  console.log(`输入 ${path.basename(inPath)}  ${img.width}x${img.height}`);
  console.log(`  背景色 rgb(${cut.bg.join(',')}) 抠掉 ${cut.cleared} px`);
  console.log(`  内容框 ${bb.x0},${bb.y0} → ${bb.x1},${bb.y1}  (${bb.w}x${bb.h})`);

  /* 目标画布：高 VH，宽按 AR 反推。
     一律「高度贴满 + 底部对齐」，宽度超出就左右各裁一点。
     为什么不用「宽度约束」那条路：两张图（待机/握枪）的内容宽高比不一样
     （实测 0.610 和 0.640，都宽于 0.604），按宽度缩会让其中一张矮 10px，
     切姿势时人物会突然「矮一截」。高度贴满才是稳的，多出来的宽度是头发
     边缘，裁掉 3px 看不出来。 */
  const TW = Math.round(VH * AR);
  const H2 = VH * 4, W2 = TW * 4;
  const scale = H2 / bb.h;
  const dw = Math.round(bb.w * scale);          /* 按高度放好之后有多宽 */
  const dh = H2;

  const stage = createCanvas(W2, H2);
  const cx2 = stage.getContext('2d');
  cx2.imageSmoothingEnabled = true; cx2.imageSmoothingQuality = 'high';
  const trimSide = Math.max(0, Math.round((dw - W2) / 2));   /* 每边要裁掉多少 */
  const sw = Math.max(1, Math.round(W2 / scale));       /* 源图里对应取多宽 */
  cx2.drawImage(src,
    bb.x0 + Math.round((bb.w - sw) / 2), bb.y0, sw, bb.h,
    0, 0, W2, H2);
  if (trimSide > 0) console.log(`  横向裁切 ${trimSide}px/边（原始 ${dw}px 宽，目标 ${W2}px）`);

  const out = stepDown(stage, TW, VH);
  const buf = out.toBuffer('image/png');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(`  输出 ${path.basename(outPath)}  ${TW}x${VH}  ${(buf.length / 1024).toFixed(1)} KB`);
  console.log(`  比例 ${(TW / VH).toFixed(3)}（目标 ${AR}）`);
})();
