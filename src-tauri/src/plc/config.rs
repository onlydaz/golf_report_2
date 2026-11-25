use std::net::SocketAddr;
use std::time::Duration;

/// Connection settings for the PLC actor.
#[derive(Debug, Clone)]
pub struct PlcConfig {
    pub addr: SocketAddr,
    pub slave: u8,
    /// Max time to wait for a single request/response.
    pub request_timeout: Duration,
    /// Max time to wait for the TCP connection to be established.
    pub connect_timeout: Duration,
    /// First delay between reconnect attempts.
    pub reconnect_min: Duration,
    /// Upper bound for the exponential reconnect backoff.
    pub reconnect_max: Duration,
    /// Capacity of the request buffer.
    pub queue_capacity: usize,
    /// Period of the control-area polling loop.
    pub poll_interval: Duration,
}

impl Default for PlcConfig {
    fn default() -> Self {
        Self {
            addr: SocketAddr::from(([192, 168, 1, 49], 502)),
            slave: 1,
            request_timeout: Duration::from_secs(1),
            connect_timeout: Duration::from_secs(3),
            reconnect_min: Duration::from_secs(1),
            reconnect_max: Duration::from_secs(10),
            queue_capacity: 64,
            poll_interval: Duration::from_millis(500),
        }
    }
}
