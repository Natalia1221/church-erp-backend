const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const {
    successResponse,
    createdResponse,
    badRequestResponse,
    notFoundResponse,
    errorResponse
} = require('../helpers/responseHelper');
const { logAudit } = require('../helpers/auditHelper');

// Mengambil semua user (Mendukung filter is_active dan menyertakan roles)
const getAllUsers = async (req, res) => {
    try {
        const { is_active } = req.query;

        let query = `
            SELECT id, name, email, is_active, created_at, updated_at 
            FROM users 
            WHERE deleted_at IS NULL
        `;
        const params = [];

        if (is_active !== undefined) {
            query += ' AND is_active = ?';
            params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
        }

        query += ' ORDER BY created_at DESC';

        const [users] = await db.query(query, params);

        if (users.length === 0) {
            return successResponse(res, [], 'Data user berhasil diambil');
        }

        // Ambil relasi roles untuk semua user yang terpilih
        const userIds = users.map(u => u.id);
        const placeholders = userIds.map(() => '?').join(',');

        const [userRoles] = await db.query(
            `SELECT ur.user_id, r.id AS role_id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id IN (${placeholders})`,
            userIds
        );

        // Petakan roles ke masing-masing user
        const roleMap = {};
        for (const item of userRoles) {
            if (!roleMap[item.user_id]) {
                roleMap[item.user_id] = [];
            }
            roleMap[item.user_id].push({
                id: item.role_id,
                code: item.code,
                name: item.name
            });
        }

        const formattedUsers = users.map(user => ({
            ...user,
            is_active: Boolean(user.is_active),
            roles: roleMap[user.id] || []
        }));

        return successResponse(res, formattedUsers, 'Data user berhasil diambil');
    } catch (error) {
        console.error('Error getAllUsers:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data user', 500, error.message);
    }
};

// Mengambil detail user berdasarkan ID
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        const [users] = await db.query(
            'SELECT id, name, email, is_active, created_at, updated_at FROM users WHERE id = ? AND deleted_at IS NULL',
            [id]
        );

        if (users.length === 0) {
            return notFoundResponse(res, `User dengan ID '${id}' tidak ditemukan`);
        }

        const user = users[0];

        // Ambil data roles user
        const [roles] = await db.query(
            `SELECT r.id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ?`,
            [id]
        );

        return successResponse(
            res,
            {
                ...user,
                is_active: Boolean(user.is_active),
                roles
            },
            'Detail user berhasil diambil'
        );
    } catch (error) {
        console.error('Error getUserById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data user', 500, error.message);
    }
};

// Membuat user baru (dengan hashing password & assign role menggunakan transaction)
const createUser = async (req, res) => {
    let connection;
    try {
        const { name, email, password, is_active = true, role_id, role_ids } = req.body;

        if (!name || !email || !password) {
            return badRequestResponse(res, 'Field name, email / username, dan password wajib diisi');
        }

        const identifier = email.trim();
        if (/\s/.test(identifier)) {
            return badRequestResponse(res, 'Email atau username tidak boleh mengandung spasi');
        }
        if (identifier.length < 3) {
            return badRequestResponse(res, 'Email atau username minimal 3 karakter');
        }

        if (password.length < 6) {
            return badRequestResponse(res, 'Password minimal 6 karakter');
        }

        // Cek apakah email/username sudah terdaftar
        const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [identifier]);
        if (existing.length > 0) {
            return errorResponse(res, 'Email / username sudah terdaftar, gunakan yang lain', 409);
        }

        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);
        const userId = crypto.randomUUID();

        // Kumpulkan role list yang akan di-assign
        const targetRoles = [];
        if (Array.isArray(role_ids) && role_ids.length > 0) {
            targetRoles.push(...role_ids);
        } else if (role_id) {
            targetRoles.push(role_id);
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO users (id, name, email, password_hash, is_active) VALUES (?, ?, ?, ?, ?)',
            [userId, name, identifier, password_hash, is_active ? 1 : 0]
        );

        for (const rId of targetRoles) {
            const userRoleId = crypto.randomUUID();
            await connection.query(
                'INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)',
                [userRoleId, userId, rId]
            );
        }

        await connection.commit();

        // Ambil data user yang baru dibuat
        const [newUser] = await db.query(
            'SELECT id, name, email, is_active, created_at, updated_at FROM users WHERE id = ?',
            [userId]
        );

        const [roles] = await db.query(
            `SELECT r.id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ?`,
            [userId]
        );

        const createdUser = {
            ...newUser[0],
            is_active: Boolean(newUser[0].is_active),
            roles
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 'users',
            description: `Menambahkan user baru: ${createdUser.name} (${createdUser.email})`
        });

        return createdResponse(res, createdUser, 'User berhasil dibuat');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error createUser:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Email sudah terdaftar, gunakan email lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat membuat user', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Memperbarui data user (nama, email, status aktif, password opsional, dan role)
const updateUser = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const { name, email, password, is_active, role_id, role_ids } = req.body;

        // Cek user yang ada
        const [users] = await db.query(
            'SELECT id, email FROM users WHERE id = ? AND deleted_at IS NULL',
            [id]
        );

        if (users.length === 0) {
            return notFoundResponse(res, `User dengan ID '${id}' tidak ditemukan`);
        }

        // Cek apakah email/username baru sudah dipakai user lain
        if (email && email.trim() !== users[0].email) {
            const identifier = email.trim();
            const [emailInUse] = await db.query(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [identifier, id]
            );
            if (emailInUse.length > 0) {
                return errorResponse(res, 'Email / username sudah digunakan oleh user lain', 409);
            }
        }

        // Siapkan field update dinamis
        const updates = [];
        const params = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }

        if (email !== undefined) {
            const identifier = email.trim();
            if (/\s/.test(identifier)) {
                return badRequestResponse(res, 'Email atau username tidak boleh mengandung spasi');
            }
            if (identifier.length < 3) {
                return badRequestResponse(res, 'Email atau username minimal 3 karakter');
            }
            updates.push('email = ?');
            params.push(identifier);
        }

        if (is_active !== undefined) {
            updates.push('is_active = ?');
            params.push(is_active ? 1 : 0);
        }

        // Jika ada perubahan password
        if (password) {
            if (password.length < 6) {
                return badRequestResponse(res, 'Password minimal 6 karakter');
            }
            const password_hash = await bcrypt.hash(password, 10);
            updates.push('password_hash = ?');
            params.push(password_hash);
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        if (updates.length > 0) {
            params.push(id);
            await connection.query(
                `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
        }

        // Jika role di-update
        const targetRoles = [];
        let shouldUpdateRoles = false;
        if (Array.isArray(role_ids)) {
            shouldUpdateRoles = true;
            targetRoles.push(...role_ids);
        } else if (role_id !== undefined) {
            shouldUpdateRoles = true;
            if (role_id) targetRoles.push(role_id);
        }

        if (shouldUpdateRoles) {
            // Hapus relasi role lama
            await connection.query('DELETE FROM user_roles WHERE user_id = ?', [id]);

            // Tambahkan relasi role baru
            for (const rId of targetRoles) {
                const userRoleId = crypto.randomUUID();
                await connection.query(
                    'INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)',
                    [userRoleId, id, rId]
                );
            }
        }

        await connection.commit();

        // Ambil data user yang telah diperbarui
        const [updatedUser] = await db.query(
            'SELECT id, name, email, is_active, created_at, updated_at FROM users WHERE id = ?',
            [id]
        );

        const [roles] = await db.query(
            `SELECT r.id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ?`,
            [id]
        );

        const resultUser = {
            ...updatedUser[0],
            is_active: Boolean(updatedUser[0].is_active),
            roles
        };

        // Catat ke audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 'users',
            description: `Memperbarui data user: ${resultUser.name} (ID: ${id})`
        });

        return successResponse(res, resultUser, 'Data user berhasil diperbarui');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updateUser:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Email sudah digunakan oleh user lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui user', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Menghapus data user (Soft delete default, atau permanent hard delete dengan query ?permanent=true)
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { permanent } = req.query;

        // Cek user yang ada
        const [users] = await db.query(
            'SELECT id, name, email FROM users WHERE id = ? AND deleted_at IS NULL',
            [id]
        );

        if (users.length === 0) {
            return notFoundResponse(res, `User dengan ID '${id}' tidak ditemukan atau sudah dihapus`);
        }

        const targetUser = users[0];

        if (permanent === 'true') {
            // Hard delete terproteksi (akan cascade delete user_roles karena foreign key ON DELETE CASCADE)
            await db.query('DELETE FROM users WHERE id = ?', [id]);

            await logAudit({
                userId: req.user?.id || null,
                action: 'DELETE',
                tableName: 'users',
                description: `Menghapus user permanen: ${targetUser.name} (${targetUser.email})`
            });

            return successResponse(res, null, 'User berhasil dihapus secara permanen');
        } else {
            // Soft delete dengan menetapkan deleted_at
            await db.query(
                'UPDATE users SET deleted_at = CURRENT_TIMESTAMP, is_active = FALSE WHERE id = ?',
                [id]
            );

            await logAudit({
                userId: req.user?.id || null,
                action: 'DELETE',
                tableName: 'users',
                description: `Soft delete / menonaktifkan user: ${targetUser.name} (${targetUser.email})`
            });

            return successResponse(res, null, 'User berhasil dinonaktifkan / dihapus (soft delete)');
        }
    } catch (error) {
        console.error('Error deleteUser:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus user', 500, error.message);
    }
};

module.exports = {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser
};
