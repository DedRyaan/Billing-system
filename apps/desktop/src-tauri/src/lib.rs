// Billing desktop library entry - plugin registration order matters:
// single-instance FIRST per plugin docs (it must intercept the second launch
// before anything else initializes), then window-state (restores geometry
// before the window shows), then store (session persistence backend).
//
// Native-boot verification is deferred to end-of-phase human check on a
// Rust-capable host - see SUMMARY (no Rust toolchain on executor machine).
// Before first installer build, generate platform icons from the staged
// branding assets (`pnpm tauri icon`) - the bundle icon list references an
// SVG source that the Windows bundler cannot consume directly.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Second-instance hook: focus the existing window. v1 keeps the
            // default behavior (no-op beyond detection) until the shell plan
            // wires explicit window focusing.
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running billing desktop");
}
