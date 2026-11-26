# golf-report-v2

Phần mềm desktop (Tauri 2 + React) theo dõi máy đo độ cong cán gậy golf X212PI. Ứng dụng đọc dữ liệu từ PLC Delta AS200 qua Modbus TCP, lưu từng cây gậy vào PostgreSQL và hiển thị kết quả đo trực tiếp cùng lịch sử.

## Tính năng

- **Monitor** (`/monitor`): trạng thái kết nối PLC và DB, vùng điều khiển (TotalCount, StickNo, DataReady, …), kết quả cây gậy mới nhất với biểu đồ độ cong theo từng điểm đo của trạm BUTT và TIP.
- **History** (`/history`): danh sách cây gậy đã lưu, thống kê theo mã sản phẩm (SKU), xem chi tiết từng cây.
- Tự tạo database và bảng khi khởi động (migration nhúng sẵn trong app).

## Luồng dữ liệu PLC

Bảng dữ liệu nằm ở D25000..D25499 (chi tiết trong [docs/X212PI-Register-Mapping-PLC-Software.xlsx](docs/X212PI-Register-Mapping-PLC-Software.xlsx), offset trong code ở [registers.rs](src-tauri/src/plc/registers.rs)):

| Vùng | Địa chỉ | Số thanh ghi |
|---|---|---|
| Vùng điều khiển | D25000..D25019 | 20 |
| Bản ghi [0] | D25020..D25259 | 240 |
| Bản ghi [1] | D25260..D25499 | 240 |

Mỗi 500 ms app đọc vùng điều khiển. Khi `DataReady` chuyển 0 → 1:

1. Đọc và giải mã bản ghi [0].
2. Lưu vào PostgreSQL (chờ tối đa 5 s).
3. Xác nhận với PLC: ghi `PC_ReadCount = PC_ReadCount cũ + 1`, sau đó ghi `PC_ReadDone = 1`.

PLC vẫn được xác nhận khi lưu lỗi hoặc quá thời gian; lỗi được báo lên giao diện qua event `db://error`.

Địa chỉ PLC mặc định là `192.168.1.49:502`, slave 1. Giá trị này đang cố định trong [plc/config.rs](src-tauri/src/plc/config.rs), chưa đọc từ `config.toml`.

## Yêu cầu

- Node.js 20+ và npm
- Rust (stable, edition 2024)
- Các thư viện hệ thống cho Tauri trên Linux: xem [hướng dẫn của Tauri](https://tauri.app/start/prerequisites/)
- PostgreSQL. User được cấu hình cần có quyền `CREATE DATABASE` nếu database chưa tồn tại.

## Cấu hình

Sao chép file mẫu rồi sửa thông tin database:

```bash
cp src-tauri/config.example.toml src-tauri/config.toml
```

`config.toml` chứa mật khẩu DB nên đã nằm trong `.gitignore`. App tìm file theo thứ tự sau và dùng file đầu tiên tìm thấy:

1. Thư mục làm việc hiện tại (khi chạy dev là `src-tauri/`)
2. Thư mục chứa file thực thi
3. `$XDG_CONFIG_HOME/golf-report-v2/config.toml` (mặc định `~/.config/golf-report-v2/config.toml`)
4. `/etc/golf-report-v2/config.toml`

Nếu không tìm thấy file hoặc file sai cú pháp, app dùng giá trị mặc định và in lý do ra stderr.

```toml
[database]
host = "localhost"
port = 5432
user = "postgres"
password = "postgres"   # ghi nguyên văn, không cần escape @ : / #
dbname = "golf_report"  # tự tạo nếu chưa có
max_connections = 5

# Thông số máy hiển thị trên Monitor (PLC không gửi các giá trị này).
# Chỉ dùng cho giới hạn và nhãn của biểu đồ; OK/NG luôn lấy từ PLC.
# Khi khai báo một trạm, phải ghi đủ mọi key: key bị bỏ trống sẽ hiện "chưa cấu hình".
[measurement.butt]
load_kg = 2.5
push_dist_mm = 10.0
bend_min_mm = 50.0
bend_max_mm = 200.0
positions_mm = [150.0, 300.0, 450.0, 600.0]

[measurement.tip]
load_kg = 2.5
push_dist_mm = 8.0
bend_min_mm = 50.0
bend_max_mm = 200.0
positions_mm = [80.0]
```

## Phát triển

```bash
npm install
npm run tauri dev
```

Chạy test:

```bash
cd src-tauri && cargo test   # gồm test giả lập PLC bằng Modbus server
```

## Đóng gói và cài đặt trên Linux

### 1. Build bộ cài

Thực hiện trên máy **Linux** đã có Node/npm, Rust và thư viện hệ thống Tauri theo mục Yêu cầu. Chạy tại thư mục gốc project:

```bash
npm ci
npm run tauri -- build --bundles deb
```

File `.deb` nằm trong `src-tauri/target/release/bundle/deb/`. Build cho cùng kiến trúc CPU với máy cài đặt, ví dụ x86_64. Lệnh build trên Windows tạo bộ cài Windows, không tạo `.deb` Linux.

### 2. Cài lên Ubuntu/Debian

Chép file `.deb` sang máy đích, mở terminal tại thư mục chứa file rồi chạy:

```bash
sudo apt install ./golf-report-v2_*.deb
```

Chỉ để một phiên bản bộ cài phù hợp trong thư mục, hoặc thay phần `*` bằng tên file cụ thể. `apt` cài ứng dụng và các dependency cần thiết. Máy sử dụng không cần cài Node/npm hoặc Rust; cần kết nối được PostgreSQL và PLC.

### 3. Thiết lập cấu hình trước lần mở đầu tiên

Chạy bằng tài khoản người dùng sẽ mở ứng dụng:

```bash
report_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/golf-report-v2"
mkdir -p "$report_config_dir"
cp -n /usr/share/golf-report-v2/config.example.toml "$report_config_dir/config.toml"
chmod 600 "$report_config_dir/config.toml"
nano "$report_config_dir/config.toml"
```

Sửa thông tin `[database]` và thông số `[measurement]` cho máy thực tế, lưu rồi thoát. `cp -n` giữ cấu hình cũ nếu đã tồn tại. Cấu hình được đọc lại khi khởi động ứng dụng; địa chỉ PLC hiện vẫn lấy từ `src-tauri/src/plc/config.rs` lúc build.

### 4. Mở bằng biểu tượng ứng dụng

Sau khi cài `.deb`, mở menu **Ứng dụng / Show Applications**, tìm **golf-report-v2** rồi nhấn biểu tượng New Ocean. Có thể nhấp phải và chọn **Add to Favorites / Pin to Dash** để ghim ứng dụng. Bộ cài tự tạo launcher và cài icon; không cần chạy Vite hoặc `npm run tauri dev`.

Nếu chưa thấy biểu tượng, đăng xuất rồi đăng nhập lại. Có thể mở từ terminal để xem lỗi khởi động:

```bash
golf-report-v2
```

Ứng dụng tự kết nối PLC và bắt đầu đọc khi kết nối thành công. Dùng lại lệnh `sudo apt install ./ten-file-moi.deb` khi cập nhật; cấu hình riêng của người dùng vẫn ở thư mục trên.

**AppImage (tùy chọn):** build bằng `npm run tauri -- build --bundles appimage`, lấy file trong `src-tauri/target/release/bundle/appimage/`, cấp quyền rồi chạy:

```bash
chmod +x ./golf-report-v2_*.AppImage
./golf-report-v2_*.AppImage
```

AppImage không tự thêm biểu tượng vào menu; dùng `.deb` nếu muốn cài và mở bằng launcher. Với AppImage, cấu hình vẫn đặt trong thư mục người dùng ở bước 3 hoặc `/etc/golf-report-v2/config.toml`; không đặt cạnh file AppImage vì executable chạy trong thư mục mount tạm. Nếu chưa cài `.deb`, lấy file mẫu từ `src-tauri/config.example.toml` của project.

## Cơ sở dữ liệu

Schema nằm ở [migrations/0001_stick_records.sql](src-tauri/migrations/0001_stick_records.sql). Mỗi bản ghi PLC tạo ra:

- `stick`: 1 dòng, gồm thông tin chung và 240 word gốc (`raw_words`)
- `station_result`: 2 dòng (BUTT, TIP)
- `point_result`: tối đa 8 dòng (P1..P4 cho mỗi trạm)
- `attempt`: tối đa 32 dòng (A1..A4 cho mỗi điểm, mỗi lần xoay 90°)

View `point_decided` trả về mỗi điểm đo một dòng, kèm lần đo đã quyết định kết quả. Mã kết quả: `0` = chưa đo, `1` = OK, `2` = NG.

## Cấu trúc thư mục

```
src/                  Frontend React (antd, recharts)
  pages/Monitor       Màn hình theo dõi trực tiếp
  pages/History       Lịch sử và thống kê
  app/LiveProvider    Nhận event plc://* và db://* từ backend
src-tauri/src/
  plc/                Actor Modbus, vòng poll, giải mã thanh ghi
  db/                 Ghi bản ghi vào Postgres, các command truy vấn
  config.rs           Đọc config.toml
docs/                 Bảng mapping thanh ghi, mockup UI, theme
```
