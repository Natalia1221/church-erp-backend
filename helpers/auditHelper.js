const crypto = require('crypto');
const db = require('../config/db');

/**
 * Helper untuk mencatat aktivitas sistem ke tabel t_audit_logs
 * @param {Object} params
 * @param {string|null} params.userId - ID user yang melakukan aksi (opsional/null jika sistem)
 * @param {'CREATE'|'UPDATE'|'DELETE'|'LOGIN'|'LOGOUT'|string} params.action - Jenis aksi
 * @param {string} params.tableName - Nama tabel yang dimanipulasi
 * @param {string} params.description - Penjelasan ringkas aktivitas
 * @param {Object} [params.connection] - MySQL connection pool/transaction (opsional)
 */
const logAudit = async ({ userId = null, action, tableName, description = null, connection = null }) => {
    try {
        const id = crypto.randomUUID();
        const client = connection || db;

        await client.query(
            `INSERT INTO t_audit_logs (id, user_id, action, table_name, description) 
             VALUES (?, ?, ?, ?, ?)`,
            [id, userId || null, action, tableName, description]
        );

        return id;
    } catch (error) {
        // Logging error ke console agar tidak menggagalkan alur utama transaksi
        console.error('❌ Gagal mencatat audit log:', error.message);
        return null;
    }
};

module.exports = {
    logAudit
};
