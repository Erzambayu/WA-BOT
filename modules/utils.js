const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const moment = require('moment-timezone');
const Database = require('better-sqlite3');

// Path konstanta — semua file data dipusatkan di config/ & data/
const CONFIG_DIR = path.join(__dirname, '../config');
const DATA_DIR = path.join(__dirname, '../data');
const LOGS_DIR = path.join(__dirname, '../logs');

// Pastikan direktori penting selalu ada
for (const dir of [CONFIG_DIR, DATA_DIR, LOGS_DIR]) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* noop */ }
}

const ADMIN_FILE = path.join(CONFIG_DIR, 'admins.json');
const BIRTHDAY_FILE = path.join(CONFIG_DIR, 'birthdays.json');
const SCHEDULED_FILE = path.join(CONFIG_DIR, 'scheduled_messages.json');
const DEFAULT_SHOLAT_CITY_FILE = path.join(CONFIG_DIR, 'sholat_city.json');
const LOG_FILE = path.join(LOGS_DIR, 'bot.log');
const LAST_TARGET_FILE = path.join(CONFIG_DIR, 'last_target.json');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const BOT_DB_PATH = path.join(CONFIG_DIR, 'bot_data.db');

// Single shared SQLite connection (better-sqlite3, sync, WAL mode)
const botDb = new Database(BOT_DB_PATH);
botDb.pragma('journal_mode = WAL');
botDb.pragma('foreign_keys = ON');
const hutangDb = botDb; // alias kompat lama

// ====== CACHE & ERROR HANDLER ======
// Simple in-memory cache (key: string, value: { data, expires })
const _apiCache = {};

function getCache(key) {
    const entry = _apiCache[key];
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        delete _apiCache[key];
        return null;
    }
    return entry.data;
}

function setCache(key, data, ttlMs = 300000) { // default 5 menit
    _apiCache[key] = {
        data,
        expires: Date.now() + ttlMs
    };
}

// Centralized error handler for API
async function handleApiError(error, context, sock = null, adminJid = null) {
    logError(error.message || error, context);
    // Notifikasi ke admin jika error fatal dan sock/adminJid tersedia
    if (sock && adminJid) {
        try {
            await sock.sendMessage(adminJid, { text: `❗ *API Error* (${context}):\n${error.message || error}` });
        } catch (e) {
            logError('Gagal kirim notifikasi error ke admin', context);
        }
    }
}

// Helper: backup file sebelum overwrite
function backupFile(filepath) {
    if (fs.existsSync(filepath)) {
        const backupPath = filepath + '.' + Date.now() + '.bak';
        fs.copyFileSync(filepath, backupPath);
    }
}

// Helper: validasi admins.json (array of string)
function validateAdmins(data) {
    return Array.isArray(data) && data.every(x => typeof x === 'string');
}

// Helper: validasi birthdays.json (array of object)
function validateBirthdays(data) {
    // Perbaikan: validasi agar bisa handle field 'number'/'nomor' dan 'date'/'tanggal'
    return Array.isArray(data) && data.every(x =>
        typeof x === 'object' &&
        ((x.number || x.nomor) && (x.date || x.tanggal))
    );
}

// Helper: format tanggal/waktu lokal
function formatDate(date) {
    return moment(date).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
}
function formatTime(date) {
    return moment(date).tz('Asia/Jakarta').format('HH:mm:ss');
}

// Helper: pesan error standar
function errorMsg(msg) {
    return `❌ ${msg}`;
}

// Logging
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
    if (shouldLog('info')) console.log(chalk.cyanBright(`[INFO]${context ? '['+context+']' : ''} [${new Date().toLocaleString()}] ${msg}`));
    logToFile('info', msg, context);
}
function logError(msg, context) {
    if (shouldLog('error')) console.error(chalk.bgRed.white.bold(`[ERROR]${context ? '['+context+']' : ''} [${new Date().toLocaleString()}] ${msg}`));
    logToFile('error', msg, context);
}
function logWarn(msg, context) {
    if (shouldLog('warn')) console.warn(chalk.yellow.bold(`[WARN]${context ? '['+context+']' : ''} [${new Date().toLocaleString()}] ${msg}`));
    logToFile('warn', msg, context);
}
function logSuccess(msg, context) {
    if (shouldLog('success')) console.log(chalk.green.bold(`[SUCCESS]${context ? '['+context+']' : ''} [${new Date().toLocaleString()}] ${msg}`));
    logToFile('success', msg, context);
}

// Database helper functions
function getSetting(key, defaultValue = null) {
    try {
        const result = botDb.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
        return result ? JSON.parse(result.value) : defaultValue;
    } catch (error) {
        logError(`Error getting setting ${key}: ${error.message}`, 'DB');
        return defaultValue;
    }
}

function setSetting(key, value) {
    try {
        botDb.prepare(`
            INSERT OR REPLACE INTO bot_settings (key, value, updated_at)
            VALUES (?, ?, ?)
        `).run(key, JSON.stringify(value), Math.floor(Date.now() / 1000));
        return true;
    } catch (error) {
        logError(`Error setting ${key}: ${error.message}`, 'DB');
        return false;
    }
}

// Admins - Updated to use database
function getAdmins() {
    try {
        return botDb.prepare('SELECT number FROM admins').all().map(a => a.number);
    } catch (error) {
        logError(`Error getting admins: ${error.message}`, 'DB');
        return [];
    }
}

function saveAdmins(admins) {
    if (!Array.isArray(admins)) throw new Error('admins must be array of string');
    try {
        botDb.prepare('DELETE FROM admins').run();
        const insert = botDb.prepare('INSERT INTO admins (number) VALUES (?)');
        const tx = botDb.transaction((list) => { for (const n of list) insert.run(n); });
        tx(admins);
        return true;
    } catch (error) {
        logError(`Error saving admins: ${error.message}`, 'DB');
        return false;
    }
}

function isAdmin(jid) {
    const admins = getAdmins();
    return admins.includes(jid.replace(/@s\.whatsapp\.net$/, ''));
}

// Sholat city - Updated to use database settings
function getDefaultSholatCity() {
    return getSetting('default_sholat_city', 'jakarta');
}

function setDefaultSholatCity(city) {
    return setSetting('default_sholat_city', city);
}

// Birthdays - Updated to use database
function getBirthdays() {
    try {
        return botDb.prepare('SELECT * FROM birthdays').all();
    } catch (error) {
        logError(`Error getting birthdays: ${error.message}`, 'DB');
        return [];
    }
}

function saveBirthdays(bds) {
    if (!Array.isArray(bds)) throw new Error('birthdays must be array of object');
    try {
        botDb.prepare('DELETE FROM birthdays').run();
        const insert = botDb.prepare('INSERT INTO birthdays (number, name, date) VALUES (@number, @name, @date)');
        const tx = botDb.transaction((list) => { for (const b of list) insert.run(b); });
        tx(bds);
        return true;
    } catch (error) {
        logError(`Error saving birthdays: ${error.message}`, 'DB');
        return false;
    }
}

// Scheduled messages - Updated to use database
function getScheduledMessages() {
    try {
        return botDb.prepare('SELECT * FROM scheduled_messages WHERE is_active = 1').all();
    } catch (error) {
        logError(`Error getting scheduled messages: ${error.message}`, 'DB');
        return [];
    }
}

function saveScheduledMessages(list) {
    if (!Array.isArray(list)) throw new Error('scheduled messages must be array');
    try {
        // Clear existing messages
        botDb.prepare('DELETE FROM scheduled_messages').run();
        
        const insert = botDb.prepare(`
            INSERT INTO scheduled_messages (target, message, schedule_time, repeat_type, created_by)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const tx = botDb.transaction((messages) => {
            for (const msg of messages) {
                insert.run(
                    msg.target,
                    msg.message,
                    msg.schedule_time,
                    msg.repeat_type || null,
                    msg.created_by || 'system'
                );
            }
        });
        
        tx(list);
        return true;
    } catch (error) {
        logError(`Error saving scheduled messages: ${error.message}`, 'DB');
        return false;
    }
}

// Event lokal (custom event) - Updated to use database
function getEvents() {
    try {
        return botDb.prepare('SELECT * FROM events WHERE is_active = 1').all();
    } catch (error) {
        logError(`Error getting events: ${error.message}`, 'DB');
        return [];
    }
}

function saveEvents(list) {
    if (!Array.isArray(list)) throw new Error('events must be array');
    try {
        botDb.prepare('DELETE FROM events').run();
        
        const insert = botDb.prepare(`
            INSERT INTO events (title, description, date, reminder_time, created_by)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const tx = botDb.transaction((events) => {
            for (const event of events) {
                insert.run(
                    event.title,
                    event.description || '',
                    event.date,
                    event.reminder_time || null,
                    event.created_by || 'system'
                );
            }
        });
        
        tx(list);
        return true;
    } catch (error) {
        logError(`Error saving events: ${error.message}`, 'DB');
        return false;
    }
}

// Users management
function getUsers() {
    try {
        return botDb.prepare('SELECT * FROM users').all();
    } catch (e) {
        logError(`Error reading users table: ${e.message}`, 'USERS');
        return [];
    }
}

function saveUser(number, name = '') {
    try {
        let user = botDb.prepare('SELECT * FROM users WHERE number = ?').get(number);
        if (user) {
            botDb.prepare('UPDATE users SET name = ?, lastSeen = ? WHERE number = ?').run(name || user.name, Date.now(), number);
        } else {
            botDb.prepare('INSERT INTO users (number, name, firstSeen, lastSeen) VALUES (?, ?, ?, ?)').run(number, name, Date.now(), Date.now());
        }
    } catch (e) {
        logError(`Error saving user ${number}: ${e.message}`, 'USERS');
    }
}

// Groups management
function getGroups() {
    try {
        return botDb.prepare('SELECT * FROM groups').all();
    } catch (e) {
        logError(`Error reading groups table: ${e.message}`, 'GROUPS');
        return [];
    }
}

function saveGroup(groupId, groupName, participants = []) {
    try {
        let group = botDb.prepare('SELECT * FROM groups WHERE groupId = ?').get(groupId);
        if (group) {
            botDb.prepare('UPDATE groups SET name = ?, participants = ?, lastActivity = ? WHERE groupId = ?')
                .run(groupName, JSON.stringify(participants), Date.now(), groupId);
        } else {
            botDb.prepare('INSERT INTO groups (groupId, name, participants, joinedAt, lastActivity) VALUES (?, ?, ?, ?, ?)')
                .run(groupId, groupName, JSON.stringify(participants), Date.now(), Date.now());
        }
    } catch (e) {
        logError(`Error saving group ${groupId}: ${e.message}`, 'GROUPS');
    }
}

// Banned users - Updated to use blacklist table
function getBannedUsers() {
    try {
        return botDb.prepare('SELECT user_id FROM blacklist').all().map(b => b.user_id);
    } catch (e) {
        logError(`Error reading blacklist table: ${e.message}`, 'BLACKLIST');
        return [];
    }
}

function banUser(number, reason = '') {
    try {
        botDb.prepare(`
            INSERT OR REPLACE INTO blacklist (user_id, reason, blocked_by)
            VALUES (?, ?, ?)
        `).run(number, reason, 'admin');
        return true;
    } catch (e) {
        logError(`Error banning user ${number}: ${e.message}`, 'BLACKLIST');
        return false;
    }
}

function unbanUser(number) {
    try {
        const result = botDb.prepare('DELETE FROM blacklist WHERE user_id = ?').run(number);
        return result.changes > 0;
    } catch (e) {
        logError(`Error unbanning user ${number}: ${e.message}`, 'BLACKLIST');
        return false;
    }
}

// Logs
function getLogs(count = 10) {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = content.trim().split('\n');
        
        // Return last 'count' lines
        return lines.slice(-count).map(line => {
            const match = line.match(/^\[(\w+)\](?:\[([^\]]+)\])?\[([^\]]+)\] (.+)$/);
            if (match) {
                return {
                    level: match[1],
                    context: match[2] || '',
                    timestamp: match[3],
                    message: match[4]
                };
            }
            return { level: 'UNKNOWN', context: '', timestamp: '', message: line };
        });
    } catch (e) {
        logError(`Error reading logs: ${e.message}`, 'LOGS');
        return [];
    }
}

// Last target - Updated to use database settings
function getLastTarget() {
    return getSetting('last_target', { type: '', target: '' });
}

function setLastTarget(target) {
    return setSetting('last_target', target);
}

// Hutang functions (keep existing as they already use database)
function getHutang() {
    try {
        return botDb.prepare('SELECT * FROM hutang ORDER BY tanggal_dibuat DESC').all();
    } catch (e) {
        logError(`Error reading hutang: ${e.message}`, 'HUTANG');
        return [];
    }
}

function saveHutang(list) {
    if (!Array.isArray(list)) throw new Error('hutang must be array');
    try {
        botDb.prepare('DELETE FROM hutang').run();
        const insert = botDb.prepare(`
            INSERT INTO hutang (id, nama_penghutang, nomor_hp, jumlah, keterangan, tanggal_dibuat, status, tanggal_jatuh_tempo)
            VALUES (@id, @nama_penghutang, @nomor_hp, @jumlah, @keterangan, @tanggal_dibuat, @status, @tanggal_jatuh_tempo)
        `);
        const tx = botDb.transaction((hutangList) => { for (const h of hutangList) insert.run(h); });
        tx(list);
        return true;
    } catch (e) {
        logError(`Error saving hutang: ${e.message}`, 'HUTANG');
        return false;
    }
}

function generateHutangId(list) {
    return Date.now().toString();
}

function getHutangReminder() {
    return getSetting('hutang_reminder', []);
}

function saveHutangReminder(list) {
    return setSetting('hutang_reminder', list);
}

// URL Shortener - Updated to use database
function getShortUrls() {
    try {
        return botDb.prepare('SELECT * FROM short_urls').all().map(url => ({
            original: url.original_url,
            short: url.short_code,
            created: url.created_at,
            clicks: url.clicks
        }));
    } catch (error) {
        logError(`Error getting short URLs: ${error.message}`, 'URL');
        return [];
    }
}

function saveShortUrls(urls) {
    if (!Array.isArray(urls)) throw new Error('URLs must be array');
    try {
        botDb.prepare('DELETE FROM short_urls').run();
        
        const insert = botDb.prepare(`
            INSERT INTO short_urls (original_url, short_code, created_at, clicks)
            VALUES (?, ?, ?, ?)
        `);
        
        const tx = botDb.transaction((urlList) => {
            for (const url of urlList) {
                insert.run(
                    url.original,
                    url.short,
                    url.created,
                    url.clicks || 0
                );
            }
        });
        
        tx(urls);
        return true;
    } catch (error) {
        logError(`Error saving short URLs: ${error.message}`, 'URL');
        return false;
    }
}

async function shortenUrl(originalUrl) {
    try {
        // Generate short code
        const shortCode = Math.random().toString(36).substring(2, 8);
        
        // Insert into database
        botDb.prepare(`
            INSERT INTO short_urls (original_url, short_code, created_at, clicks)
            VALUES (?, ?, ?, ?)
        `).run(originalUrl, shortCode, new Date().toISOString(), 0);
        
        return shortCode;
    } catch (error) {
        logError(`Error shortening URL: ${error.message}`, 'URL');
        throw error;
    }
}

// Expenses - Updated to use database
function getExpenses(userId = null) {
    try {
        if (userId) {
            return botDb.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY timestamp DESC').all(userId);
        }
        return botDb.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all();
    } catch (error) {
        logError(`Error getting expenses: ${error.message}`, 'EXPENSES');
        return [];
    }
}

function saveExpenses(expenses) {
    if (!Array.isArray(expenses)) throw new Error('expenses must be array');
    try {
        botDb.prepare('DELETE FROM expenses').run();
        
        const insert = botDb.prepare(`
            INSERT INTO expenses (id, user_id, category, amount, description, date, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        const tx = botDb.transaction((expenseList) => {
            for (const expense of expenseList) {
                insert.run(
                    expense.id,
                    expense.userId || expense.user_id,
                    expense.category,
                    expense.amount,
                    expense.description || '',
                    expense.date,
                    expense.timestamp
                );
            }
        });
        
        tx(expenses);
        return true;
    } catch (error) {
        logError(`Error saving expenses: ${error.message}`, 'EXPENSES');
        return false;
    }
}

function addExpense(userId, category, amount, description) {
    try {
        const id = Date.now().toString();
        const now = new Date();
        const date = now.toISOString().split('T')[0];

        botDb.prepare(`
            INSERT INTO expenses (id, user_id, category, amount, description, date, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, userId, category, amount, description || '', date, Date.now());

        return { id, user_id: userId, category, amount, description: description || '', date, timestamp: Date.now() };
    } catch (error) {
        logError(`Error adding expense: ${error.message}`, 'EXPENSES');
        return null;
    }
}

/**
 * Filter expense list berdasarkan periode: week | month | year | all
 */
function filterExpensesByPeriod(expenses, period = 'all') {
    if (!Array.isArray(expenses)) return [];
    if (period === 'all') return expenses;
    const now = Date.now();
    let cutoff = 0;
    if (period === 'week') cutoff = now - 7 * 86400 * 1000;
    else if (period === 'month') cutoff = now - 30 * 86400 * 1000;
    else if (period === 'year') cutoff = now - 365 * 86400 * 1000;
    else return expenses;
    return expenses.filter(e => Number(e.timestamp || 0) >= cutoff);
}

function getExpenseReport(userId, period = 'month') {
    try {
        let dateFilter = '';
        const now = new Date();
        
        switch (period) {
            case 'week':
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                dateFilter = `AND date >= '${weekAgo.toISOString().split('T')[0]}'`;
                break;
            case 'month':
                const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1);
                dateFilter = `AND date >= '${monthAgo.toISOString().split('T')[0]}'`;
                break;
            case 'year':
                const yearAgo = new Date(now.getFullYear(), 0, 1);
                dateFilter = `AND date >= '${yearAgo.toISOString().split('T')[0]}'`;
                break;
        }
        
        const expenses = botDb.prepare(`
            SELECT category, SUM(amount) as total, COUNT(*) as count
            FROM expenses 
            WHERE user_id = ? ${dateFilter}
            GROUP BY category
            ORDER BY total DESC
        `).all(userId);
        
        const totalAmount = expenses.reduce((sum, exp) => sum + exp.total, 0);
        
        return {
            period,
            totalAmount,
            categoryBreakdown: expenses,
            transactionCount: expenses.reduce((sum, exp) => sum + exp.count, 0)
        };
    } catch (error) {
        logError(`Error generating expense report: ${error.message}`, 'EXPENSES');
        return null;
    }
}

// Invoices - Updated to use database
function getInvoices(userId = null) {
    try {
        if (userId) {
            return botDb.prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY timestamp DESC').all(userId)
                .map(invoice => ({
                    ...invoice,
                    items: JSON.parse(invoice.items)
                }));
        }
        return botDb.prepare('SELECT * FROM invoices ORDER BY timestamp DESC').all()
            .map(invoice => ({
                ...invoice,
                items: JSON.parse(invoice.items)
            }));
    } catch (error) {
        logError(`Error getting invoices: ${error.message}`, 'INVOICES');
        return [];
    }
}

function saveInvoices(invoices) {
    if (!Array.isArray(invoices)) throw new Error('invoices must be array');
    try {
        botDb.prepare('DELETE FROM invoices').run();
        
        const insert = botDb.prepare(`
            INSERT INTO invoices (id, user_id, invoice_number, customer, items, total, notes, date, status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const tx = botDb.transaction((invoiceList) => {
            for (const invoice of invoiceList) {
                insert.run(
                    invoice.id,
                    invoice.userId || invoice.user_id,
                    invoice.invoiceNumber || invoice.invoice_number,
                    invoice.customer,
                    JSON.stringify(invoice.items),
                    invoice.total,
                    invoice.notes || '',
                    invoice.date,
                    invoice.status || 'draft',
                    invoice.timestamp
                );
            }
        });
        
        tx(invoices);
        return true;
    } catch (error) {
        logError(`Error saving invoices: ${error.message}`, 'INVOICES');
        return false;
    }
}

function generateInvoice(userId, customer, items, notes = '') {
    try {
        const id = Date.now().toString();
        const invoiceNumber = `INV-${Date.now()}`;
        const total = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        const date = new Date().toLocaleDateString('id-ID');
        
        botDb.prepare(`
            INSERT INTO invoices (id, user_id, invoice_number, customer, items, total, notes, date, status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, userId, invoiceNumber, customer, JSON.stringify(items), total, notes, date, 'draft', Date.now());
        
        return {
            id,
            invoiceNumber,
            customer,
            items,
            total,
            notes,
            date,
            status: 'draft'
        };
    } catch (error) {
        logError(`Error generating invoice: ${error.message}`, 'INVOICES');
        return null;
    }
}

// ===== USER MEMORY SUMMARY (EMOTIONAL CONTEXT) =====
const USER_MEMORY_TABLE = `CREATE TABLE IF NOT EXISTS user_memory_summary (
  user_id TEXT PRIMARY KEY,
  recent_summary TEXT,
  last_updated TEXT
)`;

const sessionCache = new Map(); // key: user_id, value: { summary, lastActive }
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 menit

function getUserSummary(user_id) {
  const now = Date.now();
  if (sessionCache.has(user_id)) {
    const { summary, lastActive } = sessionCache.get(user_id);
    if (now - lastActive < SESSION_TIMEOUT) return summary;
    sessionCache.delete(user_id);
  }
  try {
    const row = botDb.prepare('SELECT recent_summary FROM user_memory_summary WHERE user_id = ?').get(user_id);
    if (row) {
      sessionCache.set(user_id, { summary: row.recent_summary, lastActive: now });
      return row.recent_summary;
    }
  } catch (error) {
    logError(`Error getting user summary: ${error.message}`, 'USER_SUMMARY');
  }
  return null;
}

function saveUserSummary(user_id, summary) {
  const now = new Date().toISOString();
  try {
    botDb.prepare(`
      INSERT INTO user_memory_summary (user_id, recent_summary, last_updated)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET recent_summary = excluded.recent_summary, last_updated = excluded.last_updated
    `).run(user_id, summary, now);
    sessionCache.set(user_id, { summary, lastActive: Date.now() });
  } catch (error) {
    logError(`Error saving user summary: ${error.message}`, 'USER_SUMMARY');
  }
}

/**
 * Minta LLM (Deepseek) merangkum history chat user jadi summary emosional terbaru.
 * @param {string} user_id
 * @param {Array<{role: string, content: string}>} history
 * @param {function} callDeepSeekOpenRouter - fungsi untuk call LLM
 * @returns {Promise<string>} summary terbaru
 */
async function summarizeUserHistoryWithLLM(user_id, history, callDeepSeekOpenRouter) {
  // Prompt instruksi ringkas
  const systemPrompt = `Kamu adalah asisten AI yang bertugas merangkum kondisi emosional dan masalah utama user berdasarkan riwayat chat berikut. Buat ringkasan singkat (1-2 kalimat) tentang perasaan, masalah, atau kebutuhan emosional user. Jangan tambahkan saran, cukup ringkasan situasi dan emosi user. Format narasi, bukan bullet.`;
  const prompt = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10), // Kirim max 10 pesan terakhir (user+assistant)
    { role: 'user', content: 'Tolong ringkas kondisi emosional saya.' }
  ];
  let summary = '';
  try {
    summary = await callDeepSeekOpenRouter(prompt);
    // Ambil hanya 2 kalimat pertama jika terlalu panjang
    summary = String(summary).split(/[.!?]/).slice(0,2).join('. ').trim();
  } catch (e) {
    summary = '[Gagal merangkum history]';
  }
  if (summary) saveUserSummary(user_id, summary);
  return summary;
}

// ===== USER FACTS (LONG-TERM MEMORY) =====
function saveUserFact(user_id, key, value) {
  try {
    botDb.prepare(`
      INSERT INTO user_facts (user_id, fact_key, fact_value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, fact_key) DO UPDATE SET fact_value = excluded.fact_value, updated_at = excluded.updated_at
    `).run(user_id, key, value, new Date().toISOString());
  } catch (error) {
    logError(`Error saving user fact: ${error.message}`, 'USER_FACTS');
  }
}

function getUserFacts(user_id) {
  try {
    return botDb.prepare('SELECT fact_key, fact_value FROM user_facts WHERE user_id = ?').all(user_id);
  } catch (error) {
    logError(`Error getting user facts: ${error.message}`, 'USER_FACTS');
    return [];
  }
}

function removeUserFact(user_id, key) {
  try {
    botDb.prepare('DELETE FROM user_facts WHERE user_id = ? AND fact_key = ?').run(user_id, key);
  } catch (error) {
    logError(`Error removing user fact: ${error.message}`, 'USER_FACTS');
  }
}

// ===== PERSONAL MEMORY & JOURNAL =====

function getPersonalMemory(user_id) {
    try {
        return botDb.prepare('SELECT * FROM personal_memory WHERE user_id = ?').get(user_id) || null;
    } catch (e) {
        logError(`Error reading personal_memory: ${e.message}`, 'PERSONAL_MEMORY');
        return null;
    }
}

function savePersonalMemory(user_id, data = {}) {
    // data: { nama, kota, umur, pekerjaan, universitas, cerita }
    const now = new Date().toISOString();
    try {
        const old = getPersonalMemory(user_id) || {};
        const merged = { ...old, ...data };
        botDb.prepare(`INSERT INTO personal_memory (user_id, nama, kota, umur, pekerjaan, universitas, cerita, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET nama=excluded.nama, kota=excluded.kota, umur=excluded.umur, pekerjaan=excluded.pekerjaan, universitas=excluded.universitas, cerita=excluded.cerita, last_update=excluded.last_update`
        ).run(user_id, merged.nama || '', merged.kota || '', merged.umur || null, merged.pekerjaan || '', merged.universitas || '', merged.cerita || '', now);
    } catch (error) {
        logError(`Error saving personal memory: ${error.message}`, 'PERSONAL_MEMORY');
    }
}

function getPersonalJournal(user_id, limit = 30) {
    try {
        return botDb.prepare('SELECT * FROM personal_journal WHERE user_id = ? ORDER BY tanggal DESC LIMIT ?').all(user_id, limit);
    } catch (e) {
        logError(`Error reading personal_journal: ${e.message}`, 'PERSONAL_JOURNAL');
        return [];
    }
}

function savePersonalJournal(user_id, isi) {
    const now = new Date().toISOString();
    try {
        botDb.prepare('INSERT INTO personal_journal (user_id, tanggal, isi) VALUES (?, ?, ?)').run(user_id, now, isi);
    } catch (e) {
        logError(`Error saving personal_journal: ${e.message}`, 'PERSONAL_JOURNAL');
    }
}

// ===== USER PERSONA & RECENT MESSAGES =====

function getUserPersona(user_id) {
    try {
        return botDb.prepare('SELECT * FROM user_persona WHERE user_id = ?').get(user_id) || null;
    } catch (e) {
        logError(`Error reading user_persona: ${e.message}`, 'USER_PERSONA');
        return null;
    }
}

function saveUserPersona(user_id, data = {}) {
    const now = new Date().toISOString();
    try {
        const old = getUserPersona(user_id) || {};
        const merged = { ...old, ...data };
        botDb.prepare(`INSERT INTO user_persona (user_id, nama, umur, pekerjaan, kota, situasi, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET nama=excluded.nama, umur=excluded.umur, pekerjaan=excluded.pekerjaan, kota=excluded.kota, situasi=excluded.situasi, last_update=excluded.last_update`
        ).run(user_id, merged.nama || '', merged.umur || '', merged.pekerjaan || '', merged.kota || '', merged.situasi || '', now);
    } catch (error) {
        logError(`Error saving user persona: ${error.message}`, 'USER_PERSONA');
    }
}

function getUserRecentMessages(user_id, limit = 5) {
    try {
        return botDb.prepare('SELECT pesan, waktu FROM user_recent_messages WHERE user_id = ? ORDER BY waktu DESC LIMIT ?').all(user_id, limit);
    } catch (e) {
        logError(`Error reading user_recent_messages: ${e.message}`, 'USER_RECENT_MSG');
        return [];
    }
}

function saveUserRecentMessage(user_id, pesan) {
    const now = new Date().toISOString();
    try {
        botDb.prepare('INSERT INTO user_recent_messages (user_id, pesan, waktu) VALUES (?, ?, ?)').run(user_id, pesan, now);
        // Hapus pesan lama jika lebih dari 5
        const rows = botDb.prepare('SELECT id FROM user_recent_messages WHERE user_id = ? ORDER BY waktu DESC').all(user_id);
        if (rows.length > 5) {
            const toDelete = rows.slice(5).map(r => r.id);
            if (toDelete.length) {
                botDb.prepare(`DELETE FROM user_recent_messages WHERE id IN (${toDelete.map(() => '?').join(',')})`).run(...toDelete);
            }
        }
    } catch (e) {
        logError(`Error saving user_recent_message: ${e.message}`, 'USER_RECENT_MSG');
    }
}

// ===== USER PERSONAL INFO (SIMPLES) =====
function getUserPersonalInfo(user_id) {
    try {
        return botDb.prepare('SELECT * FROM user_personal_info WHERE user_id = ?').get(user_id) || null;
    } catch (e) {
        logError(`Error reading user_personal_info: ${e.message}`, 'USER_PERSONAL_INFO');
        return null;
    }
}

function saveUserPersonalInfo(user_id, data = {}) {
    const now = new Date().toISOString();
    try {
        const old = getUserPersonalInfo(user_id) || {};
        const merged = { ...old, ...data };
        botDb.prepare(`INSERT INTO user_personal_info (user_id, nama, umur, pekerjaan, kota, situasi, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET nama=excluded.nama, umur=excluded.umur, pekerjaan=excluded.pekerjaan, kota=excluded.kota, situasi=excluded.situasi, last_update=excluded.last_update`
        ).run(user_id, merged.nama || '', merged.umur || '', merged.pekerjaan || '', merged.kota || '', merged.situasi || '', now);
    } catch (error) {
        logError(`Error saving user personal info: ${error.message}`, 'USER_PERSONAL_INFO');
    }
}

// Memory AI user (RAM + SQLite ai_memory.db)
function readUserAIMemory() {
    if (global.userAIMemory) return global.userAIMemory;
    
    try {
        const db = new Database(path.join(__dirname, '../config/ai_memory.db'));
        db.prepare(`CREATE TABLE IF NOT EXISTS user_ai_memory (
            user_id TEXT PRIMARY KEY,
            history TEXT,
            user_name TEXT
        )`).run();

        const data = {};
        const rows = db.prepare('SELECT user_id, history, user_name FROM user_ai_memory').all();
        
        if (rows && rows.length) {
            rows.forEach(row => {
                try {
                    const parsedHistory = JSON.parse(row.history || '[]');
                    // Pastikan history adalah array
                    data[row.user_id] = Array.isArray(parsedHistory) ? parsedHistory : [];
                } catch (e) {
                    // Jika parsing gagal, set ke array kosong
                    data[row.user_id] = [];
                    logError(`Error parsing AI memory for ${row.user_id}: ${e.message}`, 'AI_MEMORY');
                }
            });
        }
        
        db.close();
        global.userAIMemory = data;
        return data;
    } catch (e) {
        logError(`Error loading AI memory from database: ${e.message}`, 'AI_MEMORY');
        // Kembalikan objek kosong jika error
        global.userAIMemory = {};
        return {};
    }
}

function writeUserAIMemory(data) {
    global.userAIMemory = data;
    try {
        const db = new Database(path.join(__dirname, '../config/ai_memory.db'));
        db.prepare(`CREATE TABLE IF NOT EXISTS user_ai_memory (
            user_id TEXT PRIMARY KEY,
            history TEXT
        )`).run();
        const insert = db.prepare('INSERT OR REPLACE INTO user_ai_memory (user_id, history) VALUES (?, ?)');
        for (const user_id in data) {
            insert.run(user_id, JSON.stringify(data[user_id]));
        }
        db.close();
    } catch (e) {
        logError(`Error writing AI memory: ${e.message}`, 'AI_MEMORY');
    }
}

// Migrasi data lama dari JSON ke DB
function migrateAIMemoryJsonToDb() {
    const jsonPath = path.join(__dirname, '../config/user_ai_memory.json');
    const dbPath = path.join(__dirname, '../config/ai_memory.db');
    if (!fs.existsSync(jsonPath)) return false;
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
        return false;
    }
    try {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath);
        db.prepare(`CREATE TABLE IF NOT EXISTS user_ai_memory (
            user_id TEXT PRIMARY KEY,
            history TEXT
        )`).run();
        const insert = db.prepare('INSERT OR REPLACE INTO user_ai_memory (user_id, history) VALUES (?, ?)');
        for (const user_id in data) {
            insert.run(user_id, JSON.stringify(data[user_id]));
        }
        db.close();
        fs.unlinkSync(jsonPath);
        return true;
    } catch (e) {
        return false;
    }
}

// Ensure config files and database tables exist
function ensureConfigFiles() {
    try {
        // Create database tables if they don't exist
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS admins (
                number TEXT PRIMARY KEY
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS users (
                number TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                firstSeen INTEGER,
                lastSeen INTEGER
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS groups (
                groupId TEXT PRIMARY KEY,
                name TEXT,
                participants TEXT,
                joinedAt INTEGER,
                lastActivity INTEGER
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS hutang (
                id TEXT PRIMARY KEY,
                nama_penghutang TEXT,
                nomor_hp TEXT,
                jumlah REAL,
                keterangan TEXT,
                tanggal_dibuat TEXT,
                status TEXT DEFAULT 'belum_lunas',
                tanggal_jatuh_tempo TEXT
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS birthdays (
                number TEXT PRIMARY KEY,
                name TEXT,
                date TEXT
            )
        `);
        
        // Create new tables from migration if they don't exist
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS bot_stats (
                id INTEGER PRIMARY KEY,
                start_time INTEGER NOT NULL,
                messages_sent INTEGER DEFAULT 0,
                errors_count INTEGER DEFAULT 0,
                uptime_seconds INTEGER DEFAULT 0,
                last_updated INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS short_urls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_url TEXT NOT NULL,
                short_code TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL,
                clicks INTEGER DEFAULT 0,
                created_by TEXT,
                expires_at TEXT
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                category TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                date TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                invoice_number TEXT UNIQUE NOT NULL,
                customer TEXT NOT NULL,
                items TEXT NOT NULL,
                total REAL NOT NULL,
                notes TEXT,
                date TEXT NOT NULL,
                status TEXT DEFAULT 'draft',
                timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS scheduled_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target TEXT NOT NULL,
                message TEXT NOT NULL,
                schedule_time TEXT NOT NULL,
                repeat_type TEXT,
                created_by TEXT,
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                date TEXT NOT NULL,
                reminder_time TEXT,
                created_by TEXT,
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS blacklist (
                user_id TEXT PRIMARY KEY,
                reason TEXT,
                blocked_by TEXT,
                blocked_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);
        
        botDb.exec(`
            CREATE TABLE IF NOT EXISTS finance_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                identifier TEXT NOT NULL,
                data TEXT NOT NULL,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // AI Memory tables
        botDb.exec(USER_MEMORY_TABLE);
        
        botDb.exec(`CREATE TABLE IF NOT EXISTS user_facts (
            user_id TEXT,
            fact_key TEXT,
            fact_value TEXT,
            updated_at TEXT,
            PRIMARY KEY (user_id, fact_key)
        )`);

        botDb.exec(`CREATE TABLE IF NOT EXISTS personal_memory (
            user_id TEXT PRIMARY KEY,
            nama TEXT,
            kota TEXT,
            umur INTEGER,
            pekerjaan TEXT,
            universitas TEXT,
            cerita TEXT,
            last_update TEXT
        )`);

        botDb.exec(`CREATE TABLE IF NOT EXISTS personal_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            tanggal TEXT,
            isi TEXT
        )`);

        botDb.exec(`CREATE TABLE IF NOT EXISTS user_persona (
            user_id TEXT PRIMARY KEY,
            nama TEXT,
            umur TEXT,
            pekerjaan TEXT,
            kota TEXT,
            situasi TEXT,
            last_update TEXT
        )`);

        botDb.exec(`CREATE TABLE IF NOT EXISTS user_recent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            pesan TEXT,
            waktu TEXT
        )`);

        botDb.exec(`CREATE TABLE IF NOT EXISTS user_personal_info (
            user_id TEXT PRIMARY KEY,
            nama TEXT,
            umur TEXT,
            pekerjaan TEXT,
            kota TEXT,
            situasi TEXT,
            last_update TEXT
        )`);
        
        // Initialize default settings if not exist
        const defaultSettings = {
            'maintenance_mode': false,
            'default_sholat_city': 'jakarta',
            'last_target': { type: '', target: '' }
        };
        
        for (const [key, value] of Object.entries(defaultSettings)) {
            const existing = botDb.prepare('SELECT key FROM bot_settings WHERE key = ?').get(key);
            if (!existing) {
                setSetting(key, value);
            }
        }
        
    } catch (error) {
        logError(`Error ensuring config files: ${error.message}`, 'CONFIG');
    }
}

module.exports = {
    // Core functions
    getCache, setCache, handleApiError, 
    backupFile, validateAdmins, validateBirthdays,
    formatDate, formatTime, errorMsg,
    logInfo, logError, logWarn, logSuccess,
    
    // Database helper functions
    getSetting, setSetting,
    
    // Admin functions
    getAdmins, saveAdmins, isAdmin,
    
    // Settings functions
    getDefaultSholatCity, setDefaultSholatCity,
    
    // Data management
    getBirthdays, saveBirthdays,
    getScheduledMessages, saveScheduledMessages,
    getEvents, saveEvents,
    getUsers, saveUser,
    getGroups, saveGroup,
    getBannedUsers, banUser, unbanUser,
    getLogs,
    getLastTarget, setLastTarget,
    
    // Financial functions
    getHutang, saveHutang, generateHutangId,
    getHutangReminder, saveHutangReminder,
    getExpenses, saveExpenses, addExpense, getExpenseReport, filterExpensesByPeriod,
    getInvoices, saveInvoices, generateInvoice,
    
    // URL functions
    getShortUrls, saveShortUrls, shortenUrl,
    
    // Configuration
    ensureConfigFiles,
    
    // Export existing functions that weren't mentioned
    getUserSummary, saveUserSummary, summarizeUserHistoryWithLLM, getUserFacts,
    saveUserFact, removeUserFact, getPersonalMemory, savePersonalMemory,
    getPersonalJournal, savePersonalJournal, getUserPersona, saveUserPersona,
    getUserRecentMessages, saveUserRecentMessage, getUserPersonalInfo, saveUserPersonalInfo,
    readUserAIMemory, writeUserAIMemory, migrateAIMemoryJsonToDb
};
