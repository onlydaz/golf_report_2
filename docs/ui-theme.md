# UI theme

Theme, font và style lấy từ dự án cũ `golf-report` (`src/App.tsx`, `src/App.css`, CSS các trang).
Mọi màn hình mới của v2 dùng theme này.

- Mã nguồn: [src/theme/tokens.ts](../src/theme/tokens.ts) (antd `ThemeConfig`, màu cho TSX/Recharts)
  và [src/styles/theme.css](../src/styles/theme.css) (biến CSS và các class dùng chung).
- Khi sửa màu, sửa ở cả hai file.

## Ant Design
| Token | Giá trị |
|---|---|
| colorPrimary / colorInfo | `#1769aa` |
| colorSuccess | `#1d9b6c` |
| colorWarning | `#db9b2b` |
| colorError | `#d95757` |
| borderRadius | 10 (card trong trang: 12) |
| Layout.siderBg | `#102a43` |
| Menu dark item / selected | `#102a43` / `#2367a4` |
| Table header bg / color | `#f5f8fb` / `#486581` |
| locale | `vi_VN` |

## Font
- Chữ thường: **DM Sans** 400–700.
- Tiêu đề trang, tiêu đề card, số liệu lớn: **Space Grotesk** 500–700.
- Dự phòng: `Segoe UI, sans-serif`.
- Font được đóng gói offline (`@fontsource/*`), không tải từ Google Fonts, vì máy ở xưởng có thể không có Internet.

## Màu
| Vai trò | Giá trị |
|---|---|
| Chữ chính, sidebar | `#102a43` |
| Chữ phụ (đậm → nhạt) | `#243b53` · `#334e68` · `#486581` · `#526b83` · `#627d98` (nhãn) · `#829ab1` (chú thích) |
| Viền | `#dce5ed`, `#e6edf3` |
| Nền trang | `#f4f7fa` |
| OK | chữ `#167451`, nền `#eefaf3`, viền `#b8e4cd`, thẻ đặc `#19764d` |
| NG | chữ `#bc3030`, nền `#fff1f0`, viền `#f0c2c2`, thẻ đặc `#ba3938` |
| Chưa đo | chữ `#627d98`, nền `#f7fafc` |
| Pill đã kết nối / lỗi / chưa xác minh | `#e5f4eb`/`#187849` · `#fdece9`/`#bc3a32` · `#edf1f5`/`#526b83` |
| Đường P1–P4 | `#1769aa`, `#ed8b47`, `#1d9b6c`, `#d4a82c` |
| Giới hạn độ cong | `#d92d20`, nét đứt `5 4` |

## Bố cục
- Sidebar cố định 220px, nền `#102a43`. Logo và tiêu đề "Thu Thập Dữ Liệu Độ Cong Gậy Golf".
  Nhãn nhóm "CHỨC NĂNG CHÍNH" cỡ 10px, giãn chữ 1.3px.
- Menu: ô số 25×25 bo góc 6, nền `rgba(255,255,255,.1)`. Mục đang chọn có nền `#2367a4`, ô số nền trắng, chữ `#1769aa`.
- Nội dung: padding `22px 28px 32px`, rộng tối đa 1600px. Cửa sổ tối thiểu rộng 760px.
- Tiêu đề trang dạng `"1 · Giám sát"`: 26px/700, có viền dưới. Pill trạng thái PLC/DB nằm bên phải.
- Card (`.section-card`): viền `#e6edf3`, bo 12, bóng `0 3px 14px rgba(16,42,67,.035)`.
- Số liệu luôn dùng `font-variant-numeric: tabular-nums`. Tag bo tròn hẳn (999px).
- Ô kết quả BUTT / TIP / OVERALL (`.result-tile`) dùng nền nhạt theo OK/NG.
  Ô OVERALL và thẻ KPI OK/NG dùng nền đặc, chữ trắng.
