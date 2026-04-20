const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// Persistent Storage Logic
const STORAGE_DIR = '/data';
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
const DB_FILE = path.join(STORAGE_DIR, 'database.json');

let db = { bookings: [] };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

async function sendToTelegram(botToken, text, photoBase64 = null) {
    try {
        if (photoBase64) {
            const buffer = Buffer.from(photoBase64.split(',')[1], 'base64');
            const boundary = '----EliteArchangel' + crypto.randomBytes(4).toString('hex');
            let body = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CONFIG.chatId}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${text}\r\n`),
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="c.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
                buffer,
                Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);
            await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body
            });
        } else {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: CONFIG.chatId, text, parse_mode: 'HTML' })
            });
        }
    } catch (e) { console.error("TG Error", e); }
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

    if (req.method === 'GET') {
        if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
        }
        if (req.url === '/admin') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(fs.readFileSync(path.join(__dirname, 'admin.html')));
        }
        if (req.url.startsWith('/api/status/')) {
            const id = req.url.split('/').pop();
            const b = db.bookings.find(x => x.id === id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(b || { error: 'Not found' }));
        }
        if (req.url === '/api/admin/data') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            // Отдаем всё, что требует внимания админа
            return res.end(JSON.stringify(db.bookings.filter(x => x.status === 'pending' || x.status === 'reschedule_proposed')));
        }
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const botToken = data.address === 'address1' || (db.bookings.find(b=>b.id===data.id)?.address === 'address1') ? CONFIG.bots.address1 : CONFIG.bots.address2;

                if (req.url === '/api/book') {
                    const id = crypto.randomUUID();
                    const newB = { ...data, id, status: 'pending', timestamp: Date.now() };
                    db.bookings.push(newB); saveDb();
                    await fetch(`${CONFIG.barkUrl}Новая запись/На ${data.time}`);
                    await sendToTelegram(botToken, `🔥 <b>НОВАЯ ЗАЯВКА</b>\n📞 ${data.phone}\n⏰ ${data.date} в ${data.time}\n⚙️ ${HOST}/admin`, data.photo);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, id }));
                }

                if (req.url === '/api/admin/action') {
                    const b = db.bookings.find(x => x.id === data.id);
                    if (b) {
                        b.status = data.action;
                        if (data.action === 'reschedule_proposed') {
                            b.proposed_date = data.p_date;
                            b.proposed_time = data.p_time;
                        }
                        saveDb();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    }
                }

                if (req.url === '/api/user/respond') {
                    const b = db.bookings.find(x => x.id === data.id);
                    if (b) {
                        if (data.response === 'accept') {
                            b.status = 'approved';
                            b.date = b.proposed_date;
                            b.time = b.proposed_time;
                        } else {
                            b.status = 'cancelled';
                        }
                        saveDb();
                        await sendToTelegram(botToken, `🔔 <b>Клиент ответил!</b>\n📱 Тел: ${b.phone}\n💬 Решение: ${data.response === 'accept' ? 'ПРИНЯТО' : 'ОТКЛОНЕНО'}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    }
                }
            } catch (e) { res.writeHead(500); res.end(); }
        });
    }
});

server.listen(PORT, () => {
    sendToTelegram(CONFIG.bots.address1, `✅ <b>Система Elite Online</b>\nURL: ${HOST}`);
});
