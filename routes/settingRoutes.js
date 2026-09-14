const express = require('express');
const router = express.Router();
const SettingController = require('../controllers/SettingController');
const authenticateToken = require('../middlewares/authMiddleware');

const { authorizePermission } = authenticateToken;

// Proteksi seluruh rute Setting dengan JWT Authentication
router.use(authenticateToken);

// CRUD Settings
router.get('/', SettingController.getAllSettings);
router.get('/groups', SettingController.getSettingGroups);
router.get('/:id', SettingController.getSettingById);
router.post('/', authorizePermission('/settings', 'can_create'), SettingController.createSetting);
router.put('/:id', authorizePermission('/settings', 'can_update'), SettingController.updateSetting);
router.delete('/:id', authorizePermission('/settings', 'can_delete'), SettingController.deleteSetting);

module.exports = router;
