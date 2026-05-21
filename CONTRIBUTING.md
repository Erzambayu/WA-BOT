# Contributing to WhatsApp Bot AI

Terima kasih atas minat Anda untuk berkontribusi pada proyek WhatsApp Bot AI! 🎉

## 📋 Cara Berkontribusi

### 1. Fork Repository
- Klik tombol "Fork" di halaman GitHub
- Clone repository yang sudah di-fork ke lokal Anda

```bash
git clone https://github.com/your-username/whatsapp-bot.git
cd whatsapp-bot
```

### 2. Setup Development Environment

```bash
# Install dependencies
npm install

# Setup project
npm run setup

# Copy environment variables
cp env.example .env
# Edit .env dan isi API keys Anda
```

### 3. Buat Branch Baru

```bash
git checkout -b feature/nama-fitur-anda
```

### 4. Coding Guidelines

#### Style Guide
- Gunakan ESLint untuk memastikan konsistensi kode
- Ikuti konvensi penamaan camelCase untuk variabel dan fungsi
- Gunakan komentar Indonesia untuk dokumentasi
- Pastikan kode dapat dibaca dan dipahami

#### Best Practices
- Selalu test fitur baru sebelum commit
- Jangan commit API keys atau data pribadi
- Update dokumentasi jika diperlukan
- Gunakan commit message yang jelas dan deskriptif

### 5. Testing

```bash
# Jalankan bot untuk testing
npm run dev

# Test specific feature
npm run test:prayer

# Cek lint
npm run lint
```

### 6. Commit Changes

```bash
git add .
git commit -m "feat: tambah fitur awesome baru"
```

#### Commit Message Convention
- `feat:` untuk fitur baru
- `fix:` untuk bug fix
- `docs:` untuk update dokumentasi
- `style:` untuk perubahan formatting
- `refactor:` untuk refactoring kode
- `test:` untuk menambah/update tests
- `chore:` untuk maintenance tasks

### 7. Push dan Create Pull Request

```bash
git push origin feature/nama-fitur-anda
```

- Buka GitHub dan create Pull Request
- Berikan deskripsi yang jelas tentang perubahan
- Reference issue yang terkait (jika ada)

## 🐛 Melaporkan Bug

### Sebelum Melaporkan Bug
1. Pastikan bug belum dilaporkan di [Issues](https://github.com/your-username/whatsapp-bot/issues)
2. Coba dengan versi terbaru
3. Periksa dokumentasi dan FAQ

### Template Bug Report
```markdown
**Deskripsi Bug**
Penjelasan singkat dan jelas tentang bug

**Langkah Reproduksi**
1. Lakukan '...'
2. Klik pada '...'
3. Scroll ke '...'
4. Lihat error

**Expected Behavior**
Apa yang seharusnya terjadi

**Actual Behavior**
Apa yang benar-benar terjadi

**Screenshots**
Jika ada, tambahkan screenshot

**Environment:**
- OS: [e.g. Windows 10]
- Node.js version: [e.g. 18.0.0]
- Bot version: [e.g. 1.0.0]

**Additional Context**
Konteks tambahan atau informasi lain
```

## 💡 Saran Fitur

### Template Feature Request
```markdown
**Apakah feature request terkait dengan masalah?**
Deskripsi jelas tentang masalah. Ex. Saya frustrasi ketika [...]

**Solusi yang Anda inginkan**
Deskripsi jelas tentang apa yang Anda inginkan

**Alternatif yang sudah dipertimbangkan**
Deskripsi solusi atau fitur alternatif lain

**Additional Context**
Konteks tambahan, screenshot, atau informasi lain
```

## 🏗️ Areas yang Butuh Kontribusi

### High Priority
- [ ] Optimasi performance database
- [ ] Unit testing coverage
- [ ] Error handling improvement
- [ ] Documentation improvement

### Medium Priority
- [ ] New AI integrations
- [ ] More media processing features
- [ ] Advanced scheduling features
- [ ] Better logging system

### Low Priority
- [ ] UI improvements for logs
- [ ] More language support
- [ ] Plugin system
- [ ] Advanced statistics

## 📚 Development Resources

### Dokumentasi
- [Baileys Documentation](https://github.com/whiskeysockets/Baileys)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [SQLite Documentation](https://www.sqlite.org/docs.html)

### Tools
- [VSCode](https://code.visualstudio.com/) - Recommended editor
- [Postman](https://www.postman.com/) - For API testing
- [DB Browser for SQLite](https://sqlitebrowser.org/) - Database management

## 🚀 Release Process

1. Update version di `package.json`
2. Update `CHANGELOG.md`
3. Create release tag
4. Create GitHub release dengan release notes

## 📝 Code of Conduct

- Bersikap profesional dan menghormati kontributor lain
- Fokus pada feedback yang konstruktif
- Welcome untuk semua level programmer
- Bantu sesama developer dengan sabar

## ❓ Bantuan

Jika Anda butuh bantuan:

1. Cek [README.md](README.md) dan dokumentasi
2. Search di [Issues](https://github.com/your-username/whatsapp-bot/issues)
3. Buat issue baru dengan label `question`
4. Join diskusi di [Discussions](https://github.com/your-username/whatsapp-bot/discussions)

---

Terima kasih sudah berkontribusi! 🙏 