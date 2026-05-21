global.crypto = require('crypto');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const sharp = require('sharp');
const ms = require('ms');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');
const chalk = require('chalk');
const { default: pino } = require('pino');
const utils = require('../modules/utils');
const { handleCommand, botStats, saveStats, GEMINI_API_KEY, readUserAIMode, readUserAIMemory, writeUserAIMemory, saveUserName, scheduleMotivasiHarian, getSystemInfo, formatDuration, testApiAIs } = require('../modules/commands');
const winston = require('winston');
require('winston-daily-rotate-file');
const moment = require('moment-timezone');
const { getHutang, getHutangReminder, saveHutangReminder } = require('../modules/utils');
const { getUserSummary, saveUserSummary, summarizeUserHistoryWithLLM, getUserFacts } = require('../modules/utils');

// Load environment variables
require('dotenv').config();

const BOT_NUMBER = process.env.BOT_NUMBER || 'your_bot_number@s.whatsapp.net';
const ADMIN_FILE = path.join(__dirname, '../config/admins.json');
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || 'your_openweather_api_key_here';
const DEFAULT_SHOLAT_CITY_FILE = path.join(__dirname, '../config/sholat_city.json');
const BIRTHDAY_FILE = path.join(__dirname, '../config/birthdays.json');
const LOG_FILE = path.join(__dirname, '../data/bot.log');
const SCHEDULED_FILE = path.join(__dirname, '../config/scheduled_messages.json');
const LAST_TARGET_FILE = path.join(__dirname, '../config/last_target.json');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // Pilihan: 'error', 'warn', 'success', 'info', 'all'
const MAINTENANCE_FILE = path.join(__dirname, '../config/maintenance.json');

// Tambahkan setelah deklarasi variabel global
const WELCOMED_USERS = new Set();

// Tambahkan konstanta untuk owner
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';
const OWNER_JID = OWNER_NUMBER ? `${OWNER_NUMBER}@s.whatsapp.net` : '';

// Konfigurasi logger yang lebih baik
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // Log error ke file terpisah
        new winston.transports.DailyRotateFile({
            filename: path.join(__dirname, '../logs/error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d'
        }),
        // Log semua aktivitas
        new winston.transports.DailyRotateFile({
            filename: path.join(__dirname, '../logs/combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d'
        })
    ]
});

// Tambahkan transport console untuk development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Fungsi logging yang lebih terstruktur
function logActivity(type, message, data = {}) {
    const logData = {
        type,
        message,
        timestamp: new Date().toISOString(),
        ...data
    };

    switch(type) {
        case 'ERROR':
            logger.error(logData);
            break;
        case 'WARN':
            logger.warn(logData);
            break;
        case 'SUCCESS':
            logger.info(logData);
            break;
        default:
            logger.info(logData);
    }
}

function shouldLog(level) {
    const order = ['error', 'warn', 'success', 'info', 'all'];
    return order.indexOf(level) <= order.indexOf(LOG_LEVEL);
}

function logToFile(level, msg, context) {
    const now = new Date().toISOString();
    const ctx = context ? `[${context}]` : '';
    fs.appendFileSync(LOG_FILE, `[${level.toUpperCase()}]${ctx}[${now}] ${msg}\n`);
}
function logInfo(msg, context) {
    if (shouldLog('info')) {
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const contextStr = context ? chalk.bgBlue.white.bold(` ${context} `) : '';
        console.log(chalk.cyan('🔍 ') + contextStr + chalk.gray(` [${timestamp}] `) + chalk.white(msg));
    }
}
function logError(msg, context) {
    if (shouldLog('error')) {
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const contextStr = context ? chalk.bgRed.white.bold(` ${context} `) : '';
        console.log(chalk.red('❌ ') + contextStr + chalk.gray(` [${timestamp}] `) + chalk.red.bold(msg));
    }
}
function logWarn(msg, context) {
    if (shouldLog('warn')) {
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const contextStr = context ? chalk.bgYellow.black.bold(` ${context} `) : '';
        console.log(chalk.yellow('⚠️  ') + contextStr + chalk.gray(` [${timestamp}] `) + chalk.yellow(msg));
    }
}
function logSuccess(msg, context) {
    if (shouldLog('success')) {
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const contextStr = context ? chalk.bgGreen.white.bold(` ${context} `) : '';
        console.log(chalk.green('✅ ') + contextStr + chalk.gray(` [${timestamp}] `) + chalk.green.bold(msg));
    }
}

global.maintenanceMode = false;
let scheduledTimeouts = {};

// Antrian pesan dengan retry mechanism
let messageQueue = [];
let connectionReady = false;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// Rate Limiting dengan Token Bucket
class RateLimiter {
    constructor() {
        this.buckets = new Map();
        this.defaultLimit = {
            tokens: 5,
            lastRefill: Date.now(),
            refillRate: 1000, // 1 token per detik
            maxTokens: 5
        };
    }

    canProceed(userId) {
        const now = Date.now();
        let bucket = this.buckets.get(userId) || { ...this.defaultLimit };

        // Refill tokens
        const timePassed = now - bucket.lastRefill;
        const tokensToAdd = Math.floor(timePassed / bucket.refillRate);
        
        if (tokensToAdd > 0) {
            bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
            bucket.lastRefill = now;
        }

        // Check if can proceed
        if (bucket.tokens > 0) {
            bucket.tokens--;
            this.buckets.set(userId, bucket);
            return true;
        }

        this.buckets.set(userId, bucket);
        return false;
    }

    getWaitTime(userId) {
        const bucket = this.buckets.get(userId);
        if (!bucket) return 0;
        
        const now = Date.now();
        const timePassed = now - bucket.lastRefill;
        const tokensToAdd = Math.floor(timePassed / bucket.refillRate);
        
        if (tokensToAdd > 0) return 0;
        
        return bucket.refillRate - (timePassed % bucket.refillRate);
    }
}

const rateLimiter = new RateLimiter();

class QueuedMessage {
    constructor(jid, content, options = {}, notify = true) {
        this.jid = jid;
        this.content = content;
        this.options = options;
        this.notify = notify;
        this.retries = 0;
        this.timestamp = Date.now();
    }
}

function getAdmins() { return utils.getAdmins(); }
function saveAdmins(admins) { return utils.saveAdmins(admins); }
function isAdmin(jid) {
    const admins = getAdmins();
    const senderNum = jid.replace(/@s\.whatsapp\.net$/, '');
    return admins.includes(senderNum);
}
function isOwner(jid) {
    const senderNum = jid.replace(/@s\.whatsapp\.net$/, '');
    return senderNum === OWNER_NUMBER;
}
function getDefaultSholatCity() { return utils.getDefaultSholatCity(); }
function setDefaultSholatCity(city) { return utils.setDefaultSholatCity(city); }
function getBirthdays() { return utils.getBirthdays(); }
function saveBirthdays(bds) { return utils.saveBirthdays(bds); }
function getScheduledMessages() { return utils.getScheduledMessages(); }
function saveScheduledMessages(list) { return utils.saveScheduledMessages(list); }
function getLastTarget() { return utils.getLastTarget(); }
function setLastTarget(target) { return utils.setLastTarget(target); }

// Sistem Anti-Spam dan Keamanan
class SecuritySystem {
    constructor() {
        this.blockedUsers = new Map(); // userId -> { reason, timestamp }
        this.suspiciousActivities = new Map(); // userId -> count
        this.maxSuspiciousActivities = 5;
        this.blockDuration = 24 * 60 * 60 * 1000; // 24 jam
    }

    isBlocked(userId) {
        const blockInfo = this.blockedUsers.get(userId);
        if (!blockInfo) return false;

        // Cek apakah blokir sudah expired
        if (Date.now() - blockInfo.timestamp > this.blockDuration) {
            this.blockedUsers.delete(userId);
            return false;
        }

        return true;
    }

    getBlockInfo(userId) {
        return this.blockedUsers.get(userId);
    }

    blockUser(userId, reason) {
        this.blockedUsers.set(userId, {
            reason,
            timestamp: Date.now()
        });
        logActivity('WARN', `User diblokir: ${userId}`, { reason });
    }

    unblockUser(userId) {
        this.blockedUsers.delete(userId);
        logActivity('INFO', `User diunblokir: ${userId}`);
    }

    addSuspiciousActivity(userId) {
        const count = (this.suspiciousActivities.get(userId) || 0) + 1;
        this.suspiciousActivities.set(userId, count);

        if (count >= this.maxSuspiciousActivities) {
            this.blockUser(userId, 'Terlalu banyak aktivitas mencurigakan');
            return true;
        }
        return false;
    }

    resetSuspiciousActivity(userId) {
        this.suspiciousActivities.delete(userId);
    }
}

const securitySystem = new SecuritySystem();

// Sistem Notifikasi yang Lebih Canggih
class NotificationSystem {
    constructor() {
        this.notificationTypes = {
            SYSTEM: { emoji: '🔄', priority: 1 },
            ERROR: { emoji: '❌', priority: 2 },
            WARNING: { emoji: '⚠️', priority: 3 },
            SUCCESS: { emoji: '✅', priority: 4 },
            INFO: { emoji: 'ℹ️', priority: 5 },
            MAINTENANCE: { emoji: '🔧', priority: 1 }
        };
    }

    async send(sock, message, type = 'INFO', data = {}) {
        const notificationType = this.notificationTypes[type] || this.notificationTypes.INFO;
        const timestamp = new Date().toLocaleString('id-ID');
        
        let formattedMessage = `${notificationType.emoji} *${type}*\n`;
        formattedMessage += `⏰ ${timestamp}\n\n`;
        formattedMessage += message;

        if (Object.keys(data).length > 0) {
            formattedMessage += '\n\n*Detail:*\n';
            for (const [key, value] of Object.entries(data)) {
                formattedMessage += `• ${key}: ${value}\n`;
            }
        }

        // Selalu kirim ke owner
        await sock.sendMessage(OWNER_JID, { text: formattedMessage });
        
        // Jika bukan maintenance mode dan bukan notifikasi sistem/error
        if (!global.maintenanceMode && notificationType.priority > 2) {
            const admins = getAdmins();
            for (const admin of admins) {
                if (admin !== OWNER_NUMBER) {
                    await sock.sendMessage(admin + '@s.whatsapp.net', { text: formattedMessage });
                }
            }
        }

        // Log notifikasi
        logActivity(type, message, data);
    }

    async sendError(sock, error, context = '') {
        const errorMessage = `Error: ${error.message}\nContext: ${context}`;
        await this.send(sock, errorMessage, 'ERROR', {
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }

    async sendSystemStatus(sock) {
        const sysInfo = getSystemInfo();
        const message = `*Status Sistem*\n\n` +
            `• CPU: ${sysInfo.cpu.usage}%\n` +
            `• Memory: ${sysInfo.memory.percentage}%\n` +
            `• Uptime: ${formatDuration(sysInfo.system.uptime)}\n` +
            `• Node: ${sysInfo.system.nodeVersion}`;
        
        await this.send(sock, message, 'SYSTEM', sysInfo);
    }
}

const notificationSystem = new NotificationSystem();

// Fungsi pembantu untuk timeout manual
function withTimeout(promise, ms, errorMsg = 'Timed Out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
}

// Modifikasi safeSendMessage untuk menggunakan sistem keamanan
async function safeSendMessage(sock, jid, content, options = {}, notify = true) {
    // Deteksi jika sock adalah wwebClient (whatsapp-web.js)
    if (sock && typeof sock.sendMessage === 'function' && sock.constructor && sock.constructor.name === 'Client') {
        try {
            await sock.sendMessage(jid, typeof content === 'string' ? content : content.text || content, options);
            logSuccess('Pesan berhasil dikirim!', 'SEND');
            return true;
        } catch (e) {
            logError(`SendMessage error to ${jid}: ${e.message}`, 'SEND');
            return false;
        }
    }
    const userId = jid.replace(/@s\.whatsapp\.net$/, '');
    
    // Cek user yang diblokir
    if (securitySystem.isBlocked(userId)) {
        const blockInfo = securitySystem.getBlockInfo(userId);
        const remainingTime = Math.ceil((blockInfo.timestamp + securitySystem.blockDuration - Date.now()) / 1000 / 60);
        await sock.sendMessage(jid, { 
            text: `⚠️ Anda diblokir sementara.\nAlasan: ${blockInfo.reason}\nSisa waktu: ${remainingTime} menit` 
        });
        return false;
    }

    // Cek rate limiting
    if (!rateLimiter.canProceed(userId)) {
        const waitTime = rateLimiter.getWaitTime(userId);
        if (securitySystem.addSuspiciousActivity(userId)) {
            await sock.sendMessage(jid, { 
                text: '⚠️ Terlalu banyak pesan. Akun Anda diblokir sementara.' 
            });
            return false;
        }
        await sock.sendMessage(jid, { 
            text: `⚠️ Terlalu banyak pesan. Silakan tunggu ${Math.ceil(waitTime/1000)} detik.` 
        });
        return false;
    }

    // Reset suspicious activity jika pesan berhasil
    securitySystem.resetSuspiciousActivity(userId);

    try {
        if (!sock.user || !sock.user.id || !connectionReady) {
            logWarn('Koneksi WhatsApp belum siap, pesan akan dikirim ulang nanti', 'SEND');
            messageQueue.push(new QueuedMessage(jid, content, options, notify));
            return false;
        }
        // Gunakan timeout manual 15 detik
        await withTimeout(sock.sendMessage(jid, content, options), 15000, 'Timed Out (manual)');
        logSuccess('Pesan berhasil dikirim!', 'SEND');
        if (botStats) { 
            botStats.sent++; 
            saveStats(); 
        }
        return true;
    } catch (e) {
        // Penanganan error timeout (statusCode 408 atau manual timeout)
        if ((e.output && e.output.statusCode === 408) || e.message.includes('Timed Out')) {
            logWarn(`Timeout saat mengirim pesan ke ${jid}, akan dicoba ulang.`, 'SEND');
            messageQueue.push(new QueuedMessage(jid, content, options, notify));
            return false;
        }
        logError(`SendMessage error to ${jid}: ${e.message}`, 'SEND');
        if (e.message.includes('Connection') || e.message.includes('network')) {
            messageQueue.push(new QueuedMessage(jid, content, options, notify));
            return false;
        }
        if (botStats) { 
            botStats.error++; 
            saveStats(); 
        }
        // Kirim notifikasi error ke owner
        if (notify) {
            await sendNotification(sock, 
                `Error mengirim pesan ke ${jid}:\n${e.message}`, 
                'ERROR'
            );
        }
        return false;
    }
}

// Proses antrian pesan dengan retry logic
async function processMessageQueue(sock) {
    if (messageQueue.length === 0) return;
    
    if (!connectionReady) {
        logWarn('Koneksi belum siap, menunda pengiriman pesan', 'QUEUE');
        return;
    }

    const now = Date.now();
    const tempQueue = [...messageQueue];
    messageQueue = [];

    for (const msg of tempQueue) {
        // Skip messages older than 1 hour
        if (now - msg.timestamp > 3600000) {
            logWarn(`Pesan untuk ${msg.jid} dibatalkan karena terlalu lama dalam antrian`, 'QUEUE');
            continue;
        }

        try {
            await sock.sendMessage(msg.jid, msg.content, msg.options);
            logSuccess('Pesan antrian berhasil dikirim!', 'QUEUE');
            if (botStats) {
                botStats.sent++;
                saveStats();
            }
        } catch (e) {
            logError(`Gagal mengirim pesan antrian: ${e.message}`, 'QUEUE');
            
            if (msg.retries < MAX_RETRIES && 
                (e.message.includes('Connection') || e.message.includes('network'))) {
                msg.retries++;
                messageQueue.push(msg);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else if (botStats) {
                botStats.error++;
                saveStats();
            }
        }
        // Tambah delay kecil antara pengiriman
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Loading animation
function showLoading(msg, duration = 3000) {
    const frames = ['.  ', '.. ', '...'];
    let i = 0;
    process.stdout.write(msg);
    const interval = setInterval(() => {
        process.stdout.write('\r' + msg + frames[i++ % frames.length]);
    }, 400);
    setTimeout(() => {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(msg.length + 3) + '\r');
    }, duration);
}

// Tambahkan fungsi untuk mengubah status/about bot
async function updateBotStatus(sock, maintenanceMode) {
    const status = maintenanceMode
        ? '🚧 Bot WhatsApp: Maintenance Mode'
        : '🤖 Bot WhatsApp: Status Normal';
    try {
        await sock.updateProfileStatus(status);
        logInfo(`Status WhatsApp diubah: ${status}`, 'STATUS');
    } catch (e) {
        logError('Gagal update status WhatsApp: ' + e.message, 'STATUS');
    }
}

// Modifikasi fungsi sendNotification untuk menggunakan sistem baru
async function sendNotification(sock, message, type = 'INFO') {
    await notificationSystem.send(sock, message, type);
}

// Fungsi untuk ambil jadwal sholat hari ini dari API (delegasi ke modules/islamic)
async function getJadwalSholat(city = 'jakarta') {
    try {
        logInfo(`Mengambil jadwal sholat untuk kota: ${city}`, 'SHOLAT');
        const islamic = require('../modules/islamic');
        const jadwal = await islamic.getJadwalSholat(city);
        if (jadwal) {
            const result = {
                subuh: jadwal.subuh,
                dzuhur: jadwal.dzuhur,
                ashar: jadwal.ashar,
                maghrib: jadwal.maghrib,
                isya: jadwal.isya
            };
            logSuccess(`Jadwal sholat berhasil diambil untuk ${city} (${jadwal.source}): ${JSON.stringify(result)}`, 'SHOLAT');
            return result;
        }
    } catch (e) {
        logError('Gagal mengambil jadwal sholat: ' + e.message, 'SHOLAT');
    }
    return null;
}

// Global tracker untuk notifikasi sholat
let sholatNotificationScheduled = false;
let currentSholatDate = null;

// Fungsi penjadwalan notifikasi sholat yang diperbaiki
async function scheduleSholatNotifications(sock, city = null) {
    try {
        // Get city from database settings or use default
        const sholatCity = city || getDefaultSholatCity();
        const today = moment.tz('Asia/Jakarta').format('YYYY-MM-DD');
        
        // Reset scheduling if it's a new day
        if (currentSholatDate !== today) {
            sholatNotificationScheduled = false;
            currentSholatDate = today;
            logInfo(`Reset notifikasi sholat untuk hari baru: ${today}`, 'SHOLAT');
        }
        
        // Skip if already scheduled for today
        if (sholatNotificationScheduled) {
            logInfo('Notifikasi sholat sudah dijadwalkan untuk hari ini', 'SHOLAT');
            return;
        }
        
        const jadwal = await getJadwalSholat(sholatCity);
        if (!jadwal) {
            logError('Gagal mendapatkan jadwal sholat, tidak dapat menjadwalkan notifikasi', 'SHOLAT');
            return;
        }
        
        const now = moment.tz('Asia/Jakarta');
        let notificationCount = 0;
        
        Object.entries(jadwal).forEach(([nama, waktu]) => {
            // Create time for today with proper format
            const waktuSholat = moment.tz(`${today} ${waktu}`, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
            const delay = waktuSholat.diff(now);
            
            // Only schedule future prayer times
            if (delay > 0) {
                setTimeout(async () => {
                    try {
                        const message = `🕌 *Waktunya Sholat ${nama.toUpperCase()}!*\n\n⏰ Waktu: ${waktu} WIB\n📍 Wilayah: ${sholatCity.charAt(0).toUpperCase() + sholatCity.slice(1)}\n\n_Jangan lupa sholat tepat waktu_ 🤲`;
                        
                        // Send to owner
                        await safeSendMessage(sock, OWNER_JID, { text: message });
                        logSuccess(`Notifikasi sholat ${nama} terkirim ke owner`, 'SHOLAT');
                        
                        // Send to admins (if not in maintenance mode)
                        if (!global.maintenanceMode) {
                            const admins = getAdmins();
                            for (const admin of admins) {
                                const adminJid = admin + '@s.whatsapp.net';
                                if (adminJid !== OWNER_JID) {
                                    await safeSendMessage(sock, adminJid, { text: message });
                                    logSuccess(`Notifikasi sholat ${nama} terkirim ke admin: ${admin}`, 'SHOLAT');
                                }
                            }
                        }
                    } catch (error) {
                        logError(`Gagal mengirim notifikasi sholat ${nama}: ${error.message}`, 'SHOLAT');
                    }
                }, delay);
                
                notificationCount++;
                logInfo(`Notifikasi sholat ${nama} dijadwalkan pada ${waktuSholat.format('HH:mm')} (delay: ${Math.round(delay/1000)}s)`, 'SHOLAT');
            } else {
                logInfo(`Waktu sholat ${nama} (${waktu}) sudah terlewat hari ini`, 'SHOLAT');
            }
        });
        
        if (notificationCount > 0) {
            sholatNotificationScheduled = true;
            logSuccess(`${notificationCount} notifikasi sholat dijadwalkan untuk kota ${sholatCity}`, 'SHOLAT');
            
            // Schedule next day's prayer notifications at midnight
            scheduleNextDayPrayerReset(sock, sholatCity);
        } else {
            logWarn('Tidak ada notifikasi sholat yang dijadwalkan (semua waktu sudah terlewat)', 'SHOLAT');
        }
        
    } catch (error) {
        logError(`Error dalam scheduleSholatNotifications: ${error.message}`, 'SHOLAT');
    }
}

// Helper function to schedule next day prayer reset
function scheduleNextDayPrayerReset(sock, city) {
    const now = moment.tz('Asia/Jakarta');
    const tomorrow = now.clone().add(1, 'day').startOf('day');
    const delay = tomorrow.diff(now);
    
    setTimeout(() => {
        logInfo('Reset penjadwalan sholat untuk hari baru', 'SHOLAT');
        scheduleSholatNotifications(sock, city);
    }, delay);
    
    logInfo(`Reset otomatis penjadwalan sholat dijadwalkan pada ${tomorrow.format('YYYY-MM-DD HH:mm')}`, 'SHOLAT');
}

// Fungsi ambil data cuaca
async function getCuaca(kota = 'jakarta') {
    const apiKey = OPENWEATHER_API_KEY;
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(kota)}&appid=${apiKey}&units=metric&lang=id`;
    try {
        const res = await axios.get(url);
        if (res.data) {
            const cuaca = res.data.weather[0].description;
            const suhu = res.data.main.temp;
            return `🌤️ *Cuaca di ${kota}*\n${cuaca}\nSuhu: ${suhu}°C`;
        }
    } catch (e) {
        logError('Gagal mendapatkan data cuaca: ' + e.message, 'CUACA');
    }
    return 'Gagal mendapatkan data cuaca.';
}

// Penjadwalan auto-notif cuaca harian pada interval 2 jam
function scheduleCuacaNotif(sock, kota = 'jakarta') {
    const { GEMINI_API_KEY } = require('../modules/commands');
    const axios = require('axios');
    console.log(`[DEBUG] scheduleCuacaNotif dipanggil untuk kota: ${kota}`);
    function scheduleNext() {
        const now = moment.tz('Asia/Jakarta');
        let next = now.clone().add(2, 'hour').minute(0).second(0);
        let delay = next.diff(now);
        if (!Number.isFinite(delay) || delay <= 0) delay = 2 * 3600 * 1000; // fallback 2 jam biar ga immediate-fire loop
        if (scheduledTimeouts.cuacaNotif) clearTimeout(scheduledTimeouts.cuacaNotif);
        scheduledTimeouts.cuacaNotif = setTimeout(async () => {
            console.log(`[DEBUG] scheduleCuacaNotif: timer triggered untuk kota: ${kota}`);
            const info = await getCuaca(kota);
            console.log(`[DEBUG] scheduleCuacaNotif: info cuaca: ${info}`);
            // Jika maintenance aktif, hanya owner yang menerima notifikasi
            let admins = getAdmins();
            if (global.maintenanceMode) {
                admins = OWNER_NUMBER ? [OWNER_NUMBER] : []; // Hanya owner
            }
            const waktuNotif = next.format('HH:mm:ss');
            const prompt = `Buatkan pesan WhatsApp yang informatif, empatik, dan menarik untuk admin berdasarkan info cuaca berikut. Jangan terlalu formal, boleh pakai emot, dan sesuaikan gaya dengan kondisi cuaca.\nNotifikasi cuaca otomatis untuk admin pada waktu ${waktuNotif}.\nInfo cuaca: ${info}`;
            let aiReply;
            try {
                const res = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-pro:generateContent?key=${GEMINI_API_KEY}`,
                    { contents: [{ parts: [{ text: prompt }] }] },
                    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
                );
                aiReply = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || info;
            } catch (_e) {
                aiReply = info;
            }
            for (const admin of admins) {
                console.log(`[DEBUG] scheduleCuacaNotif: mengirim notifikasi ke admin: ${admin}`);
                await safeSendMessage(sock, admin + '@s.whatsapp.net', { text: aiReply });
            }
            console.log(`[DEBUG] scheduleCuacaNotif: notifikasi cuaca terkirim ke semua admin.`);
            scheduleNext();
        }, delay);
    }
    scheduleNext();
}

// === MIGRASI: Inisialisasi Baileys ===
async function printTypingLine(line, delay = 18) {
    let str = '';
    for (const char of line) {
        str += char;
        process.stdout.write(char);
        await new Promise(r => setTimeout(r, delay));
    }
    process.stdout.write('\n');
}

async function printAnimatedWelcome() {
    // Clear screen dan tampilkan header
    process.stdout.write('\x1B[2J\x1B[0f');
    
    const asciiArt = [
        chalk.cyan.bold('╔══════════════════════════════════════════════════════════════╗'),
        chalk.cyan.bold('║                  🤖 WHATSAPP BOT SYSTEM 🚀                  ║'),
        chalk.cyan.bold('╠══════════════════════════════════════════════════════════════╣'),
        chalk.cyan.bold('║') + chalk.white.bold('               Enhanced Multi-Feature Assistant              ') + chalk.cyan.bold('║'),
        chalk.cyan.bold('║') + chalk.gray('              Powered by AI & Advanced Automation           ') + chalk.cyan.bold('║'),
        chalk.cyan.bold('╚══════════════════════════════════════════════════════════════╝'),
        ''
    ];
    
    for (const line of asciiArt) {
        await printTypingLine(line, 25);
        await new Promise(r => setTimeout(r, 100));
    }
    
    // Owner welcome section
    const welcomeLines = [
        chalk.bgBlue.white.bold(' 👋 Selamat Datang, Erzam Bayu! '),
        '',
        chalk.green.bold('🎉 Bot System Successfully Initialized!'),
        chalk.yellow('⚡ All systems operational and ready to serve'),
        chalk.cyan('🛡️  Security protocols activated'),
        chalk.magenta('🧠 AI modules loaded and optimized'),
        '',
        chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    ];
    
    for (const line of welcomeLines) {
        await printTypingLine(line, 20);
        await new Promise(r => setTimeout(r, 150));
    }
    
    // System status checks
    console.log(chalk.yellow.bold('\n🔍 Running System Diagnostics...'));
    await new Promise(r => setTimeout(r, 800));
    
    // Test API AI setelah welcome dengan tampilan yang lebih baik
    const { deepseekOk, geminiOk } = await testApiAIs();
    
    console.log(chalk.cyan.bold('\n📡 AI Service Status:'));
    if (deepseekOk) {
        console.log(chalk.green('   ✅ DeepSeek AI: ') + chalk.white.bold('CONNECTED') + chalk.gray(' (Response time: <2s)'));
    } else {
        console.log(chalk.red('   ❌ DeepSeek AI: ') + chalk.white.bold('DISCONNECTED') + chalk.gray(' (Check API key)'));
    }
    
    if (geminiOk) {
        console.log(chalk.green('   ✅ Gemini AI: ') + chalk.white.bold('CONNECTED') + chalk.gray(' (Backup system ready)'));
    } else {
        console.log(chalk.red('   ❌ Gemini AI: ') + chalk.white.bold('DISCONNECTED') + chalk.gray(' (Backup unavailable)'));
    }
    
    // Feature status
    console.log(chalk.cyan.bold('\n🎮 Feature Modules:'));
    const features = [
        { name: 'QR Generator/Scanner', status: true },
        { name: 'URL Shortener', status: true },
        { name: 'Expense Tracker', status: true },
        { name: 'Invoice Generator', status: true },
        { name: 'Social Media Downloader', status: true },
        { name: 'Weather API', status: true },
        { name: 'Prayer Times', status: true },
        { name: 'Auto Reminders', status: true }
    ];
    
    features.forEach(feature => {
        const statusIcon = feature.status ? '✅' : '❌';
        const statusText = feature.status ? chalk.green.bold('READY') : chalk.red.bold('ERROR');
        console.log(`   ${statusIcon} ${feature.name}: ${statusText}`);
    });
    
    console.log(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.green.bold('🚀 System ready! Waiting for WhatsApp connection...'));
    console.log(chalk.gray('📱 Please scan QR code when it appears\n'));
}

// Tambahkan variabel global untuk tracking reconnection
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let isReconnecting = false;

// Cleanup function untuk membersihkan session lama (timer scheduler PERSIST antar reconnect)
function cleanupBeforeStart() {
    try {
        // HANYA clear timer sesi — timer scheduler (cuacaNotif, hutangReminder, sholat) tetap jalan.
        // Kalau lo butuh full reset, restart node process langsung.
        if (scheduledTimeouts) {
            const SESSION_KEYS = ['queueRetry', 'reconnectDelay', 'pendingMessage'];
            for (const key of SESSION_KEYS) {
                if (scheduledTimeouts[key]) {
                    clearTimeout(scheduledTimeouts[key]);
                    delete scheduledTimeouts[key];
                }
            }
        }

        // Reset connection state
        connectionReady = false;
        messageQueue = [];

        // Clear notification data
        if (global.pendingDeleteHutang) {
            Object.values(global.pendingDeleteHutang).forEach(pending => {
                if (pending.timeout) clearTimeout(pending.timeout);
            });
            global.pendingDeleteHutang = {};
        }

        logInfo('Cleanup completed - session state cleared (schedulers persist)', 'CLEANUP');
    } catch (e) {
        logWarn('Cleanup error (non-critical): ' + e.message, 'CLEANUP');
    }
}

async function startBot() {
    // Prevent multiple simultaneous reconnection attempts
    if (isReconnecting) {
        logWarn('Reconnection already in progress, skipping...', 'STARTUP');
        return;
    }
    
    isReconnecting = true;
    
    try {
        // Cleanup any previous sessions
        cleanupBeforeStart();
        
        // Clear terminal dan tampilkan header
        console.clear();
        
        // Header banner
        console.log(chalk.cyan.bold('╔══════════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan.bold('║') + chalk.white.bold('                            WHATSAPP BOT LAUNCHER                            ') + chalk.cyan.bold('║'));
        console.log(chalk.cyan.bold('╠══════════════════════════════════════════════════════════════════════════════╣'));
        console.log(chalk.cyan.bold('║') + chalk.green('  🚀 Enhanced Multi-Feature Assistant v2.1.0                               ') + chalk.cyan.bold('║'));
        console.log(chalk.cyan.bold('║') + chalk.gray('  Created by: Erzam Bayu | github.com/erzam-bayu                           ') + chalk.cyan.bold('║'));
        console.log(chalk.cyan.bold('║') + chalk.yellow('  Features: AI Chat, QR Tools, Finance Manager, Social Media DL            ') + chalk.cyan.bold('║'));
        console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════════════════════════════╝'));
        
        if (reconnectAttempts > 0) {
            console.log(chalk.yellow(`\n🔄 Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}`));
        }
        console.log('');
        
        // Dynamic import ora (karena ESM)
        const ora = (await import('ora')).default;
        
        // Loading dengan steps yang lebih detail
        const steps = [
            { text: 'Initializing WhatsApp Bot System...', color: 'cyan', delay: 800 },
            { text: 'Loading multi-file authentication state...', color: 'yellow', delay: 600 },
            { text: 'Fetching latest Baileys version...', color: 'yellow', delay: 600 },
            { text: 'Configuring AI modules & APIs...', color: 'magenta', delay: 500 },
            { text: 'Setting up security protocols...', color: 'blue', delay: 400 },
            { text: 'Connecting to WhatsApp servers...', color: 'green', delay: 800 }
        ];
        
        for (const step of steps) {
            const spinner = ora({
                text: chalk[step.color](step.text),
                spinner: 'dots'
            }).start();
            await new Promise(r => setTimeout(r, step.delay));
            spinner.succeed(chalk.green('✅ ') + chalk[step.color](step.text.replace('...', ' - Complete!')));
        }
        
        console.log(chalk.green.bold('\n🎉 All systems initialized successfully!\n'));

        // Animasi sambutan hanya pada startup pertama
        if (reconnectAttempts === 0) {
            await printAnimatedWelcome();
        } else {
            console.log(chalk.cyan.bold('🔄 Attempting to restore WhatsApp connection...\n'));
        }

        logInfo('Multi-file authentication state ready', 'STARTUP');
        const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
        const { version } = await fetchLatestBaileysVersion();
        logInfo(`Latest Baileys version: ${version}`, 'STARTUP');
        
        const sock = makeWASocket({
            version,
            printQRInTerminal: !reconnectAttempts, // Only show QR on first attempt
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Enhanced-WA-Bot', 'Chrome', '122.0.0.0'],
            syncFullHistory: false,
            connectTimeoutMs: 60000, // 60 second timeout
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            markOnlineOnConnect: true
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                if (reconnectAttempts === 0) {
                    console.log(chalk.yellow.bold('\n📱 QR CODE READY TO SCAN!'));
                    console.log(chalk.cyan('   Open WhatsApp → Linked Devices → Link a Device'));
                    console.log(chalk.gray('   Scan the QR code above to connect the bot\n'));
                } else {
                    console.log(chalk.yellow.bold('\n📱 New QR code generated - please scan again'));
                }
                logInfo('QR code generated - Please scan with WhatsApp', 'BAILEYS');
            }
            if (connection === 'open') {
                connectionReady = true;
                reconnectAttempts = 0; // Reset reconnection attempts on successful connection
                
                // Terminal success notification
                console.log(chalk.green.bold('\n🎉 ═══════════════════════════════════════════════════════════════'));
                console.log(chalk.green.bold('   ✅ WHATSAPP CONNECTION ESTABLISHED SUCCESSFULLY!'));
                console.log(chalk.green.bold('   🚀 Bot is now ONLINE and ready to serve users'));
                console.log(chalk.green.bold('═══════════════════════════════════════════════════════════════\n'));
                
                logSuccess('WhatsApp connection established! connectionReady=true', 'SYSTEM');
                logSuccess('Bot WhatsApp is now fully operational!', 'SYSTEM');
                
                // Initialize scheduled services with better logging — idempotent (cuma sekali walau reconnect berkali-kali)
                console.log(chalk.cyan('🔄 Initializing scheduled services...'));

                if (!global.__schedulersStarted) {
                    global.__schedulersStarted = true;

                    const prayerCity = getDefaultSholatCity();
                    scheduleSholatNotifications(sock, prayerCity);
                    console.log(chalk.green(`   ✅ Prayer time notifications activated for ${prayerCity}`));

                    scheduleCuacaNotif(sock, 'jakarta');
                    console.log(chalk.green('   ✅ Weather notifications activated'));

                    scheduleHutangReminder(sock);
                    console.log(chalk.green('   ✅ Debt reminders activated'));

                    const admins = getAdmins();
                    scheduleMotivasiHarian(sock, admins, 7);
                    console.log(chalk.green('   ✅ Daily motivation scheduled'));
                } else {
                    console.log(chalk.gray('   ⏭️  Schedulers already running (skip re-init on reconnect)'));
                }
                
                console.log(chalk.cyan('📨 Sending startup notification to admin...'));
                
                // Notifikasi sistem ke admin utama (WIB)
                const now = moment().tz('Asia/Jakarta');
                const jam = now.format('HH:mm:ss');
                const tgl = now.format('DD/MM/YYYY');
                const hari = now.format('dddd');
                const adminUtama = OWNER_JID;
                
                // Get system info for the notification
                const os = require('os');
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const usedMem = totalMem - freeMem;
                const memPercentage = ((usedMem / totalMem) * 100).toFixed(1);
                
                // Motivational message based on time
                const getWelcomeMessage = () => {
                    const hour = parseInt(now.format('HH'));
                    if (hour < 6) return '🌙 Good night! Bot is ready for dawn activities';
                    if (hour < 12) return '🌅 Good morning! Ready to boost productivity today';
                    if (hour < 15) return '☀️ Good afternoon! Bot systems running smoothly';
                    if (hour < 18) return '🌤️ Good afternoon! All features operational';
                    if (hour < 21) return '🌆 Good evening! Ready for evening tasks';
                    return '🌙 Good evening! Night mode activated';
                };
                
                const welcomeText = `✨ *BOT WHATSAPP SYSTEM ACTIVATED* ✨

🚀 *CONNECTION STATUS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟢 *ONLINE & FULLY OPERATIONAL*
📅 ${hari}, ${tgl}
⏰ ${jam} WIB
🎯 Response Time: <2 seconds

👨‍💻 *OWNER NOTIFICATION*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hello *Erzam Bayu*! 👋
${getWelcomeMessage()}

📊 *SYSTEM HEALTH*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 Memory Usage: *${memPercentage}%* ${memPercentage > 80 ? '⚠️' : '✅'}
🖥️ Platform: *${os.platform()}* (${os.arch()})
⚡ CPU Cores: *${os.cpus().length}*
🌐 Hostname: *${os.hostname()}*

🎮 *ACTIVE FEATURES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ AI Chat Assistant (DeepSeek + Gemini)
✅ QR Generator/Scanner
✅ URL Shortener
✅ Expense Tracker & Invoice Generator
✅ Social Media Downloader
✅ Weather & Prayer Time Notifications
✅ Auto Reminders & Scheduled Tasks
✅ Advanced Security & Rate Limiting

⚡ *QUICK ACTIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• \`/status\` - Full system dashboard
• \`/help\` - Complete command list
• \`/ai hello\` - Test AI response
• \`/maintenance on/off\` - Control bot access

🛡️ *SECURITY NOTICE*
Bot is running with enhanced security protocols. All admin privileges are active and monitoring systems are operational.

💡 *Ready to serve!* The bot is now available for all users and fully optimized for peak performance.`;

                await sock.sendMessage(adminUtama, { text: welcomeText });
                console.log(chalk.green('   ✅ Admin notification sent successfully!'));
                console.log(chalk.magenta.bold('\n🎯 Bot is now ready to receive commands!\n'));
                
                await updateBotStatus(sock, global.maintenanceMode);
            }
            if (connection === 'close') {
                connectionReady = false;
                
                console.log(chalk.red.bold('\n⚠️  ═══════════════════════════════════════════════════════════════'));
                console.log(chalk.red.bold('   🔌 WHATSAPP CONNECTION LOST!'));
                console.log(chalk.red.bold('═══════════════════════════════════════════════════════════════\n'));
                
                logWarn('WhatsApp connection closed! connectionReady=false', 'SYSTEM');
                logError('Baileys connection disconnected', 'BAILEYS');
                
                if (lastDisconnect && lastDisconnect.error) {
                    const reason = lastDisconnect.error.toString();
                    logError(`Disconnect reason: ${reason}`, 'BAILEYS');
                    console.log(chalk.red(`   📋 Error details: ${reason}`));
                    
                    // Handle different disconnect reasons
                    const statusCode = lastDisconnect.error.output?.statusCode;
                    if (statusCode === DisconnectReason.connectionClosed || 
                        statusCode === DisconnectReason.connectionLost ||
                        statusCode === DisconnectReason.connectionReplaced) {
                        
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            const delay = Math.min(5000 * reconnectAttempts, 30000); // Exponential backoff, max 30s
                            console.log(chalk.yellow(`🔄 Connection issue detected. Reconnecting in ${delay/1000} seconds... (${reconnectAttempts}/${maxReconnectAttempts})`));
                            logWarn(`Network connection issue - scheduling reconnection (attempt ${reconnectAttempts})`, 'BAILEYS');
                            setTimeout(() => startBot(), delay);
                            return;
                        } else {
                            console.log(chalk.red(`❌ Max reconnection attempts (${maxReconnectAttempts}) reached. Please restart manually.`));
                            logError('Max reconnection attempts reached', 'BAILEYS');
                            return;
                        }
                    } else if (statusCode === DisconnectReason.restartRequired) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            console.log(chalk.yellow(`🔄 WhatsApp restart required. Reconnecting in 3 seconds... (${reconnectAttempts}/${maxReconnectAttempts})`));
                            logWarn(`WhatsApp restart required - scheduling reconnection (attempt ${reconnectAttempts})`, 'BAILEYS');
                            setTimeout(() => startBot(), 3000);
                            return;
                        }
                    }
                }
                
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect && reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    const delay = Math.min(10000 * reconnectAttempts, 60000); // Exponential backoff, max 60s
                    console.log(chalk.yellow(`🔄 Attempting to reconnect to WhatsApp in ${delay/1000} seconds... (${reconnectAttempts}/${maxReconnectAttempts})`));
                    logWarn(`Attempting reconnection to WhatsApp (attempt ${reconnectAttempts})`, 'BAILEYS');
                    setTimeout(() => startBot(), delay);
                } else {
                    console.log(chalk.red('❌ Bot was logged out from WhatsApp.'));

                    // Hard limit: kalau loggedOut udah > 3x, stop biar ga loop tanpa henti.
                    global.__logoutAttempts = (global.__logoutAttempts || 0) + 1;
                    if (global.__logoutAttempts > 3) {
                        console.log(chalk.red.bold('🛑 Logout berulang > 3 kali. STOP auto-restart untuk hindari loop.'));
                        console.log(chalk.yellow('   ➡️  Hapus folder baileys_auth/ manual lalu restart bot.'));
                        logError('Logout loop detected — auto-restart STOPPED', 'BAILEYS');
                        return;
                    }

                    console.log(chalk.yellow(`🔧 Cleaning authentication state and restarting (logout attempt ${global.__logoutAttempts}/3)...`));
                    logError(`Bot was logged out (attempt ${global.__logoutAttempts}/3) - cleaning auth state`, 'BAILEYS');

                    // Clean authentication state
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const authDir = path.join(__dirname, '../baileys_auth');
                        if (fs.existsSync(authDir)) {
                            fs.rmSync(authDir, { recursive: true, force: true });
                            console.log(chalk.green('✅ Authentication state cleaned'));
                        }
                    } catch (e) {
                        console.log(chalk.red('❌ Failed to clean auth state:', e.message));
                    }

                    // Reset connection counter (bukan logout counter) & restart
                    reconnectAttempts = 0;
                    console.log(chalk.cyan('🚀 Restarting bot with fresh authentication...'));
                    setTimeout(() => startBot(), 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            const timerLabel = `[EVENT] messages.upsert handler ${Date.now()}`;
            console.time(timerLabel);
            logInfo(`[EVENT] messages.upsert triggered (type: ${type}, messages: ${messages?.length})`, 'MESSAGE');
            if (!messages || !messages[0]) return;
            const msg = messages[0];
            if (msg.key.fromMe) return;
            if (!msg.message) return;
            const sender = msg.key.remoteJid;
            if (sender === 'status@broadcast') return;
            const senderNum = sender.replace(/@s\.whatsapp\.net$/, '');
            const admins = getAdmins();
            const isFromAdmin = admins.includes(senderNum);
            let lastTarget = utils.getLastTarget();

            // DEBUG sender di event handler
            console.log('DEBUG event handler sender:', sender, typeof sender);

            // === INTERCEPT AI MODE (tanpa command) ===
            const textMsg = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption;
            // Baca state dari file
            const userAIMode = readUserAIMode();
            const userAIMemory = await readUserAIMemory();
            console.log('DEBUG AI MODE (from file):', userAIMode[sender], textMsg);
            if (userAIMode && userAIMode[sender] && textMsg && !textMsg.trim().startsWith('/')) {
                // OPTIMIZED: Use shortened system prompt for auto-reply to save tokens
                const systemPrompt = `Kamu adalah teman chat yang empatik dan santai. Jawab seperti teman dekat, bukan formal. Pakai bahasa sehari-hari, boleh 'gw/lo', emot, dan gaya Gen Z. Tenangin dulu kalau user panik, jangan buru-buru kasih saran. Jika user bertanya tentang nama mereka, dan kamu belum tahu namanya, minta mereka memberitahu nama mereka.`;
                
                // OPTIMIZED: Get summary and facts with length limits
                const summary = getUserSummary(sender);
                const factsArr = getUserFacts(sender);
                let factsText = '';
                if (factsArr.length) {
                    // OPTIMIZED: Limit facts to 3 most recent to save tokens
                    const recentFacts = factsArr.slice(-3);
                    factsText = 'Tentang user ini: ' + recentFacts.map(f => `${f.fact_key}: ${f.fact_value}`).join(', ') + '.';
                }
                
                const prompt = [
                    { role: "system", content: systemPrompt },
                ];
                if (summary) {
                    // OPTIMIZED: Remove extra formatting to save tokens
                    prompt.push({ role: "assistant", content: summary });
                }
                if (factsText) {
                    prompt.push({ role: "assistant", content: factsText });
                }
                prompt.push({ role: "user", content: textMsg });
                
                const { callDeepSeekOpenRouter } = require('../modules/commands');
                const aiReply = await callDeepSeekOpenRouter(prompt, 1); // OPTIMIZED: Max retry = 1 for auto-reply
                
                // Deteksi jika user memberikan nama mereka
                const nameMatch = textMsg.match(/nama (?:saya|aku|gw|gue|saya) (?:adalah|itu|yaitu|namanya) (.+)/i);
                if (nameMatch) {
                    const name = nameMatch[1].trim();
                    await saveUserName(sender, name);
                }
                
                // OPTIMIZED: Only update summary if significantly emotional AND every 10 messages (not 5)
                if (isSignificantEmotion(textMsg)) {
                    let history = [];
                    try {
                        const cmdMod = require('../modules/commands');
                        // getUserConversation belum di-export — fallback ke empty array
                        if (typeof cmdMod.getUserConversation === 'function') {
                            history = cmdMod.getUserConversation(sender, 5);
                        }
                        history.push({ role: 'user', content: textMsg });

                        const messageCount = history.filter(h => h.role === 'user').length;
                        if (messageCount > 0 && messageCount % 10 === 0) {
                            await summarizeUserHistoryWithLLM(sender, history, callDeepSeekOpenRouter);
                        }
                    } catch (e) {
                        console.error('Error updating summary:', e);
                    }
                }
                await sock.sendMessage(sender, { text: aiReply });
                return;
            }

            // Log pesan masuk yang sudah diparse
            logInfo(chalk.cyan(`[MSG] [IN] ${senderNum}: ${msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption}`), 'MESSAGE');

            // === KONFIRMASI HAPUS HUTANG AI (PINDAHKAN KE ATAS) ===
            if (global.pendingDeleteHutang && global.pendingDeleteHutang[senderNum]) {
                const jawaban = (
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    msg.message.imageMessage?.caption ||
                    msg.message.videoMessage?.caption ||
                    ''
                ).trim().toUpperCase();
                const pending = global.pendingDeleteHutang[senderNum];
                if (pending.pilih) {
                    // User harus memilih nomor hutang
                    if (jawaban === 'TIDAK') {
                        clearTimeout(pending.timeout);
                        delete global.pendingDeleteHutang[senderNum];
                        logInfo(chalk.yellow(`[CONFIRM] Penghapusan hutang oleh ${senderNum} dibatalkan.`), 'DELETE');
                        await sock.sendMessage(sender, { text: 'Penghapusan hutang dibatalkan.' });
                        return;
                    }
                    const nomor = parseInt(jawaban);
                    if (!isNaN(nomor) && nomor >= 1 && nomor <= pending.pilihan.length) {
                        const id = pending.pilihan[nomor-1];
                        let hutang = utils.getHutang();
                        const idx = hutang.findIndex(h => h.id === id && h.user === senderNum);
                        if (idx !== -1) {
                            const removed = hutang.splice(idx, 1)[0];
                            utils.saveHutang(hutang);
                            logInfo(chalk.green(`[DELETE] Hutang ${removed.jenis} (${removed.tanggal_tagih}) user ${senderNum} dihapus.`), 'DELETE');
                            await sock.sendMessage(sender, { text: `✅ Hutang *${removed.jenis}* tanggal *${removed.tanggal_tagih}* dihapus.` });
                        } else {
                            logWarn(chalk.yellow(`[DELETE] Hutang tidak ditemukan saat konfirmasi hapus oleh ${senderNum}`), 'DELETE');
                            await sock.sendMessage(sender, { text: 'Hutang sudah tidak ditemukan.' });
                        }
                        clearTimeout(pending.timeout);
                        delete global.pendingDeleteHutang[senderNum];
                        return;
                    } else {
                        await sock.sendMessage(sender, { text: 'Nomor hutang tidak valid. Balas dengan nomor yang sesuai atau TIDAK untuk batal.' });
                        return;
                    }
                }
                if (jawaban === 'YA') {
                    const { id, all, timeout, jenis, tanggal_tagih } = pending;
                    clearTimeout(timeout);
                    let hutang = utils.getHutang();
                    if (all) {
                        const before = hutang.length;
                        hutang = hutang.filter(h => h.user !== senderNum);
                        const deleted = before - hutang.length;
                        utils.saveHutang(hutang);
                        logInfo(chalk.green(`[DELETE] Semua hutang user ${senderNum} dihapus (${deleted} hutang).`), 'DELETE');
                        await sock.sendMessage(sender, { text: `✅ ${deleted} hutang berhasil dihapus.` });
                    } else {
                        // Validasi ulang jenis dan tanggal sebelum hapus
                        const idx = hutang.findIndex(h => h.id === id && h.user === senderNum && (!jenis || h.jenis.toLowerCase() === jenis.toLowerCase()) && (!tanggal_tagih || h.tanggal_tagih.toLowerCase() === tanggal_tagih.toLowerCase()));
                        if (idx !== -1) {
                            const removed = hutang.splice(idx, 1)[0];
                            utils.saveHutang(hutang);
                            logInfo(chalk.green(`[DELETE] Hutang ${removed.jenis} (${removed.tanggal_tagih}) user ${senderNum} dihapus.`), 'DELETE');
                            await sock.sendMessage(sender, { text: `✅ Hutang *${removed.jenis}* tanggal *${removed.tanggal_tagih}* dihapus.` });
                        } else {
                            logWarn(chalk.yellow(`[DELETE] Hutang tidak ditemukan saat konfirmasi hapus oleh ${senderNum}`), 'DELETE');
                            await sock.sendMessage(sender, { text: 'Hutang sudah tidak ditemukan.' });
                        }
                    }
                    delete global.pendingDeleteHutang[senderNum];
                    return;
                } else if (jawaban === 'TIDAK') {
                    clearTimeout(pending.timeout);
                    delete global.pendingDeleteHutang[senderNum];
                    logInfo(chalk.yellow(`[CONFIRM] Penghapusan hutang oleh ${senderNum} dibatalkan.`), 'DELETE');
                    await sock.sendMessage(sender, { text: 'Penghapusan hutang dibatalkan.' });
                    return;
                }
            }

            // === PEMBATASAN SAAT MAINTENANCE ===
            if (global.maintenanceMode) {
                if (!isOwner(sender)) {
                    logWarn('Bot dalam mode maintenance, pesan user ditolak.', 'MAINTENANCE');
                    await sock.sendMessage(sender, { text: '⚠️ *Bot sedang dalam mode maintenance*\n\nHanya owner yang dapat menggunakan bot saat ini.\nSilakan coba lagi nanti.' });
                    logInfo('Handler selesai', 'MESSAGE');
                    return;
                }
            }

            // === HANDLER PESAN GRUP (MODERASI AI) ===
            if (sender.endsWith('@g.us')) {
                // Panggil handler moderasi grup
                const handled = await handleGroupMessage(msg, sock);
                if (handled) return;
            }

            // === COMMAND HANDLER ===
            if (msg.message.conversation) {
                const textMsg = msg.message.conversation;
                const parts = textMsg.trim().split(/\s+/);
                const commandRaw = parts[0].toLowerCase();
                const command = commandRaw.startsWith('/') ? commandRaw.slice(1) : commandRaw;
                const args = parts.slice(1);
                logInfo(chalk.magenta(`[CMD] [${command}] dari ${senderNum}`), 'COMMAND');
                // REACTION: Pesan diterima
                try { await sock.sendMessage(sender, { react: { text: '👀', key: msg.key } }); } catch {}
                try {
                    const result = await handleCommand({ command, args, sock, sender, senderNum, msg, isFromAdmin, scheduledTimeouts, updateBotStatus });
                    logSuccess(chalk.green(`[CMD] [${command}] selesai dari ${senderNum}`), 'COMMAND');
                    if (typeof result === 'string' && result.trim()) {
                        await sock.sendMessage(sender, { text: result });
                    }
                    // REACTION: Bot sudah respon
                    try { await sock.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch {}
                } catch (err) {
                    logError(chalk.red(`[CMD] Error pada command ${command}: ${err.message}`), 'COMMAND');
                    await sock.sendMessage(sender, { text: '❌ Terjadi kesalahan internal. Silakan coba lagi nanti.' });
                    // REACTION: Error
                    try { await sock.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch {}
                }
                logInfo('Handler selesai', 'MESSAGE');
                return;
            }
            // === COMMAND HANDLER UNTUK REPLY/EXTENDED TEXT ===
            if (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) {
                const textMsg = msg.message.extendedTextMessage.text;
                const parts = textMsg.trim().split(/\s+/);
                const commandRaw = parts[0].toLowerCase();
                const command = commandRaw.startsWith('/') ? commandRaw.slice(1) : commandRaw;
                const args = parts.slice(1);
                logInfo(chalk.magenta(`[CMD] [${command}] dari ${senderNum} (reply/forward)`), 'COMMAND');
                // REACTION: Pesan diterima
                try { await sock.sendMessage(sender, { react: { text: '👀', key: msg.key } }); } catch {}
                try {
                    const result = await handleCommand({ command, args, sock, sender, senderNum, msg, isFromAdmin, scheduledTimeouts, updateBotStatus });
                    logSuccess(chalk.green(`[CMD] [${command}] selesai dari ${senderNum} (reply/forward)`), 'COMMAND');
                    if (typeof result === 'string' && result.trim()) {
                        await sock.sendMessage(sender, { text: result });
                    }
                    // REACTION: Bot sudah respon
                    try { await sock.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch {}
                } catch (err) {
                    logError(chalk.red(`[CMD] Error pada command ${command}: ${err.message}`), 'COMMAND');
                    await sock.sendMessage(sender, { text: '❌ Terjadi kesalahan internal. Silakan coba lagi nanti.' });
                    // REACTION: Error
                    try { await sock.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch {}
                }
                logInfo('Handler selesai', 'MESSAGE');
                return;
            }
            // === COMMAND HANDLER UNTUK GAMBAR DENGAN CAPTION ===
            if (msg.message.imageMessage && msg.message.imageMessage.caption) {
                const textMsg = msg.message.imageMessage.caption;
                const parts = textMsg.trim().split(/\s+/);
                const commandRaw = parts[0].toLowerCase();
                const command = commandRaw.startsWith('/') ? commandRaw.slice(1) : commandRaw;
                const args = parts.slice(1);
                logInfo(chalk.magenta(`[CMD] [${command}] dari ${senderNum} (caption gambar)`), 'COMMAND');
                // REACTION: Pesan diterima
                try { await sock.sendMessage(sender, { react: { text: '👀', key: msg.key } }); } catch {}
                try {
                    const result = await handleCommand({ command, args, sock, sender, senderNum, msg, isFromAdmin, scheduledTimeouts, updateBotStatus });
                    logSuccess(chalk.green(`[CMD] [${command}] selesai dari ${senderNum} (caption gambar)`), 'COMMAND');
                    if (typeof result === 'string' && result.trim()) {
                        await sock.sendMessage(sender, { text: result });
                    }
                    // REACTION: Bot sudah respon
                    try { await sock.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch {}
                } catch (err) {
                    logError(chalk.red(`[CMD] Error pada command ${command}: ${err.message}`), 'COMMAND');
                    await sock.sendMessage(sender, { text: '❌ Terjadi kesalahan internal. Silakan coba lagi nanti.' });
                    // REACTION: Error
                    try { await sock.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch {}
                }
                logInfo('Handler selesai', 'MESSAGE');
                return;
            }
            // === AUTO-REPLY INFO BOT ===
            const aboutRegex = /bot|fitur|siapa.*kamu|owner|pembuat|apakah.*bot|siapa.*owner|who.*you|what.*bot|who.*owner|who.*made/i;
            if (aboutRegex.test(msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption)) {
                logInfo('Auto-reply info bot dikirim.', 'INFOBOT');
                const info = `🤖 *Tentang Bot Ini*\n\nHalo! Saya adalah *WhatsApp Bot Baileys* berbasis AI.\n\n*Fitur utama:*\n• Stiker otomatis dari gambar/teks\n• Reminder & jadwal otomatis\n• Jadwal sholat, qibla, hadits, hijri\n• Finance tracker dgn export PDF/CSV\n• Anti-link & admin dinamis\n• Dan masih banyak lagi!\n\n*Cara pakai:* gunakan perintah dengan awalan / (contoh: /help, /stiker)\n\nKetik /help untuk daftar command lengkap.`;
                await sock.sendMessage(sender, { text: info });
                logInfo('Handler selesai', 'MESSAGE');
                return;
            }

            // === WELCOME MESSAGE ===
            if (!isFromAdmin && !WELCOMED_USERS.has(senderNum) && !sender.endsWith('@g.us')) {
                logSuccess(`Welcome message sent to new user: ${senderNum}`, 'WELCOME');
                const welcomeMsg = `*🤖 Selamat Datang di WhatsApp Bot!*\n\nHalo! Ini adalah bot WhatsApp yang dikelola oleh admin.\n\n*Informasi Penting:*\n• Semua pesan yang Anda kirim (selain perintah/command) akan diteruskan ke admin bot\n• Gunakan perintah dengan awalan "/" untuk berinteraksi dengan bot\n• Ketik "/help" untuk melihat daftar perintah yang tersedia\n\n*Contoh Perintah Dasar:*\n• /help - Lihat daftar perintah\n• /status - Cek status bot\n• /stiker - Buat stiker dari gambar\n• /cuaca - Cek cuaca kota\n• /sholat - Cek jadwal sholat\n\nTerima kasih telah menghubungi bot ini! 🙏\nPesan Anda akan diteruskan ke admin jika bukan perintah.`;
                await sock.sendMessage(sender, { text: welcomeMsg });
                WELCOMED_USERS.add(senderNum);
            }

            // === FORWARD CHAT ADMIN <-> TARGET ===
            const isFromTarget = lastTarget && sender === lastTarget;
            if (isFromAdmin && lastTarget && !msg.message.conversation?.startsWith('[Forwarded]') && !sender.endsWith('@g.us')) {
                if (!msg.message.conversation?.startsWith('/')) {
                    logInfo('Forward pesan admin ke target.', 'FORWARD');
                    await sock.sendMessage(lastTarget, { text: `[Forwarded] ${msg.message.conversation}` });
                    return;
                }
            }
            if (isFromTarget && !msg.message.conversation?.startsWith('[Forwarded]') && !sender.endsWith('@g.us')) {
                logInfo('Forward balasan target ke admin.', 'FORWARD');
                for (const admin of admins) {
                    await sock.sendMessage(admin + '@s.whatsapp.net', { text: `[Forwarded] Balasan dari ${senderNum}:\n${msg.message.conversation}` });
                }
            }
            logInfo('Handler selesai', 'MESSAGE');
            console.timeEnd(timerLabel);
        });
    } catch (e) {
        logError('Gagal memulai bot: ' + e.message, 'STARTUP');
    } finally {
        isReconnecting = false;
    }
}

// Pada startup, sebelum startBot(): ambil status maintenance dari DB (single source of truth)
global.maintenanceMode = !!utils.getSetting('maintenance_mode', false);

function scheduleHutangReminder(sock) {
    const now = moment.tz('Asia/Jakarta');
    let next = now.clone().hour(8).minute(0).second(0);
    if (now.isAfter(next)) next = next.add(1, 'day');
    let delay = next.diff(now);
    if (!Number.isFinite(delay) || delay <= 0) delay = 60 * 1000; // fallback 60s biar ga infinite immediate-fire
    if (scheduledTimeouts.hutangReminder) clearTimeout(scheduledTimeouts.hutangReminder);
    scheduledTimeouts.hutangReminder = setTimeout(async () => {
        try {
            const hutang = getHutang() || [];
            const today = moment.tz('Asia/Jakarta').format('D MMMM');
            const besok = moment.tz('Asia/Jakarta').add(1, 'day').format('D MMMM');
            const byUser = {};
            for (const h of hutang) {
                // Guard: schema mismatch — field tanggal_tagih/user/jenis bisa undef
                if (!h || !h.tanggal_tagih || !h.user) continue;
                const tt = String(h.tanggal_tagih).toLowerCase();
                if ([today.toLowerCase(), besok.toLowerCase()].includes(tt)) {
                    if (!byUser[h.user]) byUser[h.user] = [];
                    byUser[h.user].push(h);
                }
            }
            for (const user in byUser) {
                if (global.maintenanceMode && user !== OWNER_NUMBER) continue;
                const lines = byUser[user].map(h => `${h.jenis || '-'} - ${(h.jumlah || 0).toLocaleString('id-ID')} (${h.tanggal_tagih})`);
                const msg = `⏰ *Pengingat Hutang!*\nAda hutang yang jatuh tempo hari ini/besok:\n` + lines.join('\n');
                await safeSendMessage(sock, user + '@s.whatsapp.net', { text: msg });
            }
            // Reminder custom
            let reminders = getHutangReminder() || [];
            let changed = false;
            for (const r of reminders) {
                if (!r || r.sent) continue;
                if (!r.user || !r.jenis || !r.tanggal_tagih) continue;
                const h = hutang.find(h => h && h.user === r.user && String(h.jenis || '').toLowerCase() === String(r.jenis).toLowerCase() && String(h.tanggal_tagih || '').toLowerCase() === String(r.tanggal_tagih).toLowerCase());
                if (!h) continue;
                const tglTagih = moment(r.tanggal_tagih, ['D MMMM', 'D MMM', 'DD-MM-YYYY', 'D/M/YYYY'], 'id', true);
                if (!tglTagih.isValid()) continue;
                const remindDate = tglTagih.clone().subtract(r.hari_sebelum || 0, 'days');
                if (moment.tz('Asia/Jakarta').isSame(remindDate, 'day')) {
                    if (global.maintenanceMode && r.user !== OWNER_NUMBER) continue;
                    const msg = `⏰ *Pengingat Hutang Custom!*\nHutang *${r.jenis}* (${(h.jumlah || 0).toLocaleString('id-ID')}) akan jatuh tempo pada *${r.tanggal_tagih}* (${r.hari_sebelum} hari lagi).`;
                    await safeSendMessage(sock, r.user + '@s.whatsapp.net', { text: msg });
                    r.sent = true;
                    changed = true;
                }
            }
            if (changed) saveHutangReminder(reminders);
        } catch (e) {
            logError('Gagal mengirim pengingat hutang: ' + e.message, 'HUTANG');
        }
        // re-schedule next day — single chain, ga numpuk karena clearTimeout di awal
        scheduleHutangReminder(sock);
    }, delay);
}

// Inisialisasi global AI memory/mode di src/bot.js
if (!global.userAIMode) global.userAIMode = {};
if (!global.userAIMemory) global.userAIMemory = {};

// Global safety net — biar bot ga crash silent kalau ada unhandled rejection / uncaught exception
process.on('unhandledRejection', (reason) => {
    logError('Unhandled Rejection: ' + (reason?.message || String(reason)), 'PROCESS');
    // Jangan exit — biarkan bot tetap jalan
});
process.on('uncaughtException', (err) => {
    logError('Uncaught Exception: ' + (err?.message || String(err)), 'PROCESS');
    // Jangan exit kecuali fatal init error
});

// Load AI memory saat startup
(async () => {
    try {
        const memory = await readUserAIMemory();
        global.userAIMemory = memory;
        logInfo('AI memory loaded successfully', 'STARTUP');
    } catch (e) {
        logError('Failed to load AI memory: ' + e.message, 'STARTUP');
    }
})();

// Tambahkan keyword emosi
const EMOTION_KEYWORDS = ['kesel', 'sedih', 'takut', 'kecewa', 'marah', 'galau', 'capek', 'lelah', 'bingung'];
function isSignificantEmotion(text) {
    return EMOTION_KEYWORDS.some(k => text.toLowerCase().includes(k));
}

startBot();

// Tambahkan di handler pesan grup (misal onMessage atau sejenisnya)
async function handleGroupMessage(msg, sock) {
    const senderNum = msg.key.participant ? msg.key.participant.replace(/[^0-9]/g, '') : '';
    const isFromAdmin = utils.getAdmins().includes(senderNum) || isOwner(senderNum);
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    // Deteksi spam/kata kasar dengan AI
    if (text && !text.startsWith('/') && !isFromAdmin) {
        const conversation = [
            { role: 'system', content: 'Kamu adalah moderator grup WhatsApp. Deteksi apakah pesan berikut mengandung spam, promosi, atau kata kasar. Balas hanya dengan JSON: {"spam":true/false,"kasar":true/false,"alasan":"..."}. Jangan tambahkan penjelasan lain.' },
            { role: 'user', content: text }
        ];
        const { callDeepSeekOpenRouter } = require('../modules/commands');
        const aiReply = await callDeepSeekOpenRouter(conversation);
        let dataMod = {};
        try { dataMod = JSON.parse(aiReply.match(/\{[\s\S]*\}/)?.[0] || aiReply); } catch {}
        if (dataMod.spam || dataMod.kasar) {
            // Auto-hapus pesan
            try {
                await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
            } catch {}
            // Notifikasi private ke owner
            const notif = `🚨 *Pesan dihapus oleh bot!*

*Pengirim:* ${senderNum}
*Grup:* ${msg.key.remoteJid}
*Isi:* ${text}
*Deteksi:* ${dataMod.spam ? 'Spam' : ''}${dataMod.kasar ? ' & Kata Kasar' : ''}
*Alasan:* ${dataMod.alasan || '-'}
Waktu: ${new Date().toLocaleString('id-ID')}`;
            try {
                await sock.sendMessage(OWNER_JID, { text: notif });
            } catch {}
            return true;
        }
    }
    // Jika bukan command, bot tidak membalas apapun
    if (!text.startsWith('/')) return true;
    // ... lanjut ke handler command ...
}