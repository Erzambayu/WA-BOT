# CHANGELOG v2.0.0 — Full Overhaul (2026-05-21)

## 🐛 Bug fatal yang di-fix

| # | Bug | Lokasi | Impact |
|---|---|---|---|
| 1 | Path salah `../birthdays.json`, `../scheduled_messages.json`, dst | `modules/utils.js` | Data dibaca/tulis ke folder root (gak nyambung dgn config/) |
| 2 | Path log `../bot.log` di root, beda dgn `bot.js` (`data/bot.log`) | `modules/utils.js` | Log nyebar 2 lokasi |
| 3 | `OWNER_JID = NUMBER + '@c.us'` (format whatsapp-web.js) | `src/bot.js:40` | **FATAL**: semua kirim ke OWNER silently fail di Baileys |
| 4 | 12 occurrence `nomor + '@c.us'` di admin/deladmin/send | `modules/commands.js` | Notifikasi admin baru selalu fail |
| 5 | Hardcoded RapidAPI key 4x di IG downloader | `modules/commands.js` | Key bocor di repo + susah rotate |
| 6 | Hardcoded owner number `6285156545003` 8x di bot.js & commands.js | semua | Bot lock-in ke 1 owner specific |
| 7 | API sholat deprecated `muslimsalat.com?key=API_KEY` | `bot.js`, `commands.js`, test script | Jadwal sholat sering fail |
| 8 | `MessageMedia` import dari whatsapp-web.js (dead) | `commands.js:12` | Bloat dependency |
| 9 | Dual SQLite driver: `sqlite3` (async) + `better-sqlite3` (sync) buat DB yg sama | `commands.js`, `utils.js` | Risk lock + redundant |
| 10 | `Promise executor functions should not be async` di `saveUserName` | `commands.js` | Anti-pattern, error swallowed |
| 11 | `formatDuration` dideklarasi 2x di file yg sama | `commands.js:444 & 2483` | no-redeclare error |
| 12 | `isFromTarget` referenced tapi gak pernah didefinisi | `bot.js:1392` | ReferenceError di runtime forward chat |
| 13 | `saveUserName` dipanggil di bot.js tapi gak di-import | `bot.js:1164` | ReferenceError di AI auto-reply |
| 14 | Orphan code blok dari edit lama (try/catch dangling) | `commands.js` 2 tempat | SyntaxError sampai gw fix |
| 15 | `EVENTS_FILE`, `USERS_FILE`, `GROUPS_FILE`, `BANNED_FILE` const di-declare tp file gak pernah dibuat | `utils.js` | Dead noise |

## 🗑️ Dead code & file dihapus

- `modules/finance.js` — modul gak pernah di-require sama sekali
- `modules/maintenance.js` — diganti dgn `botState.setting` di DB (single source of truth)
- `modules/# Code Citations.md` — junk
- `sholat_city.json` di root — duplikat config/sholat_city.json
- 14 file JSON di `config/` yg datanya udah migrate ke DB (admins, birthdays, blacklist, bot_stats, dst)
- `config/maintenance.json`

## 📦 Dependency cleanup

### Dihapus
- `whatsapp-web.js` — bot pake Baileys, wweb full dead path
- `sqlite3` — duplicate dgn `better-sqlite3`, semua DB call distandarisasi
- `jimp` — diimport tp gak pernah dipake (sticker pake sharp)
- `figlet`, `link-preview-js`, `openai`, `node-cache`, `systeminformation` — gak ditemukan di require chain manapun
- `@eslint/css`, `@eslint/json`, `@eslint/markdown` — devDeps gak relevan

### Ditambah
- `pdfkit` — untuk export laporan PDF expense
- (canvas & sharp tetep, sekarang lazy-require)

### Engine
- `node >= 14` → `node >= 18` (14 udah EOL)

## ✨ Fitur baru

### 🕌 Islamic tools (`modules/islamic.js`)
- `getJadwalSholat(city)` — pake **api.aladhan.com** (method 20 = Kemenag RI) dgn fallback **api.myquran.com**
- `formatJadwalSholat(jadwal)` — output siap kirim WA
- `getQibla(city)` — arah kiblat dari kota (degree + kompas 8-arah)
- `getRandomHadith(book)` — 9 kitab: bukhari, muslim, abu-daud, tirmidzi, nasai, ibnu-majah, ahmad, malik, darimi
- `getHijriDate()` — tanggal hijriah hari ini
- Cache in-memory: 12h jadwal sholat, 24h qibla, 1h hadits

**Command baru:** `/qibla [kota]`, `/hadits [kitab]` (alias `/hadith`), `/hijri`. `/sholat` dipindah ke API baru.

### 💰 Finance tracker (`modules/finance_export.js`)
- `autoCategorizeFromDescription(desc)` — 9 kategori (makanan, transport, belanja, hiburan, tagihan, kesehatan, pendidikan, transfer, lainnya) by keyword match
- `exportExpensesPDF(expenses, opts)` — laporan PDF dgn header, summary, breakdown kategori, table detail (auto-paginate)
- `exportExpensesCSV(expenses)` — CSV proper escape
- `generateExpenseChart(expenses)` — bar chart per-kategori (PNG 800x500, top 8)
- `getMonthlyTrend(expenses)` — agregat per bulan
- `filterExpensesByPeriod(list, period)` — week/month/year/all helper

**Command baru:**
- `/expense add auto <jumlah> <deskripsi>` — auto-detect kategori
- `/expense pdf [period]` — export laporan PDF
- `/expense csv [period]` — export CSV
- `/expense chart [period]` — chart PNG

### 🎨 Sticker maker (`modules/sticker.js`)
- `imageToSticker(buffer)` — gambar → webp 512x512 transparan
- `textToSticker(text, opts)` — auto-fit font size (96→18px), word-wrap, outline opsional
- `bratSticker(text)` — Charli XCX style (lime green #8ACE00, lowercase, gaussian blur)
- `animatedToSticker(buffer)` — gif/mp4 → webp animated (fallback frame pertama kalau gagal)

**Command baru:** `/brat <teks>`, `/stext <teks>`. `/stiker` & `/s` (alias) sekarang support animated GIF/video.

## 🔧 Refactor & modernisasi

- `OWNER_NUMBER` & `OWNER_JID` jadi env-driven, tanpa hardcode
- Helper `toJid(num)` di commands.js untuk konversi nomor → JID Baileys
- `readUserAIMemory` / `writeUserAIMemory` rewrite pake **better-sqlite3 sync** + transaction (sebelumnya callback-hell `sqlite3` async + fallback JSON file)
- AI memory DB connection di-share via singleton (`_getAiMemDb`)
- `loadMaintenanceStatus` (file JSON) → `utils.getSetting('maintenance_mode')` (DB)
- Path constants dipusatkan: `CONFIG_DIR`, `DATA_DIR`, `LOGS_DIR` dgn auto-mkdir
- ESLint config rewrite — minimal & realistic rules, no false-positive browser globals
- `package.json`: version bump 1.0 → 2.0, deps di-pin ke version stable terbaru
- Native module (canvas, pdfkit, sharp) di-lazy-require → modul tetep loadable di env tanpa C++ build tools

## 🚦 Verifikasi

- ✅ `node --check` pass: bot.js, commands.js, utils.js, sticker.js, islamic.js, finance_export.js, test_prayer_notification.js
- ✅ ESLint pass: **0 errors**, 80 warnings (semua cosmetic — unused legacy vars di file lama, gak block runtime)
- ✅ Smoke test `finance_export`: auto-categorize 5 kasus akurat, CSV escape OK, monthly trend agregat OK
- ✅ Smoke test `islamic`: load clean, compass conversion (0°/90°/295°) akurat
- ⚠️ Native modules (canvas, sharp, better-sqlite3) butuh `npm install` di host dgn VS C++ build tools (Windows) atau `build-essential` (Linux). Lo udah punya itu, jadi tinggal `npm install` ulang tanpa `--ignore-scripts`.

## 🧨 Breaking changes

1. **`OWNER_NUMBER` di `.env` sekarang WAJIB diisi** (sebelumnya placeholder string masih lolos)
2. **`MAINTENANCE_FILE` (config/maintenance.json) gak dipake lagi** — status pindah ke DB (`bot_settings.maintenance_mode`)
3. **Tabel `hutang` schema** — handler bot.js akses field `user`/`jenis`/`tanggal_tagih` yang gak ada di schema asli. **TIDAK gw ubah** karena risk merusak data existing — biarkan handler hutang yg align ke schema saat ada user pake fitur ini.
4. **`scheduleMotivasiHarian`** — body-nya udah disabled sejak sebelum overhaul (return early). Gw biarin sebagai placeholder buat re-enable nanti.
5. **wweb's `MessageMedia`** — kalau lo punya custom plugin yg pake ini, harus migrasi ke Baileys `sock.sendMessage(jid, { image/video/document })`.

## 🚀 Cara jalanin (post-overhaul)

```bash
# 1. install deps (butuh VS C++ atau build-essential untuk native modules)
npm install

# 2. copy & isi env
cp env.example .env
# wajib isi: OWNER_NUMBER, GEMINI_API_KEY, DEEPSEEK_API_KEY, OPENWEATHER_API_KEY

# 3. setup DB
npm run setup

# 4. test prayer API (validasi aladhan & myquran working)
npm run test:prayer

# 5. start
npm start
# atau dev mode
npm run dev
```

## 🗺️ Struktur folder hasil overhaul

```
WA-BOT-main/
├── src/
│   └── bot.js               # entry point, baileys connection, message handler
├── modules/
│   ├── commands.js          # handleCommand switch (~2770 lines, masih monolith)
│   ├── utils.js             # DB layer + persistence helpers
│   ├── media.js             # TMDB/genius/jikan media search
│   ├── islamic.js           # ✨ NEW: jadwal sholat + qibla + hadits + hijri
│   ├── sticker.js           # ✨ NEW: image/text/brat/animated sticker maker
│   ├── finance_export.js    # ✨ NEW: PDF/CSV/chart + auto-categorize
│   └── database_migration.js
├── scripts/
│   ├── setup.js
│   ├── health_check.js
│   ├── migrate_to_database.js
│   └── test_prayer_notification.js  # rewrite pake aladhan
├── config/                  # bot_data.db + ai_memory.db (DB only, no JSON)
├── data/                    # bot.log
├── logs/                    # winston rotating logs
├── package.json             # v2.0.0
├── env.example              # env template (clean)
└── eslint.config.mjs        # minimal & realistic
```

## 📝 Catatan iterasi berikutnya (kalau mau lanjut)

- **commands.js masih 2770 lines** — mau di-split per-fitur (commands/ai.js, commands/finance.js, dst) tapi risk regressi tinggi tanpa test suite. Disarankan setup unit test dulu.
- **Hutang schema mismatch** — perlu migration script + audit semua handler hutang.
- **`getSystemInfo`** pake `df -k /` (linux-only) — perlu cross-platform `os.totalmem`/diskusage lib.
- **AI auto-reply DM** masih punya potensi memory leak di setInterval (rate limiter + AI memory cleanup) — sekarang udah ada cleanup tapi belum bisa cancel saat shutdown.
- **`/cekwa`** masih placeholder — bisa di-implement pake `sock.onWhatsApp([jid])` dari Baileys.
