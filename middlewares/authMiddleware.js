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

/**
 * Middleware untuk memverifikasi hak akses CRUD berdasarkan detail role pengguna saat ini
 * @param {string} menuPath - Path menu sistem (misal: '/menus', '/roles', '/keuangan/lainnya')
 * @param {'can_read'|'can_create'|'can_show'|'can_update'|'can_delete'|'can_print'} action - Aksi yang diperiksa
 */
const authorizePermission = (menuPath, action) => {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.roles || req.user.roles.length === 0) {
                return forbiddenResponse(res, 'Anda tidak memiliki peran (role) yang aktif untuk melakukan tindakan ini');
            }

            const roleIds = req.user.roles.map(r => r.id);
            const placeholders = roleIds.map(() => '?').join(',');
            const cleanPath = (menuPath || '').trim().replace(/\/+$/, '') || '/';

            // Support either single action or array of acceptable actions (OR condition)
            const actions = Array.isArray(action) ? action : [action];
            const actionCondition = actions.map(act => `rm.${act} = 1`).join(' OR ');

            // Cek apakah ada role yang dimiliki pengguna dengan izin aksi terkait bernilai 1
            const [rows] = await db.query(
                `SELECT rm.id 
                 FROM role_menus rm 
                 JOIN m_menus m ON rm.menu_id = m.id 
                 WHERE rm.role_id IN (${placeholders}) 
                   AND (m.path = ? OR m.path = ?) 
                   AND (${actionCondition})`,
                [...roleIds, cleanPath, cleanPath + '/']
            );

            if (rows.length === 0) {
                return forbiddenResponse(res, `Akses ditolak: Peran akun Anda tidak memiliki izin (${actions.join('/')}) pada menu ini`);
            }

            next();
        } catch (error) {
            console.error('Error authorizePermission:', error);
            return errorResponse(res, 'Terjadi kesalahan saat memeriksa izin akses pengguna', 500, error.message);
        }
    };
};

authenticateToken.authenticateToken = authenticateToken;
authenticateToken.authorizePermission = authorizePermission;

module.exports = authenticateToken;

