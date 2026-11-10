/* ============================================================
   whale-art.js —— 大肥鱼立绘换图工具
   ------------------------------------------------------------
   为什么需要这个文件：
   chars.js 里有一整组「量出来」的常数，全部是对着
   art/whale_idle.png / art/whale_hold.png 逐像素扫出来的：
     WHALE_FOOT           待机图脚底中心在宽度上的比例
     WHALE_FOOT_HOLD      握枪图脚底中心
     WHALE_HAND_ROW       待机图掌心所在行
     WHALE_HAND_ROW_HOLD  握枪图前拳所在行
     WHALE_HAND_XFRAC_HOLD  握枪图前拳所在列
     WHALE_LEG.front/back 前腿/后腿的拆件矩形 + 髋关节
   换一张画风更精致、头身比不同的立绘，这些数字全部失效：
   脚底一偏她就横跳一截，掌心一偏枪就从手上飘走，
   腿片矩形一偏小腿就从裙子外面支棱出来。

   手工重扫一遍要半小时，而且很容易漏一项。这个脚本把六项
   全部重新量出来，默认只打印 + 输出标注图，加 --write 才改代码。

   用法：
     node tools/whale-art.js                         看当前这套的数（验证工具本身）
     node tools/whale-art.js --idle new_i.png --hold new_h.png          只量不改
     node tools/whale-art.js --idle ... --hold ... --probe              额外出标注图
     node tools/whale-art.js --idle ... --hold ... --write              写进 chars.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHARS = path.join(ROOT, 'js', 'chars.js');

/* ---------- 最小 PNG 解码（不引第三方，跟 test/_legscan.js 同源） ---------- */
function decodePNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const ty = b.toString('ascii', p + 4, p + 8);
    const d = b.slice(p + 8, p + 8 + len);
    if (ty === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (ty === 'IDAT') idat.push(d);
    else if (ty === 'IEND') break;
    p += 12 + len;
  }
  const raw = require('zlib').inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (!ch || bd !== 8) throw new Error(file + '：只支持 8bit 灰度/RGB/RGBA，拿到 ct=' + ct + ' bd=' + bd);
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      out[o] = cur[s];
      out[o + 1] = ch >= 3 ? cur[s + 1] : cur[s];
      out[o + 2] = ch >= 3 ? cur[s + 2] : cur[s];
      out[o + 3] = ch === 4 ? cur[s + 3] : ch === 2 ? cur[s + 1] : 255;
    }
    prev = cur;
  }
  return { w, h, d: out, file };
}

/* ---------- 基础几何 ---------- */
function bbox(img) {
  const { w, h, d } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/* 每行的不透明段（alpha > 128 的连续区间） */
function rowSegs(img, y, thr) {
  const { w, d } = img;
  const segs = [];
  let run = null;
  for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > (thr || 128)) {
      if (!run) run = { a: x, b: x }; else run.b = x;
    } else if (run) { segs.push(run); run = null; }
  }
  if (run) segs.push(run);
  return segs;
}

/* 脚底中心：最底下 3% 的行做 alpha 加权质心。
   这两张图的姿势差很大（待机双脚并拢 / 握枪开腿），所以必须分开量 —— 
   合成一个数会让角色在待机↔持枪切换时横向平移。 */
function footCenter(img) {
  const { w, h, d } = img;
  const y1 = bbox(img).y1;
  const y0 = Math.max(0, y1 - Math.round(h * 0.03));
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3];
      if (a > 128) { sum += x * a; n += a; }
    }
  }
  return n ? sum / n / w : 0.5;
}

/* 肤色像素：立绘里只有脸和手是肉色，脸在上半部分，手在胸/腰。
   取「y 落在 38% 以下的最大肉色连通块」当前拳。 */
function isSkin(r, g, b) {
  return r > 190 && g > 145 && g < 245 && b > 125 && b < 220 && r > g + 10 && g >= b - 4;
}

function blobs(img, pred) {
  const { w, h, d } = img;
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i]) continue;
      const o = i * 4;
      if (!pred(d[o], d[o + 1], d[o + 2], d[o + 3])) { seen[i] = 1; continue; }
      let ax = 0, ay = 0, n = 0, minx = w, maxx = -1, miny = h, maxy = -1;
      stack.length = 0; stack.push(i); seen[i] = 1;
      while (stack.length) {
        const p = stack.pop();
        const px = p % w, py = (p - px) / w;
        ax += px; ay += py; n++;
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
        const nb = [p - 1, p + 1, p - w, p + w];
        for (const q of nb) {
          if (q < 0 || q >= w * h || seen[q]) continue;
          const qx = q % w;
          if (Math.abs(qx - px) > 1) continue;
          seen[q] = 1;
          const qo = q * 4;
          if (pred(d[qo], d[qo + 1], d[qo + 2], d[qo + 3])) stack.push(q);
        }
      }
      out.push({ cx: ax / n, cy: ay / n, n, minx, maxx, miny, maxy });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

/* 前拳：y 在 50% 以下、面积够大的肉色块里，取最靠前（x 最大）那个。
   立绘朝 +x，所以「最靠前」= 握在胸前的那只拳头。
   下限为什么是 50% 而不是 38%：这是 Q 版立绘，头占了将近一半身高，
   脸颊的肉色一直延伸到 0.44 —— 卡在 38% 的话「最靠前」会选中脸，
   蓝十字直接戳在她腮帮子上（第一版就栽在这，见 art/_whale_probe.png）。 */
function handPoint(img) {
  const s = blobs(img, (r, g, b, a) => a > 200 && isSkin(r, g, b));
  const low = s.filter(b => b.cy / img.h > 0.50 && b.cy / img.h < 0.92 && b.n > img.w * img.h * 0.0015);
  if (!low.length) return null;
  low.sort((a, b) => b.cx - a.cx);
  return { x: low[0].cx, y: low[0].cy };
}

/* 腿：从图底往上找「恰好两段」的连续行 —— 裙摆以下就是两条腿。
   这段区域的上沿就是裙摆下缘（cutY），左右两段各自是前腿/后腿。 */
function legRect(img) {
  const { h } = img;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(rowSegs(img, y));
  /* 从底行往上走，找第一段「恰好两段」的行。
     不能直接拿最底那一行当起点：新立绘里最底 3 行只有一只鞋踩实（另一只脚
     略高半像素），一上来就是 1 段，旧写法在这里直接 return null，腿片量不到。
     改成「先找最近的两段行」，再从这个行往上吃连续的两段。 */
  let end = -1;
  for (let y = h - 1; y >= 0; y--) {
    if (rows[y].length === 2) { end = y; break; }
  }
  if (end < 0) return null;
  let top = end;
  while (top - 1 >= 0 && rows[top - 1].length === 2) top--;
  /* 上层两段可能是「手臂与身体」之间的缝，不是腿。太薄的一律不认。 */
  if (end - top + 1 < 6) return null;

  /* 连续两段区里最上面那几行往往是裙摆 —— A 字裙的下缘荷叶边本身就会分成
     两片，看起来和两条腿一模一样。拿它当 cutY，腿片会连着一角裙子，走路时
     裙子跟着腿一块儿摆，穿帮穿得很难看。
     判据：用最底 6 行的平均段宽当「腿粗基准」，从下往上找第一行明显比它宽
     （1.5 倍）的，那一行的下一行才是真正的裙摆下缘。 */
  const footRows = [];
  for (let y = end; y >= Math.max(top, end - 5); y--) footRows.push(rows[y]);
  const baseW = Math.max(4, footRows.reduce((s, r) => s + (r[0].b - r[0].a + 1 + r[1].b - r[1].a + 1) / 2, 0) / footRows.length);
  let cutY = end;
  for (let y = end; y >= top; y--) {
    const widest = Math.max(rows[y][0].b - rows[y][0].a + 1, rows[y][1].b - rows[y][1].a + 1);
    if (widest > baseW * 1.5) break;
    cutY = y;
  }
  top = cutY;
  const span = (idx) => {
    let a = 1e9, b = -1;
    for (let y = top; y <= end; y++) {
      const s = rows[y][idx];
      if (!s) continue;
      if (s.a < a) a = s.a;
      if (s.b > b) b = s.b;
    }
    return { a, b };
  };
  const A = span(0), B = span(1);
  const mk = (s, cutY) => {
    const sy = cutY - 22;                    /* 腿片上缘伸进裙内 22px，切口藏在裙子里 */
    return {
      sx: Math.max(0, s.a - 3),
      sy,
      sw: (s.b - s.a + 1) + 3,
      sh: h - sy,
      cutX0: s.a, cutX1: s.b,
      cutY,
      pivotX: Math.round((s.a + s.b) / 2),
      pivotY: cutY - 16
    };
  };
  /* 立绘朝 +x：x 小的那侧是「前腿」（靠近镜头），与原有数值的命名保持连续 */
  return { front: mk(A, top), back: mk(B, rows[top].length === 2 ? topForBack(rows, end) : top) };
}

/* 后腿的裙摆角比前腿低几像素（斜裙摆），所以 back 的 cutY 单独量：
   后腿两段行里，从 end 往上找第一个「两段」行的上沿。 */
function topForBack(rows, end) {
  let y = end;
  while (y - 1 >= 0 && rows[y - 1].length === 2) y--;
  /* 后腿裙角更低 → 往上再多让出几行，取与前腿的实测差值 6px */
  return Math.max(0, y + 6);
}

/* ---------- 量两张图 ---------- */
function measure(file) {
  const img = decodePNG(file);
  const bb = bbox(img);
  const foot = footCenter(img);
  const hand = handPoint(img);
  const leg = legRect(img);
  return { img, bb, foot, hand, leg, file };
}

/* ---------- 只读当前 chars.js 里的旧值，用来做对照 ---------- */
function readOldConstants() {
  const s = fs.readFileSync(CHARS, 'utf8');
  const num = (re) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
  const leg = (key) => {
    const m = new RegExp(key + ':\\s*\\{([^}]*)\\}').exec(s);
    if (!m) return null;
    const o = {};
    m[1].replace(/(\w+):\s*(-?[\d.]+)/g, (_, k, v) => { o[k] = Number(v); });
    return o;
  };
  return {
    WHALE_FOOT: num(/const WHALE_FOOT = ([\d.]+)/),
    WHALE_FOOT_HOLD: num(/const WHALE_FOOT_HOLD = ([\d.]+)/),
    WHALE_HAND_ROW: num(/const WHALE_HAND_ROW = (\d+) \/ (\d+)/) || null,
    WHALE_HAND_ROW_HOLD: null,
    WHALE_HAND_XFRAC_HOLD: null,
    front: leg('front'),
    back: leg('back')
  };
}

/* ---------- 标注图：把量出来的点画回图上，用眼睛就能验 ---------- */
function probe(outFile, idle, hold) {
  let Canvas;
  try { Canvas = require('@napi-rs/canvas'); } catch (e) {
    console.log('（没装 @napi-rs/canvas，跳过标注图）');
    return;
  }
  const { createCanvas, loadImage } = Canvas;
  /* 4x 放大：116px 宽的图上一条 2px 的腿缝根本看不见，
     不放大标注就验不了「这个点到底落在哪」。画布尺寸必须跟着放大一起算。 */
  const k = 4;
  const pad = 16, gap = 28;
  const W = (idle.img.w + hold.img.w) * k + gap + pad * 2;
  const H = Math.max(idle.img.h, hold.img.h) * k + pad * 2 + 18;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#12181e'; g.fillRect(0, 0, W, H);
  const mark = async (m, x, label) => {
    const im = await loadImage(m.file);
    g.imageSmoothingEnabled = false;
    g.drawImage(im, x, pad, m.img.w * k, m.img.h * k);
    const px = (v) => x + v * k, py = (v) => pad + v * k;
    /* 脚底中心：红线从脚底往上穿 40px，再在脚底画一条横线表示落点 */
    g.strokeStyle = '#ff5252'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px(m.foot * m.img.w), py(m.img.h) - 3);
    g.lineTo(px(m.foot * m.img.w), py(m.img.h) - 42);
    g.moveTo(px(m.foot * m.img.w) - 9, py(m.img.h) - 3);
    g.lineTo(px(m.foot * m.img.w) + 9, py(m.img.h) - 3);
    g.stroke();
    /* 掌心：十字 */
    if (m.hand) {
      const hx = px(m.hand.x), hy = py(m.hand.y);
      g.strokeStyle = '#4fc3f7'; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(hx - 16, hy); g.lineTo(hx + 16, hy);
      g.moveTo(hx, hy - 16); g.lineTo(hx, hy + 16);
      g.stroke();
    }
    /* 腿片矩形 + 髋关节 */
    if (m.leg) {
      for (const key of ['front', 'back']) {
        const r = m.leg[key];
        g.strokeStyle = key === 'front' ? '#ffd54f' : '#a5d6a7';
        g.lineWidth = 1.5;
        g.strokeRect(px(r.sx), py(r.sy), r.sw * k, r.sh * k);
        g.fillStyle = g.strokeStyle;
        g.beginPath(); g.arc(px(r.pivotX), py(r.pivotY), 4, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = '#cfd8dc'; g.font = '14px "Microsoft YaHei",sans-serif'; g.textAlign = 'left';
    g.fillText(label, x, H - 8);
  };
  return Promise.all([
    mark(idle, pad, '待机 idle'),
    mark(hold, pad + idle.img.w * k + gap, '握枪 hold')
  ]).then(() => {
    fs.writeFileSync(outFile, c.toBuffer('image/png'));
    console.log('标注图 → ' + path.relative(ROOT, outFile));
  });
}

/* ---------- 写回 chars.js ---------- */
function patch(m) {
  let s = fs.readFileSync(CHARS, 'utf8');
  const idleB64 = fs.readFileSync(m.idle.file).toString('base64');
  const holdB64 = fs.readFileSync(m.hold.file).toString('base64');
  const done = [];

  const rep = (name, re, val, tag) => {
    const before = s;
    s = s.replace(re, val);
    if (s !== before) done.push(name + ' → ' + tag); else console.log('！没替换成功：' + name);
  };

  rep('WHALE_SPRITE_B64', /(const WHALE_SPRITE_B64 =\s*')data:image\/png;base64,[A-Za-z0-9+/=]*(',)/,
    '$1data:image/png;base64,' + idleB64 + '$2', idleB64.length * 0.75 / 1024 | 0 + 'KB');
  rep('WHALE_SPRITE_HOLD_B64', /(const WHALE_SPRITE_HOLD_B64 =\s*')data:image\/png;base64,[A-Za-z0-9+/=]*(',)/,
    '$1data:image/png;base64,' + holdB64 + '$2', holdB64.length * 0.75 / 1024 | 0 + 'KB');

  rep('WHALE_FOOT', /const WHALE_FOOT = [\d.]+/, 'const WHALE_FOOT = ' + m.idle.foot.toFixed(3), m.idle.foot.toFixed(3));

  /* 脚底中心是「她把重心落在哪」的人工判断，不是纯几何量。
     握枪图开腿站姿下，两脚质心和「桩步重心」差得远（实测 0.592 vs 0.464），
     差这么多还照写，角色会在屏幕上来回滑半个身位。
     所以偏差 > 8% 就拒绝写，要人显式 --force。 */
  const footOld = readOldConstants().WHALE_FOOT_HOLD;
  const footDiff = footOld == null ? 0 : Math.abs(m.hold.foot - footOld) / footOld;
  if (m.hold.foot && footDiff > 0.08 && !argv.includes('--force')) {
    console.log('！WHALE_FOOT_HOLD 没写：量到 ' + m.hold.foot.toFixed(3) + '，原值 ' + footOld +
      '，差 ' + (footDiff * 100).toFixed(1) + '%。\n' +
      '  两脚质心 ≠ 站桩重心，这个数必须用眼睛定（art/_whale_probe.png 里的红线就是它）。\n' +
      '  确认要按量测值走，加 --force。');
  } else {
    rep('WHALE_FOOT_HOLD', /const WHALE_FOOT_HOLD = [\d.]+/, 'const WHALE_FOOT_HOLD = ' + m.hold.foot.toFixed(3), m.hold.foot.toFixed(3));
  }

  if (m.idle.hand) {
    const r = (m.idle.hand.y / m.idle.img.h).toFixed(4);
    rep('WHALE_HAND_ROW', /const WHALE_HAND_ROW = [\d]+ \/ [\d]+/,
      'const WHALE_HAND_ROW = ' + Math.round(m.idle.hand.y) + ' / ' + m.idle.img.h, r);
  }
  if (m.hold.hand) {
    const row = (m.hold.hand.y / m.hold.img.h).toFixed(4);
    const xf = (m.hold.hand.x / m.hold.img.w).toFixed(4);
    rep('WHALE_HAND_ROW_HOLD', /const WHALE_HAND_ROW_HOLD = [\d]+ \/ [\d]+/,
      'const WHALE_HAND_ROW_HOLD = ' + Math.round(m.hold.hand.y) + ' / ' + m.hold.img.h, row);
    rep('WHALE_HAND_XFRAC_HOLD', /const WHALE_HAND_XFRAC_HOLD = [\d]+ \/ [\d]+/,
      'const WHALE_HAND_XFRAC_HOLD = ' + Math.round(m.hold.hand.x) + ' / ' + m.hold.img.w, xf);
  }

  /* 腿片矩形：只在「量出来的结构跟原来同一类」时才写。
     找不到两条腿 / 裙摆位置差太多，说明这张图的剪影变了，
     硬写会让她的小腿从裙子外面支棱出来，宁可留着旧值让人工看。 */
  if (m.hold.leg) {
    const r = m.hold.leg;
    const sane = r.front && r.back && r.front.cutY > m.hold.img.h * 0.78 && r.front.cutY < m.hold.img.h * 0.96;
    if (sane) {
      const fmt = (k, o) => '  ' + k + ': { sx: ' + o.sx + ', sy: ' + o.sy + ', sw: ' + o.sw + ', sh: ' + o.sh +
        ', cutX0: ' + o.cutX0 + ', cutX1: ' + o.cutX1 + ', cutY: ' + o.cutY +
        ', pivotX: ' + o.pivotX + ', pivotY: ' + o.pivotY + ' }';
      s = s.replace(/front: \{[^}]*\},\s*\n\s*back: \{[^}]*\}/, fmt('front', r.front) + ',\n' + fmt('back', r.back));
      done.push('WHALE_LEG → 前腿 cutY=' + r.front.cutY + ' / 后腿 cutY=' + r.back.cutY);
    } else {
      console.log('！腿片矩形没敢写：量到的裙摆下缘在 y=' + (r.front && r.front.cutY) +
        '，超出 78%~96% 的合理区间。这张图的剪影跟原图不是一类，请人工裁一次。');
    }
  }

  fs.writeFileSync(CHARS, s);
  console.log('\n已写入 js/chars.js：');
  done.forEach(d => console.log('  ✓ ' + d));
}

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const idleFile = get('--idle') || path.join(ROOT, 'art', 'whale_idle.png');
const holdFile = get('--hold') || path.join(ROOT, 'art', 'whale_hold.png');
const doWrite = argv.includes('--write');
const doProbe = argv.includes('--probe') || doWrite;

const idle = measure(idleFile);
const hold = measure(holdFile);

console.log('大肥鱼立绘量测');
console.log('─'.repeat(64));
const show = (tag, m) => {
  console.log(tag + '  ' + m.img.w + '×' + m.img.h + '  ' + path.relative(ROOT, m.file));
  console.log('   不透明区 x ' + m.bb.x0 + '~' + m.bb.x1 + '  y ' + m.bb.y0 + '~' + m.bb.y1 +
    '  （左右各留白 ' + m.bb.x0 + '/' + (m.img.w - 1 - m.bb.x1) + '）');
  console.log('   脚底中心 x = ' + (m.foot * m.img.w).toFixed(1) + 'px  →  WHALE_FOOT = ' + m.foot.toFixed(3));
  if (m.hand) {
    console.log('   前拳    x = ' + m.hand.x.toFixed(1) + 'px  y = ' + m.hand.y.toFixed(1) +
      'px  →  row ' + (m.hand.y / m.img.h).toFixed(4) + ' / xfrac ' + (m.hand.x / m.img.w).toFixed(4));
  } else {
    console.log('   前拳    没找到肉色块 —— 手可能被画成戴手套 / 被身体挡住，这一项要人工给');
  }
  if (m.leg) {
    const f = m.leg.front, b = m.leg.back;
    console.log('   裙摆下缘 y = ' + f.cutY + '（占高 ' + (f.cutY / m.img.h * 100).toFixed(1) + '%）');
    console.log('   前腿 x ' + f.cutX0 + '~' + f.cutX1 + '  后腿 x ' + b.cutX0 + '~' + b.cutX1);
  } else {
    console.log('   腿      没量到两条腿 —— 裙摆盖到脚面、或者两腿贴在一起，这一项要人工给');
  }
};
show('待机', idle);
show('握枪', hold);

/* 对照旧值：偏差超过 2% 就提示「换图后必须复核」 */
const old = readOldConstants();
console.log('─'.repeat(64));
const cmp = (name, a, b, tol) => {
  if (a == null || b == null) return;
  const d = Math.abs(a - b) / (Math.abs(a) || 1);
  console.log((d > (tol || 0.02) ? '  ⚠ ' : '  · ') + name + '  ' + a + ' → ' + b +
    '（差 ' + (d * 100).toFixed(1) + '%）');
};
cmp('WHALE_FOOT', old.WHALE_FOOT, Number(idle.foot.toFixed(3)));
cmp('WHALE_FOOT_HOLD', old.WHALE_FOOT_HOLD, Number(hold.foot.toFixed(3)));
if (hold.hand) cmp('WHALE_HAND_XFRAC_HOLD', 860 / 928, hold.hand.x / hold.img.w);
if (hold.hand) cmp('WHALE_HAND_ROW_HOLD', 885 / 1536, hold.hand.y / hold.img.h);

if (doWrite) {
  console.log('─'.repeat(64));
  patch({ idle, hold });
}
if (doProbe) {
  probe(path.join(ROOT, 'art', '_whale_probe.png'), idle, hold).catch(e => console.error(e.message));
}
