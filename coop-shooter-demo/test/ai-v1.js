'use strict';

/* ==================================================================
   AI 层：八哥（队友）的极简状态机 + 敌兵行为
   八哥只做四件事：跟人 / 打最近的 / 血少就跑 / 有人倒了去救
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

/* 面向 target 开火（玩家/八哥通用射击函数） */
function fireWeapon(a, wp, aimAngle, spreadMul, dmgMul) {
  const mx = a.x + Math.cos(aimAngle) * 30;
  const my = a.y - a.h * 0.62 + Math.sin(aimAngle) * 30;
  for (let i = 0; i < wp.pellets; i++) {
    const ang = aimAngle + rand(-wp.spread, wp.spread) * spreadMul;
    spawnBullet(mx, my, Math.cos(ang) * wp.speed, Math.sin(ang) * wp.speed,
      wp.dmg * (dmgMul || 1), a.kind === 'buddy' ? 'ally' : a.kind, wp.color);
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

/* ==================== 八哥 AI ==================== */

function decideBuddyState(b, tgt) {
  const p = player;
  if (p.downed) { b.state = 'REVIVE'; return; }
  if (b.hp < b.maxHp * 0.34) { b.state = 'RETREAT'; return; }
  if (b.cmd === 'rush') { b.state = tgt ? 'ENGAGE' : 'FOLLOW'; return; }
  if (b.cmd === 'hold') { b.state = 'HOLD'; return; }
  if (tgt && Math.abs(tgt.x - b.x) < 720) b.state = 'ENGAGE';
  else b.state = 'FOLLOW';
}

function approachX(b, targetX, speed) {
  const dx = targetX - b.x;
  if (Math.abs(dx) < 12) { b.vx = lerp(b.vx, 0, 0.25); return; }
  b.vx = Math.sign(dx) * speed;
}

function updateBuddy(dt) {
  const b = buddy, p = player;

  if (b.dead) return;

  if (b.downed) {
    b.vx = 0;
    b.downTimer -= dt;
    if (b.downTimer <= 0) { b.dead = true; b.downed = false; }
    return;
  }

  b.flash = Math.max(0, b.flash - dt);
  b.invuln = Math.max(0, b.invuln - dt);
  b.muzzle = Math.max(0, b.muzzle - dt);
  b.grenadeCd = Math.max(0, b.grenadeCd - dt);
  b.fireCd = Math.max(0, b.fireCd - dt);
  b.bubbleTimer = Math.max(0, b.bubbleTimer - dt);
  b.bubbleCd = Math.max(0, b.bubbleCd - dt);

  /* --- 思考节拍：每 0.22 秒决策一次，不做逐帧扫描 --- */
  b.think -= dt;
  let tgt = b.target && !b.target.dead ? b.target : null;
  if (b.think <= 0) {
    b.think = 0.22;
    tgt = nearestEnemy(b.x, 900);
    b.target = tgt;
    decideBuddyState(b, tgt);
    /* 血少/救人时喊话 */
    if (b.bubbleCd <= 0) {
      if (b.state === 'RETREAT') { say('buddy', '我血不多了，先缩一下！'); b.bubbleCd = 7; }
      else if (b.state === 'REVIVE') { say('buddy', '别死！我来救你！'); b.bubbleCd = 5; }
      else if (b.state === 'ENGAGE' && Math.random() < 0.06) { say('buddy', '发现敌人，开火！'); b.bubbleCd = 9; }
    }
  }

  /* --- 移动 --- */
  const speed = 235;
  switch (b.state) {
    case 'REVIVE': {
      approachX(b, p.x, speed * 1.15);
      if (Math.abs(b.x - p.x) < 52) {
        b.vx = 0;
        p.reviveProgress += dt;
        if (Math.random() < dt * 8) spawnParticles(p.x, p.y - 20, 1, '#7ef0b0', 90, 0.5, 3, -60);
        if (p.reviveProgress >= 2.2) {
          p.downed = false;
          p.hp = p.maxHp * 0.45;
          p.reviveProgress = 0;
          p.invuln = 1.2;
          sfxRevive();
          spawnText(p.x, p.y - 70, '复活！', '#7ef0b0');
          say('buddy', '站起来，接着干！');
        }
      }
      break;
    }
    case 'RETREAT': {
      const away = tgt ? (b.x < tgt.x ? -1 : 1) : (b.x < p.x ? 1 : -1);
      approachX(b, b.x + away * 240, speed);
      /* 脱离火线时慢慢回血，最多回到 60% */
      if (b.hp < b.maxHp * 0.6) b.hp = Math.min(b.maxHp * 0.6, b.hp + 9 * dt);
      break;
    }
    case 'ENGAGE': {
      if (tgt) {
        const adx = Math.abs(tgt.x - b.x);
        if (adx > 330) approachX(b, tgt.x, speed);
        else if (adx < 150) approachX(b, b.x + (b.x < tgt.x ? -1 : 1) * 160, speed * 0.8);
        else { b.vx = lerp(b.vx, 0, 0.15); }
      } else {
        b.vx = lerp(b.vx, 0, 0.2);
      }
      break;
    }
    case 'HOLD': {
      if (Math.abs(b.x - b.holdX) > 70) approachX(b, b.holdX, speed);
      else b.vx = lerp(b.vx, 0, 0.2);
      break;
    }
    default: { /* FOLLOW */
      const dx = p.x - b.x;
      const adx = Math.abs(dx);
      if (adx > 260) approachX(b, p.x + (dx > 0 ? -170 : 170), speed * 1.05);
      else if (adx < 110) approachX(b, b.x + (dx > 0 ? -150 : 150), speed * 0.75);
      else b.vx = lerp(b.vx, 0, 0.12);
    }
  }

  /* 跟随时不要离玩家太远（硬约束） */
  if (Math.abs(b.x - p.x) > 700 && !p.downed) {
    b.vx = Math.sign(p.x - b.x) * speed * 1.35;
  }

  /* --- 换枪：近距离切霰弹 --- */
  const wp = WEAPONS[b.weapon];
  if (b.reloading <= 0 && tgt) {
    const near = Math.abs(tgt.x - b.x) < 250;
    if (near && b.weapon !== 1 && b.mags[1] > 0) b.weapon = 1;
    else if (!near && b.weapon === 1 && b.mags[0] > 0) b.weapon = 0;
  }

  /* --- 换弹 --- */
  if (b.reloading > 0) {
    b.reloading -= dt;
    if (b.reloading <= 0) b.mags[b.weapon] = WEAPONS[b.weapon].mag;
  } else if (b.mags[b.weapon] <= 0) {
    b.reloading = WEAPONS[b.weapon].reload * 1.1;
    if (b.weapon === 1 && b.mags[0] > 0) b.weapon = 0, b.reloading = 0;
  }

  /* --- 瞄准 & 开火 --- */
  const w2 = WEAPONS[b.weapon];
  if (tgt) {
    const tx = tgt.x, ty = tgt.y - tgt.h * 0.58;
    const want = Math.atan2(ty - (b.y - b.h * 0.62), tx - b.x);
    b.aim = angleLerp(b.aim, want + b.aimNoise, 0.3);
    b.aimNoise = lerp(b.aimNoise, rand(-0.05, 0.05), 0.08);

    const inRange = Math.abs(tgt.x - b.x) < 760;
    const aligned = Math.abs(angleDiff(b.aim, want)) < 0.17;
    if (inRange && aligned && b.fireCd <= 0 && b.reloading <= 0 && b.mags[b.weapon] > 0) {
      b.mags[b.weapon]--;
      fireWeapon(b, w2, b.aim, 1.9, 1);
    }
    /* 手雷：一群敌人扎堆时丢一颗 */
    if (b.grenadeCd <= 0 && countEnemiesNear(tgt.x, tgt.y - 20, 200) >= 3) {
      b.grenadeCd = 9;
      const ang = Math.atan2(-140, (tgt.x - b.x) * 0.55);
      spawnGrenade(b.x, b.y - b.h * 0.7, Math.cos(ang) * 620, Math.sin(ang) * 620, 70, 'ally');
      say('buddy', '吃颗手雷！');
      b.bubbleCd = 6;
    }
  } else if (Math.abs(b.vx) > 30) {
    b.aim = angleLerp(b.aim, b.vx > 0 ? 0 : Math.PI, 0.15);
  }

  b.anim += Math.abs(b.vx) * dt * 0.06;
  moveEntity(b, dt);

  /* 世界边界 */
  b.x = clamp(b.x, 24, world.w - 24);
}

/* ==================== 敌兵 AI ==================== */

function pickTarget(e) {
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

function enemyShoot(e, target, spread, count) {
  const wp = { speed: 900, dmg: e.dmg, color: '#ff8a5c', pellets: count || 1, spread: spread, rate: 1, sfx: 'small' };
  const ty = target.y - target.h * 0.55;
  const base = Math.atan2(ty - (e.y - e.h * 0.6), target.x - e.x);
  for (let i = 0; i < wp.pellets; i++) {
    const ang = base + rand(-spread, spread);
    spawnBullet(e.x + Math.cos(ang) * 26, e.y - e.h * 0.6 + Math.sin(ang) * 26,
      Math.cos(ang) * wp.speed, Math.sin(ang) * wp.speed, wp.dmg, 'enemy', wp.color, 3);
  }
  e.muzzle = 0.06;
  beep(rand(150, 190), 0.05, 'square', 0.018, 80);
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

  if (e.spawnGuard > 0) {
    e.spawnGuard -= dt;
    e.vx = lerp(e.vx, 0, 0.2);
    e.anim += dt;
    moveEntity(e, dt);
    return;
  }

  const target = pickTarget(e);
  if (!target) { e.vx = lerp(e.vx, 0, 0.2); moveEntity(e, dt); return; }

  const dx = target.x - e.x;
  const adx = Math.abs(dx);
  const dir = Math.sign(dx) || 1;
  const t = ENEMY_TYPES[e.type];

  /* 朝向目标 */
  e.aim = angleLerp(e.aim,
    Math.atan2((target.y - target.h * 0.55) - (e.y - e.h * 0.6), dx), 0.14);

  if (t.melee) {
    /* 冲锋兵：贴脸近战 */
    e.vx = dir * e.speed;
    if (adx < 46 && Math.abs(target.y - e.y) < 70 && e.meleeCd <= 0) {
      e.meleeCd = 0.95;
      damageFriendly(target, e.dmg);
      target.vx += dir * 260;
      spawnParticles(target.x, target.y - 30, 10, '#ff5a4a', 240, 0.4, 4, 600);
    }
  } else if (e.boss) {
    /* BOSS：保持中距离，扇形扫射，定期召唤小兵 */
    if (adx > t.keep) e.vx = dir * e.speed;
    else if (adx < t.keep * 0.6) e.vx = -dir * e.speed * 0.9;
    else e.vx = lerp(e.vx, 0, 0.1);

    if (e.fireCd <= 0) {
      e.fireCd = t.fireRate;
      enemyShoot(e, target, 0.11, 5);
      sfxShotBig();
    }
    if (e.minionCd <= 0 && enemies.length < 14) {
      e.minionCd = 8;
      spawnEnemyAt('grunt', e.x - 70, game.stage);
      spawnEnemyAt('grunt', e.x + 70, game.stage);
      spawnText(e.x, e.y - e.h - 20, '增援！', '#ff9a6a');
    }
  } else if (t.burst) {
    /* 重机枪兵：点射 */
    if (adx > t.range * 0.9) e.vx = dir * e.speed;
    else if (adx < t.keep * 0.7) e.vx = -dir * e.speed;
    else { e.vx = lerp(e.vx, 0, 0.12); }

    if (e.burstLeft > 0) {
      if (e.burstCd <= 0) {
        e.burstLeft--;
        e.burstCd = 0.1;
        enemyShoot(e, target, 0.05, 1);
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
      e.fireCd = t.fireRate * rand(0.85, 1.2);
      enemyShoot(e, target, 0.085, 1);
    }
  }

  e.anim += Math.abs(e.vx) * dt * 0.055;
  moveEntity(e, dt);
  e.x = clamp(e.x, 20, world.w - 20);
}
