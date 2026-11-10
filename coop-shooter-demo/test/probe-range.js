'use strict';
/* 弹道射程探针：不依赖浏览器，直接复刻 game.js 的积分 + world.js 的 lifeForRange。

   它回答两个问题：
     ① 每把枪的极限射程是不是真的拉开了差距（设计意图有没有实现）；
     ② 表上写的 range，子弹物理上到底飞不飞得到（life 够不够、会不会提前落地）。

   ②很重要 —— 射程是设计参数，如果物理上到不了，那这个数字就是在骗人，
   而玩家看到的只是「这枪打不远」，不会知道是我们的参数没对上。

   用法：node test/probe-range.js [--csv]
*/
const path = require('path');
const fs = require('fs');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'world.js'), 'utf8');
const m = src.match(/const WEAPONS = \[([\s\S]*?)\n\];/);
if (!m) { console.error('没找到 WEAPONS 表'); process.exit(1); }
const WEAPONS = new Function('return [' + m[1] + '];')();

/* 和 world.js 的 lifeForRange 保持同一份公式（改动时两处一起改） */
function lifeForRange(range, speed, drag) {
  const need = range * 1.04;
  const k = drag > 0 ? -Math.log(1 - drag) : 0;
  let t;
  if (k > 0 && need * k / speed < 0.96) t = -Math.log(1 - need * k / speed) / k;
  else t = need / Math.max(120, speed);
  return Math.min(t, 6);
}

const GROUND = 600;
const START_Y = GROUND - 0.62 * 58;   /* fireWeapon: a.y - a.h*0.62，a.h≈58 */

function fly(wp, upDeg, life, dt) {
  const ang = upDeg * Math.PI / 180;
  let x = 0, y = START_Y;
  let vx = Math.cos(ang) * wp.speed, vy = -Math.sin(ang) * wp.speed;
  let dist = 0, t = 0;
  while (t < life) {
    x += vx * dt; y += vy * dt;
    dist += Math.hypot(vx, vy) * dt;
    vy += (wp.grav || 0) * dt;
    if (wp.drag > 0) { const k = Math.pow(1 - wp.drag, dt); vx *= k; vy *= k; }
    t += dt;
    if (y >= GROUND) return { reach: x, t: t, ground: true };
    if (dist >= (wp.range || 0) && wp.range) return { reach: x, t: t, capped: true };
  }
  return { reach: x, t: t };
}

function best(wp, life) {
  let top = { reach: 0, ang: 0, t: 0 };
  for (let deg = -8; deg <= 60; deg += 0.25) {
    const r = fly(wp, deg, life, 1 / 240);
    if (r.reach > top.reach) top = { reach: r.reach, ang: deg, t: r.t };
  }
  return top;
}
/* 严格 0° 直射：准星正对着敌人、玩家一点枪都不抬时的落点。
   这才是「看到敌人就能打」的真实距离，比极限射程更能反映手感上的差异。 */
function flat(wp, life) {
  return fly(wp, 0, life, 1 / 240);
}

let bad = 0;
const rows = [];
for (const wp of WEAPONS) {
  const life = lifeForRange(wp.range, wp.speed, wp.drag || 0);
  const b = best(wp, life);
  const f = flat(wp, life);
  const ok = b.reach >= wp.range * 0.98;
  if (!ok) bad++;
  const fall = 1 - (wp.falloff || 0) * Math.min(wp.range / (wp.range * 0.55), 1);
  rows.push({
    name: wp.short, range: wp.range, life: life.toFixed(2),
    reach: Math.round(b.reach), ang: b.ang.toFixed(1),
    flat: Math.round(f.reach), ok: ok,
    dmgEnd: Math.round(wp.dmg * wp.pellets * fall)
  });
}

const pad = (s, n, l) => l ? String(s).padEnd(n) : String(s).padStart(n);
if (process.argv.includes('--csv')) {
  console.log('name,range,life,reach,ang,flat,dmgAtRangeEnd,reachable');
  for (const r of rows) console.log([r.name, r.range, r.life, r.reach, r.ang, r.flat, r.dmgEnd, r.ok].join(','));
} else {
  console.log('武器    设计射程  寿命   实测极限  仰角   0°直射   射程末伤害  物理可达');
  for (const r of rows) {
    console.log('  ' + pad(r.name, 6, 1) + pad(r.range, 10) + pad(r.life, 7)
      + pad(r.reach, 10) + pad(r.ang + '°', 7) + pad(r.flat, 10)
      + pad(r.dmgEnd, 10) + pad(r.ok ? '✓' : '✗ 飞不到', 12));
  }
  const sorted = [...rows].sort((a, b) => a.range - b.range);
  console.log('\n射程阶梯（近 → 远）：' + sorted.map(r => r.name + ' ' + r.range).join(' → '));
  const steps = [];
  for (let i = 1; i < sorted.length; i++) {
    steps.push((sorted[i].range / sorted[i - 1].range).toFixed(2) + '×');
  }
  console.log('相邻档位差：' + steps.join('  ') + '   （目标：每档 ≥1.3× 才感觉得到）');
  console.log('最远/最近：' + (sorted[sorted.length - 1].range / sorted[0].range).toFixed(2) + ' 倍');
  const fs2 = sorted.map(r => r.flat);
  console.log('0° 直射跨度：' + Math.min(...fs2) + ' ~ ' + Math.max(...fs2)
    + ' px（' + (Math.max(...fs2) / Math.max(1, Math.min(...fs2))).toFixed(2) + ' 倍）');
  console.log('视口宽度 VIEW_W = ' + Math.round(1280 / 1.22) + 'px　地图宽度 3200~3800px');
  if (bad) { console.log('\n✗ 有 ' + bad + ' 把枪物理上飞不到设计射程，参数要重调'); process.exit(1); }
  else console.log('\n✓ 五把枪都飞得到设计射程');
}
