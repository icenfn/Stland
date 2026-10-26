#!/usr/bin/env python3
"""把 src-tauri/icons/android 的图标覆盖进 gen/android 的 res 目录。

为什么必须单独做这一步
----------------------
`tauri android init` 生成 Android 脚手架时，用的是**模板自带的默认图标**：
它既不读 tauri.conf.json 的 bundle.icon，也不读 src-tauri/icons/android。
所以即使 `tauri icon` 已经把新图标生成到 icons/android 下，直接
`tauri android build` 打出来的 APK 里仍会显示 Tauri 那个默认 logo。

必须等 init 之后、build 之前，把图标显式覆盖到
  src-tauri/gen/android/app/src/main/res/mipmap-*/
才能让 aapt 编译进自己的图标。

用法： python3 scripts/apply_android_icons.py
退出码： 0 成功；1 源图标不全 / 目标工程不存在 / 覆盖后不一致
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src-tauri" / "icons" / "android"
RES = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"

# 启动图标必须齐全：缺一个密度，对应机型就会退回系统默认机器人图标
DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]
LAUNCHER_NAMES = ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]


def main() -> int:
    if not SRC.is_dir():
        print(f"::error::找不到源图标目录 {SRC}（先跑 npm run icons）")
        return 1
    if not RES.parent.is_dir():
        print(f"::error::找不到 Android 工程 {RES.parent}（先跑 tauri android init）")
        return 1

    # 先自证源图标齐全，避免「复制了半个目录也报成功」
    missing = [
        str((SRC / f"mipmap-{d}" / n).relative_to(ROOT))
        for d in DENSITIES
        for n in LAUNCHER_NAMES
        if not (SRC / f"mipmap-{d}" / n).is_file()
    ]
    if missing:
        print("::error::源图标缺失：\n  " + "\n  ".join(missing))
        return 1

    copied = 0
    for src_file in sorted(SRC.rglob("*")):
        if not src_file.is_file():
            continue
        dst = RES / src_file.relative_to(SRC)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_file, dst)
        copied += 1

    print(f"已覆盖 {copied} 个图标文件 → {RES.relative_to(ROOT)}")

    # 复核落盘字节数，确保没有「写入被截断」这类静默失败
    bad = [
        f"mipmap-{d}/{n}"
        for d in DENSITIES
        for n in LAUNCHER_NAMES
        if (RES / f"mipmap-{d}" / n).stat().st_size != (SRC / f"mipmap-{d}" / n).stat().st_size
    ]
    if bad:
        print("::error::覆盖后校验失败：" + ", ".join(bad))
        return 1

    # 清掉 mipmap-anydpi-v26 下的 adaptive-icon 引用问题：
    # tauri icon 生成的 foreground/background 已按规范分好，
    # 这里只报告它们的存在，方便在日志里核对
    anydpi = sorted(p.name for p in (RES / "mipmap-anydpi-v26").glob("*.xml")) if (RES / "mipmap-anydpi-v26").is_dir() else []
    print(f"adaptive-icon 资源：{anydpi or '（无，将使用位图图标）'}")
    print(f"覆盖校验通过：{len(DENSITIES)} 个密度 × {len(LAUNCHER_NAMES)} 个图标均与源一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
