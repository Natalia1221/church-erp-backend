const express = require('express');
const router = express.Router();
const MingguController = require('../controllers/MingguController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Minggu dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk Acara Minggu
router.get('/', MingguController.getAllMinggu);
router.get('/:id', MingguController.getMingguById);
router.post('/', MingguController.createMinggu);
router.put('/:id/assignments', MingguController.updateAssignments);
router.delete('/:id', MingguController.deleteMinggu);

module.exports = router;
