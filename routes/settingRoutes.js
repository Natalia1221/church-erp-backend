const express = require('express');
const router = express.Router();
const SettingController = require('../controllers/SettingController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Setting dengan JWT Authentication
router.use(authenticateToken);

// CRUD Settings
router.get('/', SettingController.getAllSettings);
router.get('/groups', SettingController.getSettingGroups);
router.get('/:id', SettingController.getSettingById);
router.post('/', SettingController.createSetting);
router.put('/:id', SettingController.updateSetting);
router.delete('/:id', SettingController.deleteSetting);

module.exports = router;
