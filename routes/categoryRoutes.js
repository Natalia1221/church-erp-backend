const express = require('express');
const router = express.Router();
const CategoryController = require('../controllers/CategoryController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Kategori Pelayanan dengan JWT Authentication Middleware
router.use(authenticateToken);

// CRUD Routes untuk m_categories
router.get('/', CategoryController.getAllCategories);
router.get('/:id', CategoryController.getCategoryById);
router.post('/', CategoryController.createCategory);
router.put('/:id', CategoryController.updateCategory);
router.delete('/:id', CategoryController.deleteCategory);

module.exports = router;
