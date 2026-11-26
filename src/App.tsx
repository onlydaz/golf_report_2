import { ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { HashRouter, Route, Routes } from "react-router";
import { LiveProvider } from "./app/LiveProvider";
import MainLayout from "./layouts/MainLayout";
import Workspace from "./app/Workspace";
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
              <Route path="*" element={<Workspace />} />
            </Route>
          </Routes>
        </HashRouter>
      </LiveProvider>
    </ConfigProvider>
  );
}
