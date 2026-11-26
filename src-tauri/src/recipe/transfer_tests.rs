use super::*;
use crate::plc::{PlcConfig, PollEvent, run_poller, spawn_plc_actor};
use crate::recipe::encode::tests::saved_recipe;
use std::{
    pin::Pin,
    sync::{Arc, Mutex as StdMutex},
};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_modbus::{
    ExceptionCode, Request, Response,
    server::{
        Service,
        tcp::{Server, accept_tcp_connection},
    },
};

// Same tokio-modbus Service/loopback Actor harness as plc/tests.rs, with only
// the recipe handshake responses and fault switches needed by these tests.
struct Machine {
    regs: Vec<u16>,
    writes: Vec<(u8, u16, Vec<u16>)>,
    reads: usize,
    chunks: usize,
    ack: u16,
    fail_chunk: Option<usize>,
    busy_after_data: bool,
    wrong_sku: bool,
    wrong_rev: bool,
    lose_cmd_response: bool,
    lose_reset_response: bool,
    hold_reset: bool,
    record_on_command: bool,
    reject_result_ack: bool,
}
impl Default for Machine {
    fn default() -> Self {
        let mut regs = vec![0; 25500];
        regs[20002] = 1;
        Self {
            regs,
            writes: vec![],
            reads: 0,
            chunks: 0,
            ack: 1,
            fail_chunk: None,
            busy_after_data: false,
            wrong_sku: false,
            wrong_rev: false,
            lose_cmd_response: false,
            lose_reset_response: false,
            hold_reset: false,
            record_on_command: false,
            reject_result_ack: false,
        }
    }
}
#[derive(Clone)]
struct Fake(Arc<StdMutex<Machine>>);
impl Service for Fake {
    type Request = Request<'static>;
    type Response = Response;
    type Exception = ExceptionCode;
    type Future = Pin<Box<dyn Future<Output = Result<Response, ExceptionCode>> + Send>>;
    fn call(&self, req: Self::Request) -> Self::Future {
        let state = self.0.clone();
        Box::pin(async move {
            let (response, delay) = {
                let mut m = state.lock().unwrap();
                match req {
                    Request::ReadHoldingRegisters(addr, count) => {
                        m.reads += 1;
                        if count > 100 {
                            return Err(ExceptionCode::ServerDeviceFailure);
                        }
                        (
                            Response::ReadHoldingRegisters(
                                m.regs[addr as usize..addr as usize + count as usize].to_vec(),
                            ),
                            false,
                        )
                    }
                    Request::WriteMultipleRegisters(addr, words) => {
                        if words.len() > 100 {
                            return Err(ExceptionCode::IllegalDataValue);
                        }
                        m.writes.push((16, addr, words.to_vec()));
                        if (20020..=20291).contains(&addr) {
                            m.chunks += 1;
                            if Some(m.chunks) == m.fail_chunk {
                                return Err(ExceptionCode::ServerDeviceFailure);
                            }
                        }
                        m.regs[addr as usize..addr as usize + words.len()].copy_from_slice(&words);
                        if addr as usize + words.len() == 20292 && m.busy_after_data {
                            m.regs[20002] = 0;
                        }
                        (
                            Response::WriteMultipleRegisters(addr, words.len() as u16),
                            false,
                        )
                    }
                    Request::WriteSingleRegister(addr, value) => {
                        if addr == 25012 && m.reject_result_ack {
                            return Err(ExceptionCode::ServerDeviceFailure);
                        }
                        m.writes.push((6, addr, vec![value]));
                        m.regs[addr as usize] = value;
                        let mut delay = false;
                        if addr == 20000 && value == 1 {
                            m.regs[20001] = m.ack;
                            if m.ack == 1 {
                                let sku = m.regs[20022..20032].to_vec();
                                m.regs[20004..20014].copy_from_slice(&sku);
                                m.regs[20014] = m.regs[20032];
                                m.regs[20015] = m.regs[20033];
                                if m.wrong_sku {
                                    m.regs[20004] = u16::from_le_bytes(*b"XX");
                                }
                                if m.wrong_rev {
                                    m.regs[20014] ^= 1;
                                }
                            }
                            if m.record_on_command {
                                m.regs[25011] = 1;
                                m.regs[25022] = 4242;
                            }
                            delay = m.lose_cmd_response;
                            m.lose_cmd_response = false;
                        } else if addr == 20000 && value == 0 {
                            if !m.hold_reset {
                                m.regs[20001] = 0;
                            }
                            delay = m.lose_reset_response;
                            m.lose_reset_response = false;
                        }
                        (Response::WriteSingleRegister(addr, value), delay)
                    }
                    _ => return Err(ExceptionCode::IllegalFunction),
                }
            };
            // The write reached the PLC, but the Actor times out and drops its socket.
            if delay {
                sleep(Duration::from_millis(400)).await;
            }
            Ok(response)
        })
    }
}

struct Harness {
    plc: PlcHandle,
    machine: Arc<StdMutex<Machine>>,
    server: JoinHandle<()>,
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.server.abort();
    }
}
async fn harness(machine: Machine) -> Harness {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let machine = Arc::new(StdMutex::new(machine));
    let svc = Fake(machine.clone());
    let server = tokio::spawn(async move {
        let server = Server::new(listener);
        let new_service = move |_| Ok(Some(svc.clone()));
        let connected = move |stream, addr| {
            let factory = new_service.clone();
            async move { accept_tcp_connection(stream, addr, factory) }
        };
        server.serve(&connected, |_| {}).await.unwrap();
    });
    let plc = spawn_plc_actor(PlcConfig {
        addr,
        request_timeout: Duration::from_millis(150),
        connect_timeout: Duration::from_millis(200),
        reconnect_min: Duration::from_millis(20),
        reconnect_max: Duration::from_millis(50),
        ..PlcConfig::default()
    });
    connected(&plc).await;
    Harness {
        plc,
        machine,
        server,
    }
}
async fn connected(plc: &PlcHandle) {
    let mut status = plc.subscribe_status();
    timeout(
        Duration::from_secs(2),
        status.wait_for(|s| *s == PlcStatus::Connected),
    )
    .await
    .unwrap()
    .unwrap();
}
fn transfer() -> RecipeTransfer {
    // 100 is a limit of THIS TEST SERVER, not a claimed/production AS200 limit.
    RecipeTransfer::new(TransferConfig {
        commissioned: true,
        max_write_words: Some(100),
        confirmation_reference: "loopback simulator only".into(),
    })
}
async fn apply(t: &RecipeTransfer, h: &Harness) -> Result<TransferReport, TransferError> {
    let recipe = saved_recipe();
    t.apply(&h.plc, recipe.summary.recipe_rev, async { Ok(recipe) })
        .await
}

#[tokio::test]
async fn status_read_releases_lock_and_reports_an_overlapping_writer_as_busy() {
    let h = harness(Machine::default()).await;
    let t = transfer();
    let mut status = Box::pin(t.status(&h.plc));
    // Suspend after queuing the read, before the loopback Actor can answer.
    std::future::poll_fn(|cx| {
        assert!(status.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert!(t.pending.try_lock().is_ok());

    // Start a real apply call, held at DB loading so it cannot issue any writes.
    let mut applying = Box::pin(t.apply(&h.plc, 1, std::future::pending()));
    std::future::poll_fn(|cx| {
        assert!(applying.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    let status = status.await;
    assert!(status.busy);
    assert!(status.handshake.is_none());
    assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Failed);
    assert_eq!(t.reconcile(&h.plc).await.unwrap_err().kind, Outcome::Failed);
    assert!(h.machine.lock().unwrap().writes.is_empty());
    drop(applying);
    assert_eq!(apply(&t, &h).await.unwrap().outcome, Outcome::Success);
}

#[tokio::test]
async fn reconcile_requires_commissioning_but_not_an_fc16_limit() {
    let h = harness(Machine::default()).await;
    {
        let mut m = h.machine.lock().unwrap();
        m.regs[20000] = 1;
        m.regs[20001] = 10;
    }
    for (commissioned, reference) in [(false, "test only"), (true, " ")] {
        let t = RecipeTransfer::new(TransferConfig {
            commissioned,
            max_write_words: Some(100),
            confirmation_reference: reference.into(),
        });
        assert!(!t.status(&h.plc).await.commissioned);
        assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Failed);
        assert_eq!(t.reconcile(&h.plc).await.unwrap_err().kind, Outcome::Failed);
    }
    assert!(h.machine.lock().unwrap().writes.is_empty());

    for limit in [None, Some(0), Some(124)] {
        let mut t = transfer();
        t.config.max_write_words = limit;
        let status = t.status(&h.plc).await;
        assert!(status.commissioned);
        assert!(status.blocked_reason.is_some());
        assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Failed);
        {
            let mut m = h.machine.lock().unwrap();
            assert!(m.writes.is_empty());
            m.regs[20000] = 1;
            m.regs[20001] = 10;
        }
        let report = t.reconcile(&h.plc).await.unwrap();
        assert_eq!(report.outcome, Outcome::Failed); // PLC rejection, handshake completed.
        assert_eq!((report.handshake.pc_cmd, report.handshake.plc_ack), (0, 0));
        let mut m = h.machine.lock().unwrap();
        assert_eq!(m.writes, [(6, 20000, vec![0])]);
        m.writes.clear();
    }
}

#[tokio::test]
async fn success_writes_only_pc_registers_in_workbook_order() {
    let h = harness(Machine::default()).await;
    let t = transfer();
    let report = apply(&t, &h).await.unwrap();
    assert_eq!(report.outcome, Outcome::Success);
    assert_eq!(report.handshake.act_sku, "MH1253R");
    assert_eq!(report.handshake.act_rev, 0x12345678);
    assert_eq!((report.handshake.pc_cmd, report.handshake.plc_ack), (0, 0));
    let m = h.machine.lock().unwrap();
    let layout: Vec<_> = m
        .writes
        .iter()
        .map(|(fc, addr, words)| (*fc, *addr, words.len()))
        .collect();
    assert_eq!(
        layout,
        [
            (16, 20020, 100),
            (16, 20120, 100),
            (16, 20220, 72),
            (6, 20000, 1),
            (6, 20000, 1)
        ]
    );
    assert_eq!(m.writes[3].2, [1]);
    assert_eq!(m.writes[4].2, [0]);
    assert_eq!(
        &m.regs[20020..20292],
        encode::encode(&saved_recipe()).unwrap().as_slice()
    );
}

#[tokio::test]
async fn preconditions_revision_validation_and_capacity_never_write() {
    let h = harness(Machine::default()).await;
    assert_eq!(
        apply(&RecipeTransfer::new(TransferConfig::default()), &h)
            .await
            .unwrap_err()
            .kind,
        Outcome::Failed
    );
    for recipe in [
        {
            let mut r = saved_recipe();
            r.stations.butt.num_points = Some(0);
            r
        },
        {
            let mut r = saved_recipe();
            r.stations.tip.enabled = Some(2);
            r
        },
        {
            let mut r = saved_recipe();
            r.summary.configured = false;
            r
        },
        {
            let mut r = saved_recipe();
            r.stations.butt.num_points = Some(5);
            r.stations.butt.points = std::array::from_fn(|_| r.stations.butt.points[0].clone());
            assert!(encode::encode(&r).is_ok());
            r
        },
        {
            let mut r = saved_recipe();
            r.stations.tip = r.stations.butt.clone();
            r.stations.tip.num_points = Some(5);
            r.stations.tip.points = std::array::from_fn(|_| r.stations.butt.points[0].clone());
            assert!(encode::encode(&r).is_ok());
            r
        },
        {
            let mut r = saved_recipe();
            r.stations.butt.points[0].load = Some(0.0);
            r
        },
        {
            let mut r = saved_recipe();
            r.summary.recipe_rev += 1;
            r
        },
    ] {
        assert!(
            transfer()
                .apply(&h.plc, saved_recipe().summary.recipe_rev, async {
                    Ok(recipe)
                })
                .await
                .is_err()
        );
    }
    for (addr, value) in [(20002, 0), (20001, 1), (20000, 1)] {
        h.machine.lock().unwrap().regs[addr] = value;
        assert_eq!(
            apply(&transfer(), &h).await.unwrap_err().kind,
            Outcome::Failed
        );
        h.machine.lock().unwrap().regs[addr] = if addr == 20002 { 1 } else { 0 };
    }
    assert!(h.machine.lock().unwrap().writes.is_empty());
}

#[tokio::test]
async fn variable_counts_through_four_per_station_and_disabled_stations_can_transfer() {
    let h = harness(Machine::default()).await;
    let t = transfer();
    for (butt_count, tip_count) in [(1, 1), (2, 3), (4, 4)] {
        let mut r = saved_recipe();
        r.stations.butt.num_points = Some(butt_count);
        r.stations.tip = r.stations.butt.clone();
        r.stations.tip.num_points = Some(tip_count);
        let rev = r.summary.recipe_rev;
        assert_eq!(
            t.apply(&h.plc, rev, async { Ok(r) }).await.unwrap().outcome,
            Outcome::Success
        );
    }
    let mut r = saved_recipe();
    r.stations.tip.enabled = Some(0);
    r.stations.tip.num_points = Some(10);
    let rev = r.summary.recipe_rev;
    assert_eq!(
        t.apply(&h.plc, rev, async { Ok(r) }).await.unwrap().outcome,
        Outcome::Success
    );
    assert!(
        h.machine.lock().unwrap().regs[20156..20276]
            .iter()
            .all(|&v| v == 0)
    );
}

#[tokio::test]
async fn plc_rejections_are_translated_and_handshake_is_closed() {
    for code in [
        10, 11, 12, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 99,
    ] {
        let h = harness(Machine {
            ack: code,
            ..Machine::default()
        })
        .await;
        let t = transfer();
        let report = apply(&t, &h).await.unwrap();
        assert_eq!(report.outcome, Outcome::Failed);
        assert_eq!(report.message, ack_message(code));
        assert_eq!((report.handshake.pc_cmd, report.handshake.plc_ack), (0, 0));
        assert!(!t.status(&h.plc).await.needs_reconcile);
    }
}

#[tokio::test]
async fn failed_middle_chunk_and_late_busy_do_not_send_apply_command() {
    for machine in [
        Machine {
            fail_chunk: Some(2),
            ..Machine::default()
        },
        Machine {
            busy_after_data: true,
            ..Machine::default()
        },
    ] {
        let h = harness(machine).await;
        let error = apply(&transfer(), &h).await.unwrap_err();
        assert_eq!(error.kind, Outcome::Failed);
        assert!(
            h.machine
                .lock()
                .unwrap()
                .writes
                .iter()
                .all(|(fc, _, _)| *fc == 16)
        );
    }
}

#[tokio::test]
async fn timeout_keeps_cmd_and_requires_terminal_ack_before_reconcile() {
    let h = harness(Machine {
        ack: 0,
        ..Machine::default()
    })
    .await;
    let t = transfer();
    let start = Instant::now();
    assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Unknown);
    assert!(start.elapsed() >= ACK_TIMEOUT && start.elapsed() < Duration::from_secs(5));
    let count = h.machine.lock().unwrap().writes.len();
    assert_eq!(count, 4); // Three blocks + one command, no premature PC_Cmd=0.
    assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Unknown);
    assert_eq!(
        t.reconcile(&h.plc).await.unwrap_err().kind,
        Outcome::Unknown
    );
    assert_eq!(h.machine.lock().unwrap().writes.len(), count);
    assert!(h.machine.lock().unwrap().reads < 45); // Sleep between polls, no busy-loop.
    h.machine.lock().unwrap().regs[20001] = 10; // A late terminal PLC response.
    assert_eq!(t.reconcile(&h.plc).await.unwrap().outcome, Outcome::Failed);
    assert!(!t.status(&h.plc).await.needs_reconcile);
}

#[tokio::test]
async fn active_sku_or_revision_mismatch_never_reports_success() {
    for machine in [
        Machine {
            wrong_sku: true,
            ..Machine::default()
        },
        Machine {
            wrong_rev: true,
            ..Machine::default()
        },
    ] {
        let h = harness(machine).await;
        let t = transfer();
        let report = apply(&t, &h).await.unwrap();
        assert_eq!(report.outcome, Outcome::Unknown);
        assert_eq!((report.handshake.pc_cmd, report.handshake.plc_ack), (0, 0));
        assert!(t.status(&h.plc).await.needs_reconcile);
        assert!(apply(&t, &h).await.is_err());
        assert_eq!(t.reconcile(&h.plc).await.unwrap().outcome, Outcome::Unknown);
        assert!(!t.status(&h.plc).await.needs_reconcile);
    }
}

#[tokio::test]
async fn simultaneous_apply_requests_have_only_one_writer() {
    let h = harness(Machine::default()).await;
    let t = transfer();
    let (a, b) = tokio::join!(apply(&t, &h), apply(&t, &h));
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(h.machine.lock().unwrap().writes.len(), 5);
}

#[tokio::test]
async fn lost_command_or_reset_reply_does_not_retry_and_recovers_by_reading() {
    for reset in [false, true] {
        let h = harness(Machine {
            lose_cmd_response: !reset,
            lose_reset_response: reset,
            ..Machine::default()
        })
        .await;
        let t = transfer();
        let mut connection_changes = h.plc.subscribe_status();
        connection_changes.borrow_and_update();
        assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Unknown);
        let count = h.machine.lock().unwrap().writes.len();
        // The Actor sends the failed reply before publishing Disconnected.
        // Wait for a connection event, not the stale Connected snapshot.
        timeout(Duration::from_secs(2), connection_changes.changed())
            .await
            .unwrap()
            .unwrap();
        connected(&h.plc).await;
        assert!(t.status(&h.plc).await.needs_reconcile);
        assert!(apply(&t, &h).await.is_err());
        assert_eq!(h.machine.lock().unwrap().writes.len(), count);
        let report = t.reconcile(&h.plc).await.unwrap();
        assert_eq!(
            report.outcome,
            if reset {
                Outcome::Unknown
            } else {
                Outcome::Success
            }
        );
        assert!(!t.status(&h.plc).await.needs_reconcile);
        assert_eq!(
            h.machine
                .lock()
                .unwrap()
                .writes
                .iter()
                .filter(|(fc, addr, v)| *fc == 6 && *addr == 20000 && v == &[1])
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn ack_must_return_to_zero_and_unknown_ack_is_not_reset() {
    let h = harness(Machine {
        hold_reset: true,
        ..Machine::default()
    })
    .await;
    let t = transfer();
    assert_eq!(apply(&t, &h).await.unwrap_err().kind, Outcome::Unknown);
    assert!(t.status(&h.plc).await.needs_reconcile);
    let h = harness(Machine {
        ack: 2,
        ..Machine::default()
    })
    .await;
    assert_eq!(
        apply(&transfer(), &h).await.unwrap_err().kind,
        Outcome::Unknown
    );
    assert_eq!(h.machine.lock().unwrap().writes.len(), 4);
}

#[tokio::test]
async fn existing_poller_still_collects_and_acknowledges_records() {
    let h = harness(Machine {
        record_on_command: true,
        ..Machine::default()
    })
    .await;
    let (events, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let (saved, mut saved_rx) = tokio::sync::mpsc::unbounded_channel();
    let poller = tokio::spawn(run_poller(
        h.plc.clone(),
        Duration::from_millis(20),
        move |event| {
            let _ = events.send(event);
        },
        move |record| {
            let saved = saved.clone();
            async move {
                let _ = saved.send(record);
            }
        },
    ));
    timeout(Duration::from_secs(2), async {
        while !matches!(rx.recv().await.unwrap(), PollEvent::Control(_)) {}
    })
    .await
    .unwrap(); // Poller has observed DataReady=0.
    assert_eq!(
        apply(&transfer(), &h).await.unwrap().outcome,
        Outcome::Success
    );
    let record = timeout(Duration::from_secs(2), saved_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(record.stick_no, 4242);
    timeout(Duration::from_secs(2), async {
        loop {
            if h.machine.lock().unwrap().regs[25012] == 1 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(h.machine.lock().unwrap().regs[25008], 1);
    poller.abort();
}

#[test]
fn commissioning_is_fail_closed_and_fc16_limit_has_no_default() {
    assert!(TransferConfig::default().check_commissioning().is_err());
    assert!(TransferConfig::default().chunk_words().is_err());
    for n in [None, Some(0), Some(124)] {
        let cfg = TransferConfig {
            commissioned: true,
            max_write_words: n,
            confirmation_reference: "test only".into(),
        };
        assert!(cfg.chunk_words().is_err());
    }
    for n in [1, 100, 123] {
        let cfg = TransferConfig {
            commissioned: true,
            max_write_words: Some(n),
            confirmation_reference: "test only".into(),
        };
        assert_eq!(cfg.chunk_words().unwrap(), n as usize);
    }
    let cfg: crate::config::AppConfig = toml::from_str("").unwrap();
    assert!(cfg.recipe_transfer.check_commissioning().is_err());
    assert!(cfg.recipe_transfer.chunk_words().is_err());
    assert!(Handshake::decode(&[0; 19]).is_err());
    let mut invalid = [0; 20];
    invalid[4] = 0xff;
    assert!(Handshake::decode(&invalid).is_err());
}

#[tokio::test]
async fn shutdown_refuses_pending_recipe_and_waits_for_result_ack_retry() {
    let transfer = transfer();
    assert!(transfer.ensure_shutdown_safe().is_ok());
    {
        let mut pending = transfer.pending.lock().await;
        assert!(transfer.ensure_shutdown_safe().is_err());
        *pending = Some(Expected { sku: "MH1253R".into(), rev: 1 });
    }
    assert!(transfer.ensure_shutdown_safe().is_err());

    let h = harness(Machine { reject_result_ack: true, ..Machine::default() }).await;
    let (pause, pause_rx) = watch::channel(false);
    let (paused, mut paused_rx) = watch::channel(false);
    let (events, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let saves = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let saved = saves.clone();
    let poller = tokio::spawn(crate::plc::run_poller_with_shutdown(h.plc.clone(), Duration::from_millis(10),
        move |e| { let _ = events.send(e); },
        move |_| { saved.fetch_add(1, std::sync::atomic::Ordering::SeqCst); async {} }, pause_rx, paused));
    timeout(Duration::from_secs(2), async {
        while !matches!(rx.recv().await, Some(PollEvent::Control(c)) if c.data_ready == 0) {}
    }).await.unwrap();
    h.machine.lock().unwrap().regs[25011] = 1;
    timeout(Duration::from_secs(2), async {
        while !matches!(rx.recv().await, Some(PollEvent::Error(_))) {}
    }).await.unwrap();
    pause.send_replace(true);
    assert!(timeout(Duration::from_millis(80), paused_rx.wait_for(|v| *v)).await.is_err());
    h.machine.lock().unwrap().reject_result_ack = false;
    timeout(Duration::from_secs(2), paused_rx.wait_for(|v| *v)).await.unwrap().unwrap();
    assert_eq!(h.machine.lock().unwrap().regs[25012], 1);
    assert_eq!(h.machine.lock().unwrap().regs[25008], 1);
    assert_eq!(saves.load(std::sync::atomic::Ordering::SeqCst), 1);
    poller.abort();
}
