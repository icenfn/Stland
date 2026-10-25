// 阻止 Windows 下多余的 console 窗口，release 构建生效
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    stland_lib::run()
}
