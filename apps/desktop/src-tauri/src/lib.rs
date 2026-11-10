// Settle desktop library entry - plugin registration order matters:
// single-instance FIRST per plugin docs (it must intercept the second launch
// before anything else initializes; its "deep-link" feature forwards a
// settle:// URL from that second launch to the running instance), then
// deep-link, then window-state (restores geometry before the window shows),
// then store (session persistence backend).
//
// Built by .github/workflows/release.yml on a Windows runner (tauri-action);
// platform icons are generated from icons/settle-mark.svg (`tauri icon`).

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch (including an email link opening settle://): bring
            // the already-running window to the front. The deep-link plugin
            // delivers the URL itself to the frontend's onOpenUrl listener.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // The installer registers settle:// already; registering again at
            // launch keeps dev builds and moved installs working. Per-user
            // registry keys only - no admin rights needed.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Settle desktop");
}
