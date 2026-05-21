# 🔧 Panduan Setup Bot WhatsApp

Panduan khusus untuk mengatur nomor bot dan admin setelah instalasi.

## 📱 Langkah 1: Setup Nomor Bot

### 1.1 Persiapan
- Pastikan Anda memiliki 2 nomor WhatsApp berbeda:
  - **Nomor Bot**: Nomor yang akan digunakan sebagai bot
  - **Nomor Owner**: Nomor pribadi Anda sebagai admin utama

### 1.2 Setup Environment Variables

Edit file `.env` dan atur konfigurasi berikut:

```env
# ========== NOMOR BOT & OWNER ==========
BOT_NUMBER=628xxxxxxxxxx@s.whatsapp.net
OWNER_NUMBER=628xxxxxxxxxx

# Contoh:
# BOT_NUMBER=6281234567890@s.whatsapp.net
# OWNER_NUMBER=6289876543210
```

**⚠️ PENTING:**
- `BOT_NUMBER`: Nomor yang akan menjadi bot (format: 628xxxxxxxxxx@s.whatsapp.net)
- `OWNER_NUMBER`: Nomor owner tanpa @s.whatsapp.net atau @c.us
- Pastikan kedua nomor berbeda!

### 1.3 Verifikasi Setting

Setelah edit `.env`, restart bot:
```bash
npm restart
```

## 📋 Langkah 2: Setup Admin

### 2.1 Menambah Admin Pertama Kali

Setelah bot berhasil terhubung:

1. **Kirim pesan dari nomor owner** ke bot:
   ```
   /addadmin @6281234567890
   ```
   (ganti nomor dengan nomor yang ingin dijadikan admin)

2. **Atau tambah admin tanpa mention:**
   ```
   /addadmin 6281234567890
   ```

### 2.2 Verifikasi Admin

Cek daftar admin:
```
/admins
```

### 2.3 Menambah Admin Berikutnya

Hanya owner atau admin yang bisa menambah admin baru:
```
/addadmin @6282345678901
```

### 2.4 Menghapus Admin

```
/removeadmin @6281234567890
```

## 🔐 Langkah 3: Test Konfigurasi

### 3.1 Test dari Nomor Owner
```
/status
/system
/help
```

### 3.2 Test dari Nomor Admin
```
/status
/addadmin [nomor-test]
```

### 3.3 Test dari Nomor Biasa
```
/help
/ai hello
```

## ⚙️ Langkah 4: Konfigurasi Lanjutan

### 4.1 Setting Maintenance Mode

**Aktifkan maintenance** (hanya owner bisa akses):
```
/maintenance on
```

**Nonaktifkan maintenance:**
```
/maintenance off
```

### 4.2 Setting Kota Default

**Set kota untuk sholat:**
```
/setcity jakarta
```

**Cek setting kota:**
```
/sholat
```

### 4.3 Backup & Restore

**Backup data:**
```
/backup
```

**Restore data:**
```
/restore
```

## 🔄 Langkah 5: Troubleshooting

### 5.1 Bot Tidak Merespon Commands

**Solusi:**
1. Pastikan nomor Anda sudah jadi admin:
   ```
   /admins
   ```

2. Cek status bot:
   ```
   /status
   ```

3. Restart bot jika perlu:
   ```bash
   npm restart
   ```

### 5.2 Tidak Bisa Tambah Admin

**Masalah:** Error saat `/addadmin`

**Solusi:**
1. Pastikan Anda owner atau admin
2. Pastikan format nomor benar (contoh: 6281234567890)
3. Jangan pakai karakter spesial selain @ untuk mention

### 5.3 Nomor Bot Salah

**Masalah:** QR code sudah di-scan tapi nomor bot tidak sesuai

**Solusi:**
1. Stop bot: `npm stop`
2. Hapus session: `rm -rf baileys_auth/`
3. Edit `.env` dengan nomor yang benar
4. Start ulang: `npm start`
5. Scan QR code lagi

### 5.4 Environment Variables Tidak Terbaca

**Masalah:** Bot menggunakan placeholder values

**Solusi:**
1. Pastikan file `.env` ada di root directory
2. Pastikan format `.env` benar (tanpa spasi di sekitar =)
3. Restart bot setelah edit `.env`

## 📝 Template Konfigurasi Lengkap

Berikut template `.env` yang sudah lengkap:

```env
# ========== REQUIRED API KEYS ==========
GEMINI_API_KEY=AIzaSyA...your_key_here
DEEPSEEK_API_KEY=sk-...your_key_here
OPENWEATHER_API_KEY=your_key_here

# ========== NOMOR BOT & OWNER ==========
BOT_NUMBER=628xxxxxxxxxx@s.whatsapp.net
OWNER_NUMBER=628xxxxxxxxxx

# ========== OPTIONAL API KEYS ==========
RAPIDAPI_KEY=your_rapidapi_key_here
EXA_API_KEY=your_exa_key_here
TMDB_API_KEY=your_tmdb_key_here
GENIUS_API_KEY=your_genius_key_here

# ========== SETTINGS ==========
LOG_LEVEL=info
NODE_ENV=production
```

## 🚀 Quick Start Checklist

- [ ] ✅ Install dependencies (`npm install`)
- [ ] ✅ Run setup script (`npm run setup`)
- [ ] ✅ Edit `.env` dengan API keys
- [ ] ✅ Set `BOT_NUMBER` dan `OWNER_NUMBER` di `.env`
- [ ] ✅ Start bot (`npm start`)
- [ ] ✅ Scan QR code dengan nomor bot
- [ ] ✅ Test command `/status` dari nomor owner
- [ ] ✅ Tambah admin dengan `/addadmin`
- [ ] ✅ Test semua fitur utama
- [ ] ✅ Set kota default dengan `/setcity`
- [ ] ✅ Backup konfigurasi dengan `/backup`

## 📞 Support

Jika masih ada masalah:

1. **Cek log error:**
   ```bash
   npm run logs
   ```

2. **Cek health:**
   ```bash
   npm run health
   ```

3. **Restart clean:**
   ```bash
   npm run stop
   rm -rf baileys_auth/
   npm start
   ```

4. **Buat issue di GitHub** dengan detail:
   - OS dan Node.js version
   - Error message lengkap
   - Langkah yang sudah dicoba

---

🎉 **Bot siap digunakan!** Selamat menikmati fitur-fitur canggih WhatsApp Bot AI! 