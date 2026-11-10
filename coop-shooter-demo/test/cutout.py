# -*- coding: utf-8 -*-
"""
把 ImageGen 出的「假透明」立绘抠成真透明 PNG。

坑：ImageGen 的 background=transparent 经常不生效，返回 RGB 图，
     上面画了一层棋盘格（白 #FFF / 浅灰 #DFDDDB）冒充透明预览。

方法（放弃 PIL floodfill：它的 thresh 是「各通道绝对差之和」，
白格到灰格实际距离约 88，参数极不直观，容易误判）：
  1. 逐像素算它到「白」和「灰」两种背景色的曼哈顿距离，取小者；
     距离够近的标为候选背景。角色身上最浅的白围裙也是候选，但——
  2. 用连通域把候选背景切开，只保留**与画面边框接触**的那几块。
     角色整体被深色描边包住，内部的白永远不会连到边框，所以安全。
  3. 去白边：轮廓上有一圈「角色色 × 背景白」的混合像素，缩到 96px 后
     在深色关卡背景上会变成一圈白毛。用距离变换让每个边缘像素吸附到
     最近的内陆像素颜色。
  4. 裁 bbox，等比缩放到目标高度。
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else 'art/Full_body_side_profile_game_sp_2026-10-28T07-13-50.png'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'art/whale_idle.png'
TARGET_H = int(sys.argv[3]) if len(sys.argv) > 3 else 192

im = Image.open(SRC).convert('RGB')
W, H = im.size
rgb = np.array(im).astype(np.int16)

# ---- 1. 候选背景：接近白 或 接近灰 ----
BG_WHITE = np.array([255, 255, 255])
BG_GRAY = np.array([224, 223, 221])
d_w = np.abs(rgb - BG_WHITE).sum(axis=2)
d_g = np.abs(rgb - BG_GRAY).sum(axis=2)
cand = np.minimum(d_w, d_g) < 62
print(f'候选背景 {cand.mean()*100:.1f}%')

# ---- 2. 只保留与边框连通的背景块 ----
lab, n = ndimage.label(cand)
border_ids = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
border_ids.discard(0)
bg = np.isin(lab, list(border_ids))
ratio = bg.mean()
print(f'边框连通背景 {ratio*100:.1f}%  (连通块 {n} 个，贴边 {len(border_ids)} 个)')
if not (0.30 < ratio < 0.92):
    print('!! 背景占比异常，abort')
    sys.exit(1)

fg = ~bg

# ---- 3. 去白边 ----
# 边缘带 = 前景里离背景 <= 2.5px 的一圈
d_fg = ndimage.distance_transform_edt(fg)
edge = fg & (d_fg <= 2.5)
inner = fg & (d_fg > 3.5)
print(f'边缘带 {int(edge.sum())} px，内陆 {int(inner.sum())} px')

work = rgb.astype(np.float32)
if inner.sum() > 800:
    _, (jy, jx) = ndimage.distance_transform_edt(~inner, return_indices=True)
    clean = work[jy, jx]
    work[edge] = clean[edge]
else:
    print('内陆像素太少，跳过去白边')

# ---- 4. 组装 RGBA ----
out = np.zeros((H, W, 4), dtype=np.uint8)
out[:, :, :3] = np.clip(work, 0, 255).astype(np.uint8)
out[:, :, 3] = np.where(fg, 255, 0).astype(np.uint8)
res = Image.fromarray(out, 'RGBA')

bbox = res.getbbox()
print(f'bbox {bbox}  内容 {bbox[2]-bbox[0]}x{bbox[3]-bbox[1]}')
res = res.crop(bbox)

scale = TARGET_H / res.height
new_w = max(1, round(res.width * scale))
res = res.resize((new_w, TARGET_H), Image.LANCZOS)
res.save(OUT)
print(f'输出 {OUT}  {res.width}x{res.height}  宽高比 {res.width/res.height:.3f}')
