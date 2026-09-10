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

// Mendapatkan semua data setting (Mendukung filter ?group=xxx & ?status=true/false & ?search=xxx)
const getAllSettings = async (req, res) => {
    try {
        const { group, status, search } = req.query;

        let query = 'SELECT * FROM m_settings WHERE 1=1';
        const params = [];

        if (group) {
            query += ' AND `group` = ?';
            params.push(group);
        }

        if (status !== undefined) {
            query += ' AND status = ?';
            params.push(status === 'true' || status === '1' ? 1 : 0);
        }

        if (search) {
            query += ' AND (`group` LIKE ? OR `key` LIKE ? OR value1 LIKE ? OR value2 LIKE ? OR value3 LIKE ? OR value4 LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }

        query += ' ORDER BY `group` ASC, CAST(COALESCE(value2, 999) AS SIGNED) ASC, `key` ASC';

        const [rows] = await db.query(query, params);

        const formatted = rows.map(r => ({
            ...r,
            status: Boolean(r.status)
        }));

        return successResponse(res, formatted, 'Daftar pengaturan berhasil diambil');
    } catch (error) {
        console.error('Error getAllSettings:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data pengaturan', 500, error.message);
    }
};

// Mendapatkan daftar distinct group setting (untuk dropdown / filter)
const getSettingGroups = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT `group` FROM m_settings ORDER BY `group` ASC');
        const groups = rows.map(r => r.group);
        return successResponse(res, groups, 'Daftar group pengaturan berhasil diambil');
    } catch (error) {
        console.error('Error getSettingGroups:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil daftar group', 500, error.message);
    }
};

// Mendapatkan detail satu setting berdasarkan ID
const getSettingById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM m_settings WHERE id = ?', [id]);

        if (rows.length === 0) {
            return notFoundResponse(res, `Pengaturan dengan ID '${id}' tidak ditemukan`);
        }

        const setting = {
            ...rows[0],
            status: Boolean(rows[0].status)
        };

        return successResponse(res, setting, 'Detail pengaturan berhasil diambil');
    } catch (error) {
        console.error('Error getSettingById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail pengaturan', 500, error.message);
    }
};

// Menambahkan data setting baru
const createSetting = async (req, res) => {
    try {
        const { group, key, value1, value2, value3, value4, status = true } = req.body;

        if (!group || !key) {
            return badRequestResponse(res, 'Field group dan key wajib diisi');
        }

        const id = crypto.randomUUID();

        await db.query(
            'INSERT INTO m_settings (id, `group`, `key`, value1, value2, value3, value4, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                id,
                group.trim(),
                key.trim(),
                value1 !== undefined && value1 !== null ? String(value1) : null,
                value2 !== undefined && value2 !== null ? String(value2) : null,
                value3 !== undefined && value3 !== null ? String(value3) : null,
                value4 !== undefined && value4 !== null ? String(value4) : null,
                status ? 1 : 0
            ]
        );

        const [newRow] = await db.query('SELECT * FROM m_settings WHERE id = ?', [id]);

        const resultData = {
            ...newRow[0],
            status: Boolean(newRow[0].status)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_settings',
            description: `Menambahkan pengaturan baru: ${group} - ${key}`
        });

        return createdResponse(res, resultData, 'Pengaturan berhasil ditambahkan');
    } catch (error) {
        console.error('Error createSetting:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menambahkan pengaturan', 500, error.message);
    }
};

// Memperbarui data setting
const updateSetting = async (req, res) => {
    try {
        const { id } = req.params;
        const { group, key, value1, value2, value3, value4, status } = req.body;

        const [existing] = await db.query('SELECT * FROM m_settings WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Pengaturan dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];
        const newGroup = group !== undefined ? group.trim() : current.group;
        const newKey = key !== undefined ? key.trim() : current.key;
        const newValue1 = value1 !== undefined ? (value1 !== null ? String(value1) : null) : current.value1;
        const newValue2 = value2 !== undefined ? (value2 !== null ? String(value2) : null) : current.value2;
        const newValue3 = value3 !== undefined ? (value3 !== null ? String(value3) : null) : current.value3;
        const newValue4 = value4 !== undefined ? (value4 !== null ? String(value4) : null) : current.value4;
        const newStatus = status !== undefined ? (status ? 1 : 0) : current.status;

        await db.query(
            'UPDATE m_settings SET `group` = ?, `key` = ?, value1 = ?, value2 = ?, value3 = ?, value4 = ?, status = ? WHERE id = ?',
            [newGroup, newKey, newValue1, newValue2, newValue3, newValue4, newStatus, id]
        );

        const [updated] = await db.query('SELECT * FROM m_settings WHERE id = ?', [id]);

        const resultData = {
            ...updated[0],
            status: Boolean(updated[0].status)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'm_settings',
            description: `Memperbarui pengaturan: ${newGroup} - ${newKey}`
        });

        return successResponse(res, resultData, 'Pengaturan berhasil diperbarui');
    } catch (error) {
        console.error('Error updateSetting:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui pengaturan', 500, error.message);
    }
};

// Menghapus data setting
const deleteSetting = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM m_settings WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Pengaturan dengan ID '${id}' tidak ditemukan`);
        }

        const target = existing[0];

        await db.query('DELETE FROM m_settings WHERE id = ?', [id]);

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 'm_settings',
            description: `Menghapus pengaturan: ${target.group} - ${target.key}`
        });

        return successResponse(res, null, 'Pengaturan berhasil dihapus');
    } catch (error) {
        console.error('Error deleteSetting:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus pengaturan', 500, error.message);
    }
};

module.exports = {
    getAllSettings,
    getSettingGroups,
    getSettingById,
    createSetting,
    updateSetting,
    deleteSetting
};
