import { ConfigProvider } from "antd";
import viVN from "antd/locale/vi_VN";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { createHashRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./app/AuthProvider";
import AuthGate from "./app/AuthGate";
import Workspace from "./app/Workspace";
import { antdTheme } from "./theme/tokens";

dayjs.locale("vi");

// Data router enables the recipe page's unsaved-change navigation blocker.
// Keep hash URLs and Workspace's existing mounted-page behavior.
const router = createHashRouter([
  { element: <AuthGate />, children: [{ path: "*", element: <Workspace /> }] },
]);

export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={antdTheme}>
      <AuthProvider>
        {/* Hash routes: no server-side fallback needed under Tauri's asset protocol. */}
        <RouterProvider router={router} />
      </AuthProvider>
    </ConfigProvider>
  );
}
