/* 把 AI 生成的姿态图修成能入画的素材：
   1) 去掉抗锯齿白边（否则缩到 87px 宽时整个人蒙一层灰雾）
   2) 按「头盔宽度」定标缩放到游戏尺度（头是硬壳，是唯一比例不变的参照物）
   3) 裁掉四周空边，脚底贴到画布最后一行
   用法：node tools/skel/posefix.js 输入.png 输出.png 目标头宽 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const A = (d, p) => d[p * 4 + 3];

/* 先腐蚀：AI 图在棋盘格上生成，轮廓外侧天生有一圈与白色混合的过渡像素。
   那圈像素的 alpha 是 255、颜色却是「角色色 + 白」，光靠换色救不回来，
   必须整圈剃掉。1024 尺度下剃 2px，缩回 90px 宽时不到 0.2px，看不出瘦。 */
function erode(id, W, H, rounds) {
  const d = id.data;
  const A = (p) => d[p * 4 + 3];
  for (let it = 0; it < rounds; it++) {
    const dead = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (A(p) <= 40) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || A(ny * W + nx) <= 40) { hit = true; break; }
      }
      if (hit) dead.push(p);
    }
    for (const p of dead) d[p * 4 + 3] = 0;
  }
  return id;
}

/* 颜色外渗（matte bleeding）：透明区的 RGB 仍是白色，缩小做双线性时
   会把白掺进轮廓，形成一圈灰白描边。做法是把边缘色往透明区里推几圈，
   alpha 保持 0 —— 缩小插值取到的是「和角色同色」的邻居，白边就没有了。 */
function bleed(id, W, H, rounds) {
  const d = id.data;
  const A = (p) => d[p * 4 + 3];
  for (let it = 0; it < rounds; it++) {
    const upd = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (A(p) > 0) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (A(q) === 0) continue;
        r += d[q * 4]; g += d[q * 4 + 1]; b += d[q * 4 + 2]; n++;
      }
      if (n) upd.push([p, r / n, g / n, b / n]);
    }
    for (const u of upd) { d[u[0] * 4] = u[1]; d[u[0] * 4 + 1] = u[2]; d[u[0] * 4 + 2] = u[3]; }
  }
  return id;
}

function defringe(id, W, H) {
  const d = id.data;
  /* 第一遍：把和透明区相邻的像素标出来 */
  const rim = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (A(d, p) <= 40) continue;
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { hit = true; break; }
      if (A(d, (ny * W + nx)) <= 40) { hit = true; break; }
    }
    if (hit) rim[p] = 1;
  }
  /* 第二遍：边缘 2px 内、不透明的内部像素取平均色，把白边染回来 */
  const out = new Uint8Array(rim);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!rim[p]) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (rim[q] || A(d, q) < 250) continue;
      r += d[q * 4]; g += d[q * 4 + 1]; b += d[q * 4 + 2]; n++;
    }
    if (n > 0) { d[p * 4] = r / n; d[p * 4 + 1] = g / n; d[p * 4 + 2] = b / n; }
    else out[p] = 2;               /* 找不到干净邻居 → 直接扔掉这一圈 */
  }
  for (let p = 0; p < W * H; p++) if (out[p] === 2) d[p * 4 + 3] = 0;
  return id;
}

/* 缩完之后再修一次边缘。缩放在目标尺寸上重新生成了半透明边：
   这些像素的颜色是「角色色 + 白」的混合，比内部还亮，远看就是一圈灰白描边。
   原站立立绘的做法正相反 —— 边缘比内部更暗（有描边线）。
   所以把半透明像素的颜色换成内侧不透明像素的颜色，alpha 不动。 */
function fixRim(id, W, H) {
  const d = id.data;
  const A = (p) => d[p * 4 + 3];
  const out = [];
  let miss = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    const a = A(p);
    if (a === 0 || a >= 235) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const q = (y + dy) * W + (x + dx);
      if (A(q) < 235) continue;
      r += d[q * 4]; g += d[q * 4 + 1]; b += d[q * 4 + 2]; n++;
    }
    if (n) out.push([p, r / n, g / n, b / n]);
    else miss++;
  }
  for (const u of out) { d[u[0] * 4] = u[1]; d[u[0] * 4 + 1] = u[2]; d[u[0] * 4 + 2] = u[3]; }
  if (process.env.DBG) console.log('  fixRim: 处理', out.length, ' 无邻居跳过', miss);
  return id;
}

(async () => {
  const [src, dst, headS] = process.argv.slice(2);
  const targetHead = Number(headS);
  const im = await loadImage(src);
  const W = im.width, H = im.height;
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  g.drawImage(im, 0, 0);
  let id = g.getImageData(0, 0, W, H);
  const ERO = Number(process.env.ERO || 2);
  if (ERO > 0) id = erode(id, W, H, ERO);
  id = defringe(id, W, H);
  id = bleed(id, W, H, Number(process.env.BLEED || 6));
  g.putImageData(id, 0, 0);
  const d = id.data;

  const bbox = () => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (A(d, y * W + x) > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
  };
  const bb = bbox();
  /* 头顶往下 40% 内最宽的一行 = 头盔最大宽 */
  let headW = 0;
  for (let y = bb.y0; y < bb.y0 + bb.bh * 0.4; y++) {
    let a = 1e9, b = -1;
    for (let x = bb.x0; x <= bb.x1; x++) if (A(d, y * W + x) > 40) { if (x < a) a = x; if (x > b) b = x; }
    if (b > 0 && b - a + 1 > headW) headW = b - a + 1;
  }
  const s = targetHead / headW;
  const OW = Math.max(1, Math.round(bb.bw * s)), OH = Math.max(1, Math.round(bb.bh * s));

  const oc = createCanvas(OW, OH), og = oc.getContext('2d');
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = 'high';
  og.drawImage(cv, bb.x0, bb.y0, bb.bw, bb.bh, 0, 0, OW, OH);
  const oid = og.getImageData(0, 0, OW, OH);
  fixRim(oid, OW, OH);
  /* 写回同一块 canvas 再 toBuffer 时颜色没跟上，所以落在一块新画布上 */
  const oc2 = createCanvas(OW, OH);
  oc2.getContext('2d').putImageData(oid, 0, 0);
  fs.writeFileSync(dst, oc2.toBuffer('image/png'));
  console.log(path.basename(dst), OW + 'x' + OH, '头宽', headW, '→', targetHead, 'scale', s.toFixed(4));
})();
