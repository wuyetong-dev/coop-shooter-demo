/* 局部放大：TAG=xx node test/_crop.js <png> <x> <y> <w> <h> [scale] */
const fs=require('fs');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
(async()=>{
  const [,,file,x,y,w,h,s]=process.argv;
  const img=await loadImage(fs.readFileSync(file));
  const sc=+(s||2);
  const c=createCanvas(+w*sc,+h*sc); const g=c.getContext('2d');
  g.imageSmoothingEnabled=false;
  g.drawImage(img,+x,+y,+w,+h,0,0,+w*sc,+h*sc);
  const out=file.replace(/\.png$/,'')+'_crop'+(process.env.TAG||'')+'.png';
  fs.writeFileSync(out,await c.encode('png'));
  console.log(out);
})();
