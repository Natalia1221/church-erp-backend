const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { unauthorizedResponse, forbiddenResponse, errorResponse } = require('../helpers/responseHelper');

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        if (!token) {
            return unauthorizedResponse(res, 'Akses ditolak. Token tidak ditemukan');
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error('JWT_SECRET belum dikonfigurasi di file .env');
            return errorResponse(res, 'Konfigurasi server bermasalah', 500);
        }

        let decoded;
        try {
            decoded = jwt.verify(token, secret);
        } catch (jwtErr) {
            if (jwtErr.name === 'TokenExpiredError') {
                return unauthorizedResponse(res, 'Token telah kedaluwarsa, silakan login kembali');
            }
            return forbiddenResponse(res, 'Token tidak valid');
        }

        // Ambil user dari database untuk memastikan akun masih ada & aktif
        const [users] = await db.query(
            'SELECT id, name, email, is_active FROM users WHERE id = ? AND deleted_at IS NULL',
            [decoded.id]
        );

        if (users.length === 0) {
            return unauthorizedResponse(res, 'User tidak ditemukan atau sudah dihapus');
        }

        const user = users[0];

        if (!user.is_active) {
            return forbiddenResponse(res, 'Akun Anda dinonaktifkan. Hubungi administrator');
        }

        // Ambil data role user
        const [roles] = await db.query(
            `SELECT r.id, r.code, r.name 
             FROM user_roles ur 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE ur.user_id = ?`,
            [user.id]
        );

        user.roles = roles;
        req.user = user;
        next();
    } catch (error) {
        console.error('Error authenticateToken middleware:', error);
        return errorResponse(res, 'Terjadi kesalahan pada verifikasi autentikasi', 500, error.message);
    }
};

module.exports = authenticateToken;
