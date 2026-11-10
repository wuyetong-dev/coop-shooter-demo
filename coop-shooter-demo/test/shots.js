/* 截图回归：真 canvas 离屏渲染，把九个界面各拍一张 1280×720 PNG。
   ------------------------------------------------------------------
   为什么不用浏览器：headless Chrome 要装 puppeteer（150MB+），而且
   --screenshot 拍不到「按了几帧之后」的状态。这里直接上 @napi-rs/canvas
   的真实 2d context，走和浏览器完全相同的 render() 链路，改完美术
   一条命令就能肉眼比对，也顺便补上交接文档里说的
   「没有自动化截图回归」这个洞。

   用法：
     node test/shots.js            拍全部九个界面 → shots/*.png
     node test/shots.js play       只拍战斗
     node test/shots.js --list     列出可拍的名字

   依赖：npm i @napi-rs/canvas （无原生编译，装完即用）
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* Image 是给角色立绘用的：chars.js 里 WHALE_SPRITE / HERO_SPRITE 都是
   顶层的 `new Image()`，判断条件写着 `typeof Image !== 'undefined'`。
   以前这个沙箱里没注入 Image，于是 `typeof Image` 是 undefined，四个立绘
   全是 null，whaleSpriteReady() 恒 false —— 所有截图里的主角其实一直是
   chars.js 尾部那条「图片没解码完时兜底」的矢量路径绘制，从没验证过位图通道。
   换成 @napi-rs/canvas 自己的 Image 就能走真链路：它是原生对象，
   ctx.drawImage 认得，解码结果和浏览器一致。 */
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'shots');

/* ---------------- 中文字体 ----------------
   实测：napi-rs/canvas 在 Windows 上启动时已经扫到了系统字体
   （GlobalFonts.families 里就有 200 多项，含 Microsoft YaHei），
   所以不用手动注册，ctx.font 写 "Microsoft YaHei" 就是真的雅黑 —— 和浏览器同一套字形。
   反倒是「字体名写错」最坑：napi-rs 找不到字体时一声不响地什么都不画
   （不是画豆腐块，是纯空白），截图看起来像「文字没了」。
   所以这里不注册，改成开跑前自检一次：中文必须真的落到画布上。 */
const FONTS = [
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/msyhl.ttc',
  'C:/Windows/Fonts/simhei.ttf'
];
for (const f of FONTS) {
  try { if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'Microsoft YaHei'); } catch (e) { /* 没有就算了 */ }
}

/* 画「战火」两个字，数一数到底落了几个暗像素。0 = 字体没生效，截图不可信。 */
function fontSelfCheck(g) {
  g.save();
  g.fillStyle = '#fff'; g.fillRect(0, 0, 80, 30);
  g.fillStyle = '#000'; g.font = '20px "Microsoft YaHei",sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('战火', 2, 24);
  const d = g.getImageData(0, 0, 80, 30).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ink++;
  g.restore();
  g.clearRect(0, 0, 80, 30);
  if (ink < 40) {
    console.error('[shots] 中文字形没落到画布上（ink=' + ink + '）—— 字体名可能不匹配，截图不可信');
    process.exitCode = 2;
  }
  return ink;
}

/* ---------------- 浏览器桩 ---------------- */
const canvas = createCanvas(1280, 720);
const ctx = canvas.getContext('2d');
const FONT_INK = fontSelfCheck(ctx);

let clock = 0;
const canvasEl = {
  width: 1280, height: 720, style: {},
  getContext: () => ctx,
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};

const sandbox = {
  console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String,
  Array, Object, Boolean, Error, Set, Map, URLSearchParams,
  Image,
  setTimeout: () => 0, clearTimeout: () => {},
  performance: { now: () => clock },
  requestAnimationFrame: () => 0,
  addEventListener: () => {},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  document: {
    getElementById: () => canvasEl,
    createElement: () => createCanvas(8, 8)
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctxVm = vm.createContext(sandbox);

const ORDER = ['util.js', 'world.js', 'ai.js', 'game.js', 'render.js', 'chars.js', 'render2.js', 'meta.js', 'hud.js'];
for (const f of ORDER) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctxVm, { filename: f });
}

const api = vm.runInContext(`({
  get game(){ return game; },
  get player(){ return player; },
  get buddy(){ return buddy; },
  get enemies(){ return enemies; },
  get bullets(){ return bullets; },
  get SAVE(){ return SAVE; },
  get WEAPONS(){ return WEAPONS; },
  get CHAR_LIST(){ return CHAR_LIST; },
  frame, render, update, startStage, openStory, advanceDialog,
  goLobby, computeStars
})`, ctxVm);

function step(frames) {
  for (let i = 0; i < frames; i++) {
    clock += 1000 / 60;
    api.frame(clock);
  }
}

/* 等四个立绘解码完。
   ------------------------------------------------------------
   Image 的解码是异步的（src 赋值后 complete 立刻读还是 false），要等一个
   事件循环 tick 才变 true。而下面的 step() 是一口气同步跑几十上百帧 ——
   中间不会让出事件循环，所以必须在这之前就 await 一次，否则永远解码不完，
   最后拍出来的还是矢量兜底。
   whaleSpriteReady() 这些函数是 chars.js 顶层的 function 声明，runInContext
   的表达式能直接读到；顶层的 const 保持在 context 的词法作用域里，跨脚本可见。 */
async function settleSprites(maxMs = 2000) {
  /* 六张干员立绘也必须算进来：drawCast() 图没就绪时会安静地退回 drawAgent()，
     画面上仍然「有个角色站着」，只是这时候看到的是程序化骨架 ——
     和第四轮踩过的坑一模一样（位图通道从上线起就没被任何一张图验证过）。 */
  const probe = `({
    whale:     (typeof whaleSpriteReady    === 'function') && whaleSpriteReady(),
    whaleHold: (typeof whaleHoldReady      === 'function') && whaleHoldReady(),
    hero:      (typeof heroSpriteReady     === 'function') && heroSpriteReady(),
    heroHold:  (typeof heroHoldReady       === 'function') && heroHoldReady(),
    cast: (function () {
      var out = {};
      var names = (typeof CAST_SPRITE !== 'undefined') ? Object.keys(CAST_SPRITE) : [];
      for (var i = 0; i < names.length; i++) out[names[i]] = castReady(names[i]);
      return out;
    })()
  })`;
  const done = (s) => s.whale && s.whaleHold && s.hero && s.heroHold &&
    Object.keys(s.cast).length > 0 && Object.keys(s.cast).every(k => s.cast[k]);
  const t0 = Date.now();
  let st = vm.runInContext(probe, ctxVm);
  while (!done(st) && Date.now() - t0 < maxMs) {
    await new Promise(r => setTimeout(r, 10));
    st = vm.runInContext(probe, ctxVm);
  }
  return { st, ms: Date.now() - t0 };
}

/* 每张图之前把世界清干净：不同界面之间不留上一张的残留 */
function reset() {
  api.enemies.length = 0;
  api.bullets.length = 0;
  api.game.state = 'title';
  api.game.hitStop = 0;
  api.game.slowmo = 0;
  api.game.screenFlash = 0;
  api.game.combo = 0;
  api.game.comboTimer = 0;
  api.game.toast = '';
  api.game.toastT = 0;
  api.game.dialog = null;
  api.game.bossIntro = null;
  api.game.tutorialT = 0;
  const S = api.SAVE;
  S.maxStage = 5;
  S.coins = 2680;
  S.level = 6;
  S.xp = 240;
}

/* ---------------- 九张图 ---------------- */
const SCENES = {
  title: () => {
    api.game.state = 'title';
    step(40);
  },
  lobby: () => {
    api.game.state = 'lobby';
    api.game.menu = 0;
    step(30);
  },
  deploy: () => {
    api.game.state = 'deploy';
    api.game.pickStage = 2;
    step(30);
  },
  armory: () => {
    api.game.state = 'armory';
    api.game.menu2 = 1;
    step(30);
  },
  /* 选到最后一行（MP5）。这一张专门盯「武器库列表排不下第 6 把枪」这个坑：
     行被下方配装条压住时，截图里会露出一层幽灵字，而详情面板照常渲染，
     光看 armory.png（选第 2 行）发现不了。加枪之后必须跑这张。 */
  armory6: () => {
    api.game.state = 'armory';
    api.game.menu2 = api.WEAPONS.length - 1;
    step(30);
  },
  operators: () => {
    api.game.state = 'operators';
    api.game.menu2 = 0;
    step(30);
  },
  operators2: () => {
    api.game.state = 'operators';
    api.game.menu2 = 6;
    step(30);
  },
  archive: () => {
    api.game.state = 'archive';
    api.game.confirmReset = false;
    step(30);
  },
  story: () => {
    api.openStory(1, 'lobby');
    api.advanceDialog(6);           /* 把首句一次打完，看整段排版 */
    step(30);
  },
  playcast: () => {
    api.SAVE.charId = 'kimi';
    api.startStage(1);
    step(150);
  },
  play: () => {
    api.startStage(1);
    step(150);                      /* 2.5 秒：波次已刷怪、引导条正在显示 */
    api.game.combo = 6;
    api.game.comboTimer = 2.2;
    api.game.comboMax = 9;
    step(6);
  },
  play2: () => {
    api.startStage(4);              /* 换一套主题，验证视差/光照不是只对第一关做 */
    step(160);
    api.game.combo = 12;
    api.game.comboTimer = 2.4;
    step(6);
  },
  /* 结算 / 失败卡是「叠在战场上」的，所以必须先真的开一局。
     以前这两张图蹭的是前面 play 场景留下的 player —— 单跑
     `node test/shots.js clear` 会掉进 render() 的 !player 短路，
     拍出一张纯背景，白排查一轮。 */
  clear: () => {
    api.startStage(3);
    api.game.dialog = null;
    api.game.stage = 3;
    api.game.kills = 41;
    api.game.score = 5140;
    api.game.earned = 326;
    api.game.clearBonus = 150;
    api.game.xpGain = 92;
    api.game.levelUps = 1;
    api.game.grade = 'A';
    api.game.stars = { clear: true, time: true, hp: false };
    api.game.state = 'stageclear';
    step(90);                       /* 评级牌与三星是入场动画，得让它演完 */
  },
  gameover: () => {
    api.startStage(3);
    api.game.dialog = null;
    api.game.stage = 3;
    api.game.wave = 4;
    api.game.earned = 118;
    api.game.state = 'gameover';
    step(40);
  }
};

(async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    console.log(Object.keys(SCENES).join('  '));
    return;
  }
  const want = argv.filter(a => SCENES[a]);
  const names = want.length ? want : Object.keys(SCENES);

  fs.mkdirSync(OUT, { recursive: true });
  console.log('字体自检：中文落地像素 ' + FONT_INK + (FONT_INK >= 40 ? '（雅黑正常）' : '（异常！截图不可信）'));

  /* 立绘自检：和字体自检一个道理 —— 位图没就绪时程序不报错、不崩，
     只是安静地画一条矢量的假人。截图上看起来「有个角色站在那儿」，
     于是谁也不会怀疑，换了两代立绘都白换。所以少一张就明确报出来。 */
  const { st: RS, ms: RMS } = await settleSprites();
  const ok = v => (v ? '✓' : '✗');
  const castNames = Object.keys(RS.cast || {});
  const castBad = castNames.filter(k => !RS.cast[k]);
  console.log('立绘自检：大肥鱼 idle' + ok(RS.whale) + ' hold' + ok(RS.whaleHold) +
    ' · 主角 idle' + ok(RS.hero) + ' hold' + ok(RS.heroHold) +
    ' · 干员 ' + (castNames.length - castBad.length) + '/' + castNames.length + ' ✓' +
    '（解码 ' + RMS + ' ms）');
  if (!RS.whale || !RS.whaleHold || !RS.hero || !RS.heroHold || castBad.length) {
    console.error('[shots] 有立绘没解码成功 —— 该角色会退回矢量兜底，截图和人实际看到的不一样' +
      (castBad.length ? '（缺：' + castBad.join(' ') + '）' : ''));
    process.exitCode = 2;
  }

  for (const name of names) {
    reset();
    try {
      SCENES[name]();
    } catch (e) {
      console.log('  ✗ ' + name + ' 渲染报错: ' + e.message);
      console.log((e.stack || '').split('\n').slice(1, 4).join('\n'));
      continue;
    }
    const buf = await canvas.encode('png');
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, buf);
    console.log('  ✓ ' + name.padEnd(10) + Math.round(buf.length / 1024) + ' KB  →  shots/' + name + '.png');
  }
  console.log('\n截图完成 · ' + names.length + ' 张');
})();
