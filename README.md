# Golf Report V2 — New Ocean Group

## 1. Giới thiệu

Ứng dụng desktop của **New Ocean Group** theo dõi máy đo độ cong cán gậy golf X212PI. Phần mềm tự kết nối PLC Delta AS200 qua Modbus TCP, đọc kết quả BUTT/TIP, lưu PostgreSQL và cung cấp giao diện giám sát, tra cứu, báo cáo.

## 2. Tính năng chính

| Trang | Chức năng |
|---|---|
| Giám sát (`/monitor`) | SKU, trạng thái máy, thống kê OK/NG, gậy vừa kiểm tra, biểu đồ 30 gậy gần nhất và danh sách gậy đã lưu |
| Lịch sử đo (`/history`) | Lọc thời gian, SKU, số gậy, Overall; chọn SKU và phân trang chi tiết gậy |
| Báo cáo (`/reports`) | Lọc Overall/BUTT/TIP, KPI, thống kê ngày/30 phút, NG theo điểm, phân bố độ cong BUTT, trung bình, độ lệch chuẩn mẫu, Cpk tham chiếu và xuất Excel |
| Kết nối PLC (`/plc`) | Cấu hình chỉ đọc, trạng thái, bộ đếm, nhật ký 100 dòng trong RAM, vùng điều khiển kỹ thuật thu gọn và Reset PC_ReadCount có xác nhận |

Trang chi tiết phép đo hiển thị hai trạm và các lượt đo mở rộng, tô nổi lượt quyết định; hỗ trợ bản ghi đã lưu và bản ghi trực tiếp chưa lưu. Quay lại giữ bộ lọc, SKU và phân trang của trang trước.

Trang Kết nối PLC không điều khiển kết nối. Bộ đếm lỗi/mất kết nối “hôm nay” tính trong phiên ứng dụng hiện tại. Reset chỉ ghi PC_ReadCount về 0, không xóa hồ sơ đo.

## 3. Công nghệ sử dụng

- Giao diện: React 19, TypeScript 6, Vite 8, Ant Design 6, React Router 7, Recharts 3.
- Desktop: Tauri 2; giao tiếp giao diện/Rust bằng command và event.
- Thu thập: Rust edition 2024, Tokio, `tokio-modbus` 0.17.
- Lưu trữ: PostgreSQL, SQLx 0.9; migration nhúng trong ứng dụng.
- Excel: ExcelJS, ba sheet tổng hợp, điểm đo và lượt đo.

Tham chiếu: [package.json](package.json), [Cargo.toml](src-tauri/Cargo.toml).

## 4. Yêu cầu môi trường

**Máy phát triển/build Ubuntu:** Git, npm, Rust stable mới qua rustup và thư viện hệ thống Tauri. Dùng **Node.js 22 từ 22.12 hoặc Node.js 24** để chạy cả build và kiểm thử. Theo lockfile, Vite yêu cầu `^20.19.0 || >=22.12.0`, Vitest yêu cầu `^22.12.0 || ^24.0.0 || >=26.0.0`; không phải mọi bản Node 20 đều phù hợp.

Cài thư viện build theo [hướng dẫn Tauri 2](https://v2.tauri.app/start/prerequisites/#linux):

```bash
sudo apt update
sudo apt install git build-essential pkg-config curl wget file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

Kiểm tra công cụ trước khi build:

```bash
node --version
npm --version
rustc --version
cargo --version
```

**Máy chỉ cài `.deb`:** cần desktop Ubuntu, thư viện chạy do `apt` giải quyết, kết nối đến PLC và PostgreSQL; không cần Git, Node/npm hoặc Rust. PostgreSQL có thể nằm trên máy khác. Build trên Linux cùng kiến trúc CPU với máy đích, ưu tiên cùng phiên bản Ubuntu để tránh lệch thư viện hệ thống. Build trên Windows không tạo `.deb`.

## 5. Tải và cập nhật source code từ GitHub

Lần đầu lấy source:

```bash
git clone https://github.com/onlydaz/golf_report_2.git
cd golf_report_2
npm ci
```

Nếu máy đã có source, vào thư mục đó; **không clone lại**:

```bash
git status
git pull
npm ci
```

Nếu có chỉnh sửa riêng, lưu bằng commit hoặc stash trước khi pull; xử lý xung đột nếu có. Không dùng `git reset --hard` để cập nhật thông thường. `npm ci` cài đúng dependency trong `package-lock.json`.

## 6. Cấu hình PostgreSQL, PLC và thông số đo

### PostgreSQL

Nếu dùng PostgreSQL cục bộ trên Ubuntu và chưa cài:

```bash
sudo apt install postgresql postgresql-client
sudo systemctl enable --now postgresql
```

Kiểm tra dịch vụ và khả năng nhận kết nối:

```bash
systemctl status postgresql --no-pager
pg_isready -h localhost -p 5432
```

Nếu DB ở máy khác, thay host/port tương ứng, không cần cài dịch vụ cục bộ. `pg_isready` chưa xác nhận quyền của tài khoản ứng dụng.

Ứng dụng kết nối database quản trị `postgres`, tạo DB đích nếu thiếu rồi chạy migration. Tài khoản cần truy cập `postgres`, quyền `CREATE DATABASE` nếu DB đích chưa tồn tại và quyền tạo/cập nhật bảng, đọc/ghi trong DB đích. Với PostgreSQL cục bộ mới, có thể tạo tài khoản riêng và nhập mật khẩu khi được hỏi:

```bash
sudo -u postgres createuser --login --createdb --pwprompt golf_report_app
```

Không tạo lại tài khoản đã tồn tại. Kiểm tra xác thực bằng tài khoản đã chọn:

```bash
psql -h localhost -p 5432 -U golf_report_app -d postgres -W -c 'SELECT 1;'
```

### File cấu hình

Khi phát triển, tạo bản sao mẫu nếu chưa có rồi sửa:

```bash
cp -n src-tauri/config.example.toml src-tauri/config.toml
nano src-tauri/config.toml
```

Ví dụ phần DB; thay bằng thông tin thật, không dùng mật khẩu minh họa:

```toml
[database]
host = "localhost"
port = 5432
user = "golf_report_app"
password = "THAY_BANG_MAT_KHAU_THUC_TE"
dbname = "golf_report"
max_connections = 5
```

App dùng **file `config.toml` đầu tiên tồn tại** theo thứ tự:

1. Thư mục làm việc hiện tại; khi chạy Tauri dev thường là `src-tauri/`.
2. Thư mục chứa executable.
3. `$XDG_CONFIG_HOME/golf-report-v2/config.toml`, hoặc `~/.config/golf-report-v2/config.toml` khi chưa đặt XDG_CONFIG_HOME.
4. `/etc/golf-report-v2/config.toml`.

Nếu file đầu tiên sai/không đọc được, app dùng mặc định, không thử file kế tiếp. Cấu hình chỉ đọc lúc khởi động. Khi mở bằng biểu tượng, dùng cấu hình người dùng ở bước 8 để tránh phụ thuộc thư mục làm việc.

**Không commit mật khẩu.** `.gitignore` hiện chỉ bỏ qua đích danh `src-tauri/config.toml`, không tự bỏ qua file cùng tên ở vị trí khác. Giới hạn quyền đọc file trên máy cài đặt.

### PLC và thông số đo

- Endpoint mặc định: `192.168.1.49:502`, Unit ID 1, chu kỳ đọc control danh nghĩa 500 ms. Các giá trị nằm trong [plc/config.rs](src-tauri/src/plc/config.rs), **chưa lấy từ TOML**; thay đổi cần sửa và build lại. Trang Kết nối PLC chỉ hiển thị cấu hình đang dùng.
- `[measurement.butt]` và `[measurement.tip]` trong [file mẫu](src-tauri/config.example.toml) quy định tải đè tham chiếu (kg), khoảng đẩy (mm), giới hạn độ cong (mm) và vị trí điểm đo (mm). Dùng cho nhãn/giới hạn biểu đồ và Cpk tham chiếu; không ghi thông số xuống PLC hoặc tính lại OK/NG.
- Khi khai báo bảng của một trạm, điền đủ các khóa như mẫu: khóa bỏ trống không tự kế thừa bộ mặc định của trạm đó.

Chi tiết: [config.rs](src-tauri/src/config.rs).

## 7. Chạy ứng dụng trong môi trường phát triển

Sau khi cài dependency và chuẩn bị cấu hình, chạy tại thư mục gốc:

```bash
npm run tauri dev
```

Tauri tự chạy Vite ở cổng 1420 và khởi động backend. `npm run dev` chỉ chạy giao diện, không có Actor/Poller/DB Writer. App thật tự kết nối và có thể tạo DB, chạy migration, ghi ACK khi nhận dữ liệu.

**Không chạy đồng thời bản dev và bản đã cài, hoặc nhiều máy/ứng dụng ghi ACK vào cùng PLC.**

Các lệnh kiểm tra khi phát triển:

```bash
npm run build
npm test -- --run
cd src-tauri
cargo check
cargo test --lib
```

Test PLC dùng server giả lập cục bộ. Test DB có đánh dấu bỏ qua và có thao tác tạo/xóa DB kiểm thử; không bật `--ignored` trên môi trường vận hành.

## 8. Build và cài đặt ứng dụng trên Ubuntu

**Bước 1 — Dừng ứng dụng:** đóng cửa sổ Golf Report; nếu chạy dev, nhấn `Ctrl+C` tại terminal. Kiểm tra không còn phiên thu thập trước khi mở phiên mới.

**Bước 2 — Chuẩn bị source:** tại thư mục gốc, chạy `git status`, xử lý chỉnh sửa riêng rồi `git pull` và `npm ci` như mục 5. Nếu vừa clone và cài dependency thì chuyển sang bước 3.

**Bước 3 — Xóa bộ cài cũ, build và cài:** chạy lần lượt; nếu lỗi, xử lý trước khi tiếp tục.

```bash
rm -f src-tauri/target/release/bundle/deb/*.deb
npm run tauri -- build --bundles deb
sudo apt install --reinstall ./src-tauri/target/release/bundle/deb/golf-report-v2_*.deb
```

Tên package và executable là `golf-report-v2`. Bộ cài mới nằm trong `src-tauri/target/release/bundle/deb/`; `*` khớp phiên bản/kiến trúc. `apt` cài cả dependency chạy. Cấu hình đóng gói: [tauri.conf.json](src-tauri/tauri.conf.json).

**Bước 4 — Cấu hình lần đầu:** kiểm tra PostgreSQL theo mục 6. Chạy bằng tài khoản sẽ sử dụng ứng dụng:

```bash
report_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/golf-report-v2"
mkdir -p "$report_config_dir"
cp -n /usr/share/golf-report-v2/config.example.toml "$report_config_dir/config.toml"
chmod 600 "$report_config_dir/config.toml"
nano "$report_config_dir/config.toml"
```

File mẫu trên do `.deb` đóng gói. Chỉ tạo cấu hình một lần; `cp -n` giữ file có sẵn. Sửa `[database]` và `[measurement]` trước khi mở; không cần tạo bảng thủ công.

**Bước 5 — Mở ứng dụng:** vào menu ứng dụng Ubuntu, tìm **golf-report-v2**, nhấn biểu tượng New Ocean. Nhấp phải chọn **Thêm vào mục yêu thích / Ghim vào Dock**. Nếu chưa thấy biểu tượng, đăng xuất rồi đăng nhập lại.

Để xem thông báo cấu hình/DB trên terminal, đóng bản đang mở rồi chạy:

```bash
golf-report-v2
```

Ứng dụng đã cài không cần Vite. Nhật ký PLC xem ở trang Kết nối PLC; app chưa tự ghi log ra file.

## 9. Cập nhật ứng dụng đã cài đặt trên Ubuntu

Đóng ứng dụng, chạy `git status` và lưu các thay đổi riêng trước. Copy nhóm lệnh này tại thư mục gốc project; nhóm lệnh dừng ngay nếu có lỗi:

```bash
(
  set -e
  git pull
  npm ci
  rm -f src-tauri/target/release/bundle/deb/*.deb
  npm run tauri -- build --bundles deb
  sudo apt install --reinstall ./src-tauri/target/release/bundle/deb/golf-report-v2_*.deb
)
```

Không cần clone lại, gỡ bản cũ, tạo lại `config.toml`, xóa database hoặc chạy `cargo clean` mỗi lần build. Xóa `.deb` cũ chỉ xóa file bộ cài trong project, **không gỡ ứng dụng**. Cấu hình người dùng và hồ sơ PostgreSQL vẫn được giữ; migration nhúng được kiểm tra khi mở phiên bản mới.

Nếu build ở máy khác, chép `.deb` mới sang máy đích, chạy `apt install --reinstall` với đường dẫn đó rồi mở lại ứng dụng.

## 10. Gỡ cài đặt ứng dụng

Đóng ứng dụng rồi chạy:

```bash
sudo apt remove golf-report-v2
```

Lệnh này không xóa database PostgreSQL hoặc cấu hình trong thư mục người dùng. Không cần gỡ trước khi cập nhật.

## 11. Kiến trúc và luồng thu thập dữ liệu PLC

```text
PLC Delta AS200 ↔ Actor Modbus TCP ↔ Poller → queue RAM → DB Writer → PostgreSQL
                                      ↓                     ↓
                              Sự kiện Tauri → LiveProvider → React
```

- **Actor:** giữ một kết nối Modbus, xử lý yêu cầu tuần tự; tự kết nối lúc mở app và tự reconnect khi lỗi transport/timeout. Modbus exception trả về lỗi nhưng không bắt buộc ngắt socket.
- **Poller:** khi kết nối, đọc D25000–D25019 (20 WORD) theo chu kỳ danh nghĩa 500 ms. Chỉ khi quan sát `DataReady` **0 → 1** mới đọc record `[0]` tại D25020–D25259 (240 WORD), chia 100 + 100 + 40 WORD. Lần đầu thấy `DataReady=1` không phải cạnh mới.
- **DB Writer:** nhận record qua queue RAM tối đa 256, lưu một gậy trong transaction. Poller phát bản ghi trực tiếp cho UI trước khi chờ lưu, tối đa 5 giây.
- **ACK:** ghi `PC_ReadCount` đã đọc + 1 vào D25008–D25009 bằng FC16, rồi `PC_ReadDone=1` vào D25012 bằng FC06. ACK lỗi được thử lại với cùng bộ đếm trong RAM, không lưu lại record ở nhánh retry đó.

**ACK vẫn được gửi khi lưu lỗi, queue đầy hoặc hết thời gian chờ.** Queue không bền vững, không tự phát lại record lưu lỗi, chưa chống trùng theo RecordSeq. Mapping có hai record nhưng Poller chỉ tiêu thụ `[0]`, chưa đọc bù buffer vòng. Kết nối phục hồi không bảo đảm khôi phục đủ dữ liệu đã bỏ lỡ.

OK/NG lấy nguyên từ PLC. “Thời gian đo” của hồ sơ đã lưu là `received_at` do PostgreSQL tạo lúc transaction, không phải timestamp PLC. Các tác vụ nền chạy độc lập với trang đang mở.

Tham chiếu: [lib.rs](src-tauri/src/lib.rs), [Actor](src-tauri/src/plc/actor.rs), [Poller](src-tauri/src/plc/poller.rs), [DB Writer](src-tauri/src/db/mod.rs), [Register Mapping](docs/X212PI-Register-Mapping-PLC-Software.xlsx), [offset thanh ghi](src-tauri/src/plc/registers.rs).

## 12. Cấu trúc database

Schema trong [migration SQL](src-tauri/migrations/0001_stick_records.sql):

| Bảng/view | Dữ liệu |
|---|---|
| `stick` | Một dòng/gậy: SKU, số gậy, RecordSeq, thời gian nhận, Overall và raw 240 WORD |
| `station_result` | Hai dòng/gậy: BUTT/TIP, lực đè theo g, kết quả, số điểm và điểm NG |
| `point_result` | Tối đa 8 điểm/gậy: vị trí, kết quả, số lượt và lượt quyết định |
| `attempt` | Tối đa 32 lượt/gậy: khoảng đẩy, độ cong theo mm; góc sinh từ số lượt 0/90/180/270° |
| `point_decided` | View nối mỗi điểm với lượt quyết định do PLC chỉ định |

Các bảng con có khóa ngoại với xóa dây chuyền; app hiện không có chức năng xóa hồ sơ đo. Mã kết quả: `0` chưa đo, `1` OK, `2` NG. `record_seq` và `stick_no` không có ràng buộc duy nhất.

## 13. Cấu trúc thư mục

```text
src/
  app/                  LiveProvider, router Workspace, giữ trạng thái trang trước
  pages/Monitor/        Giám sát sản xuất
  pages/History/        Lịch sử theo SKU và chi tiết gậy
  pages/Reports/        Thống kê, biểu đồ và xuất Excel
  pages/PlcConnection/  Trạng thái, bộ đếm và nhật ký PLC
  pages/MeasurementDetail/  Chi tiết phép đo và các lượt đo
  components/           Biểu đồ, bảng, vùng kỹ thuật, nút Reset và header chung
  lib/                  Command/event, truy vấn, định dạng, Excel và thống kê
  layouts/              Sidebar và khung ứng dụng
  theme/, styles/, assets/  Theme, CSS và logo New Ocean
public/                 Favicon New Ocean
src-tauri/
  src/lib.rs            Khởi tạo Actor, Poller, DB Writer và command/event
  src/plc/              Modbus, giải mã, ACK và chẩn đoán RAM
  src/db/               Ghi transaction, query lịch sử/báo cáo và lô xuất Excel
  src/config.rs         Đọc cấu hình PostgreSQL và thông số đo
  migrations/           Schema nhúng
  icons/                Bộ icon New Ocean
  config.example.toml   Mẫu cấu hình được đóng gói vào .deb
  tauri.conf.json       Cấu hình chung và đóng gói Linux
  tauri.windows.conf.json  Cấu hình đóng gói riêng Windows
docs/                   File Excel Register Mapping
```
