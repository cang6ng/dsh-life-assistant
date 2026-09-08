//! Agent sidecar management (contract §18): the Rust host only owns window /
//! lifecycle / sidecar / stdin-out / IPC / paths / env / restart / forwarding.
//! No Chinook business logic exists in this crate.

pub mod process;
pub mod protocol;
