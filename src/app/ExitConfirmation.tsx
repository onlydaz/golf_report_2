import { useEffect, useRef, useState } from "react";
import { Alert, Modal } from "antd";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { errorText } from "../lib/db";

export default function ExitConfirmation({ draftDirty = false, applying = false }: { draftDirty?: boolean; applying?: boolean }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen("app://confirm-exit", () => {
      if (!disposed && !inFlight.current) setOpen(true);
    }).then(off => { if (disposed) off(); else unlisten = off; })
      .catch(e => { if (!disposed) { setError(`Không đăng ký được xác nhận thoát: ${errorText(e)}`); setOpen(true); } });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const exit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setClosing(true); setError("");
    try {
      await invoke("app_shutdown");
      // Keep the dialog locked until the backend exits; no second close request.
    } catch (e) {
      setError(errorText(e)); setClosing(false); inFlight.current = false;
    }
  };
  return <Modal open={open} title="Xác nhận thoát ứng dụng" okText="Thoát" cancelText="Hủy"
    confirmLoading={closing} okButtonProps={{ disabled: applying }} cancelButtonProps={{ disabled: closing }}
    closable={!closing} maskClosable={false} keyboard={!closing}
    onCancel={() => { if (!closing) { setOpen(false); setError(""); } }} onOk={exit}>
    <p>Bạn có chắc chắn muốn tắt phần mềm không?</p>
    <p>Quá trình thu thập dữ liệu từ PLC sẽ dừng khi ứng dụng đóng.</p>
    {draftDirty && <Alert type="warning" showIcon title="Công thức có thay đổi chưa lưu. Thoát sẽ bỏ các thay đổi này." />}
    {applying && <Alert type="info" showIcon title="Vui lòng chờ thao tác công thức PLC hoàn tất." />}
    {closing && <p>Đang chờ lưu dữ liệu và hoàn tất chu kỳ thu thập…</p>}
    {error && <Alert type="error" showIcon title={error} />}
  </Modal>;
}
