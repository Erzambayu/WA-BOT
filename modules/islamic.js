/**
 * modules/islamic.js — Islamic tools terpadu
 * - Jadwal sholat: API aladhan.com (akurat, gratis, no-key) dgn fallback ke api.myquran.com
 * - Qibla compass: aladhan qibla
 * - Hadits random: api.hadith.gading.dev
 * - Geocoding nama kota → lat/lon: aladhan timingsByCity (sekali pakai) atau open-meteo geocoding
 * - In-memory cache 12 jam untuk timings, 24 jam untuk qibla, 1 jam hadits random
 */
const axios = require('axios');
const moment = require('moment-timezone');

// ===== CACHE =====
const _cache = new Map();
function _cget(key) {
    const e = _cache.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) { _cache.delete(key); return null; }
    return e.val;
}
function _cset(key, val, ttlMs) { _cache.set(key, { val, exp: Date.now() + ttlMs }); }

// ===== CONFIG =====
const ALADHAN_BASE = 'https://api.aladhan.com/v1';
const MYQURAN_BASE = 'https://api.myquran.com/v2/sholat';
const HADITH_BASE = 'https://api.hadith.gading.dev';
const HTTP_TIMEOUT = 12000;

const PRAYER_NAMES_ID = {
    Fajr: 'subuh',
    Dhuhr: 'dzuhur',
    Asr: 'ashar',
    Maghrib: 'maghrib',
    Isha: 'isya'
};

const PRAYER_LABELS = {
    subuh: '🌅 Subuh',
    dzuhur: '☀️ Dzuhur',
    ashar: '🌤️ Ashar',
    maghrib: '🌇 Maghrib',
    isya: '🌙 Isya'
};

/**
 * Ambil jadwal sholat untuk kota tertentu pada hari ini.
 * Fallback: aladhan → myquran (kalau aladhan fail).
 * Output: { city, date, subuh, dzuhur, ashar, maghrib, isya, source }
 */
async function getJadwalSholat(city = 'Jakarta', dateMoment = null) {
    const date = dateMoment || moment.tz('Asia/Jakarta');
    const dateKey = date.format('YYYY-MM-DD');
    const cacheKey = `sholat:${city.toLowerCase()}:${dateKey}`;
    const cached = _cget(cacheKey);
    if (cached) return cached;

    // === aladhan (utama) ===
    try {
        const url = `${ALADHAN_BASE}/timingsByCity/${date.format('DD-MM-YYYY')}`;
        const res = await axios.get(url, {
            params: { city, country: 'Indonesia', method: 20 }, // method 20 = Kemenag RI
            timeout: HTTP_TIMEOUT
        });
        const t = res.data?.data?.timings;
        if (t && t.Fajr) {
            const result = {
                city: res.data.data.meta?.timezone ? city : city,
                date: dateKey,
                subuh: t.Fajr.split(' ')[0],
                dzuhur: t.Dhuhr.split(' ')[0],
                ashar: t.Asr.split(' ')[0],
                maghrib: t.Maghrib.split(' ')[0],
                isya: t.Isha.split(' ')[0],
                source: 'aladhan'
            };
            _cset(cacheKey, result, 12 * 3600 * 1000);
            return result;
        }
    } catch (e) {
        // jatuh ke fallback
    }

    // === myquran (fallback) — perlu kode kota numerik ===
    try {
        const kotaRes = await axios.get(`${MYQURAN_BASE}/kota/cari/${encodeURIComponent(city)}`, { timeout: HTTP_TIMEOUT });
        const kotaList = kotaRes.data?.data;
        if (kotaList && kotaList.length > 0) {
            const kotaId = kotaList[0].id;
            const ymd = date.format('YYYY/MM/DD');
            const jadwalRes = await axios.get(`${MYQURAN_BASE}/jadwal/${kotaId}/${ymd}`, { timeout: HTTP_TIMEOUT });
            const j = jadwalRes.data?.data?.jadwal;
            if (j && j.subuh) {
                const result = {
                    city: jadwalRes.data.data.lokasi || city,
                    date: dateKey,
                    subuh: j.subuh,
                    dzuhur: j.dzuhur,
                    ashar: j.ashar,
                    maghrib: j.maghrib,
                    isya: j.isya,
                    source: 'myquran'
                };
                _cset(cacheKey, result, 12 * 3600 * 1000);
                return result;
            }
        }
    } catch (e) {
        // sudah dua-duanya gagal
    }

    return null;
}

/**
 * Format jadwal sholat ke text WA siap kirim.
 */
function formatJadwalSholat(jadwal) {
    if (!jadwal) return '❌ Gagal mengambil jadwal sholat. Coba kota lain atau cek koneksi.';
    return (
        `🕌 *Jadwal Sholat*\n` +
        `📍 ${jadwal.city}\n` +
        `📅 ${jadwal.date}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${PRAYER_LABELS.subuh}    : *${jadwal.subuh}*\n` +
        `${PRAYER_LABELS.dzuhur}   : *${jadwal.dzuhur}*\n` +
        `${PRAYER_LABELS.ashar}    : *${jadwal.ashar}*\n` +
        `${PRAYER_LABELS.maghrib}  : *${jadwal.maghrib}*\n` +
        `${PRAYER_LABELS.isya}     : *${jadwal.isya}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_via ${jadwal.source}_\n` +
        `_Jangan lupa sholat tepat waktu_ 🤲`
    );
}

/**
 * Ambil arah qibla (derajat dari utara, searah jarum jam) dari nama kota.
 */
async function getQibla(city = 'Jakarta') {
    const cacheKey = `qibla:${city.toLowerCase()}`;
    const cached = _cget(cacheKey);
    if (cached) return cached;

    try {
        // gunakan endpoint cityInfo untuk geocoding
        const cityRes = await axios.get(`${ALADHAN_BASE}/addressInfo`, {
            params: { address: `${city}, Indonesia` },
            timeout: HTTP_TIMEOUT
        });
        const lat = cityRes.data?.data?.latitude;
        const lon = cityRes.data?.data?.longitude;
        if (typeof lat !== 'number' || typeof lon !== 'number') return null;

        const qRes = await axios.get(`${ALADHAN_BASE}/qibla/${lat}/${lon}`, { timeout: HTTP_TIMEOUT });
        const direction = qRes.data?.data?.direction;
        if (typeof direction !== 'number') return null;

        const result = { city, lat, lon, direction: Math.round(direction * 100) / 100 };
        _cset(cacheKey, result, 24 * 3600 * 1000);
        return result;
    } catch (e) {
        return null;
    }
}

function formatQibla(q) {
    if (!q) return '❌ Gagal mengambil arah kiblat. Coba kota lain.';
    const compass = compassFromBearing(q.direction);
    return (
        `🧭 *Arah Kiblat*\n` +
        `📍 ${q.city} (${q.lat.toFixed(4)}, ${q.lon.toFixed(4)})\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 Arah dari Utara: *${q.direction}°*\n` +
        `🧭 Kompas: *${compass}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Hadapkan diri searah dengan ${q.direction}° dari utara untuk menghadap Ka'bah._ 🕋`
    );
}

function compassFromBearing(deg) {
    const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
    const idx = Math.round(((deg % 360) / 45)) % 8;
    return dirs[idx];
}

/**
 * Hadits random dari koleksi populer (BCD: bukhari, muslim, abu-daud, dst)
 * Pake api.hadith.gading.dev (gratis, no-key)
 */
const HADITH_BOOKS = {
    bukhari: { name: 'Shahih Bukhari', max: 7008 },
    muslim: { name: 'Shahih Muslim', max: 5362 },
    'abu-daud': { name: 'Sunan Abu Daud', max: 4419 },
    tirmidzi: { name: 'Sunan Tirmidzi', max: 3625 },
    nasai: { name: 'Sunan An-Nasai', max: 5662 },
    'ibnu-majah': { name: 'Sunan Ibnu Majah', max: 4332 },
    ahmad: { name: 'Musnad Ahmad', max: 26363 },
    malik: { name: 'Muwatta Malik', max: 1594 },
    darimi: { name: 'Sunan Ad-Darimi', max: 3367 }
};

async function getRandomHadith(book = 'bukhari') {
    const b = HADITH_BOOKS[book.toLowerCase()] || HADITH_BOOKS.bukhari;
    const num = Math.floor(Math.random() * b.max) + 1;
    const cacheKey = `hadith:${book}:${num}`;
    const cached = _cget(cacheKey);
    if (cached) return cached;

    try {
        const res = await axios.get(`${HADITH_BASE}/books/${book}/${num}`, { timeout: HTTP_TIMEOUT });
        const d = res.data?.data;
        if (!d) return null;
        const result = {
            book: b.name,
            number: d.number,
            arab: d.contents?.arab || '',
            id: d.contents?.id || ''
        };
        _cset(cacheKey, result, 60 * 60 * 1000);
        return result;
    } catch (e) {
        return null;
    }
}

function formatHadith(h) {
    if (!h) return '❌ Gagal mengambil hadits. Coba lagi sebentar.';
    return (
        `📖 *${h.book}* No.${h.number}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        (h.arab ? `${h.arab}\n\n` : '') +
        `_${h.id}_\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📚 _Sumber: hadith.gading.dev_`
    );
}

/**
 * Tanggal hijriah dari hari ini.
 */
async function getHijriDate() {
    const today = moment.tz('Asia/Jakarta').format('DD-MM-YYYY');
    const cacheKey = `hijri:${today}`;
    const cached = _cget(cacheKey);
    if (cached) return cached;
    try {
        const res = await axios.get(`${ALADHAN_BASE}/gToH/${today}`, { timeout: HTTP_TIMEOUT });
        const h = res.data?.data?.hijri;
        if (!h) return null;
        const result = {
            day: h.day,
            month: h.month?.en,
            monthAr: h.month?.ar,
            year: h.year,
            weekday: h.weekday?.en,
            formatted: `${h.day} ${h.month?.en} ${h.year} H`
        };
        _cset(cacheKey, result, 12 * 3600 * 1000);
        return result;
    } catch (e) {
        return null;
    }
}

module.exports = {
    getJadwalSholat,
    formatJadwalSholat,
    getQibla,
    formatQibla,
    getRandomHadith,
    formatHadith,
    getHijriDate,
    PRAYER_NAMES_ID,
    PRAYER_LABELS,
    HADITH_BOOKS,
    compassFromBearing
};
