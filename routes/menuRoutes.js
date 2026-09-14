const express = require('express');
const router = express.Router();
const MenuController = require('../controllers/MenuController');
const authenticateToken = require('../middlewares/authMiddleware');

const { authorizePermission } = authenticateToken;

// Proteksi seluruh route menu dengan JWT
router.use(authenticateToken);

// Navigasi khusus user yang login (Sidebar dynamic menu)
router.get('/my-menus', MenuController.getUserNavigation);

// CRUD Master Menu (mengikuti detail role akun yang login)
router.get('/', authorizePermission('/menus', 'can_read'), MenuController.getAllMenus);
router.get('/:id', authorizePermission('/menus', 'can_show'), MenuController.getMenuById);
router.post('/', authorizePermission('/menus', 'can_create'), MenuController.createMenu);
router.put('/:id', authorizePermission('/menus', 'can_update'), MenuController.updateMenu);
router.delete('/:id', authorizePermission('/menus', 'can_delete'), MenuController.deleteMenu);

module.exports = router;
