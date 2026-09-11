const express = require('express');
const router = express.Router();
const SermonController = require('../controllers/SermonController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Sermon dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk Sermon
router.get('/', SermonController.getAllSermons);
router.get('/:id', SermonController.getSermonById);
router.post('/', SermonController.createSermon);
router.delete('/:id', SermonController.deleteSermon);

module.exports = router;
