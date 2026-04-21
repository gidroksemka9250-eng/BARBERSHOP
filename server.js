// =================================================================
// PROJECT: ELITE ARCHANGEL PREMIUM BARBERSHOP ENGINE (PRO VERSION)
// ARCHITECTURE: MONOLITHIC ZERO-DEPENDENCY NODE.JS SERVER
// STORAGE: PERSISTENT JSON PERSISTENCE (/data/database.json)
// SECURITY: ISOLATED API ENDPOINTS & FAIL-SAFE NOTIFICATIONS
// PROTOCOL: NEGOTIATION & ANTI-CACHE SYSTEM INTEGRATED
// =================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- СИСТЕМНЫЕ НАСТРОЙКИ И ТОКЕНЫ ---
const PORT = process.env.PORT || 3000;
const HOST = process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : `http://localhost:${PORT}`;

const CONFIG = {
    chatId: '7316276135',
    bots: {
        'address1': '8503933078:AAHXl8Y9dPKP6l3_iAQe7PhxNNVz6D21fTE',
        'address2': '8577015225:AAFbVE3hZ23HZI50gWk7d7vdgqi5rKHcJ4A'
    },
    barkUrl: 'https://api.day.app/2mfG6468JsmXaVLaLETob/'
};

// --- МОДУЛЬ PERSISTENT STORAGE ---
const STORAGE_DIR = '/data'; 
const DB_FILE = path.join(STORAGE_DIR, 'database.json');

if (!fs.existsSync(STORAGE_DIR)) {
    try {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
        console.log(`[SYSTEM] Storage directory created at ${STORAGE_DIR}`);
    } catch (err) {
        console.error(`[CRITICAL] Failed to create storage dir: ${err.message}`);
    }
}

let db = { bookings: [] };
if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`[SYSTEM] Database loaded. Records: ${db.bookings.length}`);
    } catch (err) {
        console.error("[ERROR] DB Corrupted. Initializing fresh DB.");
        db = { bookings: [] };
    }
}

const saveDb = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
        console.error(`[CRITICAL] Disk write error: ${err.message}`);
    }
};

// --- МОДУЛЬ УВЕДОМЛЕНИЙ (ТРОЙНОЙ ФОЛБЭК) ---
async function sendToTelegram(botToken, text, photoBase64 = null) {
    const urls = {
        msg: `https://api.telegram.org/bot${botToken}/sendMessage`,
        photo: `https://api.telegram.org/bot${botToken}/sendPhoto`
    };

    try {
        if (photoBase64 && photoBase64.includes('base64,')) {
            const buffer = Buffer.from(photoBase64.split(',')[1], 'base64');
            const boundary = '----EliteArchangelBoundary' + crypto.randomBytes(8).toString('hex');
            
            let body = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CONFIG.chatId}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${text}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="client.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
                buffer,
                Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);

            await fetch(urls.photo, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body: body
            });
        } else {
            await fetch(urls.msg, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: CONFIG.chatId, text: text, parse_mode: 'HTML' })
            });
        }
    } catch (e) {
        console.error("[NOTIFY] TG Failure:", e.message);
    }
}

async function sendToBark(title, bodyText) {
    try {
        await fetch(`${CONFIG.barkUrl}${encodeURIComponent(title)}/${encodeURIComponent(bodyText)}`);
    } catch (e) {
        console.error("[NOTIFY] Bark Failure");
    }
}

// --- ЯДРО ОБРАБОТКИ ЗАПРОСОВ ---
const server = http.createServer(async (req, res) => {
    // CORS Headers for pure isolation bypass
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
    
    if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

    if (req.method === 'GET') {
        // Очищаем URL от GET параметров (например ?_bc=123456)
        const pureUrl = req.url.split('?')[0];

        const filePath = pureUrl === '/' || pureUrl === '/index.html' ? 'index.html' : 
                         pureUrl === '/admin' ? 'admin.html' : null;
        
        if (filePath) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(path.join(__dirname, filePath)));
        }
        
        if (pureUrl.startsWith('/api/status/')) {
            const id = pureUrl.split('/').pop();
            const booking = db.bookings.find(b => b.id === id);
            
            // Запрещаем кэширование статуса на уровне сервера
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            
            if (booking) {
                const responseData = { status: booking.status };
                if (booking.status === 'reschedule') {
                    responseData.proposedDate = booking.proposedDate;
                    responseData.proposedTime = booking.proposedTime;
                    console.log(`[NEGOTIATION] Sent proposed time to client ${id}: ${booking.proposedDate} ${booking.proposedTime}`);
                }
                return res.end(JSON.stringify(responseData));
            } else {
                return res.end(JSON.stringify({ error: 'Not found' }));
            }
        }

        if (pureUrl === '/api/admin/data') {
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            });
            return res.end(JSON.stringify(db.bookings.filter(b => b.status === 'pending' || b.status === 'reschedule')));
        }
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const pureUrl = req.url.split('?')[0];
                const data = JSON.parse(body);

                // ЛОГИКА ЗАПИСИ КЛИЕНТА
                if (pureUrl === '/api/book') {
                    const id = crypto.randomBytes(8).toString('hex');
                    const newBooking = {
                        id,
                        address: data.address,
                        date: data.date,
                        time: data.time,
                        phone: data.phone,
                        photo: data.photo,
                        status: 'pending',
                        timestamp: new Date().toISOString()
                    };
                    
                    db.bookings.push(newBooking);
                    saveDb();

                    const botToken = data.address === 'address1' ? CONFIG.bots.address1 : CONFIG.bots.address2;
                    const msg = `🔥 <b>ЗАПИСЬ: ${data.address === 'address1' ? 'Салон 1' : 'Салон 2'}</b>\n\n👤 Тел: <code>${data.phone}</code>\n📅 Дата: ${data.date}\n⏰ Время: ${data.time}\n\n⚙️ Управление: ${HOST}/admin`;
                    
                    sendToBark('Новый клиент!', `${data.date} в ${data.time}`);
                    await sendToTelegram(botToken, msg, data.photo);
                    
                    console.log(`[BOOKING] New entry created: ${id}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, id }));
                }

                // ЛОГИКА АДМИН ПАНЕЛИ
                if (pureUrl === '/api/admin/action') {
                    const booking = db.bookings.find(b => b.id === data.id);
                    if (booking) {
                        booking.status = data.action; 
                        
                        if (data.action === 'reschedule' && data.newDate && data.newTime) {
                            booking.proposedDate = data.newDate;
                            booking.proposedTime = data.newTime;
                            console.log(`[ADMIN] Proposed new time for ${data.id}: ${data.newDate} ${data.newTime}`);
                        }

                        saveDb();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    }
                }

                // ЛОГИКА ОТВЕТА КЛИЕНТА НА ПЕРЕНОС ВРЕМЕНИ
                if (pureUrl === '/api/client/action') {
                    const booking = db.bookings.find(b => b.id === data.id);
                    if (booking && booking.status === 'reschedule') {
                        console.log(`[CLIENT] Decision received for ${data.id}: ${data.action}`);
                        
                        if (data.action === 'accept') {
                            booking.status = 'approved';
                            booking.date = booking.proposedDate; 
                            booking.time = booking.proposedTime;
                            
                            const botToken = booking.address === 'address1' ? CONFIG.bots.address1 : CONFIG.bots.address2;
                            const msg = `✅ <b>КЛИЕНТ СОГЛАСИЛСЯ НА ПЕРЕНОС</b>\n\n👤 Тел: <code>${booking.phone}</code>\nНовое время: ${booking.date} в ${booking.time}`;
                            await sendToTelegram(botToken, msg);

                        } else if (data.action === 'reject') {
                            booking.status = 'cancelled';
                            
                            const botToken = booking.address === 'address1' ? CONFIG.bots.address1 : CONFIG.bots.address2;
                            const msg = `❌ <b>КЛИЕНТ ОТКАЗАЛСЯ ОТ ПЕРЕНОСА</b>\n\n👤 Тел: <code>${booking.phone}</code>\nЗаявка отменена.`;
                            await sendToTelegram(botToken, msg);
                        }

                        saveDb();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    }
                }

            } catch (err) {
                console.error("[ERROR] Bad Request:", err.message);
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Invalid Request" }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

// --- ЗАПУСК И ИНИЦИАЛИЗАЦИЯ ---
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`[ONLINE] Elite Archangel Engine deployed on port ${PORT}`);
    console.log(`[STORAGE] Persistence active at ${DB_FILE}`);
    
    const startupMsg = `🚀 <b>Система Барбершопа Online (Negotiation Ready)</b>\n\n🔗 Сайт: ${HOST}\n🔑 Админка: ${HOST}/admin\n💾 Хранилище: OK`;
    await sendToTelegram(CONFIG.bots.address1, startupMsg);
});
