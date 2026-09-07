const express = require('express');
const router = express.Router();
const MenuController = require('../controllers/MenuController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh route menu dengan JWT
router.use(authenticateToken);

// Navigasi khusus user yang login (Sidebar dynamic menu)
router.get('/my-menus', MenuController.getUserNavigation);

// CRUD Master Menu
router.get('/', MenuController.getAllMenus);
router.get('/:id', MenuController.getMenuById);
router.post('/', MenuController.createMenu);
router.put('/:id', MenuController.updateMenu);
router.delete('/:id', MenuController.deleteMenu);

module.exports = router;
