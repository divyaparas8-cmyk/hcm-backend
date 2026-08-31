const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, getMasterCurrency, updateMasterCurrency } = require('../controllers/settingsController');
const { protect, tenantGuard, authorize } = require('../middlewares/authMiddleware');
const subscriptionGuard = require('../middlewares/subscriptionGuard');

router.get('/master-currency', getMasterCurrency);
router.put('/master-currency', protect, tenantGuard, authorize('SUPERADMIN'), updateMasterCurrency);

router.get('/', getSettings); // Public/Authenticated GET
router.put('/', protect, tenantGuard, authorize('SUPERADMIN', 'ADMIN'), updateSettings);

module.exports = router;
