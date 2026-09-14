const express = require('express');
const router = express.Router();
const SermonController = require('../controllers/SermonController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/penjadwalan/jadwal/sermon';

// Proteksi seluruh rute Sermon dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk Sermon
router.get('/', authorizePermission(MENU_PATH, 'can_read'), SermonController.getAllSermons);
router.get('/:id', authorizePermission(MENU_PATH, ['can_read', 'can_show']), SermonController.getSermonById);
router.post('/', authorizePermission(MENU_PATH, 'can_create'), SermonController.createSermon);
router.put('/:id', authorizePermission(MENU_PATH, 'can_update'), SermonController.updateSermon);
router.delete('/:id', authorizePermission(MENU_PATH, 'can_delete'), SermonController.deleteSermon);

module.exports = router;
