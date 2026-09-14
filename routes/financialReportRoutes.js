const express = require('express');
const router = express.Router();
const FinancialReportController = require('../controllers/FinancialReportController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/keuangan/laporan';

// Proteksi seluruh route Laporan Keuangan dengan JWT Authentication Middleware
router.use(authenticateToken);

// 1. Mengambil data komprehensif Laporan Keuangan (Income, Expense, Net Balance)
router.get('/', authorizePermission(MENU_PATH, 'can_read'), FinancialReportController.getFinancialReport);

module.exports = router;
