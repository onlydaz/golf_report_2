import { ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { HashRouter, Navigate, Route, Routes } from "react-router";
import { LiveProvider } from "./app/LiveProvider";
import MainLayout from "./layouts/MainLayout";
import History from "./pages/History/History";
import Monitor from "./pages/Monitor/Monitor";
import { antdTheme } from "./theme/tokens";

dayjs.locale("vi");

export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={antdTheme}>
      <LiveProvider>
        {/* Hash routes: no server-side fallback needed under Tauri's asset protocol. */}
        <HashRouter>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/monitor" element={<Monitor />} />
              <Route path="/history" element={<History />} />
              <Route path="*" element={<Navigate to="/monitor" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </LiveProvider>
    </ConfigProvider>
  );
}
