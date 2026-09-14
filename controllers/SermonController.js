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
                COALESCE(e.is_persembahan, 0) AS is_persembahan,
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
            WHERE e.event_type = 'SERMON'
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
        const { event_date, is_attendance, is_persembahan } = req.body;

        if (!event_date) {
            return badRequestResponse(res, 'Field event_date wajib diisi');
        }

        const trimmedDate = event_date.trim();

        // Validasi format tanggal YYYY-MM-DD
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(trimmedDate)) {
            return badRequestResponse(res, 'Format tanggal harus YYYY-MM-DD (contoh: 2026-09-13)');
        }

        // Validasi: Tidak boleh ada acara Sermon ganda pada tanggal yang sama
        const [existingDate] = await db.query(
            "SELECT id, title FROM t_events WHERE event_type = 'SERMON' AND event_date = ?",
            [trimmedDate]
        );
        if (existingDate.length > 0) {
            return badRequestResponse(
                res,
                `Acara Sermon untuk tanggal ${trimmedDate} sudah ada (${existingDate[0].title}). Tanggal acara sermon tidak boleh sama/duplikat.`
            );
        }

        // Title otomatis berformat SERMON_TANGGAL
        const generatedTitle = `SERMON_${trimmedDate}`;
        const eventId = crypto.randomUUID();
        const activeAttendance = (is_attendance === false || is_attendance === 0 || is_attendance === '0' || is_attendance === 'false') ? 0 : 1;
        const activePersembahan = (is_persembahan === true || is_persembahan === 1 || is_persembahan === '1' || is_persembahan === 'true') ? 1 : 0;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Simpan acara ke t_events dengan event_type = 'SERMON'
        await connection.query(
            `INSERT INTO t_events (id, event_type, event_date, title, is_attendance, is_persembahan) 
             VALUES (?, 'SERMON', ?, ?, ?, ?)`,
            [eventId, trimmedDate, generatedTitle, activeAttendance, activePersembahan]
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
            description: `Menambahkan acara Sermon baru: ${generatedTitle} (${trimmedDate})`
        });

        return createdResponse(
            res,
            {
                ...created[0],
                is_attendance: Number(created[0].is_attendance) === 1,
                total_attendance: totalGsmCount,
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

// Update Acara Sermon
const updateSermon = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const { event_date, is_attendance, is_persembahan } = req.body;

        const [existing] = await db.query('SELECT * FROM t_events WHERE id = ? AND event_type = \'SERMON\'', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Acara Sermon dengan ID '${id}' tidak ditemukan`);
        }

        const currentEvent = existing[0];
        let trimmedDate = currentEvent.event_date;
        let generatedTitle = currentEvent.title;

        if (event_date && String(event_date).trim()) {
            trimmedDate = String(event_date).trim();

            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(trimmedDate)) {
                return badRequestResponse(res, 'Format tanggal harus YYYY-MM-DD (contoh: 2026-09-13)');
            }

            // Cek duplikasi jika tanggal berubah
            const [existingDate] = await db.query(
                "SELECT id, title FROM t_events WHERE event_type = 'SERMON' AND event_date = ? AND id != ?",
                [trimmedDate, id]
            );
            if (existingDate.length > 0) {
                return badRequestResponse(
                    res,
                    `Acara Sermon untuk tanggal ${trimmedDate} sudah ada (${existingDate[0].title}).`
                );
            }

            generatedTitle = `SERMON_${trimmedDate}`;
        }

        const activeAttendance = is_attendance !== undefined
            ? ((is_attendance === false || is_attendance === 0 || is_attendance === '0' || is_attendance === 'false') ? 0 : 1)
            : currentEvent.is_attendance;

        const activePersembahan = is_persembahan !== undefined
            ? ((is_persembahan === true || is_persembahan === 1 || is_persembahan === '1' || is_persembahan === 'true') ? 1 : 0)
            : currentEvent.is_persembahan;

        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.query(
            `UPDATE t_events 
             SET event_date = ?, title = ?, is_attendance = ?, is_persembahan = ? 
             WHERE id = ?`,
            [trimmedDate, generatedTitle, activeAttendance, activePersembahan, id]
        );

        // Jika tanggal berubah, update juga transaction_date pada t_cash_transactions yang terkait jika ada
        await connection.query(
            'UPDATE t_cash_transactions SET transaction_date = ? WHERE event_id = ?',
            [trimmedDate, id]
        );

        await connection.commit();

        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 't_events',
            description: `Mengubah acara Sermon: ${generatedTitle} (ID: ${id})`
        });

        const [updatedRows] = await db.query(
            "SELECT id, event_type, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, title, is_attendance, is_persembahan FROM t_events WHERE id = ?",
            [id]
        );

        return successResponse(res, updatedRows[0], 'Acara Sermon berhasil diperbarui');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updateSermon:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui acara sermon', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    getAllSermons,
    getSermonById,
    createSermon,
    updateSermon,
    deleteSermon
};
