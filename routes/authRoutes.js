const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const authenticateToken = require('../middlewares/authMiddleware');

// Endpoint Auth Publik
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);

// Endpoint Auth Terproteksi (Wajib Bearer Token)
router.get('/me', authenticateToken, AuthController.getMe);

module.exports = router;
