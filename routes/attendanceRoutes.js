const express = require('express');
const router = express.Router();
const AttendanceController = require('../controllers/AttendanceController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Absensi dengan JWT Authentication Middleware
router.use(authenticateToken);

// Rute Absensi Mandiri untuk Petugas / GSM
router.get('/today-events', AttendanceController.getTodayEvents);
router.post('/check-in', AttendanceController.checkIn);
router.get('/my-history', AttendanceController.getMyHistory);

module.exports = router;
