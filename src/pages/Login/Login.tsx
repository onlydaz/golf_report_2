import { useState, type ReactNode } from "react";
import { Alert, Button, Form, Input } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useAuth } from "../../app/AuthProvider";
import { errorText } from "../../lib/db";
import logo from "../../assets/logo-new-ocean.png";
import "./Login.css";

export function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="auth-screen"><section className="auth-card" aria-label="Đăng nhập Golf Report">
    <div className="auth-brand"><img src={logo} alt="New Ocean Group" />
      <h1>Thu Thập Dữ Liệu<br />Độ Cong Gậy Golf</h1>
      <p>Hệ thống giám sát và quản lý kết quả đo</p>
    </div>
    <div className="auth-form-panel"><div className="auth-form-content">{children}</div></div>
  </section></main>;
}

export default function Login() {
  const { login, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (values: { username: string; password: string }) => {
    setBusy(true); setError("");
    try {
      await login(values.username, values.password);
      form.resetFields(); navigate("/monitor", { replace: true });
    } catch (e) { setError(errorText(e)); form.setFieldValue("password", ""); }
    finally { setBusy(false); }
  };
  return <AuthScreen>
    <header className="auth-form-heading">
      <h2>Đăng nhập</h2>
      <p>Đăng nhập để sử dụng phần mềm</p>
    </header>
    {(error || sessionError) && <Alert type="error" showIcon title={error || sessionError} className="auth-error" />}
    <Form form={form} layout="vertical" onFinish={submit} disabled={busy} preserve={false} clearOnDestroy>
      <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, whitespace: true, message: "Vui lòng nhập tên đăng nhập." }]}>
        <Input prefix={<UserOutlined />} placeholder="Nhập tên đăng nhập" autoFocus autoComplete="username" maxLength={64} />
      </Form.Item>
      <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: "Vui lòng nhập mật khẩu." }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="Nhập mật khẩu" autoComplete="current-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>Đăng nhập</Button>
    </Form>
  </AuthScreen>;
}
