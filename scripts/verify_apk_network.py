#!/usr/bin/env python3
"""APK 级明文 HTTP 配置断言。

为什么要在 APK 上再验一次
------------------------
patch_android_network.py 只改了 src-tauri/gen/android 下的源文件，
但「源文件改了」不等于「编译进包里了」：Gradle 构建缓存、aapt 资源合并、
以及 build 顺序搞错（patch 之前就已打包完）都会让改动静默失效。
这类问题在真机上表现为「一直连不上」，日志里还看不出原因。

上一版校验有个真实教训
----------------------
最初我用「在 AndroidManifest.xml 字节里搜 '@xml/network_security_config'」判断。
这是错的：清单在 APK 内是 binary XML，属性值若是资源引用，存的是资源 ID 整数，
不会出现 '@xml/...' 这个字符串。于是配置明明正确，校验却报"未引用"，属于误报。

现在改为两层判定：
  1) 首选调用 Android 官方 `aapt2 dump xmltree`（结论权威，由 Google 的工具解析）；
  2) 无 aapt2 时退化为纯 Python 的 binary AXML 解析，直接读 START_ELEMENT 的属性
     判断 <application> 上是否挂了 networkSecurityConfig，且其值确为资源引用(0x01)。
两种方式都不再依赖 '@xml/...' 字面量。

用法：
  python3 scripts/verify_apk_network.py <apk> [--aapt2 /path/to/aapt2]
环境变量 AAPT2 亦可指定。
"""
from __future__ import annotations

import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

# 引用的资源类型标记（Res_value.dataType）
TYPE_REFERENCE = 0x01
TYPE_STRING = 0x03
ANDROID_NS = "http://schemas.android.com/apk/res/android"


# --------------------------------------------------------------------------
# 极简 binary AXML 解析：只做本校验需要的事（读字符串池 + 元素属性）
# --------------------------------------------------------------------------
class AXML:
    def __init__(self, data: bytes):
        self.data = data
        self.strings: list[str] = []
        self.elements: list[tuple[str, list[tuple[str, int, int]]]] = []
        self._parse()

    def _parse(self) -> None:
        d = self.data
        if len(d) < 8 or struct.unpack_from("<H", d, 0)[0] != 0x0003:
            raise ValueError("不是 binary XML（缺少 RES_XML_TYPE 头）")
        off = struct.unpack_from("<H", d, 2)[0]  # header size
        total = struct.unpack_from("<I", d, 4)[0]
        end = min(total, len(d))

        while off + 8 <= end:
            ctype, hsize, csize = struct.unpack_from("<HHI", d, off)
            if csize <= 0 or off + csize > end:
                break
            if ctype == 0x0001:          # STRING_POOL
                self._parse_string_pool(off, hsize, csize)
            elif ctype == 0x0102:        # START_ELEMENT
                self._parse_start_element(off, hsize, csize)
            off += csize

    def _parse_string_pool(self, off: int, hsize: int, csize: int) -> None:
        d = self.data
        count, _style_count, flags, strings_start, _styles_start = struct.unpack_from(
            "<IIIII", d, off + 8
        )
        utf8 = bool(flags & 0x100)
        base = off + strings_start
        for i in range(count):
            p = struct.unpack_from("<I", d, off + hsize + i * 4)[0]
            pos = base + p
            if pos >= off + csize:
                self.strings.append("")
                continue
            if utf8:
                # 先 1~2 字节 utf16 字符数，再 1~2 字节字节数
                n = d[pos]
                pos += 2 if n & 0x80 else 1
                blen = d[pos]
                if blen & 0x80:
                    blen = ((blen & 0x7F) << 8) | d[pos + 1]
                    pos += 2
                else:
                    pos += 1
                self.strings.append(d[pos : pos + blen].decode("utf-8", "replace"))
            else:
                n = struct.unpack_from("<H", d, pos)[0]
                pos += 2
                if n & 0x8000:
                    n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", d, pos)[0]
                    pos += 2
                self.strings.append(d[pos : pos + n * 2].decode("utf-16-le", "replace"))

    def _str(self, idx: int) -> str:
        if idx == 0xFFFFFFFF or idx < 0 or idx >= len(self.strings):
            return ""
        return self.strings[idx]

    def _parse_start_element(self, off: int, hsize: int, csize: int) -> None:
        d = self.data
        _line, _comment, _ns, name_idx = struct.unpack_from("<IIII", d, off + 8)
        attr_start, attr_size, attr_count = struct.unpack_from("<HHH", d, off + 24)
        name = self._str(name_idx)

        attrs: list[tuple[str, int, int]] = []   # (属性名, 类型, 原始数据)
        # 属性起点相对 ResXMLTree_attrExt 结构：
        #   chunk header 8 + node 的 lineNumber/comment 8 = 16，
        #   attrExt 自身以 ns(4)/name(4) 开头，随后才是 attributeStart 偏移。
        # 这里若写成 off + 8 + attr_start 会整体错位 8 字节，
        # 读到的是垃圾属性 —— 表现为「配置明明正确却报未声明」的误报。
        apos = off + 16 + attr_start
        for i in range(attr_count):
            p = apos + i * attr_size
            if p + 20 > off + csize:
                break
            _ans, aname, _raw, _vsize, _res0, dtype, vdata = struct.unpack_from(
                "<IIIHBBI", d, p
            )
            attrs.append((self._str(aname), dtype, vdata))
        self.elements.append((name, attrs))

    # ---- 语义查询 ----
    def has_internet_permission(self) -> bool:
        for name, attrs in self.elements:
            if name != "uses-permission":
                continue
            for aname, dtype, vdata in attrs:
                if aname == "name" and dtype == TYPE_STRING and self._str(vdata) == "android.permission.INTERNET":
                    return True
        return False

    def application_network_config(self) -> tuple[bool, bool]:
        """返回 (是否挂载 networkSecurityConfig, 值是否为资源引用)"""
        for name, attrs in self.elements:
            if name != "application":
                continue
            for aname, dtype, _vdata in attrs:
                if aname == "networkSecurityConfig":
                    return True, dtype == TYPE_REFERENCE
        return False, False


def find_aapt2(explicit: str | None) -> str | None:
    if explicit:
        return explicit if Path(explicit).is_file() else None
    env = os.environ.get("AAPT2")
    if env and Path(env).is_file():
        return env
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        bt = Path(sdk) / "build-tools"
        if bt.is_dir():
            for ver in sorted(bt.iterdir(), reverse=True):
                p = ver / "aapt2"
                if p.is_file():
                    return str(p)
    return shutil.which("aapt2")


def check_with_aapt2(apk: Path, aapt2: str) -> tuple[bool, bool, bool, str]:
    """用 Google 官方 aapt2 解析清单树。返回 (internet, has_attr, is_ref, 摘要)"""
    # aapt2 各版本对选项位置容忍度不同：有的要求 --file 在 APK 之前，有的在之后。
    # 两种顺序都试，避免因构建机版本差异把正确配置误判成失败。
    orders = [
        [aapt2, "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk)],
        [aapt2, "dump", "xmltree", str(apk), "--file", "AndroidManifest.xml"],
    ]
    out = None
    errs = []
    for cmd in orders:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            out = r
            break
        errs.append(r.stderr.strip()[:200])
    if out is None:
        raise RuntimeError("aapt2 两种调用顺序均失败: " + " | ".join(e for e in errs if e))
    text = out.stdout
    internet = "android.permission.INTERNET" in text
    has_attr, is_ref = False, False
    for line in text.splitlines():
        if "networkSecurityConfig" in line:
            has_attr = True
            # aapt2 输出形如：...:networkSecurityConfig(0x01010527)=@0x7f0f0000
            if re.search(r"=@0x[0-9a-fA-F]+", line):
                is_ref = True
            break
    return internet, has_attr, is_ref, "aapt2 dump xmltree"


def check_with_parser(apk: Path) -> tuple[bool, bool, bool, str]:
    with zipfile.ZipFile(apk) as z:
        raw = z.read("AndroidManifest.xml")
    ax = AXML(raw)
    internet = ax.has_internet_permission()
    has_attr, is_ref = ax.application_network_config()
    return internet, has_attr, is_ref, f"内置 AXML 解析（{len(ax.elements)} 个元素）"


def has_network_config_resource(apk: Path) -> tuple[bool, str, list[str]]:
    """确认 APK 内含 network-security-config 资源，并返回其中出现的明文主机。

    资源名可能被 aapt 压缩成短名（如 res/8G.xml），所以按文件内容识别根节点，
    不按文件名匹配。域名白名单在 binary XML 的字符串池里是明文，可直接检出。
    """
    with zipfile.ZipFile(apk) as z:
        for n in z.namelist():
            if not (n.startswith("res/") and n.lower().endswith(".xml")):
                continue
            try:
                data = z.read(n)
            except Exception:
                continue
            if b"network-security-config" in data or b"network_security_config" in data:
                hosts = re.findall(rb"\d{1,3}(?:\.\d{1,3}){3}", data)
                return True, n, sorted({h.decode() for h in hosts})
    return False, "", []


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    explicit = None
    for a in sys.argv[1:]:
        if a.startswith("--aapt2="):
            explicit = a.split("=", 1)[1]
    if not args:
        print("用法: python3 scripts/verify_apk_network.py <apk> [--aapt2=/path/to/aapt2]")
        return 2
    apk = Path(args[0])
    if not apk.is_file():
        print(f"::error::APK 不存在 {apk}")
        return 1

    aapt2 = find_aapt2(explicit)
    try:
        if aapt2:
            internet, has_attr, is_ref, how = check_with_aapt2(apk, aapt2)
        else:
            internet, has_attr, is_ref, how = check_with_parser(apk)
    except Exception as e:
        print(f"::warning::首选解析方式失败（{e}），改用内置解析")
        internet, has_attr, is_ref, how = check_with_parser(apk)

    res_ok, res_name, hosts = has_network_config_resource(apk)

    print(f"APK: {apk.name}（{apk.stat().st_size} 字节）")
    print(f"清单解析方式: {how}")
    print(f"  INTERNET 权限          : {'✓' if internet else '✗'}")
    print(f"  networkSecurityConfig  : {'✓' if has_attr else '✗'}"
          f"{'（值为资源引用）' if is_ref else '' if not has_attr else '（值不是资源引用）'}")
    print(f"  网络安全配置资源        : {'✓ ' + res_name if res_ok else '✗'}")
    if hosts:
        print(f"  放行明文主机            : {', '.join(hosts)}")

    problems = []
    if not internet:
        problems.append("AndroidManifest 未声明 INTERNET 权限")
    if not has_attr:
        problems.append("<application> 未挂载 android:networkSecurityConfig")
    elif not is_ref:
        problems.append("networkSecurityConfig 的值不是资源引用，配置可能未生效")
    if not res_ok:
        problems.append("APK 内未找到 network-security-config 资源")

    if problems:
        for p in problems:
            print(f"::error::{p}")
        print("::error::明文 HTTP 放行配置未正确打包，真机上会连不上自建服务端")
        return 1

    print("明文 HTTP 配置校验通过：权限已声明、networkSecurityConfig 已挂载为资源引用、对应资源存在")
    return 0


if __name__ == "__main__":
    sys.exit(main())
