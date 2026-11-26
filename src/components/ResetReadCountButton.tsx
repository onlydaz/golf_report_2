import { useState } from "react";
import { Button, Popconfirm, message } from "antd";
import { useLive } from "../app/LiveProvider";
import { resetReadCount } from "../lib/plc";

/** Existing reset action, shared independently of its display location. */
export default function ResetReadCountButton() {
  const { plcStatus } = useLive();
  const [resetting, setResetting] = useState(false);
  const [messages, contextHolder] = message.useMessage();
  const reset = async () => {
    setResetting(true);
    try {
      await resetReadCount();
      messages.success("Đã đặt PC_ReadCount về 0");
    } catch (e) {
      const msg = typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
      messages.error(`Không reset được PC_ReadCount: ${msg}`);
    } finally {
      setResetting(false);
    }
  };
  return (
    <>
    {contextHolder}
    <Popconfirm title="Đặt PC_ReadCount về 0?" okText="Reset" cancelText="Huỷ" onConfirm={reset}>
      <Button size="small" loading={resetting} disabled={plcStatus?.state !== "connected"}>Reset</Button>
    </Popconfirm>
    </>
  );
}
