const fs=require('fs');const {createCanvas,loadImage}=require('@napi-rs/canvas');
(async()=>{
  const img=await loadImage(fs.readFileSync(process.argv[2]));
  const c=createCanvas(img.width,img.height),g=c.getContext('2d');
  g.drawImage(img,0,0);
  const d=g.getImageData(0,0,img.width,img.height).data;
  const px=(x,y)=>{const i=(y*img.width+x)*4;return [d[i],d[i+1],d[i+2],d[i+3]];};
  const x=+process.argv[3];
  const y0=+process.argv[4], y1=+process.argv[5];
  for(let y=y0;y<=y1;y++) console.log(y, px(x,y).join(','));
})();
