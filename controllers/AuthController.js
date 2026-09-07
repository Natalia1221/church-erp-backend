const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const {
    successResponse,
    createdResponse,
    badRequestResponse,
    unauthorizedResponse,
    forbiddenResponse,
    errorResponse
} = require('../helpers/responseHelper');
const { logAudit } = require('../helpers/auditHelper');

// Registrasi Pengguna Baru
const register = async (req, res) => {
    let connection;
    try {
        const { name, email, password, role_id, role_ids } = req.body;

        // Validasi input wajib
        if (!name || !email || !password) {
            return badRequestResponse(res, 'Field name, email, dan password wajib diisi');
        }

        // Validasi format email sederhana
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return badRequestResponse(res, 'Format email tidak valid');
        }

        // Validasi panjang password
        if (password.length < 6) {
            return badRequestResponse(res, 'Password minimal 6 karakter');
        }

        // Cek apakah email sudah terdaftar
        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );
        if (existingUsers.length > 0) {
            return errorResponse(res, 'Email sudah terdaftar, gunakan email lain', 409);
        }

        // Hash password menggunakan bcrypt dengan salt rounds 10
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // ID User dengan crypto.randomUUID()
        const userId = crypto.randomUUID();

        // Siapkan role list yang akan di-assign
        const assignedRoles = [];
        if (Array.isArray(role_ids) && role_ids.length > 0) {
            assignedRoles.push(...role_ids);
        } else if (role_id) {
            assignedRoles.push(role_id);
        }

        // Gunakan Transaction agar penambahan user & user_roles atomic
        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO users (id, name, email, password_hash, is_active) VALUES (?, ?, ?, ?, ?)',
            [userId, name, email, password_hash, true]
        );

        // Insert ke user_roles jika ada role yang ditentukan
        for (const rId of assignedRoles) {
            const userRoleId = crypto.randomUUID();
            await connection.query(
                'INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)',
                [userRoleId, userId, rId]
            );
        }

        await connection.commit();

        // Ambil data user yang baru dibuat tanpa password_hash
        const [newUser] = await db.query(
            'SELECT id, name, email, is_active, created_at, updated_at FROM users WHERE id = ?',
            [userId]
        );

        // Ambil data role yang terkait
        const [roles] = await db.query(
            `SELECT r.id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ?`,
            [userId]
        );

        const userData = {
            ...newUser[0],
            roles
        };

        // Buat token JWT otomatis untuk login instan saat register
        const token = jwt.sign(
            { id: userData.id, email: userData.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Catat ke audit log
        await logAudit({
            userId: userData.id,
            action: 'REGISTER',
            tableName: 'users',
            description: `Registrasi user baru: ${userData.name} (${userData.email})`
        });

        return createdResponse(
            res,
            { user: userData, token },
            'Registrasi berhasil'
        );
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error register:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return errorResponse(res, 'Email sudah terdaftar, gunakan email lain', 409);
        }

        return errorResponse(res, 'Terjadi kesalahan pada server saat registrasi', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Login Pengguna
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return badRequestResponse(res, 'Email dan password wajib diisi');
        }

        // Cari user berdasarkan email (yang belum di soft-delete)
        const [users] = await db.query(
            'SELECT id, name, email, password_hash, is_active, created_at FROM users WHERE email = ? AND deleted_at IS NULL',
            [email]
        );

        if (users.length === 0) {
            return unauthorizedResponse(res, 'Email atau password salah');
        }

        const user = users[0];

        // Cek status aktif
        if (!user.is_active) {
            return forbiddenResponse(res, 'Akun Anda dinonaktifkan. Silakan hubungi administrator');
        }

        // Verifikasi password hash
        const isPasswordMatch = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordMatch) {
            return unauthorizedResponse(res, 'Email atau password salah');
        }

        // Ambil data role user
        const [roles] = await db.query(
            `SELECT r.id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ?`,
            [user.id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Jangan pernah kirim password_hash ke client
        const safeUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            is_active: Boolean(user.is_active),
            created_at: user.created_at,
            roles
        };

        // Catat ke audit log aktivitas login
        await logAudit({
            userId: user.id,
            action: 'LOGIN',
            tableName: 'users',
            description: `User login: ${user.email}`
        });

        return successResponse(
            res,
            { user: safeUser, token },
            'Login berhasil'
        );
    } catch (error) {
        console.error('Error login:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat login', 500, error.message);
    }
};

// Mendapatkan Profil User yang sedang Login (/api/auth/me)
const getMe = async (req, res) => {
    try {
        // req.user sudah diverifikasi & disanitasi oleh authMiddleware
        return successResponse(res, req.user, 'Profil pengguna berhasil diambil');
    } catch (error) {
        console.error('Error getMe:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil profil user', 500, error.message);
    }
};

module.exports = {
    register,
    login,
    getMe
};
