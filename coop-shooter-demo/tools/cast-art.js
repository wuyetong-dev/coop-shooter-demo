/* ==================================================================
   cast 立绘量测（给位图动作管线用）
   ------------------------------------------------------------------
   每张立绘要量出下面这几样，写进 BITMAP_CAST 配置：

     foot      脚底中心 x / 图宽          ← 决定「站在 x」时人往哪偏
     bottom    不透明区最下面一行          ← 脚底
     neck      脖子所在行 / 图高           ← 蹲下时头身分段切点
     legGap    下缘附近左右两团之间那道缝  ← 有缝才能拆两条腿
     hand      手的位置（人工确认后填）

   用法：
     node tools/cast-art.js                量全部
     node tools/cast-art.js kimi           只量一个
     node tools/cast-art.js kimi --probe   额外出一张标注图
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ART = path.join(__dirname, '..', 'art', 'cast');
const OUT = path.join(__dirname, '..', 'shots');
const NAMES = ['kimi', 'glm', 'gpt', 'grok', 'gemini', 'claude'];

/* 一行里连续不透明段（宽度 ≥ minW 才算一团，滤掉发丝） */
function runs(row, W, minW) {
  const out = [];
  let s = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && row[x * 4 + 3] > 24;
    if (on && s < 0) s = x;
    else if (!on && s >= 0) { if (x - s >= minW) out.push([s, x - 1]); s = -1; }
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv[2];
  const probe = process.argv.includes('--probe');
  const list = only ? [only] : NAMES;
  const report = {};

  for (const name of list) {
    const file = path.join(ART, name + '.png');
    if (!fs.existsSync(file)) { console.log('缺图', name); continue; }
    const img = await loadImage(fs.readFileSync(file));
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const c = createCanvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;

    /* 不透明区外框 */
    let top = H, bot = -1, lx = W, rx = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 24) {
          if (y < top) top = y;
          if (y > bot) bot = y;
          if (x < lx) lx = x;
          if (x > rx) rx = x;
        }
      }
    }

    /* 逐行宽度：脖子 = 肩宽以下最窄的一处（头宽和肩宽之间那道收腰） */
    const wAt = [];
    for (let y = 0; y < H; y++) {
      const rr = runs(d.subarray(y * W * 4, (y + 1) * W * 4), W, 2);
      wAt.push(rr.length ? (rr[rr.length - 1][1] - rr[0][0] + 1) : 0);
    }
    /* 在 top..top+55% 里找最窄行（脖子通常在头高 60~75% 处） */
    let neckY = -1, neckW = 1e9;
    const lo = top + Math.round((bot - top) * 0.24);
    const hi = top + Math.round((bot - top) * 0.40);
    for (let y = lo; y <= hi; y++) {
      if (wAt[y] > 2 && wAt[y] < neckW) { neckW = wAt[y]; neckY = y; }
    }

    /* 下缘 22%（腿区）：找左右两团的缝 */
    const legTop = bot - Math.round((bot - top) * 0.22);
    let gapRow = -1, gap = null;
    for (let y = bot - 3; y >= legTop; y--) {
      const rr = runs(d.subarray(y * W * 4, (y + 1) * W * 4), W, 3);
      if (rr.length >= 2) { gapRow = y; gap = [rr[0][1], rr[rr.length - 1][0]]; break; }
    }
    /* 脚底中心：最底 6 行不透明像素的 x 质心 */
    let fx = 0, fn = 0;
    for (let y = Math.max(0, bot - 5); y <= bot; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 24) { fx += x; fn++; }
      }
    }
    const footX = fn ? fx / fn : W / 2;

    /* 双腿可拆判定：腿区里连续 ≥3 行出现两团 */
    let splitRows = 0;
    for (let y = legTop; y <= bot; y++) {
      const rr = runs(d.subarray(y * W * 4, (y + 1) * W * 4), W, 3);
      if (rr.length >= 2) splitRows++;
    }

    /* ---------------- 拆腿矩形 ----------------
       不用整个腿区的外框 —— 裙摆侧边的披风、丝带也在腿区那一行里，
       按外框拆会把「披风下角」当成腿，一迈步披风跟着甩。
       改成只看**鞋子**：最底 10 行里左右两团的中心就是两条腿的轴线，
       腿片按固定宽度 (LEGW) 绕着这条轴线切，上缘再往上伸 PAD 像素
       藏进裙摆里（先画腿、后画躯干，伸进去那截被裙子盖住）。
       右团当 front（面朝 +x 时屏幕右就是前），左团当 back。 */
    const PAD = 16, LEGW = 26;
    let cL = null, cR = null;
    for (let y = Math.max(0, bot - 9); y <= bot; y++) {
      const rr = runs(d.subarray(y * W * 4, (y + 1) * W * 4), W, 3);
      if (rr.length < 2) continue;
      const L = rr[0], R = rr[rr.length - 1];
      const cxL = (L[0] + L[1]) / 2, cxR = (R[0] + R[1]) / 2;
      cL = cL === null ? cxL : (cL * 3 + cxL) / 4;
      cR = cR === null ? cxR : (cR * 3 + cxR) / 4;
    }
    /* cutY：腿区里两团分开的第一行（= 裙摆下缘） */
    let cutY = legTop;
    for (let y = legTop; y <= bot; y++) {
      const rr = runs(d.subarray(y * W * 4, (y + 1) * W * 4), W, 3);
      if (rr.length >= 2) { cutY = y; break; }
    }
    let legs = null;
    if (cL !== null && cR !== null && Math.abs(cR - cL) > 8) {
      const mk = (cx) => {
        const sx = Math.round(cx - LEGW / 2), sy = Math.max(0, cutY - PAD);
        return {
          sx, sy, sw: LEGW, sh: bot - sy + 1,
          cutX0: sx, cutX1: sx + LEGW, cutY,
          pivotX: Math.round(cx), pivotY: cutY - 6
        };
      };
      legs = { front: mk(cR), back: mk(cL) };
    }

    const r = {
      name, W, H, top, bot, lx, rx,
      foot: +(footX / W).toFixed(4),
      neck: +((neckY - top) / (bot - top)).toFixed(4),   /* 相对「身高」的比例 */
      neckY,
      legZone: [legTop, bot],
      gapAt: gapRow, gap,
      splitRows,
      splitOK: splitRows >= 3,
      legs
    };
    report[name] = r;
    console.log(
      name.padEnd(8),
      W + '×' + H,
      'box y' + top + '~' + bot + ' x' + lx + '~' + rx,
      '| foot ' + r.foot,
      '| neck ' + r.neck + ' (y' + neckY + ')',
      '| 双腿 ' + (r.splitOK ? '✓ 可拆 (' + splitRows + '行有缝)' : '✗ 只有一片'),
      gap ? ('缝 x' + gap[0] + '-' + gap[1] + ' @y' + gapRow) : ''
    );
    if (legs) {
      console.log('  front', JSON.stringify(legs.front));
      console.log('  back ', JSON.stringify(legs.back));
    }

    if (probe) {
      const S = 2;
      const pc = createCanvas(W * S, H * S);
      const pg = pc.getContext('2d');
      pg.drawImage(img, 0, 0, W * S, H * S);
      pg.lineWidth = 1;
      /* 脚底中心竖线 */
      pg.strokeStyle = '#ff3b6b';
      pg.beginPath(); pg.moveTo(footX * S, bot * S - 6); pg.lineTo(footX * S, bot * S + 40); pg.stroke();
      /* 脖子线 */
      pg.strokeStyle = '#3bff9e';
      pg.beginPath(); pg.moveTo(lx * S, neckY * S); pg.lineTo(rx * S, neckY * S); pg.stroke();
      /* 腿区上缘 */
      pg.strokeStyle = '#ffd23b';
      pg.beginPath(); pg.moveTo(lx * S, legTop * S); pg.lineTo(rx * S, legTop * S); pg.stroke();
      /* 外框 */
      pg.strokeStyle = 'rgba(120,180,235,0.8)';
      pg.strokeRect(lx * S, top * S, (rx - lx) * S, (bot - top) * S);
      fs.writeFileSync(path.join(OUT, 'cast-probe-' + name + '.png'), pc.toBuffer('image/png'));
      console.log('  标注图 shots/cast-probe-' + name + '.png');
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'art', 'cast', '_measure.json'),
    JSON.stringify(report, null, 2));
  console.log('\n已写 art/cast/_measure.json');
})();
