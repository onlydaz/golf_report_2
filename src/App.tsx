import { ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { createHashRouter, RouterProvider } from "react-router";
import { LiveProvider } from "./app/LiveProvider";
import ExitConfirmation from "./app/ExitConfirmation";
import MainLayout from "./layouts/MainLayout";
import Workspace from "./app/Workspace";
import { antdTheme } from "./theme/tokens";

dayjs.locale("vi");

// Data router enables the recipe page's unsaved-change navigation blocker.
// Keep hash URLs and Workspace's existing mounted-page behavior.
const router = createHashRouter([
  { element: <MainLayout />, children: [{ path: "*", element: <Workspace /> }] },
]);

export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={antdTheme}>
      <LiveProvider>
        <ExitConfirmation />
        {/* Hash routes: no server-side fallback needed under Tauri's asset protocol. */}
        <RouterProvider router={router} />
      </LiveProvider>
    </ConfigProvider>
  );
}
