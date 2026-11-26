# Golf Report V2 — New Ocean Group

## 1. Giới thiệu

Phần mềm thu thập dữ liệu độ cong gậy golf của **New Ocean Group**, kết nối PLC Delta AS200 thông qua Modbus TCP.

### Chức năng chính

- **Giám sát:** Theo dõi kết quả đo BUTT/TIP và thống kê OK/NG.
- **Lịch sử:** Tra cứu kết quả và chi tiết phép đo.
- **Báo cáo:** Thống kê, biểu đồ và xuất Excel.
- **Kết nối PLC:** Theo dõi trạng thái kết nối và truyền thông.
- **Công thức đo:** Quản lý thông số theo SKU và nạp công thức xuống PLC.

### Công nghệ

React, TypeScript, Vite, Ant Design, Tauri 2, Rust, PostgreSQL và Modbus TCP.

## 2. Yêu cầu môi trường

- Git
- Node.js 22.12 trở lên hoặc Node.js 24
- Rust Stable
- PostgreSQL

Trên Ubuntu, cài đặt thêm các thư viện cần thiết:

```bash
sudo apt update
sudo apt install git build-essential pkg-config curl wget file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

## 3. Tải source code

```bash
git clone https://github.com/onlydaz/golf_report_2.git
cd golf_report_2
npm ci
```

## 4. Cấu hình

### PostgreSQL

Nếu Ubuntu chưa cài PostgreSQL:

```bash
sudo apt install postgresql postgresql-client
sudo systemctl enable --now postgresql
```

Tạo tài khoản database nếu chưa có:

```bash
sudo -u postgres createuser --login --createdb --pwprompt golf_report_app
```

Sao chép file cấu hình:

```bash
cp -n src-tauri/config.example.toml src-tauri/config.toml
```

Chỉnh sửa thông tin database trong `src-tauri/config.toml`:

```toml
[database]
host = "localhost"
port = 5432
user = "golf_report_app"
password = "YOUR_PASSWORD"
dbname = "golf_report"
max_connections = 5
```

Ứng dụng tự tạo database và các bảng cần thiết khi khởi động nếu tài khoản có đủ quyền.

Không đưa file chứa mật khẩu lên GitHub.

### PLC

Thông số kết nối mặc định:

| Thông số | Giá trị |
|---|---|
| IP | 192.168.1.49 |
| Port | 502 |
| Unit ID | 1 |
| Chu kỳ đọc | 500 ms |

Cấu hình PLC nằm trong `src-tauri/src/plc/config.rs`. Nếu thay đổi cần build lại ứng dụng.

Chức năng nạp công thức xuống PLC mặc định bị khóa. Chỉ mở khóa cấu hình `[recipe_transfer]` sau khi được kỹ thuật viên xác nhận.

## 5. Chạy ứng dụng

Tại thư mục gốc của project:

```bash
npm run tauri dev
```

Ứng dụng tự kết nối PostgreSQL và PLC khi khởi động.

## 6. Build và cài đặt trên Ubuntu

### Bước 1: Build ứng dụng

```bash
npm run tauri -- build --bundles deb
```

File cài đặt được tạo tại:

```text
src-tauri/target/release/bundle/deb/
```

### Bước 2: Cài đặt

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/golf-report-v2_*.deb
```

### Bước 3: Cấu hình lần đầu

```bash
mkdir -p ~/.config/golf-report-v2

cp -n /usr/share/golf-report-v2/config.example.toml \
  ~/.config/golf-report-v2/config.toml

chmod 600 ~/.config/golf-report-v2/config.toml

nano ~/.config/golf-report-v2/config.toml
```

Chỉnh sửa thông tin PostgreSQL phù hợp với máy đang sử dụng.

### Bước 4: Mở ứng dụng

Tìm **Phần mềm thu thập dữ liệu độ cong gậy golf** trong menu ứng dụng Ubuntu hoặc chạy:

```bash
golf-report-v2
```

Có thể ghim biểu tượng ứng dụng vào Dock để sử dụng nhanh.

Tên tiếng Việt được đóng gói tự động mỗi lần build DEB qua `bundle.linux.deb.desktopTemplate` (`src-tauri/linux/golf-report-v2.desktop.hbs`); package và executable vẫn là `golf-report-v2`, giữ nguyên icon New Ocean và đường dẫn cấu hình.

## 7. Cập nhật ứng dụng trên Ubuntu

Đóng ứng dụng trước khi cập nhật. Tại thư mục gốc project, chạy lần lượt:

```bash
git pull
npm ci
rm -f src-tauri/target/release/bundle/deb/*.deb
npm run tauri -- build --bundles deb
sudo apt install --reinstall ./src-tauri/target/release/bundle/deb/golf-report-v2_*.deb
```

Không cần clone lại source, tạo lại file cấu hình hoặc xóa database.

## 8. Gỡ cài đặt

```bash
sudo apt remove golf-report-v2
```

Lệnh này không xóa dữ liệu PostgreSQL và cấu hình người dùng.

## Lưu ý

**Công thức đo:** mỗi trạm BUTT/TIP có Enable 0/1, NumPoints 1–10 và luôn hiển thị P1–P10 (index 0–9). Chỉ yêu cầu đủ MaxRot, SettleTime, LoadTol, BendTol và năm thông số của các điểm sử dụng khi bật trạm. Không tự điền mặc định hoặc xóa giá trị khi giảm số điểm/bỏ qua trạm. Vùng truyền vẫn đủ 272 WORD theo `docs/X212PI_Recipe_RegisterMap.xlsx`; trạm tắt và vị trí không dùng mã hóa 0, không làm mất giá trị lưu trong database. **Mapping kết quả hiện chỉ thu thập tối đa 4 điểm mỗi trạm:** được lưu/encode Recipe 5–10 điểm nhưng backend và giao diện chặn nạp các trạm bật vượt 4 điểm cho đến khi kỹ thuật viên xác nhận mapping kết quả tương ứng. PLC điều khiển máy, đo và quyết định OK/NG. Dữ liệu đã lưu chỉ thay đổi khi nhấn Lưu, RecipeRev tăng khi có thay đổi thực tế.

**Lực đè cài đặt hiển thị:** Giám sát, Lịch sử, Chi tiết, Báo cáo và Excel dùng `measurement.butt.load_kg` / `measurement.tip.load_kg` trong `config.toml` (hiện là 2,50 kg). Đây là cấu hình hiện tại khi mở ứng dụng, không phải Load PLC hoặc cấu hình tại thời điểm đo lịch sử; giao diện có chú thích và tiêu đề cột Excel có ghi chú nguồn. Khởi động lại ứng dụng sau khi sửa cấu hình. Không có cấu hình thì hiển thị “—” / ô Excel trống, không thay bằng Load PLC. `Load` gốc PLC (đơn vị g), kể cả 0, vẫn được lưu nguyên trong PostgreSQL.

**Đơn vị kết quả đo:** `PushDist` là lực đè thực tế; theo xác nhận về PLC hiện tại, dữ liệu đã là kg nên giữ nguyên giá trị khi hiển thị và xuất Excel, với hai chữ số thập phân. Vị trí điểm đo lấy trực tiếp từ kết quả PLC, kể cả TIP = 0; không thay bằng vị trí Recipe, cấu hình hoặc giá trị mặc định. Tên kỹ thuật `PushDist`, `pushDistMm` và cột `push_dist_mm` được giữ để tương thích; mô tả mm trong Excel mapping cũ không còn phản ánh ý nghĩa nghiệp vụ này. Không đổi thanh ghi, REAL32, Word Order, lượt quyết định hoặc OK/NG. Không chuyển đổi dữ liệu lịch sử; nếu có dữ liệu từ phiên bản PLC khác, cần kỹ thuật viên xác nhận đơn vị và thời điểm thay đổi trước khi diễn giải chung. PushDist không phải PosForce, PosLinear hay PosPressFixed của Recipe; cấu hình measurement cũ không được dùng để chuyển đổi PushDist.

- Chỉ chạy một phiên ứng dụng kết nối và ghi ACK tới PLC tại một thời điểm.
- Chỉ sử dụng thông số Recipe đã được kỹ thuật viên xác nhận trên máy thật.
- Kiểm tra kết nối PLC và PostgreSQL trước khi vận hành.

---

**New Ocean Group — Golf Report V2**
