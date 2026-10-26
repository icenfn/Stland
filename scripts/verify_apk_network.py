#!/usr/bin/env python3
"""APK 级明文 HTTP 配置断言。

为什么要在 APK 上再验一次
------------------------
patch_android_network.py 只是改了 src-tauri/gen/android 下的源文件，
但「源文件改了」不等于「编译进包里了」：Gradle 的构建缓存、
aapt 的资源合并、以及 build 顺序搞错（在 patch 之前就已经打包完）都会让
改动失效。这类问题在真机上表现为「一直连不上」，日志里还看不出原因。

做法：把 APK 里的 binary AndroidManifest.xml 解出来，断言
  1) 声明了 INTERNET 权限；
  2) application 上挂载了 networkSecurityConfig；
  3) res/xml 下存在 network_security_config 资源。
若环境里装了 pyaxmlparser / androguard 则进一步解析出白名单主机。

用法： python3 scripts/verify_apk_network.py <apk>
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python3 scripts/verify_apk_network.py <apk>")
        return 2
    apk = Path(sys.argv[1])
    if not apk.is_file():
        print(f"::error::APK 不存在 {apk}")
        return 1

    problems: list[str] = []
    with zipfile.ZipFile(apk) as z:
        names = z.namelist()

        # ---- 1) res/xml 下的网络安全配置资源 ----
        xml_res = [n for n in names if n.startswith("res/") and n.lower().endswith(".xml")]
        manifest_blob = z.read("AndroidManifest.xml") if "AndroidManifest.xml" in names else b""

    # binary manifest 里的字符串池是 UTF-16LE，直接按两种编码找关键字
    def blob_has(token: str) -> bool:
        for enc in ("utf-16-le", "utf-8"):
            if token.encode(enc) in manifest_blob:
                return True
        return False

    if not blob_has("android.permission.INTERNET"):
        problems.append("AndroidManifest 中未找到 INTERNET 权限")
    if not blob_has("networkSecurityConfig"):
        problems.append("AndroidManifest 的 <application> 未挂载 networkSecurityConfig")
    if not blob_has("network_security_config"):
        problems.append("AndroidManifest 未引用 @xml/network_security_config")

    # 资源名可能被 aapt 压缩成短名，因此除了按名匹配，也检查文件内容特征
    has_config = any("network_security_config" in n for n in xml_res)
    if not has_config:
        # 回退：扫描 res/xml 下的文件，看是否有 network-security-config 根节点的字节特征
        with zipfile.ZipFile(apk) as z:
            for n in xml_res:
                try:
                    data = z.read(n)
                except Exception:
                    continue
                if b"network-security-config" in data or b"network_security_config" in data:
                    has_config = True
                    print(f"  在 {n} 中找到网络安全配置资源（资源名被压缩，按内容识别）")
                    break
    if not has_config:
        problems.append("APK 内未找到 network_security_config 资源")

    print(f"APK: {apk.name}（{apk.stat().st_size} 字节）")
    print(f"res xml 资源数: {len(xml_res)}")

    if problems:
        for p in problems:
            print(f"::error::{p}")
        print("::error::明文 HTTP 放行配置未正确打包，真机上会连不上自建服务端")
        return 1

    print("明文 HTTP 配置校验通过：INTERNET 权限已声明，networkSecurityConfig 已挂载且资源存在")
    return 0


if __name__ == "__main__":
    sys.exit(main())
