#!/usr/bin/env python3
"""APK 级图标断言：解包实证「包里的启动图标就是我们的那张」。

为什么不能只检查文件是否存在
----------------------------
上一版就是栽在这里：src-tauri/icons/icon.png 早换成了新图标，
CI 里「图标文件存在」的检查一路绿灯，可 APK 里躺着的仍是 Tauri 默认图标
（因为 tauri android init 用模板图标、不读 icons/android）。
「文件存在」和「真正打进包里」是两件事。

做法
----
1. 取 src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png 作为标准答案，
   归一化到 32×32 取 RGB 签名（抗缩放、抗 aapt 重编码）；
2. 解包 APK 内所有 res/*.png，逐个算同尺度签名并求平均绝对差；
3. 最小差值仍大于阈值 → 说明自家图标根本没进包，exit 1。

用法： python3 scripts/verify_apk_icon.py <apk>
"""
from __future__ import annotations

import sys
import zipfile
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("::error::需要 Pillow：python3 -m pip install pillow")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "src-tauri" / "icons" / "android" / "mipmap-xxxhdpi" / "ic_launcher.png"

SIG = 32
# 同一张图经 aapt 重编码/缩放后，平均绝对差通常 < 0.02；
# 不同图（哪怕都是「一个图标」）普遍 > 0.15。取 0.06，两侧都留足裕度。
MAX_DIFF = 0.06


def signature(im: "Image.Image") -> list[tuple[int, int, int]]:
    small = im.convert("RGBA").resize((SIG, SIG), Image.LANCZOS)
    return [p[:3] for p in list(small.getdata())]


def mean_abs_diff(a, b) -> float:
    total = 0
    for x, y in zip(a, b):
        total += abs(x[0] - y[0]) + abs(x[1] - y[1]) + abs(x[2] - y[2])
    return total / (len(a) * 3 * 255)


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python3 scripts/verify_apk_icon.py <apk>")
        return 2
    apk = Path(sys.argv[1])
    if not apk.is_file():
        print(f"::error::APK 不存在 {apk}")
        return 1
    if not REF.is_file():
        print(f"::error::缺少参考图标 {REF}")
        return 1

    ref_sig = signature(Image.open(REF))
    print(f"参考图标: {REF.relative_to(ROOT)}")

    best = None  # (diff, name, size)
    checked = 0
    with zipfile.ZipFile(apk) as z:
        for name in z.namelist():
            if not (name.startswith("res/") and name.lower().endswith(".png")):
                continue
            try:
                im = Image.open(BytesIO(z.read(name)))
                size = im.size
                d = mean_abs_diff(signature(im), ref_sig)
            except Exception:
                continue
            checked += 1
            if best is None or d < best[0]:
                best = (d, name, size)

    if best is None:
        print("::error::APK 内没有任何 res png，无法校验图标")
        return 1

    d, name, size = best
    print(f"扫描 {checked} 张 res png，最相似：{name} {size[0]}×{size[1]} diff={d:.4f}（阈值 {MAX_DIFF}）")

    if d > MAX_DIFF:
        print("::error::APK 内未找到自家启动图标 —— 大概率仍是 Tauri 模板默认图标。")
        print("::error::请确认 scripts/apply_android_icons.py 在 build 之前执行过。")
        return 1

    print("图标校验通过：APK 内启动图标与仓库图标一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
