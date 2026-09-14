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

// 1. Mengambil semua data kategori keuangan (dengan opsi filter status, jenis, dan pencarian)
const getAllFinanceCategories = async (req, res) => {
    try {
        const { is_active, type, search } = req.query;

        let query = 'SELECT id, name, `group`, type, is_active FROM m_finance_categories WHERE 1=1';
        const params = [];

        if (is_active !== undefined && is_active !== '') {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
        }

        if (type && ['INCOME', 'EXPENSE', 'BUKAN KEDUANYA'].includes(type.toUpperCase())) {
            query += ' AND type = ?';
            params.push(type.toUpperCase());
        }

        if (search && search.trim()) {
            query += ' AND (name LIKE ? OR `group` LIKE ?)';
            const searchTerm = `%${search.trim()}%`;
            params.push(searchTerm, searchTerm);
        }

        query += ' ORDER BY type ASC, `group` ASC, name ASC';

        const [rows] = await db.query(query, params);

        const formatted = rows.map(item => ({
            ...item,
            group: item.group || '-',
            is_active: Boolean(item.is_active)
        }));

        return successResponse(res, formatted, 'Daftar kategori keuangan berhasil diambil');
    } catch (error) {
        console.error('Error getAllFinanceCategories:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data kategori keuangan', 500, error.message);
    }
};

// 2. Mengambil detail satu kategori keuangan berdasarkan ID
const getFinanceCategoryById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT id, name, `group`, type, is_active FROM m_finance_categories WHERE id = ?', [id]);

        if (rows.length === 0) {
            return notFoundResponse(res, `Kategori keuangan dengan ID '${id}' tidak ditemukan`);
        }

        const category = {
            ...rows[0],
            group: rows[0].group || '-',
            is_active: Boolean(rows[0].is_active)
        };

        return successResponse(res, category, 'Detail kategori keuangan berhasil diambil');
    } catch (error) {
        console.error('Error getFinanceCategoryById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail kategori keuangan', 500, error.message);
    }
};

// 3. Menambahkan kategori keuangan baru
const createFinanceCategory = async (req, res) => {
    try {
        const { name, group, type, is_active = true } = req.body;

        if (!name || !name.trim()) {
            return badRequestResponse(res, 'Nama kategori keuangan wajib diisi');
        }

        const validTypes = ['INCOME', 'EXPENSE', 'BUKAN KEDUANYA'];
        const normalizedType = type ? type.trim().toUpperCase() : 'INCOME';

        if (!validTypes.includes(normalizedType)) {
            return badRequestResponse(res, "Jenis kategori keuangan harus salah satu dari: 'INCOME', 'EXPENSE', atau 'BUKAN KEDUANYA'");
        }

        const id = crypto.randomUUID();
        const trimmedName = name.trim();
        const trimmedGroup = group && group.trim() ? group.trim() : null;
        const activeFlag = is_active ? 1 : 0;

        await db.query(
            'INSERT INTO m_finance_categories (id, name, `group`, type, is_active) VALUES (?, ?, ?, ?, ?)',
            [id, trimmedName, trimmedGroup, normalizedType, activeFlag]
        );

        const [newCategory] = await db.query('SELECT id, name, `group`, type, is_active FROM m_finance_categories WHERE id = ?', [id]);

        const resultData = {
            ...newCategory[0],
            group: newCategory[0].group || '-',
            is_active: Boolean(newCategory[0].is_active)
        };

        // Audit Log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_finance_categories',
            description: `Menambahkan kategori keuangan: ${trimmedName} (${normalizedType}, Kelompok: ${trimmedGroup || '-'})`
        });

        return createdResponse(res, resultData, 'Kategori keuangan berhasil ditambahkan');
    } catch (error) {
        console.error('Error createFinanceCategory:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menambahkan kategori keuangan', 500, error.message);
    }
};

// 4. Memperbarui data kategori keuangan
const updateFinanceCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, group, type, is_active } = req.body;

        const [existing] = await db.query('SELECT * FROM m_finance_categories WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Kategori keuangan dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];
        const newName = name !== undefined ? name.trim() : current.name;
        const newGroup = group !== undefined ? (group && group.trim() ? group.trim() : null) : current.group;

        let newType = current.type;
        if (type !== undefined) {
            const validTypes = ['INCOME', 'EXPENSE', 'BUKAN KEDUANYA'];
            const normalizedType = type.trim().toUpperCase();
            if (!validTypes.includes(normalizedType)) {
                return badRequestResponse(res, "Jenis kategori keuangan harus salah satu dari: 'INCOME', 'EXPENSE', atau 'BUKAN KEDUANYA'");
            }
            newType = normalizedType;
        }

        const newIsActive = is_active !== undefined ? (is_active ? 1 : 0) : current.is_active;

        await db.query(
            'UPDATE m_finance_categories SET name = ?, `group` = ?, type = ?, is_active = ? WHERE id = ?',
            [newName, newGroup, newType, newIsActive, id]
        );

        const [updated] = await db.query('SELECT id, name, `group`, type, is_active FROM m_finance_categories WHERE id = ?', [id]);

        const resultData = {
            ...updated[0],
            group: updated[0].group || '-',
            is_active: Boolean(updated[0].is_active)
        };

        // Audit Log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'm_finance_categories',
            description: `Memperbarui kategori keuangan: ${newName} (ID: ${id})`
        });

        return successResponse(res, resultData, 'Kategori keuangan berhasil diperbarui');
    } catch (error) {
        console.error('Error updateFinanceCategory:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui kategori keuangan', 500, error.message);
    }
};

// 5. Menghapus kategori keuangan
const deleteFinanceCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM m_finance_categories WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Kategori keuangan dengan ID '${id}' tidak ditemukan`);
        }

        const target = existing[0];

        // Cek apakah ada transaksi kas (t_cash_transactions) yang menggunakan kategori ini
        const [relatedTransactions] = await db.query(
            'SELECT COUNT(*) as count FROM t_cash_transactions WHERE category_id = ?',
            [id]
        ).catch(() => [[{ count: 0 }]]); // Jika kolom category_id belum ada atau berbeda

        if (relatedTransactions[0]?.count > 0) {
            return badRequestResponse(res, `Kategori '${target.name}' tidak dapat dihapus karena telah digunakan pada ${relatedTransactions[0].count} transaksi kas. Silakan nonaktifkan kategori sebagai alternatif.`);
        }

        await db.query('DELETE FROM m_finance_categories WHERE id = ?', [id]);

        // Audit Log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 'm_finance_categories',
            description: `Menghapus kategori keuangan: ${target.name} (ID: ${id})`
        });

        return successResponse(res, null, 'Kategori keuangan berhasil dihapus');
    } catch (error) {
        console.error('Error deleteFinanceCategory:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus kategori keuangan', 500, error.message);
    }
};

module.exports = {
    getAllFinanceCategories,
    getFinanceCategoryById,
    createFinanceCategory,
    updateFinanceCategory,
    deleteFinanceCategory
};
