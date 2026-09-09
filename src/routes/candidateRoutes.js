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
  getCandidateDashboard,
  toggleSaveJob,
  getSavedJobs,
  getIndustryProfiles,
  analyzeResumeScore,
  getResumeScoreHistory,
  clearResumeScoreHistory,
  getCandidateInterviews,
  rescheduleCandidateInterview,
  cancelCandidateInterview,
  getCandidateChecklist,
  updateCandidateChecklist,
} = require('../controllers/candidateController');

const { aiBuildResume } = require('../controllers/aiController');

// Public - Anyone can browse jobs
router.get('/jobs', getAvailableJobs);

// Protected - Only CANDIDATE
router.use(protect, tenantGuard, authorize('CANDIDATE'));
router.post('/jobs/:jobId/apply', checkPermission('browse_jobs', 'create'), applyToJob);
router.post('/jobs/:jobId/save', checkPermission('browse_jobs', 'edit'), toggleSaveJob);
router.get('/saved-jobs', checkPermission('browse_jobs', 'view'), getSavedJobs);
router.get('/applications', checkPermission('my_applications', 'view'), getMyApplications);
router.delete('/applications/:appId', checkPermission('my_applications', 'delete'), withdrawApplication);
router.get('/profile', checkPermission('profile', 'view'), getCandidateProfile);
router.put('/profile', checkPermission('profile', 'edit'), updateCandidateProfile);
router.get('/settings', checkPermission('settings', 'view'), getSettings);
router.put('/settings', checkPermission('settings', 'edit'), updateSettings);

// Interview Schedule & Preparation Checklist
router.get('/interviews', checkPermission('interview_schedule', 'view'), getCandidateInterviews);
router.post('/interviews/:id/reschedule', checkPermission('interview_schedule', 'edit'), rescheduleCandidateInterview);
router.patch('/interviews/:id/cancel', checkPermission('interview_schedule', 'edit'), cancelCandidateInterview);
router.get('/checklist', checkPermission('interview_schedule', 'view'), getCandidateChecklist);
router.put('/checklist', checkPermission('interview_schedule', 'edit'), updateCandidateChecklist);

// Offer response
router.get('/offers', checkPermission('offers', 'view'), getMyOffers);
router.patch('/offers/:id/respond', checkPermission('offers', 'approve'), respondToOffer);

// AI Resume Builder & Scoring
router.post('/ai/resume-builder', aiBuildResume);
router.get('/ai/industry-profiles', getIndustryProfiles);
router.post('/ai/resume-score', analyzeResumeScore);
router.get('/ai/resume-score/history', getResumeScoreHistory);
router.delete('/ai/resume-score/history', clearResumeScoreHistory);

// Dashboard aggregated stats
router.get('/dashboard', getCandidateDashboard);

module.exports = router;
