# Golf Report V2 — New Ocean Group

Phần mềm desktop thu thập dữ liệu độ cong gậy golf từ PLC Delta AS200 qua Modbus TCP, lưu PostgreSQL và hỗ trợ tra cứu, báo cáo sản xuất.

## 1. Công nghệ chính

React, TypeScript, Vite, Ant Design, Recharts; Tauri 2, Rust, Tokio, SQLx và PostgreSQL. Xuất Excel bằng ExcelJS.

## 2. Chức năng chính

- **Giám sát:** SKU sản xuất, kết quả BUTT/TIP, thống kê OK/NG và biểu đồ các gậy gần nhất.
- **Lịch sử:** lọc và xem chi tiết phép đo đã lưu.
- **Báo cáo:** thống kê chất lượng và xuất Excel.
- **Kết nối PLC:** trạng thái, bộ đếm và nhật ký truyền thông.
- **Công thức đo:** Admin thiết lập/lưu; Operator xem, chọn khách hàng/SKU và nạp bản đã lưu khi đủ điều kiện an toàn.
- **Tài khoản:** đăng nhập, đổi mật khẩu; Admin tạo, sửa tên, khóa/mở khóa và đặt lại mật khẩu Operator.

## 3. Yêu cầu môi trường

Máy phát triển cần Git, Node.js 22 từ 22.12 hoặc Node.js 24, npm và Rust stable qua rustup. Cần PostgreSQL cục bộ hoặc trên máy khác.

**Windows:** cài Visual Studio Build Tools 2022 với workload **Desktop development with C++**, Windows SDK và Microsoft Edge WebView2 Runtime.

**Ubuntu:** cài thư viện build Tauri:

```bash
sudo apt update
sudo apt install git build-essential pkg-config curl wget file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

Máy chỉ cài bộ cài không cần Node.js hoặc Rust. Build trên hệ điều hành và kiến trúc tương ứng với máy sử dụng.

## 4. Tải source và chuẩn bị

```bash
git clone https://github.com/onlydaz/golf_report_2.git
cd golf_report_2
npm ci
```

Tạo cấu hình nếu chưa có bằng lệnh phù hợp:

```powershell
# Windows PowerShell
if (!(Test-Path src-tauri/config.toml)) { Copy-Item src-tauri/config.example.toml src-tauri/config.toml }
```

```bash
# Ubuntu
cp -n src-tauri/config.example.toml src-tauri/config.toml
```

## 5. Cấu hình PostgreSQL và PLC

**Windows:** cài PostgreSQL bằng bộ cài dành cho Windows. **Ubuntu:** nếu chưa có dịch vụ cục bộ:

```bash
sudo apt install postgresql postgresql-client
sudo systemctl enable --now postgresql
sudo -u postgres createuser --login --createdb --pwprompt golf_report_app
```

Không tạo lại tài khoản đã tồn tại. Sửa `[database]` trong `src-tauri/config.toml`: `host`, `port`, `user`, `password`, `dbname`. Tài khoản phải truy cập được database `postgres`, có quyền tạo database đích nếu thiếu và đọc/ghi dữ liệu ứng dụng. Không commit mật khẩu.

`[measurement.butt]` và `[measurement.tip]` chỉ chứa `bend_min_mm`, `bend_max_mm` làm giới hạn tham chiếu. Kết quả đo và OK/NG lấy từ PLC.

PLC mặc định: **192.168.1.49:502**, Unit ID **1**. Thông số nằm trong `src-tauri/src/plc/config.rs`; thay đổi cần build lại. Máy chạy phải truy cập được PLC và PostgreSQL.

Nạp Recipe mặc định bị khóa trong `[recipe_transfer]`. Chỉ mở khóa sau khi kỹ thuật viên xác nhận thông số và điều kiện vận hành trên máy thật. Chọn SKU không tự nạp Recipe.

## 6. Chạy ứng dụng và đóng gói

Từ thư mục gốc, sau khi hoàn tất cấu hình:

```bash
npm run tauri dev
```

Ứng dụng tự kết nối PLC và PostgreSQL. Chỉ chạy một phiên tới cùng PLC tại một thời điểm. `npm run dev` chỉ chạy giao diện.

**Windows:** tạo bộ cài NSIS và MSI:

```powershell
npm run tauri -- build --config src-tauri/tauri.windows.conf.json
```

Chạy bộ cài trong `src-tauri/target/release/bundle/nsis/` hoặc `msi/`. Với bản đã cài, đặt bản sao file mẫu trong source thành `config.toml` cạnh executable, sửa kết nối rồi mở ứng dụng. Giữ file cấu hình có sẵn khi cập nhật.

**Ubuntu:** tạo và cài bộ cài DEB:

```bash
npm run tauri -- build --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/golf-report-v2_*.deb
mkdir -p ~/.config/golf-report-v2
cp -n /usr/share/golf-report-v2/config.example.toml ~/.config/golf-report-v2/config.toml
chmod 600 ~/.config/golf-report-v2/config.toml
nano ~/.config/golf-report-v2/config.toml
```

Mở **Phần mềm thu thập dữ liệu độ cong gậy golf** từ menu hoặc chạy `golf-report-v2`. Nếu dùng `XDG_CONFIG_HOME`, đặt cấu hình trong `$XDG_CONFIG_HOME/golf-report-v2/`.

Tạo AppImage bằng `npm run tauri -- build --bundles appimage`; file nằm trong `src-tauri/target/release/bundle/appimage/`.

Khi cập nhật: đóng ứng dụng, lưu thay đổi riêng, chạy `git pull`, `npm ci`, build và cài lại bộ cài mới. Giữ cấu hình và dữ liệu PostgreSQL hiện có.
