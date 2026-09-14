const crypto = require('crypto');
const db = require('../config/db');
const {
    successResponse,
    createdResponse,
    badRequestResponse,
    notFoundResponse,
    errorResponse
} = require('../helpers/responseHelper');
const { logAudit } = require('../helpers/auditHelper');

/**
 * Controller untuk mengelola Transaksi Kas Lainnya (Operasional Kas Non-Event)
 * Mendukung filter tipe: INCOME, EXPENSE, dan ALL (Gabungan)
 * Tabel t_cash_transactions dengan event_id = NULL
 */

// 1. Mengambil seluruh transaksi kas lainnya + kategori + rangkuman KPI
const getKasLainnyaOverview = async (req, res) => {
    try {
        const { type, month, year, category_id, search } = req.query;

        // A. Ambil kategori keuangan aktif dengan group m_income dan m_expense
        const [categories] = await db.query(
            "SELECT id, name, `group`, type FROM m_finance_categories WHERE is_active = 1 AND `group` IN ('m_income', 'm_expense') ORDER BY `group` ASC, name ASC"
        );

        // B. Query daftar transaksi kas lainnya (event_id IS NULL)
        let query = `
            SELECT 
                ct.id,
                DATE_FORMAT(ct.transaction_date, '%Y-%m-%d') AS transaction_date,
                ct.category_id,
                fc.name AS category_name,
                ct.type,
                CAST(ct.amount AS DECIMAL(15,2)) AS amount,
                ct.description,
                ct.recorded_by,
                u.name AS recorded_by_name,
                ct.created_at
            FROM t_cash_transactions ct
            JOIN m_finance_categories fc ON ct.category_id = fc.id
            LEFT JOIN users u ON ct.recorded_by = u.id
            WHERE ct.event_id IS NULL
        `;
        const params = [];

        // Filter Type (INCOME / EXPENSE)
        if (type && ['INCOME', 'EXPENSE'].includes(type.toUpperCase())) {
            query += ' AND ct.type = ?';
            params.push(type.toUpperCase());
        }

        // Filter Kategori Spesifik
        if (category_id && category_id.trim()) {
            query += ' AND ct.category_id = ?';
            params.push(category_id.trim());
        }

        // Filter Bulan
        if (month && !isNaN(month)) {
            query += ' AND MONTH(ct.transaction_date) = ?';
            params.push(Number(month));
        }

        // Filter Tahun
        if (year && !isNaN(year)) {
            query += ' AND YEAR(ct.transaction_date) = ?';
            params.push(Number(year));
        }

        // Filter Pencarian
        if (search && search.trim()) {
            query += ' AND (ct.description LIKE ? OR fc.name LIKE ? OR u.name LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        query += ' ORDER BY ct.transaction_date DESC, ct.created_at DESC';

        const [transactions] = await db.query(query, params);

        // C. Rangkuman KPI (Total Income, Total Expense, Net Balance)
        // Hitung akumulasi pada scope filter waktu yang sama
        let summaryQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN ct.type = 'INCOME' THEN ct.amount ELSE 0 END), 0) AS total_income,
                COALESCE(SUM(CASE WHEN ct.type = 'EXPENSE' THEN ct.amount ELSE 0 END), 0) AS total_expense,
                COUNT(CASE WHEN ct.type = 'INCOME' THEN 1 END) AS income_count,
                COUNT(CASE WHEN ct.type = 'EXPENSE' THEN 1 END) AS expense_count,
                COUNT(*) AS total_count
            FROM t_cash_transactions ct
            WHERE ct.event_id IS NULL
        `;
        const summaryParams = [];

        if (month && !isNaN(month)) {
            summaryQuery += ' AND MONTH(ct.transaction_date) = ?';
            summaryParams.push(Number(month));
        }
        if (year && !isNaN(year)) {
            summaryQuery += ' AND YEAR(ct.transaction_date) = ?';
            summaryParams.push(Number(year));
        }

        const [summaryRows] = await db.query(summaryQuery, summaryParams);
        const summaryRow = summaryRows[0] || {};
        const totalIncome = Number(summaryRow.total_income || 0);
        const totalExpense = Number(summaryRow.total_expense || 0);

        const summary = {
            total_income: totalIncome,
            total_expense: totalExpense,
            net_balance: totalIncome - totalExpense,
            total_count: Number(summaryRow.total_count || 0),
            income_count: Number(summaryRow.income_count || 0),
            expense_count: Number(summaryRow.expense_count || 0)
        };

        return successResponse(res, {
            transactions,
            categories,
            summary
        }, 'Data transaksi kas lainnya berhasil diambil');
    } catch (error) {
        console.error('Error getKasLainnyaOverview:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memuat data transaksi', 500, error.message);
    }
};

// 2. Tambah Transaksi Kas Lainnya Baru
const createKasLainnya = async (req, res) => {
    try {
        const { transaction_date, category_id, type, amount, description } = req.body;

        if (!transaction_date || !String(transaction_date).trim()) {
            return badRequestResponse(res, 'Tanggal transaksi wajib diisi');
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(String(transaction_date).trim())) {
            return badRequestResponse(res, 'Format tanggal tidak valid (harus YYYY-MM-DD)');
        }

        if (!category_id) {
            return badRequestResponse(res, 'Kategori transaksi wajib dipilih');
        }

        if (!type || !['INCOME', 'EXPENSE'].includes(type.toUpperCase())) {
            return badRequestResponse(res, 'Tipe transaksi harus INCOME atau EXPENSE');
        }

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return badRequestResponse(res, 'Jumlah uang harus berupa angka lebih besar dari 0');
        }

        // Cek kategori keuangan
        const [cats] = await db.query('SELECT id, name, type FROM m_finance_categories WHERE id = ? AND is_active = 1', [category_id]);
        if (cats.length === 0) {
            return notFoundResponse(res, 'Kategori keuangan tidak ditemukan atau tidak aktif');
        }

        const newId = crypto.randomUUID();
        const cleanType = type.toUpperCase();
        const cleanDate = String(transaction_date).trim();
        const cleanDesc = description ? description.trim() : null;
        const userId = req.user?.id || null;

        await db.query(
            `INSERT INTO t_cash_transactions 
             (id, transaction_date, category_id, type, amount, description, event_id, recorded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NOW())`,
            [newId, cleanDate, category_id, cleanType, numAmount, cleanDesc, userId]
        );

        // Audit Log
        await logAudit({
            userId,
            action: 'CREATE',
            tableName: 't_cash_transactions',
            description: `Menambahkan transaksi ${cleanType} (${cats[0].name}): Rp ${numAmount.toLocaleString('id-ID')} pada tanggal ${cleanDate}`
        });

        // Ambil data yang baru dibuat
        const [created] = await db.query(
            `SELECT 
                ct.id,
                DATE_FORMAT(ct.transaction_date, '%Y-%m-%d') AS transaction_date,
                ct.category_id,
                fc.name AS category_name,
                ct.type,
                CAST(ct.amount AS DECIMAL(15,2)) AS amount,
                ct.description,
                ct.recorded_by,
                u.name AS recorded_by_name,
                ct.created_at
             FROM t_cash_transactions ct
             JOIN m_finance_categories fc ON ct.category_id = fc.id
             LEFT JOIN users u ON ct.recorded_by = u.id
             WHERE ct.id = ?`,
            [newId]
        );

        return createdResponse(res, created[0], 'Transaksi kas berhasil disimpan');
    } catch (error) {
        console.error('Error createKasLainnya:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat membuat transaksi', 500, error.message);
    }
};

// 3. Update Transaksi Kas Lainnya
const updateKasLainnya = async (req, res) => {
    try {
        const { id } = req.params;
        const { transaction_date, category_id, type, amount, description } = req.body;

        const [existing] = await db.query(
            'SELECT * FROM t_cash_transactions WHERE id = ? AND event_id IS NULL',
            [id]
        );
        if (existing.length === 0) {
            return notFoundResponse(res, `Transaksi kas dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];
        let cleanDate = current.transaction_date;
        let cleanCatId = current.category_id;
        let cleanType = current.type;
        let cleanAmount = current.amount;
        let cleanDesc = current.description;

        if (transaction_date && String(transaction_date).trim()) {
            cleanDate = String(transaction_date).trim();
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(cleanDate)) {
                return badRequestResponse(res, 'Format tanggal tidak valid (harus YYYY-MM-DD)');
            }
        }

        if (category_id) {
            const [cats] = await db.query('SELECT id, name, type FROM m_finance_categories WHERE id = ? AND is_active = 1', [category_id]);
            if (cats.length === 0) {
                return notFoundResponse(res, 'Kategori keuangan tidak ditemukan atau tidak aktif');
            }
            cleanCatId = category_id;
        }

        if (type && ['INCOME', 'EXPENSE'].includes(type.toUpperCase())) {
            cleanType = type.toUpperCase();
        }

        if (amount !== undefined) {
            const num = parseFloat(amount);
            if (isNaN(num) || num <= 0) {
                return badRequestResponse(res, 'Jumlah uang harus bernilai lebih dari 0');
            }
            cleanAmount = num;
        }

        if (description !== undefined) {
            cleanDesc = description ? description.trim() : null;
        }

        await db.query(
            `UPDATE t_cash_transactions 
             SET transaction_date = ?, category_id = ?, type = ?, amount = ?, description = ? 
             WHERE id = ?`,
            [cleanDate, cleanCatId, cleanType, cleanAmount, cleanDesc, id]
        );

        // Audit Log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 't_cash_transactions',
            description: `Mengubah transaksi kas ${cleanType} (ID: ${id}) menjadi nominal Rp ${Number(cleanAmount).toLocaleString('id-ID')}`
        });

        const [updated] = await db.query(
            `SELECT 
                ct.id,
                DATE_FORMAT(ct.transaction_date, '%Y-%m-%d') AS transaction_date,
                ct.category_id,
                fc.name AS category_name,
                ct.type,
                CAST(ct.amount AS DECIMAL(15,2)) AS amount,
                ct.description,
                ct.recorded_by,
                u.name AS recorded_by_name,
                ct.created_at
             FROM t_cash_transactions ct
             JOIN m_finance_categories fc ON ct.category_id = fc.id
             LEFT JOIN users u ON ct.recorded_by = u.id
             WHERE ct.id = ?`,
            [id]
        );

        return successResponse(res, updated[0], 'Transaksi kas berhasil diperbarui');
    } catch (error) {
        console.error('Error updateKasLainnya:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui transaksi', 500, error.message);
    }
};

// 4. Hapus Transaksi Kas Lainnya
const deleteKasLainnya = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query(
            `SELECT ct.*, fc.name AS category_name 
             FROM t_cash_transactions ct 
             JOIN m_finance_categories fc ON ct.category_id = fc.id 
             WHERE ct.id = ? AND ct.event_id IS NULL`,
            [id]
        );
        if (existing.length === 0) {
            return notFoundResponse(res, `Transaksi kas dengan ID '${id}' tidak ditemukan`);
        }

        const target = existing[0];

        await db.query('DELETE FROM t_cash_transactions WHERE id = ?', [id]);

        // Audit Log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 't_cash_transactions',
            description: `Menghapus transaksi ${target.type} (${target.category_name}): Rp ${Number(target.amount).toLocaleString('id-ID')} (ID: ${id})`
        });

        return successResponse(res, null, 'Transaksi kas berhasil dihapus');
    } catch (error) {
        console.error('Error deleteKasLainnya:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus transaksi', 500, error.message);
    }
};

module.exports = {
    getKasLainnyaOverview,
    createKasLainnya,
    updateKasLainnya,
    deleteKasLainnya
};
