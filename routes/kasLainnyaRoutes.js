const express = require('express');
const router = express.Router();
const KasLainnyaController = require('../controllers/KasLainnyaController');
const authenticateToken = require('../middlewares/authMiddleware');

const { authorizePermission } = authenticateToken;

// Seluruh rute dilindungi JWT Authentication
router.use(authenticateToken);

// 1. Overview transaksi kas lainnya (filter: type = INCOME, EXPENSE, ALL)
router.get('/', authorizePermission('/keuangan/lainnya', 'can_read'), KasLainnyaController.getKasLainnyaOverview);

// 2. Tambah transaksi kas baru (INCOME / EXPENSE)
router.post('/', authorizePermission('/keuangan/lainnya', 'can_create'), KasLainnyaController.createKasLainnya);

// 3. Update transaksi kas
router.put('/:id', authorizePermission('/keuangan/lainnya', 'can_update'), KasLainnyaController.updateKasLainnya);

// 4. Hapus transaksi kas
router.delete('/:id', authorizePermission('/keuangan/lainnya', 'can_delete'), KasLainnyaController.deleteKasLainnya);

module.exports = router;
