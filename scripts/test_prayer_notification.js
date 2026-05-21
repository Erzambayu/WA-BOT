#!/usr/bin/env node
/**
 * Test prayer notification — versi baru pake modules/islamic (aladhan + myquran)
 */
const moment = require('moment-timezone');
const path = require('path');
const Database = require('better-sqlite3');
const islamic = require('../modules/islamic');

const TEST_CITIES = ['Jakarta', 'Bekasi', 'Bandung', 'Surabaya'];
const DB_PATH = path.join(__dirname, '../config/bot_data.db');

console.log('🕌 Prayer Time Notification Test Suite (aladhan + myquran)');
console.log('==========================================================\n');

async function testPrayerTimeAPI() {
    console.log('📡 Testing Prayer Time API...');
    for (const city of TEST_CITIES) {
        try {
            console.log(`   Testing city: ${city}`);
            const j = await islamic.getJadwalSholat(city);
            if (j) {
                console.log(`   ✅ ${city} (${j.source}): ${j.subuh}, ${j.dzuhur}, ${j.ashar}, ${j.maghrib}, ${j.isya}`);
            } else {
                console.log(`   ❌ ${city}: gagal ambil jadwal`);
            }
        } catch (error) {
            console.log(`   ❌ ${city}: ${error.message}`);
        }
    }
    console.log('');
}

function testDatabaseSettings() {
    console.log('🗄️  Testing Database Settings...');
    try {
        const db = new Database(DB_PATH, { readonly: true });
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bot_settings'").get();
        if (tables) {
            console.log('   ✅ bot_settings table exists');
            const setting = db.prepare("SELECT * FROM bot_settings WHERE key = 'default_sholat_city'").get();
            if (setting) {
                const city = JSON.parse(setting.value);
                console.log(`   ✅ Prayer city setting: ${city}`);
            } else {
                console.log('   ⚠️  Prayer city setting not found');
            }
        } else {
            console.log('   ❌ bot_settings table not found');
        }
        db.close();
    } catch (error) {
        console.log(`   ❌ Database error: ${error.message}`);
    }
    console.log('');
}

function testSchedulingLogic() {
    console.log('⏰ Testing Scheduling Logic...');
    const now = moment.tz('Asia/Jakarta');
    const today = now.format('YYYY-MM-DD');
    const mockTimes = { subuh: '04:34', dzuhur: '11:50', ashar: '15:12', maghrib: '17:47', isya: '18:58' };
    console.log(`   Current time: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    let futureCount = 0;
    Object.entries(mockTimes).forEach(([nama, waktu]) => {
        const waktuSholat = moment.tz(`${today} ${waktu}`, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
        const delay = waktuSholat.diff(now);
        const isFuture = delay > 0;
        if (isFuture) futureCount++;
        console.log(`   ${nama}: ${waktu} ${isFuture ? '(Future ✅)' : '(Past ❌)'} - Delay: ${Math.round(delay/1000)}s`);
    });
    console.log(`   ✅ ${futureCount} future prayer times would be scheduled`);
    console.log('');
}

async function simulateNotificationScheduling() {
    console.log('🔔 Simulating Notification Scheduling (Jakarta, live)...');
    try {
        const j = await islamic.getJadwalSholat('Jakarta');
        if (!j) { console.log('   ❌ gagal ambil data live'); return; }
        const now = moment.tz('Asia/Jakarta');
        const today = now.format('YYYY-MM-DD');
        console.log(`   Live data for Jakarta on ${today} (${j.source}):`);
        ['subuh','dzuhur','ashar','maghrib','isya'].forEach(nama => {
            const waktu = j[nama];
            const waktuSholat = moment.tz(`${today} ${waktu}`, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
            const delay = waktuSholat.diff(now);
            const isFuture = delay > 0;
            console.log(`   ${nama}: ${waktu} ${isFuture ? '✅' : '❌'} (${isFuture ? Math.round(delay/1000) + 's' : 'passed'})`);
        });
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
    }
    console.log('');
}

async function testQibla() {
    console.log('🧭 Testing Qibla Direction...');
    try {
        const q = await islamic.getQibla('Jakarta');
        if (q) console.log(`   ✅ Jakarta qibla: ${q.direction}° (${islamic.compassFromBearing(q.direction)})`);
        else console.log('   ❌ gagal ambil qibla');
    } catch (e) {
        console.log(`   ❌ ${e.message}`);
    }
    console.log('');
}

async function testHadith() {
    console.log('📖 Testing Random Hadith...');
    try {
        const h = await islamic.getRandomHadith('bukhari');
        if (h) console.log(`   ✅ ${h.book} #${h.number} — ${(h.id || '').substring(0, 80)}...`);
        else console.log('   ❌ gagal ambil hadits');
    } catch (e) {
        console.log(`   ❌ ${e.message}`);
    }
    console.log('');
}

function testResetLogic() {
    console.log('🔄 Testing Daily Reset Logic...');
    const now = moment.tz('Asia/Jakarta');
    const tomorrow = now.clone().add(1, 'day').startOf('day');
    const delay = tomorrow.diff(now);
    console.log(`   Current: ${now.format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`   Reset:   ${tomorrow.format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`   Delay:   ${Math.round(delay/1000)}s (${Math.round(delay/1000/3600)}h)`);
    console.log('');
}

async function runAllTests() {
    const startTime = Date.now();
    try {
        await testPrayerTimeAPI();
        testDatabaseSettings();
        testSchedulingLogic();
        await simulateNotificationScheduling();
        await testQibla();
        await testHadith();
        testResetLogic();
        const duration = Date.now() - startTime;
        console.log('🎉 All Tests Completed!');
        console.log(`⏱️  Total execution time: ${duration}ms`);
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) runAllTests();

module.exports = {
    testPrayerTimeAPI,
    testDatabaseSettings,
    testSchedulingLogic,
    simulateNotificationScheduling,
    testQibla,
    testHadith,
    testResetLogic
};
