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
        const [rows] = await db.query('SELECT id, code, name, description, status, created_at, updated_at FROM m_roles ORDER BY created_at DESC');
        const formatted = rows.map(r => ({
            ...r,
            status: Boolean(r.status)
        }));
        return successResponse(res, formatted, 'Data role berhasil diambil');
    } catch (error) {
        console.error('Error getAllRoles:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data role', 500, error.message);
    }
};

// Mendapatkan kode role berikutnya (format: ROLE0001, ROLE0002, ...)
const getNextRoleCode = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT code FROM m_roles WHERE code REGEXP '^ROLE[0-9]+' ORDER BY code DESC LIMIT 1");
        let nextCode = 'ROLE0001';
        if (rows.length > 0) {
            const numPart = rows[0].code.replace('ROLE', '');
            const nextNum = parseInt(numPart, 10) + 1;
            nextCode = 'ROLE' + String(nextNum).padStart(4, '0');
        } else {
            const [countRows] = await db.query('SELECT COUNT(*) AS total FROM m_roles');
            const total = (countRows[0]?.total || 0) + 1;
            nextCode = 'ROLE' + String(total).padStart(4, '0');
        }
        return successResponse(res, { nextCode }, 'Next role code berhasil diambil');
    } catch (error) {
        console.error('Error getNextRoleCode:', error);
        return successResponse(res, { nextCode: 'ROLE0001' });
    }
};

// Mendapatkan data role berdasarkan ID (beserta daftar hak akses menu)
const getRoleById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT id, code, name, description, status, created_at, updated_at FROM m_roles WHERE id = ?', [id]);

        if (rows.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${id}' tidak ditemukan`);
        }

        // Ambil daftar permissions menu yang telah didaftarkan
        const [permRows] = await db.query(
            `SELECT 
                rm.id AS role_menu_id,
                m.id AS menu_id,
                m.modul,
                m.submodul,
                m.name AS menu_name,
                m.path,
                m.icon,
                m.sequence,
                COALESCE(rm.can_show, 0) AS can_show,
                COALESCE(rm.can_read, 0) AS can_read,
                COALESCE(rm.can_create, 0) AS can_create,
                COALESCE(rm.can_update, 0) AS can_update,
                COALESCE(rm.can_delete, 0) AS can_delete,
                COALESCE(rm.can_print, 0) AS can_print
             FROM role_menus rm
             JOIN m_menus m ON rm.menu_id = m.id
             WHERE rm.role_id = ?
             ORDER BY m.sequence ASC, m.name ASC`,
            [id]
        );

        const permissions = permRows.map(item => ({
            role_menu_id: item.role_menu_id,
            menu_id: item.menu_id,
            modul: item.modul || '-',
            submodul: item.submodul || '-',
            menu_name: item.menu_name,
            path: item.path || '-',
            icon: item.icon,
            sequence: item.sequence,
            can_show: Boolean(item.can_show),
            can_read: Boolean(item.can_read),
            can_create: Boolean(item.can_create),
            can_update: Boolean(item.can_update),
            can_delete: Boolean(item.can_delete),
            can_print: Boolean(item.can_print)
        }));

        const role = {
            ...rows[0],
            status: Boolean(rows[0].status),
            permissions
        };

        return successResponse(res, role, 'Data role berhasil diambil');
    } catch (error) {
        console.error('Error getRoleById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data role', 500, error.message);
    }
};

// Membuat role baru beserta daftar Role Details (role_menus)
const createRole = async (req, res) => {
    let connection;
    try {
        const { code, name, description, status = true, permissions = [] } = req.body;

        if (!name || !name.trim()) {
            return badRequestResponse(res, 'Field nama role wajib diisi');
        }

        const id = crypto.randomUUID();
        const finalCode = code && code.trim() ? code.trim() : 'ROLE' + Date.now().toString().slice(-4);
        const activeStatus = status !== undefined && status !== null ? (status ? 1 : 0) : 1;

        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO m_roles (id, code, name, description, status) VALUES (?, ?, ?, ?, ?)',
            [id, finalCode, name.trim(), description ? description.trim() : null, activeStatus]
        );

        // Jika ada permissions menu yang ditambahkan ke Role Details
        if (Array.isArray(permissions) && permissions.length > 0) {
            for (const item of permissions) {
                if (!item.menu_id) continue;
                const roleMenuId = crypto.randomUUID();
                await connection.query(
                    `INSERT INTO role_menus 
                     (id, role_id, menu_id, can_show, can_read, can_create, can_update, can_delete, can_print) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        roleMenuId,
                        id,
                        item.menu_id,
                        item.can_show ? 1 : 0,
                        item.can_read ? 1 : 0,
                        item.can_create ? 1 : 0,
                        item.can_update ? 1 : 0,
                        item.can_delete ? 1 : 0,
                        item.can_print ? 1 : 0
                    ]
                );
            }
        }

        await connection.commit();

        const [newRole] = await db.query('SELECT id, code, name, description, status, created_at, updated_at FROM m_roles WHERE id = ?', [id]);

        const formatted = {
            ...newRole[0],
            status: Boolean(newRole[0].status)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_roles',
            description: `Menambahkan role baru: ${name} (${finalCode}) dengan ${permissions.length} menu permissions`
        });

        return createdResponse(res, formatted, 'Role berhasil ditambahkan');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error createRole:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Kode role sudah digunakan, silakan gunakan kode lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat menambahkan role', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Memperbarui data role beserta daftar Role Details (role_menus)
const updateRole = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const { code, name, description, status, permissions } = req.body;

        if (!name || !name.trim()) {
            return badRequestResponse(res, 'Field nama role wajib diisi');
        }

        // Cek apakah role dengan ID tersebut ada
        const [existing] = await db.query('SELECT * FROM m_roles WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];
        const newCode = code && code.trim() ? code.trim() : current.code;
        const newName = name.trim();
        const newDescription = description !== undefined ? (description ? description.trim() : null) : current.description;
        const newStatus = status !== undefined ? (status ? 1 : 0) : current.status;

        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.query(
            'UPDATE m_roles SET code = ?, name = ?, description = ?, status = ? WHERE id = ?',
            [newCode, newName, newDescription, newStatus, id]
        );

        // Jika permissions dikirim, update role_menus (replace)
        if (Array.isArray(permissions)) {
            await connection.query('DELETE FROM role_menus WHERE role_id = ?', [id]);

            for (const item of permissions) {
                if (!item.menu_id) continue;
                const roleMenuId = crypto.randomUUID();
                await connection.query(
                    `INSERT INTO role_menus 
                     (id, role_id, menu_id, can_show, can_read, can_create, can_update, can_delete, can_print) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        roleMenuId,
                        id,
                        item.menu_id,
                        item.can_show ? 1 : 0,
                        item.can_read ? 1 : 0,
                        item.can_create ? 1 : 0,
                        item.can_update ? 1 : 0,
                        item.can_delete ? 1 : 0,
                        item.can_print ? 1 : 0
                    ]
                );
            }
        }

        await connection.commit();

        const [updatedRole] = await db.query('SELECT id, code, name, description, status, created_at, updated_at FROM m_roles WHERE id = ?', [id]);

        const formatted = {
            ...updatedRole[0],
            status: Boolean(updatedRole[0].status)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'm_roles',
            description: `Memperbarui role: ${newName} (${newCode})`
        });

        return successResponse(res, formatted, 'Role berhasil diperbarui');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updateRole:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Kode role sudah digunakan, silakan gunakan kode lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui role', 500, error.message);
    } finally {
        if (connection) connection.release();
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
    deleteRole,
    getNextRoleCode
};
