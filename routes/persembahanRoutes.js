const express = require('express');
const router = express.Router();
const PersembahanController = require('../controllers/PersembahanController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/keuangan/persembahan';

// Seluruh rute persembahan dilindungi JWT Authentication
router.use(authenticateToken);

// 1. Overview seluruh ibadah MINGGU beserta persembahan & rangkuman nominal per kategori m_persembahan
router.get('/', authorizePermission(MENU_PATH, 'can_read'), PersembahanController.getPersembahanOverview);

// 2. Mengambil detail nominal persembahan untuk suatu ibadah MINGGU tertentu
router.get('/event/:eventId', authorizePermission(MENU_PATH, ['can_read', 'can_show']), PersembahanController.getPersembahanByEventId);

// 3. Menyimpan / Mengupdate nominal persembahan untuk ibadah MINGGU
router.post('/event/:eventId', authorizePermission(MENU_PATH, ['can_create', 'can_update']), PersembahanController.savePersembahanByEvent);

// 4. Menghapus data persembahan pada ibadah MINGGU
router.delete('/event/:eventId', authorizePermission(MENU_PATH, 'can_delete'), PersembahanController.deletePersembahanByEvent);

module.exports = router;
