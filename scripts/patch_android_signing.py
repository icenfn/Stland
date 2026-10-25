#!/usr/bin/env python3
"""把 keystore.properties 接入 Tauri 生成的 Android Gradle 项目。

为什么需要这一步：
`tauri android init` 生成的 app/build.gradle.kts 只声明了 debug 签名，
release 构建会退回 debug 签名（不可分发）。Tauri 2 没有提供「从环境变量
读取签名配置」的官方入口，因此必须在 init 之后对生成的 Gradle 文件做一次幂等补丁。

设计约束：
* **幂等**：重复执行不会重复插入（检测 keystore.properties 是否已被引用）；
* **可降级**：keystore.properties 不存在时保持 debug 签名，构建照常进行，
  只是产物不可对外分发 —— 这比直接失败更利于本地快速验证；
* **不改 Tauri 模板结构**：只在 import 区与 buildTypes 处插入最小片段。
"""
from __future__ import annotations

import pathlib
import sys

TARGET = pathlib.Path("src-tauri/gen/android/app/build.gradle.kts")
KEYSTORE_PROPS = pathlib.Path("src-tauri/gen/android/keystore.properties")

LOADER = """
import java.util.Properties
import java.io.FileInputStream

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}
"""

SIGNING_BLOCK = """
    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }
"""

RELEASE_SIGNING = (
    '            signingConfig = if (keystorePropertiesFile.exists()) '
    'signingConfigs.getByName("release") else signingConfigs.getByName("debug")\n'
)


def main() -> int:
    if not TARGET.exists():
        print(f"::error::未找到 {TARGET}，tauri android init 可能未成功", file=sys.stderr)
        return 1

    src = TARGET.read_text(encoding="utf-8")

    if "keystorePropertiesFile" in src:
        print("已存在签名配置，跳过")
        return 0

    has_keystore = KEYSTORE_PROPS.exists()

    # 1) 在第一个 import 之前插入 Properties 读取逻辑
    idx = src.find("import ")
    if idx < 0:
        print("::error::生成文件缺少 import 段，结构可能已变化", file=sys.stderr)
        return 1
    src = src[:idx] + LOADER.strip() + "\n\n" + src[idx:]

    # 2) 在 buildTypes 之前插入 signingConfigs
    if "buildTypes {" not in src:
        print("::error::生成文件缺少 buildTypes 段，结构可能已变化", file=sys.stderr)
        return 1
    src = src.replace("buildTypes {", SIGNING_BLOCK.strip() + "\n\n    buildTypes {", 1)

    # 3) release 构建类型绑定签名配置
    for anchor in ('getByName("release") {', 'getByName("release"){'):
        if anchor in src:
            src = src.replace(anchor, anchor + "\n" + RELEASE_SIGNING.rstrip(), 1)
            break
    else:
        print("::warning::未找到 release buildType，签名可能未生效", file=sys.stderr)

    TARGET.write_text(src, encoding="utf-8")
    print(f"gradle 签名配置已注入（keystore 存在={has_keystore}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
