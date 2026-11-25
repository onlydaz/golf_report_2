use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlcError {
    /// The PLC answered with a Modbus exception (bad address, bad function, ...).
    /// The connection is still alive.
    #[error("PLC exception: {message} (code {code})")]
    Exception { code: u8, message: String },

    /// The connection to the PLC was lost while this request was in flight or queued.
    /// The connection has been closed and the actor is reconnecting.
    #[error("PLC disconnected: {0}")]
    Disconnected(String),

    /// The actor is currently not connected (reconnecting).
    #[error("PLC not connected")]
    NotConnected,

    /// The actor task is no longer running.
    #[error("PLC actor stopped")]
    ActorStopped,
}

impl PlcError {
    pub fn kind(&self) -> &'static str {
        match self {
            PlcError::Exception { .. } => "exception",
            PlcError::Disconnected(_) => "disconnected",
            PlcError::NotConnected => "not_connected",
            PlcError::ActorStopped => "actor_stopped",
        }
    }
}

impl From<tokio_modbus::ExceptionCode> for PlcError {
    fn from(code: tokio_modbus::ExceptionCode) -> Self {
        PlcError::Exception {
            code: code.into(),
            message: code.to_string(),
        }
    }
}

/// Serialized as `{ kind, message }` for the frontend.
impl Serialize for PlcError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("PlcError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
