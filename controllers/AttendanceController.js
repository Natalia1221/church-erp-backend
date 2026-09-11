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

// 1. Mengambil acara aktif beserta status kehadiran & penugasan user saat ini
const getTodayEvents = async (req, res) => {
    try {
        const userId = req.user.id;

        // Ambil acara terdekat / aktif (is_attendance = 1)
        const [events] = await db.query(`
            SELECT 
                e.id,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
                e.title,
                COALESCE(e.is_attendance, 1) AS is_attendance,
                e.created_at,
                (SELECT COUNT(*) FROM t_attendances WHERE event_id = e.id) AS total_attendees
            FROM t_events e
            WHERE COALESCE(e.is_attendance, 1) = 1
            ORDER BY e.event_date DESC, e.created_at DESC
            LIMIT 15
        `);

        if (events.length === 0) {
            return successResponse(res, [], 'Belum ada acara ibadah aktif');
        }

        const eventIds = events.map(e => e.id);

        // Ambil penugasan user pada acara-acara tersebut
        const [assignments] = await db.query(`
            SELECT 
                ta.event_id,
                ta.category_id,
                c.name AS category_name,
                c.sequence AS category_sequence
            FROM t_assignments ta
            JOIN m_categories c ON ta.category_id = c.id
            WHERE ta.user_id = ? AND ta.event_id IN (?)
        `, [userId, eventIds]);

        const assignmentMap = {};
        for (const a of assignments) {
            assignmentMap[a.event_id] = a;
        }

        // Ambil record absensi user pada acara-acara tersebut
        const [myAttendances] = await db.query(`
            SELECT 
                id,
                event_id,
                check_in_time,
                is_scheduled,
                latitude,
                longitude,
                photo_proof
            FROM t_attendances
            WHERE user_id = ? AND event_id IN (?)
        `, [userId, eventIds]);

        const attendanceMap = {};
        for (const att of myAttendances) {
            attendanceMap[att.event_id] = att;
        }

        const enrichedEvents = events.map(e => {
            const assignment = assignmentMap[e.id] || null;
            const attendance = attendanceMap[e.id] || null;

            return {
                ...e,
                is_assigned: Boolean(assignment),
                assigned_category: assignment ? assignment.category_name : null,
                is_checked_in: Boolean(attendance),
                attendance_details: attendance
            };
        });

        return successResponse(res, enrichedEvents, 'Daftar acara aktif untuk absensi berhasil diambil');
    } catch (error) {
        console.error('Error getTodayEvents:', error);
        return errorResponse(res, 'Gagal mengambil data acara untuk absensi', 500, error.message);
    }
};

// 2. Melakukan Check-In Mandiri
const checkIn = async (req, res) => {
    try {
        const userId = req.user.id;
        const { event_id, latitude, longitude, photo_proof } = req.body;

        if (!event_id) {
            return badRequestResponse(res, 'Field event_id wajib diisi');
        }

        // Cek validitas acara
        const [events] = await db.query(
            'SELECT id, title, is_attendance FROM t_events WHERE id = ?',
            [event_id]
        );

        if (events.length === 0) {
            return notFoundResponse(res, 'Acara ibadah tidak ditemukan');
        }

        const event = events[0];
        if (event.is_attendance === 0) {
            return badRequestResponse(res, 'Absensi untuk acara ini tidak diaktifkan oleh admin');
        }

        // Cek apakah user sudah pernah check-in
        const [existing] = await db.query(
            'SELECT id, check_in_time FROM t_attendances WHERE event_id = ? AND user_id = ?',
            [event_id, userId]
        );

        if (existing.length > 0) {
            return badRequestResponse(res, 'Anda sudah melakukan check-in untuk acara ini sebelumnya');
        }

        // Cek apakah user terdaftar dalam t_assignments acara ini
        const [scheduled] = await db.query(
            'SELECT id FROM t_assignments WHERE event_id = ? AND user_id = ?',
            [event_id, userId]
        );
        const isScheduled = scheduled.length > 0 ? 1 : 0;

        const attendanceId = crypto.randomUUID();
        await db.query(
            `INSERT INTO t_attendances 
                (id, event_id, user_id, check_in_time, is_scheduled, latitude, longitude, photo_proof) 
             VALUES (?, ?, ?, NOW(), ?, ?, ?, ?)`,
            [
                attendanceId,
                event_id,
                userId,
                isScheduled,
                latitude || null,
                longitude || null,
                photo_proof || null
            ]
        );

        // Ambil data hasil insert
        const [newRecord] = await db.query(`
            SELECT 
                ta.*,
                e.title AS event_title,
                e.event_type
            FROM t_attendances ta
            JOIN t_events e ON ta.event_id = e.id
            WHERE ta.id = ?
        `, [attendanceId]);

        await logAudit({
            userId,
            action: 'CHECK_IN',
            tableName: 't_attendances',
            description: `Check-in mandiri oleh user ID ${userId} pada acara ${event.title} (Terjadwal: ${isScheduled ? 'Ya' : 'Tidak'})`
        });

        return createdResponse(res, newRecord[0], 'Check-in kehadiran berhasil disimpan!');
    } catch (error) {
        console.error('Error checkIn:', error);
        return errorResponse(res, 'Terjadi kesalahan saat memproses check-in', 500, error.message);
    }
};

// 3. Mengambil Riwayat Absensi Pribadi (My History)
const getMyHistory = async (req, res) => {
    try {
        const userId = req.user.id;

        const [history] = await db.query(`
            SELECT 
                ta.id,
                ta.event_id,
                ta.check_in_time,
                ta.is_scheduled,
                ta.latitude,
                ta.longitude,
                ta.photo_proof,
                e.title AS event_title,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
                c.name AS assigned_category_name
            FROM t_attendances ta
            JOIN t_events e ON ta.event_id = e.id
            LEFT JOIN t_assignments tass ON tass.event_id = e.id AND tass.user_id = ta.user_id
            LEFT JOIN m_categories c ON tass.category_id = c.id
            WHERE ta.user_id = ?
            ORDER BY ta.check_in_time DESC
            LIMIT 50
        `, [userId]);

        return successResponse(res, history, 'Riwayat absensi pribadi berhasil dimuat');
    } catch (error) {
        console.error('Error getMyHistory:', error);
        return errorResponse(res, 'Gagal memuat riwayat absensi', 500, error.message);
    }
};

// 4. Monitoring Absensi Acara Real-Time (Khusus Admin & Pendeta)
const getEventMonitoring = async (req, res) => {
    try {
        const { eventId } = req.params;

        // Ambil info acara
        const [events] = await db.query(`
            SELECT 
                id, 
                event_type, 
                DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, 
                title, 
                is_attendance,
                created_at
            FROM t_events
            WHERE id = ?
        `, [eventId]);

        if (events.length === 0) {
            return notFoundResponse(res, 'Acara ibadah tidak ditemukan');
        }

        const event = events[0];

        // Ambil seluruh penugasan kategori pada acara ini beserta status absensinya
        const [scheduledAssignments] = await db.query(`
            SELECT 
                ta.id AS assignment_id,
                ta.category_id,
                c.name AS category_name,
                c.sequence AS category_sequence,
                ta.user_id,
                u.name AS user_name,
                u.email AS user_email,
                att.id AS attendance_id,
                att.check_in_time,
                att.latitude,
                att.longitude,
                att.photo_proof,
                CASE WHEN att.id IS NOT NULL THEN 1 ELSE 0 END AS is_attended
            FROM t_assignments ta
            JOIN m_categories c ON ta.category_id = c.id
            LEFT JOIN users u ON ta.user_id = u.id
            LEFT JOIN t_attendances att ON att.event_id = ta.event_id AND att.user_id = ta.user_id
            WHERE ta.event_id = ?
            ORDER BY CAST(c.sequence AS DECIMAL(10,2)) ASC, c.name ASC
        `, [eventId]);

        // Ambil pelayan tambahan / non-terjadwal yang hadir pada acara ini
        const [additionalAttendees] = await db.query(`
            SELECT 
                att.id AS attendance_id,
                att.user_id,
                u.name AS user_name,
                u.email AS user_email,
                att.check_in_time,
                att.latitude,
                att.longitude,
                att.photo_proof,
                0 AS is_scheduled
            FROM t_attendances att
            JOIN users u ON att.user_id = u.id
            WHERE att.event_id = ? 
              AND att.user_id NOT IN (
                SELECT user_id FROM t_assignments WHERE event_id = ? AND user_id IS NOT NULL
              )
            ORDER BY att.check_in_time ASC
        `, [eventId, eventId]);

        // Hitung statistik
        const assignedWithUser = scheduledAssignments.filter(a => Boolean(a.user_id));
        const totalScheduled = assignedWithUser.length;
        const attendedScheduled = assignedWithUser.filter(a => a.is_attended === 1).length;
        const unattendedScheduled = totalScheduled - attendedScheduled;
        const totalAdditional = additionalAttendees.length;
        const totalPresent = attendedScheduled + totalAdditional;
        const attendancePercentage = totalScheduled > 0 
            ? Math.round((attendedScheduled / totalScheduled) * 100) 
            : 0;

        const stats = {
            total_scheduled: totalScheduled,
            attended_scheduled: attendedScheduled,
            unattended_scheduled: unattendedScheduled,
            additional_attendees: totalAdditional,
            total_present: totalPresent,
            attendance_percentage: attendancePercentage
        };

        // Ambil juga list user GSM aktif untuk opsi "Tandai Hadir Manual"
        const [allGsmUsers] = await db.query(`
            SELECT u.id, u.name, u.email
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN m_roles r ON ur.role_id = r.id AND r.code = 'GSM'
            WHERE u.is_active = 1 AND u.deleted_at IS NULL
            ORDER BY u.name ASC
        `);

        return successResponse(res, {
            event,
            stats,
            scheduled_assignments: scheduledAssignments,
            additional_attendees: additionalAttendees,
            available_gsm_users: allGsmUsers
        }, 'Data monitoring absensi berhasil diambil');
    } catch (error) {
        console.error('Error getEventMonitoring:', error);
        return errorResponse(res, 'Gagal mengambil data monitoring absensi', 500, error.message);
    }
};

// 5. Tandai Hadir Manual oleh Admin / Pendeta
const manualCheckIn = async (req, res) => {
    try {
        const adminId = req.user.id;
        const { event_id, user_id, notes } = req.body;

        if (!event_id || !user_id) {
            return badRequestResponse(res, 'Field event_id dan user_id wajib diisi');
        }

        // Cek apakah sudah pernah check-in
        const [existing] = await db.query(
            'SELECT id FROM t_attendances WHERE event_id = ? AND user_id = ?',
            [event_id, user_id]
        );

        if (existing.length > 0) {
            return badRequestResponse(res, 'Pengguna sudah tercatat hadir pada acara ini');
        }

        // Cek apakah terjadwal
        const [scheduled] = await db.query(
            'SELECT id FROM t_assignments WHERE event_id = ? AND user_id = ?',
            [event_id, user_id]
        );
        const isScheduled = scheduled.length > 0 ? 1 : 0;

        const attendanceId = crypto.randomUUID();
        const proofLabel = notes ? `MANUAL: ${notes}` : 'MANUAL_BY_ADMIN';

        await db.query(
            `INSERT INTO t_attendances 
                (id, event_id, user_id, check_in_time, is_scheduled, photo_proof) 
             VALUES (?, ?, ?, NOW(), ?, ?)`,
            [attendanceId, event_id, user_id, isScheduled, proofLabel]
        );

        // Ambil nama user untuk audit log
        const [targetUser] = await db.query('SELECT name FROM users WHERE id = ?', [user_id]);
        const userName = targetUser[0]?.name || user_id;

        await logAudit({
            userId: adminId,
            action: 'MANUAL_CHECK_IN',
            tableName: 't_attendances',
            description: `Tandai hadir manual oleh admin untuk user ${userName} pada acara ${event_id}`
        });

        return createdResponse(res, {
            id: attendanceId,
            event_id,
            user_id,
            is_scheduled: isScheduled,
            check_in_time: new Date()
        }, 'Kehadiran berhasil dicatat secara manual!');
    } catch (error) {
        console.error('Error manualCheckIn:', error);
        return errorResponse(res, 'Gagal mencatat kehadiran manual', 500, error.message);
    }
};

// 6. Batalkan / Hapus Catatan Kehadiran
const deleteAttendance = async (req, res) => {
    try {
        const adminId = req.user.id;
        const { id } = req.params;

        const [existing] = await db.query('SELECT id, event_id, user_id FROM t_attendances WHERE id = ?', [id]);
        if (existing.length === 0) {
            return notFoundResponse(res, 'Catatan kehadiran tidak ditemukan');
        }

        await db.query('DELETE FROM t_attendances WHERE id = ?', [id]);

        await logAudit({
            userId: adminId,
            action: 'DELETE_ATTENDANCE',
            tableName: 't_attendances',
            description: `Membatalkan/menghapus catatan absensi ID ${id}`
        });

        return successResponse(res, null, 'Catatan kehadiran berhasil dibatalkan / dihapus');
    } catch (error) {
        console.error('Error deleteAttendance:', error);
        return errorResponse(res, 'Gagal membatalkan catatan kehadiran', 500, error.message);
    }
};

// 7. Rekapitulasi Kehadiran GSM (Laporan Evaluasi)
const getRecapReport = async (req, res) => {
    try {
        const { startDate, endDate, event_type } = req.query;

        let eventFilter = '';
        const params = [];

        if (event_type && event_type !== 'ALL') {
            eventFilter += ' AND e.event_type = ?';
            params.push(event_type);
        }

        if (startDate) {
            eventFilter += ' AND e.event_date >= ?';
            params.push(startDate);
        }

        if (endDate) {
            eventFilter += ' AND e.event_date <= ?';
            params.push(endDate);
        }

        // Ambil data seluruh GSM dan rekap kehadirannya
        const [recap] = await db.query(`
            SELECT 
                u.id AS user_id,
                u.name AS user_name,
                u.email AS user_email,
                COUNT(DISTINCT ta.id) AS total_assignments,
                COUNT(DISTINCT att.id) AS total_attendances,
                COUNT(DISTINCT CASE WHEN att.is_scheduled = 1 THEN att.id END) AS attended_scheduled,
                COUNT(DISTINCT CASE WHEN att.is_scheduled = 0 THEN att.id END) AS attended_additional
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN m_roles r ON ur.role_id = r.id AND r.code = 'GSM'
            LEFT JOIN t_assignments ta ON ta.user_id = u.id
            LEFT JOIN t_events e ON ta.event_id = e.id ${eventFilter}
            LEFT JOIN t_attendances att ON att.user_id = u.id AND att.event_id = e.id
            WHERE u.is_active = 1 AND u.deleted_at IS NULL
            GROUP BY u.id, u.name, u.email
            ORDER BY total_attendances DESC, u.name ASC
        `, params);

        // Ambil total acara yang terlaksana dalam periode tersebut
        const [totalEvents] = await db.query(`
            SELECT COUNT(*) as count FROM t_events e WHERE COALESCE(e.is_attendance, 1) = 1 ${eventFilter}
        `, params);

        return successResponse(res, {
            total_events: totalEvents[0]?.count || 0,
            recap
        }, 'Data rekapitulasi absensi berhasil dimuat');
    } catch (error) {
        console.error('Error getRecapReport:', error);
        return errorResponse(res, 'Gagal memuat data rekapitulasi absensi', 500, error.message);
    }
};

module.exports = {
    getTodayEvents,
    checkIn,
    getMyHistory,
    getEventMonitoring,
    manualCheckIn,
    deleteAttendance,
    getRecapReport
};

