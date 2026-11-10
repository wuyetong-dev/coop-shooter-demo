const fs=require('fs'),zlib=require('zlib');
function png(f){const b=fs.readFileSync(f);let p=8,w,h,idat=[],ct,bd;
 while(p<b.length){const len=b.readUInt32BE(p),ty=b.toString('ascii',p+4,p+8);const d=b.slice(p+8,p+8+len);
  if(ty==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);bd=d[8];ct=d[9];}
  else if(ty==='IDAT')idat.push(d); else if(ty==='IEND')break; p+=12+len;}
 const raw=zlib.inflateSync(Buffer.concat(idat));
 const ch=ct===6?4:ct===2?3:ct===0?1:0;
 if(!ch||bd!==8)throw new Error('ct'+ct+' bd'+bd);
 const stride=w*ch, out=Buffer.alloc(w*h*4);
 let prev=Buffer.alloc(stride);
 for(let y=0;y<h;y++){const ft=raw[y*(stride+1)];const line=raw.slice(y*(stride+1)+1,(y+1)*(stride+1));
  const cur=Buffer.alloc(stride);
  for(let i=0;i<stride;i++){const a=i>=ch?cur[i-ch]:0,bb=prev[i],c=i>=ch?prev[i-ch]:0;let v=line[i];
   if(ft===1)v+=a; else if(ft===2)v+=bb; else if(ft===3)v+=(a+bb)>>1;
   else if(ft===4){const pa=Math.abs(bb-c),pb=Math.abs(a-c),pc=Math.abs(a+bb-2*c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c);}
   cur[i]=v&255;}
  for(let x=0;x<w;x++){const o=(y*w+x)*4;
   out[o]=cur[x*ch];out[o+1]=cur[x*ch+1]!==undefined?cur[x*ch+1]:cur[x*ch];out[o+2]=cur[x*ch+2]!==undefined?cur[x*ch+2]:cur[x*ch];
   out[o+3]=ch===4?cur[x*ch+3]:255;}
  prev=cur;}
 return {w,h,d:out};}
const f=process.argv[2];
const {w,h,d}=png(f);
console.log(f,w+'x'+h);
for(let y=0;y<h;y++){let segs=[],run=null;
 for(let x=0;x<w;x++){const al=d[(y*w+x)*4+3];
  if(al>128){if(!run)run={a:x,b:x};else run.b=x;}else if(run){segs.push(run);run=null;}}
 if(run)segs.push(run);
 if(y>=130||y%16===0)console.log(String(y).padStart(3),segs.map(s=>s.a+'-'+s.b).join(' '));}
