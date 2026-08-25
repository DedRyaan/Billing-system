// Windows release builds hide the console window; debug keeps it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    billing_desktop_lib::run()
}
