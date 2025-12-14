// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static('public')); // Chứa file giao diện

// --- DATABASE GIẢ LẬP (Lưu trong RAM) ---
// Trong thực tế bạn nên dùng Redis hoặc MongoDB
let activeLocks = {}; // Lưu trạng thái: { 'id_khach_hang': 'ten_ctv_dang_chat' }
let conversations = []; // Danh sách khách hàng đang chờ

// --- PHẦN 1: NHẬN TIN NHẮN TỪ FACEBOOK (WEBHOOK) ---
// Đây là nơi Facebook bắn tin nhắn về khi có khách chat
app.get('/webhook', (req, res) => {
    // Xác thực verify token (làm theo hướng dẫn của Meta)
    if (req.query['hub.verify_token'] === 'TOKEN_CUA_BAN') {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Error, wrong token');
    }
});

app.post('/webhook', (req, res) => {
    const body = req.body;
    // Xử lý đơn giản: Lấy ID người gửi và nội dung
    if (body.object === 'page') {
        body.entry.forEach(entry => {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id; // ID Khách hàng
            
            // Thêm vào danh sách hội thoại nếu chưa có
            if (!conversations.find(c => c.id === sender_psid)) {
                conversations.push({ id: sender_psid, name: `Khách ${sender_psid.substr(0,5)}` });
            }

            // Bắn tín hiệu cho TẤT CẢ CTV là có tin nhắn mới
            io.emit('new_message', { id: sender_psid, msg: webhook_event.message.text });
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// --- PHẦN 2: XỬ LÝ REAL-TIME (SOCKET.IO) ---
io.on('connection', (socket) => {
    console.log('Một CTV đã đăng nhập: ' + socket.id);

    // Gửi danh sách khách và trạng thái khóa hiện tại cho CTV mới vào
    socket.emit('init_data', { conversations, activeLocks });

    // Khi CTV muốn chat với khách (Gửi yêu cầu LOCK)
    socket.on('request_lock', (data) => {
        const { customerId, ctvName } = data;

        // Kiểm tra xem khách này đã bị ai khóa chưa
        if (activeLocks[customerId] && activeLocks[customerId] !== ctvName) {
            // Đã bị người khác khóa -> Báo lỗi cho CTV này
            socket.emit('lock_failed', { msg: `Khách này đang được ${activeLocks[customerId]} chăm sóc!` });
        } else {
            // Chưa ai khóa -> Cấp quyền khóa cho CTV này
            activeLocks[customerId] = ctvName;
            
            // Thông báo cho TẤT CẢ mọi người cập nhật giao diện (Khóa ô chat lại)
            io.emit('update_locks', activeLocks);
        }
    });

    // Khi CTV chat xong hoặc thoát (UNLOCK)
    socket.on('release_lock', (data) => {
        const { customerId } = data;
        if (activeLocks[customerId]) {
            delete activeLocks[customerId];
            io.emit('update_locks', activeLocks);
        }
    });
    
    // Xử lý khi CTV mất mạng/tắt trình duyệt -> Tự động mở khóa các khách họ đang giữ
    socket.on('disconnect', () => {
         // Logic tìm và xóa lock của socket.id này (cần map socket.id với tên CTV)
         // Để đơn giản code mẫu này mình tạm bỏ qua phần tự động unlock khi disconnect
    });
});

server.listen(3000, () => {
    console.log('CRM đang chạy tại port 3000');
});
