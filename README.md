# Hop Together

Game giải đố platformer hợp tác, chơi qua mạng LAN trên trình duyệt (2–10 người).

## Chạy

1. Cần Node.js (không cần `npm install`).
2. Nhấp đúp `start.bat` hoặc chạy `node server.js`.
3. Cửa sổ sẽ hiện địa chỉ, ví dụ `http://192.168.1.10:3000`. Mọi người cùng mạng mở địa chỉ đó trên trình duyệt (máy tính hoặc điện thoại).
4. Một người bấm **Tạo phòng mới** để làm chủ phòng (👑), rồi bấm **📋 Sao chép link mời** gửi cho bạn bè. Người khác mở link, nhập mã phòng 4 chữ, hoặc bấm vào phòng trong danh sách *Phòng đang mở*.
5. Chủ phòng chọn màn và bấm **Bắt đầu**. Một server chạy được nhiều phòng cùng lúc.

Nếu máy khác không vào được: cho phép Node.js qua Windows Firewall (mạng *Private*), hoặc đổi cổng bằng `set PORT=8080 && node server.js`.

## Điều khiển

| Phím | Tác dụng |
|---|---|
| ← → / A D | Di chuyển |
| ↑ / W / Space | Nhảy (giữ lâu nhảy cao hơn) |
| ↓ / S | Vào / ra cửa |
| F / E | Xì hơi 💨 (thổi bay người phía sau, làm rơi chìa khóa) |
| G | Bế đồng đội lên đầu / ném đi (cũng nhặt & ném vỏ chuối) |
| T | Tát người trước mặt (văng ra + choáng 1 giây) |
| 1–4 | Biểu cảm: Ê! / Đỡ tao! / Ngu à? / 😂 |
| R | Chơi lại màn |
| Esc | Về phòng chờ (chủ phòng) |

Điện thoại có nút cảm ứng trên màn hình.

## Luật

- Lấy **chìa khóa** rồi mang tới **cửa** để mở. **Tất cả** phải vào cửa mới qua màn.
- Đứng lên đầu nhau để nhảy cao hơn; người bên dưới đi thì người bên trên được chở theo.
- **Khối nặng** hiện số người còn thiếu; mọi người đẩy nối đuôi nhau đều được tính.
- **Công tắc** mở **cổng** cùng màu khi có người hoặc khối đè lên.
- **Thang máy** chỉ đi lên khi đủ số người đứng trên (tính cả người đứng chồng).
- Cả đội phải ở trong cùng một khung hình. Một người rơi vực / dẫm gai thì cả đội chơi lại màn.
- Người vào giữa chừng sẽ tham gia từ lượt chơi lại tiếp theo.

## Bựa

- Nhảy lên đầu người cầm chìa = cướp chìa.
- Bẫy troll: sàn giả, gai ẩn, chìa khóa giả bỏ chạy, cửa giả nhổ người ra.
- Ai làm cả team chết bị bêu tên trên **Bảng tội đồ** (bị xì hơi thổi chết thì kẻ xì hơi chịu tội).
- Sau 9 màn làm sẵn là **màn tự sinh vô hạn**, càng lúc càng khó. Chọn "🎲 Màn ngẫu nhiên" ở phòng chờ để vào thẳng.

- Thỉnh thoảng nhân vật tự **hắt xì** (bị giật lùi) hoặc **ợ**.
- **Ớt** 🌶️: chạy nhanh gấp đôi, cắm đầu chạy 3 giây không dừng được. **Vỏ chuối** 🍌: trượt dài. **Lò xo**: nảy bay cao (thỉnh thoảng quá đà).
- **Chim** bay ngang ỉa xuống đầu: bị ngược phím 5 giây. **Đá lăn** đuổi phía sau: chạy đi!
- Mỗi màn (trừ màn 1) có một **lời nguyền** ngẫu nhiên: trọng lực mặt trăng, phím ngược, ai cũng to gấp rưỡi, sàn băng, hoặc dây buộc nhau.
- Thỉnh thoảng cả team bị **đổi xác** 10 giây (điều khiển nhân vật của người khác).
- Khi có người chết, cả team **bỏ phiếu** ai mới là thủ phạm thật; người nhiều phiếu nhất bị ghi tội.

## Thêm màn mới

Sửa [levels.js](levels.js): mỗi màn là một mảng chuỗi ASCII cao 17 dòng; xem chú thích ký hiệu ở đầu file. Khởi động lại server sau khi sửa.



## Deploy lên Internet

- Chỉ cần Node.js 18+, không có thư viện ngoài. Lệnh chạy: `npm start` (hoặc `node server.js`).
- Server đọc cổng từ biến môi trường `PORT` (các host như Render, Railway, Fly.io tự đặt biến này).
- Chạy được sau HTTPS: trang dùng `wss://` tự động khi mở bằng `https://`.
- Host cần hỗ trợ **WebSocket** và giữ server chạy liên tục (không dùng kiểu serverless như Vercel/Netlify Functions).
- Server gửi ping mỗi 25 giây để proxy không cắt kết nối khi đang ở phòng chờ.
- Lưu ý: `/rooms` liệt kê mọi phòng đang mở, ai có link web đều thấy và vào được bằng mã phòng.
- Trạng thái game nằm trong bộ nhớ: khởi động lại server là mọi phòng biến mất.
