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
 * Helper internal untuk menyusun daftar flat menu menjadi hierarki tree untuk Sidebar
 * berdasarkan data referensi modul di m_settings (group = 'm_module')
 * Aturan: Setiap data dengan group m_module pada m_settings WAJIB menjadi module di sidebar
 * apabila sudah ada data di menu (m_menus) yg melibatkan m_module tersebut.
 */
const buildNavTreeFromMenus = (menuList, moduleSettings = []) => {
    // 1. Normalisasi dan urutkan moduleSettings (dari m_settings group = 'm_module')
    const activeModuleSettings = (moduleSettings || [])
        .filter(s => s.status === 1 || s.status === true || s.status === undefined)
        .sort((a, b) => {
            const seqA = a.value2 !== null && a.value2 !== undefined && a.value2 !== '' ? Number(a.value2) : 999;
            const seqB = b.value2 !== null && b.value2 !== undefined && b.value2 !== '' ? Number(b.value2) : 999;
            if (seqA !== seqB) return seqA - seqB;
            return (a.value1 || '').localeCompare(b.value1 || '');
        });

    const assignedMenuIds = new Set();
    const navTree = [];

    // Helper icon default per modul
    const getDefaultModuleIcon = (modName) => {
        const lower = (modName || '').toLowerCase();
        if (lower.includes('dashboard')) return 'LayoutDashboard';
        if (lower.includes('setup') || lower.includes('pengaturan')) return 'Settings';
        if (lower.includes('jadwal') || lower.includes('penjadwalan')) return 'Calendar';
        if (lower.includes('absen')) return 'ClipboardCheck';
        if (lower.includes('uang') || lower.includes('keuangan') || lower.includes('kas')) return 'Calculator';
        if (lower.includes('user') || lower.includes('pengguna')) return 'Users';
        if (lower.includes('role') || lower.includes('hak akses')) return 'ShieldCheck';
        return 'Layers';
    };

    // 2. Iterasi setiap modul dari m_settings (group = 'm_module')
    for (const setting of activeModuleSettings) {
        const modName = (setting.value1 || setting.key || '').trim();
        const modKey = (setting.key || '').trim().toLowerCase();
        const modNameLower = modName.toLowerCase();

        // Cocokkan menu berdasarkan kolom m.modul (case-insensitive)
        const matchingMenus = menuList.filter(m => {
            if (!m.modul) return false;
            const mModLower = m.modul.trim().toLowerCase();
            return mModLower === modNameLower || mModLower === modKey;
        });

        // Wajib menjadi module di sidebar jika ada data menu yang melibatkannya
        if (matchingMenus.length === 0) {
            continue;
        }

        matchingMenus.forEach(m => assignedMenuIds.add(m.id));
        matchingMenus.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));

        const modSequence = setting.value2 !== null && setting.value2 !== undefined && setting.value2 !== ''
            ? Number(setting.value2)
            : 999;

        // Jika hanya ada 1 item di modul dan path-nya ada, submodul kosong, serta namanya sama dengan nama modul (seperti 'Dashboard')
        if (matchingMenus.length === 1 && !matchingMenus[0].submodul && matchingMenus[0].path && 
            matchingMenus[0].name.toLowerCase() === modNameLower) {
            navTree.push({
                ...matchingMenus[0],
                sequence: modSequence,
                children: []
            });
            continue;
        }

        // Modul dengan grup submenu (Level 2 & Level 3)
        const submodulGroups = new Map();
        const directChildren = [];

        for (const item of matchingMenus) {
            if (item.submodul && item.submodul.trim()) {
                const subKey = item.submodul.trim();
                if (!submodulGroups.has(subKey)) {
                    submodulGroups.set(subKey, []);
                }
                submodulGroups.get(subKey).push(item);
            } else {
                directChildren.push({
                    ...item,
                    children: []
                });
            }
        }

        const level2Children = [...directChildren];

        for (const [submodName, subItems] of submodulGroups.entries()) {
            subItems.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));
            const subHeader = subItems.find(i => i.name.toLowerCase() === submodName.toLowerCase()) || subItems[0];
            const level3Items = subItems.filter(i => i.id !== subHeader.id || (subHeader.path && subItems.length > 1));

            if (level3Items.length > 0) {
                level2Children.push({
                    id: subHeader.id && subHeader.name.toLowerCase() === submodName.toLowerCase() && !subHeader.path
                        ? subHeader.id
                        : `submod-${subHeader.id || submodName}`,
                    name: submodName,
                    path: subHeader.path || null,
                    icon: subHeader.icon || 'Folder',
                    sequence: Number(subHeader.sequence) || 0,
                    children: level3Items.map(c => ({ ...c, children: [] }))
                });
            } else {
                level2Children.push({
                    ...subHeader,
                    children: []
                });
            }
        }

        level2Children.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));

        navTree.push({
            id: `module-${setting.id || setting.key.toLowerCase()}`,
            name: modName,
            path: null,
            icon: getDefaultModuleIcon(modName),
            sequence: modSequence,
            children: level2Children
        });
    }

    // 3. Fallback jika ada menu dengan modul yang belum terdaftar di m_settings
    const unassignedMenus = menuList.filter(m => !assignedMenuIds.has(m.id));
    if (unassignedMenus.length > 0) {
        const unassignedGroups = new Map();
        for (const menu of unassignedMenus) {
            const mod = menu.modul || menu.name || 'Lainnya';
            if (!unassignedGroups.has(mod)) {
                unassignedGroups.set(mod, []);
            }
            unassignedGroups.get(mod).push(menu);
        }

        for (const [modName, items] of unassignedGroups.entries()) {
            items.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));

            if (items.length === 1 && !items[0].submodul && items[0].path) {
                navTree.push({
                    ...items[0],
                    children: []
                });
                continue;
            }

            const headerItem = items.find(i => i.name.toLowerCase() === modName.toLowerCase() && !i.submodul) || items[0];
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
                subItems.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));
                const subHeader = subItems.find(i => i.name.toLowerCase() === submodName.toLowerCase()) || subItems[0];
                const level3Items = subItems.filter(i => i.id !== subHeader.id || (subHeader.path && subItems.length > 1));

                if (level3Items.length > 0) {
                    level2Children.push({
                        id: `submod-${subHeader.id || submodName}`,
                        name: submodName,
                        path: subHeader.path || null,
                        icon: subHeader.icon || 'Folder',
                        sequence: Number(subHeader.sequence) || 0,
                        children: level3Items.map(c => ({ ...c, children: [] }))
                    });
                } else {
                    level2Children.push({
                        ...subHeader,
                        children: []
                    });
                }
            }

            level2Children.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));

            navTree.push({
                id: `module-${headerItem.id}`,
                name: modName,
                path: null,
                icon: getDefaultModuleIcon(modName),
                sequence: Number(headerItem.sequence) || 999,
                children: level2Children
            });
        }
    }

    // Urutkan navigasi utama berdasarkan sequence ASC
    navTree.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.name.localeCompare(b.name));

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
            const [moduleSettings] = await db.query(
                "SELECT id, `key`, value1, value2, status FROM m_settings WHERE `group` = 'm_module' AND status = 1 ORDER BY CAST(value2 AS DECIMAL(10,2)) ASC, id ASC"
            );
            const menuTree = buildNavTreeFromMenus(formattedMenus, moduleSettings);
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
                MAX(COALESCE(rm.can_show, 0)) AS can_show,
                MAX(COALESCE(rm.can_read, 0)) AS can_read,
                MAX(COALESCE(rm.can_create, 0)) AS can_create,
                MAX(COALESCE(rm.can_update, 0)) AS can_update,
                MAX(COALESCE(rm.can_delete, 0)) AS can_delete,
                MAX(COALESCE(rm.can_print, 0)) AS can_print
             FROM m_menus m
             JOIN role_menus rm ON m.id = rm.menu_id AND rm.role_id IN (${placeholders})
             WHERE m.is_active = 1
               AND (
                   rm.can_read = 1
                   OR rm.can_show = 1
                   OR rm.can_create = 1
                   OR rm.can_update = 1
                   OR rm.can_delete = 1
                   OR rm.can_print = 1
               )
             GROUP BY m.id, m.modul, m.submodul, m.name, m.path, m.icon, m.sequence
             ORDER BY m.sequence ASC, m.name ASC`,
            roleIds
        );

        const formatted = menus.map(m => ({
            ...m,
            can_show: Boolean(m.can_show),
            can_read: Boolean(m.can_read),
            can_create: Boolean(m.can_create),
            can_update: Boolean(m.can_update),
            can_delete: Boolean(m.can_delete),
            can_print: Boolean(m.can_print)
        }));

        // Ambil data referensi modul dari m_settings (group = 'm_module' dan status = 1)
        const [moduleSettings] = await db.query(
            "SELECT id, `key`, value1, value2, status FROM m_settings WHERE `group` = 'm_module' AND status = 1 ORDER BY CAST(value2 AS DECIMAL(10,2)) ASC, id ASC"
        );

        // Susun menjadi hierarki tree untuk kemudahan rendering sidebar di frontend
        // Hanya tampilkan menu yang dapat dibaca (can_read) atau dapat ditampilkan (can_show) di navigasi sidebar
        const visibleNavMenus = formatted.filter(m => m.can_read || m.can_show);
        const navigationTree = buildNavTreeFromMenus(visibleNavMenus, moduleSettings);

        return successResponse(res, {
            menus: navigationTree,
            permissions: formatted
        }, 'Navigasi menu user berhasil diambil');
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
