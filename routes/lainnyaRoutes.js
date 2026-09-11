const express = require('express');
const router = express.Router();
const LainnyaController = require('../controllers/LainnyaController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Lainnya dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk Acara Lainnya
router.get('/', LainnyaController.getAllLainnya);
router.get('/:id', LainnyaController.getLainnyaById);
router.post('/', LainnyaController.createLainnya);
router.delete('/:id', LainnyaController.deleteLainnya);

module.exports = router;
