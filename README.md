# WhatsApp Bot v2.0.0

Bot WhatsApp berbasis **Baileys** dengan integrasi AI (Gemini + DeepSeek), finance tracker dengan export PDF/CSV/chart, islamic tools (jadwal sholat, qibla, hadits, hijri), dan sticker maker (image/text/brat/animated).

> 🔥 **v2.0.0 — Full Overhaul**: lihat [CHANGELOG.md](CHANGELOG.md) untuk detail breaking changes & migration.

## 📋 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Prasyarat](#-prasyarat)
- [Instalasi](#-instalasi)
- [Konfigurasi](#-konfigurasi)
- [Setup Bot & Owner](#-setup-bot--owner)
- [Menjalankan Bot](#-menjalankan-bot)
- [Daftar Command](#-daftar-command)
- [Struktur Proyek](#-struktur-proyek)
- [API yang Digunakan](#-api-yang-digunakan)
- [Arsitektur & Database](#-arsitektur--database)
- [Troubleshooting](#-troubleshooting)
- [Kontribusi](#-kontribusi)

## 🚀 Fitur Utama

### 🤖 AI & Otomasi
- **AI Chat dual-engine**: Gemini 2.0 + DeepSeek (via OpenRouter), auto-fallback
- **Auto-reply per-user**: aktifkan dgn `/ai-auto on`, bot reply tanpa command prefix
- **Memory persisten**: bot inget nama, summary emosi, fakta personal user (SQLite)
- **Token saving mode**: short prompt + cache 24h, hemat quota AI
- **Group moderation AI**: deteksi spam/kata kasar otomatis (DeepSeek)

### 🕌 Islamic Tools
- **Jadwal sholat**: pakai `aladhan.com` (method 20 = Kemenag RI) dgn fallback `myquran.com`
- **Notifikasi sholat otomatis**: kirim ke owner & admin tepat di waktu sholat
- **Arah kiblat (qibla)**: derajat dari utara + kompas 8-arah
- **Hadits random**: 9 kitab (bukhari, muslim, abu-daud, tirmidzi, nasai, ibnu-majah, ahmad, malik, darimi)
- **Tanggal hijriah** real-time
- Cache in-memory: 12h jadwal, 24h qibla, 1h hadits

### 💰 Finance Tracker
- **Expense tracking** dgn auto-categorize (9 kategori: makanan, transport, belanja, hiburan, tagihan, kesehatan, pendidikan, transfer, lainnya)
- **Export PDF**: laporan profesional dgn breakdown kategori + table detail
- **Export CSV**: untuk import ke Excel/Sheets
- **Chart PNG**: bar chart per-kategori (top 8)
- **Period filter**: week/month/year/all
- **Invoice generator**: bikin invoice dengan format profesional
- **Reminder hutang**: notifikasi otomatis H-1 jatuh tempo

### 🎨 Sticker Maker
- **Image → sticker**: WebP 512x512 transparan (sharp)
- **Text → sticker**: auto-fit font size, word-wrap, outline
- **Brat-style**: lime green Charli XCX aesthetic
- **Animated**: gif/video → animated WebP
- **Solid text**: putih clean

### 🔧 Utility & Admin
- **Backup & restore**: zip semua data DB + auth
- **Status dashboard**: CPU, RAM, storage, uptime, message stats
- **Health check** script: monitor real-time
- **URL shortener** internal
- **QR generator**: bikin QR dari teks/URL
- **Download IG/TikTok** (via RapidAPI, opsional)
- **Search web** via Exa API + AI summary

## 📋 Prasyarat

| Component | Minimum | Catatan |
|---|---|---|
| **Node.js** | `>= 18.0.0` LTS | v14 udah EOL, ga didukung |
| **npm** | `>= 8.x` | bawaan Node 18+ |
| **Build tools** | VS Build Tools (Windows) atau `build-essential` (Linux) | wajib untuk `better-sqlite3`, `canvas`, `sharp` |
| **WhatsApp** | 2 nomor (1 bot, 1 owner) | nomor bot harus beda dari owner |

### Windows build tools
```powershell
# install Visual Studio Build Tools dgn workload "Desktop development with C++"
# atau via winget:
winget install Microsoft.VisualStudio.2022.BuildTools
```

### Linux build tools
```bash
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

## 🛠 Instalasi

```bash
# 1. clone
git clone https://github.com/your-username/whatsapp-bot.git
cd whatsapp-bot

# 2. install deps (BUTUH build tools! kalau gagal lihat troubleshooting)
npm install

# 3. setup direktori & DB
npm run setup

# 4. copy template env
cp env.example .env
```

> ⚠️ Kalau `npm install` gagal di native module (better-sqlite3/canvas/sharp), fix build tools dulu (lihat [Prasyarat](#-prasyarat)). Jangan pakai `--ignore-scripts` di production.

## ⚙️ Konfigurasi

### Environment Variables (`.env`)

```env
# ========== WAJIB ==========
OWNER_NUMBER=628xxxxxxxxxx           # nomor owner (tanpa @s.whatsapp.net)
GEMINI_API_KEY=                      # https://aistudio.google.com/apikey
DEEPSEEK_API_KEY=                    # https://openrouter.ai/keys atau platform.deepseek.com
OPENWEATHER_API_KEY=                 # https://openweathermap.org/api

# ========== OPSIONAL ==========
RAPIDAPI_KEY=                        # untuk download IG/TikTok
EXA_API_KEY=                         # untuk /web /ringkas /jawab
TMDB_API_KEY=                        # info film
GENIUS_API_KEY=                      # search lirik
BOT_NUMBER=                          # auto-set setelah login pertama

# ========== LOGGING ==========
LOG_LEVEL=info                       # error | warn | info | all
NODE_ENV=production

# ========== ADVANCED ==========
MAX_RETRIES=3
RETRY_DELAY=5000
RATE_LIMIT_TOKENS=5
RATE_LIMIT_REFILL_RATE=1000
RATE_LIMIT_MAX_TOKENS=5

# Method ID aladhan (20 = Kemenag RI; 99 = custom)
ALADHAN_METHOD=20
```

### Cara dapetin API key

| Service | Link | Status |
|---|---|---|
| Gemini AI | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | ⭐ wajib (free tier) |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) atau [OpenRouter](https://openrouter.ai/keys) | ⭐ wajib |
| OpenWeather | [openweathermap.org/api](https://openweathermap.org/api) | ⭐ wajib (free tier 60 req/min) |
| RapidAPI | [rapidapi.com](https://rapidapi.com/) | opsional (IG/TikTok) |
| Exa | [exa.ai](https://exa.ai/) | opsional (web search) |
| TMDB | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) | opsional (film) |
| Genius | [genius.com/api-clients](https://genius.com/api-clients) | opsional (lirik) |

## 🔧 Setup Bot & Owner

1. **Isi `.env`** — minimal `OWNER_NUMBER`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENWEATHER_API_KEY`
2. **Jalankan:** `npm start`
3. **Scan QR** dgn nomor yg mau jadi bot (BUKAN nomor owner!)
4. **Tambah admin** dari nomor owner:
   ```
   /admin 6281234567890
   ```
5. **Test:** `/status`, `/help`, `/sholat jakarta`

## 🚀 Menjalankan Bot

```bash
# production
npm start

# development (auto-reload via nodemon)
npm run dev

# background (Linux/macOS)
npm run bg

# tail logs
npm run logs

# health check sekali jalan
npm run health

# health check terus-menerus (interval)
npm run monitor

# test prayer API (validasi aladhan + myquran)
npm run test:prayer

# lint
npm run lint
npm run lint:fix
```

### Backup & Restore
```bash
# backup data via script
npm run backup

# restore dari backup
npm run restore

# atau pakai command WA (admin only):
/backup
/restore
```

## 📝 Daftar Command

Total **50+ command**. Format: `/<command>` di chat WA.

### 🤖 AI
| Command | Akses | Fungsi |
|---|---|---|
| `/ai <pesan>` | semua | Chat dengan AI (DeepSeek + Gemini fallback) |
| `/ai reset` | semua | Reset memory AI user |
| `/ai-auto on\|off` | admin | Aktif/nonaktif auto-reply tanpa prefix |
| `/ai-optimize <flags>` | admin | Tuning AI (emotion, summary, retry, cache, dll) |
| `/testapiais` | admin | Cek konektivitas API AI |

### 🕌 Islamic
| Command | Fungsi |
|---|---|
| `/sholat [kota]` | Jadwal sholat hari ini (default: kota dari `/setkota`) |
| `/qibla [kota]` | Arah kiblat dari kota |
| `/hadits [kitab]` | Hadits random (kitab: bukhari/muslim/abu-daud/tirmidzi/nasai/ibnu-majah/ahmad/malik/darimi) |
| `/hijri` | Tanggal hijriah hari ini |
| `/setkota <kota>` | Set default kota sholat (admin only) |

### 💰 Finance
| Command | Fungsi |
|---|---|
| `/expense add <kategori\|auto> <jumlah> <deskripsi>` | Tambah expense (`auto` = auto-categorize) |
| `/expense list` | 10 transaksi terakhir |
| `/expense report [week\|month\|year]` | Ringkasan teks |
| `/expense pdf [week\|month\|year]` | Export PDF |
| `/expense csv [all\|week\|month\|year]` | Export CSV |
| `/expense chart [week\|month\|year]` | Chart bar PNG |
| `/invoice create <customer> <item> <qty> <harga> [note]` | Bikin invoice |
| `/invoice list` | List semua invoice |

### 🎨 Sticker
| Command | Fungsi |
|---|---|
| `/stiker` (alias `/sticker`, `/s`) | Kirim/reply gambar/gif/video → sticker |
| `/stiker <teks>` | Text-to-sticker (transparan + outline) |
| `/brat <teks>` | Brat-style (lime green Charli XCX) |
| `/stext <teks>` | Text sticker putih solid |

### 📥 Media Downloader (butuh `RAPIDAPI_KEY`)
| Command | Fungsi |
|---|---|
| `/igreels <url>` | Download IG Reels |
| `/igfoto <url>` | Download IG post |
| `/igstory <story_id>` | Download IG story |
| `/tiktok <url>` | Download TikTok no-watermark |

### ⚙️ Admin & System
| Command | Akses | Fungsi |
|---|---|---|
| `/admin <nomor>` | owner | Tambah admin baru |
| `/deladmin <nomor>` | owner | Hapus admin |
| `/listadmin` | admin | List semua admin |
| `/maintenance on\|off` | admin | Mode maintenance (cuma owner yg bisa pake bot) |
| `/status` | semua | Dashboard CPU/RAM/uptime/stats |
| `/stats` | semua | Detail statistik bot |
| `/backup` | admin | Backup semua data ke ZIP |
| `/restore <path>` | admin | Restore dari ZIP |
| `/hidetag <pesan>` | admin | Mention semua anggota grup silently |

### 🔧 Utility
| Command | Fungsi |
|---|---|
| `/help` (alias `/menu`) | List command lengkap |
| `/cuaca <kota>` | Info cuaca via OpenWeather |
| `/qr generate <text>` | Generate QR code |
| `/qr scan <reply gambar>` | Scan QR (WIP) |
| `/short <url>` | URL shortener internal |
| `/convert <amount> <from> to <to>` | Currency conversion |
| `/web <query>` | Search web via Exa |
| `/ringkas <url>` | Ringkas artikel via Exa + AI |
| `/jawab <pertanyaan>` | Q&A dari web |
| `/remind <waktu> <pesan>` | Reminder sekali (e.g., `/remind 5m halo`) |
| `/remindme <interval> <pesan>` | Reminder berulang |
| `/sbirthday <nomor> <tanggal> [nama]` | Tambah ulang tahun |
| `/birthday` | List ulang tahun |
| `/send <nomor> <pesan>` | Broadcast (admin only) |
| `/cekwa <nomor>` | Cek nomor terdaftar di WA (WIP) |

## 📁 Struktur Proyek

```
WA-BOT-main/
├── src/
│   └── bot.js                    # Entry point: Baileys connection + message handler
├── modules/
│   ├── commands.js               # handleCommand switch (50+ command)
│   ├── utils.js                  # DB layer (better-sqlite3) + persistence helpers
│   ├── media.js                  # TMDB + Genius + Jikan media search
│   ├── islamic.js                # ✨ NEW: jadwal sholat + qibla + hadits + hijri
│   ├── sticker.js                # ✨ NEW: image/text/brat/animated sticker
│   ├── finance_export.js         # ✨ NEW: PDF/CSV/chart + auto-categorize
│   └── database_migration.js     # JSON → SQLite migration tool
├── scripts/
│   ├── setup.js                  # First-time setup
│   ├── health_check.js           # Real-time health monitor
│   ├── migrate_to_database.js    # CLI migration
│   └── test_prayer_notification.js  # Test aladhan + myquran API
├── config/
│   ├── bot_data.db               # Main SQLite DB (admins, expenses, hutang, dll)
│   └── ai_memory.db              # AI memory (history, user_name, dst)
├── data/
│   └── bot.log                   # Plain text log
├── logs/
│   ├── error-YYYY-MM-DD.log      # Daily-rotated error log
│   └── combined-YYYY-MM-DD.log   # Daily-rotated combined log
├── baileys_auth/                 # WhatsApp session (auto-generated)
├── package.json                  # v2.0.0
├── env.example                   # Template env
├── eslint.config.mjs             # ESLint v9 flat config
├── nodemon.json                  # Nodemon config
├── README.md                     # File ini
├── CHANGELOG.md                  # Detail v2.0.0 overhaul
├── INSTALLATION.md               # Detail install
├── SETUP_GUIDE.md                # Step-by-step setup
└── README_DATABASE_MIGRATION.md  # Migration guide
```

## 🌐 API yang Digunakan

| API | Tujuan | Auth | Cost |
|---|---|---|---|
| [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) | WhatsApp Web protocol | QR scan | free |
| [Google Gemini](https://aistudio.google.com/) | AI chat (model: `gemini-2.0-flash`) | API key | free tier |
| [DeepSeek](https://api.deepseek.com/) / [OpenRouter](https://openrouter.ai/) | AI chat (`deepseek-chat`) | API key | bayar per token (murah) |
| [aladhan.com](https://aladhan.com/prayer-times-api) | Jadwal sholat (utama) | gratis, no-key | free |
| [api.myquran.com](https://api.myquran.com/) | Jadwal sholat (fallback) | no-key | free |
| [hadith.gading.dev](https://hadith.gading.dev/) | Hadits 9 kitab | no-key | free |
| [OpenWeatherMap](https://openweathermap.org/api) | Cuaca | API key | free 60 req/min |
| [RapidAPI - IG Scrapper](https://rapidapi.com/) | Download IG | API key | bayar |
| [TikTok scraper API](https://www.tikwm.com/) | Download TikTok | no-key | free |
| [Exa](https://exa.ai/) | Web search | API key | bayar |
| [TMDB](https://www.themoviedb.org/) | Info film | API key | free |
| [Genius](https://genius.com/api-clients) | Search lirik | API key | free |

## 🗄️ Arsitektur & Database

### Database (`better-sqlite3`)

Bot pake **2 SQLite database** dengan WAL mode:

#### `config/bot_data.db` — main DB
| Tabel | Isi |
|---|---|
| `admins` | Daftar admin |
| `users`, `groups` | User & group tracking |
| `birthdays` | Ulang tahun |
| `expenses` | Expense tracking |
| `invoices` | Invoice generator |
| `hutang` | Pencatatan hutang (legacy) |
| `bot_settings` | Key-value config (maintenance, default city, dll) |
| `bot_stats` | Stats sent/error/uptime |
| `scheduled_messages` | Pesan terjadwal |
| `events` | Event reminder |
| `blacklist` | Blokir user |
| `short_urls` | URL shortener |
| `personal_memory`, `personal_journal`, `user_persona`, `user_facts`, `user_memory_summary` | AI personal memory |

#### `config/ai_memory.db` — AI conversation history
| Tabel | Isi |
|---|---|
| `user_ai_memory` | History chat per-user (JSON) + user_name |

### Single source of truth
- **OWNER_NUMBER**: env-driven (bukan hardcoded lagi)
- **Maintenance status**: `bot_settings.maintenance_mode` di DB (bukan JSON)
- **Logger**: winston (rotating daily) + chalk console
- **Schedulers idempotent**: cuma init sekali walau reconnect berkali-kali

### Anti-loop guards
- Logout > 3x → STOP auto-restart (cegah infinite loop saat auth corrupt)
- Scheduler timer di-track via `scheduledTimeouts` + `clearTimeout` sebelum reschedule
- Delay clamp: kalau `<= 0` → fallback ke nilai default (cegah immediate-fire loop)
- `process.on('unhandledRejection' / 'uncaughtException')` → log tapi ga exit
- Schema-mismatch guard di hutang reminder (ga crash kalau field undef)

## 🐛 Troubleshooting

### `Cannot find module '../build/Release/canvas.node'` / `better_sqlite3.node`
Native binding belum ke-build. Install build tools dulu:
- **Windows:** `winget install Microsoft.VisualStudio.2022.BuildTools` → pilih workload "Desktop development with C++"
- **Linux:** `sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
- Lalu: `npm rebuild`

### Bot ga konek setelah scan QR
1. Hapus folder `baileys_auth/` → `npm start` → scan ulang
2. Pastikan WA versi terbaru di HP
3. Cek log di `logs/combined-*.log`

### Loop reconnect terus-menerus
v2.0.0 udah ada hard limit 3x logout. Kalau masih loop:
1. Hapus `baileys_auth/` manual
2. Restart `node` process (jangan cuma reconnect)

### Jadwal sholat selalu fail
Test API:
```bash
npm run test:prayer
```
Kalau aladhan & myquran sama-sama fail, kemungkinan koneksi internet bermasalah.

### `OWNER_NUMBER` placeholder
Pastikan `.env` udah diisi nomor real (tanpa `@s.whatsapp.net` suffix). Format: `6281234567890`.

### Lint error / build error
```bash
npm run lint
node --check src/bot.js
```

### Database locked
WAL mode aktif tapi multiple instance bot bisa konflik. Pastikan cuma 1 instance jalan:
```bash
# Linux/macOS
pkill -f "node src/bot.js"

# Windows PowerShell
Get-Process node | Stop-Process -Force
```

## 🔒 Security

- ✅ **Rate limiting** token-bucket per-user (5 token, refill 1/s)
- ✅ **Anti-spam**: auto-block setelah 5 aktivitas mencurigakan
- ✅ **Blacklist** user via `/admin`
- ✅ **Maintenance mode**: lockdown ke owner only
- ✅ **No hardcoded credentials**: semua via `.env`
- ✅ **Auth state lokal**: `baileys_auth/` ga sync ke cloud
- ✅ **Group moderation AI**: auto-delete spam/kata kasar
- ⚠️ **Backup ZIP unencrypted** — jangan share file backup sembarangan

## 📈 Monitoring & Logs

### Log levels (set via `LOG_LEVEL` di `.env`)
| Level | Isi |
|---|---|
| `error` | Hanya error |
| `warn` | Error + warning |
| `info` | + info umum (default) |
| `all` | Semua, debug-level |

### Log files
- `logs/error-YYYY-MM-DD.log` — error daily-rotated (max 14 hari)
- `logs/combined-YYYY-MM-DD.log` — combined daily-rotated
- `data/bot.log` — plain text legacy log
- Console: pretty-print dgn chalk + emoji

### Health check
```bash
npm run health      # sekali jalan
npm run monitor     # interval 30s
```

Cek output: API connectivity, DB size, memory usage, uptime, message stats.

## 🧪 Testing

```bash
# test sholat API (validasi aladhan + myquran)
npm run test:prayer

# syntax check semua file
node --check src/bot.js
node --check modules/commands.js
node --check modules/utils.js
node --check modules/islamic.js
node --check modules/sticker.js
node --check modules/finance_export.js

# lint
npm run lint
```

## 🤝 Kontribusi

1. Fork repo
2. Buat branch: `git checkout -b feat/nama-fitur`
3. Commit: `git commit -m 'feat: tambah fitur X'`
4. Push: `git push origin feat/nama-fitur`
5. Buat Pull Request

Lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk panduan lengkap.

### Coding style
- Indentation: 4 spasi
- Bahasa: Indonesia (komentar) atau English (dokumentasi tech)
- ESLint flat config v9 — wajib pass `npm run lint`
- Lazy-require native modules (canvas, sharp, pdfkit) biar modul tetep load di env tanpa build tools

## 🗺️ Roadmap

- [ ] Pecah `commands.js` (2770 lines) jadi modul per-fitur
- [ ] Unit test (Jest/Vitest) untuk semua modul
- [ ] Web dashboard untuk monitoring real-time
- [ ] Multi-instance support dgn Redis pub/sub
- [ ] Voice message support (transcribe via Whisper)
- [ ] Image generation (Gemini Vision / DALL-E)
- [ ] Auto-update mechanism

## 📄 Lisensi

MIT — lihat file [LICENSE](LICENSE).

## 🙏 Credits

- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web protocol
- [Google Gemini](https://ai.google.dev/) — AI chat & moderation
- [DeepSeek](https://www.deepseek.com/) — AI chat backbone
- [aladhan.com](https://aladhan.com/) — Jadwal sholat & qibla
- [myquran.com](https://myquran.com/) — Fallback jadwal sholat
- [hadith.gading.dev](https://hadith.gading.dev/) — API hadits 9 kitab
- [OpenWeatherMap](https://openweathermap.org/) — Cuaca
- [sharp](https://sharp.pixelplumbing.com/) — Image processing
- [PDFKit](https://pdfkit.org/) — PDF generation

---

⭐ **Star repo ini kalau kepake!**
🔧 **Butuh setup detail?** → [SETUP_GUIDE.md](SETUP_GUIDE.md)
📦 **Detail v2.0.0 changes?** → [CHANGELOG.md](CHANGELOG.md)
🗄️ **Migration guide?** → [README_DATABASE_MIGRATION.md](README_DATABASE_MIGRATION.md)
