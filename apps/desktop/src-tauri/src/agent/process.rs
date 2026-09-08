//! AgentProcessManager (contract §19–§21): one long-lived Node Agent Bridge
//! sidecar, JSONL pipes, requestId routing, event forwarding, crash handling.
//!
//! Responsibilities:
//!
//!  - spawn exactly one Node sidecar per desktop app lifecycle (§20); restart
//!    only on explicit `agent_restart` (no automatic crash loop, §21);
//!  - every stdout JSONL line is parsed into an `Envelope`; lines carrying a
//!    `requestId` resolve the matching pending request, all other lines are
//!    forwarded verbatim to subscribed event sinks (the Tauri Channel in
//!    lib.rs);
//!  - sidecar death (stdout EOF / pipe break) publishes `runtime/status
//!    disconnected` and fails pending requests; manual reconnect is possible;
//!  - the manager is AppHandle-free: `Launch` + subscriber closures let the
//!    whole state machine be unit-tested without a window.
//!
//! Business rules never appear here — no tools, no SQL, no session logic.

use crate::agent::protocol::Envelope;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// How long a request may wait for its response envelope before the host
/// gives up (the bridge answers every valid request promptly; this only
/// guards against a wedged sidecar).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

pub const CODE_NOT_READY: &str = "NOT_READY";
pub const CODE_TIMEOUT: &str = "TIMEOUT";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Phase {
    /// Child spawned (or being spawned); `ready` itself comes from the bridge.
    Running,
    /// No live child — manual `agent_restart` required (§21).
    Crashed,
}

#[derive(Debug, Clone)]
pub struct AgentError {
    pub code: String,
    pub message: String,
}

impl AgentError {
    pub fn new(code: &str, message: impl Into<String>) -> AgentError {
        AgentError { code: code.to_string(), message: message.into() }
    }
}

/// How to launch the sidecar (dev: system node + repo bridge; packaged:
/// bundled node.exe + resources/runtime — contract §45).
#[derive(Debug, Clone)]
pub struct Launch {
    pub command: String,
    pub args: Vec<String>,
    /// Extra env vars (CHINOOK_BOOT_RESOURCES in production, …). DSH_HOME is
    /// always set from the manager's home dir afterwards.
    pub extra_env: Vec<(String, String)>,
    pub cwd: Option<PathBuf>,
}

impl Launch {
    fn to_command(&self, dsh_home: &Path) -> Command {
        let mut cmd = Command::new(&self.command);
        cmd.args(&self.args)
            .env("DSH_HOME", dsh_home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (k, v) in &self.extra_env {
            cmd.env(k, v);
        }
        if let Some(dir) = &self.cwd {
            cmd.current_dir(dir);
        }
        cmd
    }
}

/// Dev launch: system `node` + the built bridge bundle
/// (built by `node apps/agent-bridge/build.mjs`).
pub fn dev_launch() -> Launch {
    let bridge = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../agent-bridge/dist/bridge.mjs");
    Launch {
        command: "node".to_string(),
        args: vec![bridge.to_string_lossy().into_owned()],
        extra_env: vec![],
        cwd: None,
    }
}

/// Strip the Windows `\\?\` verbatim prefix that Tauri's path resolver may
/// attach (extended-length path form). Node's module loader and many tools
/// mis-parse verbatim paths (the drive letter alone survives — `lstat 'C:'`),
/// so the sidecar command line, cwd and env must carry ordinary paths.
/// No-op when the path has no prefix (dev launches, non-Windows).
pub fn portable_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    p.to_path_buf()
}

/// Packaged launch (contract §43/§45): bundled Node + bridge + home template.
/// `resource_dir` = the Tauri resource directory at runtime.
pub fn packaged_launch(resource_dir: &Path) -> Launch {
    let runtime = portable_path(&resource_dir.join("runtime"));
    Launch {
        command: runtime.join("node/node.exe").to_string_lossy().into_owned(),
        args: vec![runtime.join("bridge/bridge.mjs").to_string_lossy().into_owned()],
        // Points at the dir CONTAINING `home-template/` — the bridge
        // (home.ts) resolves `<boot-resources>/home-template`.
        extra_env: vec![(
            "CHINOOK_BOOT_RESOURCES".to_string(),
            runtime.to_string_lossy().into_owned(),
        )],
        cwd: Some(runtime.join("bridge")),
    }
}

// ---------------------------------------------------------------------------
// routing & fan-out (pure, unit-tested)
// ---------------------------------------------------------------------------

type PendingEntry = (String, mpsc::Sender<Envelope>);

#[derive(Default)]
struct Router {
    pending: Mutex<HashMap<String, PendingEntry>>,
}

impl Router {
    fn register(&self, request_id: String, request_type: String) -> mpsc::Receiver<Envelope> {
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(request_id, (request_type, tx));
        rx
    }

    /// Resolve one response envelope; unknown ids (already timed out) drop.
    fn deliver(&self, envelope: Envelope) {
        let id = envelope.request_id.as_ref().expect("deliver called on a response");
        let entry = self.pending.lock().unwrap().remove(id);
        if let Some((_, tx)) = entry {
            let _ = tx.send(envelope);
        }
    }

    fn cancel(&self, request_id: &str) {
        self.pending.lock().unwrap().remove(request_id);
    }

    /// Fail every outstanding request (sidecar died). Returns how many
    /// requests were pending.
    fn fail_all(&self, code: &str, message: &str) -> usize {
        let entries: Vec<PendingEntry> = self.pending.lock().unwrap().drain().map(|(_, v)| v).collect();
        let n = entries.len();
        for (request_type, tx) in entries {
            let env = Envelope::failure_response(&request_type, 0, code, message);
            let _ = tx.send(env);
        }
        n
    }
}

/// Event subscribers: the frontend Channel adapter plus test recorders. Each
/// subscriber is a plain `Fn(&Envelope)` so tests inject collectors.
#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Arc<Mutex<Vec<Box<dyn Fn(&Envelope) + Send + Sync>>>>,
    seq: Arc<AtomicI64>,
}

impl EventBus {
    /// Replace subscribers with this single one (single-window app; a fresh
    /// frontend subscription supersedes stale ones after reloads).
    pub fn subscribe(&self, sink: Box<dyn Fn(&Envelope) + Send + Sync>) {
        *self.subscribers.lock().unwrap() = vec![sink];
    }

    pub fn publish(&self, envelope: &Envelope) {
        let sinks = self.subscribers.lock().unwrap();
        for sink in sinks.iter() {
            sink(envelope);
        }
    }

    /// Host-originated envelopes need seqs outside the bridge stream.
    pub fn next_seq(&self) -> i64 {
        self.seq.fetch_add(1, Ordering::Relaxed) + 1
    }
}

// ---------------------------------------------------------------------------
// manager
// ---------------------------------------------------------------------------

struct ProcState {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    phase: Phase,
    /// Incremented on every spawn. Reader threads capture the generation at
    /// spawn time so a stale generation's EOF can never tear down the child
    /// that replaced it (restart race).
    generation: u64,
}

pub struct AgentProcessManager {
    dsh_home: PathBuf,
    launch: Launch,
    bus: EventBus,
    router: Router,
    proc: Mutex<ProcState>,
    request_counter: AtomicU64,
}

impl AgentProcessManager {
    /// Construct + spawn the sidecar. Spawn failures never panic: they put
    /// the manager into `Crashed` and publish `runtime/status error`, so the
    /// UI shows the reconnect card (e.g. missing Node in dev).
    pub fn start(dsh_home: PathBuf, launch: Launch) -> Arc<AgentProcessManager> {
        let manager = Arc::new(AgentProcessManager {
            dsh_home,
            launch,
            bus: EventBus::default(),
            router: Router::default(),
            proc: Mutex::new(ProcState {
                child: None,
                stdin: None,
                phase: Phase::Crashed,
                generation: 0,
            }),
            request_counter: AtomicU64::new(0),
        });
        manager.spawn_locked();
        manager
    }

    pub fn phase(&self) -> Phase {
        self.proc.lock().unwrap().phase.clone()
    }

    pub fn subscribe(&self, sink: Box<dyn Fn(&Envelope) + Send + Sync>) {
        self.bus.subscribe(sink);
    }

    /// The agent data dir used as DSH_HOME (contract §42/§43).
    #[allow(dead_code)] // manager accessor; consumed by the real-sidecar test
    pub fn dsh_home(&self) -> &Path {
        &self.dsh_home
    }

    // -- lifecycle ---------------------------------------------------------

    /// Spawn the sidecar and attach the stdout/stderr reader threads. The
    /// pipes are moved into the readers directly (taken exactly once, at
    /// spawn); each reader captures its generation so a stale EOF after a
    /// restart can never tear down the newer sidecar. Errors publish
    /// `runtime/status error` (never panic, never auto-retry).
    fn spawn_locked(self: &Arc<Self>) {
        let (generation, stdout, stderr);
        {
            let mut proc = self.proc.lock().unwrap();
            let mut cmd = self.launch.to_command(&self.dsh_home);
            let mut child = match cmd.spawn() {
                Ok(child) => child,
                Err(err) => {
                    proc.phase = Phase::Crashed;
                    drop(proc);
                    self.bus.publish(&Envelope::host_event(
                        "runtime/status",
                        self.bus.next_seq(),
                        serde_json::json!({ "status": "error", "detail": format!("Agent 进程启动失败：{err}") }),
                    ));
                    return;
                }
            };
            stdout = child.stdout.take().expect("piped stdout");
            stderr = child.stderr.take().expect("piped stderr");
            proc.stdin = child.stdin.take();
            proc.child = Some(child);
            proc.generation += 1;
            generation = proc.generation;
            proc.phase = Phase::Running;
        }
        // stdout reader: parses envelope lines, resolves requests, fans out
        // events; EOF means the sidecar is gone (§21).
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => break, // EOF — sidecar gone (§21)
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match Envelope::parse(trimmed) {
                            Ok(envelope) => {
                                if envelope.is_response() {
                                    me.router.deliver(envelope);
                                } else {
                                    me.bus.publish(&envelope);
                                }
                            }
                            Err(err) => eprintln!("[desktop-host] malformed sidecar line dropped: {err}"),
                        }
                    }
                    Err(err) => {
                        eprintln!("[desktop-host] stdout read error: {err}");
                        break;
                    }
                }
            }
            me.handle_down(generation, "Agent 侧边进程已退出");
        });
        // stderr diagnostics are surfaced to the host console only.
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end();
                        if !trimmed.is_empty() {
                            eprintln!("[sidecar] {trimmed}");
                        }
                    }
                    Err(err) => {
                        eprintln!("[sidecar] stderr read error: {err}");
                        break;
                    }
                }
            }
        });
    }

    /// Kill the current sidecar and spawn a fresh one. Publishes
    /// `restarting` first; the fresh bridge then streams starting→ready.
    pub fn restart(self: &Arc<Self>) -> Result<(), AgentError> {
        self.bus.publish(&Envelope::host_event(
            "runtime/status",
            self.bus.next_seq(),
            serde_json::json!({ "status": "restarting" }),
        ));
        {
            let mut proc = self.proc.lock().unwrap();
            proc.phase = Phase::Crashed; // requests during the kill window fail cleanly
            if let Some(mut child) = proc.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            proc.stdin = None;
        }
        self.spawn_locked();
        if self.phase() == Phase::Running {
            Ok(())
        } else {
            Err(AgentError::new(CODE_NOT_READY, "重新启动失败，请检查 Node 运行环境后重试"))
        }
    }

    /// Best-effort synchronous teardown on app exit.
    pub fn shutdown(&self) {
        let mut proc = self.proc.lock().unwrap();
        proc.phase = Phase::Crashed;
        if let Some(mut child) = proc.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        proc.stdin = None;
        self.router.fail_all(CODE_NOT_READY, "应用退出");
    }

    // -- requests ------------------------------------------------------------

    /// Send one §26 request and await its response envelope.
    pub fn request(&self, request_type: &str, data: serde_json::Value) -> Result<Envelope, AgentError> {
        let request_id = format!("req-{}", self.request_counter.fetch_add(1, Ordering::Relaxed));
        let line = serde_json::json!({
            "protocolVersion": 1,
            "requestId": request_id,
            "type": request_type,
            "data": data,
        });
        let receiver = self.router.register(request_id.clone(), request_type.to_string());

        {
            let mut proc = self.proc.lock().unwrap();
            if proc.phase != Phase::Running {
                self.router.cancel(&request_id);
                return Err(AgentError::new(CODE_NOT_READY, "Agent 未运行或已断开，请重新连接"));
            }
            let stdin = match proc.stdin.as_mut() {
                Some(stdin) => stdin,
                None => {
                    // Restart window (kill → respawn) — the sidecar is gone.
                    self.router.cancel(&request_id);
                    return Err(AgentError::new(CODE_NOT_READY, "Agent 正在重新连接，请稍后重试"));
                }
            };
        // JSONL framing: the bridge reader is line-oriented — every request
        // must end with a newline or it never dispatches.
        let payload = format!("{}\n", line);
            if let Err(err) = stdin.write_all(payload.as_bytes()).and_then(|()| stdin.flush()) {
                drop(proc);
                self.router.cancel(&request_id);
                return Err(AgentError::new(CODE_NOT_READY, format!("Agent 连接已断开（{err}）")));
            }
        }

        match receiver.recv_timeout(REQUEST_TIMEOUT) {
            Ok(envelope) => Ok(envelope),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.router.cancel(&request_id);
                Err(AgentError::new(CODE_TIMEOUT, "Agent 长时间未响应，请重试"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(AgentError::new(CODE_NOT_READY, "Agent 已断开，请重新连接"))
            }
        }
    }

    // -- crash handling ------------------------------------------------------

    /// Crash path (§21): runs once per generation when that generation's
    /// stdout pipe closes. A stale generation (restart already replaced the
    /// child) returns immediately. Fails pending requests and publishes
    /// `runtime/status disconnected`; manual `agent_restart` is the only way
    /// back.
    fn handle_down(&self, generation: u64, why: &str) {
        {
            let mut proc = self.proc.lock().unwrap();
            if proc.phase != Phase::Running || proc.generation != generation {
                return; // already handled, or a stale reader from a prior spawn
            }
            proc.phase = Phase::Crashed;
            if let Some(mut child) = proc.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            proc.stdin = None;
        }
        self.router.fail_all(CODE_NOT_READY, "Agent 已断开，请重新连接");
        self.bus.publish(&Envelope::host_event(
            "runtime/status",
            self.bus.next_seq(),
            serde_json::json!({ "status": "disconnected", "detail": why }),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn recorder() -> (Arc<StdMutex<Vec<Envelope>>>, Box<dyn Fn(&Envelope) + Send + Sync>) {
        let log: Arc<StdMutex<Vec<Envelope>>> = Arc::default();
        let sink_log = Arc::clone(&log);
        let sink: Box<dyn Fn(&Envelope) + Send + Sync> = Box::new(move |env| sink_log.lock().unwrap().push(env.clone()));
        (log, sink)
    }

    /// A launch that cannot spawn — forces the Crashed state path.
    fn failing_launch() -> Launch {
        Launch {
            command: "definitely-not-a-real-executable-xyz".to_string(),
            args: vec![],
            extra_env: vec![],
            cwd: None,
        }
    }

    #[test]
    fn spawn_failure_lands_in_crashed_and_publishes_error_status() {
        let (log, sink) = recorder();
        let manager = AgentProcessManager::start(PathBuf::from("."), failing_launch());
        manager.subscribe(sink);
        // The first error event may precede subscribe (start() is sync) —
        // force a fresh failed attempt via restart to observe the event.
        let err = manager.restart().unwrap_err();
        assert_eq!(err.code, CODE_NOT_READY);
        assert_eq!(manager.phase(), Phase::Crashed);
        let events = log.lock().unwrap();
        let last = events.last().expect("an error status event");
        assert_eq!(last.event_type(), "runtime/status");
        assert_eq!(last.data["status"], "error");
    }

    #[test]
    fn no_automatic_crash_loop_after_spawn_failure() {
        let manager = AgentProcessManager::start(PathBuf::from("."), failing_launch());
        assert_eq!(manager.phase(), Phase::Crashed);
        // Wait a beat — nothing respawns by itself (§21).
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(manager.phase(), Phase::Crashed);
    }

    #[test]
    fn router_routes_responses_and_ignores_stale_ids() {
        let router = Router::default();
        let rx = router.register("r1".to_string(), "session.list".to_string());
        let response = Envelope {
            protocol_version: 1,
            request_id: Some("r1".to_string()),
            session_id: None,
            turn_id: None,
            seq: 9,
            type_: "session/list".to_string(),
            data: serde_json::json!({ "sessions": [] }),
        };
        router.deliver(response.clone());
        assert_eq!(rx.recv().unwrap(), response);
        // Late/stale delivery (request already timed out) is a no-op.
        router.deliver(response);
    }

    #[test]
    fn router_fail_all_answers_every_pending_request_with_its_request_type() {
        let router = Router::default();
        let rx_turn = router.register("t1".to_string(), "turn.send".to_string());
        let rx_open = router.register("o1".to_string(), "session.open".to_string());
        let n = router.fail_all(CODE_NOT_READY, "Agent 已断开");
        assert_eq!(n, 2);
        let turn_err = rx_turn.recv().unwrap();
        let open_err = rx_open.recv().unwrap();
        assert_eq!(turn_err.event_type(), "turn.send");
        assert_eq!(turn_err.data["error"]["code"], CODE_NOT_READY);
        assert_eq!(open_err.event_type(), "session.open");
        assert_eq!(router.fail_all("x", "y"), 0);
    }

    #[test]
    fn event_bus_fans_out_events_with_monotonic_seq() {
        let bus = EventBus::default();
        let (log, sink) = recorder();
        bus.subscribe(sink);
        bus.publish(&Envelope::host_event("a", bus.next_seq(), serde_json::json!({})));
        bus.publish(&Envelope::host_event("b", bus.next_seq(), serde_json::json!({})));
        let events = log.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type(), "a");
        assert_eq!(events[0].seq, 1);
        assert!(events[0].seq < events[1].seq);
    }

    #[test]
    fn packaged_launch_points_at_the_bundled_runtime_tree() {
        let launch = packaged_launch(Path::new("C:/fake/resources"));
        let cmd = launch.command.replace('\\', "/");
        assert!(cmd.ends_with("runtime/node/node.exe"), "got {cmd}");
        assert!(launch.args[0].replace('\\', "/").ends_with("runtime/bridge/bridge.mjs"));
        assert_eq!(launch.extra_env[0].0, "CHINOOK_BOOT_RESOURCES");
        // The env points at the runtime dir itself — the bridge resolves
        // `<boot-resources>/home-template` from it (home.ts).
        assert!(
            launch.extra_env[0].1.replace('\\', "/").ends_with("runtime"),
            "got {:?}",
            launch.extra_env[0].1
        );
        let cwd = launch.cwd.as_ref().unwrap().to_string_lossy().replace('\\', "/");
        assert!(cwd.ends_with("runtime/bridge"), "got {cwd}");
    }

    #[cfg(windows)]
    #[test]
    fn packaged_launch_strips_the_verbatim_prefix_tauri_can_add() {
        // tauri's resource_dir() on Windows may return `\\?\C:\...` extended
        // paths; node mis-parses those (the drive letter alone survives), so
        // every path handed to the sidecar must be prefix-free.
        let launch = packaged_launch(Path::new(r"\\?\C:\Program Files\DSH Chinook"));
        assert!(!launch.command.contains(r"\\?\"));
        assert!(!launch.args[0].contains(r"\\?\"));
        assert!(!launch.extra_env[0].1.contains(r"\\?\"));
        assert!(!launch.cwd.as_ref().unwrap().to_string_lossy().contains(r"\\?\"));
        assert!(launch.command.contains("C:/Program Files") || launch.command.contains(r"C:\Program Files"));
        // Unprefixed input passes through untouched (join mixes in the
        // forward-slash components from packaged_launch).
        let plain = packaged_launch(Path::new(r"C:\no prefix here"));
        assert_eq!(plain.command, r"C:\no prefix here\runtime\node/node.exe");
    }

    #[test]
    fn portable_path_handles_unc_and_plain_inputs() {
        assert_eq!(portable_path(Path::new(r"\\?\UNC\share\a")), PathBuf::from(r"\\share\a"));
        assert_eq!(portable_path(Path::new(r"\\?\C:\a\b")), PathBuf::from(r"C:\a\b"));
        assert_eq!(portable_path(Path::new(r"C:\plain")), PathBuf::from(r"C:\plain"));
        assert_eq!(portable_path(Path::new("/unix/like")), PathBuf::from("/unix/like"));
    }

    #[test]
    fn dev_launch_targets_the_built_bridge_bundle_with_system_node() {
        let launch = dev_launch();
        assert_eq!(launch.command, "node");
        let path = PathBuf::from(&launch.args[0]);
        assert!(path.file_name().unwrap().to_string_lossy().ends_with("bridge.mjs"));
        assert!(launch.extra_env.is_empty()); // no CHINOOK_BOOT_RESOURCES in dev
    }

    // -----------------------------------------------------------------------
    // Real sidecar integration (skipped automatically when node or the
    // provisioned dev home is unavailable). The bridge boots the real
    // runtime profile; no LLM is needed for session.create.
    // -----------------------------------------------------------------------

    #[test]
    fn real_sidecar_boots_and_answers_requests_over_jsonl_pipes() {
        let dsh_home = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.dsh");
        if !dsh_home.join("profiles").exists() {
            eprintln!("skipping real-sidecar test: {} not provisioned (run pnpm bootstrap)", dsh_home.display());
            return;
        }
        let node_ok = Command::new("node").arg("--version").output().is_ok();
        if !node_ok {
            eprintln!("skipping real-sidecar test: node not on PATH");
            return;
        }

        let (log, sink) = recorder();
        let manager = AgentProcessManager::start(dsh_home.clone(), dev_launch());
        manager.subscribe(sink);

        // Bridge boot: starting → ready (or error) within a bounded wait.
        // Scan from the newest status event — `find` from the front would
        // keep matching the initial `starting` forever.
        let deadline = std::time::Instant::now() + Duration::from_secs(45);
        let ready = loop {
            let events = log.lock().unwrap();
            if let Some(env) = events.iter().rev().find(|e| e.event_type() == "runtime/status") {
                let status = env.data["status"].as_str().unwrap_or("");
                if status == "ready" {
                    break true;
                }
                if status == "error" || status == "disconnected" {
                    break false;
                }
            }
            drop(events);
            if std::time::Instant::now() > deadline {
                panic!("sidecar did not become ready in time");
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(ready, "bridge reported a startup error");

        // Request routing end-to-end: session.create → session/created.
        let response = manager
            .request("session.create", serde_json::json!({}))
            .expect("session.create answered");
        assert_eq!(response.event_type(), "session/created");
        let session_id = response.data["session"]["sessionId"].as_str().expect("session id");
        assert!(session_id.starts_with("session-"));

        // Events keep flowing while requests resolve (a create publishes
        // restoring/ready status envelopes without requestIds).
        let response = manager.request("session.list", serde_json::json!({})).expect("session.list answered");
        assert_eq!(response.event_type(), "session/list");

        manager.shutdown();
        assert_eq!(manager.phase(), Phase::Crashed);
        eprintln!("real-sidecar integration OK (session {session_id})");
    }
}
