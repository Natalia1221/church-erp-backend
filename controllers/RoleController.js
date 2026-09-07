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

// Mendapatkan semua data role
const getAllRoles = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM m_roles ORDER BY created_at DESC');
        return successResponse(res, rows, 'Data role berhasil diambil');
    } catch (error) {
        console.error('Error getAllRoles:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data role', 500, error.message);
    }
};

// Mendapatkan data role berdasarkan ID
const getRoleById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM m_roles WHERE id = ?', [id]);

        if (rows.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${id}' tidak ditemukan`);
        }

        return successResponse(res, rows[0], 'Data role berhasil diambil');
    } catch (error) {
        console.error('Error getRoleById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data role', 500, error.message);
    }
};

// Membuat role baru
const createRole = async (req, res) => {
    try {
        const { code, name, description } = req.body;

        if (!code || !name) {
            return badRequestResponse(res, 'Field code dan name wajib diisi');
        }

        const id = crypto.randomUUID();

        await db.query(
            'INSERT INTO m_roles (id, code, name, description) VALUES (?, ?, ?, ?)',
            [id, code, name, description || null]
        );

        const [newRole] = await db.query('SELECT * FROM m_roles WHERE id = ?', [id]);

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_roles',
            description: `Menambahkan role baru: ${name} (${code})`
        });

        return createdResponse(res, newRole[0], 'Role berhasil ditambahkan');
    } catch (error) {
        console.error('Error createRole:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Code role sudah digunakan, silakan gunakan code lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat menambahkan role', 500, error.message);
    }
};

// Memperbarui data role
const updateRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { code, name, description } = req.body;

        if (!code || !name) {
            return badRequestResponse(res, 'Field code dan name wajib diisi');
        }

        // Cek apakah role dengan ID tersebut ada
        const [existing] = await db.query('SELECT * FROM m_roles WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${id}' tidak ditemukan`);
        }

        await db.query(
            'UPDATE m_roles SET code = ?, name = ?, description = ? WHERE id = ?',
            [code, name, description !== undefined ? description : existing[0].description, id]
        );

        const [updatedRole] = await db.query('SELECT * FROM m_roles WHERE id = ?', [id]);

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'm_roles',
            description: `Memperbarui role: ${name} (${code})`
        });

        return successResponse(res, updatedRole[0], 'Role berhasil diperbarui');
    } catch (error) {
        console.error('Error updateRole:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Code role sudah digunakan, silakan gunakan code lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui role', 500, error.message);
    }
};

// Menghapus data role
const deleteRole = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM m_roles WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${id}' tidak ditemukan`);
        }

        await db.query('DELETE FROM m_roles WHERE id = ?', [id]);

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 'm_roles',
            description: `Menghapus role: ${existing[0].name} (${existing[0].code})`
        });

        return successResponse(res, null, 'Role berhasil dihapus');
    } catch (error) {
        console.error('Error deleteRole:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus role', 500, error.message);
    }
};

module.exports = {
    getAllRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole
};
