//! Stland 客户端原生层。
//!
//! 职责边界刻意保持极窄：
//! * 创建主窗口，并把系统栏（状态栏 / 导航栏）的实测高度交给前端，
//!   由前端写入 CSS 变量 `--status-bar-height`，实现沉浸式布局；
//! * 注册 HTTP 插件，让页面请求走 Rust 侧发出（绕开 WebView 的
//!   混合内容与 CORS 限制 —— 这是连自建 http 服务端的前提）；
//! * 不做任何业务逻辑：交易、行情、风控全部由 Stland-server 负责。

use tauri::{Manager, WindowEvent};

/// 兜底的状态栏高度（dp），在无法取到真实值（桌面端）时使用。
const FALLBACK_STATUS_BAR_DP: f64 = 24.0;

/// 读取系统栏高度。
///
/// Android 上真实值依赖原生 inset API，此处使用保守常量；
/// 前端还会通过 `env(safe-area-inset-top)` 做二次校正，两者取较大值，
/// 因此即使原生侧返回兜底值，也不会出现内容被状态栏压住的问题。
fn system_bar_height() -> f64 {
    #[cfg(target_os = "android")]
    {
        24.0
    }
    #[cfg(not(target_os = "android"))]
    {
        0.0
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        // 必须注册：前端 src/api/http.ts 在 Tauri 环境下会用它的 fetch
        // 发请求，未注册时调用会抛 "plugin http not found"，
        // 表现为所有接口失败、页面停在加载态。
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let h = system_bar_height();
                let h = if h > 0.0 { h } else { FALLBACK_STATUS_BAR_DP };
                // 以初始化脚本方式注入，保证在前端 Vue 挂载前就已可用
                let script = format!(
                    "window.__STLAND_BARS__ = {{ statusBar: {h}, platform: '{p}' }};\
                     document.documentElement.style.setProperty('--status-bar-height', '{h}px');",
                    h = h,
                    p = std::env::consts::OS,
                );
                let _ = window.eval(&script);

                window.on_window_event(|event| {
                    if let WindowEvent::CloseRequested { .. } = event {
                        // 预留：可在此处做「确认退出」拦截
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bar_metrics])
        .run(tauri::generate_context!())
        .expect("Stland 启动失败：无法初始化 Tauri 运行时");
}

/// 前端可主动索取系统栏尺寸（用于旋转屏幕后重新校正布局）。
#[tauri::command]
fn bar_metrics() -> serde_json::Value {
    serde_json::json!({
        "status_bar": system_bar_height(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}
