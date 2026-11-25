import { Alert, Layout, Menu } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useLive } from "../app/LiveProvider";
import logo from "../assets/logo-new-ocean.png";
import "./MainLayout.css";

const items = [
  { key: "/monitor", icon: <span className="sidebar-number">1</span>, label: "Giám sát" },
  { key: "/history", icon: <span className="sidebar-number">2</span>, label: "Lịch sử" },
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <Layout className="app-layout">
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
        <Menu theme="dark" mode="inline" selectedKeys={[pathname]} items={items} onClick={({ key }) => navigate(key)} />
      </Layout.Sider>
      <Layout>
        <Layout.Content className="main-content">
          <DatabaseBanner />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
