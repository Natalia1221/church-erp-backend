const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const authenticateToken = require('../middlewares/authMiddleware');

const { authorizePermission } = authenticateToken;

// Proteksi seluruh rute User dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Users (mengikuti detail role akun yang login)
router.get('/', authorizePermission('/users', 'can_read'), UserController.getAllUsers);
router.get('/:id', authorizePermission('/users', 'can_show'), UserController.getUserById);
router.post('/', authorizePermission('/users', 'can_create'), UserController.createUser);
router.put('/:id', authorizePermission('/users', 'can_update'), UserController.updateUser);
router.delete('/:id', authorizePermission('/users', 'can_delete'), UserController.deleteUser);

module.exports = router;
