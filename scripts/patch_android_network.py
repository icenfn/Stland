#!/usr/bin/env python3
"""为 Android 包放行明文 HTTP，并补齐 INTERNET 权限。

为什么必须做这件事
------------------
默认地址是 `http://139.196.225.114:8999`（自建服务端，无 TLS 证书）。
Android 9（API 28）起默认 `cleartextTrafficPermitted=false`，
未声明放行时所有 http 请求直接在系统层被拦截，表现为：
页面能打开，但登录一直提示「无法连接服务端」—— 而且在 WebView 里
看不到任何有用的错误，极难定位。

放行范围
--------
不用 `android:usesCleartextTraffic="true"` 这种全局开关，而是提供
`network_security_config.xml`，只对**指定的服务器 IP** 放行明文，
其余域名仍强制 HTTPS。这样即使将来接入第三方 HTTPS 接口，
也不会因为一个全局开关把安全基线整体拉低。

幂等性
------
`tauri android init` 每次都会按模板重新生成 AndroidManifest.xml，
所以本脚本在 CI 里 init 之后运行；重复执行不会产生重复节点
（已有 networkSecurityConfig 或 usesCleartextTraffic 则跳过）。
"""
from __future__ import annotations

import pathlib
import re
import sys

APP_DIR = pathlib.Path("src-tauri/gen/android/app/src/main")
MANIFEST = APP_DIR / "AndroidManifest.xml"
RES_XML = APP_DIR / "res" / "xml"
NSC = RES_XML / "network_security_config.xml"

# 允许明文访问的主机（与服务端地址保持同步）
CLEARTEXT_HOSTS = ["139.196.225.114", "localhost", "127.0.0.1", "10.0.2.2"]

NSC_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<!--
  网络安全配置：默认强制 HTTPS，仅对自建服务端放行明文 HTTP。
  新增服务器地址时在此追加 <domain>，不要在清单里开全局 usesCleartextTraffic。
-->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
{domains}
    </domain-config>
</network-security-config>
"""


def main() -> int:
    if not MANIFEST.exists():
        print(f"::error::未找到 {MANIFEST}", file=sys.stderr)
        return 1

    xml = MANIFEST.read_text(encoding="utf-8")

    # 1) 写 network_security_config.xml
    RES_XML.mkdir(parents=True, exist_ok=True)
    domains = "\n".join(f'        <domain includeSubdomains="false">{h}</domain>' for h in CLEARTEXT_HOSTS)
    NSC.write_text(NSC_TEMPLATE.format(domains=domains), encoding="utf-8")
    print(f"已写入 {NSC}（放行: {', '.join(CLEARTEXT_HOSTS)}）")

    # 2) INTERNET 权限（Tauri 模板通常已包含，缺失时补上）
    if "android.permission.INTERNET" not in xml:
        xml = xml.replace(
            "<application",
            '<uses-permission android:name="android.permission.INTERNET" />\n\n    <application',
            1,
        )
        print("已补充 INTERNET 权限")

    # 3) <application> 上挂 networkSecurityConfig
    if "networkSecurityConfig" not in xml:
        m = re.search(r"<application\b[^>]*?(\s*)/?>", xml, re.S)
        if not m:
            print("::error::AndroidManifest 中未找到 <application> 节点", file=sys.stderr)
            return 1
        tag = m.group(0)
        if tag.rstrip().endswith("/>"):
            new_tag = tag.rstrip()[:-2].rstrip() + ' android:networkSecurityConfig="@xml/network_security_config" />'
        else:
            new_tag = tag.rstrip()[:-1].rstrip() + ' android:networkSecurityConfig="@xml/network_security_config" >'
        xml = xml.replace(tag, new_tag, 1)
        print("已在 <application> 上挂载 networkSecurityConfig")
    else:
        print("networkSecurityConfig 已存在，跳过")

    MANIFEST.write_text(xml, encoding="utf-8")

    # 4) 复核：这三项缺一不可，缺了说明补丁没生效，直接让构建失败
    check = MANIFEST.read_text(encoding="utf-8")
    missing = []
    if "networkSecurityConfig" not in check:
        missing.append("networkSecurityConfig")
    if "android.permission.INTERNET" not in check:
        missing.append("INTERNET")
    if missing:
        print(f"::error::清单校验失败，缺少: {', '.join(missing)}", file=sys.stderr)
        print(check[:2000], file=sys.stderr)
        return 1
    print("清单校验通过：INTERNET + networkSecurityConfig 均已就位")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
