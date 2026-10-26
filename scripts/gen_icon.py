#!/usr/bin/env python3
"""生成 Stland 应用图标（1024×1024 PNG，RGBA）。

设计说明
--------
「股岛」= 岛屿 + 行情。图标要在 48dp 启动器尺寸下依然可辨，因此只保留两件事：

* **岛**：圆角方底 + 对角渐变 + 左上一抹柔光，让底座像一块有体积的岛礁，
  而不是一块死黑矩形；
* **盘**：三根阶梯向上的 K 线（阳线暖红、阴线低饱和蓝灰），上叠一条白色趋势线，
  趋势线末端是**按前进方向计算的实心三角箭头**，指向右上。

为什么箭头要按方向向量算：早前版本用手工估点画两条倒钩，结果在斜向上折线的
末端形成「V 形开口朝下」的图形，读起来像对勾而不是箭头。现在由折线末段方向
反推三角形三个顶点，箭头朝向永远与走势一致，缩到 48px 也不会失真。

配色沿用客户端设计令牌：深海军蓝底（#0b0f16 → #1a2c4d）配暖砖红（#e8383d → #ff6b5a）。
暗底暖红在深色启动器里对比度足够，也不像纯黑纯白那样廉价。

技术要点
--------
* **4× 超采样**后按面积平均降采样，得到干净的抗锯齿边缘（不依赖 PIL）；
* 圆角用精确的圆角矩形距离判定，边缘不会出现锯齿台阶；
* 纯标准库（zlib + struct），任何环境可复现；
* 所有图形收在中心 ±0.34 范围内，给 Android 自适应图标的裁切留出安全边距。
"""
from __future__ import annotations

import math
import struct
import zlib

S = 1024          # 输出边长
SS = 4            # 超采样倍数
W = S * SS

BG_TOP = (11, 15, 22)        # #0b0f16
BG_BOT = (26, 44, 77)        # #1a2c4d
UP = (232, 56, 61)           # #e8383d 涨
UP_HI = (255, 107, 90)       # #ff6b5a 涨（高光）
DOWN = (74, 92, 122)         # 阴线，低饱和避免与阳线抢读
LINE = (255, 238, 234)       # 趋势线/箭头，暖白

# 三根 K 线：(中心x, 实体顶y, 实体底y, 影线上y, 影线下y, 是否阳线)
CANDLES = [
    (-0.245, 0.100, 0.275, 0.045, 0.320, False),
    (-0.030, -0.020, 0.155, -0.070, 0.210, True),
    (0.185, -0.185, 0.005, -0.235, 0.060, True),
]
CANDLE_W = 0.090
WICK_W = 0.022

# 趋势线折点：从左下贯穿到右上，压在 K 线之上（真实的行情走势线画法）
POLY = [(-0.300, 0.255), (-0.150, 0.120), (0.010, 0.015), (0.170, -0.120), (0.300, -0.220)]
POLY_W = 0.036

# 箭头（由末段方向反推的实心三角形）
ARROW_LEN = 0.150     # 三角形长度
ARROW_HALF = 0.098    # 三角形底边半宽

RADIUS = 0.215


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def rounded_rect_inside(u: float, v: float, r: float) -> bool:
    ax, ay = abs(u), abs(v)
    half = 0.5
    if ax > half or ay > half:
        return False
    if ax <= half - r or ay <= half - r:
        return True
    return math.hypot(ax - (half - r), ay - (half - r)) <= r


def seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


# 由折线末段的方向反推三角形：tip 沿方向前移，底边两点沿法向展开
_tx, _ty = POLY[-1]
_dx, _dy = _tx - POLY[-2][0], _ty - POLY[-2][1]
_n = math.hypot(_dx, _dy) or 1.0
_dirx, _diry = _dx / _n, _dy / _n
_nx, _ny = -_diry, _dirx              # 单位法向

TIP = (_tx + _dirx * ARROW_LEN * 0.55, _ty + _diry * ARROW_LEN * 0.55)
BASE_C = (_tx - _dirx * ARROW_LEN * 0.45, _ty - _diry * ARROW_LEN * 0.45)
BASE_A = (BASE_C[0] + _nx * ARROW_HALF, BASE_C[1] + _ny * ARROW_HALF)
BASE_B = (BASE_C[0] - _nx * ARROW_HALF, BASE_C[1] - _ny * ARROW_HALF)


def in_triangle(px, py) -> bool:
    """重心坐标同号判定；直接用叉积符号比较，避免除法"""
    def cross(ax, ay, bx, by, cx, cy):
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    d1 = cross(TIP[0], TIP[1], BASE_A[0], BASE_A[1], px, py)
    d2 = cross(BASE_A[0], BASE_A[1], BASE_B[0], BASE_B[1], px, py)
    d3 = cross(BASE_B[0], BASE_B[1], TIP[0], TIP[1], px, py)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def sample(u: float, v: float):
    if not rounded_rect_inside(u, v, RADIUS):
        return (0, 0, 0, 0)

    # 背景：对角渐变 + 左上一抹柔光
    t = (v + 0.5) * 0.70 + (u + 0.5) * 0.30
    t = max(0.0, min(1.0, t))
    col = lerp(BG_TOP, BG_BOT, t)
    glow = max(0.0, 1.0 - math.hypot(u + 0.14, v + 0.30) / 1.00)
    col = lerp(col, (50, 82, 130), glow * 0.42)

    # --- 1) K 线（先画，趋势线随后压在上面，符合行情图阅读习惯）---
    for cx, top, bot, wt, wb, bullish in CANDLES:
        if abs(u - cx) <= WICK_W / 2 and wt <= v <= wb:
            col = lerp(col, LINE, 0.50)
        if abs(u - cx) <= CANDLE_W / 2 and top <= v <= bot:
            k = (v - top) / max(1e-6, bot - top)
            col = lerp(UP_HI, UP, k) if bullish else DOWN
            # 柱体左右暗边，让实体有厚度而不是色块
            if abs(u - cx) > CANDLE_W / 2 * 0.84:
                col = lerp(col, (0, 0, 0), 0.12)

    # --- 2) 趋势线 ---
    for i in range(len(POLY) - 1):
        if seg_dist(u, v, *POLY[i], *POLY[i + 1]) <= POLY_W / 2:
            col = LINE

    # --- 3) 箭头 ---
    if in_triangle(u, v):
        col = LINE

    return (col[0], col[1], col[2], 255)


def render() -> bytes:
    rows = []
    for y in range(S):
        row = bytearray()
        for x in range(S):
            ar = ag = ab = aa = 0
            for sy in range(SS):
                for sx in range(SS):
                    u = ((x * SS + sx + 0.5) / W) - 0.5
                    v = ((y * SS + sy + 0.5) / W) - 0.5
                    r, g, b, a = sample(u, v)
                    ar += r * a      # 预乘 alpha，避免透明边缘出现黑边
                    ag += g * a
                    ab += b * a
                    aa += a
            n = SS * SS
            if aa == 0:
                row += b'\x00\x00\x00\x00'
            else:
                row += bytes((
                    min(255, ar // aa),
                    min(255, ag // aa),
                    min(255, ab // aa),
                    min(255, aa // n),
                ))
        rows.append(bytes(row))
    return b''.join(b'\x00' + r for r in rows)


def write_png(path: str) -> None:
    raw = zlib.compress(render(), 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', raw) + chunk(b'IEND', b''))


if __name__ == '__main__':
    import os
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else 'icon-source.png'
    write_png(out)
    print(f'{out} {os.path.getsize(out)} bytes {S}x{S}')
