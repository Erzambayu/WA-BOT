const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const chalk = require('chalk');

const BOT_DB_PATH = path.join(__dirname, '../config/bot_data.db');
const CONFIG_DIR = path.join(__dirname, '../config');

class DatabaseMigration {
    constructor() {
        this.db = new Database(BOT_DB_PATH);
        this.db.pragma('journal_mode = WAL');
        this.backupDir = path.join(__dirname, '../backup');
        
        // Ensure backup directory exists
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const colors = {
            info: chalk.cyan,
            success: chalk.green,
            warn: chalk.yellow,
            error: chalk.red
        };
        console.log(colors[type](`[MIGRATION] [${timestamp}] ${message}`));
    }

    backupJsonFile(filename) {
        const srcPath = path.join(CONFIG_DIR, filename);
        if (fs.existsSync(srcPath)) {
            const backupPath = path.join(this.backupDir, `${filename}.${Date.now()}.bak`);
            fs.copyFileSync(srcPath, backupPath);
            this.log(`Backup created: ${filename}`, 'success');
            return true;
        }
        return false;
    }

    createTables() {
        this.log('Creating database tables...', 'info');

        // Bot settings table (menggantikan berbagai config JSON)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // Bot statistics table (menggantikan bot_stats.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bot_stats (
                id INTEGER PRIMARY KEY,
                start_time INTEGER NOT NULL,
                messages_sent INTEGER DEFAULT 0,
                errors_count INTEGER DEFAULT 0,
                uptime_seconds INTEGER DEFAULT 0,
                last_updated INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // URL shortener table (menggantikan url_shortener.json)
        this.db.exec(`
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

        // Expenses table (menggantikan expenses.json)
        this.db.exec(`
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

        // Invoices table (menggantikan invoices.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                invoice_number TEXT UNIQUE NOT NULL,
                customer TEXT NOT NULL,
                items TEXT NOT NULL, -- JSON string
                total REAL NOT NULL,
                notes TEXT,
                date TEXT NOT NULL,
                status TEXT DEFAULT 'draft',
                timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // Finance data table (menggantikan finance.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS finance_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL, -- 'groups', 'users', 'expenses', 'collections', 'payments', 'reminders'
                identifier TEXT NOT NULL, -- group_id, user_id, etc
                data TEXT NOT NULL, -- JSON string
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // Scheduled messages table (menggantikan scheduled_messages.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS scheduled_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target TEXT NOT NULL,
                message TEXT NOT NULL,
                schedule_time TEXT NOT NULL,
                repeat_type TEXT, -- 'daily', 'weekly', 'monthly', null
                created_by TEXT,
                is_active INTEGER DEFAULT 1,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        // Events table (menggantikan events.json)
        this.db.exec(`
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

        // Blacklist table (menggantikan blacklist.json)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS blacklist (
                user_id TEXT PRIMARY KEY,
                reason TEXT,
                blocked_by TEXT,
                blocked_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `);

        this.log('Database tables created successfully', 'success');
    }

    migrateBotStats() {
        this.log('Migrating bot stats...', 'info');
        
        const statsFile = path.join(CONFIG_DIR, 'bot_stats.json');
        if (fs.existsSync(statsFile)) {
            this.backupJsonFile('bot_stats.json');
            
            try {
                const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                
                // Clear existing stats
                this.db.prepare('DELETE FROM bot_stats').run();
                
                // Insert migrated stats
                this.db.prepare(`
                    INSERT INTO bot_stats (start_time, messages_sent, errors_count)
                    VALUES (?, ?, ?)
                `).run(stats.startTime || Date.now(), stats.sent || 0, stats.error || 0);
                
                this.log('Bot stats migrated successfully', 'success');
            } catch (error) {
                this.log(`Error migrating bot stats: ${error.message}`, 'error');
            }
        }
    }

    migrateSettings() {
        this.log('Migrating settings...', 'info');
        
        // Migrate maintenance.json
        const maintenanceFile = path.join(CONFIG_DIR, 'maintenance.json');
        if (fs.existsSync(maintenanceFile)) {
            this.backupJsonFile('maintenance.json');
            try {
                const maintenance = JSON.parse(fs.readFileSync(maintenanceFile, 'utf8'));
                this.db.prepare(`
                    INSERT OR REPLACE INTO bot_settings (key, value)
                    VALUES (?, ?)
                `).run('maintenance_mode', JSON.stringify(maintenance.maintenance || false));
            } catch (error) {
                this.log(`Error migrating maintenance settings: ${error.message}`, 'error');
            }
        }

        // Migrate sholat_city.json
        const sholatFile = path.join(CONFIG_DIR, 'sholat_city.json');
        if (fs.existsSync(sholatFile)) {
            this.backupJsonFile('sholat_city.json');
            try {
                const sholat = JSON.parse(fs.readFileSync(sholatFile, 'utf8'));
                this.db.prepare(`
                    INSERT OR REPLACE INTO bot_settings (key, value)
                    VALUES (?, ?)
                `).run('default_sholat_city', JSON.stringify(sholat.city || 'jakarta'));
            } catch (error) {
                this.log(`Error migrating sholat city: ${error.message}`, 'error');
            }
        }

        // Migrate bot_status.json
        const statusFile = path.join(CONFIG_DIR, 'bot_status.json');
        if (fs.existsSync(statusFile)) {
            this.backupJsonFile('bot_status.json');
            try {
                const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
                this.db.prepare(`
                    INSERT OR REPLACE INTO bot_settings (key, value)
                    VALUES (?, ?)
                `).run('bot_status', JSON.stringify(status));
            } catch (error) {
                this.log(`Error migrating bot status: ${error.message}`, 'error');
            }
        }

        // Migrate last_target.json
        const targetFile = path.join(CONFIG_DIR, 'last_target.json');
        if (fs.existsSync(targetFile)) {
            this.backupJsonFile('last_target.json');
            try {
                const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
                this.db.prepare(`
                    INSERT OR REPLACE INTO bot_settings (key, value)
                    VALUES (?, ?)
                `).run('last_target', JSON.stringify(target));
            } catch (error) {
                this.log(`Error migrating last target: ${error.message}`, 'error');
            }
        }

        this.log('Settings migrated successfully', 'success');
    }

    migrateUrlShortener() {
        this.log('Migrating URL shortener data...', 'info');
        
        const urlFile = path.join(CONFIG_DIR, 'url_shortener.json');
        if (fs.existsSync(urlFile)) {
            this.backupJsonFile('url_shortener.json');
            
            try {
                const urls = JSON.parse(fs.readFileSync(urlFile, 'utf8'));
                
                if (Array.isArray(urls)) {
                    const insert = this.db.prepare(`
                        INSERT OR REPLACE INTO short_urls 
                        (original_url, short_code, created_at, clicks)
                        VALUES (?, ?, ?, ?)
                    `);
                    
                    const transaction = this.db.transaction((urlList) => {
                        for (const url of urlList) {
                            insert.run(
                                url.original,
                                url.short,
                                url.created,
                                url.clicks || 0
                            );
                        }
                    });
                    
                    transaction(urls);
                    this.log(`Migrated ${urls.length} URL shortener entries`, 'success');
                }
            } catch (error) {
                this.log(`Error migrating URL shortener: ${error.message}`, 'error');
            }
        }
    }

    migrateExpenses() {
        this.log('Migrating expenses data...', 'info');
        
        const expensesFile = path.join(CONFIG_DIR, 'expenses.json');
        if (fs.existsSync(expensesFile)) {
            this.backupJsonFile('expenses.json');
            
            try {
                const expenses = JSON.parse(fs.readFileSync(expensesFile, 'utf8'));
                
                if (Array.isArray(expenses)) {
                    const insert = this.db.prepare(`
                        INSERT OR REPLACE INTO expenses 
                        (id, user_id, category, amount, description, date, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `);
                    
                    const transaction = this.db.transaction((expenseList) => {
                        for (const expense of expenseList) {
                            insert.run(
                                expense.id,
                                expense.userId,
                                expense.category,
                                expense.amount,
                                expense.description || '',
                                expense.date,
                                expense.timestamp
                            );
                        }
                    });
                    
                    transaction(expenses);
                    this.log(`Migrated ${expenses.length} expense entries`, 'success');
                }
            } catch (error) {
                this.log(`Error migrating expenses: ${error.message}`, 'error');
            }
        }
    }

    migrateInvoices() {
        this.log('Migrating invoices data...', 'info');
        
        const invoicesFile = path.join(CONFIG_DIR, 'invoices.json');
        if (fs.existsSync(invoicesFile)) {
            this.backupJsonFile('invoices.json');
            
            try {
                const invoices = JSON.parse(fs.readFileSync(invoicesFile, 'utf8'));
                
                if (Array.isArray(invoices)) {
                    const insert = this.db.prepare(`
                        INSERT OR REPLACE INTO invoices 
                        (id, user_id, invoice_number, customer, items, total, notes, date, status, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    
                    const transaction = this.db.transaction((invoiceList) => {
                        for (const invoice of invoiceList) {
                            insert.run(
                                invoice.id,
                                invoice.userId,
                                invoice.invoiceNumber,
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
                    
                    transaction(invoices);
                    this.log(`Migrated ${invoices.length} invoice entries`, 'success');
                }
            } catch (error) {
                this.log(`Error migrating invoices: ${error.message}`, 'error');
            }
        }
    }

    migrateFinanceData() {
        this.log('Migrating finance data...', 'info');
        
        const financeFile = path.join(CONFIG_DIR, 'finance.json');
        if (fs.existsSync(financeFile)) {
            this.backupJsonFile('finance.json');
            
            try {
                const finance = JSON.parse(fs.readFileSync(financeFile, 'utf8'));
                
                const insert = this.db.prepare(`
                    INSERT OR REPLACE INTO finance_data (type, identifier, data)
                    VALUES (?, ?, ?)
                `);
                
                const transaction = this.db.transaction((financeData) => {
                    for (const [type, data] of Object.entries(financeData)) {
                        if (typeof data === 'object') {
                            for (const [identifier, value] of Object.entries(data)) {
                                insert.run(type, identifier, JSON.stringify(value));
                            }
                        }
                    }
                });
                
                transaction(finance);
                this.log('Finance data migrated successfully', 'success');
            } catch (error) {
                this.log(`Error migrating finance data: ${error.message}`, 'error');
            }
        }
    }

    migrateBlacklist() {
        this.log('Migrating blacklist data...', 'info');
        
        const blacklistFile = path.join(CONFIG_DIR, 'blacklist.json');
        if (fs.existsSync(blacklistFile)) {
            this.backupJsonFile('blacklist.json');
            
            try {
                const blacklist = JSON.parse(fs.readFileSync(blacklistFile, 'utf8'));
                
                if (Array.isArray(blacklist)) {
                    const insert = this.db.prepare(`
                        INSERT OR REPLACE INTO blacklist (user_id, reason, blocked_by)
                        VALUES (?, ?, ?)
                    `);
                    
                    const transaction = this.db.transaction((blacklistData) => {
                        for (const entry of blacklistData) {
                            if (typeof entry === 'string') {
                                insert.run(entry, 'Migrated from JSON', 'system');
                            } else if (typeof entry === 'object') {
                                insert.run(
                                    entry.user_id || entry.userId,
                                    entry.reason || 'No reason provided',
                                    entry.blocked_by || 'system'
                                );
                            }
                        }
                    });
                    
                    transaction(blacklist);
                    this.log(`Migrated ${blacklist.length} blacklist entries`, 'success');
                }
            } catch (error) {
                this.log(`Error migrating blacklist: ${error.message}`, 'error');
            }
        }
    }

    async runFullMigration() {
        this.log('Starting full database migration...', 'info');
        
        try {
            // Create all tables
            this.createTables();
            
            // Run all migrations
            this.migrateBotStats();
            this.migrateSettings();
            this.migrateUrlShortener();
            this.migrateExpenses();
            this.migrateInvoices();
            this.migrateFinanceData();
            this.migrateBlacklist();
            
            this.log('Full migration completed successfully!', 'success');
            this.log(`Backup files saved in: ${this.backupDir}`, 'info');
            
            return true;
        } catch (error) {
            this.log(`Migration failed: ${error.message}`, 'error');
            return false;
        }
    }

    // Helper method to get setting from database
    getSetting(key, defaultValue = null) {
        try {
            const result = this.db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
            return result ? JSON.parse(result.value) : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }

    // Helper method to set setting in database
    setSetting(key, value) {
        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO bot_settings (key, value, updated_at)
                VALUES (?, ?, ?)
            `).run(key, JSON.stringify(value), Math.floor(Date.now() / 1000));
            return true;
        } catch (error) {
            this.log(`Error setting ${key}: ${error.message}`, 'error');
            return false;
        }
    }

    close() {
        this.db.close();
    }
}

module.exports = DatabaseMigration; 