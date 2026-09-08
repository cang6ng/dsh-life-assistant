//! DSH Life Assistant — Rust host entry: window, lifecycle, and the agent sidecar.
//!
//! Window, lifecycle, sidecar spawn, paths and env only. The Node Agent
//! Bridge owns the AgentRuntime; React owns the UI; business logic lives in
//! the Chinook plugin. This crate forwards JSONL envelopes — nothing else.

mod agent;
mod commands;

use crate::agent::process::{dev_launch, packaged_launch, AgentProcessManager};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::agent_status,
            commands::agent_restart,
            commands::session_list,
            commands::session_create,
            commands::session_open,
            commands::turn_send,
            commands::events_subscribe,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
        ])
        .setup(|app| {
            let manager = spawn_manager(app.handle());
            app.manage(manager);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the DSH Life Assistant desktop host");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(manager) = handle.try_state::<Arc<AgentProcessManager>>() {
                manager.shutdown();
            }
        }
    });
}

/// Resolve DSH_HOME + launch mode and spawn the one long-lived sidecar
/// (contract §20, §42, §43, §45).
fn spawn_manager(app: &tauri::AppHandle) -> Arc<AgentProcessManager> {
    let agent_home = if cfg!(debug_assertions) {
        // Desktop dev shares the repo-bootstrapped home with the CLI
        // (`pnpm bootstrap` → .dsh). The bridge's env.ts resolves the same
        // default; packaged builds own a per-app data dir below.
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.dsh")
    } else {
        match app.path().app_data_dir() {
            Ok(dir) => dir.join("agent"),
            Err(err) => {
                eprintln!("[desktop-host] cannot resolve app data dir ({err}); falling back to a local ./agent-data");
                PathBuf::from("agent-data")
            }
        }
    };
    // The directories the runtime expects under DSH_HOME (contract §42).
    for sub in ["sessions", "data"] {
        let _ = std::fs::create_dir_all(agent_home.join(sub));
    }

    let launch = if cfg!(debug_assertions) {
        dev_launch()
    } else {
        match app.path().resource_dir() {
            Ok(dir) => packaged_launch(&dir),
            Err(err) => {
                eprintln!("[desktop-host] resource dir unavailable ({err}); falling back to dev launch");
                dev_launch()
            }
        }
    };
    eprintln!("[desktop-host] DSH_HOME = {}", agent_home.display());
    AgentProcessManager::start(agent_home, launch)
}
