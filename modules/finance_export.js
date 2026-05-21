/**
 * modules/finance_export.js — Finance tracker upgrade
 * - exportExpensesPDF: bikin laporan PDF (judul, total, breakdown, table)
 * - exportExpensesCSV: ekspor CSV mentah
 * - generateExpenseChart: chart bar via canvas (per-kategori)
 * - autoCategorizeFromDescription: auto-detect kategori dari kata kunci
 * - getMonthlyTrend: agregat per-tanggal
 *
 * NOTE: canvas & pdfkit di-lazy-require biar modul ini tetep bisa di-load
 * walau native binding canvas belum ke-build (mis. CI tanpa VS C++).
 */
const moment = require('moment-timezone');

// ===== AUTO CATEGORIZE =====
const CATEGORY_KEYWORDS = {
    makanan: ['makan', 'kopi', 'kuliner', 'resto', 'cafe', 'warteg', 'gofood', 'grabfood', 'shopeefood', 'starbucks', 'kfc', 'mcd', 'pizza', 'nasi', 'mie', 'bakso', 'sate', 'bubur', 'roti', 'jajan'],
    transport: ['gojek', 'grab', 'taxi', 'bensin', 'parkir', 'tol', 'kereta', 'krl', 'mrt', 'transjakarta', 'busway', 'pesawat', 'tiket', 'ojol', 'uber'],
    belanja: ['shopee', 'tokopedia', 'lazada', 'tiktokshop', 'blibli', 'bukalapak', 'baju', 'sepatu', 'tas', 'kosmetik', 'mall', 'supermarket', 'indomaret', 'alfamart'],
    hiburan: ['netflix', 'spotify', 'disney', 'youtube', 'bioskop', 'xxi', 'cgv', 'game', 'steam', 'mobile legends', 'genshin', 'konser', 'tiket'],
    tagihan: ['listrik', 'pln', 'air', 'pdam', 'internet', 'wifi', 'pulsa', 'paket data', 'telkom', 'indihome', 'first media', 'biznet', 'sewa', 'kos', 'kontrakan'],
    kesehatan: ['dokter', 'rumah sakit', 'rs ', 'apotek', 'obat', 'vitamin', 'klinik', 'lab', 'gym', 'fitness'],
    pendidikan: ['kuliah', 'sekolah', 'kursus', 'buku', 'les', 'training', 'webinar', 'udemy', 'coursera'],
    transfer: ['transfer', 'kirim', 'topup', 'top up', 'gopay', 'ovo', 'dana', 'shopeepay'],
    lainnya: []
};

function autoCategorizeFromDescription(desc) {
    if (!desc) return 'lainnya';
    const text = String(desc).toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const kw of keywords) {
            if (text.includes(kw)) return cat;
        }
    }
    return 'lainnya';
}

// ===== CSV EXPORT =====
function exportExpensesCSV(expenses) {
    if (!Array.isArray(expenses) || expenses.length === 0) return 'date,category,amount,description\n';
    const header = 'date,category,amount,description\n';
    const rows = expenses.map(e => {
        const desc = String(e.description || '').replace(/"/g, '""');
        return `${e.date},${e.category},${e.amount},"${desc}"`;
    }).join('\n');
    return header + rows + '\n';
}

// ===== PDF EXPORT =====
/**
 * Generate PDF buffer dari list expense.
 * @returns {Promise<Buffer>}
 */
function exportExpensesPDF(expenses, opts = {}) {
    return new Promise((resolve, reject) => {
        try {
            const PDFDocument = require('pdfkit');
            const doc = new PDFDocument({ size: 'A4', margin: 40 });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const title = opts.title || 'Laporan Pengeluaran';
            const period = opts.period || 'all';
            const owner = opts.owner || '-';
            const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

            // Header
            doc.fontSize(20).fillColor('#1F2937').text(title, { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(10).fillColor('#6B7280').text(`Periode: ${period.toUpperCase()}  |  Pemilik: ${owner}`, { align: 'center' });
            doc.fontSize(10).fillColor('#6B7280').text(`Dibuat: ${moment().tz('Asia/Jakarta').format('DD MMM YYYY HH:mm')}`, { align: 'center' });
            doc.moveDown(1);

            // Summary box
            doc.fontSize(12).fillColor('#111827').text('Ringkasan', { underline: true });
            doc.moveDown(0.3);
            doc.fontSize(10).fillColor('#374151')
                .text(`Total transaksi : ${expenses.length}`)
                .text(`Total nominal   : Rp ${total.toLocaleString('id-ID')}`)
                .text(`Rata-rata       : Rp ${expenses.length ? Math.round(total / expenses.length).toLocaleString('id-ID') : 0}`);
            doc.moveDown(0.7);

            // Breakdown by category
            const byCat = {};
            for (const e of expenses) {
                const c = e.category || 'lainnya';
                byCat[c] = (byCat[c] || 0) + Number(e.amount || 0);
            }
            doc.fontSize(12).fillColor('#111827').text('Breakdown per Kategori', { underline: true });
            doc.moveDown(0.3);
            const sorted = Object.entries(byCat).sort(([, a], [, b]) => b - a);
            for (const [cat, amt] of sorted) {
                const pct = total ? ((amt / total) * 100).toFixed(1) : '0.0';
                doc.fontSize(10).fillColor('#374151').text(`• ${cat.padEnd(15, ' ')}  Rp ${amt.toLocaleString('id-ID').padStart(15, ' ')}  (${pct}%)`);
            }
            doc.moveDown(0.7);

            // Detail table
            doc.fontSize(12).fillColor('#111827').text('Detail Transaksi', { underline: true });
            doc.moveDown(0.3);
            // Table header
            const startY = doc.y;
            doc.fontSize(9).fillColor('#FFFFFF');
            doc.rect(40, startY, 515, 18).fill('#1F2937');
            doc.fillColor('#FFFFFF')
                .text('Tanggal', 45, startY + 5, { width: 70 })
                .text('Kategori', 120, startY + 5, { width: 80 })
                .text('Nominal', 205, startY + 5, { width: 90, align: 'right' })
                .text('Deskripsi', 305, startY + 5, { width: 245 });
            doc.y = startY + 22;

            for (let i = 0; i < expenses.length; i++) {
                const e = expenses[i];
                if (doc.y > 760) { doc.addPage(); }
                const rowY = doc.y;
                if (i % 2 === 0) doc.rect(40, rowY - 2, 515, 16).fill('#F9FAFB');
                doc.fillColor('#111827').fontSize(9)
                    .text(String(e.date || '').substring(0, 12), 45, rowY, { width: 70 })
                    .text(String(e.category || ''), 120, rowY, { width: 80 })
                    .text(`Rp ${Number(e.amount || 0).toLocaleString('id-ID')}`, 205, rowY, { width: 90, align: 'right' })
                    .text(String(e.description || '').substring(0, 60), 305, rowY, { width: 245 });
                doc.y = rowY + 14;
            }

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// ===== CHART (PNG buffer) =====
/**
 * Bar chart per-kategori. Output PNG buffer (size default 800x500).
 */
function generateExpenseChart(expenses, opts = {}) {
    const { createCanvas } = require('canvas');
    const W = opts.width || 800;
    const H = opts.height || 500;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Bg
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Aggregate
    const byCat = {};
    let total = 0;
    for (const e of expenses) {
        const c = e.category || 'lainnya';
        const a = Number(e.amount || 0);
        byCat[c] = (byCat[c] || 0) + a;
        total += a;
    }
    const sorted = Object.entries(byCat).sort(([, a], [, b]) => b - a).slice(0, 8);
    if (sorted.length === 0) {
        ctx.fillStyle = '#6B7280';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Belum ada data pengeluaran', W / 2, H / 2);
        return canvas.toBuffer('image/png');
    }

    // Title
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title || 'Pengeluaran per Kategori', 40, 40);
    ctx.fillStyle = '#6B7280';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Total: Rp ${total.toLocaleString('id-ID')}`, 40, 62);

    // Chart area
    const chartX = 160;
    const chartY = 90;
    const chartW = W - chartX - 40;
    const chartH = H - chartY - 40;
    const max = Math.max(...sorted.map(([, v]) => v));
    const barH = Math.min(38, (chartH - 10) / sorted.length - 8);
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

    sorted.forEach(([cat, val], i) => {
        const y = chartY + i * (barH + 8);
        const barW = (val / max) * chartW;
        // Label kiri
        ctx.fillStyle = '#374151';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(cat, chartX - 10, y + barH / 2 + 5);
        // Bar
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(chartX, y, barW, barH);
        // Value
        ctx.fillStyle = '#111827';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        const pct = total ? ((val / total) * 100).toFixed(1) : '0';
        ctx.fillText(`Rp ${val.toLocaleString('id-ID')} (${pct}%)`, chartX + barW + 8, y + barH / 2 + 5);
    });

    // Footer
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Generated ${moment().tz('Asia/Jakarta').format('DD MMM YYYY HH:mm')}`, W - 20, H - 12);

    return canvas.toBuffer('image/png');
}

// ===== MONTHLY TREND =====
function getMonthlyTrend(expenses) {
    const trend = {};
    for (const e of expenses) {
        const m = moment(e.date, ['YYYY-MM-DD', 'DD/MM/YYYY', 'D/M/YYYY']).format('YYYY-MM');
        if (!m || m === 'Invalid date') continue;
        trend[m] = (trend[m] || 0) + Number(e.amount || 0);
    }
    return Object.entries(trend).sort(([a], [b]) => a.localeCompare(b));
}

module.exports = {
    autoCategorizeFromDescription,
    exportExpensesCSV,
    exportExpensesPDF,
    generateExpenseChart,
    getMonthlyTrend,
    CATEGORY_KEYWORDS
};
