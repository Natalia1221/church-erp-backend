const express = require('express');
const router = express.Router();
const CategoryController = require('../controllers/CategoryController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/penjadwalan/kategori';

// Proteksi seluruh rute Kategori Pelayanan dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk m_categories
router.get('/', authorizePermission(MENU_PATH, 'can_read'), CategoryController.getAllCategories);
router.get('/:id', authorizePermission(MENU_PATH, ['can_read', 'can_show']), CategoryController.getCategoryById);
router.post('/', authorizePermission(MENU_PATH, 'can_create'), CategoryController.createCategory);
router.put('/:id', authorizePermission(MENU_PATH, 'can_update'), CategoryController.updateCategory);
router.delete('/:id', authorizePermission(MENU_PATH, 'can_delete'), CategoryController.deleteCategory);

module.exports = router;
