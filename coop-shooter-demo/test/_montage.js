/* 用法: node test/_montage.js src.png out.png Z bg x0,y0,w,h x0,y0,w,h ...
   把若干裁剪块按 Z 倍放大后横向拼成一张，块之间留 8px 深色间隔。 */
const fs=require('fs'),zlib=require('zlib');
function readPNG(f){const b=fs.readFileSync(f);let p=8,w,h,idat=[],ct,bd;
 while(p<b.length){const len=b.readUInt32BE(p),ty=b.toString('ascii',p+4,p+8);const d=b.slice(p+8,p+8+len);
  if(ty==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);bd=d[8];ct=d[9];}
  else if(ty==='IDAT')idat.push(d); else if(ty==='IEND')break; p+=12+len;}
 const raw=zlib.inflateSync(Buffer.concat(idat));
 const ch=ct===6?4:ct===2?3:1;
 const stride=w*ch,out=Buffer.alloc(w*h*4);let prev=Buffer.alloc(stride);
 for(let y=0;y<h;y++){const ft=raw[y*(stride+1)],line=raw.slice(y*(stride+1)+1,(y+1)*(stride+1));const cur=Buffer.alloc(stride);
  for(let i=0;i<stride;i++){const a=i>=ch?cur[i-ch]:0,bb=prev[i],c=i>=ch?prev[i-ch]:0;let v=line[i];
   if(ft===1)v+=a;else if(ft===2)v+=bb;else if(ft===3)v+=(a+bb)>>1;
   else if(ft===4){const pa=Math.abs(bb-c),pb=Math.abs(a-c),pc=Math.abs(a+bb-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c);}
   cur[i]=v&255;}
  for(let x=0;x<w;x++){const o=(y*w+x)*4;out[o]=cur[x*ch];out[o+1]=ch>1?cur[x*ch+1]:cur[x*ch];out[o+2]=ch>2?cur[x*ch+2]:cur[x*ch];out[o+3]=ch===4?cur[x*ch+3]:255;}
  prev=cur;}
 return {w,h,d:out};}
function writePNG(f,w,h,d){const raw=Buffer.alloc((w*4+1)*h);
 for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;d.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}
 const idat=zlib.deflateSync(raw,{level:9});
 const crcT=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crcT[n]=c>>>0;}
 const crc=b=>{let c=0xffffffff;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
 const mk=(ty,data)=>{const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const t=Buffer.from(ty,'ascii');const c=Buffer.alloc(4);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([l,t,data,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 fs.writeFileSync(f,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),mk('IHDR',ihdr),mk('IDAT',idat),mk('IEND',Buffer.alloc(0))]));}
const A=process.argv.slice(2);
const src=readPNG(A[0]),outF=A[1],Z=+A[2],bg=A[3];
const rects=A.slice(4).map(s=>s.split(',').map(Number));
const GAP=8;
const W=rects.reduce((s,r)=>s+r[2]*Z+GAP,GAP), H=Math.max(...rects.map(r=>r[3]*Z))+GAP*2;
const o=Buffer.alloc(W*H*4);
for(let i=0;i<W*H;i++){o[i*4]=0x14;o[i*4+1]=0x18;o[i*4+2]=0x1e;o[i*4+3]=255;}
let ox=GAP;
for(const [x0,y0,cw,chh] of rects){
 for(let y=0;y<chh*Z;y++)for(let x=0;x<cw*Z;x++){
  const sx=x0+Math.floor(x/Z), sy=y0+Math.floor(y/Z);
  if(sx<0||sy<0||sx>=src.w||sy>=src.h)continue;
  const si=(sy*src.w+sx)*4, di=((y+GAP)*W+(x+ox))*4;
  const a=src.d[si+3]/255;
  let r=src.d[si],g=src.d[si+1],b=src.d[si+2];
  if(bg==='w'){r=r*a+255*(1-a);g=g*a+255*(1-a);b=b*a+255*(1-a);}
  o[di]=r;o[di+1]=g;o[di+2]=b;o[di+3]=255;}
 ox+=cw*Z+GAP;}
writePNG(outF,W,H,o);
console.log('wrote',outF,W+'x'+H);
