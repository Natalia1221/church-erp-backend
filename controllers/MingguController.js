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
                e.created_at,
                COUNT(ta.id) AS total_attendance,
                COUNT(CASE WHEN ta.check_in_time IS NOT NULL THEN 1 END) AS attended_count
            FROM t_events e
            LEFT JOIN t_attendances ta ON e.id = ta.event_id
            WHERE e.event_type = 'MINGGU'
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
            is_attendance: Boolean(item.is_attendance),
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
        const { event_date, is_attendance = true } = req.body;

        if (!event_date || !event_date.trim()) {
            return badRequestResponse(res, 'Tanggal acara Minggu wajib diisi');
        }

        const trimmedDate = event_date.trim();

        // Validasi format tanggal YYYY-MM-DD
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(trimmedDate)) {
            return badRequestResponse(res, 'Format tanggal tidak valid (harus YYYY-MM-DD)');
        }

        // Pengecekan apakah tanggal yang dipilih benar-benar hari Minggu
        const dateObj = new Date(`${trimmedDate}T00:00:00`);
        if (isNaN(dateObj.getTime())) {
            return badRequestResponse(res, 'Nilai tanggal tidak valid');
        }

        // Di JavaScript: 0 = Sunday (Minggu)
        if (dateObj.getDay() !== 0) {
            return badRequestResponse(res, 'Tanggal yang dipilih haruslah hari Minggu!');
        }

        // Title otomatis berformat MINGGU_TANGGAL
        const generatedTitle = `MINGGU_${trimmedDate}`;
        const eventId = crypto.randomUUID();
        const activeAttendance = is_attendance ? 1 : 0;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Simpan acara ke t_events dengan event_type = 'MINGGU'
        await connection.query(
            `INSERT INTO t_events (id, event_type, event_date, title, is_attendance) 
             VALUES (?, 'MINGGU', ?, ?, ?)`,
            [eventId, trimmedDate, generatedTitle, activeAttendance]
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

        let gsmAssignedCount = 0;

        // 3. Apabila melakukan absensi dicentang, buat baris data di t_attendances untuk seluruh role GSM
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
            description: `Menambahkan acara Minggu baru: ${generatedTitle} (${trimmedDate}) dengan ${createdAssignmentsCount} kategori penugasan dan ${gsmAssignedCount} GSM terdaftar di absensi`
        });

        return createdResponse(
            res,
            {
                ...created[0],
                is_attendance: Boolean(created[0].is_attendance),
                total_attendance: gsmAssignedCount,
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

module.exports = {
    getAllMinggu,
    getMingguById,
    createMinggu,
    updateAssignments,
    deleteMinggu
};
