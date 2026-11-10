/* 把 art/pose/ 下的姿态图内嵌进 js/chars.js。
   ------------------------------------------------------------
   为什么内嵌而不是运行时加载：build-single.js 把 js/*.js 合成一个
   HTML，任何外部文件引用都会在单文件版里断掉。项目里已有的立绘
   （HERO_SPRITE_IDLE_B64 / CAST_SPRITE_B64）走的都是这条路。

   用法：
     node tools/gen-poseart.js            # 写入
     node tools/gen-poseart.js --check    # 只比对，不写（回归用）
   ------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHARS = path.join(ROOT, 'js', 'chars.js');
const BEGIN = '/* ==POSEART:BEGIN== */';
const END = '/* ==POSEART:END== */';

/* 哪些角色、哪些姿态有专门画的图。没有的（大肥鱼、六干员）保持原样，
   drawXxx 那边会自动退回「整图变形」的老路径。

   foot 和 hand 是**人工标注**，不是量出来的：脚底中心还能靠 alpha 扫，
   掌心不行 —— 手和枪握在一起，是一个连着躯干的暗块，没有任何可用的
   边界。标注流程（换图必须重标，数值是「图内像素 ÷ 画幅」）：
     node tools/skel/grid.js art/pose/x.png 4            总览网格，定位大致区域
     node tools/skel/zoom.js art/pose/x.png x0 y0 x1 y1 8  局部放大读精确坐标
     node test/_hold3x.js crouch 6                       6 倍美术台看握把落点
   注意：只改 js/chars.js 里的 POSE_ART 没用，下次跑本工具会被冲掉。 */
const ART = {
  hero: {
    /* 掌心的 y 是量出来的：把立绘右半条放大 8 倍套网格（tools/skel/zoom.js），
       拳头那一团在 x 70~88 / y 76~96，中心 (79, 86)。
       原来标的 82 高了 4 个画幅像素 —— 换算到游戏里就是枪浮在手背上 2px，
       96px 高的小人上看得见。 */
    crouch: { file: 'art/pose/hero_crouch.png', foot: 48 / 91, hand: [79 / 91, 86 / 154] },
    prone:  { file: 'art/pose/hero_prone.png',  foot: 98 / 193, hand: [178 / 193, 96 / 111] }
  }
};

function b64(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

/* 读 PNG 头拿尺寸：绘制要按画幅算宽高比，写死数字迟早和素材对不上 */
function pngSize(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const lines = [BEGIN];
lines.push('/* 由 tools/gen-poseart.js 生成，不要手改。');
lines.push('   每张图四样东西：画幅（算宽高比）、视觉身高基准、脚底与掌心在画幅里的');
lines.push('   相对位置。三张图是同一物理尺度出的（按头盔宽度对齐），所以 vh 直接按');
lines.push('   「相对 192 高的站立立绘」等比换算 —— 换一张图不用重标锚点。 */');
lines.push('const POSE_ART = {');
for (const look in ART) {
  lines.push('  ' + look + ': {');
  for (const pose in ART[look]) {
    const rel = ART[look][pose].file;
    const d = b64(rel);
    if (!d) { lines.push('    /* ' + pose + ' 缺图：' + rel + ' */'); continue; }
    const s = pngSize(rel);
    const a = ART[look][pose];
    const fx = a.foot.toFixed(4), hx = a.hand[0].toFixed(4), hy = a.hand[1].toFixed(4);
    lines.push('    ' + pose + ': { w: ' + s.w + ', h: ' + s.h +
      ', foot: ' + fx + ', hand: [' + hx + ', ' + hy + '],');
    lines.push('      src: ' + JSON.stringify(d) + ' },');
  }
  lines.push('  },');
}
lines.push('};');
lines.push(END);

const block = lines.join('\n');
const src = fs.readFileSync(CHARS, 'utf8');
const i0 = src.indexOf(BEGIN);
const i1 = src.indexOf(END);

if (process.argv.includes('--check')) {
  if (i0 < 0) { console.error('✗ chars.js 里没有 POSEART 标记块'); process.exit(1); }
  const cur = src.slice(i0, i1 + END.length);
  if (cur !== block) {
    console.error('✗ 内嵌的姿态图与 art/pose/ 不一致，跑 node tools/gen-poseart.js 重新生成');
    process.exit(1);
  }
  console.log('✓ 姿态图内嵌与素材一致');
  process.exit(0);
}

if (i0 < 0) { console.error('✗ chars.js 里没有 ' + BEGIN + ' 标记块'); process.exit(1); }
fs.writeFileSync(CHARS, src.slice(0, i0) + block + src.slice(i1 + END.length), 'utf8');
console.log('✓ 已写入 ' + Object.keys(ART).map(k => k + '(' + Object.keys(ART[k]).join('/') + ')').join(', '));
console.log('  chars.js ' + Math.round(fs.statSync(CHARS).size / 1024) + ' KB');
