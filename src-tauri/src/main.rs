// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use command_group::CommandGroup;
use std::process::Command;
use std::sync::mpsc::{sync_channel, Receiver};
use std::thread;
use tauri::api::process::Command as TCommand;
use tauri::WindowEvent;

fn start_backend(receiver: Receiver<i32>) {
    // `new_sidecar()` expects just the filename, NOT the whole path
    let t = TCommand::new_sidecar("api").expect("[Error] Failed to create `api` binary command");
    let mut group = Command::from(t)
        .group_spawn()
        .expect("[Error] spawning api server process.");
    // If anyone knows how to log out stdout msg's from this process drop a comment. Rust is not my language.
    thread::spawn(move || loop {
        let s = receiver.recv();
        if s.unwrap() == -1 {
            group.kill().expect("[Error] killing api server process.");
        }
    });
}

fn main() {
    // Startup the python binary (api service)
    let (tx, rx) = sync_channel(1);
    start_backend(rx);
    tauri::Builder::default()
        .on_window_event(move |event| match event.event() {
            WindowEvent::Destroyed => {
                tx.send(-1)
                    .expect("[Error] sending kill signal to api server process.");
                println!("Window destroyed, killing api server process.");
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![process_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn process_pdf(pdf_path: &str, handle: tauri::AppHandle) -> &str {
    return pdf_path;
}
