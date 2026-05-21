# 🚀 Panduan Instalasi WhatsApp Bot AI

Panduan lengkap untuk menginstall dan menjalankan WhatsApp Bot AI di sistem Anda.

## 📋 Sistem Requirements

### Minimum Requirements
- **OS**: Windows 10/11, macOS 10.15+, atau Linux Ubuntu 18.04+
- **Node.js**: Version 14.0.0 atau lebih baru
- **RAM**: Minimal 2GB (Recommended 4GB+)
- **Storage**: Minimal 1GB free space
- **Network**: Koneksi internet stabil

### Recommended Requirements
- **Node.js**: Version 18.0.0 atau lebih baru
- **RAM**: 8GB atau lebih
- **Storage**: 5GB free space (untuk logs dan media)

## 🛠 Instalasi Node.js

### Windows
1. Download Node.js dari [nodejs.org](https://nodejs.org/)
2. Pilih "LTS" version (Recommended)
3. Install dengan default settings
4. Restart Command Prompt/PowerShell

### macOS
```bash
# Using Homebrew (recommended)
brew install node

# Or download from nodejs.org
```

### Linux (Ubuntu/Debian)
```bash
# Update package index
sudo apt update

# Install Node.js
sudo apt install nodejs npm

# Verify installation
node --version
npm --version
```

## 📦 Download & Setup Project

### Method 1: Download ZIP (Recommended untuk pemula)
1. Klik tombol "Code" → "Download ZIP" di GitHub
2. Extract file ZIP ke folder yang diinginkan
3. Buka terminal/command prompt di folder tersebut

### Method 2: Git Clone
```bash
git clone https://github.com/your-username/whatsapp-bot.git
cd whatsapp-bot
```

## ⚙️ Instalasi Dependencies

```bash
# Install semua dependencies
npm install

# Jika ada error, coba dengan force
npm install --force

# Atau gunakan yarn (alternatif)
npm install -g yarn
yarn install
```

### Troubleshooting Dependencies

#### Error: Python not found
```bash
# Windows - Install Visual Studio Build Tools
npm install --global --production windows-build-tools

# macOS - Install Xcode Command Line Tools
xcode-select --install

# Linux - Install build essentials
sudo apt-get install build-essential
```

#### Error: Canvas/Sharp tidak bisa install
```bash
# Windows
npm install --global node-gyp
npm config set msvs_version 2019

# Linux
sudo apt-get install libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential g++

# macOS
xcode-select --install
```

## 🔧 Setup Configuration

### 1. Initial Setup
```bash
npm run setup
```

Script ini akan:
- Membuat folder yang diperlukan
- Generate file konfigurasi default
- Copy template environment variables

### 2. Configure Environment Variables

#### Edit file `.env`:
```bash
# Windows
notepad .env

# macOS/Linux
nano .env
# atau
code .env
```

#### Required Configuration:
```env
# ========== REQUIRED API KEYS ==========
GEMINI_API_KEY=your_actual_api_key_here
DEEPSEEK_API_KEY=your_actual_api_key_here  
OPENWEATHER_API_KEY=your_actual_api_key_here

# ========== BOT CONFIGURATION ==========
OWNER_NUMBER=6281234567890
```

### 3. Get API Keys

#### Google Gemini AI (REQUIRED)
1. Kunjungi [Google AI Studio](https://makersuite.google.com/)
2. Login dengan Google account
3. Klik "Get API Key" → "Create API Key"
4. Copy API key dan paste ke `.env`

**Quota**: 15 requests per minute (gratis)

#### DeepSeek AI (REQUIRED)
1. Kunjungi [DeepSeek Platform](https://platform.deepseek.com/)
2. Sign up/Login
3. Go to "API Keys" menu
4. Create new API key
5. Copy dan paste ke `.env`

**Credit**: $5 gratis untuk new users

#### OpenWeather (REQUIRED)
1. Kunjungi [OpenWeatherMap](https://openweathermap.org/api)
2. Sign up for free account
3. Go to "API Keys" tab
4. Copy "Key" dan paste ke `.env`

**Quota**: 1000 calls per day (gratis)

#### Optional API Keys
```env
# RapidAPI (Optional) - untuk fitur tambahan
RAPIDAPI_KEY=your_rapidapi_key

# EXA API (Optional) - untuk web search
EXA_API_KEY=your_exa_api_key

# TMDB (Optional) - untuk info film
TMDB_API_KEY=your_tmdb_api_key

# Genius (Optional) - untuk lirik lagu
GENIUS_API_KEY=your_genius_api_key
```

## 📱 Setup WhatsApp

### 1. First Run
```bash
npm start
```

### 2. Scan QR Code
1. QR code akan muncul di terminal
2. Buka WhatsApp di smartphone
3. Go to **Settings** → **Linked Devices** → **Link a Device**
4. Scan QR code yang muncul
5. Wait untuk koneksi sukses

### 3. Verify Connection
Setelah berhasil connect, bot akan:
- Show "Connection successful!" message
- Create `baileys_auth/` folder dengan session data
- Bot siap digunakan!

## 🧪 Testing Installation

### Quick Test
```bash
# Test bot response (kirim pesan ke bot)
/system

# Test AI features
/ai hello

# Test weather
/cuaca jakarta

# Test prayer times
/sholat jakarta
```

### Advanced Testing
```bash
# Health check
npm run health

# Monitor logs
npm run logs

# Check database
npm run db:status
```

## 🚀 Running Options

### Development Mode
```bash
npm run dev
```
- Auto-restart saat ada perubahan file
- Detailed logging
- Good untuk development

### Production Mode
```bash
npm start
```
- Optimized performance
- Normal logging
- Good untuk production

### Background Mode
```bash
npm run bg
```
- Bot running di background
- Output ke `bot_output.log`
- Good untuk server deployment

### Monitor Mode
```bash
npm run monitor
```
- Continuous health monitoring
- Auto-restart jika crash
- Good untuk 24/7 operation

## 🔧 Advanced Configuration

### Custom Log Level
```env
LOG_LEVEL=info  # error, warn, info, all
```

### Custom Retry Settings
```env
MAX_RETRIES=3
RETRY_DELAY=5000
```

### Rate Limiting
```env
RATE_LIMIT_TOKENS=5
RATE_LIMIT_REFILL_RATE=1000
RATE_LIMIT_MAX_TOKENS=5
```

## 🐛 Common Issues & Solutions

### Issue: "Cannot find module"
```bash
# Solution: Install dependencies
npm install
```

### Issue: "Permission denied"
```bash
# Linux/macOS: Fix permissions
sudo chown -R $USER:$USER .
chmod +x scripts/*

# Windows: Run as Administrator
```

### Issue: "Port already in use"
```bash
# Stop all bot processes
npm run stop

# Or kill manually
pkill -f "node src/bot.js"
```

### Issue: "QR Code tidak muncul"
```bash
# Clear terminal dan run ulang
clear
npm start

# Atau coba resize terminal window
```

### Issue: "API Error 401/403"
- Check API keys di `.env` file
- Pastikan API keys valid dan aktif
- Check quota limits

### Issue: "Database error"
```bash
# Reset database
rm -rf config/*.db*

# Restore dari backup
npm run db:restore
```

## 📁 File Structure Overview

```
whatsapp-bot/
├── .env                    # Environment variables (YOUR CONFIG)
├── package.json           # Dependencies
├── README.md             # Documentation
├── src/
│   └── bot.js           # Main bot file
├── modules/            # Bot modules
├── config/            # Config files & database
├── baileys_auth/     # WhatsApp session (auto-generated)
├── logs/            # Log files
├── scripts/         # Utility scripts
└── data/           # Bot data
```

## 🔄 Maintenance

### Regular Tasks
```bash
# Update dependencies (monthly)
npm update

# Backup database (weekly)
npm run backup

# Clean logs (monthly)
rm -rf logs/*.log

# Health check
npm run health
```

### Updates
```bash
# Get latest version
git pull origin main

# Update dependencies
npm install

# Restart bot
npm restart
```

## 🆘 Support

Jika masih ada masalah:

1. **Check Issues**: [GitHub Issues](https://github.com/your-username/whatsapp-bot/issues)
2. **Read FAQ**: Check README.md bagian Troubleshooting
3. **Create Issue**: Buat issue baru dengan detail error
4. **Join Discussion**: [GitHub Discussions](https://github.com/your-username/whatsapp-bot/discussions)

### Error Report Template
```markdown
**Environment:**
- OS: [Windows 10/macOS/Linux]
- Node.js: [18.0.0]
- Bot Version: [1.0.0]

**Error Message:**
[Copy paste exact error]

**Steps to Reproduce:**
1. ...
2. ...

**Config (remove sensitive data):**
[Relevant parts of .env or config]
```

---

🎉 **Selamat! Bot WhatsApp AI Anda sudah ready!** 🎉 