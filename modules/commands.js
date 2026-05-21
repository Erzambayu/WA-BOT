console.time('[STARTUP] Import & Konstanta');
const utils = require('./utils');
utils.ensureConfigFiles();
const ms = require('ms');
const axios = require('axios');
const sharp = require('sharp');
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const os = require('os');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
console.timeEnd('[STARTUP] Import & Konstanta');

// Load environment variables
require('dotenv').config();

// Konstanta - menggunakan environment variables
const STATS_FILE = path.join(__dirname, '../config/bot_stats.json');
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || 'your_openweather_api_key_here';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your_gemini_api_key_here';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'your_rapidapi_key_here';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'your_deepseek_api_key_here';
const EXA_API_KEY = process.env.EXA_API_KEY || 'your_exa_api_key_here';
// Tambahkan konstanta OWNER_NUMBER agar tidak error
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';
const OWNER_JID = OWNER_NUMBER ? `${OWNER_NUMBER}@s.whatsapp.net` : '';
// Helper konversi nomor â†’ JID Baileys (selalu pakai @s.whatsapp.net, BUKAN @c.us)
function toJid(num) {
    if (!num) return '';
    const clean = String(num).replace(/[^0-9]/g, '');
    return clean ? `${clean}@s.whatsapp.net` : '';
}

// Konfigurasi logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Rate limiting dengan pembersihan otomatis
class RateLimiter {
    constructor(timeWindowMs = 3000) {
        this.limits = new Map();
        this.timeWindowMs = timeWindowMs;
        
        // Bersihkan rate limits setiap 1 jam
        setInterval(() => this.cleanup(), 3600000);
        
        // Bersihkan memory AI setiap 6 jam untuk mencegah memory leak
        setInterval(() => this.cleanupAIMemory(), 21600000);
    }

    isRateLimited(userId) {
        const now = Date.now();
        const lastRequest = this.limits.get(userId);
        
        if (!lastRequest) {
            this.limits.set(userId, now);
        return false;
    }

        if (now - lastRequest < this.timeWindowMs) {
        return true;
    }

        this.limits.set(userId, now);
        return false;
    }

    cleanup() {
        const now = Date.now();
        for (const [userId, timestamp] of this.limits.entries()) {
            if (now - timestamp > this.timeWindowMs) {
                this.limits.delete(userId);
            }
        }
    }
    
    // Cleanup AI memory untuk user yang tidak aktif > 7 hari
    cleanupAIMemory() {
        try {
            if (global.userAIMemory) {
                const now = Date.now();
                const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
                
                for (const userId in global.userAIMemory) {
                    const userHistory = global.userAIMemory[userId]?.history || [];
                    if (userHistory.length > 0) {
                        const lastActivity = userHistory[userHistory.length - 1]?.time || 0;
                        if (lastActivity < sevenDaysAgo) {
                            delete global.userAIMemory[userId];
                            logger.info(`Cleaned up AI memory for inactive user: ${userId}`);
                        }
                    }
                }
            }
            
            // Reset error counters setiap cleanup
            global.cuacaErrorCount = 0;
            global.tiktokErrorCount = 0;
            global.igreelsErrorCount = 0;
            global.igfotoErrorCount = 0;
            global.igstoryErrorCount = 0;
            
        } catch (e) {
            logger.error('Error during AI memory cleanup:', e);
        }
    }
}

// Pengelolaan reminder
class ReminderManager {
    constructor() {
        this.reminders = new Map();
    }

    addReminder(userId, intervalId, details) {
        if (!this.reminders.has(userId)) {
            this.reminders.set(userId, []);
        }
        this.reminders.get(userId).push({ intervalId, details });
    }

    clearReminders(userId) {
        const userReminders = this.reminders.get(userId) || [];
        userReminders.forEach(({ intervalId }) => clearInterval(intervalId));
        this.reminders.delete(userId);
    }

    listReminders(userId) {
        return this.reminders.get(userId) || [];
    }
}

// State management
class BotState {
    constructor() {
        this.maintenanceMode = false;
        this.stats = { startTime: Date.now(), sent: 0, error: 0 };
        this.loadStats();
        this.loadMaintenanceMode();
    }

    loadMaintenanceMode() {
        try {
            const { getSetting } = require('./utils');
            this.maintenanceMode = getSetting('maintenance_mode', false);
            global.maintenanceMode = this.maintenanceMode; // Sync dengan global state
        } catch (error) {
            logger.error('Failed to load maintenance status:', error);
            this.maintenanceMode = false;
            global.maintenanceMode = false;
        }
    }

    setMaintenanceMode(enabled) {
        this.maintenanceMode = enabled;
        global.maintenanceMode = enabled; // Sync dengan global state
        
        // Save to database
        const { setSetting } = require('./utils');
        setSetting('maintenance_mode', enabled);
        
        logger.info(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    isInMaintenanceMode() {
        return this.maintenanceMode;
    }

    loadStats() {
        try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const BOT_DB_PATH = path.join(__dirname, '../config/bot_data.db');
            const db = new Database(BOT_DB_PATH);
            
            const result = db.prepare('SELECT * FROM bot_stats LIMIT 1').get();
            if (result) {
                this.stats = {
                    startTime: result.start_time,
                    sent: result.messages_sent,
                    error: result.errors_count
                };
            }
            db.close();
        } catch (error) {
            logger.error('Failed to load stats from database:', error);
            // Initialize with default values if database read fails
            this.stats = { startTime: Date.now(), sent: 0, error: 0 };
        }
    }

    saveStats() {
        try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const BOT_DB_PATH = path.join(__dirname, '../config/bot_data.db');
            const db = new Database(BOT_DB_PATH);
            
            db.prepare(`
                INSERT OR REPLACE INTO bot_stats (id, start_time, messages_sent, errors_count, last_updated)
                VALUES (1, ?, ?, ?, ?)
            `).run(this.stats.startTime, this.stats.sent, this.stats.error, Math.floor(Date.now() / 1000));
            
            db.close();
        } catch (error) {
            logger.error('Failed to save stats to database:', error);
        }
    }

    incrementSent() {
        this.stats.sent++;
        this.saveStats();
    }

    incrementError() {
        this.stats.error++;
        this.saveStats();
    }

    getStats() {
        return { ...this.stats };
    }

    getUptime() {
        return Date.now() - this.stats.startTime;
    }
}

// Input validation
const validators = {
    phoneNumber: (number) => {
        const cleaned = number.replace(/\D/g, '');
        return /^[1-9]\d{10,14}$/.test(cleaned);
    },
    
    duration: (duration) => {
        try {
            const msValue = ms(duration);
            return msValue > 0 && msValue < ms('30d'); // Maksimum 30 hari
        } catch {
            return false;
        }
    },

    text: (text, maxLength = 1000) => {
        return typeof text === 'string' && text.length > 0 && text.length <= maxLength;
    }
};

console.time('[STARTUP] Komponen & State');
// Inisialisasi komponen
const rateLimiter = new RateLimiter();
const reminderManager = new ReminderManager();
const botState = new BotState();
console.timeEnd('[STARTUP] Komponen & State');

// Lazy load userAIMemory: hanya load user saat dibutuhkan
if (typeof global.userAIMemory === 'undefined') global.userAIMemory = {};

// Tambahkan flag global untuk auto-reply AI
if (typeof global.aiAutoReply === 'undefined') global.aiAutoReply = true;

function formatUptime(ms) {
    if (!ms || ms < 0) return '-';
    const jam = Math.floor(ms / 3600000);
    const menit = Math.floor((ms % 3600000) / 60000);
    const detik = Math.floor((ms % 60000) / 1000);
    return `${jam} jam ${menit} menit ${detik} detik`;
}
function formatDateTimeID(date) {
    if (!date) return '-';
    date = new Date(date);
    if (isNaN(date.getTime())) return '-';
    const d = date.getDate();
    const m = date.getMonth() + 1;
    const y = date.getFullYear();
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${d}/${m}/${y}, ${h}.${min}.${s}`;
}

// Command metadata
const commandList = [
    { name: 'send', desc: 'Kirim pesan ke nomor target dari admin.', admin: true, usage: '/send <nomor> <pesan>', alias: [] },
    { name: 'remind', desc: 'Reminder sekali dalam detik/menit/jam.', admin: false, usage: '/remind <waktu> <pesan>', alias: [] },
    { name: 'remindme', desc: 'Reminder berulang setiap interval.', admin: false, usage: '/remindme <interval> <pesan>', alias: [] },
    { name: 'status', desc: 'Cek status bot dan server.', admin: false, usage: '/status', alias: [] },
    { name: 'stats', desc: 'Cek statistik bot.', admin: false, usage: '/stats', alias: [] },
    { name: 'cekwa', desc: 'Cek apakah nomor terdaftar di WhatsApp.', admin: false, usage: '/cekwa <nomor>', alias: [] },
    { name: 'cuaca', desc: 'Cek cuaca kota tertentu.', admin: false, usage: '/cuaca <kota>', alias: [] },
    { name: 'tiktok', desc: 'Download video TikTok tanpa watermark.', admin: false, usage: '/tiktok <url>', alias: [] },
    { name: 'stiker', desc: 'Membuat stiker dari gambar.', admin: false, usage: '/stiker <reply/caption gambar>', alias: ['sticker'] },
    { name: 'sholat', desc: 'Cek jadwal sholat kota tertentu.', admin: false, usage: '/sholat <kota>', alias: [] },
    { name: 'setkota', desc: 'Set kota default jadwal sholat.', admin: true, usage: '/setkota <kota>', alias: [] },
    { name: 'ai', desc: 'Tanya AI Gemini (Google).', admin: false, usage: '/ai <pesan>', alias: [] },
    { name: 'admin', desc: 'Tambah admin baru.', admin: true, usage: '/admin <nomor>', alias: [] },
    { name: 'deladmin', desc: 'Hapus admin.', admin: true, usage: '/deladmin <nomor>', alias: [] },
    { name: 'maintenance', desc: 'Aktifkan/nonaktifkan mode maintenance.', admin: true, usage: '/maintenance on|off', alias: [] },
    { name: 'hidetag', desc: 'Mention semua anggota grup secara silent (admin saja).', admin: true, usage: '/hidetag <pesan>', alias: [] },
    { name: 'sbirthday', desc: 'Tambah data ulang tahun.', admin: false, usage: '/sbirthday <nomor> <tanggal> [nama]', alias: [] },
    { name: 'ai-auto', desc: 'Aktif/nonaktifkan auto-reply AI chat', admin: true, usage: '/ai-auto on|off', alias: [] },
    { name: 'igstory', desc: 'Download Instagram story', admin: false, usage: '/igstory <story_id>', alias: [] },
    { name: 'igreels', desc: 'Download Instagram reels', admin: false, usage: '/igreels <url>', alias: [] },
    { name: 'igfoto', desc: 'Download Instagram foto', admin: false, usage: '/igfoto <url>', alias: [] },
    { name: 'convert', desc: 'Convert currency', admin: false, usage: '/convert <jumlah> <dari> to <ke>', alias: [] },
    { name: 'listadmin', desc: 'Melihat daftar admin bot', admin: true, usage: '/listadmin', alias: [] },
    { name: 'backup', desc: 'Backup data bot (admin only)', admin: true, usage: '/backup', alias: [] },
    { name: 'restore', desc: 'Restore data bot dari backup (admin only)', admin: true, usage: '/restore <path_file_backup>', alias: [] },
    { name: 'web', desc: 'Cari di web menggunakan Exa API', admin: false, usage: '/web <kata kunci pencarian>', alias: [] },
    { name: 'ringkas', desc: 'Ringkas artikel dari URL', admin: false, usage: '/ringkas <url artikel>', alias: [] },
    { name: 'jawab', desc: 'Jawab pertanyaan dari web', admin: false, usage: '/jawab <pertanyaan atau url>', alias: [] },
    { name: 'ai-optimize', desc: 'Mengubah optimasi AI', admin: true, usage: '/ai-optimize emotion on|off summary on|off admin on|off history <1-10> retry <1-5> cache <1-72>', alias: [] },
    { name: 'qr', desc: 'Generate atau scan QR code', admin: false, usage: '/qr generate <text> atau /qr scan <reply gambar>', alias: [] },
    { name: 'short', desc: 'URL Shortener', admin: false, usage: '/short <url>', alias: [] },
    { name: 'expense', desc: 'Expense tracker (add/list/report/pdf/csv/chart)', admin: false, usage: '/expense add|list|report|pdf|csv|chart [period]', alias: [] },
    { name: 'invoice', desc: 'Invoice Generator', admin: false, usage: '/invoice create <customer> <item> <harga>', alias: [] },
    // === ISLAMIC TOOLS ===
    { name: 'qibla', desc: 'Cek arah kiblat dari kota', admin: false, usage: '/qibla [kota]', alias: [] },
    { name: 'hadits', desc: 'Hadits random dari kitab pilihan', admin: false, usage: '/hadits [bukhari|muslim|abu-daud|tirmidzi|nasai|ibnu-majah|ahmad|malik|darimi]', alias: ['hadith'] },
    { name: 'hijri', desc: 'Tanggal hijriah hari ini', admin: false, usage: '/hijri', alias: [] },
    // === STICKER UPGRADE ===
    { name: 'brat', desc: 'Brat-style sticker (Charli XCX)', admin: false, usage: '/brat <teks>', alias: [] },
    { name: 'stext', desc: 'Text sticker putih solid', admin: false, usage: '/stext <teks>', alias: [] }
];

// Helper untuk mengubah gambar menjadi stiker — delegasi ke modules/sticker.js
async function imageToSticker(buffer) {
    const stickerMod = require('./sticker');
    return await stickerMod.imageToSticker(buffer);
}

// Helper untuk mendapatkan info sistem
function getSystemInfo() {
    // Memory info
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercentage = ((usedMem / totalMem) * 100).toFixed(2);
    
    // CPU info
    const cpuInfo = os.cpus()[0];
    const cpuUsage = os.loadavg()[0]; // 1 menit average
    const cpuCount = os.cpus().length;
    const cpuPercentage = ((cpuUsage / cpuCount) * 100).toFixed(2);
    
    // Storage info
    const rootPath = '/';
    let storageInfo = { total: 0, free: 0, used: 0 };
    try {
        const df = require('child_process').execSync('df -k /').toString();
        const lines = df.split('\n');
        if (lines.length > 1) {
            const stats = lines[1].split(/\s+/);
            storageInfo = {
                total: parseInt(stats[1]) * 1024,
                used: parseInt(stats[2]) * 1024,
                free: parseInt(stats[3]) * 1024
            };
        }
    } catch (error) {
        logger.error('Failed to get storage info:', error);
    }

    // Network info
    const networkInterfaces = os.networkInterfaces();
    const network = Object.entries(networkInterfaces)
        .filter(([name, interfaces]) => 
            !name.includes('lo') && // Skip loopback
            interfaces.some(i => i.family === 'IPv4' && !i.internal)
        )
        .map(([name, interfaces]) => ({
            name,
            address: interfaces.find(i => i.family === 'IPv4' && !i.internal)?.address
        }))
        .filter(n => n.address);

    // Process info
    const processUptime = process.uptime();
    const nodeVersion = process.version;
    const platform = os.platform();
    const arch = os.arch();
    const hostname = os.hostname();

    return {
        memory: {
            total: totalMem,
            used: usedMem,
            free: freeMem,
            percentage: memPercentage
        },
        cpu: {
            model: cpuInfo.model,
            cores: cpuCount,
            speed: cpuInfo.speed,
            usage: cpuPercentage,
            load: os.loadavg()
        },
        storage: {
            total: storageInfo.total,
            used: storageInfo.used,
            free: storageInfo.free,
            percentage: ((storageInfo.used / storageInfo.total) * 100).toFixed(2)
        },
        network: network,
        system: {
            platform,
            arch,
            hostname,
            uptime: os.uptime(),
            nodeVersion,
            processUptime
        }
    };
}

// Helper untuk format bytes
function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

// Helper untuk format waktu
function formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

async function handleCommand({ command, args, sock, sender, senderNum, msg, isFromAdmin, scheduledTimeouts }) {
    try {
        // Rate limiting check
        if (rateLimiter.isRateLimited(senderNum)) {
            await sock.sendMessage(sender, { text: utils.errorMsg('â³ *Whoa, slow down there!* ðŸŒ\n\nYou\'re sending commands too fast! Please wait a few seconds and try again. This helps keep the bot responsive for everyone! ðŸ˜Š') });
            return true;
        }

        // Maintenance mode check
        if (botState.isInMaintenanceMode() && senderNum !== OWNER_NUMBER) {
            await sock.sendMessage(sender, { text: utils.errorMsg('ðŸ”§ *Bot Sedang Maintenance* ðŸ› ï¸\n\nMaaf, bot sedang dalam perbaikan untuk memberikan layanan yang lebih baik! Silakan coba lagi dalam beberapa menit.\n\nâ° Estimasi selesai: *5-10 menit*\nðŸ’¡ Untuk update terbaru, hubungi admin.') });
            return true;
        }

        // Command handling dengan validasi
        switch (command) {
            case 'send':
                if (!isFromAdmin) {
                    logger.warn(`Unauthorized send attempt by ${senderNum}`);
                    return await sock.sendMessage(sender, { text: utils.errorMsg('ðŸš« *Access Denied!* ðŸ”\n\nSorry, only administrators can use this broadcast feature. This helps prevent spam and keeps the bot secure.\n\nðŸ‘‘ Want admin access? Contact the bot owner!') });
                }
                if (args.length < 3) {
                    return await sock.sendMessage(sender, { text: utils.errorMsg('ðŸ“ *Command Format Error* âŒ\n\nPlease use the correct format:\n\nðŸ“‹ `/send <nomor> <pesan>`\n\nðŸ’¡ *Example:*\n`/send 6281234567890 Hello there! ðŸ‘‹`') });
                }
                if (!validators.phoneNumber(args[1])) {
                    return await sock.sendMessage(sender, { text: utils.errorMsg('ðŸ“ž *Invalid Phone Number* âŒ\n\nThe phone number format is incorrect! Please make sure:\n\nâœ… Use country code (e.g., 6281234567890)\nâœ… No spaces or special characters\nâœ… Number length is 10-15 digits\n\nðŸ’¡ *Example:* `6281234567890`') });
                }
                const message = args.slice(2).join(' ');
                if (!validators.text(message)) {
                    return await sock.sendMessage(sender, { text: utils.errorMsg('ðŸ’¬ *Message Error* âŒ\n\nThe message is either empty or too long!\n\nðŸ“ *Requirements:*\nâ€¢ Minimum: 1 character\nâ€¢ Maximum: 1000 characters\nâ€¢ Current length: ' + message.length + ' characters') });
                }
                try {
                    await sock.sendMessage(toJid(args[1]), message);
                    botState.incrementSent();
                    await sock.sendMessage(sender, { text: `âœ… *Message Sent Successfully!* ðŸš€\n\nðŸ“ž To: \`${args[1]}\`\nðŸ’¬ Message: *${message.substring(0, 50)}${message.length > 50 ? '...' : ''}*\n\nðŸ“Š Total messages sent today: *${botState.stats.sent}*` });
                    logger.info(`Message sent to ${args[1]} by admin ${senderNum}`);
                } catch (error) {
                    botState.incrementError();
                    logger.error(`Failed to send message to ${args[1]}:`, error);
                    await sock.sendMessage(sender, { text: utils.errorMsg('âŒ *Delivery Failed* ðŸ“±\n\nFailed to send message! Possible reasons:\n\nðŸ” Number not registered on WhatsApp\nðŸ“µ Recipient blocked the bot\nðŸŒ Network connectivity issues\n\nPlease verify the number and try again.') });
                }
                return true;

            case 'remind':
                if (args.length < 3) return await sock.sendMessage(sender, { text: utils.errorMsg('Format: /remind <waktu> <pesan>') });
                const waktu = args[1];
                const pesan = args.slice(2).join(' ');
                const msTime = ms(waktu);
                if (!msTime) return await sock.sendMessage(sender, { text: utils.errorMsg('Format waktu tidak valid.') });
                await sock.sendMessage(sender, { text: `Pengingat akan dikirim dalam ${waktu}: ${pesan}` });
                setTimeout(() => {
                    sock.sendMessage(sender, { text: `Pengingat: ${pesan}` });
                    botState.incrementSent();
                    botState.saveStats();
                }, msTime);
                return true;

            case 'remindme':
                if (args.length < 3) return await sock.sendMessage(sender, { text: utils.errorMsg('Format: /remindme <interval> <pesan>') });
                const interval = args[1];
                const pesanInterval = args.slice(2).join(' ');
                const msTimeInterval = ms(interval);
                if (!msTimeInterval) return await sock.sendMessage(sender, { text: utils.errorMsg('Format interval tidak valid.') });
                await sock.sendMessage(sender, { text: `Reminder berulang setiap ${interval}: ${pesanInterval}` });
                const intervalId = setInterval(() => {
                    sock.sendMessage(sender, { text: `Reminder: ${pesanInterval}` });
                    botState.incrementSent();
                    botState.saveStats();
                }, msTimeInterval);
                reminderManager.addReminder(senderNum, intervalId, { interval, pesan: pesanInterval });
                return true;

            case 'cekwa':
                if (args.length < 2) return await sock.sendMessage(sender, { text: utils.errorMsg('ðŸ“ž *WhatsApp Number Checker* ðŸ”\n\nPlease provide a phone number to check!\n\nðŸ“‹ *Format:* `/cekwa <nomor>`\n\nðŸ’¡ *Examples:*\nâ€¢ `/cekwa 6281234567890`\nâ€¢ `/cekwa +6281234567890`\nâ€¢ `/cekwa 081234567890`\n\nâœ… *What this checks:*\nâ€¢ If number is registered on WhatsApp\nâ€¢ Account status (active/inactive)\nâ€¢ Profile availability\n\nðŸ”’ Privacy respected - no personal data accessed!') });
                const nomor = args[1].replace(/\D/g, '');
                try {
                    // Placeholder for actual WhatsApp check logic
                    await sock.sendMessage(sender, { text: 'ðŸ“ž *WhatsApp Status Check* ðŸ”\n\nðŸ”„ *Checking number...*\n\nSorry, this feature is currently under development!\n\nðŸš§ *Coming soon:*\nâ€¢ Real-time WhatsApp status check\nâ€¢ Account verification\nâ€¢ Profile status detection\n\nðŸ’¡ *Alternative:*\nTry sending a test message to verify manually!\n\nðŸ› ï¸ Feature will be available in next update!' });
                } catch (e) {
                    botState.incrementError();
                    botState.saveStats();
                }
                return true;

            case 'stiker':
            case 'sticker':
            case 's': {
                try {
                    const stickerMod = require('./sticker');
                    const arrArgs = Array.isArray(args) ? args : Object.values(args).filter(v => typeof v === 'string');
                    let buffer = null;
                    let isAnimated = false;

                    // Cek media di pesan ini atau quoted
                    const hasImage = msg.message?.imageMessage;
                    const hasVideo = msg.message?.videoMessage;
                    const hasGif = hasVideo && msg.message.videoMessage.gifPlayback;
                    const quotedImage = msg.quoted?.imageMessage;
                    const quotedVideo = msg.quoted?.videoMessage;
                    const quotedGif = quotedVideo && msg.quoted.videoMessage.gifPlayback;

                    if (hasImage) {
                        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                    } else if (hasGif || hasVideo) {
                        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                        isAnimated = true;
                    } else if (quotedImage) {
                        buffer = await downloadMediaMessage(msg.quoted, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                    } else if (quotedGif || quotedVideo) {
                        buffer = await downloadMediaMessage(msg.quoted, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                        isAnimated = true;
                    }

                    if (buffer) {
                        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                            await sock.sendMessage(sender, { text: '❌ Gagal: buffer media kosong/invalid.' });
                            return true;
                        }
                        const sticker = isAnimated
                            ? await stickerMod.animatedToSticker(buffer)
                            : await stickerMod.imageToSticker(buffer);
                        if (!Buffer.isBuffer(sticker) || sticker.length === 0) {
                            await sock.sendMessage(sender, { text: '❌ Gagal generate sticker (output kosong). Pastikan media valid.' });
                            return true;
                        }
                        await sock.sendMessage(sender, { sticker });
                        botState.incrementSent();
                        return true;
                    }

                    if (arrArgs.length >= 1) {
                        const textSticker = arrArgs.join(' ');
                        const sticker = await stickerMod.textToSticker(textSticker, { bg: 'transparent', fg: '#FFFFFF', outline: true });
                        await sock.sendMessage(sender, { sticker });
                        botState.incrementSent();
                        return true;
                    }

                    await sock.sendMessage(sender, { text: '🎨 *Sticker Maker*\n\n*Cara pakai:*\n• Kirim gambar/gif/video + caption `/stiker`\n• Reply gambar/gif/video dengan `/stiker`\n• `/stiker <teks>` — text sticker (transparan)\n• `/brat <teks>` — brat-style (lime green)\n• `/stext <teks>` — text sticker putih solid\n\n_Mendukung: JPG, PNG, WEBP, GIF, MP4 (sebagai gif)_' });
                    return true;
                } catch (error) {
                    logger.error(`Error creating sticker: ${error.message}`);
                    await sock.sendMessage(sender, { text: `❌ Gagal membuat stiker: ${error.message}` });
                    botState.incrementError();
                    return true;
                }
            }

            case 'brat': {
                try {
                    if (args.length < 1) return await sock.sendMessage(sender, { text: '🟢 *Brat Sticker* (Charli XCX style)\n\n*Format:* `/brat <teks>`\n*Contoh:* `/brat brat`' });
                    const stickerMod = require('./sticker');
                    const text = args.join(' ').toLowerCase();
                    const sticker = await stickerMod.bratSticker(text);
                    await sock.sendMessage(sender, { sticker });
                    botState.incrementSent();
                } catch (e) {
                    logger.error('Brat sticker error:', e);
                    await sock.sendMessage(sender, { text: `❌ Gagal: ${e.message}` });
                }
                return true;
            }

            case 'stext': {
                try {
                    if (args.length < 1) return await sock.sendMessage(sender, { text: '✏️ *Text Sticker*\n\n*Format:* `/stext <teks>`\n*Contoh:* `/stext halo dunia`' });
                    const stickerMod = require('./sticker');
                    const text = args.join(' ');
                    const sticker = await stickerMod.textToSticker(text, { bg: '#FFFFFF', fg: '#000000', outline: false });
                    await sock.sendMessage(sender, { sticker });
                    botState.incrementSent();
                } catch (e) {
                    logger.error('Text sticker error:', e);
                    await sock.sendMessage(sender, { text: `❌ Gagal: ${e.message}` });
                }
                return true;
            }

            case 'sholat': {
                const kota = args[1] || utils.getDefaultSholatCity();
                try {
                    const islamic = require('./islamic');
                    const jadwal = await islamic.getJadwalSholat(kota);
                    if (jadwal) {
                        await sock.sendMessage(sender, { text: islamic.formatJadwalSholat(jadwal) });
                        botState.incrementSent();
                    } else {
                        await sock.sendMessage(sender, { text: '❌ Kota tidak ditemukan atau API down. Coba kota lain (mis: Jakarta, Bandung, Surabaya).' });
                        botState.incrementError();
                    }
                    botState.saveStats();
                } catch (e) {
                    logger.error('Sholat Error:', e);
                    await sock.sendMessage(sender, { text: '❌ Gagal mengambil jadwal sholat. Coba lagi.' });
                    botState.incrementError();
                    botState.saveStats();
                }
                return true;
            }

            case 'qibla': {
                const kotaQ = args.slice(1).join(' ').trim() || utils.getDefaultSholatCity();
                try {
                    const islamic = require('./islamic');
                    const q = await islamic.getQibla(kotaQ);
                    await sock.sendMessage(sender, { text: islamic.formatQibla(q) });
                    if (q) botState.incrementSent(); else botState.incrementError();
                    botState.saveStats();
                } catch (e) {
                    logger.error('Qibla Error:', e);
                    await sock.sendMessage(sender, { text: '❌ Gagal mengambil arah kiblat.' });
                }
                return true;
            }

            case 'hadits':
            case 'hadith': {
                const book = (args[1] || 'bukhari').toLowerCase();
                try {
                    const islamic = require('./islamic');
                    if (!islamic.HADITH_BOOKS[book]) {
                        const list = Object.entries(islamic.HADITH_BOOKS).map(([k, v]) => `• \`${k}\` — ${v.name}`).join('\n');
                        return await sock.sendMessage(sender, { text: `📚 *Kitab Hadits Tersedia*\n\n${list}\n\n💡 Format: \`/hadits <kitab>\`\nContoh: \`/hadits muslim\`` });
                    }
                    const h = await islamic.getRandomHadith(book);
                    await sock.sendMessage(sender, { text: islamic.formatHadith(h) });
                    if (h) botState.incrementSent(); else botState.incrementError();
                    botState.saveStats();
                } catch (e) {
                    logger.error('Hadith Error:', e);
                    await sock.sendMessage(sender, { text: '❌ Gagal mengambil hadits.' });
                }
                return true;
            }

            case 'hijri': {
                try {
                    const islamic = require('./islamic');
                    const h = await islamic.getHijriDate();
                    if (!h) return await sock.sendMessage(sender, { text: '❌ Gagal mengambil tanggal hijriah.' });
                    await sock.sendMessage(sender, { text: `🌙 *Tanggal Hijriah Hari Ini*\n━━━━━━━━━━━━━━━━━━━━━━\n📅 *${h.formatted}*\n${h.monthAr ? `🕌 ${h.monthAr}\n` : ''}🗓️ ${h.weekday}\n━━━━━━━━━━━━━━━━━━━━━━` });
                    botState.incrementSent();
                    botState.saveStats();
                } catch (e) {
                    await sock.sendMessage(sender, { text: '❌ Gagal mengambil tanggal hijriah.' });
                }
                return true;
            }

            case 'setkota':
                if (args.length < 2) return await sock.sendMessage(sender, { text: 'Format: /setkota <kota>' });
                const kotaSet = args.slice(1).join(' ');
                utils.setDefaultSholatCity(kotaSet);
                await sock.sendMessage(sender, { text: `Kota default jadwal sholat diubah ke ${kotaSet}` });
                return true;

            case 'ai': {
                // Handler /ai dan /ai reset
                const subcmd = (args[0] || '').toLowerCase();
                if (subcmd === 'reset' || subcmd === 'resetmemori') {
                    if (global.userAIMemory) delete global.userAIMemory[sender];
                    let mem = utils.readUserAIMemory(sender);
                    if (mem && Array.isArray(mem)) {
                        mem.length = 0;
                        utils.writeUserAIMemory(mem);
                    }
                    await sock.sendMessage(sender, { text: 'ðŸ§  *AI Memory Reset Complete!* ðŸ”„\n\nâœ… Your conversation history has been cleared!\n\n*What was reset:*\nâ€¢ All previous conversations\nâ€¢ Context memory\nâ€¢ Personal preferences\n\nðŸ†• *Fresh start benefits:*\nâ€¢ Clean conversation context\nâ€¢ No outdated information\nâ€¢ Better AI responses\n\nðŸ’¡ Start a new conversation with `/ai hello`!' });
                    return true;
                }
                try {
                    // Inisialisasi mem sebelum dipakai
                    let mem = global.userAIMemory || {};
                    if (!mem[sender]) {
                        const dbMem = utils.readUserAIMemory(sender);
                        // Pastikan mem[sender] selalu array
                        if (dbMem && Array.isArray(dbMem)) {
                            mem[sender] = dbMem;
                        } else {
                            mem[sender] = [];
                        }
                    } else if (!Array.isArray(mem[sender])) {
                        // Jika mem[sender] bukan array, reset ke array kosong
                        mem[sender] = [];
                    }
                    
                    // OPTIMIZED: Gunakan system prompt yang pendek untuk hemat token
                    const systemPrompt = SHORT_SYSTEM_PROMPT;
                    
                    // OPTIMIZED: Kurangi history dari 4 jadi 3 untuk hemat token
                    const history = Array.isArray(mem[sender]) ? mem[sender].slice(-AI_OPTIMIZATIONS.MAX_HISTORY_LENGTH) : [];
                    
                    const prompt = args.join(' ').trim();
                    if (!prompt) return await sock.sendMessage(sender, { text: 'ðŸ¤– *AI Chat Assistant* ðŸ’¬\n\nPlease provide a message to chat with AI!\n\nðŸ“‹ *Format:* `/ai <your message>`\n\nâœ¨ *Examples:*\nâ€¢ `/ai Hello, how are you?`\nâ€¢ `/ai Explain quantum physics simply`\nâ€¢ `/ai Write a poem about coffee`\nâ€¢ `/ai Help me plan my day`\n\nðŸ§  *Features:*\nâ€¢ Context-aware conversations\nâ€¢ Remembers chat history\nâ€¢ Emotional intelligence\nâ€¢ Multiple languages support\n\nðŸ’¡ Type `/ai reset` to clear conversation history!' });
                    
                    // OPTIMIZED: Disable auto-summary untuk hemat token
                    if (AI_OPTIMIZATIONS.ENABLE_AUTO_SUMMARY) {
                        const _isSignificantEmotion = (txt) => {
                            const kws = ['kesel', 'sedih', 'takut', 'kecewa', 'marah', 'galau', 'capek', 'lelah', 'bingung'];
                            return kws.some(k => String(txt || '').toLowerCase().includes(k));
                        };
                        const isSignificant = _isSignificantEmotion(prompt);
                        if (isSignificant && Array.isArray(mem[sender]) && mem[sender].filter(h => h.role === 'user').length % 8 === 0) { // Ubah dari 5 jadi 8
                            try {
                                const summaryPrompt = [
                                    { role: 'system', content: 'Ringkas emosi user dalam 1 kalimat.' }, // Shortened prompt
                                    ...(Array.isArray(mem[sender]) ? mem[sender].slice(-5).map(h => ({ role: h.role, content: h.content })) : []), // Kurangi dari 10 jadi 5
                                    { role: 'user', content: 'Ringkas kondisi emosional saya.' }
                                ];
                                const resSum = await axios.post(
                                    'https://api.deepseek.com/v1/chat/completions',
                                    { model: 'deepseek-chat', messages: summaryPrompt },
                                    { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 } // Kurangi timeout
                                );
                                const summary = resSum.data?.choices?.[0]?.message?.content || '';
                                if (summary) utils.saveUserSummary(sender, summary);
                            } catch (e) { logger.error('Auto-summary error:', e); }
                        }
                    }
                    
                    // OPTIMIZED: Disable deteksi emosi untuk hemat token
                    let detectedEmotion = '';
                    if (AI_OPTIMIZATIONS.ENABLE_EMOTION_DETECTION) {
                        try {
                            const emotionPrompt = [
                                { role: 'system', content: 'Deteksi emosi user. Jawab 1 kata.' }, // Shortened prompt
                                { role: 'user', content: prompt }
                            ];
                            const resEmo = await axios.post(
                                'https://api.deepseek.com/v1/chat/completions',
                                { model: 'deepseek-chat', messages: emotionPrompt },
                                { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 } // Kurangi timeout
                            );
                            detectedEmotion = resEmo.data?.choices?.[0]?.message?.content || '';
                            logger.info(`[AI EMOTION] ${sender}: ${detectedEmotion}`);
                        } catch (e) { logger.error('Deteksi emosi error:', e); }
                    }
                    
                    // === Gunakan summary sebagai konteks jika ada ===
                    const userSummary = utils.getUserSummary ? utils.getUserSummary(sender) : '';
                    const messages = [
                        { role: 'system', content: systemPrompt },
                        ...(userSummary ? [{ role: 'assistant', content: userSummary }] : []), // Hapus "[EMOTIONAL SUMMARY]\n" untuk hemat token
                        ...history.map(h => ({ role: h.role, content: h.content })),
                        { role: 'user', content: prompt }
                    ];
                    let reply = 'Maaf, tidak ada jawaban dari AI.';
                    let errorMsg = '';
                    let lastError = null;
                    let maxRetry = AI_OPTIMIZATIONS.MAX_RETRY; // Kurangi retry
                    let attempt = 0;
                    while (attempt <= maxRetry) {
                        try {
                            const res = await axios.post(
                                'https://api.deepseek.com/v1/chat/completions',
                                {
                                    model: 'deepseek-chat',
                                    messages
                                },
                                {
                                    headers: {
                                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                                        'Content-Type': 'application/json'
                                    },
                                    timeout: 30000 // Kurangi timeout dari 40s jadi 30s
                                }
                            );
                            if (res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content) {
                                reply = res.data.choices[0].message.content;
                                mem[sender].push({ role: 'assistant', content: reply, time: Date.now() });
                                errorMsg = '';
                                break;
                            } else {
                                errorMsg = 'API DeepSeek tidak mengembalikan jawaban.';
                                break;
                            }
                        } catch (e) {
                            lastError = e;
                            // OPTIMIZED: Kurangi retry logic
                            if ((e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || (e.message && e.message.includes('timeout'))) && attempt < maxRetry) {
                                attempt++;
                                await new Promise(r => setTimeout(r, 2000 * attempt)); // Increase backoff delay
                                continue;
                            } else {
                                logger.error('AI DeepSeek Error:', {
                                    error: e.message,
                                    code: e.code,
                                    prompt: prompt.substring(0, 100), // Log only first 100 chars
                                    user: sender,
                                    time: new Date().toISOString()
                                });
                                errorMsg = e.response?.data?.error?.message || e.message || 'Gagal menghubungi API DeepSeek.';
                                break;
                            }
                        }
                    }
                    if (errorMsg) {
                        reply = 'AI sedang sibuk atau down, coba lagi beberapa saat lagi.';
                    }
                    global.userAIMemory = mem;
                    utils.writeUserAIMemory(mem);
                    await sock.sendMessage(sender, { text: `${reply}${errorMsg ? '\n\nError: ' + errorMsg : ''}` });
                } catch (e) {
                    logger.error('Handler /ai error:', e);
                    await sock.sendMessage(sender, { text: 'ðŸ¤– *AI System Error* âš ï¸\n\nSorry, the AI encountered an internal error!\n\nðŸ”§ *Possible causes:*\nâ€¢ AI service temporarily overloaded\nâ€¢ Network connectivity issues\nâ€¢ Server maintenance\n\nðŸ”„ *Quick fixes:*\nâ€¢ Try again in a few moments\nâ€¢ Use simpler questions\nâ€¢ Check your internet connection\n\nðŸ’¡ If problem persists, contact admin!' });
                }
                return true;
            }

            case 'hidetag':
                if (args.length < 2) return await sock.sendMessage(sender, { text: 'Format: /hidetag <pesan>' });
                const group = await sock.groupMetadata(msg.key.remoteJid);
                const mentions = group.participants.map(p => p.id);
                await sock.sendMessage(msg.key.remoteJid, args.slice(1).join(' '), mentions);
                botState.incrementSent();
                botState.saveStats();
                return true;

            case 'sbirthday':
                if (args.length < 3) {
                    await sock.sendMessage(sender, { text: 'Format: /sbirthday <nomor> <tanggal> [nama]\nContoh: /sbirthday 6281234567890 10-09 Deasy' });
                    return true;
                }
                const nomorS = args[1].replace(/\D/g, '');
                const tanggalS = args[2];
                const namaS = args.slice(3).join(' ');
                if (!/^\d{2}-\d{2}$/.test(tanggalS)) {
                    await sock.sendMessage(sender, { text: 'Format tanggal salah. Gunakan DD-MM, contoh: 10-09' });
                    return true;
                }
                if (!nomorS) {
                    await sock.sendMessage(sender, { text: 'Nomor tidak valid.' });
                    return true;
                }
                let bds = utils.getBirthdays();
                let idx = bds.findIndex(bd => (bd.number || bd.nomor) === nomorS && (bd.date || bd.tanggal) === tanggalS);
                if (idx >= 0) {
                    if (namaS) bds[idx].name = namaS;
                    utils.saveBirthdays(bds);
                    await sock.sendMessage(sender, { text: `Ulang tahun untuk ${nomorS} pada ${tanggalS} diupdate.` });
                } else {
                    bds.push({ number: nomorS, date: tanggalS, name: namaS });
                    utils.saveBirthdays(bds);
                    await sock.sendMessage(sender, { text: `Ulang tahun untuk ${nomorS} pada ${tanggalS} ditambahkan.` });
                }
                return true;

            case 'help':
            case 'menu': {
                const commandsByCategory = {
                    'ðŸ¤– AI & Intelligence': [
                        'ðŸ§  /ai <pesan> - Chat dengan AI yang cerdas',
                        'ðŸ”„ /ai reset - Reset memori percakapan AI',
                        'âš™ï¸ /ai-auto on/off - Toggle auto-reply AI (admin)',
                        'ðŸŽ›ï¸ /ai-optimize - Pengaturan optimasi AI (admin)'
                    ],
                    'ðŸ›¡ï¸ Bot Management & Admin': [
                        'ðŸ“Š /status - Dashboard status bot & server',
                        'ðŸ“ˆ /stats - Statistik performa lengkap',
                        'ðŸ’¾ /backup - Backup semua data bot (admin)',
                        'ðŸ“¥ /restore <file> - Restore dari backup (admin)',
                        'ðŸ”§ /maintenance on/off - Mode maintenance (admin)'
                    ],
                    'ðŸ‘¥ User & Admin Control': [
                        'ðŸ‘‘ /admin <nomor> - Tambah admin baru (owner)',
                        'âŒ /deladmin <nomor> - Hapus admin (owner)',
                        'ðŸ“‹ /listadmin - Daftar semua admin (admin)',
                        'ðŸ” /cekwa <nomor> - Cek status nomor WhatsApp'
                    ],
                    'ðŸŒ Information & Weather': [
                        'ðŸŒ¤ï¸ /cuaca <kota> - Cek cuaca real-time',
                        'ðŸ•Œ /sholat <kota> - Jadwal sholat lengkap',
                        'ðŸ™ï¸ /setkota <kota> - Set kota default (admin)',
                        'ðŸ’± /convert <amount> <from> to <to> - Convert mata uang'
                    ],
                    'ðŸ“± Social Media Downloader': [
                        'ðŸŽµ /tiktok <url> - Download TikTok tanpa watermark',
                        'ðŸ“¸ /igfoto <url> - Download Instagram foto/post',
                        'ðŸŽ¬ /igreels <url> - Download Instagram reels',
                        'ðŸ“º /igstory <id> - Download Instagram story'
                    ],
                    'ðŸ”§ Productivity Tools': [
                        'ðŸ”² /qr generate <text> - Generate QR code kustom',
                        'ðŸ“± /qr scan - Scan QR code dari gambar',
                        'ðŸ”— /short <url> - URL shortener canggih',
                        'ðŸŽ­ /stiker - Buat stiker dari gambar/teks'
                    ],
                    'ðŸ’° Financial Management': [
                        'ðŸ’³ /expense add <kategori> <jumlah> <deskripsi> - Catat pengeluaran',
                        'ðŸ“‹ /expense list - Daftar 10 pengeluaran terakhir',
                        'ðŸ“Š /expense report [period] - Laporan keuangan detail',
                        'ðŸ§¾ /invoice create <customer> <item> <harga>',
                        'ðŸ“„ /invoice list - Daftar semua invoice'
                    ],
                    'ðŸ” Web Search & Research': [
                        'ðŸŒ /web <query> - Cari informasi di internet',
                        'ðŸ“° /ringkas <url> - Ringkas artikel otomatis',
                        'â“ /jawab <pertanyaan> - Jawab dari sumber web terpercaya'
                    ],
                    'â° Reminders & Schedule': [
                        'â° /remind <waktu> <pesan> - Reminder sekali pakai',
                        'ðŸ”” /remindme <interval> <pesan> - Reminder berulang',
                        'ðŸŽ‚ /sbirthday <nomor> <tanggal> [nama] - Set reminder ulang tahun'
                    ],
                    'ðŸ’¬ Group Features': [
                        'ðŸ‘¥ /hidetag <pesan> - Mention semua member (admin)',
                        'ðŸ“¤ /send <nomor> <pesan> - Kirim pesan broadcast (admin)'
                    ]
                };

                let helpText = `🚀 *WHATSAPP BOT COMMAND CENTER*\n`;
                helpText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                helpText += `🤖 *Multi-Feature WA Bot (Baileys)*\n`;
                if (OWNER_NUMBER) helpText += `👤 Owner: \`+${OWNER_NUMBER}\`\n\n`;
                else helpText += '\n';
                
                Object.entries(commandsByCategory).forEach(([category, commands]) => {
                    helpText += `${category}\n`;
                    commands.forEach(cmd => {
                        helpText += `${cmd}\n`;
                    });
                    helpText += `\n`;
                });
                
                helpText += `ðŸ’¡ *USAGE TIPS & TRICKS*\n`;
                helpText += `â”œâ”€ ðŸŽ¯ Gunakan \`/help <command>\` untuk detail spesifik\n`;
                helpText += `â”œâ”€ ðŸŒŸ Bot mendukung grup dan chat pribadi\n`;
                helpText += `â”œâ”€ ðŸ¤– AI terintegrasi untuk pengalaman yang lebih natural\n`;
                helpText += `â”œâ”€ ðŸ“± Semua fitur dioptimalkan untuk mobile WhatsApp\n`;
                helpText += `â””â”€ âš¡ Response time rata-rata < 2 detik\n\n`;
                
                helpText += `ðŸ†• *NEW FEATURES SPOTLIGHT*\n`;
                helpText += `â”œâ”€ ðŸ”² QR Code Generator & Scanner\n`;
                helpText += `â”œâ”€ ðŸ”— Smart URL Shortener dengan tracking\n`;
                helpText += `â”œâ”€ ðŸ’° Expense Tracker dengan analisis\n`;
                helpText += `â”œâ”€ ðŸ“„ Professional Invoice Generator\n`;
                helpText += `â””â”€ ðŸ¤– AI dengan memory dan context awareness\n\n`;
                
                helpText += `ðŸŽ® *QUICK START COMMANDS*\n`;
                helpText += `â”œâ”€ \`/ai hello\` - ðŸ§ª Test AI response\n`;
                helpText += `â”œâ”€ \`/cuaca jakarta\` - ðŸŒ¤ï¸ Check weather\n`;
                helpText += `â”œâ”€ \`/qr generate test\` - ðŸ”² Test QR generator\n`;
                helpText += `â””â”€ \`/status\` - ðŸ“Š Check bot health\n\n`;
                
                helpText += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
                helpText += `â“ Need help? Contact admin â€¢ ðŸ”„ Bot auto-updates\n`;
                helpText += `ðŸ’ª *Ready to boost your productivity!*`;

                await sock.sendMessage(sender, { text: helpText });
                return true;
            }

            case 'birthday':
                try {
                    const bds = utils.getBirthdays();
                    if (!bds.length) {
                        await sock.sendMessage(sender, { text: 'Belum ada data ulang tahun.' });
                        return true;
                    }
                    let text = '*ðŸŽ‚ Daftar Ulang Tahun:*\n';
                    bds.forEach((bd, i) => {
                        text += `${i+1}. ${bd.name || '-'} (${bd.number || bd.nomor}) - ${bd.date || bd.tanggal}\n`;
                    });
                    await sock.sendMessage(sender, { text });
                } catch (e) {
                    await sock.sendMessage(sender, { text: 'Gagal mengambil data ulang tahun.' });
                }
                return true;

            case 'admin':
                // Parsing nomor dari kalimat bebas
                const adminText = args.join(' ');
                const nomorAdminMatch = adminText.match(/\d{10,15}/);
                const nomorAdmin = nomorAdminMatch ? nomorAdminMatch[0] : '';
                if (!nomorAdmin) return await sock.sendMessage(sender, { text: utils.errorMsg('Format: /admin <nomor>') });
                let adminList = utils.getAdmins();
                // Tidak boleh menambah owner sebagai admin (owner sudah otomatis punya hak penuh)
                if (nomorAdmin === OWNER_NUMBER) return await sock.sendMessage(sender, { text: utils.errorMsg('Owner sudah punya hak akses penuh.') });
                if (adminList.includes(nomorAdmin)) return await sock.sendMessage(sender, { text: utils.errorMsg('Sudah admin.') });
                // Hanya owner yang boleh menambah admin
                if (senderNum !== OWNER_NUMBER) return await sock.sendMessage(sender, { text: utils.errorMsg('Hanya owner yang bisa menambah admin.') });
                adminList.push(nomorAdmin);
                utils.saveAdmins(adminList);
                
                // OPTIMIZED: Disable AI untuk notifikasi admin (hemat token)
                const adminTargetJid = toJid(nomorAdmin);
                if (AI_OPTIMIZATIONS.ENABLE_AI_ADMIN_RESPONSES) {
                    // Notifikasi ke admin baru via AI
                    try {
                        const aiPromptAdmin = [
                            { role: 'system', content: 'Singkat aja: kasih selamat jadi admin bot.' },
                            { role: 'user', content: `Kamu baru jadi admin bot.` }
                        ];
                        const aiResAdmin = await axios.post(
                            'https://api.deepseek.com/v1/chat/completions',
                            { model: 'deepseek-chat', messages: aiPromptAdmin },
                            { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
                        );
                        const aiTextAdmin = aiResAdmin.data?.choices?.[0]?.message?.content?.trim() || `Selamat, kamu sudah jadi admin bot!`;
                        await sock.sendMessage(adminTargetJid, { text: aiTextAdmin, mentions: [adminTargetJid, sender] });
                    } catch (e) {
                        await sock.sendMessage(adminTargetJid, { text: `Selamat, kamu sudah jadi admin bot!`, mentions: [adminTargetJid, sender] });
                    }
                    // AI feedback ke pengirim command
                    try {
                        const aiPrompt = [
                            { role: 'system', content: 'Singkat aja: admin baru sudah ditambahkan.' },
                            { role: 'user', content: `Admin ${nomorAdmin} sudah ditambahkan.` }
                        ];
                        const aiRes = await axios.post(
                            'https://api.deepseek.com/v1/chat/completions',
                            { model: 'deepseek-chat', messages: aiPrompt },
                            { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
                        );
                        const aiText = aiRes.data?.choices?.[0]?.message?.content?.trim() || `Admin ${nomorAdmin} ditambahkan.`;
                        await sock.sendMessage(sender, { text: aiText, mentions: [adminTargetJid] });
                    } catch (e) {
                        await sock.sendMessage(sender, { text: `Admin ${nomorAdmin} ditambahkan.` });
                    }
                } else {
                    // OPTIMIZED: Use simple template instead of AI (save tokens)
                    await sock.sendMessage(adminTargetJid, { text: `ðŸŽ‰ Selamat! Kamu sudah jadi admin bot WhatsApp ini. Gunakan /help untuk melihat command admin.`, mentions: [adminTargetJid, sender] });
                    await sock.sendMessage(sender, { text: `âœ… Admin ${nomorAdmin} berhasil ditambahkan dan sudah diberitahu.`, mentions: [adminTargetJid] });
                }
                logger.info(`New admin added: ${nomorAdmin} by ${senderNum}`);
                return true;

            case 'deladmin':
                // Parsing nomor dari kalimat bebas
                const delText = args.join(' ');
                const nomorDelMatch = delText.match(/\d{10,15}/);
                const nomorDel = nomorDelMatch ? nomorDelMatch[0] : '';
                if (!nomorDel) return await sock.sendMessage(sender, { text: utils.errorMsg('Format: /deladmin <nomor>') });
                let adminListDel = utils.getAdmins();
                // Tidak boleh menghapus owner
                if (nomorDel === OWNER_NUMBER) return await sock.sendMessage(sender, { text: utils.errorMsg('Owner tidak bisa dihapus dari admin.') });
                if (!adminListDel.includes(nomorDel)) return await sock.sendMessage(sender, { text: utils.errorMsg('Nomor bukan admin.') });
                // Hanya owner yang boleh menghapus admin
                if (senderNum !== OWNER_NUMBER) return await sock.sendMessage(sender, { text: utils.errorMsg('Hanya owner yang bisa menghapus admin.') });
                adminListDel = adminListDel.filter(a => a !== nomorDel);
                utils.saveAdmins(adminListDel);
                
                // OPTIMIZED: Disable AI untuk notifikasi admin (hemat token)
                const delTargetJid = toJid(nomorDel);
                if (AI_OPTIMIZATIONS.ENABLE_AI_ADMIN_RESPONSES) {
                    // Notifikasi ke admin yang dihapus via AI
                    try {
                        const aiPromptDel = [
                            { role: 'system', content: 'Singkat aja: status admin dicabut.' },
                            { role: 'user', content: `Status admin kamu dicabut.` }
                        ];
                        const aiResDel = await axios.post(
                            'https://api.deepseek.com/v1/chat/completions',
                            { model: 'deepseek-chat', messages: aiPromptDel },
                            { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
                        );
                        const aiTextDel = aiResDel.data?.choices?.[0]?.message?.content?.trim() || `Status admin kamu sudah dicabut.`;
                        await sock.sendMessage(delTargetJid, { text: aiTextDel, mentions: [delTargetJid, sender] });
                    } catch (e) {
                        await sock.sendMessage(delTargetJid, { text: `Status admin kamu sudah dicabut.`, mentions: [delTargetJid, sender] });
                    }
                    // AI feedback ke pengirim command
                    try {
                        const aiPrompt = [
                            { role: 'system', content: 'Singkat aja: admin sudah dihapus.' },
                            { role: 'user', content: `Admin ${nomorDel} sudah dihapus.` }
                        ];
                        const aiRes = await axios.post(
                            'https://api.deepseek.com/v1/chat/completions',
                            { model: 'deepseek-chat', messages: aiPrompt },
                            { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 }
                        );
                        const aiText = aiRes.data?.choices?.[0]?.message?.content?.trim() || `Admin ${nomorDel} telah dihapus.`;
                        await sock.sendMessage(sender, { text: aiText, mentions: [delTargetJid] });
                    } catch (e) {
                        await sock.sendMessage(sender, { text: `Admin ${nomorDel} telah dihapus.` });
                    }
                } else {
                    // OPTIMIZED: Use simple template instead of AI (save tokens)
                    await sock.sendMessage(delTargetJid, { text: `ðŸ“¢ Status admin kamu sudah dicabut. Terima kasih atas kontribusinya!`, mentions: [delTargetJid, sender] });
                    await sock.sendMessage(sender, { text: `âœ… Admin ${nomorDel} berhasil dihapus dan sudah diberitahu.`, mentions: [delTargetJid] });
                }
                logger.info(`Admin removed: ${nomorDel} by ${senderNum}`);
                return true;

            case 'maintenance':
                if (args.length < 1) return await sock.sendMessage(sender, { text: utils.errorMsg('ðŸ”§ *Maintenance Mode Control* âš™ï¸\n\nPlease specify the action!\n\nðŸ“‹ *Format:* `/maintenance on|off`\n\nðŸ’¡ *Usage:*\nâ€¢ `/maintenance on` - Enable maintenance mode\nâ€¢ `/maintenance off` - Disable maintenance mode\n\nâš ï¸ When enabled, only owner can use the bot!') });
                if (args[0] === 'on') {
                    botState.setMaintenanceMode(true);
                    await sock.sendMessage(sender, { text: 'ðŸ”§ *Maintenance Mode ACTIVATED* âš ï¸\n\nðŸš« Bot is now in maintenance mode!\n\n*What this means:*\nâ€¢ Only owner can use bot commands\nâ€¢ All other users will see maintenance message\nâ€¢ Perfect for updates and fixes\n\nâ° Remember to turn it off when done!\nðŸ’¡ Use `/maintenance off` to disable' });
                } else if (args[0] === 'off') {
                    botState.setMaintenanceMode(false);
                    await sock.sendMessage(sender, { text: 'âœ… *Maintenance Mode DISABLED* ðŸŸ¢\n\nðŸŽ‰ Bot is back online for everyone!\n\n*Status:*\nâ€¢ All users can now use commands\nâ€¢ Full functionality restored\nâ€¢ Ready to serve users\n\nðŸ“Š Use `/status` to check bot health!' });
                } else {
                    await sock.sendMessage(sender, { text: utils.errorMsg('â“ *Invalid Option* âŒ\n\nPlease use either `on` or `off`!\n\nðŸ“‹ *Valid Commands:*\nâ€¢ `/maintenance on` - Enable maintenance\nâ€¢ `/maintenance off` - Disable maintenance\n\nðŸ’¡ Current status: ' + (botState.maintenanceMode ? '*ðŸ”§ ON*' : '*ðŸŸ¢ OFF*')) });
                }
                return true;

            case 'status':
                const admins = utils.getAdmins();
                const city = utils.getDefaultSholatCity();
                const scheduled = utils.getScheduledMessages();
                const birthdays = utils.getBirthdays();
                const uptimeMs = Date.now() - (botState.stats.startTime || Date.now());
                const sysInfo = getSystemInfo();
                
                // Status indicator berdasarkan kondisi
                const getStatusEmoji = () => {
                    if (botState.maintenanceMode) return 'ðŸ”§';
                    if (sysInfo.memory.percentage > 90) return 'âš ï¸';
                    if (sysInfo.cpu.usage > 80) return 'ðŸ”¥';
                    return 'âœ…';
                };
                
                const getHealthStatus = () => {
                    const memUsage = parseFloat(sysInfo.memory.percentage);
                    const cpuUsage = parseFloat(sysInfo.cpu.usage);
                    
                    if (memUsage > 90 || cpuUsage > 90) return 'ðŸ”´ Critical';
                    if (memUsage > 70 || cpuUsage > 70) return 'ðŸŸ¡ Warning';
                    return 'ðŸŸ¢ Healthy';
                };
                
                const getUptimeColor = () => {
                    const hours = uptimeMs / (1000 * 60 * 60);
                    if (hours > 72) return 'ðŸ’š'; // 3+ hari
                    if (hours > 24) return 'ðŸ’›'; // 1+ hari  
                    return 'ðŸ¤'; // < 1 hari
                };
                
                let text = `${getStatusEmoji()} *BOT STATUS DASHBOARD*\n`;
                text += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
                
                // Bot Info Section
                text += `🤖 *BOT INFORMATION*\n`;
                text += `├─ 📦 Type: *WhatsApp Bot (Baileys)*\n`;
                if (OWNER_NUMBER) text += `├─ 👤 Owner: \`+${OWNER_NUMBER}\`\n`;
                text += `├─ 🚀 Status: ${botState.maintenanceMode ? '🔧 *Maintenance*' : '🟢 *Online*'}\n`;
                text += `└─ 💾 Version: \`v2.0.0\`\n\n`;
                
                // Performance Stats
                text += `ðŸ“Š *PERFORMANCE METRICS*\n`;
                text += `â”œâ”€ ${getUptimeColor()} Uptime: *${formatDuration(uptimeMs)}*\n`;
                text += `â”œâ”€ ðŸ“¤ Messages Sent: *${botState.stats.sent.toLocaleString('id-ID')}*\n`;
                text += `â”œâ”€ âŒ Errors: *${botState.stats.error.toLocaleString('id-ID')}*\n`;
                text += `â”œâ”€ ðŸ“ˆ Success Rate: *${botState.stats.sent ? ((botState.stats.sent / (botState.stats.sent + botState.stats.error)) * 100).toFixed(1) : '100'}%*\n`;
                text += `â””â”€ ðŸ¥ Health: *${getHealthStatus()}*\n\n`;
                
                // System Resources
                text += `ðŸ–¥ï¸ *SYSTEM RESOURCES*\n`;
                text += `â”œâ”€ ðŸ§  CPU: *${sysInfo.cpu.cores} cores* @ *${(sysInfo.cpu.speed / 1000).toFixed(1)}GHz*\n`;
                text += `â”œâ”€ ðŸ“Š CPU Load: *${sysInfo.cpu.usage}%* ${sysInfo.cpu.usage > 80 ? 'ðŸ”¥' : sysInfo.cpu.usage > 50 ? 'ðŸŸ¡' : 'ðŸŸ¢'}\n`;
                text += `â”œâ”€ ðŸ’¾ RAM Usage: *${formatBytes(sysInfo.memory.used)}* / *${formatBytes(sysInfo.memory.total)}*\n`;
                text += `â”œâ”€ ðŸ“ˆ Memory: *${sysInfo.memory.percentage}%* ${sysInfo.memory.percentage > 80 ? 'ðŸ”¥' : sysInfo.memory.percentage > 60 ? 'ðŸŸ¡' : 'ðŸŸ¢'}\n`;
                text += `â”œâ”€ ðŸ’¿ Storage: *${formatBytes(sysInfo.storage.used)}* / *${formatBytes(sysInfo.storage.total)}*\n`;
                text += `â”œâ”€ ðŸ“¦ Disk Usage: *${sysInfo.storage.percentage}%* ${sysInfo.storage.percentage > 85 ? 'ðŸ”¥' : sysInfo.storage.percentage > 70 ? 'ðŸŸ¡' : 'ðŸŸ¢'}\n`;
                text += `â””â”€ ðŸŒ Hostname: \`${sysInfo.system.hostname}\`\n\n`;
                
                // Bot Features & Data
                text += `âš™ï¸ *BOT FEATURES & DATA*\n`;
                text += `â”œâ”€ ðŸ‘¥ Admins: *${admins.length}* ${admins.length > 0 ? `(${admins.slice(0,2).join(', ')}${admins.length > 2 ? '...' : ''})` : ''}\n`;
                text += `â”œâ”€ â° Scheduled Tasks: *${scheduled.length}* ${scheduled.length > 0 ? 'ðŸŸ¢' : 'âšª'}\n`;
                text += `â”œâ”€ ðŸŽ‚ Birthdays: *${birthdays.length}* ${birthdays.length > 0 ? 'ðŸŸ¢' : 'âšª'}\n`;
                text += `â”œâ”€ ðŸ•Œ Default City: *${city.charAt(0).toUpperCase() + city.slice(1)}*\n`;
                text += `â”œâ”€ ðŸ¤– AI Auto-reply: ${global.aiAutoReply ? '*ðŸŸ¢ Active*' : '*ðŸ”´ Disabled*'}\n`;
                text += `â””â”€ ðŸ”§ AI Optimized: *ðŸŸ¢ Token Saving Mode*\n\n`;
                
                // Quick Commands
                text += `âš¡ *QUICK ACCESS*\n`;
                text += `â”œâ”€ \`/help\` - ðŸ“‹ Command list\n`;
                text += `â”œâ”€ \`/stats\` - ðŸ“Š Detailed stats  \n`;
                text += `â”œâ”€ \`/ai hello\` - ðŸ¤– Test AI chat\n`;
                text += `â””â”€ \`/qr generate test\` - ðŸ”² Test QR gen\n\n`;
                
                // Footer
                text += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
                text += `ðŸ’¡ Bot running smoothly with *${commandList.length}* commands available!\n`;
                text += `ðŸ”„ Last updated: *${formatDateTimeID(new Date())}*`;
                
                await sock.sendMessage(sender, { text });
                return true;

            case 'stats':
                const uptimeMsStats = Date.now() - (botState.stats.startTime || Date.now());
                let statsText = `ðŸ“Š *STATISTIK BOT DASHBOARD*\n`;
                statsText += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
                
                // Owner Info
                statsText += `🤖 *BOT INFORMATION*\n`;
                statsText += `├─ 🏷️ Type: *WhatsApp Bot (Baileys)*\n`;
                if (OWNER_NUMBER) statsText += `├─ 👤 Owner: \`+${OWNER_NUMBER}\`\n`;
                statsText += `└─ ⚙️ Version: *v2.0.0*\n\n`;
                
                // Performance Statistics
                statsText += `ðŸ“ˆ *PERFORMANCE ANALYTICS*\n`;
                statsText += `â”œâ”€ ðŸš€ Started: *${formatDateTimeID(botState.stats.startTime)}*\n`;
                statsText += `â”œâ”€ â° Uptime: *${formatDuration(uptimeMsStats)}*\n`;
                statsText += `â”œâ”€ ðŸ“¤ Messages Sent: *${botState.stats.sent.toLocaleString('id-ID')}*\n`;
                statsText += `â”œâ”€ âŒ Total Errors: *${botState.stats.error.toLocaleString('id-ID')}*\n`;
                
                // Calculate additional metrics
                const totalOperations = botState.stats.sent + botState.stats.error;
                const successRate = totalOperations > 0 ? ((botState.stats.sent / totalOperations) * 100).toFixed(2) : '100';
                const avgMsgPerHour = uptimeMsStats > 0 ? ((botState.stats.sent / (uptimeMsStats / (1000 * 60 * 60))).toFixed(1)) : '0';
                
                statsText += `â”œâ”€ ðŸ“Š Success Rate: *${successRate}%* ${successRate > 95 ? 'ðŸ†' : successRate > 85 ? 'âœ…' : 'âš ï¸'}\n`;
                statsText += `â”œâ”€ âš¡ Avg Msg/Hour: *${avgMsgPerHour}*\n`;
                statsText += `â””â”€ ðŸŽ¯ Reliability: *${successRate > 99 ? 'Excellent' : successRate > 95 ? 'Very Good' : successRate > 90 ? 'Good' : 'Needs Attention'}*\n\n`;
                
                // Feature Usage Stats
                statsText += `ðŸŽ® *FEATURE HIGHLIGHTS*\n`;
                statsText += `â”œâ”€ ðŸ¤– AI Commands: *Available*\n`;
                statsText += `â”œâ”€ ðŸ”² QR Generator: *Ready*\n`;
                statsText += `â”œâ”€ ðŸ”— URL Shortener: *Active*\n`;
                statsText += `â”œâ”€ ðŸ’° Expense Tracker: *Functional*\n`;
                statsText += `â”œâ”€ ðŸ“„ Invoice Generator: *Operational*\n`;
                statsText += `â”œâ”€ ðŸŒ¤ï¸ Weather Info: *Connected*\n`;
                statsText += `â”œâ”€ ðŸ•Œ Prayer Times: *Synced*\n`;
                statsText += `â””â”€ ðŸ“± Social Media DL: *Ready*\n\n`;
                
                // Motivational Footer
                const getMotivationalMsg = () => {
                    const hour = new Date().getHours();
                    if (hour < 12) return 'ðŸŒ… Good morning! Start your day with productivity!';
                    if (hour < 17) return 'â˜€ï¸ Keep pushing! You\'re doing great today!';
                    if (hour < 21) return 'ðŸŒ† Evening vibes! Time to wind down.';
                    return 'ðŸŒ™ Good night! Rest well for tomorrow\'s adventures!';
                };
                
                statsText += `ðŸ’¬ *DAILY MOTIVATION*\n`;
                statsText += `${getMotivationalMsg()}\n\n`;
                
                statsText += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
                statsText += `âœ¨ *"Technology at the service of productivity!"* âœ¨`;
                
                await sock.sendMessage(sender, { text: statsText });
                return true;

            case 'ai-auto':
                if (!isFromAdmin) return await sock.sendMessage(sender, { text: utils.errorMsg('Hanya admin yang bisa mengubah mode AI auto-reply.') });
                if (args.length < 2) return await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-auto on|off') });
                if (args[1] === 'on') {
                    global.aiAutoReply = true;
                    await sock.sendMessage(sender, { text: 'Auto-reply AI diaktifkan.' });
                } else if (args[1] === 'off') {
                    global.aiAutoReply = false;
                    await sock.sendMessage(sender, { text: 'Auto-reply AI dinonaktifkan.' });
                } else {
                    await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-auto on|off') });
                }
                return true;

            case 'igreels': {
                if (args.length < 2) return await sock.sendMessage(sender, { text: 'Format: /igreels <url>' });
                const url = args[1];
                const match = url.match(/reel\/([\w-]+)/i);
                const id = match ? match[1] : null;
                if (!id) return await sock.sendMessage(sender, { text: 'Link reels tidak valid.' });
                try {
                    logger.info('Memproses download IG Reels:', url);
                    const apiUrl = `https://instagram-scrapper-posts-reels-stories-downloader.p.rapidapi.com/reel_by_id?reel_id=${id}`;
                    const options = {
                        headers: {
                            'x-rapidapi-key': RAPIDAPI_KEY,
                            'x-rapidapi-host': 'instagram-scrapper-posts-reels-stories-downloader.p.rapidapi.com'
                        },
                        timeout: 10000 // 10 detik
                    };
                    const res = await axios.get(apiUrl, options);
                    logger.info('Respon IG Reels:', res.data);
                    if (res.data && res.data.video_url) {
                        await sock.sendMessage(sender, { video: { url: res.data.video_url }, caption: 'Berhasil download reels.' });
                    } else {
                        await sock.sendMessage(sender, { text: 'Reels tidak ditemukan atau link salah.' });
                    }
                } catch (e) {
                    logger.error('IG Reels Downloader Error:', e);
                    await sock.sendMessage(sender, { text: 'Gagal download reels. Pastikan link benar, tidak private, atau API sedang down.' });
                    global.igreelsErrorCount = (global.igreelsErrorCount || 0) + 1;
                    if (global.igreelsErrorCount >= 3) {
                        await sock.sendMessage(OWNER_JID, { text: `â— [BOT] Error API IG Reels sudah terjadi ${global.igreelsErrorCount}x berturut-turut!` });
                        global.igreelsErrorCount = 0;
                    }
                }
                return true;
            }
            case 'igfoto': {
                if (args.length < 2) return await sock.sendMessage(sender, { text: 'Format: /igfoto <url>' });
                const url = args[1];
                const match = url.match(/\/p\/([\w-]+)/i);
                const id = match ? match[1] : null;
                if (!id) return await sock.sendMessage(sender, { text: 'Link post tidak valid.' });
                try {
                    logger.info('Memproses download IG Foto:', url);
                    const apiUrl = `https://instagram-scrapper-posts-reels-stories-downloader.p.rapidapi.com/post_by_id?post_id=${id}`;
                    const options = {
                        headers: {
                            'x-rapidapi-key': RAPIDAPI_KEY,
                            'x-rapidapi-host': 'instagram-scrapper-posts-reels-stories-downloader.p.rapidapi.com'
                        },
                        timeout: 10000 // 10 detik
                    };
                    const res = await axios.get(apiUrl, options);
                    logger.info('Respon IG Foto:', res.data);
                    if (res.data && res.data.media_url) {
                        if (Array.isArray(res.data.media_url)) {
                            for (const media of res.data.media_url) {
                                if (media.endsWith('.mp4')) {
                                    await sock.sendMessage(sender, { video: { url: media } });
                                } else {
                                    await sock.sendMessage(sender, { image: { url: media } });
                                }
                            }
                        } else {
                            if (res.data.media_url.endsWith('.mp4')) {
                                await sock.sendMessage(sender, { video: { url: res.data.media_url } });
                            } else {
                                await sock.sendMessage(sender, { image: { url: res.data.media_url } });
                            }
                        }
                    } else {
                        await sock.sendMessage(sender, { text: 'Post tidak ditemukan atau link salah.' });
                    }
                } catch (e) {
                    logger.error('IG Foto Downloader Error:', e);
                    await sock.sendMessage(sender, { text: 'Gagal download post IG. Pastikan link benar, tidak private, atau API sedang down.' });
                    global.igfotoErrorCount = (global.igfotoErrorCount || 0) + 1;
                    if (global.igfotoErrorCount >= 3) {
                        await sock.sendMessage(OWNER_JID, { text: `â— [BOT] Error API IG Foto sudah terjadi ${global.igfotoErrorCount}x berturut-turut!` });
                        global.igfotoErrorCount = 0;
                    }
                }
                return true;
            }
            case 'igstory': {
                if (args.length < 2) return await sock.sendMessage(sender, { text: 'Format: /igstory <story_id>' });
                const storyId = args[1];
                if (!/^[0-9]+$/.test(storyId)) {
                    return await sock.sendMessage(sender, { text: 'Untuk saat ini, download story hanya bisa via story_id, bukan username. (Contoh: /igstory 1234567890123456789)' });
                }
                try {
                    const apiUrl = `https://instagram-scrapper-posts-reels-stories-downloader.p.rapidapi.com/story_by_id?story_id=${storyId}`;
                    const options = {
                        headers: {
                            'x-rapidapi-key': RAPIDAPI_KEY,
                            'x-rapidapi-host': 'instagram-scrapper-posts-reels-stories-downloader.p.rapidapi.com'
                        },
                        timeout: 10000 // 10 detik
                    };
                    const res = await axios.get(apiUrl, options);
                    if (res.data && res.data.media_url) {
                        if (Array.isArray(res.data.media_url)) {
                            for (const media of res.data.media_url) {
                                if (media.endsWith('.mp4')) {
                                    await sock.sendMessage(sender, { video: { url: media } });
                                } else {
                                    await sock.sendMessage(sender, { image: { url: media } });
                                }
                            }
                        } else {
                            if (res.data.media_url.endsWith('.mp4')) {
                                await sock.sendMessage(sender, { video: { url: res.data.media_url } });
                            } else {
                                await sock.sendMessage(sender, { image: { url: res.data.media_url } });
                            }
                        }
                    } else {
                        await sock.sendMessage(sender, { text: 'Story tidak ditemukan atau story_id salah.' });
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: 'Gagal download story IG. Pastikan story_id benar, tidak private, atau API sedang down.' });
                    global.igstoryErrorCount = (global.igstoryErrorCount || 0) + 1;
                    if (global.igstoryErrorCount >= 3) {
                        await sock.sendMessage(OWNER_JID, { text: `â— [BOT] Error API IG Story sudah terjadi ${global.igstoryErrorCount}x berturut-turut!` });
                        global.igstoryErrorCount = 0;
                    }
                }
                return true;
            }
            case 'tiktok': {
                if (args.length < 1) return await sock.sendMessage(sender, { text: 'Format: /tiktok <url>' });
                const tiktokUrl = args[0];
                logger.info(`[DEBUG] /tiktok url: ${tiktokUrl}`);
                try {
                    logger.info('Memproses download TikTok:', tiktokUrl);
                    // Encode URL TikTok
                    const encodedUrl = encodeURIComponent(tiktokUrl);
                    const apiUrl = `https://tiktok-download-without-watermark.p.rapidapi.com/analysis?url=${encodedUrl}&hd=0`;
                    const options = {
                        headers: {
                            'x-rapidapi-key': RAPIDAPI_KEY,
                            'x-rapidapi-host': 'tiktok-download-without-watermark.p.rapidapi.com'
                        },
                        timeout: 15000
                    };
                    const res = await axios.get(apiUrl, options);
                    const logData = {
                        code: res.data?.code,
                        videoUrl: res.data?.data?.play,
                        author: res.data?.data?.author?.nickname || res.data?.data?.author?.unique_id,
                        title: res.data?.data?.title,
                        size: res.data?.data?.size,
                        msg: res.data?.msg
                    };
                    logger.info('Respon TikTok (ringkas):', logData);
                    // Cek hasil API
                    const videoUrl = res.data?.data?.play || res.data?.data?.wmplay;
                    const title = res.data?.data?.title || '-';
                    const author = res.data?.data?.author?.nickname || res.data?.data?.author?.unique_id || '-';
                    if (videoUrl) {
                        await sock.sendMessage(sender, { video: { url: videoUrl }, caption: `ðŸŽ¬ *${title}*\nðŸ‘¤ ${author}\n\nSumber: TikTok` });
                    } else {
                        logger.warn('Gagal mendapatkan link video TikTok. Data respons:', JSON.stringify(res.data, null, 2));
                        await sock.sendMessage(sender, { text: 'Gagal mendapatkan link video TikTok. Coba beberapa saat lagi atau pastikan link benar.' });
                    }
                } catch (e) {
                    logger.error('TikTok Downloader Error:', {
                        message: e.message,
                        code: e.code,
                        stack: e.stack,
                        data: e.response?.data
                    });
                    await sock.sendMessage(sender, { text: 'Gagal download video TikTok. Pastikan link benar, tidak private, atau API sedang down.' });
                    global.tiktokErrorCount = (global.tiktokErrorCount || 0) + 1;
                    if (global.tiktokErrorCount >= 3) {
                        await sock.sendMessage(OWNER_JID, { text: `â— [BOT] Error API TikTok sudah terjadi ${global.tiktokErrorCount}x berturut-turut!` });
                        global.tiktokErrorCount = 0;
                    }
                }
                return true;
            }
            case 'convert': {
                if (args.length < 4 || args[3].toLowerCase() !== 'to') {
                    return await sock.sendMessage(sender, { text: 'Format: /convert <jumlah> <dari> to <ke>\nContoh: /convert 100 usd to idr' });
                }
                const amount = parseFloat(args[1]);
                const from = args[2].toUpperCase();
                const to = args[4] ? args[4].toUpperCase() : '';
                if (isNaN(amount) || !from || !to) {
                    return await sock.sendMessage(sender, { text: 'Jumlah atau kode mata uang tidak valid.' });
                }
                try {
                    const res = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
                    if (res.data && res.data.result === 'success' && res.data.rates && res.data.rates[to]) {
                        const rate = res.data.rates[to];
                        const result = amount * rate;
                        await sock.sendMessage(sender, { text: `ðŸ’± *Currency Converter*\n${amount} ${from} = ${result} ${to}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Gagal mendapatkan data kurs.' });
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: 'Gagal menghubungi API kurs. Coba lagi nanti.' });
                }
                return true;
            }
            case 'cuaca': {
                const kota = args[1] ? args.slice(1).join(' ') : 'jakarta';
                logger.info(`[DEBUG] /cuaca kota input: ${kota}`);
                try {
                    const apiKey = OPENWEATHER_API_KEY;
                    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(kota)}&appid=${apiKey}&units=metric&lang=id`;
                    const res = await axios.get(url);
                    logger.info(`[DEBUG] /cuaca API response: ${JSON.stringify(res.data)}`);
                    if (res.data && res.data.weather && res.data.weather[0] && res.data.main) {
                        const cuaca = res.data.weather[0].description;
                        const suhu = res.data.main.temp;
                        const actualCityName = res.data.name; // Gunakan nama kota dari API response
                        logger.info(`[DEBUG] /cuaca - Input: ${kota}, API Response City: ${actualCityName}`);
                        
                        // Prompt ke DeepSeek (cache per kota actual/cuaca/suhu)
                        const cacheKey = `cuaca_${actualCityName}_${cuaca}_${suhu}`;
                        await sendAIMessage(
                            sock, 
                            sender, 
                            `Cuaca di kota ${actualCityName}: ${cuaca}, suhu ${suhu}Â°C. Buatkan narasi singkat dan empatik untuk user WhatsApp.`, 
                            `ðŸŒ¤ï¸ *Cuaca di ${actualCityName}*\n${cuaca}\nSuhu: ${suhu}Â°C`, 
                            cacheKey
                        );
                    } else {
                        await sendAIMessage(sock, sender, 'Gagal mendapatkan data cuaca dari API. Tolong kasih tahu user dengan gaya santai dan empatik.', 'Gagal mendapatkan data cuaca.');
                    }
                } catch (e) {
                    logger.error('Cuaca Error:', e);
                    await sendAIMessage(sock, sender, `API cuaca error atau kota "${kota}" tidak ditemukan. Tolong kasih tahu user dengan gaya santai dan empatik bahwa kotanya mungkin tidak ditemukan.`, `Gagal mendapatkan data cuaca untuk ${kota}. Kota mungkin tidak ditemukan atau coba gunakan nama kota yang lebih umum.`);
                    // Notifikasi ke admin jika error berulang
                    global.cuacaErrorCount = (global.cuacaErrorCount || 0) + 1;
                    if (global.cuacaErrorCount >= 3) {
                        await sock.sendMessage(OWNER_JID, { text: `â— [BOT] Error API cuaca sudah terjadi ${global.cuacaErrorCount}x berturut-turut!` });
                        global.cuacaErrorCount = 0;
                    }
                }
                return true;
            }
            case 'testapiais': {
                try {
                    const result = await testApiAIs();
                    let text = 'Status API:\n';
                    text += `DeepSeek: ${result.deepseekOk ? 'âœ…' : 'âŒ'}\n`;
                    text += `Gemini: ${result.geminiOk ? 'âœ…' : 'âŒ'}`;
                    await sock.sendMessage(sender, { text });
                } catch (e) {
                    logger.error('TestApiAIs Error:', e);
                    await sock.sendMessage(sender, { text: 'Gagal cek status API AI.' });
                }
                return true;
            }
            case 'listadmin': {
                try {
                    const admins = utils.getAdmins();
                    if (!admins || admins.length === 0) {
                        await sock.sendMessage(sender, { text: 'Belum ada admin yang terdaftar.' });
                        return true;
                    }
                    let text = `*Daftar Admin Bot:*\n`;
                    admins.forEach((admin, i) => {
                        text += `${i+1}. ${admin}\n`;
                    });
                    await sock.sendMessage(sender, { text });
                } catch (e) {
                    await sock.sendMessage(sender, { text: 'Gagal mengambil daftar admin.' });
                }
                return true;
            }

            case 'backup': {
                if (!isFromAdmin) {
                    await sock.sendMessage(sender, { text: utils.errorMsg('Hanya admin yang bisa melakukan backup.') });
                    return true;
                }
                try {
                    await sock.sendMessage(sender, { text: 'â³ Memulai proses backup data bot...' });
                    const result = await backupBotData();
                    if (result.success) {
                        const backupInfo = `âœ… *Backup Berhasil!*\n\n` +
                            `ðŸ“ File: ${path.basename(result.path)}\n` +
                            `â° Waktu: ${new Date(result.timestamp).toLocaleString('id-ID')}\n\n` +
                            `File backup tersimpan di:\n\`${result.path}\``;
                        await sock.sendMessage(sender, { text: backupInfo });
                        // Notifikasi ke owner
                        if (sender !== OWNER_JID) {
                            await sock.sendMessage(OWNER_JID, { 
                                text: `ðŸ”” *Notifikasi Backup*\n\nAdmin ${senderNum} telah melakukan backup data bot.\n\n${backupInfo}` 
                            });
                        }
                    } else {
                        throw new Error(result.error);
                    }
                } catch (e) {
                    logger.error('Backup command error:', e);
                    await sock.sendMessage(sender, { text: `âŒ Gagal melakukan backup: ${e.message}` });
                }
                return true;
            }

            case 'restore': {
                if (!isFromAdmin) {
                    await sock.sendMessage(sender, { text: utils.errorMsg('Hanya admin yang bisa melakukan restore.') });
                    return true;
                }
                if (args.length < 2) {
                    await sock.sendMessage(sender, { text: 'Format: /restore <path_file_backup>' });
                    return true;
                }
                const backupPath = args[1];
                if (!fs.existsSync(backupPath)) {
                    await sock.sendMessage(sender, { text: 'âŒ File backup tidak ditemukan.' });
                    return true;
                }
                try {
                    await sock.sendMessage(sender, { text: 'â³ Memulai proses restore data bot...' });
                    const result = await restoreBotData(backupPath);
                    if (result.success) {
                        const restoreInfo = `âœ… *Restore Berhasil!*\n\n` +
                            `â° Waktu Backup: ${new Date(result.timestamp).toLocaleString('id-ID')}\n` +
                            `ðŸ“¦ Versi: ${result.version}\n\n` +
                            `Bot perlu di-restart untuk menerapkan perubahan.`;
                        await sock.sendMessage(sender, { text: restoreInfo });
                        // Notifikasi ke owner
                        if (sender !== OWNER_JID) {
                            await sock.sendMessage(OWNER_JID, { 
                                text: `ðŸ”” *Notifikasi Restore*\n\nAdmin ${senderNum} telah melakukan restore data bot.\n\n${restoreInfo}` 
                            });
                        }
                    } else {
                        throw new Error(result.error);
                    }
                } catch (e) {
                    logger.error('Restore command error:', e);
                    await sock.sendMessage(sender, { text: `âŒ Gagal melakukan restore: ${e.message}` });
                }
                return true;
            }

            case 'web': {
                if (args.length < 1) {
                    await sock.sendMessage(sender, { text: 'Format: /web <kata kunci pencarian>' });
                    return true;
                }
                const query = args.join(' ');
                try {
                    await sock.sendMessage(sender, { text: `ðŸ”Ž Mencari di web: *${query}* ...` });
                    const res = await axios.post(
                        'https://api.exa.ai/search',
                        {
                            query,
                            numResults: 3,
                            useAutoprompt: true
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${EXA_API_KEY}`
                            },
                            timeout: 20000
                        }
                    );
                    if (res.data && res.data.results && res.data.results.length > 0) {
                        let text = `*Hasil pencarian web untuk:* _${query}_\n\n`;
                        res.data.results.forEach((item, i) => {
                            text += `*${i+1}. [${item.title}](${item.url})*\n`;
                            if (item.snippet) text += `_${item.snippet}_\n`;
                            text += `\n`;
                        });
                        await sock.sendMessage(sender, { text, linkPreview: false });
                    } else {
                        await sock.sendMessage(sender, { text: 'Tidak ada hasil ditemukan.' });
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: `âŒ Gagal mencari di web: ${e.message}` });
                }
                return true;
            }

            case 'ringkas': {
                if (args.length < 1) {
                    await sock.sendMessage(sender, { text: 'Format: /ringkas <url artikel>' });
                    return true;
                }
                const url = args[0];
                try {
                    await sock.sendMessage(sender, { text: `â³ Mengambil dan meringkas artikel...` });
                    const res = await axios.post(
                        'https://api.exa.ai/contents',
                        { url },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${EXA_API_KEY}`
                            },
                            timeout: 20000
                        }
                    );
                    if (res.data && res.data.contents && res.data.contents.length > 0) {
                        const content = res.data.contents[0].text;
                        // Ringkas dengan AI jika perlu (atau langsung kirim jika pendek)
                        let summary = content;
                        if (content.length > 800) {
                            // Ringkas dengan Gemini/AI jika tersedia
                            const geminiRes = await axios.post(
                                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-pro:generateContent?key=${GEMINI_API_KEY}`,
                                { contents: [{ parts: [{ text: `Ringkas artikel berikut dalam 5-7 kalimat, bahasa Indonesia:\n\n${content}` }] }] },
                                { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
                            );
                            summary = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || content.slice(0, 800) + '...';
                        }
                        await sock.sendMessage(sender, { text: `*Ringkasan Artikel:*
${summary}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Gagal mengambil isi artikel.' });
                    }
                } catch (e) {
                    await sock.sendMessage(sender, { text: `âŒ Gagal meringkas artikel: ${e.message}` });
                }
                return true;
            }

            case 'jawab': {
                if (args.length < 1) {
                    await sock.sendMessage(sender, { text: 'Format: /jawab <pertanyaan atau url>' });
                    return true;
                }
                const input = args.join(' ');
                const urlRegex = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[^\s]*)?$/i;
                if (urlRegex.test(input.trim())) {
                    // Jika input adalah URL, ambil & ringkas artikel
                    const url = input.trim();
                    try {
                        await sock.sendMessage(sender, { text: `â³ Mengambil dan meringkas artikel...` });
                        const res = await axios.post(
                            'https://api.exa.ai/contents',
                            { url },
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${EXA_API_KEY}`
                                },
                                timeout: 20000
                            }
                        );
                        if (res.data && res.data.contents && res.data.contents.length > 0) {
                            const content = res.data.contents[0].text;
                            let summary = content;
                            if (content.length > 800) {
                                // Ringkas dengan Gemini/AI jika tersedia
                                const geminiRes = await axios.post(
                                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-pro:generateContent?key=${GEMINI_API_KEY}`,
                                    { contents: [{ parts: [{ text: `Ringkas artikel berikut dalam 5-7 kalimat, bahasa Indonesia:\n\n${content}` }] }] },
                                    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
                                );
                                summary = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || content.slice(0, 800) + '...';
                            }
                            await sock.sendMessage(sender, { text: `*Ringkasan Artikel:*
${summary}` });
                        } else {
                            await sock.sendMessage(sender, { text: 'Gagal mengambil isi artikel.' });
                        }
                    } catch (e) {
                        await sock.sendMessage(sender, { text: `âŒ Gagal meringkas artikel: ${e.message}` });
                    }
                } else {
                    // Jika input adalah pertanyaan, gunakan Exa /answer API
                    try {
                        await sock.sendMessage(sender, { text: `â³ Mencari jawaban dari web...` });
                        const res = await axios.post(
                            'https://api.exa.ai/answer',
                            { query: input },
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${EXA_API_KEY}`
                                },
                                timeout: 20000
                            }
                        );
                        const answer = res.data?.answer;
                        if (answer) {
                            let text = `*Jawaban:*
${answer}`;
                            if (res.data.citations && res.data.citations.length > 0) {
                                text += '\n\nSumber:\n';
                                res.data.citations.forEach((c, i) => {
                                    text += `${i+1}. ${c.url}\n`;
                                });
                            }
                            await sock.sendMessage(sender, { text });
                        } else {
                            await sock.sendMessage(sender, { text: 'Tidak ada jawaban ditemukan.' });
                        }
                    } catch (e) {
                        await sock.sendMessage(sender, { text: `âŒ Gagal mencari jawaban: ${e.message}` });
                    }
                }
                return true;
            }

            case 'ai-optimize':
                if (!isFromAdmin) return await sock.sendMessage(sender, { text: utils.errorMsg('Hanya admin yang bisa mengubah optimasi AI.') });
                if (args.length < 2) {
                    // Show current settings
                    let text = `ðŸ”§ *AI Optimizations Settings:*\n\n`;
                    text += `â€¢ Deteksi Emosi: ${AI_OPTIMIZATIONS.ENABLE_EMOTION_DETECTION ? 'âœ… ON' : 'âŒ OFF'} (${AI_OPTIMIZATIONS.ENABLE_EMOTION_DETECTION ? 'BOROS' : 'HEMAT'} token)\n`;
                    text += `â€¢ Auto Summary: ${AI_OPTIMIZATIONS.ENABLE_AUTO_SUMMARY ? 'âœ… ON' : 'âŒ OFF'} (${AI_OPTIMIZATIONS.ENABLE_AUTO_SUMMARY ? 'BOROS' : 'HEMAT'} token)\n`;
                    text += `â€¢ AI Admin Response: ${AI_OPTIMIZATIONS.ENABLE_AI_ADMIN_RESPONSES ? 'âœ… ON' : 'âŒ OFF'} (${AI_OPTIMIZATIONS.ENABLE_AI_ADMIN_RESPONSES ? 'BOROS' : 'HEMAT'} token)\n`;
                    text += `â€¢ Max History: ${AI_OPTIMIZATIONS.MAX_HISTORY_LENGTH} pesan\n`;
                    text += `â€¢ Max Retry: ${AI_OPTIMIZATIONS.MAX_RETRY}x\n`;
                    text += `â€¢ Cache Duration: ${AI_OPTIMIZATIONS.CACHE_DURATION_HOURS} jam\n\n`;
                    text += `*Command:*\n`;
                    text += `â€¢ /ai-optimize emotion on|off\n`;
                    text += `â€¢ /ai-optimize summary on|off\n`;
                    text += `â€¢ /ai-optimize admin on|off\n`;
                    text += `â€¢ /ai-optimize history <1-10>\n`;
                    text += `â€¢ /ai-optimize retry <1-5>\n`;
                    text += `â€¢ /ai-optimize cache <1-72>\n`;
                    await sock.sendMessage(sender, { text });
                    return true;
                }
                const setting = args[1].toLowerCase();
                const value = args[2] ? args[2].toLowerCase() : '';
                
                switch (setting) {
                    case 'emotion':
                        if (value === 'on') {
                            AI_OPTIMIZATIONS.ENABLE_EMOTION_DETECTION = true;
                            await sock.sendMessage(sender, { text: 'âš ï¸ Deteksi emosi diaktifkan. **Token akan lebih boros** karena setiap /ai akan memanggil 2x API.' });
                        } else if (value === 'off') {
                            AI_OPTIMIZATIONS.ENABLE_EMOTION_DETECTION = false;
                            await sock.sendMessage(sender, { text: 'âœ… Deteksi emosi dinonaktifkan. Token lebih hemat!' });
                        } else {
                            await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-optimize emotion on|off') });
                        }
                        break;
                    case 'summary':
                        if (value === 'on') {
                            AI_OPTIMIZATIONS.ENABLE_AUTO_SUMMARY = true;
                            await sock.sendMessage(sender, { text: 'âš ï¸ Auto summary diaktifkan. **Token akan lebih boros** karena summary setiap 8 pesan.' });
                        } else if (value === 'off') {
                            AI_OPTIMIZATIONS.ENABLE_AUTO_SUMMARY = false;
                            await sock.sendMessage(sender, { text: 'âœ… Auto summary dinonaktifkan. Token lebih hemat!' });
                        } else {
                            await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-optimize summary on|off') });
                        }
                        break;
                    case 'admin':
                        if (value === 'on') {
                            AI_OPTIMIZATIONS.ENABLE_AI_ADMIN_RESPONSES = true;
                            await sock.sendMessage(sender, { text: 'âš ï¸ AI admin response diaktifkan. **Token akan lebih boros** untuk notifikasi admin.' });
                        } else if (value === 'off') {
                            AI_OPTIMIZATIONS.ENABLE_AI_ADMIN_RESPONSES = false;
                            await sock.sendMessage(sender, { text: 'âœ… AI admin response dinonaktifkan. Token lebih hemat! Akan pakai template biasa.' });
                        } else {
                            await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-optimize admin on|off') });
                        }
                        break;
                    case 'history':
                        const historyNum = parseInt(value);
                        if (historyNum >= 1 && historyNum <= 10) {
                            AI_OPTIMIZATIONS.MAX_HISTORY_LENGTH = historyNum;
                            await sock.sendMessage(sender, { text: `âœ… Max history diubah ke ${historyNum} pesan. ${historyNum <= 3 ? 'Token lebih hemat!' : historyNum >= 7 ? 'Token lebih boros!' : 'Token sedang.'}` });
                        } else {
                            await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-optimize history <1-10>') });
                        }
                        break;
                    case 'retry':
                        const retryNum = parseInt(value);
                        if (retryNum >= 1 && retryNum <= 5) {
                            AI_OPTIMIZATIONS.MAX_RETRY = retryNum;
                            await sock.sendMessage(sender, { text: `âœ… Max retry diubah ke ${retryNum}x. ${retryNum === 1 ? 'Token lebih hemat!' : retryNum >= 3 ? 'Token lebih boros!' : 'Token sedang.'}` });
                        } else {
                            await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-optimize retry <1-5>') });
                        }
                        break;
                    case 'cache':
                        const cacheHours = parseInt(value);
                        if (cacheHours >= 1 && cacheHours <= 72) {
                            AI_OPTIMIZATIONS.CACHE_DURATION_HOURS = cacheHours;
                            await sock.sendMessage(sender, { text: `âœ… Cache duration diubah ke ${cacheHours} jam. ${cacheHours >= 24 ? 'Token lebih hemat!' : 'Token sedang.'}` });
                        } else {
                            await sock.sendMessage(sender, { text: utils.errorMsg('Format: /ai-optimize cache <1-72>') });
                        }
                        break;
                    default:
                        await sock.sendMessage(sender, { text: utils.errorMsg('Setting tidak dikenal. Gunakan: emotion, summary, admin, history, retry, cache') });
                }
                return true;

            case 'qr': {
                if (args.length < 1) return await sock.sendMessage(sender, { text: 'ðŸ”² *QR Code Generator & Scanner* ðŸ“±\n\n*Available Commands:*\n\nðŸ“ `/qr generate <text>` - Create custom QR code\nðŸ“· `/qr scan` - Scan QR code from image\n\nðŸ’¡ *Examples:*\nâ€¢ `/qr generate https://google.com`\nâ€¢ `/qr generate My Contact Info`\nâ€¢ Send image + `/qr scan`' });
                const subcmd = args[0].toLowerCase();
                
                if (subcmd === 'generate') {
                    if (args.length < 2) return await sock.sendMessage(sender, { text: 'ðŸ“ *QR Generation Error* âŒ\n\nPlease provide text to encode!\n\nðŸ“‹ *Format:* `/qr generate <text>`\n\nðŸ’¡ *Examples:*\nâ€¢ `/qr generate Hello World!`\nâ€¢ `/qr generate https://github.com`\nâ€¢ `/qr generate +6281234567890`' });
                    const text = args.slice(1).join(' ');
                    if (text.length > 500) return await sock.sendMessage(sender, { text: 'ðŸ“ *Text Too Long* âš ï¸\n\nThe text is too long for QR encoding!\n\nðŸ”¢ *Limits:*\nâ€¢ Maximum: 500 characters\nâ€¢ Current: ' + text.length + ' characters\n\nðŸ’¡ *Tip:* Try shortening your text or use a URL shortener first!' });
                    
                    try {
                        // Generate QR code as buffer
                        const qrBuffer = await QRCode.toBuffer(text, {
                            errorCorrectionLevel: 'M',
                            type: 'png',
                            quality: 0.92,
                            margin: 1,
                            color: {
                                dark: '#000000',
                                light: '#FFFFFF'
                            },
                            width: 512
                        });
                        
                        await sock.sendMessage(sender, { 
                            image: qrBuffer, 
                            caption: `âœ… *QR Code Generated Successfully!* ðŸŽ‰\n\nðŸ“ Content: *${text.substring(0, 100)}${text.length > 100 ? '...' : ''}*\nðŸ“ Size: *512x512 pixels*\nðŸ”² Format: *PNG*\n\nðŸ“± *How to use:*\nâ€¢ Open camera app on your phone\nâ€¢ Point at the QR code\nâ€¢ Tap the notification to open content\n\nðŸ’¡ Works with any QR scanner app!` 
                        });
                        logger.info(`QR code generated for user ${senderNum}`);
                    } catch (e) {
                        logger.error('QR Code generation error:', e);
                        await sock.sendMessage(sender, { text: 'âŒ *QR Generation Failed* ðŸ”§\n\nSorry, failed to create QR code! This might be due to:\n\nðŸ” Special characters in text\nðŸ’¾ Server memory issues\nðŸŒ Temporary service disruption\n\nPlease try again with simpler text!' });
                    }
                } else if (subcmd === 'scan') {
                    // Check if user replied to an image
                    if (!msg.message.imageMessage && (!msg.quoted || !msg.quoted.imageMessage)) {
                        return await sock.sendMessage(sender, { text: 'ðŸ“· *QR Scanner Ready* ðŸ”\n\nTo scan a QR code:\n\n1ï¸âƒ£ Reply to an image containing QR code\n2ï¸âƒ£ Type `/qr scan`\n\nðŸ’¡ *Tips:*\nâ€¢ Make sure QR code is clearly visible\nâ€¢ Image should be high quality\nâ€¢ QR code should not be damaged\n\nðŸ“¸ Send me an image first, then reply with `/qr scan`!' });
                    }
                    
                    try {
                        // Download image buffer
                        let buffer;
                        if (msg.message.imageMessage) {
                            buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                        } else if (msg.quoted && msg.quoted.imageMessage) {
                            buffer = await downloadMediaMessage(msg.quoted, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                        }
                        
                        if (!buffer) {
                            return await sock.sendMessage(sender, { text: 'âŒ *Image Download Failed* ðŸ“±\n\nCouldn\'t download the image! Possible issues:\n\nðŸ“¸ Image format not supported\nðŸ’¾ File too large\nðŸŒ Network connectivity\n\nPlease try with a different image (JPG/PNG format, < 5MB)' });
                        }
                        
                        // Process image (placeholder — QR scanning needs jsqr/zxing native lib)
                        // Buffer validated; tell user feature WIP
                        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                            return await sock.sendMessage(sender, { text: '❌ Buffer gambar kosong/invalid.' });
                        }
                        
                        // For now, send message that QR scanning is in development
                        await sock.sendMessage(sender, { 
                            text: 'ðŸ” *QR Scanner Active* ðŸš§\n\nâš ï¸ *Feature Under Development*\n\nQR code scanning is currently being perfected! For now, please use:\n\nðŸ“± **Alternative Options:**\nâ€¢ Phone camera app (built-in QR scanner)\nâ€¢ Google Lens app\nâ€¢ Any QR scanner from app store\n\nðŸ”§ This feature will be fully functional soon!\nðŸ’¡ Thanks for your patience!' 
                        });
                        
                    } catch (e) {
                        logger.error('QR Code scanning error:', e);
                        await sock.sendMessage(sender, { text: 'âŒ *QR Scan Failed* ðŸ”§\n\nCouldn\'t read the QR code! This might be because:\n\nðŸ” QR code is not clear enough\nðŸ“· Image quality is too low\nðŸŽ¯ QR code is damaged or corrupted\nðŸ’¾ Processing error occurred\n\nTry with a clearer, high-quality image!' });
                    }
                } else {
                    await sock.sendMessage(sender, { text: 'ðŸ”² *QR Code Commands* ðŸ“‹\n\n*Available Options:*\n\nðŸŽ¯ `/qr generate <text>` - Create QR code\nðŸ” `/qr scan` - Scan QR from image\n\nâ“ *Need examples?* Just ask!' });
                }
                return true;
            }

            case 'short': {
                if (args.length < 1) return await sock.sendMessage(sender, { text: 'Format: /short <url>\nContoh: /short https://google.com' });
                const url = args[0];
                
                // Basic URL validation
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    return await sock.sendMessage(sender, { text: 'âŒ URL harus dimulai dengan http:// atau https://' });
                }
                
                try {
                    const shortUrl = await utils.shortenUrl(url);
                    const message = `ðŸ”— *URL Shortener*\n\n` +
                        `ðŸ“ Original: ${url}\n` +
                        `ðŸ”— Short: ${shortUrl}\n\n` +
                        `ðŸ’¡ URL pendek berhasil dibuat!`;
                    await sock.sendMessage(sender, { text: message });
                    logger.info(`URL shortened by user ${senderNum}: ${url} -> ${shortUrl}`);
                } catch (e) {
                    logger.error('URL shortening error:', e);
                    await sock.sendMessage(sender, { text: 'âŒ Gagal memendekkan URL. Pastikan URL valid.' });
                }
                return true;
            }

            case 'expense': {
                if (args.length < 1) {
                    const helpText = `ðŸ’° *Personal Finance Tracker* ðŸ“Š\n\n` +
                        `*ðŸ’¡ Smart Money Management Made Easy!*\n\n` +
                        `ðŸ“‹ *Available Commands:*\n\n` +
                        `ðŸ’³ \`/expense add <kategori> <jumlah> <deskripsi>\`\n` +
                        `   Track your daily expenses\n\n` +
                        `ðŸ“Š \`/expense list\` - View recent transactions\n` +
                        `ðŸ“ˆ \`/expense report [week/month/year]\` - Financial insights\n` +
                        `ðŸ“‚ \`/expense category\` - Spending breakdown\n\n` +
                        `âœ¨ *Examples:*\n` +
                        `â€¢ \`/expense add makanan 50000 nasi padang enak\`\n` +
                        `â€¢ \`/expense add transport 15000 grab ke kantor\`\n` +
                        `â€¢ \`/expense add belanja 125000 groceries bulanan\`\n\n` +
                        `ðŸŽ¯ *Benefits:*\n` +
                        `â€¢ Track spending patterns\n` +
                        `â€¢ Budget planning insights\n` +
                        `â€¢ Monthly financial reports\n` +
                        `â€¢ Category-wise analysis`;
                    return await sock.sendMessage(sender, { text: helpText });
                }
                
                const subcmd = args[0].toLowerCase();
                
                if (subcmd === 'add') {
                    if (args.length < 4) return await sock.sendMessage(sender, { text: '📝 *Expense Entry Error* ❌\n\nFormat:\n`/expense add <kategori|auto> <jumlah> <deskripsi>`\n\n*Contoh:*\n• `/expense add makanan 50000 nasi padang`\n• `/expense add auto 25000 grab ke kantor` (auto-detect kategori)\n\n💡 Pakai `auto` biar bot deteksi kategori dari deskripsi otomatis.' });

                    const rawCategory = args[1].toLowerCase();
                    const amount = parseFloat(args[2]);
                    const description = args.slice(3).join(' ');

                    if (isNaN(amount) || amount <= 0) {
                        return await sock.sendMessage(sender, { text: '💰 *Invalid Amount* ❌\n\nNominal harus angka positif. Contoh valid: `50000`, `125000`. Tanpa "Rp", "k", atau simbol.' });
                    }

                    let category = rawCategory;
                    if (rawCategory === 'auto') {
                        const fxe = require('./finance_export');
                        category = fxe.autoCategorizeFromDescription(description);
                    }

                    try {
                        const expense = utils.addExpense(senderNum, category, amount, description);
                        const message = `✅ *Expense Recorded!* 💰\n\n` +
                            `📂 Kategori : *${expense.category}*${rawCategory === 'auto' ? ' _(auto-detected)_' : ''}\n` +
                            `💵 Nominal  : *Rp ${amount.toLocaleString('id-ID')}*\n` +
                            `📝 Deskripsi: *${description}*\n` +
                            `📅 Tanggal  : *${expense.date}*\n\n` +
                            `💡 Cek laporan: \`/expense report month\` | PDF: \`/expense pdf month\` | Chart: \`/expense chart month\``;
                        await sock.sendMessage(sender, { text: message });
                        logger.info(`Expense added by ${senderNum}: ${category} - ${amount}`);
                    } catch (e) {
                        logger.error('Expense tracking error:', e);
                        await sock.sendMessage(sender, { text: '❌ Gagal simpan expense. Coba lagi sebentar.' });
                    }
                } else if (subcmd === 'list') {
                    try {
                        const expenses = utils.getExpenses(senderNum).slice(-10);
                        if (expenses.length === 0) {
                            return await sock.sendMessage(sender, { text: 'ðŸ“ *No Expenses Found* ðŸ’¸\n\nYou haven\'t recorded any expenses yet!\n\nðŸš€ *Get Started:*\nâ€¢ Use `/expense add` to track your first expense\nâ€¢ Example: `/expense add kopi 15000 starbucks latte`\n\nðŸ’¡ *Why track expenses?*\nâ€¢ Better financial awareness\nâ€¢ Budget planning\nâ€¢ Spending pattern insights\nâ€¢ Monthly financial reports' });
                        }
                        
                        let message = `ðŸ“‹ *Recent Expense History* (Last 10)\n`;
                        message += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
                        
                        let totalShown = 0;
                        expenses.reverse().forEach((expense, index) => {
                            totalShown += expense.amount;
                            message += `${index + 1}. ðŸ’° *${expense.category.toUpperCase()}* - Rp ${expense.amount.toLocaleString('id-ID')}\n`;
                            message += `   ðŸ“ ${expense.description}\n`;
                            message += `   ðŸ“… ${expense.date}\n\n`;
                        });
                        
                        message += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
                        message += `ðŸ“Š *Summary (Last 10 entries):*\n`;
                        message += `ðŸ’µ Total: *Rp ${totalShown.toLocaleString('id-ID')}*\n`;
                        message += `ðŸ“ˆ Average: *Rp ${Math.round(totalShown/expenses.length).toLocaleString('id-ID')}*\n\n`;
                        message += `ðŸ” For detailed analysis: \`/expense report month\``;
                        
                        await sock.sendMessage(sender, { text: message });
                    } catch (e) {
                        logger.error('Expense list error:', e);
                        await sock.sendMessage(sender, { text: 'âŒ *Data Retrieval Error* ðŸ“Š\n\nCouldn\'t fetch your expense history!\n\nðŸ”§ *Possible causes:*\nâ€¢ Database temporarily unavailable\nâ€¢ Data corruption\nâ€¢ Network connectivity issues\n\nðŸ”„ Please try again in a few moments!' });
                    }
                } else if (subcmd === 'report') {
                    try {
                        const period = args[1] || 'month';
                        const report = utils.getExpenseReport(senderNum, period);
                        
                        if (report.count === 0) {
                            return await sock.sendMessage(sender, { text: `ðŸ“Š *No Data for ${period.toUpperCase()} Period* ðŸ“…\n\nNo expenses recorded in this period!\n\nðŸ’¡ *Suggestions:*\nâ€¢ Try different period: \`week\`, \`month\`, \`year\`\nâ€¢ Add some expenses first with \`/expense add\`\nâ€¢ Check if you have expenses in other periods\n\nðŸŽ¯ Start tracking today for better financial insights!` });
                        }
                        
                        let message = `ðŸ“Š *Financial Report (${period.toUpperCase()})* ðŸ’°\n`;
                        message += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;
                        
                        message += `ðŸ’µ *Total Expenses:* Rp ${report.total.toLocaleString('id-ID')}\n`;
                        message += `ðŸ“ *Total Transactions:* ${report.count}\n`;
                        message += `ðŸ“ˆ *Average per Transaction:* Rp ${Math.round(report.total/report.count).toLocaleString('id-ID')}\n\n`;
                        
                        message += `ðŸ“‚ *Spending Breakdown by Category:*\n\n`;
                        
                        Object.entries(report.byCategory)
                            .sort(([,a], [,b]) => b - a) // Sort by amount descending
                            .forEach(([category, amount], index) => {
                                const percentage = ((amount / report.total) * 100).toFixed(1);
                                const emoji = index === 0 ? 'ðŸ¥‡' : index === 1 ? 'ðŸ¥ˆ' : index === 2 ? 'ðŸ¥‰' : 'ðŸ’°';
                                message += `${emoji} *${category.toUpperCase()}*\n`;
                                message += `   ðŸ’µ Rp ${amount.toLocaleString('id-ID')} (${percentage}%)\n\n`;
                            });
                        
                        // Financial insights
                        const topCategory = Object.entries(report.byCategory).sort(([,a], [,b]) => b - a)[0];
                        message += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n`;
                        message += `ðŸŽ¯ *Smart Insights:*\n`;
                        message += `â€¢ Highest spending: *${topCategory[0]}* (${((topCategory[1]/report.total)*100).toFixed(1)}%)\n`;
                        message += `â€¢ Daily average: *Rp ${Math.round(report.total/30).toLocaleString('id-ID')}*\n`;
                        message += `â€¢ Financial health: ${report.total > 1000000 ? 'âš ï¸ *High spending*' : report.total > 500000 ? 'ðŸ’› *Moderate*' : 'ðŸ’š *Good control*'}\n\n`;
                        message += `ðŸ’¡ Keep tracking for better financial awareness!`;
                        
                        await sock.sendMessage(sender, { text: message });
                    } catch (e) {
                        logger.error('Expense report error:', e);
                        await sock.sendMessage(sender, { text: 'âŒ *Report Generation Failed* ðŸ“Š\n\nCouldn\'t generate your financial report!\n\nðŸ”§ *Possible issues:*\nâ€¢ Data processing error\nâ€¢ Invalid period parameter\nâ€¢ Database connectivity\n\nðŸ”„ Try: `/expense report month` or `/expense report week`' });
                    }
                } else if (subcmd === 'pdf') {
                    try {
                        const period = (args[1] || 'month').toLowerCase();
                        const expenses = utils.getExpenses(senderNum);
                        if (!expenses.length) {
                            return await sock.sendMessage(sender, { text: '📭 Belum ada data expense. Tambahin dulu pakai `/expense add ...`' });
                        }
                        const filtered = utils.filterExpensesByPeriod(expenses, period);
                        if (!filtered.length) {
                            return await sock.sendMessage(sender, { text: `📭 Belum ada data expense untuk periode *${period}*.` });
                        }
                        const fxe = require('./finance_export');
                        const pdfBuf = await fxe.exportExpensesPDF(filtered, { title: `Laporan Pengeluaran (${period})`, period, owner: senderNum });
                        const fileName = `expense_${senderNum}_${period}_${Date.now()}.pdf`;
                        await sock.sendMessage(sender, { document: pdfBuf, mimetype: 'application/pdf', fileName, caption: `📄 Laporan PDF expense periode *${period}*\nTotal: ${filtered.length} transaksi` });
                        botState.incrementSent();
                    } catch (e) {
                        logger.error('Expense PDF error:', e);
                        await sock.sendMessage(sender, { text: `❌ Gagal generate PDF: ${e.message}` });
                    }
                } else if (subcmd === 'csv') {
                    try {
                        const period = (args[1] || 'all').toLowerCase();
                        const expenses = utils.getExpenses(senderNum);
                        if (!expenses.length) {
                            return await sock.sendMessage(sender, { text: '📭 Belum ada data expense.' });
                        }
                        const filtered = utils.filterExpensesByPeriod(expenses, period);
                        const fxe = require('./finance_export');
                        const csv = fxe.exportExpensesCSV(filtered);
                        const fileName = `expense_${senderNum}_${period}_${Date.now()}.csv`;
                        await sock.sendMessage(sender, { document: Buffer.from(csv, 'utf8'), mimetype: 'text/csv', fileName, caption: `📊 CSV expense periode *${period}* (${filtered.length} rows)` });
                        botState.incrementSent();
                    } catch (e) {
                        logger.error('Expense CSV error:', e);
                        await sock.sendMessage(sender, { text: `❌ Gagal generate CSV: ${e.message}` });
                    }
                } else if (subcmd === 'chart') {
                    try {
                        const period = (args[1] || 'month').toLowerCase();
                        const expenses = utils.getExpenses(senderNum);
                        if (!expenses.length) {
                            return await sock.sendMessage(sender, { text: '📭 Belum ada data expense.' });
                        }
                        const filtered = utils.filterExpensesByPeriod(expenses, period);
                        if (!filtered.length) {
                            return await sock.sendMessage(sender, { text: `📭 Belum ada data untuk periode *${period}*.` });
                        }
                        const fxe = require('./finance_export');
                        const png = fxe.generateExpenseChart(filtered, { title: `Pengeluaran ${period}` });
                        await sock.sendMessage(sender, { image: png, caption: `📊 Chart expense periode *${period}*\nTotal: ${filtered.length} transaksi` });
                        botState.incrementSent();
                    } catch (e) {
                        logger.error('Expense chart error:', e);
                        await sock.sendMessage(sender, { text: `❌ Gagal generate chart: ${e.message}` });
                    }
                } else {
                    await sock.sendMessage(sender, { text: '❓ *Subcommand tidak dikenal*\n\n*Pilihan:*\n• `add` - tambah expense (kategori `auto` = auto-detect)\n• `list` - 10 transaksi terakhir\n• `report [week/month/year]` - ringkasan teks\n• `pdf [week/month/year]` - export PDF\n• `csv [all/week/month/year]` - export CSV\n• `chart [week/month/year]` - chart PNG\n\nContoh: `/expense pdf month`' });
                }
                return true;
            }

            case 'invoice': {
                if (args.length < 1) {
                    const helpText = `ðŸ“„ *Invoice Generator*\n\n` +
                        `*Commands:*\n` +
                        `â€¢ /invoice create <customer> <item> <qty> <harga> [catatan]\n` +
                        `â€¢ /invoice create <customer> <item> <harga> [catatan] (qty default = 1)\n` +
                        `â€¢ /invoice list - Lihat daftar invoice\n` +
                        `â€¢ /invoice view <id> - Lihat detail invoice\n\n` +
                        `*Contoh:*\n` +
                        `/invoice create "PT ABC" "Jasa Konsultasi" 1 500000 "Konsultasi IT"\n` +
                        `/invoice create ABC Konsultasi 500000 "IT Support"`;
                    return await sock.sendMessage(sender, { text: helpText });
                }
                
                const subcmd = args[0].toLowerCase();
                
                if (subcmd === 'create') {
                    // Simple robust parser - gabungkan semua args, lalu split berdasarkan pattern
                    const fullText = args.slice(1).join(' '); // Skip 'create'
                    
                    // Remove quotes dan split by space
                    const cleanText = fullText.replace(/"/g, '');
                    const tokens = cleanText.split(/\s+/).filter(t => t.length > 0);
                    
                    if (tokens.length < 3) {
                        return await sock.sendMessage(sender, { text: 'âŒ Minimal butuh: customer, item, dan harga.\n\n*Format:*\n/invoice create [customer] [item] [qty] [harga]\n/invoice create [customer] [item] [harga]\n\n*Contoh:*\n/invoice create PT_ABC Konsultasi_IT 1 500000\n/invoice create PT_ABC Konsultasi_IT 500000' });
                    }
                    
                    // Cari angka-angka dalam tokens
                    const numbers = [];
                    const words = [];
                    
                    tokens.forEach(token => {
                        const num = parseFloat(token);
                        if (!isNaN(num) && isFinite(num) && num > 0) {
                            numbers.push(num);
                        } else {
                            words.push(token);
                        }
                    });
                    
                    if (numbers.length === 0) {
                        return await sock.sendMessage(sender, { text: 'âŒ Tidak ada harga yang valid ditemukan.\n\nContoh: /invoice create PT_ABC Konsultasi 500000' });
                    }
                    
                    let customer, itemName, quantity, price, notes = '';
                    
                    if (numbers.length >= 2) {
                        // Ada 2+ angka: qty dan price
                        quantity = parseInt(numbers[numbers.length - 2]);
                        price = parseFloat(numbers[numbers.length - 1]);
                    } else {
                        // Hanya 1 angka: price (qty = 1)
                        quantity = 1;
                        price = parseFloat(numbers[0]);
                    }
                    
                    // Customer adalah kata pertama, item adalah sisanya
                    if (words.length >= 2) {
                        customer = words[0];
                        itemName = words.slice(1).join(' ');
                    } else if (words.length === 1) {
                        customer = words[0];
                        itemName = 'Service';
                    } else {
                        customer = 'Customer';
                        itemName = 'Service';
                    }
                    
                    if (quantity <= 0) {
                        return await sock.sendMessage(sender, { text: 'âŒ Quantity harus lebih dari 0.' });
                    }
                    
                    if (price <= 0) {
                        return await sock.sendMessage(sender, { text: 'âŒ Harga harus lebih dari 0.' });
                    }
                    
                    try {
                        const items = [{
                            name: itemName,
                            quantity: quantity,
                            price: price
                        }];
                        
                        const result = utils.generateInvoice(senderNum, customer, items, notes);
                        await sock.sendMessage(sender, { text: result.text });
                        logger.info(`Invoice created by user ${senderNum}: ${result.invoice.invoiceNumber} - Customer: ${customer}, Item: ${itemName}, Qty: ${quantity}, Price: ${price}`);
                    } catch (e) {
                        logger.error('Invoice generation error:', e);
                        await sock.sendMessage(sender, { text: 'âŒ Gagal membuat invoice. Silakan coba lagi.' });
                    }
                } else if (subcmd === 'list') {
                    try {
                        const invoices = utils.getInvoices(senderNum);
                        if (invoices.length === 0) {
                            return await sock.sendMessage(sender, { text: 'ðŸ“„ Belum ada invoice yang dibuat.' });
                        }
                        
                        let message = `ðŸ“„ *Daftar Invoice*\n\n`;
                        invoices.slice(-10).reverse().forEach((invoice, index) => {
                            message += `${index + 1}. ${invoice.invoiceNumber}\n`;
                            message += `   Customer: ${invoice.customer}\n`;
                            message += `   Total: Rp ${invoice.total.toLocaleString('id-ID')}\n`;
                            message += `   Status: ${invoice.status}\n`;
                            message += `   Tanggal: ${invoice.date}\n\n`;
                        });
                        
                        await sock.sendMessage(sender, { text: message });
                    } catch (e) {
                        logger.error('Invoice list error:', e);
                        await sock.sendMessage(sender, { text: 'âŒ Gagal mengambil daftar invoice.' });
                    }
                } else {
                    await sock.sendMessage(sender, { text: 'Command tidak dikenal. Gunakan: create, list, view' });
                }
                return true;
            }

            default:
                await sock.sendMessage(sender, { text: utils.errorMsg('Command tidak dikenal.') });
                return true;
        }
    } catch (error) {
        logger.error(`Error handling command ${command}:`, error);
        botState.incrementError();
        await sock.sendMessage(sender, { text: utils.errorMsg('Terjadi kesalahan internal. Silakan coba lagi nanti.') });
        return true;
    }
}

// Fungsi untuk cek status API DeepSeek dan Gemini
async function testApiAIs() {
    let deepseekOk = false;
    let geminiOk = false;

    // Cek DeepSeek
    try {
        const res = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'ping' }]
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        deepseekOk = !!res.data;
    } catch (e) {
        deepseekOk = false;
    }

    // Cek Gemini
    try {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: "ping" }] }]
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
        );
        geminiOk = !!(res.data && res.data.candidates);
    } catch (e) {
        geminiOk = false;
    }

    return { deepseekOk, geminiOk };
}

// Fungsi untuk penjadwalan motivasi harian ke admin
// === PATCH: Fitur motivasi dinonaktifkan, jika ingin aktif, selalu spam setiap jam 7 ===
function scheduleMotivasiHarian(sock, admins, jam = 7) {
    // Untuk menonaktifkan motivasi, cukup return di sini
    return; // PATCH: motivasi dinonaktifkan total
    /*
    // Jika ingin selalu spam (tanpa cek flag), gunakan kode di bawah ini:
    const moment = require('moment-timezone');
    const motivasiList = [
        "Semangat pagi! Jangan lupa bahagia hari ini ðŸ˜Š",
        "Setiap hari adalah kesempatan baru. Tetap semangat!",
        "Jangan menyerah, hari ini pasti lebih baik dari kemarin.",
        "Ingat, kamu hebat dan bisa melewati apapun!",
        "Jangan lupa istirahat dan minum air putih ya!"
    ];
    function kirimMotivasi() {
        const motivasi = motivasiList[Math.floor(Math.random() * motivasiList.length)];
        for (const admin of admins) {
            sock.sendMessage(admin + '@s.whatsapp.net', { text: motivasi });
        }
    }
    function scheduleNext() {
        const now = moment.tz('Asia/Jakarta');
        let next = now.clone().hour(jam).minute(0).second(0);
        if (now.isAfter(next)) next = next.add(1, 'day');
        const delay = next.diff(now);
        setTimeout(() => {
            kirimMotivasi(); // Tidak ada flag, selalu kirim
            scheduleNext();
        }, delay);
    }
    scheduleNext();
    */
}

// Fungsi untuk membaca mode AI user dari file atau global
function readUserAIMode() {
    // Cek global cache dulu
    if (global.userAIMode) return global.userAIMode;
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../config/user_ai_mode.json');
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            global.userAIMode = data;
            return data;
        }
    } catch (e) {
        // Jika error, kembalikan objek kosong
        return {};
    }
    return {};
}

// ===== USER AI MEMORY (better-sqlite3, sync, single shared connection) =====
let _aiMemDb = null;
function _getAiMemDb() {
    if (_aiMemDb) return _aiMemDb;
    const Database = require('better-sqlite3');
    const path = require('path');
    const aiDbPath = path.join(__dirname, '../config/ai_memory.db');
    _aiMemDb = new Database(aiDbPath);
    _aiMemDb.pragma('journal_mode = WAL');
    _aiMemDb.exec(`CREATE TABLE IF NOT EXISTS user_ai_memory (
        user_id TEXT PRIMARY KEY,
        history TEXT,
        user_name TEXT
    )`);
    return _aiMemDb;
}

/**
 * @param {string|null} userId — kalau null/undef, return SEMUA user.
 * @returns {Promise<object>} kalau userId: {history, name}; kalau null: {[uid]: {history, name}}
 */
function readUserAIMemory(userId) {
    return new Promise((resolve) => {
        try {
            const db = _getAiMemDb();
            if (userId) {
                const row = db.prepare('SELECT history, user_name FROM user_ai_memory WHERE user_id = ?').get(userId);
                if (row) {
                    let history = [];
                    try { history = JSON.parse(row.history || '[]'); } catch { history = []; }
                    return resolve({ history, name: row.user_name });
                }
                return resolve({ history: [], name: null });
            }
            const rows = db.prepare('SELECT user_id, history, user_name FROM user_ai_memory').all();
            const result = {};
            for (const row of rows) {
                let history = [];
                try { history = JSON.parse(row.history || '[]'); } catch { history = []; }
                result[row.user_id] = { history, name: row.user_name };
            }
            resolve(result);
        } catch (e) {
            logger.error('readUserAIMemory error:', e.message);
            resolve(userId ? { history: [], name: null } : {});
        }
    });
}

function writeUserAIMemory(data) {
    try {
        const db = _getAiMemDb();
        const stmt = db.prepare('INSERT OR REPLACE INTO user_ai_memory (user_id, history, user_name) VALUES (?, ?, ?)');
        const tx = db.transaction((entries) => {
            for (const [userId, val] of entries) {
                if (val && (val.history || val.name)) {
                    stmt.run(userId, JSON.stringify(val.history || []), val.name || null);
                }
            }
        });
        tx(Object.entries(data));
        global.userAIMemory = data;
    } catch (e) {
        logger.error('writeUserAIMemory error:', e.message);
    }
}

// Statistik bot (dummy, bisa dihubungkan ke botState jika mau)
const botStats = { startTime: Date.now(), sent: 0, error: 0 };
function saveStats() {
    // Simpan ke file jika perlu
}

// Format durasi (sudah didefinisikan sekali di atas — alias saja)
const _formatDurationLegacy = formatDuration;

// Simple in-memory cache balasan AI per sesi user
const aiReplyCache = {};

// Helper untuk kirim pesan narasi AI ke user/admin (user-facing only)
async function sendAIMessage(sock, target, prompt, fallback, cacheKey = null) {
    try {
        // OPTIMIZED: Check cache first untuk hemat token
        if (cacheKey && aiReplyCache[cacheKey]) {
            const cached = aiReplyCache[cacheKey];
            // Check if cache is still valid (24 hours)
            if (Date.now() - cached.timestamp < AI_OPTIMIZATIONS.CACHE_DURATION_HOURS * 3600000) {
                await sock.sendMessage(target, { text: cached.response });
                return;
            } else {
                delete aiReplyCache[cacheKey]; // Clear expired cache
            }
        }
        
        // OPTIMIZED: Use shortened system prompt
        const aiPrompt = [
            { role: 'system', content: 'Balas santai, empatik, singkat.' }, // Much shorter system prompt
            { role: 'user', content: prompt }
        ];
        const aiRes = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            { model: 'deepseek-chat', messages: aiPrompt },
            { headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 } // Reduced timeout
        );
        const aiText = aiRes.data?.choices?.[0]?.message?.content?.trim() || fallback;
        
        // OPTIMIZED: Cache response dengan timestamp
        if (cacheKey) {
            aiReplyCache[cacheKey] = {
                response: aiText,
                timestamp: Date.now()
            };
        }
        
        await sock.sendMessage(target, { text: aiText });
    } catch (e) {
        logger.error('sendAIMessage error:', e.message);
        await sock.sendMessage(target, { text: fallback });
    }
}

// Notifikasi backup/error sistem ke OWNER pakai template
function notifyOwnerBackup(sock, type, status) {
    if (!OWNER_JID) return;
    let text = '';
    if (type === 'backup') {
        text = status === 'success' ? '✅ Backup data bot berhasil disimpan.' : '❌ Backup data bot GAGAL! Cek storage/server lo.';
    } else if (type === 'restore') {
        text = status === 'success' ? '✅ Restore data bot berhasil.' : '❌ Restore data bot GAGAL! Cek file backup atau storage.';
    } else {
        text = '⚠️ Notifikasi sistem bot.';
    }
    try { sock.sendMessage(OWNER_JID, { text }); } catch {}
}

// Tambahkan fungsi untuk menyimpan nama user
function saveUserName(userId, name) {
    return (async () => {
        try {
            const memory = await readUserAIMemory();
            if (!memory[userId]) {
                memory[userId] = { history: [], name: null };
            }
            memory[userId].name = name;
            writeUserAIMemory(memory);
            return true;
        } catch (_e) {
            return false;
        }
    })();
}

// Fungsi untuk backup data bot
async function backupBotData() {
    try {
        const backupDir = path.join(__dirname, '../backup');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `backup-${timestamp}`);

        // Buat direktori backup dengan timestamp
        fs.mkdirSync(backupPath, { recursive: true });

        // Data yang akan di-backup
        const filesToBackup = [
            { src: path.join(__dirname, '../config/admins.json'), dest: 'admins.json' },
            { src: path.join(__dirname, '../config/ai_memory.db'), dest: 'ai_memory.db' },
            { src: path.join(__dirname, '../config/birthdays.json'), dest: 'birthdays.json' },
            { src: path.join(__dirname, '../config/maintenance.json'), dest: 'maintenance.json' },
            { src: path.join(__dirname, '../config/scheduled_messages.json'), dest: 'scheduled_messages.json' },
            { src: path.join(__dirname, '../config/sholat_city.json'), dest: 'sholat_city.json' },
            { src: path.join(__dirname, '../config/user_ai_mode.json'), dest: 'user_ai_mode.json' }
        ];

        // Copy setiap file ke direktori backup
        for (const file of filesToBackup) {
            if (fs.existsSync(file.src)) {
                fs.copyFileSync(file.src, path.join(backupPath, file.dest));
            }
        }

        // Buat file info backup
        const backupInfo = {
            timestamp: new Date().toISOString(),
            files: filesToBackup.map(f => f.dest),
            version: process.env.npm_package_version || '1.0.0'
        };

        fs.writeFileSync(
            path.join(backupPath, 'backup-info.json'),
            JSON.stringify(backupInfo, null, 2)
        );

        // Kompres folder backup
        const zipPath = `${backupPath}.zip`;
        const archiver = require('archiver');
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            // Hapus folder backup setelah dikompres
            fs.rmSync(backupPath, { recursive: true, force: true });
        });

        archive.pipe(output);
        archive.directory(backupPath, false);
        await archive.finalize();

        return {
            success: true,
            path: zipPath,
            timestamp: timestamp
        };
    } catch (error) {
        logger.error('Backup error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Fungsi untuk restore data bot
async function restoreBotData(backupPath) {
    try {
        const extractDir = path.join(__dirname, '../restore-temp');
        if (!fs.existsSync(extractDir)) {
            fs.mkdirSync(extractDir, { recursive: true });
        }

        // Extract zip backup
        const extract = require('extract-zip');
        await extract(backupPath, { dir: extractDir });

        // Baca info backup
        const backupInfo = JSON.parse(
            fs.readFileSync(path.join(extractDir, 'backup-info.json'), 'utf8')
        );

        // Restore setiap file
        const filesToRestore = [
            { src: 'admins.json', dest: path.join(__dirname, '../config/admins.json') },
            { src: 'ai_memory.db', dest: path.join(__dirname, '../config/ai_memory.db') },
            { src: 'birthdays.json', dest: path.join(__dirname, '../config/birthdays.json') },
            { src: 'maintenance.json', dest: path.join(__dirname, '../config/maintenance.json') },
            { src: 'scheduled_messages.json', dest: path.join(__dirname, '../config/scheduled_messages.json') },
            { src: 'sholat_city.json', dest: path.join(__dirname, '../config/sholat_city.json') },
            { src: 'user_ai_mode.json', dest: path.join(__dirname, '../config/user_ai_mode.json') }
        ];

        for (const file of filesToRestore) {
            const srcPath = path.join(extractDir, file.src);
            if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, file.dest);
            }
        }

        // Bersihkan folder temporary
        fs.rmSync(extractDir, { recursive: true, force: true });

        return {
            success: true,
            timestamp: backupInfo.timestamp,
            version: backupInfo.version
        };
    } catch (error) {
        logger.error('Restore error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Fungsi untuk memanggil DeepSeek API via OpenRouter
async function callDeepSeekOpenRouter(messages, maxRetry = 2) {
    let reply = 'Maaf, tidak ada jawaban dari AI.';
    let lastError = null;
    let attempt = 0;
    
    while (attempt <= maxRetry) {
        try {
            const res = await axios.post(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    model: 'deepseek-chat',
                    messages
                },
                {
                    headers: {
                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 40000
                }
            );
            
            if (res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content) {
                reply = res.data.choices[0].message.content;
                break;
            } else {
                throw new Error('API DeepSeek tidak mengembalikan jawaban.');
            }
        } catch (e) {
            lastError = e;
            // Jika error karena timeout/ECONNRESET, retry
            if ((e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || (e.message && e.message.includes('timeout'))) && attempt < maxRetry) {
                attempt++;
                await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff
                continue;
            } else {
                logger.error('AI DeepSeek Error:', {
                    error: e.message,
                    code: e.code,
                    stack: e.stack,
                    data: e.response?.data,
                    time: new Date().toISOString()
                });
                throw new Error(e.response?.data?.error?.message || e.message || 'Gagal menghubungi API DeepSeek.');
            }
        }
    }
    
    return reply;
}

// ===== OPTIMIZATIONS UNTUK HEMAT TOKEN ===== 
const AI_OPTIMIZATIONS = {
    ENABLE_EMOTION_DETECTION: false, // Disable untuk hemat token
    ENABLE_AUTO_SUMMARY: false, // Disable untuk hemat token  
    ENABLE_AI_ADMIN_RESPONSES: false, // Disable untuk hemat token
    MAX_HISTORY_LENGTH: 3, // Kurangi dari 4 jadi 3
    MAX_RETRY: 1, // Kurangi dari 2 jadi 1
    CACHE_DURATION_HOURS: 24 // Cache AI response 24 jam
};

// Short system prompt untuk hemat token
const SHORT_SYSTEM_PROMPT = `Kamu adalah teman chat yang empatik dan santai. Jawab seperti teman dekat, bukan formal. Pakai bahasa sehari-hari, boleh 'gw/lo', emot, dan gaya Gen Z. Tenangin dulu kalau user panik, jangan buru-buru kasih saran.`;

module.exports = {
    handleCommand,
    botState,
    reminderManager,
    validators,
    imageToSticker,
    GEMINI_API_KEY,
    testApiAIs,
    scheduleMotivasiHarian,
    readUserAIMode,
    readUserAIMemory,
    writeUserAIMemory,
    saveUserName,
    botStats,
    saveStats,
    getSystemInfo,
    formatDuration,
    DEEPSEEK_API_KEY,
    callDeepSeekOpenRouter
};
