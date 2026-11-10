'use strict';

/* ==================================================================
   AI 层：大肥鱼（队友）的战术大脑 + 敌兵行为
   ------------------------------------------------------------------
   大肥鱼 v2 = 感知（子弹/敌人/补给） → 评估（威胁打分） → 执行（走位/躲弹/开火）
   每个决策都写进 b.log，HUD 的「战术面板」实时显示他在想什么。
   ================================================================== */

function nearestEnemy(x, maxDist) {
  let best = null, bd = maxDist || 1e9;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    const d = Math.abs(e.x - x);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function countEnemiesNear(x, y, radius) {
  let n = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    if (distTo(e.x, e.y - e.h * 0.5, x, y) < radius) n++;
  }
  return n;
}

/* 面向 target 开火（玩家/大肥鱼通用射击函数） */
function fireWeapon(a, wp, aimAngle, spreadMul, dmgMul) {
  /* 起点 = 屏幕上真正画出来的那个枪口（唯一权威见 chars.js 的 muzzlePoint）。
     以前这里是 a.x + cos*30 / a.y - a.h*0.62 + sin*30：
     拿受击盒身高当肩高，站立就差 9px、趴下能差二十几像素 ——
     于是「枪口在脸旁，子弹从胸口出来」。敌兵是另一套矢量枪，
     muzzlePoint 不认识它们，返回 null 时退回旧公式。 */
  const mu = muzzlePoint(a);
  const mx = mu ? mu.x : a.x + Math.cos(aimAngle) * 30;
  const my = mu ? mu.y : a.y - a.h * 0.62 + Math.sin(aimAngle) * 30;
  /* wp 直接当子弹配置用，这里补一条「忽略自己脚下的平台」 */
  const opts = Object.assign({}, wp, { ignorePlat: a.plat });
  for (let i = 0; i < wp.pellets; i++) {
    const ang = aimAngle + rand(-wp.spread, wp.spread) * spreadMul;
    spawnBullet(mx, my, Math.cos(ang) * wp.speed, Math.sin(ang) * wp.speed,
      wp.dmg * (dmgMul || 1), a.kind === 'buddy' ? 'ally' : a.kind, wp.color,
      wp.rocket ? 5.4 : (wp.tracer ? 2.6 : 3.2), a.kind, opts);
  }
  a.muzzle = 0.06;
  spawnParticles(mx, my, 3, '#ffdd99', 160, 0.16, 3, 0);
  if (wp.sfx === 'big') sfxShotBig(); else sfxShot();
  a.fireCd = wp.rate;
  casings.push({
    x: mx, y: my, vx: -Math.cos(aimAngle) * 90 + rand(-40, 40),
    vy: -rand(80, 160), life: 1.2, rot: rand(0, 6.28), spin: rand(-14, 14)
  });
}

/* ==================================================================
   大肥鱼：战斗风格
   ================================================================== */
const BUDDY_STYLES = [
  { key: 'cautious', name: '谨慎', retreatAt: 0.46, healTo: 0.80, rangeMul: 1.2, dodge: 0.85, chase: 0.7,
    desc: '远离火线，血少立刻后撤' },
  { key: 'balanced', name: '均衡', retreatAt: 0.34, healTo: 0.64, rangeMul: 1.0, dodge: 0.8, chase: 1.0,
    desc: '攻守各一半，常规打法' },
  { key: 'aggro', name: '突击', retreatAt: 0.22, healTo: 0.42, rangeMul: 0.7, dodge: 0.55, chase: 1.5,
    desc: '贴着敌人打，血条见底才退' }
];

/* 记录一条决策日志（面板上会滚动显示）。敌兵没有日志数组，直接忽略。 */
function blog(b, text) {
  if (!b || !b.log) return;
  b.log.push({ t: game.time, text: text });
  if (b.log.length > 8) b.log.shift();
  game.tele.decisions++;
}

function setIntent(b, intent, reason) {
  if (b.intent !== intent) {
    b.intent = intent;
    b.intentSince = game.time;
    blog(b, '转入【' + INTENT_NAMES[intent] + '】' + (reason ? '：' + reason : ''));
  } else if (b.reason !== reason) {
    b.reason = reason;
  }
  b.reason = reason;
}

const INTENT_NAMES = {
  FOLLOW: '跟随', ENGAGE: '交战', RETREAT: '撤离', REVIVE: '救援', GRAB: '取补给', HOLD: '守点'
};

/* ---------------- 感知：来袭弹道 ---------------- */
/* 预测 horizon 秒内会擦到身体的敌方子弹，返回数量与最近命中时间 */
function scanIncoming(b, horizon) {
  const cx = b.x, topY = b.y - b.h, midY = b.y - b.h * 0.5;
  let count = 0, minT = 99, fromRight = 0;
  for (let i = 0; i < bullets.length; i++) {
    const u = bullets[i];
    if (u.team !== 'enemy') continue;
    const sp2 = u.vx * u.vx + u.vy * u.vy;
    if (sp2 < 400) continue;
    const rx = cx - u.x, ry = midY - u.y;
    const t = (rx * u.vx + ry * u.vy) / sp2;
    if (t < 0 || t > horizon) continue;
    const px = u.x + u.vx * t;
    const py = u.y + u.vy * t;
    if (px < cx - 30 || px > cx + 30) continue;      /* 不在身体横向范围 */
    if (py < topY - 26 || py > b.y + 8) continue;    /* 不在身体纵向范围 */
    count++;
    if (t < minT) { minT = t; fromRight = u.vx < 0 ? 1 : -1; }
  }
  return { count, minT, fromRight };
}

/* ---------------- 感知：身边的补给 ---------------- */
function wantPickup(b) {
  const lowHp = b.hp < b.maxHp * 0.72;
  const lowAmmo = (b.mags[0] + b.mags[2]) < 20;
  let best = null, bd = 1e9;
  for (let i = 0; i < pickups.length; i++) {
    const pk = pickups[i];
    if (pk.type === 'health' && !lowHp) continue;
    if (pk.type === 'ammo' && !lowAmmo) continue;
    const d = Math.abs(pk.x - b.x);
    if (d < 460 && d < bd) { bd = d; best = pk; }
  }
  return best;
}

/* ---------------- 评估：目标打分 ---------------- */
function scoreTarget(e, b) {
  const p = player;
  const dSelf = Math.hypot(e.x - b.x, (e.y - e.h * 0.5) - (b.y - b.h * 0.5)) + 1;
  const dPlayer = p ? Math.abs(e.x - p.x) : 9999;
  /* 以「离指挥官的远近」为主，其次才是自己顺手 */
  let s = 900 / (dPlayer * 0.65 + dSelf * 0.35 + 1);
  if (e.hp <= 34) s += 5;                                  /* 补刀优先 */
  if (ENEMY_TYPES[e.type].melee) s += 10;                   /* 冲锋兵最危险（会近身打指挥官） */
  if (e.boss) s += 6;
  if (dPlayer < 260) s += 8;                                /* 已经贴到指挥官身边了 */
  if (p && (p.hp < p.maxHp * 0.5 || game.time - (p.lastHurt || -99) < 1.6) && dPlayer < 520) s += 12; /* 护主 */
  if (dSelf > 900) s -= 10;
  return s;
}

function pickBuddyTarget(b) {
  let best = null, bs = -1e9;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    const d = Math.abs(e.x - b.x);
    if (d > 1000) continue;
    const s = scoreTarget(e, b);
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

/* ---------------- 评估：武器与理想交战距离 ----------------
   以前是按下标写死的（0:380 / 1:190 / 2:460），射程一旦拉成五档就对不上了：
   她拿步枪会站 380 跟人对枪，拿霰弹也是 190 —— 枪的特性完全没进她的脑子。
   现在按「这把枪的射程」折算：近战枪贴脸，远程枪往后站。
   上限夹 620，是因为她再远就走出镜头了 —— AI 不需要把枪打到极限，
   那是玩家的玩法。 */
function idealRange(b, wp) {
  const st = BUDDY_STYLES[b.style];
  const R = (wp && wp.range) || 1600;
  const min = b.weapon === 1 ? 70 : Math.max(120, R * 0.13);
  const max = Math.max(min + 100, clamp(R * 0.40, 210, 620) * st.rangeMul);
  return { min: min, max: max };
}

function chooseWeapon(b, dist, crowd) {
  if (b.reloading > 0) return;
  /* 玩家在武器库里给大肥鱼指定了枪（gunLock >= 0）：
     她就不再有「挑枪」这个念头，只换弹不换枪。
     这是「支持为大肥鱼搭配武器」在战斗层的唯一落点 ——
     AI 的所有判断都退回给玩家，剩下的命中/走位照旧自动。 */
  if (b.gunLock >= 0) return;
  const cur = b.weapon;
  let want = cur;
  if (dist < 200 && b.mags[1] >= 2) want = 1;                 /* 贴脸霰弹 */
  else if (crowd >= 3 && b.mags[2] >= 15) want = 2;           /* 人多机枪 */
  else if (b.mags[0] > 0) want = 0;
  else if (b.mags[2] > 0) want = 2;
  else if (b.mags[1] > 0) want = 1;
  if (want !== cur) {
    b.weapon = want;
    b.reloading = 0;
    b.reselect = 0.35;
    blog(b, '换 ' + WEAPONS[want].name);
  }
}

/* ---------------- 执行：位移 ---------------- */
function approachX(b, targetX, speed) {
  const dx = targetX - b.x;
  if (Math.abs(dx) < 10) { b.vx = lerp(b.vx, 0, 0.3); return; }
  b.vx = Math.sign(dx) * speed;
}

/* 起跳：直接走 doJump，和玩家用同一套物理（跳高 238px）
   旧版本这里写死 -720（只能跳 123px），所以大肥鱼永远上不了平台 */
function tryJump(a, force) {
  if (!a.onGround || a.jumpCd > 0) return false;
  doJump(a);
  a.coyote = 0;
  a.jumpCd = force ? 0.30 : 0.44;
  return true;
}

/* ---------------- 深渊导航 ----------------
   深渊是「掉下去就没了」，所以 AI 必须会两件事：
   ① 走到崖边停住（moveEntity 里的崖边顶回已负责）；
   ② 真想过就横着蹬一脚跳过去，别在边上磨蹭到掉血。 */
function pitAhead(a, dir) {
  return !groundAt(a.x + dir * (a.w * 0.5 + 30));
}

/* dir 方向 maxD 内最近的一块实地距离；没有就返回 -1 */
function groundDist(a, dir, maxD) {
  for (let d = Math.max(2, a.w * 0.5); d < maxD; d += 8) {
    if (groundAt(a.x + dir * d)) return d;
  }
  return -1;
}

/* 跨坑：确认对面够得着才跳，起跳后短时间锁住水平方向，免得被目标点拉回来 */
function crossPit(a, dir) {
  if (!dir) return false;
  const d = groundDist(a, dir, 300);
  if (d < 0) return false;
  if (!tryJump(a)) return false;
  a.vx = dir * 330;
  a.pitJump = 0.46;
  a.pitDir = dir;
  return true;
}

/* 空中补救：脚下是空的、正在往下掉，就往最近的实地蹬一次二段跳 */
function airRescue(a) {
  if (a.onGround || a.vy < 30 || !(a.airJumps > 0)) return false;
  if (groundAt(a.x)) return false;
  const dl = groundDist(a, -1, 240);
  const dr = groundDist(a, 1, 240);
  const dir = dl < 0 && dr < 0 ? 0 : (dl < 0 ? 1 : (dr < 0 ? -1 : (dl < dr ? -1 : 1)));
  if (!doAirJump(a)) return false;
  if (dir) a.vx = dir * 340;
  a.pitJump = 0.4;
  a.pitDir = dir;
  return true;
}

/* ==================================================================
   平台导航：让大肥鱼真的会用空中平台
   · 目标在头上 → 走到能踩的那块钢架下方，起跳
   · 目标在脚下 → 从单向平台直接翻下去追击
   · 被沙袋挡住射界 → 主动上高台取射界
   ================================================================== */
const BUDDY_JUMP_H = 228;     /* 满跳 238px，留 10px 余量 */

/* 站在 (x,y) 上的那块空中平台 */
function platUnder(x, y) {
  for (let i = 0; i < world.platforms.length; i++) {
    const p = world.platforms[i];
    if (p.ground) continue;
    if (x > p.x && x < p.x + p.w && Math.abs(p.y - y) < 5) return p;
  }
  return null;
}

/* 朝 wantX 方向，最近一块「一跳踩得上去」的平台 */
function reachableStep(b, wantX) {
  let best = null, bs = 1e9;
  for (let i = 0; i < world.platforms.length; i++) {
    const p = world.platforms[i];
    if (p.ground) continue;
    const up = b.y - p.y;
    if (up < 26 || up > BUDDY_JUMP_H) continue;          /* 太低不用跳 / 太高跳不到 */
    const board = clamp(b.x, p.x + 16, p.x + p.w - 16);  /* 平台上离自己最近的落脚点 */
    const d = Math.abs(board - b.x) + up * 0.5;
    if (d < bs) { bs = d; best = { p: p, board: board, up: up }; }
  }
  return best;
}

/* 射击线是否被沙袋掩体挡死（挡住就说明该上高台了） */
function lineBlocked(b, tgt) {
  const ey = b.y - b.h * 0.62;
  const ty = tgt.y - tgt.h * 0.55;
  for (let i = 1; i <= 8; i++) {
    const t = i / 9;
    if (coverBlocks(b.x + (tgt.x - b.x) * t, ey + (ty - ey) * t)) return true;
  }
  return false;
}

/* 往上走：走到平台下方 → 起跳。返回 true 表示这一帧的移动已经被接管 */
function climbToward(b, wantX, wantY) {
  if (!b.onGround || b.jumpCd > 0) return false;
  if (wantY > b.y - 26) return false;        /* 目标不在上头 */
  if (b.y - wantY < 8) return false;         /* 已经在同一层 */

  const step = reachableStep(b, wantX);
  if (!step) return false;

  const spanL = step.p.x + b.w * 0.5 - 4;
  const spanR = step.p.x + step.p.w - b.w * 0.5 + 4;

  if (b.x > spanL && b.x < spanR) {
    if (!tryJump(b)) return false;
    /* 空中继续朝目标方向带一点速度，别跳成原地起落 */
    const d = wantX - b.x;
    b.airX = Math.abs(d) > 20 ? wantX : b.x;
    b.airT = 0.75;
    if (Math.abs(d) > 20) b.vx = Math.sign(d) * 210;
    if (!b.lastClimbT || game.time - b.lastClimbT > 3) {
      b.lastClimbT = game.time;
      blog(b, '跳上钢架（+ ' + Math.round(step.up) + 'px）');
    }
    return true;
  }

  /* 还没走到平台下面：先过去 */
  const d2 = step.board - b.x;
  if (Math.abs(d2) > 6) {
    b.vx = Math.sign(d2) * Math.min(280, 150 + Math.abs(d2) * 1.2);
    return true;
  }
  return false;
}

/* ==================== 大肥鱼主更新 ==================== */
function updateBuddy(dt) {
  const b = buddy, p = player;
  const st = BUDDY_STYLES[b.style] || BUDDY_STYLES[1];

  if (b.dead) return;

  if (b.downed) {
    b.vx = lerp(b.vx, 0, 0.2);
    b.downTimer -= dt;
    b.reviveProgress = Math.max(0, b.reviveProgress - dt * 0.3);
    if (b.downTimer <= 0) { b.dead = true; b.downed = false; }
    moveEntity(b, dt);
    return;
  }

  /* --- 计时器 --- */
  b.flash = Math.max(0, b.flash - dt);
  b.invuln = Math.max(0, b.invuln - dt);
  b.muzzle = Math.max(0, b.muzzle - dt);
  b.airJumpT = Math.max(0, (b.airJumpT || 0) - dt);
  b.grenadeCd = Math.max(0, b.grenadeCd - dt);
  b.fireCd = Math.max(0, b.fireCd - dt);
  b.bubbleTimer = Math.max(0, b.bubbleTimer - dt);
  b.bubbleCd = Math.max(0, b.bubbleCd - dt);
  b.dodgeCd = Math.max(0, b.dodgeCd - dt);
  b.jumpCd = Math.max(0, b.jumpCd - dt);
  b.react = Math.max(0, b.react - dt);
  b.reselect = Math.max(0, b.reselect - dt);
  b.coyote = b.onGround ? 0.1 : Math.max(0, b.coyote - dt);
  b.think -= dt;

  /* ================= 1. 感知（每帧都做，但只做便宜的事） ================= */
  const threat = scanIncoming(b, 0.45);

  /* ================= 2. 决策节拍（每 0.15 秒重估一次） ================= */
  if (b.think <= 0) {
    b.think = 0.15;
    const prev = b.target;
    b.target = pickBuddyTarget(b);
    if (b.target && b.target !== prev) b.react = 0.14;   /* 新目标有个抬手时间 */

    const tgt = b.target;
    const crowd = tgt ? countEnemiesNear(tgt.x, tgt.y - tgt.h * 0.5, 240) : 0;

    if (p.downed) {
      setIntent(b, 'REVIVE', '指挥官倒地，' + (Math.abs(b.x - p.x) < 60 ? '正在拉起' : '全速赶过去'));
    } else if (b.hp < b.maxHp * st.retreatAt) {
      setIntent(b, 'RETREAT', '血量 ' + Math.round(b.hp / b.maxHp * 100) + '%，脱战回血');
    } else {
      const pk = wantPickup(b);
      if (pk) {
        b.grabTarget = pk;
        setIntent(b, 'GRAB', (pk.type === 'health' ? '去补血' : '去补弹') + '（' + Math.round(Math.abs(pk.x - b.x)) + 'px）');
      } else if (b.cmd === 'hold' && Math.abs(b.x - b.holdX) > 60) {
        setIntent(b, 'HOLD', '回守点位');
      } else if (tgt) {
        const dp = Math.round(Math.abs(tgt.x - p.x));
        setIntent(b, 'ENGAGE', tgt.type === 'boss' ? 'BOSS 威胁最大（距你 ' + dp + 'px）'
          : (dp < 220 ? '它已经贴到你跟前（距你 ' + dp + 'px）' : '拦在它和你之间（距你 ' + dp + 'px）'));
      } else if (b.cmd === 'hold') {
        setIntent(b, 'HOLD', '区域内无敌人');
      } else {
        setIntent(b, 'FOLLOW', Math.abs(p.x - b.x) > 240 ? '跟上指挥官' : '掩护位置');
      }
    }

    /* 武器选择 */
    if (b.target) {
      chooseWeapon(b, Math.abs(b.target.x - b.x), crowd);
    } else if (b.weapon !== 0 && b.mags[0] > 0 && b.reloading <= 0) {
      b.weapon = 0;
    }

    /* 战术换弹：没敌人贴近时提前装填 */
    const wpNow = WEAPONS[b.weapon];
    if (b.reloading <= 0 && b.mags[b.weapon] < wpNow.mag * 0.25 && !(b.target && Math.abs(b.target.x - b.x) < 170)) {
      b.reloading = wpNow.reload;
      blog(b, '战术装填');
    }

    /* 喊话 */
    if (b.bubbleCd <= 0) {
      if (b.intent === 'RETREAT') { say('buddy', '我血不多了，先缩一下！'); b.bubbleCd = 7; }
      else if (b.intent === 'REVIVE') { say('buddy', '别死！我来救你！'); b.bubbleCd = 5; }
      else if (b.intent === 'GRAB' && Math.random() < 0.5) { say('buddy', '我去捡个补给。'); b.bubbleCd = 8; }
      else if (b.intent === 'ENGAGE' && Math.random() < 0.05) { say('buddy', '发现敌人，开火！'); b.bubbleCd = 9; }
    }
  }

  /* ================= 3. 反射：躲弹（不受决策节拍限制） ================= */
  if (threat.count > 0 && b.dodgeCd <= 0) {
    /* 0.12 秒内必中 → 无论什么风格都跳 */
    const urgent = threat.minT < 0.16;
    if (b.onGround && (urgent || Math.random() < st.dodge * 0.5)) {
      if (tryJump(b, urgent)) {
        b.dodgeCd = urgent ? 0.32 : 0.5;
        b.vx = -threat.fromRight * 180;
        game.tele.dodges++;
        blog(b, '跳起躲弹（' + threat.count + '发来袭）');
      }
    } else if (urgent) {
      b.vx = -threat.fromRight * 320;
    }
  }

  /* ================= 4. 执行：位移 ================= */
  const speed = 240;
  const tgt = b.target;
  const wp = WEAPONS[b.weapon];

  switch (b.intent) {
    case 'REVIVE': {
      approachX(b, p.x, speed * 1.25);
      if (Math.abs(b.x - p.x) < 54) {
        b.vx = 0;
        p.reviveProgress += dt;
        b.reviveK = 1;               /* 大肥鱼蹲下去拉人：和玩家救他用同一套动作 */
        if (Math.random() < dt * 8) spawnParticles(p.x, p.y - 20, 1, '#7ef0b0', 90, 0.5, 3, -60);
        if (p.reviveProgress >= 2.2) {
          p.downed = false;
          p.hp = p.maxHp * 0.45;
          p.reviveProgress = 0;
          p.invuln = 1.2;
          sfxRevive();
          spawnText(p.x, p.y - 70, '复活！', '#7ef0b0');
          say('buddy', '站起来，接着干！');
          blog(b, '完成救援');
        }
      }
      break;
    }
    case 'RETREAT': {
      /* 往叛离火线的方向退，同时保持和玩家的距离不超过一个屏幕 */
      let away = tgt ? (b.x < tgt.x ? -1 : 1) : (b.x < p.x ? 1 : -1);
      if (Math.abs(b.x - p.x) > 520) away = Math.sign(p.x - b.x);
      approachX(b, b.x + away * 260, speed * 1.05);
      if (b.hp < b.maxHp * st.healTo) b.hp = Math.min(b.maxHp * st.healTo, b.hp + 11 * dt);
      break;
    }
    case 'GRAB': {
      const pk = b.grabTarget;
      if (!pk || pickups.indexOf(pk) < 0) { b.grabTarget = null; b.vx = lerp(b.vx, 0, 0.2); break; }
      approachX(b, pk.x, speed * 1.1);
      if (pk.y < b.y - 30 && Math.abs(pk.x - b.x) < 60) tryJump(b);
      break;
    }
    case 'ENGAGE': {
      if (!tgt) { b.vx = lerp(b.vx, 0, 0.2); break; }
      const adx = Math.abs(tgt.x - b.x);
      const ideal = idealRange(b, wp);
      const melee = ENEMY_TYPES[tgt.type].melee;

      /* 核心：站在「指挥官 ↔ 敌人」的连线中间。
         既替指挥官吃火力（敌人优先打最近的人），又能稳定输出。 */
      const dir = Math.sign(tgt.x - p.x) || Math.sign(tgt.x - b.x) || 1;
      const wantDist = ideal.min + (ideal.max - ideal.min) * 0.5;
      let idealX = tgt.x - dir * wantDist;
      idealX = clamp(idealX, p.x - 290, p.x + 290);      /* 但不脱离指挥官 */

      if (melee) {
        /* 冲锋兵冲过来了：先退半步点射，冲到脸上再后跳 */
        if (adx < 110) {
          const away = b.x < tgt.x ? -1 : 1;
          b.vx = away * speed * 1.15;
          if (b.onGround && b.jumpCd <= 0) { tryJump(b); b.vx = away * 300; blog(b, '后跳躲冲锋'); }
        } else if (adx > 280) {
          approachX(b, idealX, speed * st.chase);
        } else {
          const d2 = idealX - b.x;
          b.vx = Math.abs(d2) > 50 ? Math.sign(d2) * speed * 0.7 : lerp(b.vx, 0, 0.18);
        }
      } else {
        const d2 = idealX - b.x;
        if (Math.abs(d2) > 44) {
          approachX(b, idealX, speed * (Math.abs(d2) > 220 ? st.chase * 1.1 : 0.85));
        } else {
          /* 站位内做小幅侧移，避免变成活靶子 */
          if (b.strafeTimer === undefined || b.strafeTimer <= 0) {
            b.strafeDir = Math.random() < 0.5 ? 1 : -1;
            b.strafeTimer = rand(0.7, 1.4);
          }
          b.strafeTimer -= dt;
          b.vx = lerp(b.vx, b.strafeDir * speed * 0.4, 0.3);
        }
      }

      /* 敌人站在上一层平台 / 自己被沙袋挡住射界 → 主动占高台 */
      if (b.onGround && !b.plat && lineBlocked(b, tgt)) {
        const step = reachableStep(b, tgt.x);
        if (step && climbToward(b, step.board, step.p.y)) {
          if (!b.lastHigT || game.time - b.lastHigT > 4) {
            b.lastHigT = game.time;
            blog(b, '射界被沙袋挡住，上高台');
          }
          break;
        }
      }
      break;
    }
    case 'HOLD': {
      if (Math.abs(b.x - b.holdX) > 46) approachX(b, b.holdX, speed * 0.9);
      else b.vx = lerp(b.vx, 0, 0.2);
      break;
    }
    default: { /* FOLLOW */
      const dx = p.x - b.x;
      const adx = Math.abs(dx);
      /* 有潜在威胁时，站到指挥官靠威胁的那一侧；否则跟在身后 */
      const side = tgt ? (Math.sign(tgt.x - p.x) || 1) : (dx > 0 ? -1 : 1);
      const anchor = p.x + side * 155;
      if (adx > 250 || Math.sign(anchor - b.x) !== Math.sign(dx)) {
        approachX(b, anchor, speed * 1.08);
      } else if (adx < 100) {
        approachX(b, b.x + (dx > 0 ? -150 : 150), speed * 0.7);
      } else {
        b.vx = lerp(b.vx, 0, 0.14);
      }
      /* 指挥官在上一层平台 → 跳上去跟 */
      if (p.y < b.y - 40 && adx < 220 && b.onGround) tryJump(b);
    }
  }

  /* ================= 4.2 深渊：该跳就跳，别在坑边耗着 ================= */
  if (b.pitJump > 0) {
    b.pitJump -= dt;
    b.vx = (b.pitDir || 0) * 330;
  } else if (b.onGround) {
    const ed = b.pitEdge || 0;             /* 被崖边顶住的方向 */
    const md = Math.sign(b.vx) || 0;
    const dir = ed || md;
    if (dir && pitAhead(b, dir) && crossPit(b, dir)) {
      blog(b, ed ? '贴着坑边，跳过去' : '前面是缺口，起跳');
    }
  } else if (airRescue(b)) {
    blog(b, '空中再蹬一下（二段跳）');
  }

  /* ================= 4.5 垂直导航（平台） ================= */
  /* 先算出「我真正想去的地方」，再看要不要上/下平台 */
  let wantX = b.x, wantY = b.y;
  if (b.intent === 'REVIVE') { wantX = p.x; wantY = p.y; }
  else if (b.intent === 'ENGAGE' && tgt) { wantX = tgt.x; wantY = tgt.y; }
  else if (b.intent === 'GRAB' && b.grabTarget) { wantX = b.grabTarget.x; wantY = b.grabTarget.y + 14; }
  else if (b.intent === 'FOLLOW') { wantX = p.x; wantY = p.y; }

  /* 目标在高处 → 找台阶跳上去 */
  const climbing = climbToward(b, wantX, wantY);

  /* 目标在低处、自己踩在空中平台上 → 翻下去追（单向平台，直接落） */
  /* 脚下是哪块平台按坐标现算一次，避免 b.plat 在关卡重排后残留 */
  const onPlat = b.onGround ? platUnder(b.x, b.y) : null;
  if (!climbing && onPlat && b.onGround && b.intent !== 'ENGAGE'
      && wantY > b.y + 46 && Math.abs(wantX - b.x) < 260) {
    b.dropTimer = DROP_TIME;
    b.y += 4;
    b.vy = 70;
    b.onGround = false;
    if (!b.lastDropT || game.time - b.lastDropT > 2.5) {
      b.lastDropT = game.time;
      blog(b, '跳下平台追击');
    }
  }

  /* 起跳后在空中的横向修正：确保真的落在钢架上 */
  if (b.airT > 0) {
    b.airT -= dt;
    if (!b.onGround) {
      const d = b.airX - b.x;
      if (Math.abs(d) > 14) b.vx = Math.sign(d) * 250;
      else b.vx = lerp(b.vx, 0, 0.25);
    }
  }

  /* 硬约束：绝不能掉队太远 */
  if (Math.abs(b.x - p.x) > 760 && !p.downed) {
    b.vx = Math.sign(p.x - b.x) * speed * 1.4;
  }

  /* ================= 5. 换弹 ================= */
  if (b.reloading > 0) {
    b.reloading -= dt;
    if (b.reloading <= 0) b.mags[b.weapon] = WEAPONS[b.weapon].mag;
  } else if (b.mags[b.weapon] <= 0) {
    b.reloading = WEAPONS[b.weapon].reload * 1.05;
    /* 配枪锁：玩家指定了枪，她打空只会原地装填，不会偷偷换成别的枪。
       没锁（gunLock < 0）时才是「哪把还有子弹就换哪把」。 */
    if (b.gunLock < 0) {
      for (let k = 0; k < WEAPONS.length; k++) {
        if (b.mags[k] > 0) { b.weapon = k; b.reloading = 0; break; }
      }
    }
    if (b.reloading > 0) blog(b, '空仓装填');
  }

  /* ================= 6. 瞄准与开火 ================= */
  const wp2 = WEAPONS[b.weapon];
  if (tgt && b.reloading <= 0) {
    const myEyeY = b.y - b.h * 0.62;
    const tx = tgt.x, ty = tgt.y - tgt.h * 0.55;
    const dist = Math.hypot(tx - b.x, ty - myEyeY);

    /* 预判提前量：按飞行时间估算目标移动 */
    const tof = dist / wp2.speed;
    const lead = Math.min(1.4, tof * st.rangeMul * (b.style === 2 ? 1.15 : 1));
    const aimX = tx + (tgt.vx || 0) * tof * lead;
    const aimY = ty + (tgt.vy || 0) * tof * 0.3;
    const want = Math.atan2(aimY - myEyeY, aimX - b.x);

    /* 距离越远，抬手越慢 */
    b.aim = angleLerp(b.aim, want, 0.42);
    const err = Math.abs(angleDiff(b.aim, want));

    /* 容差随距离收紧，但不做无意义的抖动 */
    const tol = clamp(0.30 - dist * 0.00035, 0.05, 0.26);
    /* 她也要受枪的射程限制：拿霰弹枪不会站在 800px 外对射，
       只在「射程的 85%」以内扣扳机 —— 剩下 15% 留给目标后退的余量。
       820 是原来的硬上限，保留它当保险，免得远程枪让她隔着整张地图点射。 */
    const reach = wp2.range > 0 ? Math.min(820, wp2.range * 0.85) : 820;
    const inRange = Math.abs(tgt.x - b.x) < reach;
    const ready = b.fireCd <= 0 && b.react <= 0 && b.reselect <= 0 && b.mags[b.weapon] > 0;

    if (inRange && err < tol && ready) {
      b.mags[b.weapon]--;
      fireWeapon(b, wp2, b.aim, 1.55, 1);
      game.tele.buddyShots++;
    }

    /* 手雷：至少 3 人扎堆，且不误伤指挥官 */
    if (b.grenadeCd <= 0) {
      const cluster = countEnemiesNear(tgt.x, tgt.y - 40, 190);
      const pSafe = Math.abs(p.x - tgt.x) > 160;
      if (cluster >= 3 && pSafe) {
        b.grenadeCd = 8;
        const ang = Math.atan2(-150, (tgt.x - b.x) * 0.6);
        spawnGrenade(b.x, b.y - b.h * 0.7, Math.cos(ang) * 640, Math.sin(ang) * 640, 80, 'ally');
        say('buddy', '吃颗手雷！');
        b.bubbleCd = 6;
        game.tele.grenades++;
        blog(b, '投手雷（' + cluster + '人扎堆）');
      }
    }
  } else if (Math.abs(b.vx) > 30) {
    b.aim = angleLerp(b.aim, b.vx > 0 ? 0 : Math.PI, 0.15);
  }

  /* 蹲下：远距离对枪 / 自己换弹 / 挨打时压低身位 —— 和玩家同一套规则，
     只在原地不动时蹲，避免蹲着跑被箱子卡住。
     趴下同样是通用动作，她有三条动机：
       ① 被子弹压制（suppressPass 打的标记）—— 先趴下把这阵弹雨躲过去
       ② 远距离换弹 —— 对面正在压、自己又打不出弹，这是最保守的一手
       ③ 远距离对枪但暂时打不出火 —— 卧射比站射稳
     和敌兵一样用 proneT / proneCd 双计时器锁住，避免条件互相打脸导致抽搐。 */
  b.proneCd = Math.max(0, (b.proneCd || 0) - dt);
  b.suppressCd = Math.max(0, (b.suppressCd || 0) - dt);
  b.suppress = Math.max(0, (b.suppress || 0) - dt);
  if (b.proneT > 0) {
    b.proneT -= dt;
    if (!b.onGround) b.proneT = 0;
  }

  let bWantCrouch = false;
  const bdx = tgt ? Math.abs(tgt.x - b.x) : 0;
  if (b.onGround && b.intent === 'ENGAGE' && tgt && !ENEMY_TYPES[tgt.type].melee
      && Math.abs(b.vx) < 70 && b.jumpBuffer <= 0) {
    if (b.reloading > 0 && bdx > 190) bWantCrouch = true;
    else if (bdx > 400 && b.fireCd > 0.10) bWantCrouch = true;
    else if (b.hp < b.maxHp * 0.5 && bdx > 260) bWantCrouch = true;
  }

  if (b.proneT <= 0 && b.proneCd <= 0 && b.onGround && b.jumpBuffer <= 0) {
    let hold = 0;
    if (b.suppress > 0 && bdx > 180) hold = 0.9;                       /* ① 挨压制 */
    else if (bWantCrouch && b.reloading > 0.35 && bdx > 520) hold = 1.2; /* ② 远处换弹 */
    else if (bWantCrouch && bdx > 620 && b.fireCd > 0.30) hold = 1.0;    /* ③ 远处卧射 */
    if (hold > 0) {
      b.proneT = hold;
      b.proneCd = hold + 1.3;
    }
  }
  const bWantProne = b.proneT > 0 && b.onGround;
  /* 和玩家同一条曲线（util.js poseStep）：扑倒快、起身慢。
     大肥鱼是「以后重要角色战斗的模板」，姿态节奏必须和主角一致，
     否则照着他调出来的角色会各自跑偏一套手感。
     和 game.js 一样去掉了 `prone < 0.02 → 0` 的守卫：补间两端本来就精确，
     守卫只会把第一帧的运动抹掉。 */
  const bPr = poseStep(b, 'prone', bWantProne, dt);
  if (bPr.done && bPr.dir > 0 && bPr.from < 0.4) {
    spawnParticles(b.x, b.y - 6, 9, '#c9b89a', 100, 0.34, 3.8, 620);
  }
  /* 蹲下走和玩家同一条补间（util.js crouchStep）：
     以前大肥鱼是 0.0015、玩家是 0.0006 —— 同一句「蹲下」，主角蹲得比
     队友慢一半，并排蹲在掩体后面像两个不同游戏的人。 */
  crouchStep(b, bWantCrouch && !bWantProne, dt);
  b.h = stanceH(b, 17);
  b.hitW = stanceHitW(b);

  /* 趴着就像爬：超过站立速度 38% 的那部分一律砍掉（和玩家爬行同一个上限），
     否则「趴下」对 AI 来说只是白拿的减伤，没有任何代价。 */
  if (proneK(b) > 0.35) {
    const crawlCap = 290 * 0.38;
    b.vx = clamp(b.vx, -crawlCap, crawlCap);
    b.pitJump = 0;
  }

  actRun(b, dt);
  moveEntity(b, dt);

  /* 大肥鱼被木箱 / 砖墙挡住 → 翻过去，别卡在掩体前面发呆 */
  if (b.blocked && b.onGround && b.jumpCd <= 0 && Math.abs(b.vx) > 20) {
    if (tryJump(b)) b.vx = Math.sign(b.vx) * Math.max(Math.abs(b.vx), 260);
  }

  b.x = clamp(b.x, 24, world.w - 24);
}

/* ==================== 敌兵 AI ==================== */

function pickEnemyTarget(e) {
  const cands = [];
  if (player && !player.downed && !player.dead) cands.push(player);
  if (buddy && !buddy.downed && !buddy.dead) cands.push(buddy);
  if (!cands.length) return null;
  let best = cands[0], bd = 1e9;
  for (const c of cands) {
    let d = Math.abs(c.x - e.x);
    if (c.kind === 'player') d *= 0.85; /* 略微优先打玩家 */
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/* ---------------- 压制判定：子弹擦身而过 ----------------
   卧下既然是「战术躲避动作」，AI 就必须先知道「有子弹冲我来了」——
   否则它只能靠血条、靠换弹这种间接信号决定趴不趴，读起来就不像在躲子弹。
   判据用「线段到点的距离」而不是「点在不在框里」：子弹一帧能飞 30~60px，
   只测当前位置会漏掉真正贴脸掠过的那一类 —— 而那一类恰恰是最该趴下的。
   玩家不在这套里：趴下是玩家自己的按键（Z），不需要 AI 替他做决定。 */
const SUPPRESS_R = 46;
function suppressPass(x0, y0, x1, y1, team) {
  const vx = x1 - x0, vy = y1 - y0;
  const L2 = vx * vx + vy * vy;
  if (L2 < 1) return;
  const whiz = (ax, ay) => {
    const k = clamp(((ax - x0) * vx + (ay - y0) * vy) / L2, 0, 1);
    const dx = ax - (x0 + vx * k), dy = ay - (y0 + vy * k);
    return dx * dx + dy * dy < SUPPRESS_R * SUPPRESS_R;
  };

  if (team === 'enemy') {
    /* 敌人的弹雨只「提醒大肥鱼该卧倒」，玩家自己按 Z */
    if (buddy && !buddy.dead && !buddy.downed && (buddy.suppressCd || 0) <= 0 &&
        whiz(buddy.x, buddy.y - (buddy.h || 58) * 0.7)) {
      buddy.suppress = 0.5;
      buddy.suppressCd = 0.9;
    }
    return;
  }

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead || (e.suppressCd || 0) > 0) continue;
    if (whiz(e.x, e.y - (e.h || 56) * 0.7)) {
      e.suppress = 0.5;
      e.suppressCd = 0.8;
    }
  }
}

/* 打一枪就少一发；打空自动进换弹，换完补满。
   注意：返回 false 表示这一枪没打出去（弹匣空 / 正在换弹）。 */
function enemyShoot(e, target, spread, count) {
  const n = count || 1;
  if (e.reloadT > 0) return false;
  if (e.magMax > 0 && e.mag <= 0) {
    /* e.reload 是二阶段写进来的实例值（更快），没有就回落到兵种底表 */
    e.reloadT = e.reload || (ENEMY_TYPES[e.type] || {}).reload || 2;
    return false;
  }
  if (e.magMax > 0) e.mag = Math.max(0, e.mag - n);

  /* 敌人的子弹也有弹道：轻微下坠 + 一点点减速，画得比玩家的细。
     不给他们抬枪补偿 —— 远距离本来就不该枪枪点名，这正好给了玩家距离感。 */
  const wp = {
    speed: 900, dmg: e.dmg, color: '#ff8a5c', pellets: n, spread: spread,
    rate: 1, sfx: 'small', grav: 90, drag: 0.06, bw: 1.2
  };
  /* 趴下时 e.h 本身已被 stanceH 压到 24 上下，枪口跟着自然贴地，
     所以这里只需要再按「有效蹲姿」微调一点，不要再叠 prone 的位移 */
  const gunY = e.y - e.h * (0.6 - 0.12 * cqEff(e));
  const ty = target.y - target.h * 0.55;
  const base = Math.atan2(ty - gunY, target.x - e.x);
  for (let i = 0; i < wp.pellets; i++) {
    const ang = base + rand(-spread, spread);
    spawnBullet(e.x + Math.cos(ang) * 26, gunY + Math.sin(ang) * 26,
      Math.cos(ang) * wp.speed, Math.sin(ang) * wp.speed, wp.dmg, 'enemy', wp.color, 3, e.type,
      { ignorePlat: e.plat });
  }
  e.muzzle = 0.06;
  beep(rand(150, 190), 0.05, 'square', 0.018, 80);
  return true;
}

/* 找一个「同层、挡得住、在威胁反方向」的箱子 */
function findCover(e, threatX) {
  let best = null, bd = 1e9;
  for (const b of world.blocks) {
    if (b.hp <= 0) continue;
    if (b.h < 38) continue;                       /* 太矮挡不住站姿 */
    if (Math.abs(b.y - e.y) > 34) continue;       /* 只挑自己这一层的 */
    const backX = b.x + b.w / 2 > threatX ? b.x + b.w + 18 : b.x - 18;
    if (backX < 50 || backX > world.w - 50) continue;
    const d = Math.abs(backX - e.x);
    if (d > 320) continue;
    if (d < bd) { bd = d; best = backX; }
  }
  return best;
}

function updateEnemy(e, dt) {
  if (e.dead) return;

  e.flash = Math.max(0, e.flash - dt);
  e.muzzle = Math.max(0, (e.muzzle || 0) - dt);
  e.meleeCd = Math.max(0, e.meleeCd - dt);
  e.fireCd = Math.max(0, e.fireCd - dt);
  e.burstCd = Math.max(0, e.burstCd - dt);
  e.minionCd = Math.max(0, (e.minionCd || 0) - dt);
  e.strafeTimer = Math.max(0, e.strafeTimer - dt);
  e.jumpCd = Math.max(0, (e.jumpCd || 0) - dt);
  e.coverCd = Math.max(0, (e.coverCd || 0) - dt);
  e.throwCd = Math.max(0, (e.throwCd || 0) - dt);
  e.slamCd = Math.max(0, (e.slamCd || 0) - dt);

  /* 换弹：打空后强制硬直，这是玩家最好的反打窗口 */
  if (e.reloadT > 0) {
    e.reloadT -= dt;
    if (e.reloadT <= 0) { e.reloadT = 0; e.mag = e.magMax; }
  }

  /* 空降中：只下落，不作战 */
  if (e.chute > 0) {
    e.vx = lerp(e.vx, 0, 0.10);
    actRun(e, dt);                 /* 伞降：空中那两条腿要收起来，别冻在上一帧的步幅上 */
    e.crouch = lerp(e.crouch, 0, 0.2);
    moveEntity(e, dt);
    return;
  }

  if (e.spawnGuard > 0) {
    e.spawnGuard -= dt;
    e.vx = lerp(e.vx, 0, 0.2);
    actRun(e, dt);                 /* 出场保护期：站直，但呼吸和起伏还在走 */
    crouchStep(e, false, dt);
    e.prone = lerp(e.prone || 0, 0, 0.2);
    e.h = stanceH(e, 15);
    e.hitW = stanceHitW(e);
    moveEntity(e, dt);
    return;
  }

  const target = pickEnemyTarget(e);
  if (!target) {
    /* 没目标就站起来：趴着打空气只会被玩家从背后白嫖 */
    e.vx = lerp(e.vx, 0, 0.2);
    actRun(e, dt);                 /* 没目标：站起来，呼吸照走 */
    crouchStep(e, false, dt);
    e.prone = lerp(e.prone || 0, 0, 0.15);
    if (e.prone < 0.02) e.prone = 0;
    e.h = stanceH(e, 15);
    e.hitW = stanceHitW(e);
    moveEntity(e, dt);
    return;
  }

  const dx = target.x - e.x;
  const adx = Math.abs(dx);
  const dir = Math.sign(dx) || 1;
  const t = ENEMY_TYPES[e.type];
  const hpR = e.hp / e.maxHp;

  /* ---------- BOSS 二阶段：血量跌破 40% 进入狂暴 ----------
     只在跨过阈值的那一帧触发一次（e.phase2 锁死）。不锁的话每帧都会
     乘一遍 1.22，三秒后 boss 的速度会叠到 1.22^180 —— 那是瞬移不是狂暴。
     三个 BOSS 共用这一条规则：狂暴是「共同语言」，各关的差异仍留在
     各自的专属招（召唤 / 燃烧瓶 / 震地）里。 */
  if (e.boss && !e.phase2 && hpR < 0.40) {
    e.phase2 = true;
    e.speed *= 1.22;
    /* fireRate 是「两枪之间等多久」，乘 0.80 才是打得更快。
       e.fireRate 是实例值（阶段内生效），t.fireRate 是兵种底表 ——
       底表不能动，动了同一关里所有同型敌人一起提速。 */
    if (e.fireRate) e.fireRate *= 0.80;
    else if (t.fireRate) e.fireRate = t.fireRate * 0.80;
    if (e.reload) e.reload *= 0.85;
    else if (t.reload) e.reload = t.reload * 0.85;

    addShake(9);
    game.screenFlash = Math.max(game.screenFlash || 0, 0.22);
    /* 一圈红金粒子：两种颜色分两次发射，读起来才是「炸开」，不是「冒烟」 */
    spawnParticles(e.x, e.y - e.h * 0.5, 18, '#ff5a3c', 340, 0.55, 4.6, 120);
    spawnParticles(e.x, e.y - e.h * 0.5, 12, '#ffd166', 250, 0.75, 3.6, 40);
    spawnText(e.x, e.y - e.h - 30, '进入狂暴', '#ff7a5a', { size: 1.2 });
    say('buddy', '它急了！别跟它贴脸！');
    if (typeof audioMode === 'function') audioMode('boss');
    beep(240, 0.18, 'sawtooth', 0.05, 90);
  }

  /* 朝向目标（蹲下时枪口更低一点） */
  e.aim = angleLerp(e.aim,
    Math.atan2((target.y - target.h * 0.55) - (e.y - e.h * (0.6 - 0.12 * cqEff(e))), dx), 0.14);

  /* ---------- 典狱长震地：蓄力期间站定，蓄满炸一圈 ---------- */
  if (e.slamFx > 0) {
    e.slamFx -= dt;
    e.vx = lerp(e.vx, 0, 0.45);
    /* 蓄力提示：脚下每帧冒火星，给玩家 0.55 秒跑开 */
    if (Math.random() < dt * 26) {
      spawnParticles(e.x + rand(-46, 46), e.y - 4, 1, '#ffb066', 80, 0.34, 3, 520);
    }
    if (e.slamFx <= 0) {
      explode(e.x, e.y - 6, 186, e.dmg * 1.15, 'enemy');
      addShake(14);
      e.slamCd = 7.0;
    }
    actRun(e, dt);
    moveEntity(e, dt);
    e.x = clamp(e.x, 20, world.w - 20);
    return;
  }

  /* ---------- 躲掩体：血少或换弹时缩到箱子后面 ---------- */
  let hiding = false;
  if (!t.melee && !e.boss) {
    if ((e.reloadT > 0 || hpR < 0.42) && e.hideX === 0 && e.coverCd <= 0) {
      e.hideX = findCover(e, target.x);
      e.hideT = 2.6;
      e.coverCd = rand(1.6, 3.0);
    }
    if (e.hideX !== 0) {
      const hd = e.hideX - e.x;
      if (Math.abs(hd) > 14 && e.hideT > 0) {
        e.vx = Math.sign(hd) * Math.min(e.speed * 1.15, 60 + Math.abs(hd) * 2.2);
        if (e.jumpCd <= 0 && e.onGround && Math.abs(hd) > 70 && Math.random() < 0.02) tryJump(e);
      } else {
        hiding = true;
        e.hideT -= dt;
        e.vx = lerp(e.vx, 0, 0.22);
        if (e.hideT <= 0) e.hideX = 0;
      }
    }
  } else {
    e.hideX = 0;
  }

  /* ---------- 蹲下 / 趴下 ----------
     蹲：换弹、躲掩体、远距离对枪。
     趴：通用战术卧倒 —— 每个兵种都会，不是机枪兵的职业特性。三条动机会趴：
       ① 被压制：子弹从身边擦过去 → 就地卧倒，等这阵弹雨过去（冲锋兵也吃这条）
       ② 换弹 / 残血：把受击身高从 56 压到 28，高处打来的子弹直接过顶
       ③ 站定对枪：卧射散布收紧（机枪兵脚架、步兵卧姿），代价是横向受击宽 +36
     关键：趴下是「承诺」，不是每帧重算。decision 只在 proneT 到期、proneCd 归零
     的那一帧做一次，然后锁住时长 —— 否则「趴/站」条件互相打脸，人会在原地抽搐。 */
  e.proneCd = Math.max(0, (e.proneCd || 0) - dt);
  e.suppressCd = Math.max(0, (e.suppressCd || 0) - dt);
  e.suppress = Math.max(0, (e.suppress || 0) - dt);
  if (e.proneT > 0) {
    e.proneT -= dt;
    if (!e.onGround) e.proneT = 0;       /* 被震飞 / 掉下台就自动起身 */
  }

  const near = adx > 120 && adx < (t.range || 420) * 1.15 && Math.abs(target.y - e.y) < 70;
  const calm = e.onGround && !hiding && Math.abs(e.vx) < 40 && e.slamFx <= 0;

  if (e.proneT <= 0 && e.proneCd <= 0 && !!t.prone && near) {
    let hold = 0;
    if (e.suppress > 0 && adx > 130) {
      /* ① 压制卧倒：被弹雨盖住，先趴下把身位压低。近战兵趴得更短 —— 趴久了
         就真冲不到了，这一段只是「挨打时缩一下」，不是战术选择。 */
      hold = t.melee ? rand(0.30, 0.60) : rand(0.55, 1.15);
    } else if (calm && !t.melee && e.reloadT > 0.05 && adx > 300 && Math.random() < 0.65) {
      hold = rand(0.75, 1.35);            /* ② 趴着换弹 */
    } else if (calm && !t.melee && hpR < 0.6 && adx > 260 && Math.random() < 0.55) {
      hold = rand(0.65, 1.25);            /* ② 残血：卧倒缩身位 */
    } else if (calm && !t.melee && adx > 300 &&
               Math.random() < (t.burst ? 0.85 : 0.22)) {
      hold = t.burst ? rand(1.1, 2.1) : rand(0.55, 1.1);   /* ③ 卧射压枪 */
    }
    if (hold > 0) {
      e.proneT = hold;
      /* 冷却 = 趴的时长 + 一段站着的时间，强制它起身换位再趴回去 */
      e.proneCd = hold + rand(1.1, 2.2);
    }
  }
  const wantProne = e.proneT > 0 && e.onGround;

  const wantCrouch = e.onGround && !t.melee &&
    (hiding || e.reloadT > 0.35 || (adx > 380 && e.fireCd > 0.25 && hpR < 0.8));
  /* 敌兵原来自己一套指数插值（0.0008 / 0.001），比玩家快 40% ——
     玩家看着敌人「唰」地趴下、自己却慢慢倒，会读成「对面作弊」。
     现在三个人用同两条补间：扑倒 0.24 / 起身 0.36 / 蹲 0.16 / 起 0.22。 */
  poseStep(e, 'prone', wantProne, dt);
  /* 趴下优先：躺平后蹲姿淡出，别让 60−15−35 叠成负身高 */
  crouchStep(e, wantCrouch && e.prone < 0.5, dt);
  e.h = stanceH(e, 15);
  e.hitW = stanceHitW(e);

  /* ---------- 玩家爬上平台后，敌人也跟着上 ---------- */
  let climbing = false;
  if (!t.melee && !hiding && target.y < e.y - 40 && adx < 460) {
    climbing = climbToward(e, target.x, target.y);
  }

  if (!hiding && !climbing) {
    if (t.melee) {
      /* 冲锋兵：贴脸近战（趴着的时候砍不了人 —— 得先起身） */
      e.vx = dir * e.speed;
      if (adx < 46 && Math.abs(target.y - e.y) < 70 && e.meleeCd <= 0 && proneK(e) < 0.45) {
        e.meleeCd = 0.95;
        damageFriendly(target, e.dmg);
        target.vx += dir * 260;
        spawnParticles(target.x, target.y - 30, 10, '#ff5a4a', 240, 0.4, 4, 600);
      }
    } else if (t.thrower) {
      /* 掷弹兵：不贴脸，隔一段距离往你脚下丢手雷 */
      if (adx > t.range) e.vx = dir * e.speed;
      else if (adx < t.keep * 0.55) e.vx = -dir * e.speed;
      else {
        if (e.strafeTimer <= 0) { e.strafe *= -1; e.strafeTimer = rand(1.2, 2.4); }
        e.vx = e.strafe * e.speed * 0.5;
      }
      if (e.throwCd <= 0 && adx < t.range && adx > 120) {
        e.throwCd = t.fireRate;
        const gx = target.x + rand(-40, 40);
        const flight = clamp(adx / 420, 0.55, 1.25);
        const vx = (gx - e.x) / flight;
        const vy = (target.y - (e.y - e.h * 0.8)) / flight - 0.5 * 1500 * flight;
        spawnGrenade(e.x, e.y - e.h * 0.8, vx, vy, e.dmg * 2.2, 'enemy');
        spawnText(e.x, e.y - e.h - 12, '手雷！', '#ffb066');
        e.muzzle = 0.08;
      }
    } else if (e.boss) {
      /* ---------- BOSS 主脑：三段通用行为 + 三段专属行为 ----------
         通用：卡住距离 → 扇形扫射 → 定期叫小弟。
         专属：1 关召唤（压场）、2 关燃烧瓶（封走位）、3 关震地（逼你拉开）。
         三个 BOSS 的「打法动词」必须不一样，否则只是同一只怪换了血条。 */

      /* 距离控制：典狱长要靠得更近才好震地，纵火者要更远好扔瓶子 */
      const keepD = t.slam ? t.keep * 0.72 : t.keep;
      if (adx > keepD) e.vx = dir * e.speed;
      else if (adx < keepD * 0.6) e.vx = -dir * e.speed * 0.9;
      else e.vx = lerp(e.vx, 0, 0.1);

      /* ---- 专属 1：钢铁典狱长 · 震地冲击波 ---- */
      if (t.slam && e.slamCd <= 0 && e.onGround && adx < 320 && Math.abs(target.y - e.y) < 90
          && proneK(e) < 0.4) {
        e.slamFx = 0.55;
        e.slamCd = 6.5;
        spawnText(e.x, e.y - e.h - 22, '震地蓄力', '#ffb066');
        sfxCharge();
      }

      /* ---- 专属 2：焦土纵火者 · 抛掷燃烧瓶 ---- */
      if (t.molotov && e.throwCd <= 0 && adx < t.range && adx > 150) {
        e.throwCd = rand(3.4, 5.0);
        const gx = target.x + rand(-56, 56);
        const flight = clamp(adx / 460, 0.6, 1.3);
        const vx = (gx - e.x) / flight;
        const vy = (target.y - (e.y - e.h * 0.85)) / flight - 0.5 * 1500 * flight;
        spawnGrenade(e.x, e.y - e.h * 0.85, vx, vy, e.dmg * 1.7, 'enemy',
          { fire: true, fuse: flight + 0.05 });
        spawnText(e.x, e.y - e.h - 14, '燃烧瓶！', '#ff8a3d');
        e.muzzle = 0.08;
      }

      /* ---- 通用：扇形扫射 ---- */
      if (e.fireCd <= 0) {
        if (enemyShoot(e, target, 0.11, t.slam ? 6 : 5)) {
          sfxShotBig();
          /* 二阶段读过 e.fireRate（更短），没进二阶段就还是兵种底表 */
          e.fireCd = e.fireRate || t.fireRate;
        } else e.fireCd = 0.35;
      }

      /* ---- 专属 3：铁血队长 · 呼叫增援（按关卡决定叫来的兵种） ---- */
      if (e.minionCd <= 0 && enemies.length < 14) {
        e.minionCd = t.slam ? 10 : 8;
        const minion = t.summon || 'grunt';
        spawnEnemyAt(minion, { x: e.x - 70, y: e.y }, game.stage);
        spawnEnemyAt(minion, { x: e.x + 70, y: e.y }, game.stage);
        spawnText(e.x, e.y - e.h - 20, '增援！', '#ff9a6a');
      }
    } else if (t.burst) {
      /* 重机枪兵：点射 */
      if (adx > t.range * 0.9) e.vx = dir * e.speed;
      else if (adx < t.keep * 0.7) e.vx = -dir * e.speed;
      else e.vx = lerp(e.vx, 0, 0.12);

      if (e.burstLeft > 0) {
        if (e.burstCd <= 0) {
          /* 脚架撑开：散布砍一半，这就是「趴下」给敌人的那份收益 */
          if (enemyShoot(e, target, 0.05 * (1 - 0.5 * proneK(e)), 1)) {
            e.burstLeft--;
            e.burstCd = 0.1;
          } else {
            e.burstLeft = 0;                       /* 弹匣空了，整轮点射取消 */
          }
        }
      } else if (e.fireCd <= 0 && adx < t.range) {
        e.fireCd = t.fireRate;
        e.burstLeft = t.burst;
        e.burstCd = 0;
      }
    } else {
      /* 步兵：中距离走走停停 */
      if (adx > t.keep * 1.2) e.vx = dir * e.speed;
      else if (adx < t.keep * 0.6) e.vx = -dir * e.speed * 0.8;
      else {
        if (e.strafeTimer <= 0) { e.strafe *= -1; e.strafeTimer = rand(1, 2.2); }
        e.vx = e.strafe * e.speed * 0.45;
      }
      if (e.fireCd <= 0 && adx < t.range) {
        if (enemyShoot(e, target, 0.085 * (1 - 0.4 * cqEff(e) - 0.45 * proneK(e)), 1)) {
          e.fireCd = t.fireRate * rand(0.85, 1.2);
        } else {
          e.fireCd = 0.3;
        }
      }
    }
  }

  /* 卧倒 = 就地趴着架枪，不是匍匐前进：把水平速度收掉。
     只做阻尼是不够的 —— 上面那段 AI 每帧都把 vx 重新设成 speed，阻尼 10%
     的结果是「趴着还能以九成速度平移」，看起来像贴地滑行。这里直接硬夹到
     站立速度的 38%（和玩家爬行同值），趴下去就真的挪不动了。
     顺带把「掉坑自救」也掐掉 —— 趴着突然横移 300px 会很突兀。 */
  if (proneK(e) > 0.35) {
    const crawlCap = (e.speed || 100) * 0.38;
    e.vx = clamp(lerp(e.vx, 0, 1 - Math.pow(0.002, dt)), -crawlCap, crawlCap);
    e.pitJump = 0;
  }

  actRun(e, dt);
  moveEntity(e, dt);

  /* 被木箱 / 砖墙 / 集装箱挡住 → 翻过去。
     不加这段，废墟和指挥部里的敌人会全部堵在硬掩体前面排队。 */
  if (e.blocked && e.onGround && e.jumpCd <= 0 && !e.chute && e.reloadT <= 0 && proneK(e) < 0.4) {
    const pushing = Math.sign(e.vx) === Math.sign(target.x - e.x) && Math.abs(e.vx) > 12;
    if (pushing) {
      tryJump(e);
      e.jumpCd = 0.9;
      e.vx = Math.sign(e.vx) * Math.max(Math.abs(e.vx), e.speed * 1.15);
    }
  }

  /* 深渊：走到坑边别停在那当靶子，追人要紧就跳过去 */
  if (e.pitJump > 0) {
    e.pitJump -= dt;
    e.vx = (e.pitDir || 0) * 300;
  } else if (e.onGround && e.pitEdge && e.jumpCd <= 0 && !e.chute && e.reloadT <= 0
             && proneK(e) < 0.4) {
    if (crossPit(e, e.pitEdge)) e.jumpCd = 1.0;
  }

  e.x = clamp(e.x, 20, world.w - 20);
}