const express = require('express');
const router = express.Router();
const MingguController = require('../controllers/MingguController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/penjadwalan/jadwal/minggu';

// Proteksi seluruh rute Minggu dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk Acara Minggu
router.get('/', authorizePermission(MENU_PATH, 'can_read'), MingguController.getAllMinggu);
router.get('/:id', authorizePermission(MENU_PATH, ['can_read', 'can_show']), MingguController.getMingguById);
router.post('/', authorizePermission(MENU_PATH, 'can_create'), MingguController.createMinggu);
router.put('/:id', authorizePermission(MENU_PATH, 'can_update'), MingguController.updateMinggu);
router.put('/:id/assignments', authorizePermission(MENU_PATH, 'can_update'), MingguController.updateAssignments);
router.delete('/:id', authorizePermission(MENU_PATH, 'can_delete'), MingguController.deleteMinggu);

module.exports = router;
