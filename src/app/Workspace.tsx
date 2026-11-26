import { Navigate, Route, Routes, useLocation } from "react-router";
import { useLayoutEffect, useRef } from "react";
import Monitor from "../pages/Monitor/Monitor";
import History from "../pages/History/History";
import Reports from "../pages/Reports/Reports";
import PlcConnection from "../pages/PlcConnection/PlcConnection";
import Recipe from "../pages/Recipe/Recipe";
import MeasurementDetail from "../pages/MeasurementDetail/MeasurementDetail";
import type { MeasurementNavigation } from "../lib/useOpenStick";

/** Keep the originating page mounted so its filters, SKU and pagination survive Back. */
export default function Workspace() {
  const location = useLocation();
  const isDetail = location.pathname.startsWith("/measurements/");
  const background = isDetail ? (location.state as MeasurementNavigation | null)?.background : undefined;
  const returnScroll = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const content = document.querySelector(".main-content");
    if (!content) return;
    if (isDetail) {
      returnScroll.current = (location.state as MeasurementNavigation | null)?.scrollTop;
      content.scrollTop = 0;
    } else if (returnScroll.current !== undefined) {
      content.scrollTop = returnScroll.current;
      returnScroll.current = undefined;
    }
  }, [isDetail, location.key, location.state]);
  return <>
    <div hidden={isDetail}>
      <Routes location={background ?? location}>
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/history" element={<History />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/plc" element={<PlcConnection />} />
        <Route path="/recipe" element={<Recipe />} />
        <Route path="/measurements/:id" element={null} />
        <Route path="*" element={<Navigate to="/monitor" replace />} />
      </Routes>
    </div>
    {isDetail && <Routes>
      <Route path="/measurements/:id" element={<MeasurementDetail key={location.key} />} />
    </Routes>}
  </>;
}
