#!/usr/bin/env python3
"""把 src-tauri/icons/android 下的图标覆盖进 gen/android 的 res 目录。

为什么需要这一步：
  `tauri android init` 生成脚手架时不会用 tauri.conf.json 的 bundle.icon，
  也不读 src-tauri/icons/android，而是写入模板自带的默认图标。
  结果就是：仓库里图标早已换成自己的，APK 装到手机上显示的却还是
  Tauri 那个黄青色双环 logo —— 用户反馈的「图标没有改」正是这个原因。

  这里在 init 之后、build 之前把我们的 mipmap-* 覆盖过去，
  确保 aapt 编译进去的是自己的图标。

用法： python3 scripts/apply_android_icons.py
退出码： 0 成功；1 找不到源图标或目标工程
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src-tauri" / "icons" / "android"
RES = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"

# 启动图标必须齐全，否则桌面上会退回系统默认机器人图标
REQUIRED_DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]
REQUIRED_NAMES = ["ic_launcher.png", "ic_launcher_round.png"]


def main() -> int:
    if not SRC.is_dir():
        print(f"::error::找不到源图标目录 {SRC}")
        return 1
    if not RES.parent.is_dir():
        print(f"::error::找不到 Android 工程 {RES.parent}（是否忘了 tauri android init）")
        return 1

    # 覆盖前先自证源图标是齐的，避免「复制了个空目录也报成功」
    missing = []
    for d in REQUIRED_DENSITIES:
        for n in REQUIRED_NAMES:
            p = SRC / f"mipmap-{d}" / n
            if not p.is_file():
                missing.append(str(p.relative_to(ROOT)))
    if missing:
        print("::error::源图标缺失：\n  " + "\n  ".join(missing))
        return 1

    copied: list[str] = []
    for src_file in sorted(SRC.rglob("*")):
        if not src_file.is_file():
            continue
        rel = src_file.relative_to(SRC)
        dst = RES / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_file, dst)
        copied.append(str(rel))

    print(f"已覆盖 {len(copied)} 个图标文件到 {RES.relative_to(ROOT)}")
    for c in copied:
        print(f"  {c}")

    # 复核：逐个密度确认落盘后的字节数与源一致
    bad = []
    for d in REQUIRED_DENSITIES:
        for n in REQUIRED_NAMES:
            s = SRC / f"mipmap-{d}" / n
            t = RES / f"mipmap-{d}" / n
            if not t.is_file() or t.stat().st_size != s.stat().st_size:
                bad.append(f"mipmap-{d}/{n}")
    if bad:
        print("::error::覆盖后校验失败：" + ", ".join(bad))
        return 1

    print("图标覆盖校验通过：5 个密度 × ic_launcher/ic_launcher_round 均与源一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
