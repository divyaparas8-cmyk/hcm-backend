// ============================================================
// Public Routes - Demo Booking, Contact Form, Career Applications
// ============================================================

const express = require('express');
const router = express.Router();

const { bookDemo, submitContact, submitCareerApplication, getAvailableJobs, getPlatformStats, registerOrganization, validateInvitation, setupPassword } = require('../controllers/publicController');

// Public Routes (no authentication required)
router.post('/demo-booking', bookDemo);
router.post('/contact', submitContact);
router.post('/career-apply', submitCareerApplication);
router.get('/jobs', getAvailableJobs);
router.get('/platform-stats', getPlatformStats);

// Tenant self-registration and invitation routes
router.post('/register-organization', registerOrganization);
router.post('/validate-invitation', validateInvitation);
router.post('/setup-password', setupPassword);

module.exports = router;
