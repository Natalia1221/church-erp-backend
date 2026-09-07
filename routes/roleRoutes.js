const express = require('express');
const router = express.Router();
const RoleController = require('../controllers/RoleController');
const RoleMenuController = require('../controllers/RoleMenuController');
const authenticateToken = require('../middlewares/authMiddleware');

// Proteksi seluruh rute Role dengan JWT Authentication Middleware
router.use(authenticateToken);

// Route CRUD untuk m_roles
router.get('/', RoleController.getAllRoles);
router.get('/:id', RoleController.getRoleById);
router.post('/', RoleController.createRole);
router.put('/:id', RoleController.updateRole);
router.delete('/:id', RoleController.deleteRole);

// Route Manajemen Hak Akses Menu Role (role_menus)
router.get('/:roleId/permissions', RoleMenuController.getRolePermissions);
router.put('/:roleId/permissions', RoleMenuController.updateRolePermissions);

module.exports = router;
