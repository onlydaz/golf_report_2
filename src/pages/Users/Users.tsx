import { useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Table, Tag, Tooltip, message } from "antd";
import { EditOutlined, KeyOutlined, LockOutlined, UnlockOutlined, UserAddOutlined } from "@ant-design/icons";
import PageHeader from "../../components/PageHeader";
import PasswordFields from "../../components/PasswordFields";
import { usersApi, roleLabel, type User } from "../../lib/auth";
import { errorText } from "../../lib/db";
import { fmtDateTime } from "../../lib/format";
import { useQuery } from "../../lib/useQuery";
import "./Users.css";

type Edit = { kind: "create" } | { kind: "edit" | "reset"; user: User };

function UserEditor({ edit, onClose, onSaved }: { edit: Edit; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (values: { username: string; displayName: string; password: string }) => {
    setBusy(true); setError("");
    try {
      if (edit.kind === "create") await usersApi.create(values.username, values.displayName, values.password);
      else if (edit.kind === "edit") await usersApi.update(edit.user.id, values.displayName);
      else await usersApi.resetPassword(edit.user.id, values.password);
      form.resetFields(); onSaved();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <Modal open title={edit.kind === "create" ? "Thêm nhân viên" : edit.kind === "edit" ? "Chỉnh sửa tên nhân viên" : "Đặt lại mật khẩu"}
    okText="Lưu" cancelText="Hủy" confirmLoading={busy} cancelButtonProps={{ disabled: busy }}
    closable={!busy} maskClosable={false} keyboard={!busy} onCancel={onClose} onOk={() => form.submit()}>
    {edit.kind !== "create" && <p>Tài khoản: <strong>{edit.user.username}</strong></p>}
    {error && <Alert type="error" showIcon title={error} className="auth-error" />}
    <Form form={form} layout="vertical" onFinish={save} disabled={busy} preserve={false} clearOnDestroy
      initialValues={edit.kind === "edit" ? { displayName: edit.user.displayName } : undefined}>
      {edit.kind !== "reset" && <Form.Item name="displayName" label="Tên nhân viên" rules={[
        { required: true, whitespace: true, message: "Vui lòng nhập tên nhân viên." },
        { max: 100, message: "Tên nhân viên không quá 100 ký tự." },
      ]}><Input maxLength={100} autoComplete="off" /></Form.Item>}
      {edit.kind === "create" && <Form.Item name="username" label="Tên đăng nhập" rules={[
        { required: true, message: "Vui lòng nhập tên đăng nhập." },
        { pattern: /^[a-zA-Z0-9_.-]{3,64}$/, message: "Dùng 3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang." },
      ]}><Input maxLength={64} autoComplete="off" /></Form.Item>}
      {edit.kind !== "edit" && <PasswordFields />}
      <button type="submit" hidden />
    </Form>
  </Modal>;
}

export default function Users() {
  const [version, setVersion] = useState(0);
  const [edit, setEdit] = useState<Edit>();
  const [changing, setChanging] = useState<number>();
  const [messages, holder] = message.useMessage();
  const { data, error, loading } = useQuery(true, usersApi.list, [version]);
  const toggle = async (user: User) => {
    setChanging(user.id);
    try { await usersApi.setActive(user.id, !user.isActive); setVersion(v => v + 1); messages.success("Đã cập nhật trạng thái tài khoản."); }
    catch (e) { messages.error(errorText(e)); }
    finally { setChanging(undefined); }
  };
  return <div>
    {holder}<PageHeader title="6 · Quản lý tài khoản" />
    {error && <Alert type="error" showIcon title={error} className="auth-error" action={<Button onClick={() => setVersion(v => v + 1)}>Thử lại</Button>} />}
    <Card className="section-card" title="Danh sách tài khoản" extra={<Button type="primary" icon={<UserAddOutlined />} onClick={() => setEdit({ kind: "create" })}>Thêm nhân viên</Button>}>
      <Table<User> className="users-table" rowKey="id" dataSource={data} loading={loading} pagination={false} scroll={{ x: 1000 }} columns={[
        { title: "STT", key: "number", align: "center", width: 60, render: (_, __, index) => index + 1 },
        { title: "Tên đăng nhập", dataIndex: "username", align: "center" },
        { title: "Tên nhân viên", dataIndex: "displayName", align: "center" },
        { title: "Quyền", dataIndex: "role", align: "center", render: (role: User["role"]) => roleLabel(role) },
        { title: "Trạng thái", dataIndex: "isActive", align: "center", render: (active: boolean) => <Tag color={active ? "green" : "red"}>{active ? "Hoạt động" : "Đã khóa"}</Tag> },
        { title: "Ngày tạo", dataIndex: "createdAt", align: "center", render: (date: string) => fmtDateTime(date) },
        { title: "Thao tác", key: "actions", align: "center", width: 140, render: (_, user) => user.role === "ADMIN" ? "—" : <div className="users-actions">
          <Tooltip title="Sửa tên">
            <Button size="small" icon={<EditOutlined />} aria-label="Sửa tên" disabled={changing !== undefined}
              onClick={() => setEdit({ kind: "edit", user })} />
          </Tooltip>
          <Tooltip title="Đặt lại mật khẩu">
            <Button size="small" icon={<KeyOutlined />} aria-label="Đặt lại mật khẩu" disabled={changing !== undefined}
              onClick={() => setEdit({ kind: "reset", user })} />
          </Tooltip>
          <Tooltip title={user.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}>
            <Popconfirm title={`${user.isActive ? "Khóa" : "Mở khóa"} tài khoản ${user.username}?`}
              okText="Xác nhận" cancelText="Hủy" onConfirm={() => toggle(user)} disabled={changing !== undefined}>
              <Button size="small" icon={user.isActive ? <LockOutlined /> : <UnlockOutlined />}
                aria-label={user.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}
                danger={user.isActive} loading={changing === user.id} disabled={changing !== undefined} />
            </Popconfirm>
          </Tooltip>
        </div> },
      ]} />
    </Card>
    {edit && <UserEditor edit={edit} onClose={() => setEdit(undefined)} onSaved={() => {
      setEdit(undefined); setVersion(v => v + 1); messages.success("Đã lưu tài khoản.");
    }} />}
  </div>;
}
