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

// Mengambil seluruh acara bertipe MINGGU beserta jumlah kehadiran dan penugasan kategori
const getAllMinggu = async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT 
                e.id,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
                e.title,
                COALESCE(e.is_attendance, 1) AS is_attendance,
                COALESCE(e.is_persembahan, 1) AS is_persembahan,
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
            WHERE e.event_type = 'MINGGU'
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

        let assignmentMap = {};
        if (rows.length > 0) {
            const eventIds = rows.map(r => r.id);
            const [assignments] = await db.query(
                `SELECT 
                    ta.id AS assignment_id,
                    ta.event_id,
                    ta.category_id,
                    c.name AS category_name,
                    c.sequence AS category_sequence,
                    ta.user_id,
                    u.name AS user_name
                 FROM t_assignments ta
                 JOIN m_categories c ON ta.category_id = c.id
                 LEFT JOIN users u ON ta.user_id = u.id
                 WHERE ta.event_id IN (?)
                 ORDER BY c.sequence ASC, c.name ASC`,
                [eventIds]
            );

            assignments.forEach(a => {
                if (!assignmentMap[a.event_id]) {
                    assignmentMap[a.event_id] = [];
                }
                assignmentMap[a.event_id].push(a);
            });
        }

        const formatted = rows.map(item => ({
            ...item,
            is_attendance: Number(item.is_attendance) === 1,
            total_attendance: Number(item.total_attendance || 0),
            attended_count: Number(item.attended_count || 0),
            assignments: assignmentMap[item.id] || []
        }));

        return successResponse(res, formatted, 'Daftar acara Minggu berhasil diambil');
    } catch (error) {
        console.error('Error getAllMinggu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data acara minggu', 500, error.message);
    }
};

// Mengambil detail satu acara Minggu beserta daftar kehadiran GSM dan penugasan kategori
const getMingguById = async (req, res) => {
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
             WHERE id = ? AND event_type = 'MINGGU'`,
            [id]
        );

        if (events.length === 0) {
            return notFoundResponse(res, `Acara Minggu dengan ID '${id}' tidak ditemukan`);
        }

        const minggu = {
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

        // Ambil daftar penugasan pelayanan berdasarkan kategori dari t_assignments
        const [assignments] = await db.query(
            `SELECT 
                ta.id AS assignment_id,
                ta.event_id,
                ta.category_id,
                c.name AS category_name,
                c.sequence AS category_sequence,
                ta.user_id,
                u.name AS user_name,
                u.email AS user_email
             FROM t_assignments ta
             JOIN m_categories c ON ta.category_id = c.id
             LEFT JOIN users u ON ta.user_id = u.id
             WHERE ta.event_id = ?
             ORDER BY c.sequence ASC, c.name ASC`,
            [id]
        );

        // Ambil daftar seluruh user aktif dengan role GSM untuk pilihan assign
        const [gsmUsers] = await db.query(
            `SELECT DISTINCT u.id, u.name, u.email 
             FROM users u 
             JOIN user_roles ur ON u.id = ur.user_id 
             JOIN m_roles r ON ur.role_id = r.id 
             WHERE r.code = 'GSM' AND u.is_active = 1
             ORDER BY u.name ASC`
        );

        const formattedAttendances = attendances.map(item => ({
            ...item,
            is_scheduled: Boolean(item.is_scheduled),
            is_present: Boolean(item.is_present)
        }));

        return successResponse(
            res,
            {
                minggu,
                attendances: formattedAttendances,
                assignments,
                gsm_users: gsmUsers,
                total_gsm: formattedAttendances.length,
                attended_count: formattedAttendances.filter(a => a.is_present).length
            },
            'Detail acara Minggu berhasil diambil'
        );
    } catch (error) {
        console.error('Error getMingguById:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil detail acara minggu', 500, error.message);
    }
};

// Membuat acara Minggu baru
const createMinggu = async (req, res) => {
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

        // Validasi: Hari harus Minggu (Sunday = 0 pada UTC/Local)
        const dateObj = new Date(`${trimmedDate}T00:00:00`);
        if (isNaN(dateObj.getTime()) || dateObj.getDay() !== 0) {
            return badRequestResponse(
                res,
                `Tanggal ${trimmedDate} bukan hari Minggu. Pembuatan acara Ibadah Minggu hanya diperbolehkan pada hari Minggu.`
            );
        }

        // Validasi: Tidak boleh ada acara Minggu ganda pada tanggal yang sama
        const [existingDate] = await db.query(
            "SELECT id, title FROM t_events WHERE event_type = 'MINGGU' AND event_date = ?",
            [trimmedDate]
        );
        if (existingDate.length > 0) {
            return badRequestResponse(
                res,
                `Acara Ibadah Minggu untuk tanggal ${trimmedDate} sudah ada (${existingDate[0].title}). Tanggal acara ibadah minggu tidak boleh sama/duplikat.`
            );
        }

        // Title otomatis berformat MINGGU_TANGGAL
        const generatedTitle = `MINGGU_${trimmedDate}`;
        const eventId = crypto.randomUUID();
        const activeAttendance = (is_attendance === false || is_attendance === 0 || is_attendance === '0' || is_attendance === 'false') ? 0 : 1;
        const activePersembahan = (is_persembahan === false || is_persembahan === 0 || is_persembahan === '0' || is_persembahan === 'false') ? 0 : 1;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Simpan acara ke t_events dengan event_type = 'MINGGU'
        await connection.query(
            `INSERT INTO t_events (id, event_type, event_date, title, is_attendance, is_persembahan) 
             VALUES (?, 'MINGGU', ?, ?, ?, ?)`,
            [eventId, trimmedDate, generatedTitle, activeAttendance, activePersembahan]
        );

        // 2. Otomatis membuat baris baru di t_assignments berdasarkan data yang ada di m_categories (user_id = NULL)
        const [categories] = await connection.query(
            `SELECT id, name FROM m_categories WHERE is_active = 1 ORDER BY sequence ASC, name ASC`
        );

        let createdAssignmentsCount = 0;
        if (categories.length > 0) {
            for (const cat of categories) {
                const assignId = crypto.randomUUID();
                await connection.query(
                    `INSERT INTO t_assignments (id, event_id, user_id, category_id) 
                     VALUES (?, ?, NULL, ?)`,
                    [assignId, eventId, cat.id]
                );
            }
            createdAssignmentsCount = categories.length;
        }

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
            description: `Menambahkan acara Minggu baru: ${generatedTitle} (${trimmedDate}) dengan ${createdAssignmentsCount} kategori penugasan`
        });

        return createdResponse(
            res,
            {
                ...created[0],
                is_attendance: Number(created[0].is_attendance) === 1,
                total_attendance: totalGsmCount,
                attended_count: 0,
                assignments_created: createdAssignmentsCount
            },
            'Acara Minggu berhasil dibuat'
        );
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error createMinggu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat membuat acara minggu', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Memperbarui penugasan GSM untuk kategori pada acara Minggu (Assign Pelayanan)
const updateAssignments = async (req, res) => {
    let connection;
    try {
        const { id } = req.params; // event_id
        const { assignments } = req.body; // array of { assignment_id, user_id }

        if (!Array.isArray(assignments)) {
            return badRequestResponse(res, 'Data penugasan harus berupa array');
        }

        const [existingEvent] = await db.query('SELECT id, title FROM t_events WHERE id = ? AND event_type = \'MINGGU\'', [id]);
        if (existingEvent.length === 0) {
            return notFoundResponse(res, `Acara Minggu dengan ID '${id}' tidak ditemukan`);
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        for (const item of assignments) {
            const targetUserId = item.user_id && item.user_id.trim() ? item.user_id.trim() : null;
            if (item.assignment_id || item.id) {
                const aId = item.assignment_id || item.id;
                await connection.query(
                    'UPDATE t_assignments SET user_id = ? WHERE id = ? AND event_id = ?',
                    [targetUserId, aId, id]
                );
            } else if (item.category_id) {
                await connection.query(
                    'UPDATE t_assignments SET user_id = ? WHERE category_id = ? AND event_id = ?',
                    [targetUserId, item.category_id, id]
                );
            }
        }

        await connection.commit();

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'UPDATE',
            tableName: 't_assignments',
            description: `Memperbarui penugasan pelayanan GSM pada acara: ${existingEvent[0].title}`
        });

        return successResponse(res, null, 'Penugasan pelayanan berhasil diperbarui');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updateAssignments:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui penugasan pelayanan', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Menghapus acara Minggu
const deleteMinggu = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;

        const [existing] = await db.query('SELECT * FROM t_events WHERE id = ? AND event_type = \'MINGGU\'', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Acara Minggu dengan ID '${id}' tidak ditemukan`);
        }

        const target = existing[0];

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Hapus data penugasan terkait di t_assignments
        await connection.query('DELETE FROM t_assignments WHERE event_id = ?', [id]);
        // 2. Hapus data absensi terkait di t_attendances
        await connection.query('DELETE FROM t_attendances WHERE event_id = ?', [id]);
        // 3. Hapus acara
        await connection.query('DELETE FROM t_events WHERE id = ?', [id]);

        await connection.commit();

        // Audit log
        await logAudit({
            userId: req.user?.id || null,
            action: 'DELETE',
            tableName: 't_events',
            description: `Menghapus acara Minggu: ${target.title} (ID: ${id})`
        });

        return successResponse(res, null, 'Acara Minggu berhasil dihapus');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleteMinggu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat menghapus acara minggu', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

// Update Acara Minggu
const updateMinggu = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const { event_date, is_attendance, is_persembahan } = req.body;

        const [existing] = await db.query('SELECT * FROM t_events WHERE id = ? AND event_type = \'MINGGU\'', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, `Acara Minggu dengan ID '${id}' tidak ditemukan`);
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

            const dateObj = new Date(`${trimmedDate}T00:00:00`);
            if (isNaN(dateObj.getTime()) || dateObj.getDay() !== 0) {
                return badRequestResponse(
                    res,
                    `Tanggal ${trimmedDate} bukan hari Minggu. Acara Ibadah Minggu harus jatuh pada hari Minggu.`
                );
            }

            // Cek duplikasi jika tanggal berubah
            const [existingDate] = await db.query(
                "SELECT id, title FROM t_events WHERE event_type = 'MINGGU' AND event_date = ? AND id != ?",
                [trimmedDate, id]
            );
            if (existingDate.length > 0) {
                return badRequestResponse(
                    res,
                    `Acara Ibadah Minggu untuk tanggal ${trimmedDate} sudah ada (${existingDate[0].title}).`
                );
            }

            generatedTitle = `MINGGU_${trimmedDate}`;
        }

        const activeAttendance = is_attendance !== undefined
            ? ((is_attendance === false || is_attendance === 0 || is_attendance === '0' || is_attendance === 'false') ? 0 : 1)
            : currentEvent.is_attendance;

        const activePersembahan = is_persembahan !== undefined
            ? ((is_persembahan === false || is_persembahan === 0 || is_persembahan === '0' || is_persembahan === 'false') ? 0 : 1)
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
            description: `Mengubah acara Minggu: ${generatedTitle} (ID: ${id})`
        });

        const [updatedRows] = await db.query(
            "SELECT id, event_type, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, title, is_attendance, is_persembahan FROM t_events WHERE id = ?",
            [id]
        );

        return successResponse(res, updatedRows[0], 'Acara Minggu berhasil diperbarui');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updateMinggu:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat memperbarui acara minggu', 500, error.message);
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    getAllMinggu,
    getMingguById,
    createMinggu,
    updateAssignments,
    updateMinggu,
    deleteMinggu
};
