const express = require('express');
const router = express.Router();
const FinanceCategoryController = require('../controllers/FinanceCategoryController');
const { authenticateToken, authorizePermission } = require('../middlewares/authMiddleware');

const MENU_PATH = '/keuangan/kategori';

// Seluruh route Kategori Keuangan dilindungi JWT Authentication
router.use(authenticateToken);

// Route CRUD Kategori Keuangan
router.get('/', authorizePermission(MENU_PATH, 'can_read'), FinanceCategoryController.getAllFinanceCategories);
router.get('/:id', authorizePermission(MENU_PATH, ['can_read', 'can_show']), FinanceCategoryController.getFinanceCategoryById);
router.post('/', authorizePermission(MENU_PATH, 'can_create'), FinanceCategoryController.createFinanceCategory);
router.put('/:id', authorizePermission(MENU_PATH, 'can_update'), FinanceCategoryController.updateFinanceCategory);
router.delete('/:id', authorizePermission(MENU_PATH, 'can_delete'), FinanceCategoryController.deleteFinanceCategory);

module.exports = router;
