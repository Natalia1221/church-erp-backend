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

// Mengambil seluruh kategori pelayanan
const getAllCategories = async (req, res) => {
    try {
        const { search, is_active } = req.query;

        let query = 'SELECT id, name, description, sequence, is_active, created_at, updated_at FROM m_categories WHERE 1=1';
        const params = [];

        if (is_active !== undefined && is_active !== '') {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
        }

        if (search && search.trim()) {
            query += ' AND (name LIKE ? OR description LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        query += ' ORDER BY sequence ASC, name ASC';

        const [rows] = await db.query(query, params);

        const formatted = rows.map(item => ({
            ...item,
            is_active: Boolean(item.is_active),
            sequence: item.sequence !== null ? Number(item.sequence) : 0
        }));

        return successResponse(res, formatted, 'Daftar kategori pelayanan berhasil diambil');
    } catch (error) {
        console.error('Error getAllCategories:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data kategori pelayanan', 500, error.message);
    }
};

// Mengambil detail satu kategori pelayanan berdasarkan ID
const getCategoryById = async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await db.query(
            'SELECT id, name, description, sequence, is_active, created_at, updated_at FROM m_categories WHERE id = ?',
            [id]
        );

        if (rows.length === 0) {
            return notFoundResponse(res, `Kategori pelayanan dengan ID '${id}' tidak ditemukan`);
        }

        const category = {
            ...rows[0],
            is_active: Boolean(rows[0].is_active),
            sequence: rows[0].sequence !== null ? Number(rows[0].sequence) : 0
        };

        return successResponse(res, category, 'Data kategori pelayanan berhasil diambil');
    } catch (error) {
        console.error('Error getCategoryById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail kategori pelayanan', 500, error.message);
    }
};

// Membuat kategori pelayanan baru
const createCategory = async (req, res) => {
    try {
        const { name, description, sequence, is_active = true } = req.body;

        if (!name || !name.trim()) {
            return badRequestResponse(res, 'Nama kategori pelayanan wajib diisi');
        }

        const id = crypto.randomUUID();
        const trimmedName = name.trim();
        const trimmedDesc = description && description.trim() ? description.trim() : null;
        const parsedSequence = sequence !== undefined && sequence !== null && sequence !== '' ? Number(sequence) : 0;
        const activeFlag = is_active ? 1 : 0;

        await db.query(
            'INSERT INTO m_categories (id, name, description, sequence, is_active) VALUES (?, ?, ?, ?, ?)',
            [id, trimmedName, trimmedDesc, parsedSequence, activeFlag]
        );

        const [created] = await db.query(
            'SELECT id, name, description, sequence, is_active, created_at, updated_at FROM m_categories WHERE id = ?',
            [id]
        );

        const formatted = {
            ...created[0],
            is_active: Boolean(created[0].is_active),
            sequence: Number(created[0].sequence)
        };

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_categories',
            description: `Menambahkan kategori pelayanan baru: ${trimmedName}`
        });

        return createdResponse(res, formatted, 'Kategori pelayanan berhasil ditambahkan');
    } catch (error) {
        console.error('Error createCategory:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menambahkan kategori pelayanan', 500, error.message);
    }
};

// Memperbarui data kategori pelayanan
const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, sequence, is_active } = req.body;

        const [existing] = await db.query('SELECT * FROM m_categories WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Kategori pelayanan dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];
        const newName = name !== undefined && name.trim() ? name.trim() : current.name;
        const newDesc = description !== undefined ? (description ? description.trim() : null) : current.description;
        const newSequence = sequence !== undefined && sequence !== null && sequence !== '' ? Number(sequence) : current.sequence;
        const newIsActive = is_active !== undefined ? (is_active ? 1 : 0) : current.is_active;

        await db.query(
            'UPDATE m_categories SET name = ?, description = ?, sequence = ?, is_active = ? WHERE id = ?',
            [newName, newDesc, newSequence, newIsActive, id]
        );

        const [updated] = await db.query(
            'SELECT id, name, description, sequence, is_active, created_at, updated_at FROM m_categories WHERE id = ?',
            [id]
        );

        const formatted = {
            ...updated[0],
            is_active: Boolean(updated[0].is_active),
            sequence: Number(updated[0].sequence)
        };

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'm_categories',
            description: `Memperbarui kategori pelayanan: ${newName} (ID: ${id})`
        });

        return successResponse(res, formatted, 'Kategori pelayanan berhasil diperbarui');
    } catch (error) {
        console.error('Error updateCategory:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui kategori pelayanan', 500, error.message);
    }
};

// Menghapus data kategori pelayanan
const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM m_categories WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Kategori pelayanan dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];

        // Cek keterikatan data dengan t_assignments
        const [assignments] = await db.query(
            'SELECT COUNT(*) as total FROM t_assignments WHERE category_id = ?',
            [id]
        );

        if (assignments[0].total > 0) {
            return badRequestResponse(
                res,
                `Kategori '${current.name}' tidak dapat dihapus karena masih digunakan pada ${assignments[0].total} jadwal penugasan pelayanan`
            );
        }

        await db.query('DELETE FROM m_categories WHERE id = ?', [id]);

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 'm_categories',
            description: `Menghapus kategori pelayanan: ${current.name} (ID: ${id})`
        });

        return successResponse(res, null, 'Kategori pelayanan berhasil dihapus');
    } catch (error) {
        console.error('Error deleteCategory:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus kategori pelayanan', 500, error.message);
    }
};

module.exports = {
    getAllCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory
};
