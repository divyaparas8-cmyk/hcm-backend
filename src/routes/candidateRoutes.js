// ============================================================
// Candidate Routes  →  /api/candidate/*
// ============================================================
const express = require('express');
const router = express.Router();
const { protect, tenantGuard, authorize } = require('../middlewares/authMiddleware');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { checkPermission } = require('../middlewares/permissionMiddleware');

const {
  getAvailableJobs,
  applyToJob,
  getMyApplications,
  withdrawApplication,
  getCandidateProfile,
  updateCandidateProfile,
  updateSettings,
  getSettings,
  getMyOffers,
  respondToOffer,
} = require('../controllers/candidateController');

// Public - Anyone can browse jobs
router.get('/jobs', getAvailableJobs);

// Protected - Only CANDIDATE
router.use(protect, tenantGuard, authorize('CANDIDATE'));
router.post('/jobs/:jobId/apply', checkPermission('browse_jobs', 'create'), applyToJob);
router.get('/applications', checkPermission('my_applications', 'view'), getMyApplications);
router.delete('/applications/:appId', checkPermission('my_applications', 'delete'), withdrawApplication);
router.get('/profile', checkPermission('profile', 'view'), getCandidateProfile);
router.put('/profile', checkPermission('profile', 'edit'), updateCandidateProfile);
router.get('/settings', checkPermission('settings', 'view'), getSettings);
router.put('/settings', checkPermission('settings', 'edit'), updateSettings);

// Offer response
router.get('/offers', checkPermission('offers', 'view'), getMyOffers);
router.patch('/offers/:id/respond', checkPermission('offers', 'approve'), respondToOffer);

module.exports = router;
