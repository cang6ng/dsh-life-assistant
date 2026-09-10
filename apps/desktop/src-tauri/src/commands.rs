//! Tauri commands (contract §23): kept minimal and generic — session/turn
//! operations proxy §26 requests to the Node Agent Bridge; no business tool
//! ever gets its own command (`invoke("search_catalog")` is forbidden).
//!
//! Every command answers with the canonical §26 envelope JSON (the same
//! envelope shape the frontend store reduces for channel events), so React
//! keeps exactly one wire model from here to the bridge.
//!
//! Tauri v2 requires async commands returning values from a State input to
//! return `Result`; we always return `Ok(envelope)` — failure envelopes carry
//! the uniform `{ ok:false, error }` data, matching the bridge (§26.2).

use crate::agent::protocol::Envelope;
use crate::agent::process::{AgentProcessManager, Phase};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

type ManagerState<'a> = State<'a, Arc<AgentProcessManager>>;

/// Run one request against the bridge inside a blocking worker (the bridge
/// answers instantly; only a wedged sidecar can block the 90s timeout).
async fn agent_request(
    manager: Arc<AgentProcessManager>,
    request_type: &'static str,
    data: Value,
) -> Envelope {
    let result = tauri::async_runtime::spawn_blocking(move || manager.request(request_type, data))
        .await
        .expect("blocking task panicked");
    match result {
        Ok(env) => env,
        Err(err) => Envelope::failure_response(request_type, 0, &err.code, &err.message),
    }
}

fn ok_envelope(request_type: &str, data: Value) -> Envelope {
    Envelope {
        protocol_version: 1,
        request_id: None,
        session_id: None,
        turn_id: None,
        seq: 0,
        type_: request_type.to_string(),
        data,
    }
}

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

/// Current runtime status. When the sidecar process itself is gone, the host
/// answers `disconnected` directly (the bridge is the source of truth for
/// starting/restoring/ready while it is alive; the crash already published a
/// runtime/status disconnected event).
#[tauri::command]
pub async fn agent_status(manager: ManagerState<'_>) -> Result<Envelope, String> {
    if manager.phase() == Phase::Running {
        Ok(agent_request(Arc::clone(&manager), "agent.status", serde_json::json!({})).await)
    } else {
        Ok(ok_envelope("agent.status", serde_json::json!({ "status": "disconnected" })))
    }
}

/// Manual reconnect (§21): the host kills and respawns the sidecar. No
/// automatic crash loop ever runs.
#[tauri::command]
pub async fn agent_restart(manager: ManagerState<'_>) -> Result<Envelope, String> {
    match manager.restart() {
        Ok(()) => Ok(ok_envelope("agent.restart", serde_json::json!({ "accepted": true }))),
        Err(err) => Ok(Envelope::failure_response("agent.restart", 0, &err.code, &err.message)),
    }
}

// ---------------------------------------------------------------------------
// sessions & turns (proxied §26 requests)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn session_list(manager: ManagerState<'_>) -> Result<Envelope, String> {
    Ok(agent_request(Arc::clone(&manager), "session.list", serde_json::json!({})).await)
}

#[tauri::command]
pub async fn session_create(manager: ManagerState<'_>) -> Result<Envelope, String> {
    Ok(agent_request(Arc::clone(&manager), "session.create", serde_json::json!({})).await)
}

#[tauri::command]
pub async fn session_open(manager: ManagerState<'_>, session_id: String) -> Result<Envelope, String> {
    Ok(agent_request(
        Arc::clone(&manager),
        "session.open",
        serde_json::json!({ "sessionId": session_id }),
    )
    .await)
}

#[tauri::command]
pub async fn turn_send(manager: ManagerState<'_>, session_id: String, text: String) -> Result<Envelope, String> {
    Ok(agent_request(
        Arc::clone(&manager),
        "turn.send",
        serde_json::json!({ "sessionId": session_id, "text": text }),
    )
    .await)
}

// ---------------------------------------------------------------------------
// model-endpoint configuration (proxied §26 requests)
// ---------------------------------------------------------------------------

/// Read the endpoint configuration. Never returns a credential value — the
/// bridge's `config.describe` shape has no field that can carry one.
#[tauri::command]
pub async fn config_get(manager: ManagerState<'_>) -> Result<Envelope, String> {
    Ok(agent_request(Arc::clone(&manager), "config.get", serde_json::json!({})).await)
}

/// Build the `config.save` payload with tri-state fidelity: an absent field
/// means "leave unchanged" while an empty string is a real instruction (clear
/// the base URL / clear the stored key). Serializing the whole patch as one
/// `Option`-bearing struct would collapse those two cases.
fn config_save_body(base_url: Option<String>, model: Option<String>, api_key: Option<String>, clear_api_key: Option<bool>) -> Value {
    let mut data = serde_json::Map::new();
    if let Some(value) = base_url {
        data.insert("baseUrl".to_string(), Value::String(value));
    }
    if let Some(value) = model {
        data.insert("model".to_string(), Value::String(value));
    }
    if let Some(value) = api_key {
        data.insert("apiKey".to_string(), Value::String(value));
    }
    if let Some(value) = clear_api_key {
        data.insert("clearApiKey".to_string(), Value::Bool(value));
    }
    Value::Object(data)
}

/// Persist a configuration patch. `api_key` is write-only: it travels
/// frontend → host → bridge → the credential store and is never echoed back.
#[tauri::command]
pub async fn config_save(
    manager: ManagerState<'_>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
) -> Result<Envelope, String> {
    Ok(agent_request(
        Arc::clone(&manager),
        "config.save",
        config_save_body(base_url, model, api_key, clear_api_key),
    )
    .await)
}

/// Prove the saved configuration with one minimal model call.
#[tauri::command]
pub async fn config_test(manager: ManagerState<'_>) -> Result<Envelope, String> {
    Ok(agent_request(Arc::clone(&manager), "config.test", serde_json::json!({})).await)
}

/// Ask an endpoint which model ids it serves. `api_key` is write-only: it
/// travels frontend -> host -> bridge for this one outbound request and is
/// never echoed back. The body is built by hand so an absent key stays absent,
/// rather than arriving as a null the bridge would have to special-case.
#[tauri::command]
pub async fn config_models(
    manager: ManagerState<'_>,
    base_url: String,
    api_key: Option<String>,
) -> Result<Envelope, String> {
    let mut data = serde_json::Map::new();
    data.insert("baseUrl".to_string(), Value::String(base_url));
    if let Some(value) = api_key {
        data.insert("apiKey".to_string(), Value::String(value));
    }
    Ok(agent_request(Arc::clone(&manager), "config.models", Value::Object(data)).await)
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

/// Subscribe the caller to the streaming event feed (contract §22/§24).
/// Events are canonical §26 envelopes without a requestId — runtime/status,
/// session/title, turn/start, tool/call, …, turn/end. Registering supersedes
/// the previous subscription (single window; reloads replace stale sinks).
#[tauri::command]
pub fn events_subscribe(manager: ManagerState<'_>, channel: tauri::ipc::Channel<Envelope>) -> Result<(), String> {
    manager.subscribe(Box::new(move |env: &Envelope| {
        // A stale frontend channel errors silently; the next subscribe
        // (window reload) replaces this sink anyway.
        let _ = channel.send(env.clone());
    }));
    Ok(())
}

// ---------------------------------------------------------------------------
// window controls (custom title bar, UI Spec §4.3 / contract §40)
// ---------------------------------------------------------------------------

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "main window not found".to_string())
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.close().map_err(|e| e.to_string())
}
