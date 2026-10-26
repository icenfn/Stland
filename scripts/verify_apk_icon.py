#!/usr/bin/env python3
"""APK 级图标断言：解包比对，确认包内启动图标真的是自己的那张。

为什么不能只查文件存在：
  v1.0.0 那次构建里 src-tauri/icons/icon.png 早就是新图标，
  CI 的「Verify app icons」也只检查文件在不在，一路绿灯；
  但 tauri android init 生成的脚手架用的是模板默认图标，
  最终 APK 里躺的还是 Tauri 的黄青双环。文件存在 ≠ 打进包里。

做法：
  1. 以 src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png 作为「标准答案」，
     缩到 32×32 取 RGB 签名（抗缩放、抗压缩差异）；
  2. 解包 APK 的 res/*.png，逐个算同尺寸签名并求平均绝对差；
  3. 最小差值仍大于阈值 → 说明自己的图标根本没进包，直接退出 1。

用法： python3 scripts/verify_apk_icon.py dist-apk/Stland-arm64.apk
"""
from __future__ import annotations

import sys
import zipfile
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("::error::需要 Pillow：pip install pillow")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "src-tauri" / "icons" / "android" / "mipmap-xxxhdpi" / "ic_launcher.png"
SIG = 32
# 同一张图经 aapt 重编码/缩放后差值通常在 0.02 以内；
# 不同图（哪怕都是「图标」）普遍 > 0.15。取 0.06 留出足够裕度。
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

    best: tuple[float, str, tuple[int, int]] | None = None
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
