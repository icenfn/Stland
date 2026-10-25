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

连接服务端：复制 `.env.example` 为 `.env`，把 `VITE_API_BASE` 指向服务端地址。

```bash
VITE_API_BASE=http://127.0.0.1:8999
```

## 构建 APK（arm64）

```bash
npm run android:init    # 首次：生成 src-tauri/gen/android
npm run android:build   # 产出 app-universal-release.apk
```

CI 已内置同流程：`.github/workflows/android.yml` 在打 tag（`v*`）时自动构建并把 APK 附到 Release。

### 签名配置

仓库**不含**任何签名物料（`*.jks` / `keystore.properties` 已加入 `.gitignore`）。CI 通过以下 Secrets 注入：

| Secret | 说明 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i release.jks` 的输出 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥口令 |
| `ANDROID_STORE_PASSWORD` | keystore 口令 |

缺失时工作流会降级为 debug 签名并打印警告 —— 仅可直接安装，不可对外分发。

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
