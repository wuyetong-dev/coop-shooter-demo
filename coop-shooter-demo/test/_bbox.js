const {execSync}=require('child_process');
const fs=require('fs'),zlib=require('zlib');
const src=fs.readFileSync(process.argv[2]);
// 复用 _montage 的读取逻辑太长，直接在这里最小实现
let p=8,w,h,idat=[],ct;
while(p<src.length){const len=src.readUInt32BE(p),ty=src.toString('ascii',p+4,p+8),d=src.slice(p+8,p+8+len);
 if(ty==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);ct=d[9];}
 else if(ty==='IDAT')idat.push(d); else if(ty==='IEND')break; p+=12+len;}
const raw=zlib.inflateSync(Buffer.concat(idat)),ch=ct===6?4:3,stride=w*ch;
const px=Buffer.alloc(w*h*4);let prev=Buffer.alloc(stride);
for(let y=0;y<h;y++){const ft=raw[y*(stride+1)],line=raw.slice(y*(stride+1)+1,(y+1)*(stride+1));const cur=Buffer.alloc(stride);
 for(let i=0;i<stride;i++){const a=i>=ch?cur[i-ch]:0,bb=prev[i],c=i>=ch?prev[i-ch]:0;let v=line[i];
  if(ft===1)v+=a;else if(ft===2)v+=bb;else if(ft===3)v+=(a+bb)>>1;
  else if(ft===4){const pa=Math.abs(bb-c),pb=Math.abs(a-c),pc=Math.abs(a+bb-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c);}
  cur[i]=v&255;}
 for(let x=0;x<w;x++){px[(y*w+x)*4]=cur[x*ch];px[(y*w+x)*4+1]=cur[x*ch+1];px[(y*w+x)*4+2]=cur[x*ch+2];px[(y*w+x)*4+3]=255;}
 prev=cur;}
/* 背景是 #20262e 加网格线，判据：和背景色差够大 */
const bgc=[0x20,0x26,0x2e];
const A=process.argv.slice(3).map(Number);
const [rx,ry,rw,rh]=A;
let minx=1e9,miny=1e9,maxx=-1,maxy=-1;
for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++){const i=(y*w+x)*4;
 const d=Math.abs(px[i]-bgc[0])+Math.abs(px[i+1]-bgc[1])+Math.abs(px[i+2]-bgc[2]);
 if(d>40){if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}}
console.log('bbox in',rx,ry,rw,rh,'->',{minx,miny,maxx,maxy,W:maxx-minx+1,H:maxy-miny+1});
