const db = require('../config/db');
const { successResponse, errorResponse } = require('../helpers/responseHelper');

/**
 * Controller untuk mengagregasikan statistik komprehensif sistem ERP Gereja
 * Digunakan oleh Halaman Dashboard
 */
const getDashboardStats = async (req, res) => {
    try {
        // 1. Akun Pengguna & Distribusi Role
        const [totalUsersRow] = await db.query('SELECT COUNT(*) as total_users FROM users');
        const totalUsers = totalUsersRow[0]?.total_users || 0;

        const [rolesCount] = await db.query(`
            SELECT 
                r.id as role_id, 
                r.code as role_code, 
                r.name as role_name, 
                COUNT(DISTINCT ur.user_id) as total_users
            FROM m_roles r
            LEFT JOIN user_roles ur ON r.id = ur.role_id
            LEFT JOIN users u ON ur.user_id = u.id
            GROUP BY r.id, r.code, r.name
            ORDER BY total_users DESC, r.code ASC
        `);

        const formattedRoles = rolesCount.map(r => ({
            role_id: r.role_id,
            role_code: r.role_code,
            role_name: r.role_name,
            total_users: Number(r.total_users) || 0,
            percentage: totalUsers > 0 ? Math.round(((Number(r.total_users) || 0) / totalUsers) * 100) : 0
        }));

        // 2. Acara & Ibadah (Total, Terlaksana, Mendatang, Rincian Jenis)
        const [eventsSummary] = await db.query(`
            SELECT 
                COUNT(*) as total_events,
                SUM(CASE WHEN is_attendance = 1 OR event_date <= CURDATE() THEN 1 ELSE 0 END) as completed_events,
                SUM(CASE WHEN is_attendance = 0 AND event_date > CURDATE() THEN 1 ELSE 0 END) as upcoming_events
            FROM t_events
        `);

        const totalEvents = Number(eventsSummary[0]?.total_events) || 0;
        const completedEvents = Number(eventsSummary[0]?.completed_events) || 0;
        const upcomingEvents = Number(eventsSummary[0]?.upcoming_events) || 0;
        const completionRate = totalEvents > 0 ? Math.round((completedEvents / totalEvents) * 100) : 0;

        const [eventsByType] = await db.query(`
            SELECT 
                event_type, 
                COUNT(*) as total,
                SUM(CASE WHEN is_attendance = 1 OR event_date <= CURDATE() THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN is_attendance = 0 AND event_date > CURDATE() THEN 1 ELSE 0 END) as upcoming
            FROM t_events
            GROUP BY event_type
            ORDER BY total DESC
        `);

        const formattedEventsByType = eventsByType.map(t => ({
            event_type: t.event_type,
            total: Number(t.total) || 0,
            completed: Number(t.completed) || 0,
            upcoming: Number(t.upcoming) || 0
        }));

        // Acara terbaru yang sudah terlaksana
        const [latestCompletedEvents] = await db.query(`
            SELECT 
                e.id, 
                e.event_type, 
                DATE_FORMAT(e.event_date, '%Y-%m-%d') as event_date, 
                e.title, 
                e.is_attendance,
                COUNT(DISTINCT a.id) as total_attendances,
                COUNT(DISTINCT asgn.id) as total_assigned
            FROM t_events e
            LEFT JOIN t_attendances a ON e.id = a.event_id
            LEFT JOIN t_assignments asgn ON e.id = asgn.event_id
            WHERE e.is_attendance = 1 OR e.event_date <= CURDATE()
            GROUP BY e.id, e.event_type, e.event_date, e.title, e.is_attendance
            ORDER BY e.event_date DESC, e.created_at DESC
            LIMIT 1
        `);

        // Acara berikutnya yang akan datang
        const [nextUpcomingEvents] = await db.query(`
            SELECT 
                e.id, 
                e.event_type, 
                DATE_FORMAT(e.event_date, '%Y-%m-%d') as event_date, 
                e.title, 
                e.is_attendance,
                COUNT(DISTINCT asgn.id) as total_assigned
            FROM t_events e
            LEFT JOIN t_assignments asgn ON e.id = asgn.event_id
            WHERE e.event_date >= CURDATE() AND e.is_attendance = 0
            GROUP BY e.id, e.event_type, e.event_date, e.title, e.is_attendance
            ORDER BY e.event_date ASC, e.created_at ASC
            LIMIT 1
        `);

        // 3. Statistik Keaktifan GSM & Absensi
        const [gsmStats] = await db.query(`
            SELECT 
                (SELECT COUNT(DISTINCT u.id) 
                 FROM users u 
                 JOIN user_roles ur ON u.id = ur.user_id 
                 JOIN m_roles r ON ur.role_id = r.id 
                 WHERE r.code = 'GSM') as total_gsm,
                
                (SELECT COUNT(DISTINCT a.user_id) 
                 FROM t_attendances a 
                 JOIN user_roles ur ON a.user_id = ur.user_id 
                 JOIN m_roles r ON ur.role_id = r.id 
                 WHERE r.code = 'GSM') as active_gsm,
                
                (SELECT COUNT(*) FROM t_attendances) as total_attendances,
                
                (SELECT COUNT(*) 
                 FROM t_attendances 
                 WHERE photo_proof LIKE 'MANUAL:%' OR (latitude IS NULL AND longitude IS NULL)) as manual_attendances,
                
                (SELECT COUNT(*) 
                 FROM t_attendances 
                 WHERE (photo_proof NOT LIKE 'MANUAL:%' OR photo_proof IS NULL) AND latitude IS NOT NULL) as verified_gps_attendances
        `);

        const totalGsm = Number(gsmStats[0]?.total_gsm) || 0;
        const activeGsm = Number(gsmStats[0]?.active_gsm) || 0;
        const totalAttendances = Number(gsmStats[0]?.total_attendances) || 0;
        const manualAttendances = Number(gsmStats[0]?.manual_attendances) || 0;
        const verifiedGpsAttendances = Number(gsmStats[0]?.verified_gps_attendances) || 0;
        const gsmActivityRate = totalGsm > 0 ? Math.round((activeGsm / totalGsm) * 100) : 0;

        // Leaderboard GSM Paling Aktif
        const [topGsmList] = await db.query(`
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                COUNT(a.id) as total_attendances,
                DATE_FORMAT(MAX(a.check_in_time), '%Y-%m-%d %H:%i') as last_attendance,
                SUM(CASE WHEN a.is_scheduled = 1 THEN 1 ELSE 0 END) as scheduled_attendances
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN m_roles r ON ur.role_id = r.id
            LEFT JOIN t_attendances a ON u.id = a.user_id
            WHERE r.code = 'GSM'
            GROUP BY u.id, u.name, u.email
            ORDER BY total_attendances DESC, u.name ASC
            LIMIT 10
        `);

        const formattedTopGsm = topGsmList.map((g, idx) => ({
            rank: idx + 1,
            id: g.id,
            name: g.name,
            email: g.email,
            total_attendances: Number(g.total_attendances) || 0,
            scheduled_attendances: Number(g.scheduled_attendances) || 0,
            last_attendance: g.last_attendance || null,
            status_label: Number(g.total_attendances) > 0 ? 'Aktif' : 'Belum Pernah Absen'
        }));

        // 4. Data Tren Absensi per Tanggal Acara (untuk Grafik Chart)
        const [trendsList] = await db.query(`
            SELECT 
                e.id,
                e.title,
                e.event_type,
                DATE_FORMAT(e.event_date, '%Y-%m-%d') as event_date,
                COUNT(DISTINCT a.id) as total_attendances,
                COUNT(DISTINCT asgn.id) as total_assigned
            FROM t_events e
            LEFT JOIN t_attendances a ON e.id = a.event_id
            LEFT JOIN t_assignments asgn ON e.id = asgn.event_id
            WHERE e.is_attendance = 1 OR a.id IS NOT NULL OR e.event_date <= CURDATE()
            GROUP BY e.id, e.title, e.event_type, e.event_date
            ORDER BY e.event_date ASC
            LIMIT 10
        `);

        const formattedTrends = trendsList.map(t => ({
            id: t.id,
            title: t.title,
            event_type: t.event_type,
            event_date: t.event_date,
            attendances: Number(t.total_attendances) || 0,
            assigned: Number(t.total_assigned) || 0
        }));

        // Data response lengkap
        const dashboardData = {
            users: {
                total: totalUsers,
                by_role: formattedRoles
            },
            events: {
                total: totalEvents,
                completed: completedEvents,
                upcoming: upcomingEvents,
                completion_rate: completionRate,
                by_type: formattedEventsByType,
                latest_completed: latestCompletedEvents[0] || null,
                next_upcoming: nextUpcomingEvents[0] || null
            },
            gsm: {
                total_gsm: totalGsm,
                active_gsm: activeGsm,
                activity_rate: gsmActivityRate,
                total_attendances: totalAttendances,
                methods: {
                    verified_gps: verifiedGpsAttendances,
                    manual: manualAttendances
                },
                leaderboard: formattedTopGsm
            },
            trends: formattedTrends
        };

        return successResponse(res, dashboardData, 'Statistik dashboard berhasil diambil');
    } catch (error) {
        console.error('Error getDashboardStats:', error);
        return errorResponse(res, 'Terjadi kesalahan pada server saat mengambil data statistik dashboard', 500, error.message);
    }
};

module.exports = {
    getDashboardStats
};
