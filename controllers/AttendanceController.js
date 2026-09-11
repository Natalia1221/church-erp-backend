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

module.exports = {
    getTodayEvents,
    checkIn,
    getMyHistory
};
