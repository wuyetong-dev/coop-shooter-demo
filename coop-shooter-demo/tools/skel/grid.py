import sys
from PIL import Image, ImageDraw
f, out, z = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv)>3 else 6
im = Image.open(f).convert('RGBA')
W,H = im.size
bg = Image.new('RGBA',(W,H),(38,42,50,255)); bg.alpha_composite(im)
big = bg.resize((W*z,H*z), Image.NEAREST)
d = ImageDraw.Draw(big)
for x in range(0,W+1,5):
    c = (255,80,80,150) if x%20==0 else (120,160,220,90)
    d.line([(x*z,0),(x*z,H*z)], fill=c, width=1)
    if x%20==0: d.text((x*z+2,2), str(x), fill=(255,220,120,255))
for y in range(0,H+1,5):
    c = (255,80,80,150) if y%20==0 else (120,160,220,90)
    d.line([(0,y*z),(W*z,y*z)], fill=c, width=1)
    if y%20==0: d.text((2,y*z+1), str(y), fill=(255,220,120,255))
big.save(out); print(out, big.size)
