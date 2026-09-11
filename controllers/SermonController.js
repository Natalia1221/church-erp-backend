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

// Mengambil seluruh acara bertipe SERMON beserta jumlah kehadiran
const getAllSermons = async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT 
                e.id,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
                e.title,
                COALESCE(e.is_attendance, 1) AS is_attendance,
                e.created_at,
                COUNT(ta.id) AS total_attendance,
                COUNT(CASE WHEN ta.check_in_time IS NOT NULL THEN 1 END) AS attended_count
            FROM t_events e
            LEFT JOIN t_attendances ta ON e.id = ta.event_id
            WHERE e.event_type = 'SERMON'
        `;
        const params = [];

        if (search && search.trim()) {
            query += ` AND (e.title LIKE ? OR e.event_date LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        query += `
            GROUP BY e.id, e.event_type, e.event_date, e.title, e.is_attendance, e.created_at
            ORDER BY e.event_date DESC, e.created_at DESC
        `;

        const [rows] = await db.query(query, params);

        const formatted = rows.map(item => ({
            ...item,
            is_attendance: Boolean(item.is_attendance),
            total_attendance: Number(item.total_attendance || 0),
            attended_count: Number(item.attended_count || 0)
        }));

        return successResponse(res, formatted, 'Daftar acara Sermon berhasil diambil');
    } catch (error) {
        console.error('Error getAllSermons:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data sermon', 500, error.message);
    }
};

// Mengambil detail satu acara Sermon beserta daftar kehadiran GSM
const getSermonById = async (req, res) => {
    try {
        const { id } = req.params;

        const [events] = await db.query(
            `SELECT 
                id,
                event_type,
                DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
                title,
                COALESCE(is_attendance, 1) AS is_attendance,
                created_at,
                updated_at
             FROM t_events 
             WHERE id = ? AND event_type = 'SERMON'`,
            [id]
        );

        if (events.length === 0) {
            return notFoundResponse(res, `Acara Sermon dengan ID '${id}' tidak ditemukan`);
        }

        const sermon = {
            ...events[0],
            is_attendance: Boolean(events[0].is_attendance)
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
                sermon,
                attendances: formattedAttendances,
                total_gsm: formattedAttendances.length,
                attended_count: formattedAttendances.filter(a => a.is_present).length
            },
            'Detail acara Sermon berhasil diambil'
        );
    } catch (error) {
        console.error('Error getSermonById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail sermon', 500, error.message);
    }
};

// Membuat acara Sermon baru
const createSermon = async (req, res) => {
    let connection;
    try {
        const { event_date, is_attendance = true } = req.body;

        if (!event_date || !event_date.trim()) {
            return badRequestResponse(res, 'Tanggal acara sermon wajib diisi');
        }

        const trimmedDate = event_date.trim();
        // Title otomatis berformat SERMON_TANGGAL
        const generatedTitle = `SERMON_${trimmedDate}`;
        const eventId = crypto.randomUUID();
        const activeAttendance = is_attendance ? 1 : 0;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Simpan acara ke t_events dengan event_type = 'SERMON'
        await connection.query(
            `INSERT INTO t_events (id, event_type, event_date, title, is_attendance) 
             VALUES (?, 'SERMON', ?, ?, ?)`,
            [eventId, trimmedDate, generatedTitle, activeAttendance]
        );

        let gsmAssignedCount = 0;

        // 2. Apabila melakukan absensi dicentang, buat baris data di t_attendances untuk seluruh role GSM
        if (activeAttendance === 1) {
            const [gsmUsers] = await connection.query(
                `SELECT DISTINCT u.id, u.name 
                 FROM users u 
                 JOIN user_roles ur ON u.id = ur.user_id 
                 JOIN m_roles r ON ur.role_id = r.id 
                 WHERE r.code = 'GSM' AND u.is_active = 1`
            );

            if (gsmUsers.length > 0) {
                for (const user of gsmUsers) {
                    const attendanceId = crypto.randomUUID();
                    await connection.query(
                        `INSERT INTO t_attendances (id, event_id, user_id, is_scheduled) 
                         VALUES (?, ?, ?, 1)`,
                        [attendanceId, eventId, user.id]
                    );
                }
                gsmAssignedCount = gsmUsers.length;
            }
        }

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
            description: `Menambahkan acara Sermon baru: ${generatedTitle} (${trimmedDate}) dengan ${gsmAssignedCount} GSM terdaftar di absensi`
        });

        return createdResponse(
            res,
            {
                ...created[0],
                is_attendance: Boolean(created[0].is_attendance),
                total_attendance: gsmAssignedCount,
                attended_count: 0
            },
            'Acara Sermon berhasil dibuat'
        );
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error createSermon:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat membuat acara sermon', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Menghapus acara Sermon
const deleteSermon = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM t_events WHERE id = ? AND event_type = \'SERMON\'', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Acara Sermon dengan ID '${id}' tidak ditemukan`);
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
            description: `Menghapus acara Sermon: ${target.title} (ID: ${id})`
        });

        return successResponse(res, null, 'Acara Sermon berhasil dihapus');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleteSermon:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus acara sermon', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    getAllSermons,
    getSermonById,
    createSermon,
    deleteSermon
};
