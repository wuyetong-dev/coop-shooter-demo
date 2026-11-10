# -*- coding: utf-8 -*-
"""把主角三个版本并排，并在底部用游戏内真实尺寸检验剪影是否成立。"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'art')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hero_compare.png')

V1 = 'Japanese_anime_chibi_game_spri_2026-10-28T11-25-28.png'
V2 = 'Copy_ONLY_the_rendering_style__2026-10-28T11-26-04.png'
V3 = 'Copy_ONLY_the_rendering_style__2026-10-28T11-26-35.png'
V4 = 'Keep_this_exact_character__hel_2026-10-28T11-34-43.png'

FONT = 'C:/Windows/Fonts/msyh.ttc'
def f(sz, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc' if bold else FONT, sz)


def cutout(path, thresh=236):
    """白底转透明。

    角色本身是黑的，身上不会有接近纯白的像素，所以直接按亮度抠就够，
    不需要判断连通性（PIL 的 floodfill 在 L 模式下这批版本不生效，踩过了）。

    两个细节决定边缘质量：
      · 透明区的 RGB 一起压成近黑 —— 否则缩放时 LANCZOS 会把白色混进边缘，出现白边
      · alpha 再腐蚀 1px —— 去掉抗锯齿留下的半透明白毛边
    """
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    bg = (a[:, :, 0] > thresh) & (a[:, :, 1] > thresh) & (a[:, :, 2] > thresh)
    a[bg] = [10, 10, 11, 0]
    out = Image.fromarray(a)
    out.putalpha(out.getchannel('A').filter(ImageFilter.MinFilter(3)))
    return out.crop(out.getbbox())


def fit_h(im, h):
    w = int(round(im.width * h / im.height))
    return im.resize((w, h), Image.LANCZOS)


W = 1120
PAD = 30
TOP = 76
COLS = 3
GAP = 16
COLW = (W - PAD * 2 - GAP * (COLS - 1)) // COLS
IMGH = 372

items = [
    (V2, '① 灰甲版', '银灰占三成 · 青光太密', '轮廓最清楚，但不是「黑色」，也太吵'),
    (V3, '② 纯黑版', '死黑 · 仅目镜一条青光', '够神秘，但在暗处糊成一团黑影'),
    (V4, '③ 定稿', '炭黑 + 背部冷光 · 收窄头身比', '仍是黑，靠分块与边缘光读出结构'),
]

body_h = IMGH + 66
H1 = TOP + body_h + 20
STRIP_H = 322

canvas = Image.new('RGBA', (W, H1 + STRIP_H), (247, 248, 250, 255))
d = ImageDraw.Draw(canvas)

d.text((PAD, 18), '主角形象 · 三版收敛', font=f(26, True), fill=(28, 32, 38, 255))
d.text((PAD, 54), '同一姿势、同一朝向，按角色实际身高对齐 —— 只改明度结构与发光数量', font=f(13), fill=(120, 128, 138, 255))

for i, (fn, name, sub, note) in enumerate(items):
    im = fit_h(cutout(os.path.join(ART, fn)), IMGH)
    cx = PAD + i * (COLW + GAP)
    bg = Image.new('RGBA', (COLW, body_h), (255, 255, 255, 255))
    bd = ImageDraw.Draw(bg)
    bd.rectangle([0, 0, COLW - 1, body_h - 1], outline=(228, 232, 238, 255), width=1)
    bg.alpha_composite(im, ((COLW - im.width) // 2, IMGH - im.height + 6))
    canvas.alpha_composite(bg, (cx, TOP))
    d.text((cx + 12, TOP + body_h - 54), name, font=f(15, True), fill=(32, 36, 42, 255))
    d.text((cx + 12, TOP + body_h - 34), sub, font=f(11), fill=(96, 104, 114, 255))
    d.text((cx + 12, TOP + body_h - 17), note, font=f(11), fill=(150, 118, 92, 255))

# ---------- 下半：游戏内尺寸检验 ----------
y0 = H1
d.rectangle([0, y0, W, y0 + STRIP_H - 1], fill=(18, 21, 26, 255))
d.text((PAD, y0 + 14), '游戏内真实尺寸', font=f(17, True), fill=(234, 238, 242, 255))
d.text((PAD, y0 + 38), '1280×720、1.22 倍视角下人在屏幕上约 56px 高。下面是 1:1 实际像素。',
       font=f(11), fill=(132, 142, 154, 255))

v3img = cutout(os.path.join(ART, V4))
sizes = [96, 72, 56, 40]
BANDS = [((20, 24, 30), '夜战'), ((54, 46, 38), '沙地')]
band_h = 112
col_w = (W - PAD * 2) // len(sizes)
band_y0 = y0 + 78

for bi, (bgc, lb) in enumerate(BANDS):
    by = band_y0 + bi * (band_h + 8)
    d.rectangle([PAD, by, W - PAD, by + band_h - 1], fill=bgc + (255,))
    d.text((W - PAD - 30, by + 8), lb, font=f(10), fill=(150, 158, 168, 255))
    for i, sz in enumerate(sizes):
        small = fit_h(v3img, sz)
        cx = PAD + i * col_w + (col_w - small.width) // 2
        canvas.alpha_composite(small, (cx, by + band_h - 6 - small.height))
        if bi == 0:
            d.text((PAD + i * col_w + col_w // 2 - 13, y0 + 60),
                   f'{sz}px', font=f(11, True), fill=(186, 194, 204, 255))
    d.line([PAD, by + band_h - 6, W - PAD, by + band_h - 6], fill=(90, 98, 108, 90), width=1)

canvas.convert('RGB').save(OUT)
print('saved', OUT, canvas.size)
