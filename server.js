// Файл: server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : `http://localhost:${PORT}`;

// Конфигурация API и Токены (Не изменены, вшиты напрямую)
const CONFIG = {
    chatId: '7316276135',
    bots: {
        'address1': '8503933078:AAHXl8Y9dPKP6l3_iAQe7PhxNNVz6D21fTE',
        'address2': '8577015225:AAFbVE3hZ23HZI50gWk7d7vdgqi5rKHcJ4A'
    },
    barkUrl: 'https://api.day.app/2mfG6468JsmXaVLaLETob/'
};

// Простейшая локальная БД
const DB_FILE = path.join(__dirname, 'database.json');
let db = { bookings: [] };
if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Функция отправки в Telegram (с поддержкой Fallback-вариантов)
async function sendToTelegram(botToken, text, photoBase64 = null) {
    const urls = [
        `https://api.telegram.org/bot${botToken}/sendMessage`, // Вариант 1
        `https://api.telegram.org/bot${botToken}/sendPhoto`    // Вариант 2 (если есть фото)
    ];

    try {
        if (photoBase64) {
            // Конвертация Base64 в буфер для отправки фото
            const buffer = Buffer.from(photoBase64.split(',')[1], 'base64');
            const boundary = '----EliteArchangelBoundary' + crypto.randomBytes(8).toString('hex');
            
            let body = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CONFIG.chatId}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${text}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="client.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
                buffer,
                Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);

            const req = await fetch(urls[1], {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body: body
            });
            return await req.json();
        } else {
            const req = await fetch(urls[0], {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: CONFIG.chatId, text: text, parse_mode: 'HTML' })
            });
            return await req.json();
        }
    } catch (e) {
        console.error("Telegram Fallback Triggered. Error:", e);
        // Fallback 3: Если API лежит, просто логируем (можно добавить очередь)
        return false;
    }
}

// Уведомление в Bark
async function sendToBark(title, body) {
    try {
        await fetch(`${CONFIG.barkUrl}${encodeURIComponent(title)}/${encodeURIComponent(body)}`);
    } catch (e) {
        console.error("Bark failed, falling back to pure Telegram reliance.");
    }
}

// Запуск сервера и авто-информирование
const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

    // Маршрутизация статики
    if (req.method === 'GET') {
        if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
        }
        if (req.url === '/admin') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(path.join(__dirname, 'admin.html')));
        }
        
        // API: Получить статус для клиента
        if (req.url.startsWith('/api/status/')) {
            const id = req.url.split('/').pop();
            const booking = db.bookings.find(b => b.id === id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(booking ? { status: booking.status } : { error: 'Not found' }));
        }

        // API: Получить занятое время
        if (req.url === '/api/booked-times') {
            const booked = db.bookings.filter(b => b.status === 'approved').map(b => `${b.date}_${b.time}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(booked));
        }

        // API: Данные для админ панели
        if (req.url === '/api/admin/data') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(db.bookings.filter(b => b.status === 'pending')));
        }
    }

    // Обработка POST запросов
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            // Защита от переполнения памяти
            if (body.length > 10 * 1024 * 1024) { res.writeHead(413); res.end(); req.connection.destroy(); }
        });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);

                // API: Новая запись
                if (req.url === '/api/book') {
                    const id = crypto.randomUUID();
                    const newBooking = {
                        id,
                        address: data.address,
                        date: data.date,
                        time: data.time,
                        phone: data.phone,
                        photo: data.photo, // Base64
                        status: 'pending',
                        timestamp: Date.now()
                    };
                    db.bookings.push(newBooking);
                    saveDb();

                    // Рассылка уведомлений
                    const msgText = `🔥 <b>НОВАЯ ЗАЯВКА В БАРБЕРШОП</b> 🔥\n\n📍 Адрес: ${data.address}\n📅 Дата: ${data.date}\n⏰ Время: ${data.time}\n📞 Телефон: ${data.phone}\n\n⚙️ Админ панель: ${HOST}/admin`;
                    
                    sendToBark('Новая заявка!', `На ${data.date} в ${data.time}. Номер: ${data.phone}`);
                    
                    const botToken = data.address === 'address1' ? CONFIG.bots.address1 : CONFIG.bots.address2;
                    await sendToTelegram(botToken, msgText, data.photo);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, id }));
                }

                // API: Решение админа (Одобрить/Отменить/Перенести)
                if (req.url === '/api/admin/action') {
                    const index = db.bookings.findIndex(b => b.id === data.id);
                    if (index !== -1) {
                        db.bookings[index].status = data.action; // 'approved', 'cancelled', 'reschedule'
                        saveDb();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    }
                }
            } catch (err) {
                console.error(err);
                res.writeHead(500);
                return res.end('Server Error');
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // Авто-уведомление при деплое
    await sendToTelegram(CONFIG.bots.address1, `✅ <b>Сервер успешно запущен!</b>\n\n🌐 Сайт: ${HOST}\n⚙️ Админка: ${HOST}/admin`);
});
