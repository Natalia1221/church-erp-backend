const express = require('express');
const router = express.Router();
const AttendanceController = require('../controllers/AttendanceController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const CHECKIN_PATH = '/absensi/check-in-acara';
const RECAP_PATH = '/absensi/rekap-laporan';

// Proteksi seluruh rute Absensi dengan JWT Authentication Middleware
router.use(authenticateToken);

// Rute Absensi Mandiri untuk Petugas / GSM
router.get('/today-events', authorizePermission(CHECKIN_PATH, 'can_read'), AttendanceController.getTodayEvents);
router.post('/check-in', authorizePermission(CHECKIN_PATH, 'can_create'), AttendanceController.checkIn);
router.get('/my-history', authorizePermission(CHECKIN_PATH, 'can_read'), AttendanceController.getMyHistory);

// Rute Monitoring & Rekapitulasi untuk Admin & Pendeta
router.get('/events/:eventId/monitoring', authorizePermission(CHECKIN_PATH, ['can_read', 'can_show']), AttendanceController.getEventMonitoring);
router.post('/manual-checkin', authorizePermission(CHECKIN_PATH, ['can_create', 'can_update']), AttendanceController.manualCheckIn);
router.delete('/:id', authorizePermission(CHECKIN_PATH, 'can_delete'), AttendanceController.deleteAttendance);
router.get('/recap', authorizePermission(RECAP_PATH, 'can_read'), AttendanceController.getRecapReport);

module.exports = router;
