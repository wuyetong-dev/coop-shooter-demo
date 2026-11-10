const fs=require('fs');
const [name,png]=process.argv.slice(2);
const b64=fs.readFileSync(png).toString('base64');
let src=fs.readFileSync('js/chars.js','utf8');
const re=new RegExp("(const "+name+"\\s*=\\s*\\n?\\s*')data:image/png;base64,[^']*(')");
if(!re.test(src)){console.error('pattern not found for',name);process.exit(1);}
const before=src.length;
src=src.replace(re,(m,a,b)=>a+'data:image/png;base64,'+b64+b);
fs.writeFileSync('js/chars.js',src);
console.log(name,'inlined',b64.length,'chars; file',before,'->',src.length);
