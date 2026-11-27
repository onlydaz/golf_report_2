import { useLive, useProduction } from "../app/LiveProvider";
import "./ProductionConfirmation.css";

export default function ProductionConfirmation() {
  const { snapshot } = useProduction();
  const { plcStatus } = useLive();
  const confirmed = plcStatus?.state === "connected" && !!snapshot?.selection && !snapshot?.error;
  return <small className="production-confirmation" data-confirmed={confirmed} role="status">
    {confirmed ? "Đã xác nhận với PLC" : "Chưa xác nhận với PLC"}
  </small>;
}
