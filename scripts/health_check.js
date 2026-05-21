#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const axios = require('axios');
const { exec } = require('child_process');

const CONFIG = {
    BOT_DB_PATH: path.join(__dirname, '../config/bot_data.db'),
    BOT_OUTPUT_LOG: path.join(__dirname, '../bot_output.log'),
    PROCESS_NAME: 'node src/bot.js',
    HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
    MAX_MEMORY_MB: 512,
    MAX_CPU_PERCENT: 80
};

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

class HealthMonitor {
    constructor() {
        this.checks = [];
        this.stats = {
            lastCheck: null,
            totalChecks: 0,
            healthyChecks: 0,
            criticalErrors: 0
        };
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleString('id-ID');
        const color = type === 'error' ? colors.red : 
                     type === 'warning' ? colors.yellow :
                     type === 'success' ? colors.green : colors.blue;
        
        console.log(`${color}[${timestamp}] ${type.toUpperCase()}: ${message}${colors.reset}`);
    }

    async checkProcessStatus() {
        return new Promise((resolve) => {
            exec(`ps aux | grep "${CONFIG.PROCESS_NAME}" | grep -v grep`, (error, stdout) => {
                if (error || !stdout.trim()) {
                    resolve({
                        status: 'critical',
                        message: 'Bot process not running',
                        data: null
                    });
                    return;
                }

                const lines = stdout.trim().split('\n');
                const process = lines[0].split(/\s+/);
                const pid = process[1];
                const cpu = parseFloat(process[2]);
                const memory = parseFloat(process[3]);
                const memoryMB = parseFloat(process[5]) / 1024;

                let status = 'healthy';
                let warnings = [];

                if (memoryMB > CONFIG.MAX_MEMORY_MB) {
                    status = 'warning';
                    warnings.push(`High memory usage: ${memoryMB.toFixed(2)}MB`);
                }

                if (cpu > CONFIG.MAX_CPU_PERCENT) {
                    status = 'warning';
                    warnings.push(`High CPU usage: ${cpu}%`);
                }

                resolve({
                    status,
                    message: `Bot process running (PID: ${pid})`,
                    data: {
                        pid,
                        cpu: `${cpu}%`,
                        memory: `${memoryMB.toFixed(2)}MB`,
                        warnings
                    }
                });
            });
        });
    }

    async checkDatabaseHealth() {
        try {
            if (!fs.existsSync(CONFIG.BOT_DB_PATH)) {
                return {
                    status: 'critical',
                    message: 'Database file not found',
                    data: null
                };
            }

            const db = new Database(CONFIG.BOT_DB_PATH, { readonly: true });
            
            // Check database integrity
            const integrityResult = db.prepare('PRAGMA integrity_check').get();
            if (integrityResult.integrity_check !== 'ok') {
                db.close();
                return {
                    status: 'critical',
                    message: 'Database integrity check failed',
                    data: { integrity: integrityResult.integrity_check }
                };
            }

            // Check table count
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableCount = tables.length;

            // Check database size
            const stats = fs.statSync(CONFIG.BOT_DB_PATH);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

            // Check some critical tables
            const criticalTables = ['users', 'bot_settings', 'admins'];
            const missingTables = criticalTables.filter(table => 
                !tables.some(t => t.name === table)
            );

            db.close();

            if (missingTables.length > 0) {
                return {
                    status: 'warning',
                    message: `Missing critical tables: ${missingTables.join(', ')}`,
                    data: { tableCount, sizeMB, missingTables }
                };
            }

            return {
                status: 'healthy',
                message: `Database operational (${tableCount} tables, ${sizeMB}MB)`,
                data: { tableCount, sizeMB, integrity: 'ok' }
            };

        } catch (error) {
            return {
                status: 'critical',
                message: `Database error: ${error.message}`,
                data: null
            };
        }
    }

    async checkAPIConnectivity() {
        const apis = [
            {
                name: 'DeepSeek AI',
                url: 'https://api.deepseek.com',
                timeout: 5000
            },
            {
                name: 'Google AI (Gemini)',
                url: 'https://generativelanguage.googleapis.com',
                timeout: 5000
            }
        ];

        const results = [];
        let healthyAPIs = 0;

        for (const api of apis) {
            try {
                const start = Date.now();
                await axios.get(api.url, { 
                    timeout: api.timeout,
                    validateStatus: () => true // Accept any status code
                });
                const responseTime = Date.now() - start;
                
                results.push({
                    name: api.name,
                    status: 'healthy',
                    responseTime: `${responseTime}ms`
                });
                healthyAPIs++;
            } catch (error) {
                results.push({
                    name: api.name,
                    status: 'error',
                    error: error.code || error.message
                });
            }
        }

        const status = healthyAPIs === apis.length ? 'healthy' :
                      healthyAPIs > 0 ? 'warning' : 'critical';

        return {
            status,
            message: `${healthyAPIs}/${apis.length} APIs reachable`,
            data: results
        };
    }

    async checkLogFiles() {
        const logFiles = [
            { path: CONFIG.BOT_OUTPUT_LOG, name: 'Bot Output' },
            { path: path.join(__dirname, '../error.log'), name: 'Error Log' }
        ];

        const results = [];
        let warnings = [];

        for (const logFile of logFiles) {
            if (fs.existsSync(logFile.path)) {
                const stats = fs.statSync(logFile.path);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                
                results.push({
                    name: logFile.name,
                    exists: true,
                    size: `${sizeMB}MB`,
                    lastModified: stats.mtime.toLocaleString('id-ID')
                });

                if (stats.size > 50 * 1024 * 1024) { // 50MB
                    warnings.push(`${logFile.name} is large (${sizeMB}MB)`);
                }
            } else {
                results.push({
                    name: logFile.name,
                    exists: false
                });
            }
        }

        return {
            status: warnings.length > 0 ? 'warning' : 'healthy',
            message: `Log files check completed`,
            data: { files: results, warnings }
        };
    }

    async checkMemoryUsage() {
        return new Promise((resolve) => {
            exec('free -m', (error, stdout) => {
                if (error) {
                    resolve({
                        status: 'error',
                        message: 'Cannot check system memory',
                        data: null
                    });
                    return;
                }

                const lines = stdout.trim().split('\n');
                const memLine = lines[1].split(/\s+/);
                const total = parseInt(memLine[1]);
                const used = parseInt(memLine[2]);
                const free = parseInt(memLine[3]);
                const usagePercent = ((used / total) * 100).toFixed(2);

                let status = 'healthy';
                if (usagePercent > 90) status = 'critical';
                else if (usagePercent > 80) status = 'warning';

                resolve({
                    status,
                    message: `System memory usage: ${usagePercent}%`,
                    data: {
                        total: `${total}MB`,
                        used: `${used}MB`,
                        free: `${free}MB`,
                        usage: `${usagePercent}%`
                    }
                });
            });
        });
    }

    async runAllChecks() {
        this.stats.totalChecks++;
        this.stats.lastCheck = new Date();
        
        console.log(`${colors.bold}${colors.blue}==================== HEALTH CHECK #${this.stats.totalChecks} ====================${colors.reset}`);
        console.log(`${colors.blue}Timestamp: ${this.stats.lastCheck.toLocaleString('id-ID')}${colors.reset}\n`);

        const checks = [
            { name: 'Bot Process', fn: () => this.checkProcessStatus() },
            { name: 'Database Health', fn: () => this.checkDatabaseHealth() },
            { name: 'API Connectivity', fn: () => this.checkAPIConnectivity() },
            { name: 'Log Files', fn: () => this.checkLogFiles() },
            { name: 'System Memory', fn: () => this.checkMemoryUsage() }
        ];

        const results = [];
        let healthyCount = 0;

        for (const check of checks) {
            try {
                const result = await check.fn();
                results.push({ name: check.name, ...result });
                
                const statusIcon = result.status === 'healthy' ? '✅' :
                                 result.status === 'warning' ? '⚠️' : '❌';
                
                if (result.status === 'healthy') healthyCount++;
                
                this.log(`${statusIcon} ${check.name}: ${result.message}`, result.status);
                
                if (result.data && typeof result.data === 'object') {
                    if (result.data.warnings && result.data.warnings.length > 0) {
                        result.data.warnings.forEach(warning => {
                            this.log(`   Warning: ${warning}`, 'warning');
                        });
                    }
                }
            } catch (error) {
                this.log(`❌ ${check.name}: Check failed - ${error.message}`, 'error');
                results.push({ 
                    name: check.name, 
                    status: 'critical', 
                    message: `Check failed: ${error.message}`,
                    data: null 
                });
            }
        }

        // Overall health assessment
        const totalChecks = checks.length;
        const healthPercentage = ((healthyCount / totalChecks) * 100).toFixed(1);
        
        let overallStatus = 'healthy';
        if (healthPercentage < 60) overallStatus = 'critical';
        else if (healthPercentage < 80) overallStatus = 'warning';

        console.log(`\n${colors.bold}================= OVERALL HEALTH SUMMARY =================${colors.reset}`);
        
        const statusIcon = overallStatus === 'healthy' ? '🟢' :
                          overallStatus === 'warning' ? '🟡' : '🔴';
        
        console.log(`${statusIcon} Overall Health: ${healthPercentage}% (${healthyCount}/${totalChecks} checks passed)`);
        console.log(`🏥 Health Status: ${overallStatus.toUpperCase()}`);
        console.log(`🎯 Reliability: ${healthPercentage >= 90 ? 'Excellent' : 
                                     healthPercentage >= 80 ? 'Good' : 
                                     healthPercentage >= 60 ? 'Needs Attention' : 'Critical'}`);
        
        if (overallStatus === 'healthy') {
            this.stats.healthyChecks++;
        } else {
            this.stats.criticalErrors++;
        }

        console.log(`\n📊 Session Stats: ${this.stats.healthyChecks}/${this.stats.totalChecks} healthy checks`);
        console.log(`${colors.blue}Next check in ${CONFIG.HEALTH_CHECK_INTERVAL / 1000} seconds...${colors.reset}\n`);

        return {
            overallStatus,
            healthPercentage,
            results,
            timestamp: this.stats.lastCheck
        };
    }

    startMonitoring() {
        this.log('🚀 Starting Health Monitor...', 'info');
        this.log(`📊 Check interval: ${CONFIG.HEALTH_CHECK_INTERVAL / 1000}s`, 'info');
        
        // Run initial check
        this.runAllChecks();
        
        // Schedule periodic checks
        setInterval(() => {
            this.runAllChecks();
        }, CONFIG.HEALTH_CHECK_INTERVAL);
    }

    async runSingleCheck() {
        const result = await this.runAllChecks();
        process.exit(result.overallStatus === 'critical' ? 1 : 0);
    }
}

// CLI usage
if (require.main === module) {
    const monitor = new HealthMonitor();
    
    const args = process.argv.slice(2);
    if (args.includes('--once')) {
        monitor.runSingleCheck();
    } else {
        monitor.startMonitoring();
    }
}

module.exports = HealthMonitor; 