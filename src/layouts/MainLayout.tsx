import { useState } from "react";
import { Alert, Avatar, Dropdown, Layout, Menu, message } from "antd";
import { LockOutlined, LogoutOutlined, UpOutlined, UserOutlined } from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useLive, useLiveRecipe } from "../app/LiveProvider";
import { useAuth } from "../app/AuthProvider";
import { roleLabel } from "../lib/auth";
import { errorText } from "../lib/db";
import ChangePasswordModal from "../components/ChangePasswordModal";
import type { MeasurementNavigation } from "../lib/useOpenStick";
import logo from "../assets/logo-new-ocean.png";
import "./MainLayout.css";

const items = [
  { key: "/monitor", icon: <span className="sidebar-number">1</span>, label: "Giám sát" },
  { key: "/history", icon: <span className="sidebar-number">2</span>, label: "Lịch sử" },
  { key: "/reports", icon: <span className="sidebar-number">3</span>, label: "Báo cáo" },
  { key: "/plc", icon: <span className="sidebar-number">4</span>, label: "Kết nối PLC" },
  { key: "/recipe", icon: <span className="sidebar-number">5</span>, label: "Công thức đo" },
];

function DatabaseBanner() {
  const { dbStatus } = useLive();
  if (dbStatus.connected) return null;
  return dbStatus.error ? (
    <Alert
      className="db-banner"
      type="error"
      showIcon
      title="Không kết nối được cơ sở dữ liệu. Đang thử lại sau 5 giây…"
      description={dbStatus.error}
    />
  ) : (
    <Alert className="db-banner" type="info" showIcon title="Đang kết nối cơ sở dữ liệu…" />
  );
}

export default function MainLayout() {
  const { user, logout } = useAuth();
  const { applying } = useLiveRecipe();
  const [changingPassword, setChangingPassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [messages, holder] = message.useMessage();
  const accountBusy = loggingOut || applying;
  const signOut = async () => {
    setLoggingOut(true);
    try { await logout(); }
    catch (e) { messages.error(errorText(e)); }
    finally { setLoggingOut(false); }
  };
  const menuItems = user?.role === "ADMIN" ? [...items,
    { key: "/users", icon: <span className="sidebar-number">6</span>, label: "Quản lý tài khoản" },
  ] : items;
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const selectedPath = pathname.startsWith("/measurements/")
    ? (state as MeasurementNavigation | null)?.background?.pathname ?? "/history"
    : pathname;
  return (
    <Layout className="app-layout">
      {holder}
      <Layout.Sider width={220} className="main-sider">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="New Ocean Group" />
          <div className="brand-title">
            Thu Thập Dữ Liệu
            <br />
            Độ Cong Gậy Golf
          </div>
        </div>
        <div className="side-section">CHỨC NĂNG CHÍNH</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedPath]} items={menuItems} onClick={({ key }) => navigate(key)} />
        <div className="sidebar-account">
          <Dropdown trigger={["click"]} placement="topLeft" disabled={accountBusy} menu={{
            items: [
              { key: "password", icon: <LockOutlined />, label: "Đổi mật khẩu", disabled: accountBusy },
              { key: "logout", icon: <LogoutOutlined />, label: "Đăng xuất", danger: true, disabled: accountBusy },
            ],
            onClick: ({ key }) => {
              if (accountBusy) return;
              if (key === "password") setChangingPassword(true);
              else if (key === "logout") void signOut();
            },
          }}>
            <button type="button" className="sidebar-account-trigger" disabled={accountBusy} aria-label="Mở menu tài khoản" aria-haspopup="menu">
              <Avatar size={40} icon={<UserOutlined />} />
              <span className="sidebar-account-details">
                <strong title={user?.username}>{user?.username}</strong>
                <span>{user && roleLabel(user.role)}</span>
              </span>
              <UpOutlined className="sidebar-account-arrow" />
            </button>
          </Dropdown>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Content className="main-content">
          <DatabaseBanner />
          <Outlet />
        </Layout.Content>
      </Layout>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </Layout>
  );
}
