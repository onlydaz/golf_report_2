//! PLC communication over Modbus TCP using the actor pattern.
//!
//! A single actor task owns the Modbus connection. Everyone else talks to it
//! through a cloneable [`PlcHandle`]; requests are queued in a bounded channel
//! and processed one at a time.

mod actor;
pub mod commands;
mod config;
pub mod control;
mod decode;
mod poller;
pub mod record;
pub mod registers;
mod error;
mod handle;

#[cfg(test)]
mod tests;

pub use actor::{spawn_plc_actor, PlcStatus};
pub use config::PlcConfig;
pub use error::PlcError;
pub use handle::PlcHandle;
pub use poller::{run_poller, PollEvent};
