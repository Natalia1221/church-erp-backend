const crypto = require('crypto');
const db = require('../config/db');
const {
    successResponse,
    badRequestResponse,
    notFoundResponse,
    errorResponse
} = require('../helpers/responseHelper');
const { logAudit } = require('../helpers/auditHelper');

/**
 * Helper internal untuk menyusun daftar flat menu menjadi struktur tree hierarki
 */
const buildMenuTree = (menuList, parentId = null) => {
    const branch = [];
    for (const menu of menuList) {
        if (menu.parent_id === parentId) {
            const children = buildMenuTree(menuList, menu.id);
            const item = { ...menu };
            if (children.length > 0) {
                item.children = children;
            } else {
                item.children = [];
            }
            branch.push(item);
        }
    }
    return branch;
};

// Mengambil semua hak akses menu untuk satu role tertentu
// (Mengembalikan semua menu di sistem dan status hak aksesnya saat ini)
const getRolePermissions = async (req, res) => {
    try {
        const { roleId } = req.params;
        const { tree } = req.query;

        // Pastikan role ada
        const [roles] = await db.query('SELECT id, code, name FROM m_roles WHERE id = ?', [roleId]);
        if (roles.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${roleId}' tidak ditemukan`);
        }

        const role = roles[0];

        // Ambil semua menu dan LEFT JOIN ke role_menus untuk role ini
        const [rows] = await db.query(
            `SELECT 
                m.id AS menu_id,
                m.parent_id,
                m.name AS menu_name,
                m.path,
                m.icon,
                m.sequence,
                m.is_active AS menu_active,
                rm.id AS role_menu_id,
                COALESCE(rm.can_read, 0) AS can_read,
                COALESCE(rm.can_create, 0) AS can_create,
                COALESCE(rm.can_update, 0) AS can_update,
                COALESCE(rm.can_delete, 0) AS can_delete,
                COALESCE(rm.can_print, 0) AS can_print
             FROM m_menus m
             LEFT JOIN role_menus rm ON m.id = rm.menu_id AND rm.role_id = ?
             ORDER BY m.sequence ASC, m.name ASC`,
            [roleId]
        );

        const permissions = rows.map(item => ({
            menu_id: item.menu_id,
            parent_id: item.parent_id,
            menu_name: item.menu_name,
            path: item.path,
            icon: item.icon,
            sequence: item.sequence,
            menu_active: Boolean(item.menu_active),
            role_menu_id: item.role_menu_id || null,
            can_read: Boolean(item.can_read),
            can_create: Boolean(item.can_create),
            can_update: Boolean(item.can_update),
            can_delete: Boolean(item.can_delete),
            can_print: Boolean(item.can_print)
        }));

        if (tree === 'true') {
            const permissionTree = buildMenuTree(permissions, null);
            return successResponse(
                res,
                { role, permissions: permissionTree },
                'Daftar hak akses menu role (hierarkis) berhasil diambil'
            );
        }

        return successResponse(
            res,
            { role, permissions },
            'Daftar hak akses menu role berhasil diambil'
        );
    } catch (error) {
        console.error('Error getRolePermissions:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil hak akses menu role', 500, error.message);
    }
};

// Memperbarui atau menyimpan hak akses menu untuk satu role (Batch Update via Transaction)
const updateRolePermissions = async (req, res) => {
    let connection;
    try {
        const { roleId } = req.params;
        const { permissions } = req.body;

        if (!Array.isArray(permissions)) {
            return badRequestResponse(res, 'Field permissions harus berupa array objek menu dan hak aksesnya');
        }

        // Cek keberadaan role
        const [roles] = await db.query('SELECT id, code, name FROM m_roles WHERE id = ?', [roleId]);
        if (roles.length === 0) {
            return notFoundResponse(res, `Role dengan ID '${roleId}' tidak ditemukan`);
        }

        const role = roles[0];

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Hapus konfigurasi permissions lama untuk role ini
        await connection.query('DELETE FROM role_menus WHERE role_id = ?', [roleId]);

        // Insert konfigurasi permission baru
        for (const item of permissions) {
            if (!item.menu_id) continue;

            const roleMenuId = crypto.randomUUID();
            await connection.query(
                `INSERT INTO role_menus 
                 (id, role_id, menu_id, can_read, can_create, can_update, can_delete, can_print) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    roleMenuId,
                    roleId,
                    item.menu_id,
                    item.can_read ? 1 : 0,
                    item.can_create ? 1 : 0,
                    item.can_update ? 1 : 0,
                    item.can_delete ? 1 : 0,
                    item.can_print ? 1 : 0
                ]
            );
        }

        await connection.commit();

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'role_menus',
            description: `Memperbarui hak akses menu untuk role: ${role.name} (${role.code})`
        });

        return successResponse(
            res,
            { role_id: roleId, updated_count: permissions.length },
            'Hak akses menu role berhasil diperbarui'
        );
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updateRolePermissions:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui hak akses menu role', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    getRolePermissions,
    updateRolePermissions
};
