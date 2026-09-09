// ============================================================
// Organization Backup Routes
// ============================================================

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantGuard = require('../middlewares/tenantGuard');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const {
  getAvailableModules,
  getBackupOverview,
  createBackup,
  getBackups,
  getBackupStatus,
  downloadBackup,
  deleteBackup,
  sendBackupEmail,
  uploadToGoogleDrive,
  getGoogleDriveStatus,
  getGoogleDriveAuthUrl,
  handleGoogleDriveCallback,
  disconnectGoogleDrive
} = require('../controllers/backupController');

// Public OAuth callback route (handled via browser redirect from Google)
router.get('/google-drive/callback', handleGoogleDriveCallback);

// Protected tenant backup routes guarded by backup_center feature entitlement
router.use(protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'), subscriptionGuard('backup_center'));

// Module & Overview info
router.get('/modules', getAvailableModules);
router.get('/overview', getBackupOverview);

// Google Drive Integration endpoints
router.get('/google-drive/status', getGoogleDriveStatus);
router.get('/google-drive/connect', getGoogleDriveAuthUrl);
router.post('/google-drive/disconnect', disconnectGoogleDrive);

// Backup Lifecycle
router.get('/', getBackups);
router.post('/', createBackup);
router.get('/:id/status', getBackupStatus);
router.get('/:id/download', downloadBackup);
router.delete('/:id', deleteBackup);
router.post('/:id/email', sendBackupEmail);
router.post('/:id/google-drive', uploadToGoogleDrive);

module.exports = router;
