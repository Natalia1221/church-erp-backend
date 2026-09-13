const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const {
    successResponse,
    createdResponse,
    badRequestResponse,
    notFoundResponse,
    errorResponse
} = require('../helpers/responseHelper');
const { logAudit } = require('../helpers/auditHelper');

/**
 * Menghitung jarak antara dua titik koordinat geolokasi menggunakan Haversine Formula (dalam meter)
 */
const calculateDistanceInMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Radius bumi dalam meter
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
};

/**
 * Mengambil konfigurasi absensi (titik koordinat gereja, batas radius, aturan GPS & foto) dari m_settings
 */
const getAttendanceConfig = async () => {
    const [rows] = await db.query(
        "SELECT `group`, `key`, value1, value2, value3, value4, status FROM m_settings WHERE `group` IN ('attendance_config', 'church_location') AND COALESCE(status, 1) = 1"
    );

    let config = {
        church_latitude: null,
        church_longitude: null,
        max_radius_meters: 150,
        require_gps: true,
        require_photo: true,
        church_name: 'Gereja HKBP'
    };

    // Prioritas 1: group church_location (format terpadu)
    const churchLoc = rows.find(r => r.group === 'church_location');
    if (churchLoc) {
        if (churchLoc.value1) config.church_latitude = parseFloat(churchLoc.value1);
        if (churchLoc.value2) config.church_longitude = parseFloat(churchLoc.value2);
        if (churchLoc.value3) config.max_radius_meters = parseInt(churchLoc.value3, 10) || 150;
        if (churchLoc.value4) config.church_name = churchLoc.value4;
    }

    // Prioritas 2: group attendance_config (format spesifik)
    for (const r of rows) {
        if (r.group === 'attendance_config') {
            const k = (r.key || '').toUpperCase();
            if (k === 'CHURCH_LATITUDE' && r.value1) {
                config.church_latitude = parseFloat(r.value1);
            } else if (k === 'CHURCH_LONGITUDE' && r.value1) {
                config.church_longitude = parseFloat(r.value1);
            } else if (k === 'MAX_RADIUS_METERS' && r.value1) {
                config.max_radius_meters = parseInt(r.value1, 10) || config.max_radius_meters;
            } else if (k === 'REQUIRE_GPS') {
                config.require_gps = r.value1 === '1' || r.value1 === 'true';
            } else if (k === 'REQUIRE_PHOTO') {
                config.require_photo = r.value1 === '1' || r.value1 === 'true';
            }
        }
    }

    return config;
};

// 1. Mengambil acara aktif beserta status kehadiran & penugasan user saat ini
const getTodayEvents = async (req, res) => {
    try {
        const userId = req.user.id;

        // Ambil konfigurasi lokasi gereja & absensi dari m_settings
        const attendanceConfig = await getAttendanceConfig();

        // Ambil role pengguna saat ini untuk verifikasi hak akses
        const [userRoles] = await db.query(
            `SELECT r.code FROM user_roles ur JOIN m_roles r ON ur.role_id = r.id WHERE ur.user_id = ?`,
            [userId]
        );
        const isAdminOrPendeta = userRoles.some(r => r.code === 'ADMIN' || r.code === 'PENDETA');

        // Tanggal hari ini (WIB / Asia/Jakarta)
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

        // Ambil acara terdekat / aktif (is_attendance = 1)
        const [events] = await db.query(`
            SELECT 
                e.id,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
                e.title,
                e.is_attendance,
                e.created_at,
                (SELECT COUNT(DISTINCT ta.user_id) FROM t_attendances ta WHERE ta.event_id = e.id AND ta.check_in_time IS NOT NULL) AS total_attendees
            FROM t_events e
            WHERE e.is_attendance = 1
            ORDER BY e.event_date DESC, e.created_at DESC
            LIMIT 50
        `);

        if (events.length === 0) {
            return successResponse(res, {
                events: [],
                config: attendanceConfig,
                today_date: todayStr,
                is_admin: isAdminOrPendeta
            }, 'Belum ada acara ibadah aktif');
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
            if (!assignmentMap[a.event_id]) {
                assignmentMap[a.event_id] = [];
            }
            if (a.category_name && !assignmentMap[a.event_id].includes(a.category_name)) {
                assignmentMap[a.event_id].push(a.category_name);
            }
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
            WHERE user_id = ? AND event_id IN (?) AND check_in_time IS NOT NULL
        `, [userId, eventIds]);

        const attendanceMap = {};
        for (const att of myAttendances) {
            attendanceMap[att.event_id] = att;
        }

        const enrichedEvents = events.map(e => {
            const userTasks = assignmentMap[e.id] || [];
            const isAssigned = userTasks.length > 0;
            const assignedCategory = isAssigned ? userTasks.join(', ') : null;
            const attendance = attendanceMap[e.id] || null;
            const isCheckedIn = Boolean(attendance && attendance.check_in_time);
            const eventDateStr = String(e.event_date);
            const isToday = eventDateStr === todayStr;
            const isPast = eventDateStr < todayStr;
            const isFuture = eventDateStr > todayStr;

            return {
                ...e,
                is_attendance: true,
                is_assigned: isAssigned,
                assigned_category: assignedCategory,
                is_checked_in: isCheckedIn,
                attendance_details: attendance,
                today_date: todayStr,
                is_today: isToday,
                is_past: isPast,
                is_future: isFuture,
                can_check_in: isAdminOrPendeta || (isToday && !isCheckedIn)
            };
        });

        return successResponse(res, {
            events: enrichedEvents,
            config: attendanceConfig,
            today_date: todayStr,
            is_admin: isAdminOrPendeta
        }, 'Daftar acara aktif untuk absensi berhasil diambil');
    } catch (error) {
        console.error('Error getTodayEvents:', error);
        return errorResponse(res, 'Gagal mengambil data acara untuk absensi', 500, error.message);
    }
};

// 2. Melakukan Check-In Mandiri (Petugas / GSM) dengan Verifikasi Waktu Hari H, GPS Geofencing, & Live Foto Selfie
const checkIn = async (req, res) => {
    try {
        const userId = req.user.id;
        const { event_id, latitude, longitude, photo_proof } = req.body;

        if (!event_id) {
            return badRequestResponse(res, 'Field event_id wajib diisi');
        }

        // Cek validitas acara & tanggal pelaksanaan
        const [events] = await db.query(
            `SELECT id, title, is_attendance, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date 
             FROM t_events WHERE id = ?`,
            [event_id]
        );

        if (events.length === 0) {
            return notFoundResponse(res, 'Acara ibadah tidak ditemukan');
        }

        const event = events[0];
        if (event.is_attendance === 0) {
            return badRequestResponse(res, 'Absensi untuk acara ini tidak diaktifkan');
        }

        // Cek peran user
        const [userRoles] = await db.query(
            `SELECT r.code FROM user_roles ur JOIN m_roles r ON ur.role_id = r.id WHERE ur.user_id = ?`,
            [userId]
        );
        const isAdminOrPendeta = userRoles.some(r => r.code === 'ADMIN' || r.code === 'PENDETA');

        // Validasi Waktu: Absensi mandiri hanya bisa dilakukan di hari H acara
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
        const eventDateStr = String(event.event_date);

        if (!isAdminOrPendeta) {
            if (eventDateStr < todayStr) {
                return badRequestResponse(
                    res,
                    'Sesi absensi untuk acara ini telah berakhir karena tanggal pelaksanaan telah lewat. Absensi hanya dapat dilakukan pada hari H. Silakan hubungi Admin untuk revisi absensi.'
                );
            }
            if (eventDateStr > todayStr) {
                return badRequestResponse(
                    res,
                    `Sesi absensi belum dibuka. Absensi mandiri hanya dapat dilakukan pada hari H (${eventDateStr}).`
                );
            }
        }

        // Cek apakah user sudah pernah check-in
        const [existing] = await db.query(
            'SELECT id, check_in_time FROM t_attendances WHERE event_id = ? AND user_id = ? AND check_in_time IS NOT NULL',
            [event_id, userId]
        );

        if (existing.length > 0) {
            return badRequestResponse(res, 'Anda sudah melakukan check-in untuk acara ini sebelumnya');
        }

        // Ambil konfigurasi absensi (titik koordinat gereja & radius) dari m_settings
        const attendanceConfig = await getAttendanceConfig();

        // 1. Validasi GPS Geofencing jika diaktifkan (require_gps)
        let distanceMeters = null;
        if (attendanceConfig.require_gps && attendanceConfig.church_latitude && attendanceConfig.church_longitude) {
            if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
                return badRequestResponse(res, 'Izin lokasi GPS wajib diaktifkan pada browser/perangkat Anda untuk melakukan absensi.');
            }

            distanceMeters = calculateDistanceInMeters(
                parseFloat(latitude),
                parseFloat(longitude),
                attendanceConfig.church_latitude,
                attendanceConfig.church_longitude
            );

            if (distanceMeters > attendanceConfig.max_radius_meters) {
                return badRequestResponse(
                    res,
                    `Lokasi Anda berada di luar radius gereja (${distanceMeters} meter). Batas jarak maksimal adalah ${attendanceConfig.max_radius_meters} meter dari ${attendanceConfig.church_name}. Absensi hanya dapat dilakukan di lingkungan gereja.`
                );
            }
        }

        // 2. Validasi Foto Selfie jika diaktifkan (require_photo)
        let savedPhotoUrl = null;
        if (attendanceConfig.require_photo && !photo_proof) {
            return badRequestResponse(res, 'Foto bukti kehadiran (selfie) wajib disertakan untuk melakukan check-in.');
        }

        // Proses penyimpanan file foto jika berupa base64 image
        if (photo_proof && typeof photo_proof === 'string') {
            if (photo_proof.startsWith('data:image')) {
                const matches = photo_proof.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const ext = matches[1].includes('png') ? 'png' : 'jpg';
                    const base64Data = matches[2];
                    const buffer = Buffer.from(base64Data, 'base64');
                    const fileName = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
                    const uploadsDir = path.join(__dirname, '..', 'uploads', 'attendances');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }
                    fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
                    savedPhotoUrl = `/uploads/attendances/${fileName}`;
                }
            } else if (photo_proof.startsWith('/uploads') || photo_proof.startsWith('http')) {
                savedPhotoUrl = photo_proof;
            }
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
                savedPhotoUrl
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
            description: `Check-in mandiri oleh user ID ${userId} pada acara ${event.title} (Jarak: ${distanceMeters !== null ? distanceMeters + 'm' : 'N/A'}, Terjadwal: ${isScheduled ? 'Ya' : 'Tidak'})`
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
                GROUP_CONCAT(DISTINCT c.name ORDER BY CAST(c.sequence AS DECIMAL(10,2)) ASC, c.name ASC SEPARATOR ', ') AS assigned_category_name
            FROM t_attendances ta
            JOIN t_events e ON ta.event_id = e.id
            LEFT JOIN t_assignments tass ON tass.event_id = e.id AND tass.user_id = ta.user_id
            LEFT JOIN m_categories c ON tass.category_id = c.id
            WHERE ta.user_id = ?
            GROUP BY 
                ta.id,
                ta.event_id,
                ta.check_in_time,
                ta.is_scheduled,
                ta.latitude,
                ta.longitude,
                ta.photo_proof,
                e.title,
                e.event_type,
                e.event_date
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

        // Ambil daftar lengkap seluruh GSM aktif gereja beserta status kehadirannya pada acara ini
        const [gsmAttendanceList] = await db.query(`
            SELECT 
                u.id AS user_id,
                u.name AS user_name,
                u.email AS user_email,
                att.id AS attendance_id,
                att.check_in_time,
                att.latitude,
                att.longitude,
                att.photo_proof,
                CASE WHEN att.id IS NOT NULL AND att.check_in_time IS NOT NULL THEN 1 ELSE 0 END AS is_attended,
                assign.category_name
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN m_roles r ON ur.role_id = r.id AND r.code = 'GSM'
            LEFT JOIN t_attendances att ON att.user_id = u.id AND att.event_id = ? AND att.check_in_time IS NOT NULL
            LEFT JOIN (
                SELECT ta.user_id, GROUP_CONCAT(DISTINCT c.name ORDER BY CAST(c.sequence AS DECIMAL(10,2)) ASC, c.name ASC SEPARATOR ', ') AS category_name
                FROM t_assignments ta
                JOIN m_categories c ON ta.category_id = c.id
                WHERE ta.event_id = ?
                GROUP BY ta.user_id
            ) assign ON assign.user_id = u.id
            WHERE u.is_active = 1 AND u.deleted_at IS NULL
            ORDER BY is_attended DESC, u.name ASC
        `, [eventId, eventId]);

        // Ambil juga list user GSM aktif
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
            available_gsm_users: allGsmUsers,
            gsm_attendance_list: gsmAttendanceList
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

// 7. Rekapitulasi Kehadiran GSM (Laporan Evaluasi & Rekap)
const getRecapReport = async (req, res) => {
    try {
        const { startDate, endDate, event_type } = req.query;

        let eventFilter = 'WHERE COALESCE(e.is_attendance, 1) = 1';
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

        // 1. Ambil seluruh event dalam periode filter
        const [events] = await db.query(`
            SELECT id, event_type, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date, title 
            FROM t_events e 
            ${eventFilter}
            ORDER BY e.event_date ASC
        `, params);

        const totalEventsCount = events.length;
        const eventIds = events.map(e => e.id);

        // 2. Ambil seluruh GSM aktif
        const [gsmUsers] = await db.query(`
            SELECT DISTINCT u.id, u.name, u.email
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN m_roles r ON ur.role_id = r.id AND r.code = 'GSM'
            WHERE u.is_active = 1 AND u.deleted_at IS NULL
            ORDER BY u.name ASC
        `);

        if (eventIds.length === 0 || gsmUsers.length === 0) {
            return successResponse(res, {
                total_events: totalEventsCount,
                total_gsm: gsmUsers.length,
                active_gsm_count: 0,
                overall_attendance_rate: 0,
                total_attendances_all: 0,
                self_check_in_count: 0,
                manual_admin_count: 0,
                recap: gsmUsers.map(u => ({
                    user_id: u.id,
                    user_name: u.name,
                    user_email: u.email,
                    total_assignments: 0,
                    attended_scheduled: 0,
                    attended_additional: 0,
                    total_attendances: 0,
                    unattended_scheduled: 0,
                    attendance_rate: 0,
                    status_badge: 'perlu_perhatian',
                    attended_manual: 0,
                    attended_self: 0
                }))
            }, 'Data rekapitulasi absensi berhasil dimuat');
        }

        // 3. Ambil penugasan (assignments) untuk event-event tersebut
        const [assignments] = await db.query(`
            SELECT event_id, user_id
            FROM t_assignments
            WHERE event_id IN (?)
        `, [eventIds]);

        // 4. Ambil absensi (attendances) untuk event-event tersebut
        const [attendances] = await db.query(`
            SELECT id, event_id, user_id, is_scheduled, photo_proof, check_in_time
            FROM t_attendances
            WHERE event_id IN (?) AND check_in_time IS NOT NULL
        `, [eventIds]);

        // Buat lookup map
        const assignmentSet = new Set(assignments.map(a => `${a.event_id}_${a.user_id}`));
        const userAssignmentsCount = {};
        for (const a of assignments) {
            userAssignmentsCount[a.user_id] = (userAssignmentsCount[a.user_id] || 0) + 1;
        }

        const userAttendanceList = {};
        for (const att of attendances) {
            if (!userAttendanceList[att.user_id]) {
                userAttendanceList[att.user_id] = [];
            }
            userAttendanceList[att.user_id].push(att);
        }

        let totalSelfCheckIn = 0;
        let totalManualAdmin = 0;
        const totalAttendancesAll = attendances.length;

        for (const att of attendances) {
            const isManual = att.photo_proof?.startsWith('MANUAL') || att.photo_proof === 'MANUAL_BY_ADMIN';
            if (isManual) {
                totalManualAdmin++;
            } else {
                totalSelfCheckIn++;
            }
        }

        const totalScheduledAll = assignments.length;
        let attendedScheduledAll = 0;

        const recap = gsmUsers.map(u => {
            const myAtts = userAttendanceList[u.id] || [];
            const totalAssigned = userAssignmentsCount[u.id] || 0;
            
            let attendedScheduled = 0;
            let attendedAdditional = 0;
            let attendedManual = 0;
            let attendedSelf = 0;

            for (const att of myAtts) {
                const wasAssigned = assignmentSet.has(`${att.event_id}_${u.id}`);
                if (wasAssigned || att.is_scheduled === 1) {
                    attendedScheduled++;
                } else {
                    attendedAdditional++;
                }

                const isManual = att.photo_proof?.startsWith('MANUAL') || att.photo_proof === 'MANUAL_BY_ADMIN';
                if (isManual) {
                    attendedManual++;
                } else {
                    attendedSelf++;
                }
            }

            attendedScheduledAll += attendedScheduled;
            const unattendedScheduled = Math.max(0, totalAssigned - attendedScheduled);
            const totalAttended = myAtts.length;

            let rate = 0;
            if (totalAssigned > 0) {
                rate = Math.min(100, Math.round((attendedScheduled / totalAssigned) * 100));
            } else if (totalAttended > 0) {
                rate = 100;
            }

            let statusBadge = 'sangat_aktif';
            if (rate >= 85) {
                statusBadge = 'sangat_aktif';
            } else if (rate >= 70) {
                statusBadge = 'cukup';
            } else {
                statusBadge = 'perlu_perhatian';
            }

            return {
                user_id: u.id,
                user_name: u.name,
                user_email: u.email,
                total_assignments: totalAssigned,
                attended_scheduled: attendedScheduled,
                attended_additional: attendedAdditional,
                total_attendances: totalAttended,
                unattended_scheduled: unattendedScheduled,
                attendance_rate: rate,
                status_badge: statusBadge,
                attended_manual: attendedManual,
                attended_self: attendedSelf
            };
        });

        // Urutkan berdasarkan total kehadiran dan persentase tertinggi
        recap.sort((a, b) => {
            if (b.total_attendances !== a.total_attendances) {
                return b.total_attendances - a.total_attendances;
            }
            return b.attendance_rate - a.attendance_rate;
        });

        const activeGsmCount = recap.filter(r => r.total_attendances > 0).length;
        const overallRate = totalScheduledAll > 0 
            ? Math.min(100, Math.round((attendedScheduledAll / totalScheduledAll) * 100))
            : (totalEventsCount > 0 && activeGsmCount > 0 ? 100 : 0);

        return successResponse(res, {
            total_events: totalEventsCount,
            total_gsm: gsmUsers.length,
            active_gsm_count: activeGsmCount,
            overall_attendance_rate: overallRate,
            total_attendances_all: totalAttendancesAll,
            self_check_in_count: totalSelfCheckIn,
            manual_admin_count: totalManualAdmin,
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

