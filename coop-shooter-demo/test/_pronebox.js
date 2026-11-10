/* 分析 dev-xiaoke / dev-prone-all 截图：把「橙色受击盒描边」和「角色本体像素」分开，
   各算一个包围盒，用来判断趴下之后身体有没有落在受击盒里、有没有穿地。
   用法： node test/_pronebox.js 图.png x0 x1        （只看 x0..x1 这一列区间） */
const fs = require('fs'), zlib = require('zlib');

function load(file) {
  const src = fs.readFileSync(file);
  let p = 8, w, h, idat = [], ct;
  while (p < src.length) {
    const len = src.readUInt32BE(p), ty = src.toString('ascii', p + 4, p + 8);
    const d = src.slice(p + 8, p + 8 + len);
    if (ty === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (ty === 'IDAT') idat.push(d);
    else if (ty === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), ch = ct === 6 ? 4 : 3, stride = w * ch;
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += bb; else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      px[(y * w + x) * 4] = cur[x * ch];
      px[(y * w + x) * 4 + 1] = cur[x * ch + 1];
      px[(y * w + x) * 4 + 2] = cur[x * ch + 2];
      px[(y * w + x) * 4 + 3] = 255;
    }
    prev = cur;
  }
  return { w, h, px };
}

const file = process.argv[2];
const x0 = Number(process.argv[3] || 0), x1 = Number(process.argv[4] || 99999);
const y0 = Number(process.argv[5] || 0), y1 = Number(process.argv[6] || 1e9);
const { w, h, px } = load(file);

/* 描边色：rgba(255,138,92,0.85) 叠在 #101820 上 ≈ (222,121,83) */
const isOrange = (r, g, b) =>
  Math.abs(r - 222) < 26 && Math.abs(g - 121) < 26 && Math.abs(b - 83) < 26;

/* 地面黄线 rgba(255,209,102,0.55) 叠在 #0c1218 上 ≈ (150,124,68)；不参与统计 */
const isGround = (r, g, b) => Math.abs(r - 150) < 40 && Math.abs(g - 124) < 40 && Math.abs(b - 68) < 40;

const bb = (pred) => {
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, n = 0;
  for (let y = y0; y <= y1 && y < h; y++) for (let x = x0; x <= x1 && x < w; x++) {
    const i = (y * w + x) * 4;
    if (pred(px[i], px[i + 1], px[i + 2], x, y)) {
      n++;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
  return n ? { x: minx, y: miny, r: maxx, b: maxy, n } : null;
};

/* 背景两档：#101820（地上）/#0c1218（地下）；灰色「站立身高参考线」rgba(255,255,255,0.16)
   叠上去约 (56,62,70)，也不算角色本体 */
const isBg = (r, g, b) => (Math.abs(r - 0x10) < 8 && Math.abs(g - 0x18) < 8 && Math.abs(b - 0x20) < 8)
  || (Math.abs(r - 0x0c) < 8 && Math.abs(g - 0x12) < 8 && Math.abs(b - 0x18) < 8)
  || (Math.abs(r - 56) < 12 && Math.abs(g - 62) < 12 && Math.abs(b - 70) < 12);

const box = bb((r, g, b) => isOrange(r, g, b));
/* 角色本体：不是背景、不是橙框、不是地面线、不是白字标签区（y>650） */
const body = bb((r, g, b, x, y) => y < 650 && !isBg(r, g, b) && !isOrange(r, g, b) && !(isGround(r, g, b) && y > 600));

const show = (t, o) => console.log(t, o ? `x ${o.x}..${o.r} (w ${o.r - o.x + 1})  y ${o.y}..${o.b} (h ${o.b - o.y + 1})  px ${o.n}` : '无');
show('橙框 :', box);
show('本体 :', body);
if (box && body) {
  const inX = body.x >= box.x - 2 && body.r <= box.r + 2;
  const inY = body.y >= box.y - 2 && body.b <= box.b + 2;
  console.log('判定 :', `水平${inX ? '在框内' : '溢出框外'} / 垂直${inY ? '在框内' : '溢出框外'}`,
    `| 本体底 ${body.b} vs 框底 ${box.b} | 本体顶 ${body.y} vs 框顶 ${box.y}`);
}
