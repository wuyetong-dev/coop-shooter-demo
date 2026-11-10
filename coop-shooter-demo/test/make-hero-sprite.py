# -*- coding: utf-8 -*-
"""把 ImageGen 出来的主角立绘处理成游戏内位图：
   白底抠图 → 去白边 → 归一化到 192px 高（96px 显示的 2 倍超采样）→ 输出 + 量关键坐标
   用法：python test/make-hero-sprite.py
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'art')
H_ART = 192          # 归一化高度（游戏内显示 96px 的 2 倍）

JOBS = {
    'hero_hold': 'Keep_this_exact_character__hel_2026-10-28T11-43-45.png',
    'hero_idle': 'Keep_this_exact_character__hel_2026-10-28T11-34-43.png',
}


def cutout(path):
    im = Image.open(path).convert('RGBA')
    a = np.array(im).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    # 主角身上没有任何浅色像素（最亮是边缘冷光，仍在 150 以下），
    # 所以纯亮度阈值就够了，不用管「角色内部被打洞」。
    bg = (r > 205) & (g > 205) & (b > 205)
    a[:, :, 3] = np.where(bg, 0, 255)
    # 半透明白边：紧贴不透明区的浅色像素按透明度折算，压暗到描边色，
    # 缩放后就不会出现一圈灰白轮廓
    edge = (~bg) & (r > 150) & (g > 150) & (b > 150)
    a[edge, 0] = 40; a[edge, 1] = 48; a[edge, 2] = 56
    out = Image.fromarray(a.astype(np.uint8), 'RGBA')
    # 腐蚀 1px（1024 分辨率下约等于屏幕 0.1px），把抗锯齿残留吃掉
    out.putalpha(out.getchannel('A').filter(ImageFilter.MinFilter(3)))
    # 全透明区 RGB 压到近黑：LANCZOS 缩放会把透明像素的颜色混进边缘
    arr = np.array(out)
    arr[arr[:, :, 3] == 0, 0:3] = 8
    out = Image.fromarray(arr, 'RGBA')
    return out.crop(out.getbbox())


def normalize(im):
    w = int(round(im.width * H_ART / im.height))
    return im.resize((w, H_ART), Image.LANCZOS)


def profile(im, label):
    a = np.array(im)
    al = a[:, :, 3] > 96
    H, W = al.shape
    ys, xs = np.where(al)
    info = {'label': label, 'w': W, 'h': H,
            'top': int(ys.min()), 'bottom': int(ys.max()),
            'left': int(xs.min()), 'right': int(xs.max())}

    # 逐行左右边界，用来找腿缝和手的位置
    rows = []
    for y in range(0, H, 2):
        m = np.where(al[y])[0]
        rows.append((y, int(m.min()), int(m.max()), int(m.sum())) if len(m) else (y, -1, -1, 0))

    # 脚底：最底下 6 行
    feet = [r for r in rows if r[0] >= H - 8 and r[3] > 0]
    if feet:
        info['feet_x0'] = min(r[1] for r in feet)
        info['feet_x1'] = max(r[2] for r in feet)
        info['foot_frac'] = round(((info['feet_x0'] + info['feet_x1']) / 2) / W, 4)

    # 手：躯干高度带里最靠右的那一行（盔是圆的，胸口高度最右点就是前手）
    band = [r for r in rows if 0.42 * H <= r[0] <= 0.60 * H and r[3] > 0]
    if band:
        best = max(band, key=lambda r: r[2])
        info['hand_row'] = best[0]
        info['hand_x'] = best[2]
        info['hand_xfrac'] = round(best[2] / W, 4)

    # 腿缝：下半身逐行找「中段断开」的行，取最长的连续断开段作为分腿高度
    gaps = []
    for y in range(int(0.62 * H), H - 4, 1):
        m = al[y]
        idx = np.where(m)[0]
        if len(idx) < 4: continue
        run, cur = [], None
        for x in range(idx.min(), idx.max() + 1):
            if not m[x]:
                if cur is None: cur = [x, x]
                else: cur[1] = x
            else:
                if cur and cur[1] - cur[0] >= 2: run.append(tuple(cur))
                cur = None
        if cur and cur[1] - cur[0] >= 2: run.append(tuple(cur))
        if run:
            best = max(run, key=lambda t: t[1] - t[0])
            gaps.append((y, best))
    if gaps:
        info['gap_rows'] = len(gaps)
        info['gap_y_first'] = gaps[0][0]
        info['gap_y_last'] = gaps[-1][0]
        mid = gaps[len(gaps) // 2]
        info['gap_mid'] = mid
    return info, rows


def main():
    report = {}
    for name, src in JOBS.items():
        p = os.path.join(ART, src)
        if not os.path.exists(p):
            print('missing', p); continue
        im = normalize(cutout(p))
        out = os.path.join(ART, name + '.png')
        im.save(out)
        info, rows = profile(im, name)
        report[name] = info
        print('== ' + name, '->', out)
        print(json.dumps(info, ensure_ascii=False))
        # ASCII 轮廓（每 3 行、每 2 列取样），用来肉眼确认腿缝与手的位置
        a = np.array(im); al = a[:, :, 3] > 96
        step_y = max(1, im.height // 48); step_x = max(1, im.width // 46)
        for y in range(0, im.height, step_y):
            line = ''
            for x in range(0, im.width, step_x):
                blk = al[y:y + step_y, x:x + step_x]
                line += '#' if blk.any() else '.'
            print('%3d %s' % (y, line))
    with open(os.path.join(ART, '_hero_metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
