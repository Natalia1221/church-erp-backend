const express = require('express');
const router = express.Router();
const LainnyaController = require('../controllers/LainnyaController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/penjadwalan/jadwal/lainnya';

// Proteksi seluruh rute Lainnya dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk Acara Lainnya
router.get('/', authorizePermission(MENU_PATH, 'can_read'), LainnyaController.getAllLainnya);
router.get('/:id', authorizePermission(MENU_PATH, ['can_read', 'can_show']), LainnyaController.getLainnyaById);
router.post('/', authorizePermission(MENU_PATH, 'can_create'), LainnyaController.createLainnya);
router.put('/:id', authorizePermission(MENU_PATH, 'can_update'), LainnyaController.updateLainnya);
router.delete('/:id', authorizePermission(MENU_PATH, 'can_delete'), LainnyaController.deleteLainnya);

module.exports = router;
