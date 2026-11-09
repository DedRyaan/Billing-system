// Billing desktop library entry - plugin registration order matters:
// single-instance FIRST per plugin docs (it must intercept the second launch
// before anything else initializes), then window-state (restores geometry
// before the window shows), then store (session persistence backend).
//
// Built by .github/workflows/release.yml on a Windows runner (tauri-action);
// platform icons are generated from icons/tile-mark-light.svg (`tauri icon`).

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: bring the already-running window to the front.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running billing desktop");
}
