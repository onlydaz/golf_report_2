import { useState } from "react";
import { Alert, Form, Input, Modal } from "antd";
import { useAuth } from "../app/AuthProvider";
import { errorText } from "../lib/db";
import PasswordFields from "./PasswordFields";

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (values: { currentPassword: string; password: string }) => {
    setBusy(true); setError("");
    try {
      await changePassword(values.currentPassword, values.password);
      form.resetFields(); onClose();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <Modal open title="Đổi mật khẩu"
    okText="Đổi mật khẩu" cancelText="Hủy"
    confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy}
    maskClosable={false} keyboard={!busy} onOk={() => form.submit()} onCancel={onClose}>
    {error && <Alert type="error" showIcon title={error} className="auth-error" />}
    <Form form={form} layout="vertical" disabled={busy} onFinish={submit} preserve={false} clearOnDestroy>
      <Form.Item name="currentPassword" label="Mật khẩu hiện tại" rules={[{ required: true, message: "Vui lòng nhập mật khẩu hiện tại." }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <PasswordFields label="Mật khẩu mới" />
      <button type="submit" hidden />
    </Form>
  </Modal>;
}
