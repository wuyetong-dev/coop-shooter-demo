const fs=require('fs'),path=require('path'),vm=require('vm');
const noop=()=>{},grad={addColorStop:noop};
const canvasEl={width:1280,height:720,style:{},getContext:()=>makeCtx(),addEventListener:noop,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720})};
function makeCtx(){return new Proxy({},{get(t,p){if(p in t)return t[p];if(p==='createLinearGradient'||p==='createRadialGradient')return()=>grad;if(p==='measureText')return()=>({width:90});if(p==='canvas')return canvasEl;return()=>{};},set(t,p,v){t[p]=v;return true;}});}
globalThis.document={getElementById:()=>canvasEl};globalThis.window=globalThis;globalThis.addEventListener=noop;
globalThis.innerWidth=1600;globalThis.innerHeight=900;globalThis.requestAnimationFrame=noop;
const base=path.join(__dirname,'..','js');
for(const f of ['util.js','world.js','ai.js','game.js','render.js','chars.js','render2.js','meta.js','hud.js'])vm.runInThisContext(fs.readFileSync(path.join(base,f),'utf8'),{filename:f});
const g=vm.runInThisContext('({get game(){return game},get player(){return player},get enemies(){return enemies},startStage,update,render})');
const U=vm.runInThisContext('({proneK, world, createEnemy, suppressPass})');
g.startStage(2);
const pl=g.player;
console.log('groundY',U.world.groundY,'player y',pl.y.toFixed(1),'x',pl.x.toFixed(1),'onGround',pl.onGround);
g.enemies.length=0;
const e=U.createEnemy('grunt',pl.x+320,1);
e.y=pl.y;e.spawnGuard=0;e.onGround=true;e.proneT=0;e.proneCd=0;e.suppress=0;e.suppressCd=0;e.fireCd=5;
g.enemies.push(e);
const whY=e.y-e.h*0.7+20;
U.suppressPass(e.x-220,whY,e.x+220,whY,'player');
for(let i=0;i<40;i++){
  e.x=pl.x+320;e.vx=0;
  g.update(1/60);
  if(i<12||i%10===0)console.log(i,'og',e.onGround,'y',e.y.toFixed(1),'prT',e.proneT.toFixed(2),'prCd',e.proneCd.toFixed(2),'sup',e.suppress.toFixed(2),'prone',U.proneK(e).toFixed(2),'adx',Math.abs(e.x-pl.x).toFixed(0),'dy',Math.abs(e.y-pl.y).toFixed(0));
}
