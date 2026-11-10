'use strict';

/* ==================================================================
   渲染层 2：敌兵 / 子弹 / 手雷 / 掉落 / 粒子
   ================================================================== */

/* 敌兵统一按「56 高的人形」绘制，再按实际碰撞盒缩放，
   这样不同体型的敌兵与自己的受击范围完全对齐。 */
function drawEnemy(e) {
  if (e.dead) return;
  /* 外观分派：小克走 chars.js 的瓷装甲 painter（自带落影/地面余晖/受击闪），
     普通敌兵与另外两个 BOSS 的绘制完全不受影响 */
  if (e.look === 'xiaoke') { drawXiaoke(e); return; }
  const h = e.h, w = e.w, sx = e.x - camera.x;
  if (sx < -170 || sx > W + 170) return;

  const t = ENEMY_TYPES[e.type];
  const melee = !!t.melee;
  const boss = !!e.boss;
  const facing = Math.cos(e.aim) >= 0 ? 1 : -1;

  /* 落影 */
  const under = surfaceBelow(e.x, e.y);
  const gap = clamp((under - e.y) / 190, 0, 1);
  const sk = 1 - gap * 0.68;
  ctx.fillStyle = 'rgba(0,0,0,' + (0.4 * sk).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx, under + 1, (w * 0.5 + 28 * proneK(e)) * sk, 4.4 * sk, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(sx, e.y);
  /* 动觉：起伏 + 起步倾角，和玩家 / 大肥鱼 / 干员读的是同一份姿态
     （util.js 的动作层）。放在 scale 之前 —— bob 是屏幕像素，放进缩放里
     会让 96 高的 BOSS 起伏比 56 高的杂兵大一倍，两个人就不是一个节奏了。
     倾角绕脚底转，也是在这个尚未缩放的坐标系里才对。 */
  const mo = motionOf(e);
  if (mo.lean) ctx.rotate(mo.lean);
  if (mo.bob) ctx.translate(0, -mo.bob);
  /* 用「站立身高」缩放而不是当前碰撞盒，蹲下才不会整体被压扁 */
  ctx.scale(w / 30, (e.baseH || h) / 56);

  if (e.spawnGuard > 0) {
    ctx.globalAlpha = 0.28 + Math.abs(Math.sin(e.spawnGuard * 26)) * 0.5;
  }

  const body = e.color, dark = e.dark;
  const bodyMid = tone(body, 0.82);
  const gear = '#2a1d1d';
  const bootCol = '#15171a';

  const moving = e.onGround && Math.abs(e.vx) > 26;
  const ph = e.anim;
  /* ---- 姿态：蹲 / 趴 ----
     蹲下：胯、肩、头一起下沉，膝盖弯曲把脚留在地面。
     趴下：绕脚底整体放平（角度和玩家/大肥鱼共用 PRONE_FLAT，不再各自解），
     再整体抬 PRONE_LIFT，让胸口贴地。
     这里量的是「本地 56 体格」，外层 scale 会再乘一次 —— 所以 shift 和
     lift 都不能预先除掉 yScale：除掉了，96 高的 BOSS 躺下去就只抬了
     杂兵那么高，胸腹整个陷进地里（实测差 4px）。
     抬升量本来就该按体型走，和 shift 一个道理。 */
  const cq = cqEff(e);
  const pr = proneK(e);
  const limbVisH = 56;                          /* 本地坐标下的站立身高 */
  const ang = pr * PRONE_FLAT;
  const shift = 0.46 * limbVisH * Math.sin(ang);
  const lift = pr * limbVisH * PRONE_LIFT;
  const lower = 14 * cq;
  const hipY = -33 + lower;
  const shY = -45 + lower;
  const lying = pr > 0.002;
  const bodyRot = () => {
    ctx.translate(-facing * shift, -lift);
    ctx.rotate(facing * ang);
  };

  let swA, knA, swB, knB;
  if (!e.onGround) {
    swA = 0.4; knA = 0.86; swB = -0.36; knB = 0.24;
  } else if (moving) {
    swA = Math.sin(ph) * 0.5;
    swB = Math.sin(ph + Math.PI) * 0.5;
    knA = Math.max(0, Math.sin(ph + 2.1)) * 0.58;
    knB = Math.max(0, Math.sin(ph + Math.PI + 2.1)) * 0.58;
  } else {
    swA = -0.05; knA = 0.1; swB = 0.07; knB = 0.1;
  }
  /* 趴着往前挪的时候腿还在摆 —— 但躺着摆腿的幅度必须收掉，
     否则膝盖会一脚踩进地面（实测 BOSS 匍匐比趴下低 10px）。
     留 25% 是「拖着腿爬」的那点意思，全收掉就成一具被拖走的尸体了。 */
  if (lying) {
    const k = 1 - 0.85 * pr;
    swA *= k; swB *= k; knA *= k; knB *= k;
  }
  /* 蹲下的脚目标：站立时脚踝在 -6（大腿 13 + 小腿 15，胯在 -33，
     鞋底正好压在地面 0 上），所以 IK 的目标也得是 -6 ——
     写 0.4 等于把鞋往下多按 6.4px，「蹲下」就变成「踩进地里」。 */
  const FOOT_Y = -6;
  if (cq > 0.02) {
    /* 和玩家同一套两段腿反解：脚钉地面，膝盖自然往前顶 */
    const fF = legIK(2.8 * facing, hipY, 2.8 * facing + 8.5 * facing, FOOT_Y);
    const fB = legIK(-2.6 * facing, hipY, -2.6 * facing - 7 * facing, FOOT_Y);
    swA = lerp(swA, fF.swing, cq); knA = lerp(knA, fF.knee, cq);
    swB = lerp(swB, fB.swing, cq); knB = lerp(knB, fB.knee, cq);
  }

  /* 身体整体进一个变换：趴下时绕脚底倒下，站着时什么都不做 */
  ctx.save();
  if (lying) bodyRot();

  /* 后腿 / 前腿 */
  drawLeg(-2.6 * facing, hipY, swB, knB, 8.2, tone(dark, 0.82), '#121417', gear);
  drawLeg(2.8 * facing, hipY, swA, knA, 8.8, dark, bootCol, tone(dark, 1.25));

  /* 躯干 */
  ctx.fillStyle = body;
  roundRect(-8.5, shY - 1, 17, 15, 4);
  ctx.fill();
  /* 胸甲板 */
  ctx.fillStyle = bodyMid;
  roundRect(-7, shY + 1, 14, 10, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-7, shY + 6); ctx.lineTo(7, shY + 6);
  ctx.stroke();
  /* 腰带 */
  ctx.fillStyle = gear;
  ctx.fillRect(-8.5, shY + 11.6, 17, 3);
  /* 前缘暖光 */
  ctx.fillStyle = 'rgba(255,190,130,0.10)';
  ctx.fillRect(facing > 0 ? 6.8 : -8.6, shY, 1.7, 12);

  if (melee) {
    /* 冲锋兵：露肩皮甲 + 头巾 */
    ctx.fillStyle = tone(dark, 0.95);
    roundRect(-9.5, shY - 1.5, 7, 9, 3);
    ctx.fill();
    roundRect(2.5, shY - 1.5, 7, 9, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(-4, shY + 2, 2, 8);
  } else {
    /* 肩甲 */
    ctx.fillStyle = tone(dark, 1.1);
    ctx.beginPath();
    ctx.arc(facing * 6, shY + 1.6, boss ? 5.4 : 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (boss) {
    /* 队长：胸甲铆钉 + 警示红条 */
    ctx.fillStyle = '#3a1210';
    roundRect(-8, shY + 2.5, 16, 5.5, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,90,60,0.85)';
    ctx.fillRect(-5.5, shY + 4, 11, 2.4);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(255,190,150,0.35)';
      ctx.fillRect(-7 + i * 3.4, shY + 1.4, 1.6, 1.6);
    }
    /* 肩刺：趴下时对折收起来。
       这两根刺是 ±15.5 横向甩出去的，人一躺平，横向就变成竖向 ——
       朝下那根会直接戳穿地面线，露在地面以下（画在背景之上，看着像穿帮）。
       按 pr 把横向长度减半，躺下去就只剩一小截，读起来还是「肩甲有刺」。 */
    const spk = 1 - 0.5 * pr;
    ctx.fillStyle = '#c8d2db';
    ctx.beginPath();
    ctx.moveTo(-11 * spk, shY - 1);
    ctx.lineTo(-15.5 * spk, shY - 1 - 6 * spk);
    ctx.lineTo(-9 * spk, shY - 1 - 3 * spk);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11 * spk, shY - 1);
    ctx.lineTo(15.5 * spk, shY - 1 - 6 * spk);
    ctx.lineTo(9 * spk, shY - 1 - 3 * spk);
    ctx.closePath();
    ctx.fill();
  }

  /* 头 */
  const headY = -52 + lower;
  ctx.fillStyle = '#d9b48a';
  ctx.beginPath();
  ctx.arc(0, headY, 6.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.arc(0, headY + 1.2, 6.2, 0.2, Math.PI - 0.2);
  ctx.fill();

  if (melee) {
    /* 红头巾 */
    ctx.fillStyle = tone(body, 0.9);
    ctx.beginPath();
    ctx.arc(0, headY - 0.6, 7.4, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
    ctx.fillRect(-7.4, headY - 1.6, 14.8, 2.8);
    ctx.beginPath();
    ctx.moveTo(-facing * 6, headY - 1);
    ctx.lineTo(-facing * 12, headY + 2.5);
    ctx.lineTo(-facing * 6, headY + 2);
    ctx.closePath();
    ctx.fill();
  } else {
    /* 头盔 */
    ctx.fillStyle = tone(dark, 1.05);
    ctx.beginPath();
    ctx.arc(0, headY - 1, 8.2, Math.PI * 0.99, Math.PI * 2.01);
    ctx.fill();
    ctx.fillRect(-8.2, headY - 1.8, 16.4, 3);
    ctx.fillStyle = tone(dark, 0.86);
    roundRect(facing > 0 ? 1.5 : -10, headY - 3.2, 8.5, 2.3, 1);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.arc(-2.2, headY - 3.6, 5, Math.PI * 1.06, Math.PI * 1.6);
    ctx.fill();
  }

  /*  глаз（红色光点） */
  const ex = facing * 3.4;
  ctx.fillStyle = boss ? 'rgba(255,70,40,1)' : 'rgba(255,90,70,0.92)';
  ctx.beginPath();
  ctx.arc(ex, headY - 0.6, boss ? 2 : 1.5, 0, Math.PI * 2);
  ctx.fill();
  if (boss) {
    ctx.fillStyle = 'rgba(255,60,30,0.25)';
    ctx.beginPath();
    ctx.arc(ex, headY - 0.6, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 身体画完，退出身体变换 */
  ctx.restore();

  /* ---- 武器 ----
     枪不跟着身体一起转：趴下时枪是架平的，只是挂点换成了「转过之后
     的肩」。所以这里手动把肩点解出来，再按 aim 单独摆枪 ——
     直接套用身体旋转的话，枪会跟着戳进地里。 */
  ctx.save();
  if (lying) {
    const th = facing * ang;
    const gy = shY + 2.5;
    ctx.translate(-facing * shift - gy * Math.sin(th), gy * Math.cos(th) - lift);
  } else {
    ctx.translate(0, shY + 2.5);
  }
  const meleeSwing = melee ? Math.sin(game.time * 12) * 0.22 : 0;
  ctx.rotate(e.aim + meleeSwing);
  if (facing < 0) ctx.scale(1, -1);

  const kick = Math.min(1, (e.muzzle || 0) * 12);
  ctx.translate(-kick * 1.4, 0);

  if (melee) {
    /* 砍刀 */
    ctx.fillStyle = '#2a2018';
    roundRect(-3, -1.6, 8, 4.5, 1.5);
    ctx.fill();
    const bg = ctx.createLinearGradient(5, -4, 24, 3);
    bg.addColorStop(0, '#e6eef5');
    bg.addColorStop(0.5, '#a9b6c2');
    bg.addColorStop(1, '#7c8792');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(5, -3.4);
    ctx.lineTo(22, -4.6);
    ctx.lineTo(25, -0.4);
    ctx.lineTo(6, 2.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(6, -2.6, 15, 1);
    seg(0, 1.5, 4, 1.2, 6, tone(body, 0.7));
  } else if (e.type === 'gunner' || boss) {
    /* 重机枪 / 链式机炮 */
    const gunLen = boss ? 34 : 27;
    ctx.fillStyle = '#1d2329';
    roundRect(-6, -4, 14, 9, 2.5);
    ctx.fill();
    ctx.fillStyle = '#2b333a';
    roundRect(6, -3, gunLen, 6.5, 2);
    ctx.fill();
    /* 弹鼓 */
    ctx.fillStyle = '#232a31';
    ctx.beginPath();
    ctx.arc(2, 6, boss ? 6.5 : 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d454e';
    ctx.beginPath();
    ctx.arc(2, 6, boss ? 3.4 : 2.6, 0, Math.PI * 2);
    ctx.fill();
    /* 旋转枪管 */
    const spin = game.time * 9;
    for (let i = 0; i < 3; i++) {
      const oy = Math.sin(spin + i * 2.09) * 2.6;
      ctx.fillStyle = i === 0 ? '#59646f' : '#39424b';
      ctx.fillRect(6, -1.4 + oy, gunLen - 2, 2.2);
    }
    ctx.fillStyle = '#1a2026';
    ctx.fillRect(6 + gunLen - 2, -3, 4, 6);
    /* 前手 */
    seg(1, -2, 16, 2.6, 6.5, tone(body, 0.9));
  } else {
    /* 步兵步枪 */
    ctx.fillStyle = '#20262c';
    roundRect(-8, 0.4, 10, 6, 2);
    ctx.fill();
    ctx.fillStyle = '#2c343b';
    roundRect(-1, -2.2, 18, 6.6, 2);
    ctx.fill();
    ctx.fillStyle = '#3d454e';
    ctx.fillRect(2, -4, 11, 1.8);
    ctx.fillStyle = '#262d34';
    ctx.beginPath();
    ctx.moveTo(6, 4.2);
    ctx.lineTo(13, 4.2);
    ctx.lineTo(14.6, 12);
    ctx.lineTo(8, 12.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#39424b';
    ctx.fillRect(15, -1.2, 12, 3);
    ctx.fillStyle = '#1a2026';
    ctx.fillRect(26, -1.8, 4, 4.2);
    seg(1, -1.8, 14, 3, 6.2, tone(body, 0.92));
  }

  /* 枪口焰 */
  if ((e.muzzle || 0) > 0) {
    const mx = melee ? 26 : (boss ? 40 : (e.type === 'gunner' ? 32 : 31));
    const rad = boss ? 30 : 22;
    if (scGlowWarm) {
      /* 预烘光球，不再逐帧建径向渐变 */
      ctx.drawImage(scGlowWarm, mx - rad, -rad, rad * 2, rad * 2);
    } else {
      const mg = ctx.createRadialGradient(mx, 0, 1, mx, 0, rad);
      mg.addColorStop(0, 'rgba(255,246,200,0.95)');
      mg.addColorStop(0.4, 'rgba(255,170,60,0.55)');
      mg.addColorStop(1, 'rgba(255,110,0,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(mx, 0, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,240,190,0.85)';
    ctx.beginPath();
    ctx.moveTo(mx - 1, 0);
    ctx.lineTo(mx + 8, -3);
    ctx.lineTo(mx + 5, 0);
    ctx.lineTo(mx + 8, 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* ---- 降落伞：空降时头顶张开，落地后收起 ---- */
  const cv = e.chuteVis || 0;
  if (cv > 0.02) {
    const open = Math.min(1, cv * 1.4);
    const bob = Math.sin(game.time * 3.1 + e.x * 0.02) * 1.6;
    const cy = headY - 34 - 16 * open + bob;
    const cw = 40 * open, chh = 17 * open;

    /* 伞绳 */
    ctx.strokeStyle = 'rgba(226,234,240,' + (0.55 * cv).toFixed(2) + ')';
    ctx.lineWidth = 0.9;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cw * 0.42, cy + chh * 0.5);
      ctx.lineTo(-facing * 4 + i * 1.6, headY - 2);
      ctx.stroke();
    }
    /* 伞布：两色分片 */
    for (let i = 0; i < 5; i++) {
      const a0 = Math.PI + (i / 5) * Math.PI;
      const a1 = Math.PI + ((i + 1) / 5) * Math.PI;
      ctx.fillStyle = i % 2 ? 'rgba(206,222,236,0.95)' : 'rgba(120,150,170,0.95)';
      ctx.beginPath();
      ctx.moveTo(0, cy + chh * 0.55);
      ctx.arc(0, cy + chh * 0.5, cw, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    /* 伞沿高光 */
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 * cv).toFixed(2) + ')';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, cy + chh * 0.5, cw, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  /* 受击红闪：跟着身体一起倒，不然趴下的人会顶着一个竖着的光块 */
  if (e.flash > 0) {
    ctx.save();
    if (lying) bodyRot();
    ctx.globalAlpha = Math.min(0.36, e.flash * 2.2);
    ctx.fillStyle = '#ff6a4a';
    roundRect(-9.5, -60, 19, 60, 6);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  /* 换弹提示：打空后头顶转圈，这是反打窗口的视觉信号 */
  if (e.reloadT > 0) {
    const tm = ENEMY_TYPES[e.type] || {};
    const rp = 1 - clamp(e.reloadT / (tm.reload || 2), 0, 1);
    const ry = e.y - e.h - 19;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(sx, ry, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,198,112,0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(sx, ry, 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rp);
    ctx.stroke();
  }

  /* 血条与 Boss 名牌：BOSS 的血条交给屏幕顶部的大血条，
     这里只留名牌，避免同一条血上下画两遍。 */
  if (e.hp < e.maxHp && !boss) {
    const bw = 40;
    const by = e.y - h - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(sx - bw / 2 - 1, by - 1, bw + 2, 6, 3);
    ctx.fill();
    const ratio = clamp(e.hp / e.maxHp, 0, 1);
    const hg = ctx.createLinearGradient(sx - bw / 2, 0, sx + bw / 2, 0);
    hg.addColorStop(0, '#ff9066');
    hg.addColorStop(1, '#c95a3a');
    ctx.fillStyle = hg;
    roundRect(sx - bw / 2, by, bw * ratio, 4, 2);
    ctx.fill();
  }
  if (boss) {
    const name = e.name || '重装单位';
    const tint = e.accent === 'fire' ? '#ffb066'
      : e.accent === 'steel' ? '#9fd8ff'
        : '#ff8a7a';
    ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(name, sx + 1, e.y - h - 22);
    ctx.fillStyle = tint;
    ctx.fillText(name, sx, e.y - h - 23);
  }
}

/* ---------------- 尸体 ----------------
   死掉的人不是「啪」一下消失的：膝盖先撑不住往下沉，上身再歪出去，
   落到地上还有一下余震，然后躺一会儿慢慢化掉，血留下来。
   全部由 c.t 一个计时器推 —— 物理层只管位置，动画都在这里。 */
function drawCorpses() {
  for (const c of corpses) {
    const sx = c.x - camera.x;
    if (sx < -150 || sx > W + 150) continue;

    const sc = (c.h || 56) / 56;

    /* 血泊：倒下之后慢慢洇开 */
    const bleed = clamp(c.t / 1.8, 0, 1);
    const bw = 20 * sc * (0.55 + bleed * 0.75);
    ctx.fillStyle = 'rgba(92,18,18,' + (0.40 * bleed).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(sx + c.dir * 6 * sc, c.y + 1.5, bw, 5.4 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(52,10,10,' + (0.26 * bleed).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(sx + c.dir * 2 * sc, c.y + 2, bw * 0.55, 2.8 * sc, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 软倒曲线：0.20s 跪下去 → 0.55s 歪倒 → 之后余震躺稳 */
    /* 和「倒地待救」共用同一条曲线（util.js 的 actDeathCurve），
       只是尸体比活人多倒 6 度、多沉 2.5px —— 活人还要撑起来，
       尸体是整个塌下去的。差别用参数表达，结构不再抄第二遍。 */
    const cv = actDeathCurve(c.t, {
      t1: 0.20, t2: 0.55, soft: 0.16, fold: 1.30,
      sink1: 10, sink2: 2.5, sinkEnd: 12.5, tuckEnd: 0.55
    });
    const ang = cv.ang, sink = cv.sink, tuck = cv.tuck;

    /* 最后 1.2 秒淡出。血泊留在原地 —— 尸体没了，战斗痕迹还在 */
    const fade = clamp(c.life / 1.2, 0, 1);

    /* 大肥鱼有自己的尸体画法：头发铺开、尾巴耷拉、头饰歪掉 */
    if (c.look === 'whale') { drawWhaleCorpse(c, ang, sink, fade); continue; }

    /* 有立绘的干员：站姿立绘绕脚底转 87° 读成躺平 —— 和大肥鱼同一条尸体曲线
       （actDeathCurve），只是换一张图。画不出来才落到下面的矢量尸体。 */
    if (castCfg(c.look) && drawCastCorpse(c, ang, sink, fade)) continue;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(sx, c.y);
    ctx.scale(sc, sc);
    ctx.translate(0, -sink * 0.10);
    ctx.rotate(c.dir * ang);

    const body = c.color, dark = c.dark;
    const hipY = -26, shY = -45;

    /* 腿：一条蜷、一条拖着 —— 人倒下时腿不会并得整整齐齐 */
    ctx.strokeStyle = dark;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, hipY);
    ctx.lineTo(-7 - 5 * tuck, hipY + 13 - 6 * tuck);
    ctx.lineTo(-1, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, hipY);
    ctx.lineTo(9 + 3 * tuck, hipY + 11 - 3 * tuck);
    ctx.lineTo(16, -2);
    ctx.stroke();

    /* 全靴 */
    ctx.fillStyle = '#15171a';
    roundRect(-6, -4, 11, 5, 2); ctx.fill();
    roundRect(12, -6, 11, 5, 2); ctx.fill();

    /* 躯干 */
    ctx.fillStyle = body;
    roundRect(-9, shY, 18, 22, 5);
    ctx.fill();
    /* 背心 */
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    roundRect(-6, shY + 3, 12, 11, 3);
    ctx.fill();
    /* 腰带 */
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(-9, hipY - 5, 18, 5);

    /* 手臂：软下去之后摊在地上，一只还搭在身上 */
    ctx.strokeStyle = body;
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(-2, shY + 3);
    ctx.lineTo(-13 - 3 * tuck, shY + 10 + 7 * tuck);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, shY + 3);
    ctx.lineTo(12, shY + 8 + 5 * tuck);
    ctx.lineTo(15, shY + 15);
    ctx.stroke();

    /* 头：脖子是软的，脑袋比肩膀多歪一截 */
    ctx.save();
    ctx.translate(0, shY - 2);
    ctx.rotate(c.dir * 0.30 * clamp(c.t / 0.55, 0, 1));
    ctx.fillStyle = '#d9b48a';
    ctx.beginPath();
    ctx.arc(0, -6, 6.8, 0, Math.PI * 2);
    ctx.fill();
    /* 头盔歪在一边 */
    ctx.fillStyle = tone(dark, 1.05);
    ctx.beginPath();
    ctx.arc(0, -6.8, 8.2, Math.PI * 0.98, Math.PI * 2.02);
    ctx.fill();
    ctx.fillRect(-8.2, -7.8, 16.4, 3);
    /* 闭上的眼（一道横线，比亮着的红点更像「没了」） */
    ctx.strokeStyle = 'rgba(70,40,34,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-3.6, -4.4); ctx.lineTo(-1.2, -4.4);
    ctx.moveTo(1.2, -4.4); ctx.lineTo(3.6, -4.4);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}


/* ---------------- 子弹（曳光 + 光晕） ---------------- */
function drawBullets() {
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bullets) {
    const x = b.x - camera.x;
    const px = b.px - camera.x;
    if (x < -60 || x > W + 60) continue;

    /* 视觉半宽 w 与判定半径 r 是分开的：把线改细不会让子弹变弱。
       飞得越远，弹道越淡 —— 这是「距离」最直观的一条线索。
       淡出参考点按「这把枪自己的射程」取一半：霰弹 400px 就开始虚，
       狙击要飞出 2600px 才看得见衰减 —— 玩家不看数值也知道谁打得远。 */
    const w = b.w || b.r;
    const visRef = b.range > 0 ? b.range * 0.5 : 1100;
    const far = clamp((b.dist || 0) / visRef, 0, 1);
    const fade = 1 - far * 0.45;

    /* 拖尾：不再逐颗建渐变 —— 预烘一张「透明 → 亮」的长条，
       旋转后按「上一帧位置 → 当前位置」拉伸贴上，天然就是一段短拖尾。
       一颗子弹每帧省掉 1 条 createLinearGradient。 */
    const timg = b.tracer ? scTrailCool : scTrailWarm;
    const dx = x - px, dy = b.y - b.py;
    const seg = Math.sqrt(dx * dx + dy * dy);
    if (timg && seg > 0.6) {
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(px, b.py);
      ctx.rotate(Math.atan2(dy, dx));
      const th = Math.max(2.0, w * 3.4);
      ctx.drawImage(timg, 0, -th * 0.5, seg, th);
      ctx.restore();
    } else if (!timg) {
      /* 无离屏画布（无头环境）退回单色描边，几何关系与上面完全一致 */
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = fade;
      ctx.lineWidth = Math.max(0.8, w * 1.6);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, b.py);
      ctx.lineTo(x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 狙击曳光：速度 2700，单帧只走 45px，光靠上面的短拖尾只剩「一个亮点」。
       沿飞行方向往回补一条渐隐光带，才读得出「一道光穿过去」。 */
    if (b.tracer) {
      const L = b.tracerLen || 300;
      const a = Math.atan2(b.vy, b.vx);
      const tx = x - Math.cos(a) * L;
      const ty = b.y - Math.sin(a) * L;
      if (scTrailCool) {
        /* 冷白长条：亮端贴在弹头，往后方化开 */
        ctx.save();
        ctx.globalAlpha = 0.88 * fade;
        ctx.translate(tx, ty);
        ctx.rotate(a);
        ctx.drawImage(scTrailCool, 0, -Math.max(1.6, w * 2.4), L, Math.max(3.2, w * 4.8));
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(186,222,255,0.55)';
        ctx.lineWidth = Math.max(0.9, w * 1.75);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, b.y);
        ctx.stroke();
      }
      /* 白色芯线，让弹道中心更锐 */
      ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx.lineWidth = Math.max(0.6, w * 0.5);
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * L * 0.55, b.y - Math.sin(a) * L * 0.55);
      ctx.lineTo(x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* 火箭尾焰：速度只有 660，飞得慢，尾焰要「连成一片」才像推进器。
       间距按弹体半径取，保证每个圆和上一个重叠；外面再罩一层锥形柔光。 */
    if (b.rocket) {
      const a = Math.atan2(b.vy, b.vx);
      const cx = Math.cos(a), sy = Math.sin(a);
      const len = b.r * 7.4;

      /* 锥形柔光：同一张暖光长条往回贴，亮端在弹体、尾端化开 */
      if (scTrailWarm) {
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.translate(x, b.y);
        ctx.rotate(a);
        ctx.drawImage(scTrailWarm, -len, -b.r * 2.9, len, b.r * 5.8);
        ctx.restore();
      }

      /* 焰芯：重叠的圆，越远越小越暗 */
      for (let k = 1; k <= 7; k++) {
        const d = k * b.r * 1.05;
        const fx = x - cx * d, fy = b.y - sy * d;
        const t = k / 8;
        const al = 0.62 * (1 - t);
        ctx.fillStyle = k <= 3
          ? 'rgba(255,244,200,' + (al * 1.4).toFixed(3) + ')'
          : (k <= 5 ? 'rgba(255,168,72,' + al.toFixed(3) + ')'
                    : 'rgba(150,120,96,' + (al * 0.75).toFixed(3) + ')');
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(0.8, b.r * (1 - t * 0.85)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* 弹头光点：光晕跟着「视觉粗细」走，但留一个下限，
       否则细子弹在混战里根本找不着弹道从哪来。
       辉光同样吃距离衰减 —— 远去的弹道只剩一条细线，才拉得出纵深。 */
    const glowR = Math.max(15, w * 7.4) * (0.74 + 0.26 * fade);
    const gimg = b.tracer ? scGlowCool : scGlowWarm;
    if (gimg) {
      ctx.globalAlpha = fade;
      ctx.drawImage(gimg, x - glowR, b.y - glowR, glowR * 2, glowR * 2);
      ctx.globalAlpha = 1;
    } else {
      const glow = ctx.createRadialGradient(x, b.y, 0, x, b.y, glowR);
      if (b.tracer) {
        glow.addColorStop(0, 'rgba(255,255,255,0.98)');
        glow.addColorStop(0.28, 'rgba(196,232,255,0.5)');
        glow.addColorStop(1, 'rgba(120,180,255,0)');
      } else {
        glow.addColorStop(0, 'rgba(255,248,214,0.95)');
        glow.addColorStop(0.32, 'rgba(255,196,110,0.3)');
        glow.addColorStop(1, 'rgba(255,140,40,0)');
      }
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, b.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 实心弹头：一个不到 2px 的亮点，让「一颗子弹」有确定的位置 */
    if (!b.rocket) {
      ctx.fillStyle = b.tracer ? 'rgba(240,250,255,0.95)' : 'rgba(255,246,214,0.92)';
      ctx.beginPath();
      ctx.arc(x, b.y, Math.max(0.9, w * 0.85), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------- 手雷 ---------------- */
function drawGrenades() {
  for (const g of grenades) {
    const x = g.x - camera.x;
    const under = surfaceBelow(g.x, g.y);
    const gap = clamp((under - g.y) / 160, 0, 1);

    ctx.fillStyle = 'rgba(0,0,0,' + (0.34 * (1 - gap * 0.6)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(x, under + 1, 5.5 * (1 - gap * 0.5), 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, g.y);
    ctx.rotate(g.spin);
    /* 弹体 */
    const gg = ctx.createLinearGradient(-5, -6, 5, 6);
    gg.addColorStop(0, '#4e6e46');
    gg.addColorStop(1, '#2c3f28');
    ctx.fillStyle = gg;
    roundRect(-5, -6.5, 10, 13, 4.5);
    ctx.fill();
    /* 刻纹 */
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4, -2); ctx.lineTo(4, -2);
    ctx.moveTo(-4, 1.5); ctx.lineTo(4, 1.5);
    ctx.stroke();
    /* 保险握片 */
    ctx.fillStyle = '#8d949b';
    roundRect(-1.6, -9.5, 3.2, 4, 1);
    ctx.fill();
    ctx.restore();

    /* 引信闪烁 */
    const blink = 0.45 + Math.sin(game.time * 26) * 0.4;
    const fg = ctx.createRadialGradient(x, g.y - 7, 0, x, g.y - 7, 12);
    fg.addColorStop(0, 'rgba(255,90,50,' + blink.toFixed(2) + ')');
    fg.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(x, g.y - 7, 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------------- 燃烧地带（纵火者的燃烧瓶） ---------------- */
function drawFire() {
  for (const f of fires) {
    const x = f.x - camera.x;
    if (x < -180 || x > W + 180) continue;
    const rate = clamp(f.life / f.max, 0, 1);
    /* 快烧完时整块变矮变暗，玩家扫一眼就知道这片火要熄了 */
    const hh = 52 * (0.45 + rate * 0.55);
    const y = f.y;

    /* 焦土：一层压在地面的黑斑，让火焰有「烧过」的落点。
       单位渐变烘一次、每堆火只做 scale —— 火再多也只有一张渐变。 */
    const cg = scGrad('charred', () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(18,10,6,0.62)');
      g.addColorStop(0.7, 'rgba(26,14,8,0.34)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      return g;
    });
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f.r, f.r * 0.34);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 火墙：加色混合，一排高低不一的火舌随时间抖动 */
    ctx.globalCompositeOperation = 'lighter';
    if (scGlowWarm) {
      const gw = f.r * 1.9, gh2 = hh * 1.6;
      ctx.globalAlpha = 0.34 * rate;
      ctx.save();
      ctx.translate(x, y - hh * 0.3);
      ctx.scale(1, gh2 / gw);
      ctx.drawImage(scGlowWarm, -gw * 0.5, -gw * 0.5, gw, gw);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      const glow = ctx.createRadialGradient(x, y - hh * 0.35, 4, x, y - hh * 0.35, f.r * 0.95);
      glow.addColorStop(0, 'rgba(255,150,50,' + (0.30 * rate).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(x, y - hh * 0.3, f.r * 0.95, hh * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const tongues = 7;
    if (scFlame) {
      /* 火舌用预烘火苗精灵：7 片贴图，替掉 7 条线性渐变 */
      for (let i = 0; i < tongues; i++) {
        const fx = x + (i / (tongues - 1) - 0.5) * f.r * 1.6;
        const wob = Math.sin(game.time * 9 + f.seed + i * 1.7);
        const fh = hh * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(game.time * 7.3 + i * 2.1 + f.seed)));
        const fw = 11 + 5 * wob;
        ctx.globalAlpha = rate * (0.62 + 0.18 * wob);
        ctx.drawImage(scFlame, fx - fw + wob * 2, y - fh, fw * 2, fh);
      }
      ctx.globalAlpha = 1;
    } else {
      for (let i = 0; i < tongues; i++) {
        const fx = x + (i / (tongues - 1) - 0.5) * f.r * 1.6;
        const wob = Math.sin(game.time * 9 + f.seed + i * 1.7);
        const fh = hh * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(game.time * 7.3 + i * 2.1 + f.seed)));
        const fw = 11 + 5 * wob;
        const tg = ctx.createLinearGradient(0, y, 0, y - fh);
        tg.addColorStop(0, 'rgba(255,120,30,' + (0.55 * rate).toFixed(3) + ')');
        tg.addColorStop(0.45, 'rgba(255,180,70,' + (0.42 * rate).toFixed(3) + ')');
        tg.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.moveTo(fx - fw / 2, y);
        ctx.quadraticCurveTo(fx - fw * 0.55, y - fh * 0.6, fx + wob * 3, y - fh);
        ctx.quadraticCurveTo(fx + fw * 0.55, y - fh * 0.6, fx + fw / 2, y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* ---------------- 掉落物 ---------------- */
function drawPickups() {
  for (const pk of pickups) {
    const x = pk.x - camera.x;
    if (x < -60 || x > W + 60) continue;
    const bob = Math.sin(pk.bob) * 3;
    const health = pk.type === 'health';
    const main = health ? '#5fd98a' : '#ffc857';

    /* 地面光斑 */
    const gy = surfaceBelow(pk.x, pk.y);
    const gg = ctx.createRadialGradient(x, gy, 1, x, gy, 26);
    gg.addColorStop(0, health ? 'rgba(90,240,160,0.30)' : 'rgba(255,200,90,0.30)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.ellipse(x, gy, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, pk.y + bob);

    /* 外发光 */
    ctx.shadowColor = health ? 'rgba(90,240,150,0.85)' : 'rgba(255,200,80,0.85)';
    ctx.shadowBlur = 16;

    /* 箱体 */
    ctx.shadowBlur = 0;

    ctx.fillStyle = health ? '#1e3d2c' : '#3d3018';
    roundRect(-11, -11, 22, 22, 5);
    ctx.fill();
    ctx.strokeStyle = main;
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 内衬高光 */
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(-9, -9, 18, 8, 4);
    ctx.fill();

    ctx.fillStyle = health ? '#8ff0b0' : '#ffd166';
    if (health) {
      ctx.fillRect(-6.5, -2, 13, 4);
      ctx.fillRect(-2, -6.5, 4, 13);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(-5.5, -1.2, 11, 1.2);
    } else {
      /* 子弹图标 */
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-6 + i * 4.4, -4, 2.6, 8);
        ctx.beginPath();
        ctx.moveTo(-6 + i * 4.4, -4);
        ctx.lineTo(-4.7 + i * 4.4, -7);
        ctx.lineTo(-3.4 + i * 4.4, -4);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/* ---------------- 枪口光照池 ----------------
   开火那几帧，枪口除了焰芯还该「照亮周围」：一小团加色光斑压在枪口上，
   再往脚下投一片更扁更淡的暖光。光球是预烘精灵，整段零渐变。
   位置直接由「脚底 + 肩高 + aim 方向 + 枪口长度」解出来，
   不重放 painter 的变换栈 —— 柔光边缘看不出几像素的误差。 */
function scMuzzleFor(en, isEnemy) {
  if (!en || en.dead || en.downed) return;
  const mu = en.muzzle || 0;
  if (mu <= 0) return;
  /* muzzle 从 0.06~0.08 线性掉回 0，拿剩余量当「短命」衰减 */
  const k = clamp(mu / 0.08, 0, 1);
  const s = en.x - camera.x;
  if (s < -220 || s > W + 220) return;

  const aim = en.aim || 0;
  /* 玩家侧（大肥鱼 / 主角 / 干员）直接用枪口唯一权威算出来的点 ——
     光斑就压在真正开火的那个枪口上。
     敌兵是另一套矢量枪，muzzlePoint 不认识，仍走下面那条按肩高估的近似线。 */
  const mpt = muzzlePoint(en);
  let gx, gyy;
  if (mpt) {
    gx = mpt.x - camera.x;
    gyy = mpt.y;
  } else {
    const boss = !!en.boss;
    const mx = isEnemy ? (boss ? 40 : (en.type === 'gunner' ? 32 : 31)) : 38;
    const sxk = isEnemy ? (en.w || 30) / 30 : 1;
    const syk = isEnemy ? ((en.baseH || en.h || 56) / 56) : 1;
    const shY = isEnemy ? (-45 + 14 * cqEff(en)) : (-46.5 + 17 * cqEff(en));
    gx = s + Math.cos(aim) * mx * sxk;
    gyy = en.y + (shY + 3) * syk + Math.sin(aim) * mx * syk;
  }

  const R = (en.boss ? 168 : 122) * (0.62 + 0.38 * k);
  ctx.globalAlpha = 0.32 * k;
  ctx.drawImage(scGlowWarm, gx - R * 0.5, gyy - R * 0.5, R, R);

  /* 地上那片暖光：只照脚边，离地越高越淡 */
  const under = surfaceBelow(en.x, en.y);
  const gap = clamp((under - en.y) / 300, 0, 1);
  if (gap < 0.92) {
    const gr = 150 + 70 * k;
    ctx.globalAlpha = 0.14 * k * (1 - gap);
    ctx.save();
    ctx.translate(s, under + 2);
    ctx.scale(1, 0.32);
    ctx.drawImage(scGlowWarm, -gr * 0.5, -gr * 0.5, gr, gr);
    ctx.restore();
  }
}

/* ---------------- 爆炸余辉 ----------------
   explode() 在 game.js 里，渲染层不能挂回调；这里用 WeakSet 认出「刚生成的火球」
   （无初速、寿命 0.3 秒、体积随爆炸半径走），在它脚下压一枚 1~2 秒的橙色地光。
   槽位预分配、环形复用，逐帧零 new。 */
const SC_EMBER_N = 10;
const scEmbers = [];
for (let i = 0; i < SC_EMBER_N; i++) {
  scEmbers.push({ on: false, x: 0, gy: 0, t0: 0, dur: 1, r: 40 });
}
let scEmberCur = 0;
const scEmberSeen = (typeof WeakSet === 'function') ? new WeakSet() : null;

function scEmberScan() {
  if (!scEmberSeen) return;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p.ball || p.smoke || p.ring) continue;
    if (p.max > 0.34 || p.size < 13 || p.vx !== 0 || p.vy !== 0) continue;
    if (scEmberSeen.has(p)) continue;
    scEmberSeen.add(p);
    const e = scEmbers[scEmberCur];
    scEmberCur = (scEmberCur + 1) % SC_EMBER_N;
    e.on = true;
    e.x = p.x;
    e.gy = surfaceBelow(p.x, p.y);
    e.t0 = game.time;
    e.dur = 1.05 + Math.min(0.8, p.size * 0.022);
    e.r = Math.max(44, p.size * 2.8);
  }
}

function scEmberDraw() {
  for (let i = 0; i < SC_EMBER_N; i++) {
    const e = scEmbers[i];
    if (!e.on) continue;
    const age = game.time - e.t0;
    if (age < 0 || age >= e.dur) { e.on = false; continue; }
    const s = e.x - camera.x;
    const R = e.r * (1 + age * 0.16);
    if (s < -R || s > W + R) continue;
    const k = 1 - age / e.dur;
    /* 余烬不是恒定的：低频抖动让地光读得出「还在烧」 */
    const fl = 0.76 + 0.24 * Math.sin(age * 9.3 + i * 2.1);
    ctx.globalAlpha = 0.26 * k * fl;
    ctx.save();
    ctx.translate(s, e.gy + 2);
    ctx.scale(1, 0.30);
    ctx.drawImage(scGlowWarm, -R, -R, R * 2, R * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawEffects() {
  /* 加色层先铺：地面余辉 → 枪口光池，之后才是火球与火花。
     它们都在世界坐标里、和角色同一层，所以光会「贴」在人和地上。 */
  if (scGlowWarm) {
    ctx.globalCompositeOperation = 'lighter';
    scEmberScan();
    scEmberDraw();
    scMuzzleFor(player, false);
    scMuzzleFor(buddy, false);
    for (let i = 0; i < enemies.length; i++) scMuzzleFor(enemies[i], true);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  for (const p of particles) {
    const a = clamp(p.life / p.max, 0, 1);
    const x = p.x - camera.x;
    ctx.globalAlpha = a;
    if (p.ring) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 * a;
      ctx.beginPath(); ctx.arc(x, p.y, p.size * (1.6 - a), 0, Math.PI * 2); ctx.stroke();
    } else if (p.ball && p.smoke) {
      /* 烟团：普通混合，越散越淡越大 */
      ctx.globalAlpha = a * 0.34;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, p.y, p.size * (2.1 - a * 0.8), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a;
    } else if (p.ball) {
      /* 火球：加色柔光，边缘必须透明，否则是个死板的圆。
         用预烘光球贴图，爆炸再多也不用逐颗建径向渐变。 */
      const r = p.size * (2.0 - a * 0.95) * 1.08;
      ctx.globalCompositeOperation = 'lighter';
      if (scGlowWarm) {
        ctx.globalAlpha = a * 0.92;
        ctx.drawImage(scGlowWarm, x - r, p.y - r, r * 2, r * 2);
      } else {
        const fg = ctx.createRadialGradient(x, p.y, 0, x, p.y, r);
        fg.addColorStop(0, 'rgba(255,252,232,0.95)');
        fg.addColorStop(0.30, 'rgba(255,206,110,0.78)');
        fg.addColorStop(0.62, 'rgba(255,132,40,0.34)');
        fg.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;

  for (const c of casings) {
    ctx.save();
    ctx.translate(c.x - camera.x, c.y);
    ctx.rotate(c.rot);
    ctx.globalAlpha = clamp(c.life, 0, 1);
    ctx.fillStyle = '#d8b25a';
    ctx.fillRect(-2.5, -1.2, 5, 2.4);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  for (const t of texts) {
    const x = t.x - camera.x;
    const size = t.size || 1;
    ctx.globalAlpha = clamp(t.life * 1.4, 0, 1);
    ctx.font = 'bold ' + Math.round(16 * size) + 'px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 + (size - 1) * 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(t.str, x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.str, x, t.y);
  }
  ctx.globalAlpha = 1;
}


/* ---------------- 准星 ---------------- */
/* 准星不是「固定多大的一个圈」，而是「按这把枪的角散布，打到这里时
   子弹可能落在一个多大的范围里」。角散布 × 距离 = 线散布，所以同一个
   圈会随距离自己长大 —— 这就是「瞄准圈随距离变长就变大」。
   同时在准星下方标一个落点：那是子弹真正会到的地方，因为弹道有下坠。 */
function drawCrosshair() {
  const x = input.mx, y = input.my;
  const p = player;
  if (!p) return;

  const wp = WEAPONS[p.weapon] || WEAPONS[0];

  /* 开火点与鼠标的世界距离 —— 散布是按这个距离换算成像素的 */
  const mw = mouseWorld();
  const ox = p.x + Math.cos(p.aim) * 30;
  const oy = p.y - p.h * 0.62 + Math.sin(p.aim) * 30;
  const dist = Math.hypot(mw.x - ox, mw.y - oy);

  /* 姿态修正：蹲下收、趴下更收（但爬行时收回一半，和 playerFire 里
     那条 proneGain 是同一个数）、瞄准镜再收、空中和跑动散，连射按 bloom 一圈圈张开 */
  const crawl = Math.min(1, Math.abs(p.vx) / 130);
  let mul = 1 - 0.55 * cqEff(p) - 0.82 * proneK(p) * (1 - 0.45 * crawl)
              - (p.ads && wp.scope ? 0.42 : 0);
  mul *= 1 + clamp(Math.abs(p.vx) / 560, 0, 0.55);
  if (!p.onGround) mul *= 1.4;
  mul *= 1 + (p.bloom || 0);

  let spread = Math.max(6, aimRadiusPx(wp, dist, mul) + (p.muzzle || 0) * 26);
  if (p.ads && wp.scope) spread = Math.max(5, spread * 0.72);

  /* 下坠：屏幕上的落点比准星低多少像素 */
  const drop = aimDropPx(wp, dist, p.aim);

  /* 超出这把枪的极限射程：子弹飞到 range 就消散，描它也没意义。
     这是「不同枪不同优势」最需要被看见的一刻 —— 换一把枪，圈立刻变回亮的。
     不弹提示框、不出音效，只把准星褪成灰、中间打个叉，玩家自己就懂了。 */
  const over = wp.range > 0 && dist > wp.range;

  /* 圈要「收」回去：那个圈的含义是「按这把枪的散布，子弹会落在这个范围里」。
     超出射程时一颗子弹都到不了这儿，再摊开一个 150px 的灰圈等于在骗人，
     而且 150px 的圈配一个 9px 的叉，乍看像个瞄准气泡、读不出「打不到」。
     所以收成一个小圈，把重点让给中间的叉和下面的字。 */
  const ringR = over ? Math.min(spread, 13) : spread;
  const ringA = over ? 'rgba(150,164,176,0.55)' : 'rgba(255,222,160,0.92)';

  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = ringA;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = over ? 'rgba(150,164,176,0.28)' : 'rgba(255,222,160,0.55)';
  ctx.beginPath();
  ctx.arc(x, y, ringR + 4, 0, Math.PI * 2);
  ctx.stroke();

  const g = ringR + 3, l = ringR + 9;
  ctx.strokeStyle = over ? 'rgba(160,174,186,0.60)' : 'rgba(255,232,190,0.95)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x - l, y); ctx.lineTo(x - g, y);
  ctx.moveTo(x + g, y); ctx.lineTo(x + l, y);
  ctx.moveTo(x, y - l); ctx.lineTo(x, y - g);
  ctx.moveTo(x, y + g); ctx.lineTo(x, y + l);
  ctx.stroke();

  /* 超出射程：中心画个叉，正下方标一行「超出射程」。
     字要小、要淡 —— 这是提示，不是报错。
     位置原来在圈的右边，可圈最大 150px、字跟出去 165px，等于飘在别处；
     现在圈收小了、字贴着中心走，两者是同一件事。 */
  if (over) {
    const s = 5.5;
    ctx.strokeStyle = 'rgba(198,126,112,0.90)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
    ctx.stroke();

    ctx.globalAlpha = 0.82;
    ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    /* 这行字画在 HUD 之前，被两张卡片盖掉一半就等于没有：
       贴到画面底边、或者正好落进左下/右下角卡片里，就翻到准星上面去。 */
    const lx0 = x - 22, lx1 = x + 22, ly = y + ringR + 19;
    const cover =
      (ly > H - 152 && lx1 > W - 320 && lx0 < W - 20) ||   /* 右下：大肥鱼卡片 */
      (ly > H - 112 && lx1 > 20 && lx0 < 320);             /* 左下：指挥官卡片 */
    const ty = (cover || ly > H - 6) ? y - ringR - 11 : ly;
    /* 先压一层深色底再写字：战场上什么背景都有（黄黑警戒条、亮着的路灯），
       10px 的字压在亮处就直接糊掉了。一像素的暗影足够，不用描边那么重。 */
    ctx.fillStyle = 'rgba(8,10,14,0.62)';
    ctx.fillText('超出射程', x + 1, ty + 1);
    ctx.fillStyle = 'rgba(216,158,144,1)';
    ctx.fillText('超出射程', x, ty);
    ctx.globalAlpha = 0.9;
  }

  /* 落点标记：子弹有下坠，所以真正打中的点在这个圈下面。
     下坠小于 5px 就不画了，近身战里那个点只会让人分心。
     超出射程时不画 —— 那里根本没有落点，画了就是在骗人。 */
  if (drop > 5 && !over) {
    const dy = Math.min(drop, 260);
    ctx.strokeStyle = 'rgba(255,180,120,0.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y + spread * 0.4);
    ctx.lineTo(x, y + dy - spread * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    /* 落点圈：直径 = 同一距离上的散布范围，画成一个扁椭圆像贴在地上 */
    const rx = spread, ry = Math.max(2.5, spread * 0.34);
    ctx.strokeStyle = 'rgba(255,170,110,0.78)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y + dy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,150,90,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y + dy, Math.max(1.4, rx * 0.16), Math.max(1, ry * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 中心点：超出射程时也褪成灰，不然那颗橙点会把叉盖掉，
     看上去像「准星里有个红点」而不是「这里打不到」。 */
  ctx.fillStyle = over ? 'rgba(150,164,176,0.55)' : 'rgba(255,120,80,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';     /* 「超出射程」那行改过对齐，还回去给 HUD 用 */
}
