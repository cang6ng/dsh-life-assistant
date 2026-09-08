//! §26 presentation envelope, mirrored for the Rust host (contract §48:
//! JSONL protocol deserialize). The Rust host forwards envelopes verbatim —
//! it never interprets business payloads, only classifies
//! requestId-present = response / requestId-absent = streaming event.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Canonical envelope of UI Spec §26.1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<i64>,
    pub seq: i64,
    #[serde(rename = "type")]
    pub type_: String,
    pub data: Value,
}

fn default_protocol_version() -> u32 {
    1
}

impl Envelope {
    pub fn is_response(&self) -> bool {
        self.request_id.is_some()
    }

    #[allow(dead_code)] // classification helper; consumed by host tests
    pub fn event_type(&self) -> &str {
        &self.type_
    }

    pub fn parse(line: &str) -> Result<Envelope, serde_json::Error> {
        serde_json::from_str(line)
    }

    /// Uniform failure data shape `{ ok:false, error:{ code, message } }`.
    pub fn error_data(code: &str, message: &str) -> Value {
        json!({ "ok": false, "error": { "code": code, "message": message } })
    }

    /// A host-originated envelope (no requestId → published as an event).
    pub fn host_event(type_: &str, seq: i64, data: Value) -> Envelope {
        Envelope {
            protocol_version: 1,
            request_id: None,
            session_id: None,
            turn_id: None,
            seq,
            type_: type_.to_string(),
            data,
        }
    }

    /// A synthetic failure response (used when the sidecar died mid-request).
    pub fn failure_response(request_type: &str, seq: i64, code: &str, message: &str) -> Envelope {
        Envelope {
            protocol_version: 1,
            request_id: None,
            session_id: None,
            turn_id: None,
            seq,
            type_: request_type.to_string(),
            data: Envelope::error_data(code, message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_bridge_response_line_verbatim() {
        let line = r#"{"protocolVersion":1,"requestId":"req-1","type":"session/created","sessionId":"session-abc","seq":12,"data":{"session":{"sessionId":"session-abc","title":"","createdAt":1700000000000,"messageCount":0}}}"#;
        let env = Envelope::parse(line).expect("valid envelope");
        assert_eq!(env.protocol_version, 1);
        assert_eq!(env.request_id.as_deref(), Some("req-1"));
        assert_eq!(env.type_, "session/created");
        assert_eq!(env.session_id.as_deref(), Some("session-abc"));
        assert_eq!(env.seq, 12);
        assert!(env.is_response());
        assert_eq!(env.data["session"]["messageCount"], 0);
    }

    #[test]
    fn parses_null_session_and_turn_fields() {
        // The bridge writes explicit nulls on pure events.
        let line = r#"{"protocolVersion":1,"type":"runtime/status","sessionId":null,"turnId":null,"seq":3,"data":{"status":"ready"}}"#;
        let env = Envelope::parse(line).expect("valid envelope");
        assert!(!env.is_response());
        assert_eq!(env.session_id, None);
        assert_eq!(env.turn_id, None);
        assert_eq!(env.type_, "runtime/status");
        assert_eq!(env.data["status"], "ready");
    }

    #[test]
    fn classifies_streaming_turn_events_as_events() {
        let turn_start = Envelope::parse(
            r#"{"protocolVersion":1,"type":"turn/start","sessionId":"s1","turnId":1,"seq":41,"data":{"userText":"hi"}}"#,
        )
        .unwrap();
        let chunk = Envelope::parse(
            r#"{"protocolVersion":1,"type":"assistant/chunk","sessionId":"s1","turnId":1,"seq":55,"data":{"turnId":1,"text":"你"}}"#,
        )
        .unwrap();
        assert!(!turn_start.is_response());
        assert!(!chunk.is_response());
        assert_eq!(turn_start.turn_id, Some(1));
        // turn/end reason stays opaque data — the host never decodes it.
        assert_eq!(turn_start.data["userText"], "hi");
    }

    #[test]
    fn serde_round_trip_keeps_field_names_camel_case() {
        let env = Envelope::host_event("runtime/status", 1, json!({ "status": "disconnected" }));
        let text = serde_json::to_string(&env).unwrap();
        assert!(text.contains("\"protocolVersion\":1"), "got {text}");
        assert!(text.contains("\"runtime/status\""), "got {text}");
        let back: Envelope = serde_json::from_str(&text).unwrap();
        assert_eq!(back, env);
    }

    #[test]
    fn failure_response_mirrors_the_uniform_error_shape() {
        let env = Envelope::failure_response("turn.send", 0, "NOT_READY", "Agent 未运行");
        assert_eq!(env.event_type(), "turn.send");
        assert_eq!(env.data["ok"], false);
        assert_eq!(env.data["error"]["code"], "NOT_READY");
    }
}
