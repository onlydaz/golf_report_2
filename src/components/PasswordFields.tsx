import { Form, Input } from "antd";

/** Shared password rules for creation, reset and personal password changes. */
export default function PasswordFields({ label = "Mật khẩu" }: { label?: string }) {
  return <>
    <Form.Item name="password" label={label} rules={[
      { required: true, message: "Vui lòng nhập mật khẩu." },
      { validator: (_, value: string | undefined) => {
        if (!value) return Promise.resolve();
        if (new TextEncoder().encode(value).length > 1024) {
          return Promise.reject(new Error("Mật khẩu quá dài. Vui lòng chọn mật khẩu ngắn hơn."));
        }
        return [...value].length >= 6 ? Promise.resolve()
          : Promise.reject(new Error("Mật khẩu phải có ít nhất 6 ký tự."));
      } },
    ]}>
      <Input.Password autoComplete="new-password" />
    </Form.Item>
    <Form.Item name="confirmation" label={`Xác nhận ${label.toLowerCase()}`} dependencies={["password"]} rules={[
      { required: true, message: "Vui lòng xác nhận mật khẩu." },
      ({ getFieldValue }) => ({ validator: (_, value) => !value || value === getFieldValue("password")
        ? Promise.resolve() : Promise.reject(new Error("Mật khẩu xác nhận không khớp.")) }),
    ]}>
      <Input.Password autoComplete="new-password" />
    </Form.Item>
  </>;
}
