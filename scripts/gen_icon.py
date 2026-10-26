#!/usr/bin/env python3
"""生成 Stland 应用图标源图（1024×1024 PNG）。

设计
----
母题只有一个：向上的趋势。启动器图标在桌面上通常只有 48dp，
任何字标都会糊成一团，所以只用「K 线 + 箭头」两个强形状表达。

  1. 满幅深海军蓝对角渐变底；
  2. 三根自左向右抬高的 K 线（A 股习惯：涨红）；
  3. 一支实心白箭头沿抬升方向直指右上。

安全区（本次重点）
------------------
Android 自适应图标：108dp 画布里启动器会按圆形/方圆/水滴等形状裁切，
各形状都能完整看到的是中心直径 66dp 的圆 —— 即画布边长的 61%，
换算成半径就是画布边长的 30.5%。

由此两条硬约束：
  a) 底必须是满幅的。若画「圆角矩形底」，系统再裁一刀，四角会露出透明缺口。
  b) 所有图形必须落在中心安全圆内，否则圆/水滴遮罩会切到箭头或 K 线。

脚本对 b) 做机械保证：把图形画在独立图层上，按 alpha 掩膜实测最远半径，
再等比缩放到安全半径以内才合成 —— 不依赖人工估点，改设计也不会悄悄越界。
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
SS = 4                      # 超采样倍数，缩回后边缘才干净
S = SIZE * SS               # 实际绘制画布

# 安全半径占边长的比例：66dp / 108dp / 2 = 0.3056，取 0.30 留一点余量
SAFE_R_RATIO = 0.30
SAFE_R = SIZE * SAFE_R_RATIO

BG_TOP = (7, 11, 18)       # #070b12
BG_BOTTOM = (18, 33, 58)   # #12213a
CANDLE_UP = (232, 56, 61)  # #e8383d
CANDLE_DIM = (188, 42, 47)
ARROW = (247, 250, 255)


def u(v: float) -> int:
    """设计坐标(1024基准) → 绘制坐标(4096基准)"""
    return int(round(v * SS))


def build_background() -> Image.Image:
    """满幅背景：对角渐变 + 左上柔光，全程 float 计算，最后一步才量化。

    为什么必须全程 float：
      暗色渐变的总色差只有几十级。若中途用 8bit 存一次（尤其是对柔光掩膜做
      高斯模糊再合成），量化台阶会被眼睛放大成一圈圈同心环 —— 在深色大平面上
      非常显眼。所以这里用解析式（高斯衰减）算柔光，不经过 8bit 掩膜模糊，
      最后统一量化并叠加抖动把残余台阶打散。
    """
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)

    # 1) 对角线性渐变
    t = (xx / (S - 1)) * 0.35 + (yy / (S - 1)) * 0.65
    top = np.array(BG_TOP, dtype=np.float32)
    bot = np.array(BG_BOTTOM, dtype=np.float32)
    img = top[None, None, :] + (bot - top)[None, None, :] * t[:, :, None]

    # 2) 左上柔光：解析高斯，避免 8bit 掩膜模糊产生的量化环
    gx, gy = u(230), u(190)
    sigma = u(300)
    d2 = (xx - gx) ** 2 + (yy - gy) ** 2
    glow = np.exp(-d2 / (2.0 * sigma * sigma)).astype(np.float32)
    tint = np.array([92, 146, 255], dtype=np.float32)
    # 按 alpha 与色调做 source-over 混合
    img = img * (1.0 - glow[..., None] * 0.42) + tint[None, None, :] * (glow[..., None] * 0.42)

    # 3) 抖动 + 量化：固定种子保证可复现
    rng = np.random.default_rng(20260101)
    img = img + rng.uniform(-0.9, 0.9, img.shape).astype(np.float32)
    img = np.clip(np.rint(img), 0, 255).astype(np.uint8)
    return Image.fromarray(img, "RGB").convert("RGBA")





def draw_candles(d: ImageDraw.ImageDraw) -> None:
    """三根上攻 K 线，间距 106，实体宽 54。"""
    # (中心x, 实体上, 实体下, 影线上, 影线下, 颜色)
    candles = [
        (410, 588, 690, 562, 716, CANDLE_DIM),
        (516, 496, 632, 470, 658, CANDLE_UP),
        (622, 402, 554, 376, 580, CANDLE_UP),
    ]
    half_body, wick_w = 27.0, 9.0
    for cx, top, bot, wtop, wbot, color in candles:
        d.rounded_rectangle(
            [u(cx - wick_w / 2), u(wtop), u(cx + wick_w / 2), u(wbot)],
            radius=u(wick_w / 2), fill=color,
        )
        d.rounded_rectangle(
            [u(cx - half_body), u(top), u(cx + half_body), u(bot)],
            radius=u(9), fill=color,
        )


def draw_arrow(d: ImageDraw.ImageDraw) -> None:
    """实心箭头：粗杆 + 实心三角头，整体朝右上，与 K 线抬升同向。"""
    tail = (388.0, 566.0)
    head_base = (600.0, 340.0)
    shaft_h = 26.0

    dx, dy = head_base[0] - tail[0], head_base[1] - tail[1]
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux

    p1 = (tail[0] + nx * shaft_h, tail[1] + ny * shaft_h)
    p2 = (head_base[0] + nx * shaft_h, head_base[1] + ny * shaft_h)
    p3 = (head_base[0] - nx * shaft_h, head_base[1] - ny * shaft_h)
    p4 = (tail[0] - nx * shaft_h, tail[1] - ny * shaft_h)
    d.polygon([(u(x), u(y)) for x, y in (p1, p2, p3, p4)], fill=ARROW)
    d.ellipse([u(tail[0] - shaft_h), u(tail[1] - shaft_h),
               u(tail[0] + shaft_h), u(tail[1] + shaft_h)], fill=ARROW)

    tip = (head_base[0] + ux * 142, head_base[1] + uy * 142)
    base_half = 98.0
    b1 = (head_base[0] + nx * base_half, head_base[1] + ny * base_half)
    b2 = (head_base[0] - nx * base_half, head_base[1] - ny * base_half)
    d.polygon([(u(tip[0]), u(tip[1])), (u(b1[0]), u(b1[1])), (u(b2[0]), u(b2[1]))], fill=ARROW)


def motif_layer() -> Image.Image:
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_candles(d)
    draw_arrow(d)
    return layer


def max_radius_of_alpha(layer: Image.Image) -> float:
    """按 alpha 掩膜实测图形最远半径（返回 1024 基准像素）。

    直接读图形层而不是「成品图 vs 背景图」的差分：
    后者会被渐变噪声和投影柔光污染，量出来会虚高，也不利于跨图比较。
    """
    a = np.asarray(layer.split()[3])
    ys, xs = np.nonzero(a > 24)
    if len(xs) == 0:
        return 0.0
    cx = cy = S / 2.0
    r = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max()
    return float(r / SS)


def fit_into_safe_zone(layer: Image.Image) -> tuple[Image.Image, float, float]:
    """把图形层等比缩放到安全圆内，并让图形包围盒中心与画布中心对齐。

    只缩不居中会有个问题：图形天然偏某一侧（本图箭头在右上、K 线在左下），
    缩放后仍然偏，启动器里看起来是「歪的」。
    所以先缩放到安全半径内，再按 alpha 包围盒平移到画布正中。

    注意居中要在缩放之后做：居中不改变半径，两者互不干扰。
    """
    r_before = max_radius_of_alpha(layer)
    target = SAFE_R * 0.96          # 留 4% 余量，避免抗锯齿边缘压线
    if r_before > target:
        k = target / r_before
        new_size = max(1, int(round(S * k)))
        scaled = layer.resize((new_size, new_size), Image.LANCZOS)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        off = (S - new_size) // 2
        canvas.paste(scaled, (off, off), scaled)
        layer = canvas

    # 按 alpha 包围盒居中
    bbox = layer.split()[3].getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        dx, dy = int(round(S / 2.0 - cx)), int(round(S / 2.0 - cy))
        if dx or dy:
            shifted = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            shifted.paste(layer, (dx, dy), layer)
            layer = shifted

    return layer, r_before, max_radius_of_alpha(layer)


def with_shadow(bg: Image.Image, layer: Image.Image) -> Image.Image:
    """图形下方一层柔和投影，把白箭头从深底上「抬」起来。"""
    sh = layer.filter(ImageFilter.GaussianBlur(u(16)))
    alpha = sh.split()[3].point(lambda v: int(v * 0.55))
    sh.putalpha(alpha)
    return Image.alpha_composite(Image.alpha_composite(bg, sh), layer)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "icon-source.png")

    base = build_background()

    layer = motif_layer()
    layer, r_before, r_after = fit_into_safe_zone(layer)

    img = with_shadow(base, layer).resize((SIZE, SIZE), Image.LANCZOS).convert("RGB")
    img.save(out, "PNG")

    print(f"已生成 {out}（{SIZE}×{SIZE}）")
    print(f"图形半径：缩放前 {r_before:.1f}px → 缩放后 {r_after:.1f}px")
    print(f"安全上限：{SAFE_R:.1f}px（边长 {SAFE_R_RATIO * 100:.0f}%，即 66/108 直径规范）")
    if r_after > SAFE_R:
        print("::error::图形仍超出安全区")
        return 1
    print(f"安全区校验通过：图形占画布直径 {r_after * 2 / SIZE * 100:.1f}%，在 61% 安全圆内")
    return 0


if __name__ == "__main__":
    sys.exit(main())
