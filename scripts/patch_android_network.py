#!/usr/bin/env python3
"""为 Android 工程放行明文 HTTP（仅限白名单主机），并确保声明 INTERNET 权限。

背景
----
自 Android 9 (API 28) 起，系统默认禁止明文 HTTP。Stland 服务端是自建的
http://139.196.225.114:8999，因此必须显式放行，否则请求会在系统层直接失败，
表现为「一直连不上」，且 WebView 里往往看不出真实原因。

只放行白名单
------------
不写 cleartextTrafficPermitted="true" 到 base-config（那等于全局放开明文），
而是用 domain-config 逐个主机放行：139.196.225.114 与本地回环/模拟器地址。
其余域名保持系统默认（禁止明文）。

用法： python3 scripts/patch_android_network.py
幂等：重复执行不会重复插入节点
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main"

# 与 src/config/app.config.json 的 android.cleartextHosts 保持一致
CLEARTEXT_HOSTS = ["139.196.225.114", "localhost", "127.0.0.1", "10.0.2.2"]

NETWORK_CONFIG = """<?xml version="1.0" encoding="utf-8"?>
<!-- 由 scripts/patch_android_network.py 生成，请勿手改 -->
<network-security-config>
    <!-- 默认仍禁止明文，只对下面列出的自建服务端放行 -->
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
{domains}
    </domain-config>
</network-security-config>
"""

ANDROID_NS = "http://schemas.android.com/apk/res/android"


def write_network_config(res_xml: Path) -> Path:
    res_xml.mkdir(parents=True, exist_ok=True)
    target = res_xml / "network_security_config.xml"
    domains = "\n".join(f'        <domain includeSubdomains="false">{h}</domain>' for h in CLEARTEXT_HOSTS)
    target.write_text(NETWORK_CONFIG.format(domains=domains), encoding="utf-8")
    return target


def patch_manifest(manifest: Path) -> list[str]:
    """补 INTERNET 权限并挂上 networkSecurityConfig。返回实际做过的改动列表。"""
    raw = manifest.read_text(encoding="utf-8")
    ET.register_namespace("android", ANDROID_NS)
    tree = ET.ElementTree(ET.fromstring(raw))
    root = tree.getroot()
    changes: list[str] = []

    # 1) INTERNET 权限（tauri init 的模板未必带上，缺了连网络都没法用）
    has_internet = any(
        el.tag == "uses-permission"
        and el.get(f"{{{ANDROID_NS}}}name") == "android.permission.INTERNET"
        for el in root.findall("uses-permission")
    )
    if not has_internet:
        perm = ET.Element("uses-permission")
        perm.set(f"{{{ANDROID_NS}}}name", "android.permission.INTERNET")
        # uses-permission 必须在 application 之前
        app_idx = list(root).index(root.find("application")) if root.find("application") is not None else len(list(root))
        root.insert(app_idx, perm)
        changes.append("添加 INTERNET 权限")

    # 2) application 挂 networkSecurityConfig
    app = root.find("application")
    if app is None:
        print("::error::AndroidManifest.xml 中找不到 <application>")
        raise SystemExit(1)
    if app.get(f"{{{ANDROID_NS}}}networkSecurityConfig") != "@xml/network_security_config":
        app.set(f"{{{ANDROID_NS}}}networkSecurityConfig", "@xml/network_security_config")
        changes.append("挂载 networkSecurityConfig")

    # 3) usesCleartextTraffic 保持不显式开启（由 xml 精确控制），
    #    若模板写死了 true 则移除，避免全局放开
    if app.get(f"{{{ANDROID_NS}}}usesCleartextTraffic") == "true":
        del app.attrib[f"{{{ANDROID_NS}}}usesCleartextTraffic"]
        changes.append("移除全局 usesCleartextTraffic=true（改由白名单控制）")

    if changes:
        tree.write(manifest, encoding="utf-8", xml_declaration=True)
    return changes


def main() -> int:
    if not GEN.is_dir():
        print(f"::error::找不到 Android 工程 {GEN}（先跑 tauri android init）")
        return 1

    res_xml = GEN / "res" / "xml"
    target = write_network_config(res_xml)
    print(f"已写入 {target.relative_to(ROOT)}，放行主机：{', '.join(CLEARTEXT_HOSTS)}")

    manifest = GEN / "AndroidManifest.xml"
    if not manifest.is_file():
        print(f"::error::找不到 {manifest}")
        return 1
    changes = patch_manifest(manifest)
    if changes:
        for c in changes:
            print(f"  · {c}")
    else:
        print("  · AndroidManifest.xml 已是最新，无需改动（幂等）")

    print("Android 明文 HTTP 放行配置完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
