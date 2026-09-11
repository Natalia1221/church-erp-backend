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
 * Helper internal untuk menyusun daftar flat menu (berdasarkan modul & submodul) menjadi hierarki tree untuk Sidebar
 */
const buildNavTreeFromMenus = (menuList) => {
    const moduleMap = new Map();

    for (const menu of menuList) {
        const mod = menu.modul || menu.name || 'Lainnya';
        if (!moduleMap.has(mod)) {
            moduleMap.set(mod, []);
        }
        moduleMap.get(mod).push(menu);
    }

    const navTree = [];

    for (const [modName, items] of moduleMap.entries()) {
        items.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.name.localeCompare(b.name));

        // Jika hanya ada 1 item di modul dan path-nya ada serta submodul kosong, jadikan top-level menu langsung
        if (items.length === 1 && !items[0].submodul && items[0].path) {
            navTree.push({
                ...items[0],
                children: []
            });
            continue;
        }

        // Modul dengan grup submenu
        const headerItem = items.find(i => i.name === modName && !i.submodul) || items[0];
        const childItems = items.filter(i => i.id !== headerItem.id || (headerItem.path && items.length > 1));

        const submodulGroups = new Map();
        const directChildren = [];

        for (const item of childItems) {
            if (item.submodul) {
                if (!submodulGroups.has(item.submodul)) {
                    submodulGroups.set(item.submodul, []);
                }
                submodulGroups.get(item.submodul).push(item);
            } else {
                directChildren.push({
                    ...item,
                    children: []
                });
            }
        }

        const level2Children = [...directChildren];

        for (const [submodName, subItems] of submodulGroups.entries()) {
            subItems.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.name.localeCompare(b.name));
            const subHeader = subItems.find(i => i.name === submodName) || subItems[0];
            const level3Items = subItems.filter(i => i.id !== subHeader.id || (subHeader.path && subItems.length > 1));

            if (level3Items.length > 0) {
                level2Children.push({
                    id: subHeader.id || `sub-${submodName}`,
                    name: submodName,
                    path: subHeader.path || null,
                    icon: subHeader.icon || 'Folder',
                    sequence: subHeader.sequence || 0,
                    children: level3Items.map(c => ({ ...c, children: [] }))
                });
            } else {
                level2Children.push({
                    ...subHeader,
                    children: []
                });
            }
        }

        level2Children.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.name.localeCompare(b.name));

        navTree.push({
            id: headerItem.id,
            name: modName,
            path: headerItem.path || null,
            icon: headerItem.icon || 'Layers',
            sequence: headerItem.sequence || 0,
            children: level2Children
        });
    }

    navTree.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || a.name.localeCompare(b.name));
    return navTree;
};

// Mengambil semua menu (Mendukung format list flat atau hierarki tree via query ?tree=true)
const getAllMenus = async (req, res) => {
    try {
        const { tree, is_active } = req.query;

        let query = 'SELECT id, modul, submodul, name, path, icon, sequence, is_active, created_at FROM m_menus WHERE 1=1';
        const params = [];

        if (is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
        }

        query += ' ORDER BY sequence ASC, name ASC';

        const [menus] = await db.query(query, params);

        const formattedMenus = menus.map(m => ({
            ...m,
            modul: m.modul || '-',
            submodul: m.submodul || null,
            module: m.modul || '-',
            sub_module: m.submodul || '-',
            is_active: Boolean(m.is_active)
        }));

        if (tree === 'true') {
            const menuTree = buildNavTreeFromMenus(formattedMenus);
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
            module: rows[0].modul || '-',
            sub_module: rows[0].submodul || '-',
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
        const { modul, submodul, name, path, icon, sequence = 0, is_active = true } = req.body;

        if (!name || !name.trim()) {
            return badRequestResponse(res, 'Nama Menu wajib diisi');
        }
        if (!modul || !modul.trim()) {
            return badRequestResponse(res, 'Modul wajib diisi');
        }

        const id = crypto.randomUUID();
        const trimmedModul = modul.trim();
        const trimmedSubmodul = submodul && submodul.trim() ? submodul.trim() : null;
        const trimmedName = name.trim();
        const trimmedPath = path && path.trim() ? path.trim() : null;
        const trimmedIcon = icon && icon.trim() ? icon.trim() : 'Layers';
        const parsedSequence = sequence !== undefined && sequence !== null && sequence !== '' ? Number(sequence) : 0;
        const activeFlag = is_active ? 1 : 0;

        await db.query(
            `INSERT INTO m_menus (id, modul, submodul, name, path, icon, sequence, is_active) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                trimmedModul,
                trimmedSubmodul,
                trimmedName,
                trimmedPath,
                trimmedIcon,
                parsedSequence,
                activeFlag
            ]
        );

        const [newMenu] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);

        const resultData = {
            ...newMenu[0],
            module: newMenu[0].modul || '-',
            sub_module: newMenu[0].submodul || '-',
            is_active: Boolean(newMenu[0].is_active)
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'm_menus',
            description: `Menambahkan menu baru: ${trimmedName} (Modul: ${trimmedModul}, Submodul: ${trimmedSubmodul || '-'}, Path: ${trimmedPath || '-'})`
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
        const { modul, submodul, name, path, icon, sequence, is_active } = req.body;

        const [existing] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Menu dengan ID '${id}' tidak ditemukan`);
        }

        const current = existing[0];
        const newModul = modul !== undefined ? (modul ? modul.trim() : current.modul) : current.modul;
        const newSubmodul = submodul !== undefined ? (submodul ? submodul.trim() : null) : current.submodul;
        const newName = name !== undefined ? name.trim() : current.name;
        const newPath = path !== undefined ? (path ? path.trim() : null) : current.path;
        const newIcon = icon !== undefined ? (icon ? icon.trim() : null) : current.icon;
        const newSequence = sequence !== undefined && sequence !== null && sequence !== '' ? Number(sequence) : current.sequence;
        const newIsActive = is_active !== undefined ? (is_active ? 1 : 0) : current.is_active;

        await db.query(
            `UPDATE m_menus 
             SET modul = ?, submodul = ?, name = ?, path = ?, icon = ?, sequence = ?, is_active = ? 
             WHERE id = ?`,
            [newModul, newSubmodul, newName, newPath, newIcon, newSequence, newIsActive, id]
        );

        const [updatedMenu] = await db.query('SELECT * FROM m_menus WHERE id = ?', [id]);

        const resultData = {
            ...updatedMenu[0],
            module: updatedMenu[0].modul || '-',
            sub_module: updatedMenu[0].submodul || '-',
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

        await db.query('DELETE FROM m_menus WHERE id = ?', [id]);

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 'm_menus',
            description: `Menghapus menu: ${target.name} (ID: ${id})`
        });

        return successResponse(res, null, 'Menu berhasil dihapus');
    } catch (error) {
        console.error('Error deleteMenu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus menu', 500, error.message);
    }
};

// Mengambil Navigasi Menu Pengguna yang sedang Login (/api/menus/my-menus)
const getUserNavigation = async (req, res) => {
    try {
        const userId = req.user.id;

        // Ambil role-role aktif yang dimiliki user
        const [userRoles] = await db.query(
            `SELECT r.id, r.code 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ? AND COALESCE(r.status, 1) = 1`,
            [userId]
        );

        if (userRoles.length === 0) {
            return successResponse(res, [], 'User belum memiliki role yang ditentukan');
        }

        const isAdmin = userRoles.some(r => r.code && r.code.toUpperCase() === 'ADMIN');
        let formatted = [];

        if (isAdmin) {
            // Administrator mendapatkan semua menu aktif dari m_menus
            const [menus] = await db.query(
                `SELECT 
                    id,
                    modul,
                    submodul,
                    name,
                    path,
                    icon,
                    sequence,
                    1 AS can_show,
                    1 AS can_read,
                    1 AS can_create,
                    1 AS can_update,
                    1 AS can_delete,
                    1 AS can_print
                 FROM m_menus
                 WHERE is_active = 1
                 ORDER BY sequence ASC, name ASC`
            );

            formatted = menus.map(m => ({
                ...m,
                can_show: true,
                can_read: true,
                can_create: true,
                can_update: true,
                can_delete: true,
                can_print: true
            }));
        } else {
            const roleIds = userRoles.map(r => r.id);
            const placeholders = roleIds.map(() => '?').join(',');

            const [menus] = await db.query(
                `SELECT 
                    m.id,
                    m.modul,
                    m.submodul,
                    m.name,
                    m.path,
                    m.icon,
                    m.sequence,
                    MAX(COALESCE(rm.can_show, rm.can_read, 0)) AS can_show,
                    MAX(rm.can_read) AS can_read,
                    MAX(rm.can_create) AS can_create,
                    MAX(rm.can_update) AS can_update,
                    MAX(rm.can_delete) AS can_delete,
                    MAX(rm.can_print) AS can_print
                 FROM m_menus m
                 LEFT JOIN role_menus rm ON m.id = rm.menu_id AND rm.role_id IN (${placeholders})
                 WHERE m.is_active = 1
                   AND (
                       rm.can_show = 1
                       OR (rm.can_show IS NULL AND rm.can_read = 1)
                       OR m.path IS NULL
                   )
                 GROUP BY m.id, m.modul, m.submodul, m.name, m.path, m.icon, m.sequence
                 ORDER BY m.sequence ASC, m.name ASC`,
                roleIds
            );

            formatted = menus.map(m => ({
                ...m,
                can_show: Boolean(m.can_show),
                can_read: Boolean(m.can_read),
                can_create: Boolean(m.can_create),
                can_update: Boolean(m.can_update),
                can_delete: Boolean(m.can_delete),
                can_print: Boolean(m.can_print)
            }));
        }

        // Susun menjadi hierarki tree untuk kemudahan rendering sidebar di frontend
        const navigationTree = buildNavTreeFromMenus(formatted);

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
