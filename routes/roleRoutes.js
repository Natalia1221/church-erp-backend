const express = require('express');
const router = express.Router();
const RoleController = require('../controllers/RoleController');
const RoleMenuController = require('../controllers/RoleMenuController');
const authenticateToken = require('../middlewares/authMiddleware');

const { authorizePermission } = authenticateToken;

// Proteksi seluruh rute Role dengan JWT Authentication Middleware
router.use(authenticateToken);

// Route CRUD untuk m_roles (mengikuti detail role akun yang login)
router.get('/', authorizePermission('/roles', 'can_read'), RoleController.getAllRoles);
router.get('/utils/next-code', authorizePermission('/roles', 'can_create'), RoleController.getNextRoleCode);
router.get('/:id', authorizePermission('/roles', 'can_show'), RoleController.getRoleById);
router.post('/', authorizePermission('/roles', 'can_create'), RoleController.createRole);
router.put('/:id', authorizePermission('/roles', 'can_update'), RoleController.updateRole);
router.delete('/:id', authorizePermission('/roles', 'can_delete'), RoleController.deleteRole);

// Route Manajemen Hak Akses Menu Role (role_menus)
router.get('/:roleId/permissions', authorizePermission('/roles', 'can_read'), RoleMenuController.getRolePermissions);
router.put('/:roleId/permissions', authorizePermission('/roles', 'can_update'), RoleMenuController.updateRolePermissions);

module.exports = router;
