/* 用法: node test/_legmetric.js shot.png cx1,cy1 cx2,cy2 ...
   对每个「脚底中心」(cx,cy)，在 cx±22 / cy-24..cy+8 的窗口里统计腿部像素：
   - 左半 / 右半 各自的最低行（鞋底高度）与像素数
   - 腿顶行（裙摆下缘露出的高度）
   用来数值验证「摆腿」到底有没有把脚抬起来，不靠肉眼。
   背景 #20262e + 网格线 + 脚心白色刻度线都要排除。 */
const fs = require('fs'), zlib = require('zlib');
function readPNG(f) {
  const b = fs.readFileSync(f);
  let p = 8, w, h, idat = [], ct;
  while (p < b.length) {
    const len = b.readUInt32BE(p), ty = b.toString('ascii', p + 4, p + 8), d = b.slice(p + 8, p + 8 + len);
    if (ty === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (ty === 'IDAT') idat.push(d); else if (ty === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), ch = ct === 6 ? 4 : 3, stride = w * ch;
  const px = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0; let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += bb; else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) { const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c); }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = cur[x * ch]; px[o + 1] = cur[x * ch + 1]; px[o + 2] = cur[x * ch + 2]; px[o + 3] = 255;
    }
    prev = cur;
  }
  return { w, h, d: px };
}
const img = readPNG(process.argv[2]);
const cells = process.argv.slice(3).map(s => s.split(',').map(Number));
const BG = [0x20, 0x26, 0x2e];
const GX = 32; /* 网格线步长 */
for (const [cx, cy] of cells) {
  const X0 = cx - 22, X1 = cx + 22, Y0 = cy - 12, Y1 = cy + 8;
  const halves = { L: { lo: -1, n: 0, top: 999, sx: 0 }, R: { lo: -1, n: 0, top: 999, sx: 0 } };
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
    if (Math.abs(x - cx) <= 1) continue;                  /* 脚心白刻度线 */
    if (Math.abs((x - 0.5) % GX - 0.5) < 0.6 && Math.abs((x - 0.5) % GX) > GX - 0.6) continue;
    if (x % GX === 0) continue;                            /* 网格窄线（1px） */
    const i = (y * img.w + x) * 4;
    const r = img.d[i], g = img.d[i + 1], b = img.d[i + 2];
    const diff = Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]);
    /* 网格线是 bg+白 7%：亮度略高但接近中性灰，用色差阈值 40 已能过滤大半 */
    if (diff <= 40) continue;
    const h = x < cx ? halves.L : halves.R;
    h.n++; if (y > h.lo) h.lo = y; if (y < h.top) h.top = y; h.sx += x - cx;
  }
  const f = v => v.n ? `lo=${v.lo} top=${v.top} n=${v.n} x̄=${(v.sx / v.n).toFixed(1)}` : '空';
  console.log(`@(${cx},${cy})  左[${f(halves.L)}]  右[${f(halves.R)}]`);
}
