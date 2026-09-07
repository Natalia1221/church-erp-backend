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
 * Helper internal untuk menyusun daftar flat menu menjadi struktur tree hierarki (parent & children)
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

// Mengambil semua menu (Mendukung format list flat atau hierarki tree via query ?tree=true)
const getAllMenus = async (req, res) => {
    try {
        const { tree, is_active } = req.query;

        let query = 'SELECT * FROM m_menus WHERE 1=1';
        const params = [];

        if (is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
        }

        query += ' ORDER BY sequence ASC, name ASC';

        const [menus] = await db.query(query, params);

        const formattedMenus = menus.map(m => ({
            ...m,
            is_active: Boolean(m.is_active)
        }));

        if (tree === 'true') {
            const menuTree = buildMenuTree(formattedMenus, null);
            return successResponse(res, menuTree, 'Daftar menu hierarkis berhasil diambil');
        }

        return successResponse(res, formattedMenus, 'Daftar menu berhasil diambil');
    } catch (error) {
        console.error('Error getAllMenus:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data menu', 500, error.message);
    }
};

// Mengambil detail satu menu
const getMenuById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);

        if (rows.length === 0) {
            return notFoundResponse(res, `Menu dengan ID '${id}' tidak ditemukan`);
        }

        const menu = {
            ...rows[0],
            is_active: Boolean(rows[0].is_active)
        };

        return successResponse(res, menu, 'Detail menu berhasil diambil');
    } catch (error) {
        console.error('Error getMenuById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data menu', 500, error.message);
    }
};

// Menambahkan menu baru
const createMenu = async (req, res) => {
    try {
        const { parent_id, name, path, icon, sequence = 0, is_active = true } = req.body;

        if (!name) {
            return badRequestResponse(res, 'Field name wajib diisi');
        }

        // Cek validitas parent_id jika disediakan
        if (parent_id) {
            const [parent] = await db.query('SELECT id FROM m_menus WHERE id = ?', [parent_id]);
            if (parent.length === 0) {
                return badRequestResponse(res, `Parent menu dengan ID '${parent_id}' tidak ditemukan`);
            }
        }

        const id = crypto.randomUUID();

        await db.query(
            `INSERT INTO m_menus (id, parent_id, name, path, icon, sequence, is_active) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                parent_id || null,
                name,
                path || null,
                icon || null,
                sequence !== undefined ? Number(sequence) : 0,
                is_active ? 1 : 0
            ]
        );

        const [newMenu] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);

        const resultData = {
            ...newMenu[0],
            is_active: Boolean(newMenu[0].is_active)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_menus',
            description: `Menambahkan menu baru: ${name} (Path: ${path || '-'})`
        });

        return createdResponse(res, resultData, 'Menu berhasil ditambahkan');
    } catch (error) {
        console.error('Error createMenu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menambahkan menu', 500, error.message);
    }
};

// Memperbarui data menu
const updateMenu = async (req, res) => {
    try {
        const { id } = req.params;
        const { parent_id, name, path, icon, sequence, is_active } = req.body;

        const [existing] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Menu dengan ID '${id}' tidak ditemukan`);
        }

        // Hindari membuat menu menjadi parent dari dirinya sendiri
        if (parent_id === id) {
            return badRequestResponse(res, 'Menu tidak bisa menjadi parent untuk dirinya sendiri');
        }

        // Validasi parent_id jika diubah
        if (parent_id) {
            const [parent] = await db.query('SELECT id FROM m_menus WHERE id = ?', [parent_id]);
            if (parent.length === 0) {
                return badRequestResponse(res, `Parent menu dengan ID '${parent_id}' tidak ditemukan`);
            }
        }

        const current = existing[0];
        const newParentId = parent_id !== undefined ? (parent_id || null) : current.parent_id;
        const newName = name !== undefined ? name : current.name;
        const newPath = path !== undefined ? path : current.path;
        const newIcon = icon !== undefined ? icon : current.icon;
        const newSequence = sequence !== undefined ? Number(sequence) : current.sequence;
        const newIsActive = is_active !== undefined ? (is_active ? 1 : 0) : current.is_active;

        await db.query(
            `UPDATE m_menus 
             SET parent_id = ?, name = ?, path = ?, icon = ?, sequence = ?, is_active = ? 
             WHERE id = ?`,
            [newParentId, newName, newPath, newIcon, newSequence, newIsActive, id]
        );

        const [updatedMenu] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);

        const resultData = {
            ...updatedMenu[0],
            is_active: Boolean(updatedMenu[0].is_active)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'm_menus',
            description: `Memperbarui menu: ${newName} (ID: ${id})`
        });

        return successResponse(res, resultData, 'Menu berhasil diperbarui');
    } catch (error) {
        console.error('Error updateMenu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui menu', 500, error.message);
    }
};

// Menghapus data menu
const deleteMenu = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Menu dengan ID '${id}' tidak ditemukan`);
        }

        const target = existing[0];

        // Karena FOREIGN KEY parent_id diset ON DELETE CASCADE, submenu akan otomatis terhapus
        await db.query('DELETE FROM m_menus WHERE id = ?', [id]);

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 'm_menus',
            description: `Menghapus menu: ${target.name} (ID: ${id})`
        });

        return successResponse(res, null, 'Menu dan submenunya berhasil dihapus');
    } catch (error) {
        console.error('Error deleteMenu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus menu', 500, error.message);
    }
};

// Mengambil Navigasi Menu Pengguna yang sedang Login (/api/menus/my-menus)
// Digunakan frontend (Vue.js) untuk merender Sidebar sesuai izin can_read role user
const getUserNavigation = async (req, res) => {
    try {
        const userId = req.user.id;

        // Ambil role-role yang dimiliki user
        const [userRoles] = await db.query('SELECT role_id FROM user_roles WHERE user_id = ?', [userId]);

        if (userRoles.length === 0) {
            return successResponse(res, [], 'User belum memiliki role yang ditentukan');
        }

        const roleIds = userRoles.map(r => r.role_id);
        const placeholders = roleIds.map(() => '?').join(',');

        // Query gabungan: Mengambil menu aktif yang diberi izin can_read = TRUE untuk role user
        // Menggunakan GROUP BY m.id dan fungsi MAX() untuk menggabungkan izin jika user memiliki > 1 role
        const [menus] = await db.query(
            `SELECT 
                m.id,
                m.parent_id,
                m.name,
                m.path,
                m.icon,
                m.sequence,
                MAX(rm.can_read) AS can_read,
                MAX(rm.can_create) AS can_create,
                MAX(rm.can_update) AS can_update,
                MAX(rm.can_delete) AS can_delete,
                MAX(rm.can_print) AS can_print
             FROM m_menus m
             JOIN role_menus rm ON m.id = rm.menu_id
             WHERE rm.role_id IN (${placeholders})
               AND m.is_active = 1
               AND rm.can_read = 1
             GROUP BY m.id, m.parent_id, m.name, m.path, m.icon, m.sequence
             ORDER BY m.sequence ASC, m.name ASC`,
            roleIds
        );

        const formatted = menus.map(m => ({
            ...m,
            can_read: Boolean(m.can_read),
            can_create: Boolean(m.can_create),
            can_update: Boolean(m.can_update),
            can_delete: Boolean(m.can_delete),
            can_print: Boolean(m.can_print)
        }));

        // Susun menjadi hierarki tree untuk kemudahan rendering sidebar di frontend
        const navigationTree = buildMenuTree(formatted, null);

        return successResponse(res, navigationTree, 'Navigasi menu user berhasil diambil');
    } catch (error) {
        console.error('Error getUserNavigation:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil navigasi menu', 500, error.message);
    }
};

module.exports = {
    getAllMenus,
    getMenuById,
    createMenu,
    updateMenu,
    deleteMenu,
    getUserNavigation
};
