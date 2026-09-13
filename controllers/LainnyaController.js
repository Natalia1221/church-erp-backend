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

// Mengambil seluruh acara bertipe LAINNYA beserta jumlah kehadiran
const getAllLainnya = async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT 
                e.id,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
                e.title,
                COALESCE(e.is_attendance, 0) AS is_attendance,
                e.created_at,
                (SELECT COUNT(DISTINCT ur.user_id) 
                 FROM user_roles ur 
                 JOIN m_roles r ON ur.role_id = r.id 
                 JOIN users u ON ur.user_id = u.id 
                 WHERE r.code = 'GSM' AND u.is_active = 1 AND u.deleted_at IS NULL) AS total_attendance,
                (SELECT COUNT(DISTINCT ta.user_id) 
                 FROM t_attendances ta 
                 WHERE ta.event_id = e.id AND ta.check_in_time IS NOT NULL) AS attended_count
            FROM t_events e
            WHERE e.event_type = 'LAINNYA'
        `;
        const params = [];

        if (search && search.trim()) {
            query += ` AND (e.title LIKE ? OR e.event_date LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        query += `
            ORDER BY e.event_date DESC, e.created_at DESC
        `;

        const [rows] = await db.query(query, params);

        const formatted = rows.map(item => ({
            ...item,
            is_attendance: Number(item.is_attendance) === 1,
            total_attendance: Number(item.total_attendance || 0),
            attended_count: Number(item.attended_count || 0)
        }));

        return successResponse(res, formatted, 'Daftar acara Lainnya berhasil diambil');
    } catch (error) {
        console.error('Error getAllLainnya:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data acara lainnya', 500, error.message);
    }
};

// Mengambil detail satu acara Lainnya beserta daftar kehadiran GSM
const getLainnyaById = async (req, res) => {
    try {
        const { id } = req.params;

        const [events] = await db.query(
            `SELECT 
                id,
                event_type,
                DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
                title,
                COALESCE(is_attendance, 0) AS is_attendance,
                created_at,
                updated_at
             FROM t_events 
             WHERE id = ? AND event_type = 'LAINNYA'`,
            [id]
        );

        if (events.length === 0) {
            return notFoundResponse(res, `Acara Lainnya dengan ID '${id}' tidak ditemukan`);
        }

        const lainnya = {
            ...events[0],
            is_attendance: Number(events[0].is_attendance) === 1
        };

        // Ambil daftar GSM dari t_attendances
        const [attendances] = await db.query(
            `SELECT 
                ta.id AS attendance_id,
                ta.event_id,
                ta.user_id,
                u.name AS gsm_name,
                u.email AS gsm_email,
                ta.check_in_time,
                ta.is_scheduled,
                ta.photo_proof,
                CASE WHEN ta.check_in_time IS NOT NULL THEN 1 ELSE 0 END AS is_present
             FROM t_attendances ta
             JOIN users u ON ta.user_id = u.id
             WHERE ta.event_id = ?
             ORDER BY u.name ASC`,
            [id]
        );

        const formattedAttendances = attendances.map(item => ({
            ...item,
            is_scheduled: Boolean(item.is_scheduled),
            is_present: Boolean(item.is_present)
        }));

        return successResponse(
            res,
            {
                lainnya,
                attendances: formattedAttendances,
                total_gsm: formattedAttendances.length,
                attended_count: formattedAttendances.filter(a => a.is_present).length
            },
            'Detail acara Lainnya berhasil diambil'
        );
    } catch (error) {
        console.error('Error getLainnyaById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail acara lainnya', 500, error.message);
    }
};

// Membuat acara Lainnya baru
const createLainnya = async (req, res) => {
    let connection;
    try {
        const { title, event_date, is_attendance = false } = req.body;

        if (!title || !title.trim()) {
            return badRequestResponse(res, 'Nama acara (title) wajib diisi');
        }

        if (!event_date || !event_date.trim()) {
            return badRequestResponse(res, 'Tanggal acara wajib diisi');
        }

        const trimmedTitle = title.trim();
        const trimmedDate = event_date.trim();

        // Validasi format tanggal YYYY-MM-DD
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(trimmedDate)) {
            return badRequestResponse(res, 'Format tanggal tidak valid (harus YYYY-MM-DD)');
        }

        const eventId = crypto.randomUUID();
        const activeAttendance = (is_attendance === false || is_attendance === 0 || is_attendance === '0' || is_attendance === 'false') ? 0 : 1;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Simpan acara ke t_events dengan event_type = 'LAINNYA'
        await connection.query(
            `INSERT INTO t_events (id, event_type, event_date, title, is_attendance) 
             VALUES (?, 'LAINNYA', ?, ?, ?)`,
            [eventId, trimmedDate, trimmedTitle, activeAttendance]
        );

        // Hitung total GSM aktif untuk info respons
        const [gsmUsers] = await connection.query(
            `SELECT COUNT(DISTINCT u.id) AS total_gsm 
             FROM users u 
             JOIN user_roles ur ON u.id = ur.user_id 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE r.code = 'GSM' AND u.is_active = 1 AND u.deleted_at IS NULL`
        );
        const totalGsmCount = gsmUsers[0]?.total_gsm || 0;

        await connection.commit();

        const [created] = await db.query(
            `SELECT id, event_type, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, title, is_attendance, created_at 
             FROM t_events WHERE id = ?`,
            [eventId]
        );

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'CREATE',
            tableName: 't_events',
            description: `Menambahkan acara Lainnya baru: ${trimmedTitle} (${trimmedDate}) dengan status absensi ${activeAttendance ? 'aktif' : 'nonaktif'}`
        });

        return createdResponse(
            res,
            {
                ...created[0],
                is_attendance: Number(created[0].is_attendance) === 1,
                total_attendance: totalGsmCount,
                attended_count: 0
            },
            'Acara Lainnya berhasil dibuat'
        );
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error createLainnya:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat membuat acara lainnya', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Menghapus acara Lainnya
const deleteLainnya = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM t_events WHERE id = ? AND event_type = \'LAINNYA\'', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Acara Lainnya dengan ID '${id}' tidak ditemukan`);
        }

        const target = existing[0];

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Hapus data absensi terkait terlebih dahulu
        await connection.query('DELETE FROM t_attendances WHERE event_id = ?', [id]);
        // Hapus acara
        await connection.query('DELETE FROM t_events WHERE id = ?', [id]);

        await connection.commit();

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 't_events',
            description: `Menghapus acara Lainnya: ${target.title} (ID: ${id})`
        });

        return successResponse(res, null, 'Acara Lainnya berhasil dihapus');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleteLainnya:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus acara lainnya', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    getAllLainnya,
    getLainnyaById,
    createLainnya,
    deleteLainnya
};
