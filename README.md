# Stland 股岛 · 客户端

Tauri 2 + Vue 3 + TypeScript 构建的移动端交易终端。**不含任何外部行情数据源**，行情、撮合、账务全部来自配套的 [Stland-server](https://github.com/icenfn/Stland-server)。

## 三种形态

| 角色 | 入口 | 能力 |
| --- | --- | --- |
| 零售 `retail` | 首页 / 行情 / 交易 / 资产 / 我的 | 五档盘口、限价与市价委托、T+1 申赎、业绩曲线 |
| 机构 `institution` | 追加 `/institution` | 组合 β、融资额度、批量市价单、持仓集中度 |
| 管理 `admin` | 追加 `/admin` | 平台 KPI、撮合质量、用户冻结与资金调整、审计日志、日终结转 |

角色能力由 `src/stores/auth.ts` 的权限矩阵裁决，路由守卫在 `src/router.ts` 拦截越权访问。

## 目录结构

```
src/
  api/            http 客户端（签名头 + 401 自动刷新）、接口定义、类型
  components/     AppBar / TabBar / QuoteRow / MiniChart / ChangePill
  composables/    useImmersive（沉浸式状态栏尺寸校正）
  stores/         auth（会话 + 能力）、market（行情轮询 1.5s）
  styles/         global.css 设计令牌、immersive.css 安全区
  views/          10 个页面，含 institution/ 与 admin/ 子目录
src-tauri/
  src/main.rs     桌面与移动共用的入口
  src/lib.rs      窗口创建 + 系统栏高度注入（--status-bar-height）
  capabilities/   Tauri 2 权限声明
  tauri.conf.json CSP / 窗口尺寸 / APK 打包目标
```

## 本地开发

```bash
npm install
npm run dev            # 浏览器预览（http://localhost:1420）
npm run tauri dev      # 原生壳调试
```

## 请求层：AlovaJS + 统一签名

所有请求经由一个 AlovaJS 实例发出（`src/api/http.ts`），签名、令牌注入、401 统一登出全部收敛在 `beforeRequest` 这一个出口：

- 适配器为 `alova/fetch`。**注意**：v3 已移除旧的 `alova/GlobalFetch` 入口，误用会让 Vite 报 `Missing "./GlobalFetch" specifier` 并直接构建失败。
- 关闭了 Alova 对 GET 的默认缓存（`cacheFor: { GET: 0 }`），行情与账户必须实时。
- 签名是纯函数模块（`src/api/sign.ts`），不依赖任何库，可独立在 Node 中与服务端对拍：

```
签名原文 = METHOD \n PATH \n TS \n NONCE \n SHA256(BODY) \n USER_ID
X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文)
```

`PATH` 必须**不含查询串**（与 FastAPI 的 `request.url.path` 对齐）。已验证：篡改签名与重放 nonce 均返回 `400 BAD_SIGNATURE`。

## UI：Naive UI 主题对齐

`src/App.vue` 用 `n-config-provider` 注入 `darkTheme` 与 `GlobalThemeOverrides`，把 Naive UI 的令牌映射到 `global.css` 的设计变量，避免「深色页面弹出亮白对话框」的割裂。

`src/components/NaiveBridge.vue` 在 Provider 子树内取到 `useMessage` / `useDialog` 并交给 `src/naive.ts` 的 `feedback`，于是 store、api 层、路由守卫等非组件代码也能统一走 Naive UI 的提示与二次确认（`window.confirm` 已全部替换）。

## 连接服务端：配置文件

「这个客户端连哪台服务器」写在仓库内的 `src/config/app.config.json`，由 `src/config/index.ts` 统一读取并对外导出 `apiConfig`。不再是只藏在构建机环境变量里的隐式约定。

```json
{
  "app": { "name": "Stland 股岛", "version": "1.0.0" },
  "api": {
    "baseUrl": "http://139.196.225.114:8999",
    "timeoutMs": 15000,
    "signature": { "enabled": false, "secret": "dev-sign-secret-stland" },
    "polling": { "marketMs": 1500, "accountMs": 5000 }
  }
}
```

优先级：`VITE_API_BASE` 环境变量 **>** `app.config.json` 的 `api.baseUrl`。环境变量仅作临时覆盖（CI / 本地联调），默认地址一律以配置文件为准，便于追溯「这个包连的是哪台机器」。

三个需要留意的点：

- `signature.enabled`：服务端 `STLAND_SIGNATURE_REQUIRED=false` 时置 `false`，否则每个请求都要带 `X-Stland-Sign`，密钥不一致会导致写接口全部返回 `400 BAD_SIGNATURE`。
- `timeoutMs`：超时后抛 `ApiError(timeout)`，页面提示「网络超时」而不是无限转圈。
- 「我的」页展示 `serverLabel`（去掉协议头的地址），方便用户自查当前连的是哪台服务器。

`.env.example` 中所有变量均已注释，属可选覆盖项。

## 构建 APK（arm64）

```bash
npm run android:init    # 首次：生成 src-tauri/gen/android
npm run android:build   # 产出 app-universal-release.apk
```

CI 已内置同流程：`.github/workflows/android.yml` 在打 tag（`v*`）时自动构建并把 APK 附到 Release。

### 签名配置

签名采用 **APK 层重签**，而不是修改 `tauri android init` 生成的 Gradle 脚本：

```
tauri android build --apk  →  zipalign -p 4  →  apksigner sign (v1+v2+v3)  →  apksigner verify
```

原因：`app/build.gradle.kts` 由 CLI 生成，文本结构随版本变化，向其中注入 `signingConfigs`
属于脆弱做法（实测因插入位置导致 Kotlin 脚本 8 处编译错误）。`zipalign` + `apksigner`
是 Android 官方确定性流程，与模板结构无关，且产物可被 `apksigner verify` 直接核验。

仓库**不含**任何签名物料（`*.jks` / `keystore.properties` 已加入 `.gitignore`）。CI 通过以下 Secrets 注入：

| Secret | 说明 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i release.jks` 的输出 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥口令 |
| `ANDROID_STORE_PASSWORD` | keystore 口令 |

缺失时工作流会**现场生成一次性调试密钥**完成签名（未签名 APK 无法安装，直接产出未签名包等于交付废件），
产物名带 `-debug` 后缀并打印警告 —— 仅可直接安装，不可对外分发。

本地生成一套自用密钥：

```bash
keytool -genkeypair -v -keystore release.jks -alias stland \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 你的口令 -keypass 你的口令 -dname "CN=Stland"
base64 -i release.jks | pbcopy   # 粘贴到 ANDROID_KEYSTORE_BASE64
```

## 设计约定

- **暗色单主题**：交易场景长时间盯盘，亮色背景在弱光下刺眼，因此不做主题切换。
- **涨红跌绿**：遵循 A 股习惯，`--c-up` 红、`--c-down` 绿。
- **等宽数字**：所有报价与金额使用 `.tabular`（`font-variant-numeric: tabular-nums`），避免轮询刷新时数字跳动。
- **刷新节奏**：行情 1.5s、账户 5s；离开页面即停轮询，避免后台耗电。

## 免责声明

本项目为教学与工程演示用途，内置行情由本地随机过程模拟生成，与任何真实标的价格无关，**不构成投资建议**。
