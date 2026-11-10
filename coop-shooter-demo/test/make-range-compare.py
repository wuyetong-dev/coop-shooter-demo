# -*- coding: utf-8 -*-
"""把两把枪「同一 1300px 距离」的准星截图拼成一张对比图。
左：AWM 狙击（射程 5600）→ 在射程内，亮琥珀圈 + 红心
右：M870 霰弹（射程 1150）→ 超出射程，灰圈收小 + 中心叉 + 「超出射程」
用法：python test/make-range-compare.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = r"C:\Windows\Fonts\msyh.ttc"

PW, PH = 470, 313          # 面板尺寸（源图 900x600 等比缩放）
PAD, GAP = 12, 14
TITLE_H, CAP_H = 40, 34

LEFT = ("test/z_rng_snip3.png", "AWM 狙击 · 距离 1300px · 射程 5600",
        "在射程内：亮琥珀散布圈 + 中心红点，子弹会落在这里")
RIGHT = ("test/z_rng_over3.png", "M870 霰弹 · 距离 1300px · 射程 1150",
         "超出射程：灰圈收成 13px + 中心叉 + 「超出射程」")


def panel(src, title, cap):
    im = Image.open(os.path.join(HERE, os.path.basename(src))).convert("RGB")
    im = im.resize((PW, PH), Image.LANCZOS)
    box = Image.new("RGB", (PW, TITLE_H + PH + CAP_H), (14, 18, 24))
    d = ImageDraw.Draw(box)
    ft = ImageFont.truetype(FONT, 19)
    fc = ImageFont.truetype(FONT, 15)
    d.text((2, 10), title, font=ft, fill=(236, 240, 246))
    box.paste(im, (0, TITLE_H))
    d.text((2, TITLE_H + PH + 9), cap, font=fc, fill=(150, 164, 178))
    return box


a = panel(*LEFT)
b = panel(*RIGHT)

W = PAD * 2 + PW * 2 + GAP
H = PAD * 2 + TITLE_H + PH + CAP_H
out = Image.new("RGB", (W, H), (8, 11, 15))
out.paste(a, (PAD, PAD))
out.paste(b, (PAD + PW + GAP, PAD))
out.save(os.path.join(HERE, "range_compare.png"))
print("已生成 test/range_compare.png  %dx%d" % (W, H))
