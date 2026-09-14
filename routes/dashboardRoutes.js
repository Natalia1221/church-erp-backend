const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/DashboardController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

// Proteksi rute dengan JWT Authentication Middleware
router.use(authenticateToken);

// Mengambil seluruh statistik komprehensif dashboard
router.get('/stats', authorizePermission('/dashboard', 'can_read'), DashboardController.getDashboardStats);

module.exports = router;
