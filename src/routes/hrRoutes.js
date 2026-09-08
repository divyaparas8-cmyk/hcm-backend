// ============================================================
// HR Routes  →  /api/hr/*
// ============================================================
const express = require('express');
const router = express.Router();
const { protect, tenantGuard, authorize } = require('../middlewares/authMiddleware');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { checkPermission } = require('../middlewares/permissionMiddleware');
const upload = require('../middlewares/upload');
const fileUpload = require('../middlewares/fileUpload');

const {
  getJobs, createJob, updateJob, deleteJob,
  getApplications, updateApplicationStatus, createApplication, deleteApplication,
  getInterviews, scheduleInterview, updateInterview, deleteInterviewById, updateInterviewStatus, submitInterviewFeedback,
  getAllEmployees, onboardEmployee, deactivateEmployee,
  getAllLeaves,
  getAllTickets, createTicket, replyTicket, updateTicketStatus,
  getOffers, createOffer, updateOffer, deleteOffer,
  getOnboardingTasks, createOnboardingTask, updateOnboardingTask, deleteOnboardingTask,
  remindManager, sendWelcomeEmailAll,
  promoteCandidate,
  confirmEmployeeProbation, extendEmployeeProbation,
  initiateTermination, getExitsList, updateClearanceStatus, finalizeExit, reviewResignationHr,
  trackCandidateProfile,
} = require('../controllers/hrController');

const { getHRReports } = require('../controllers/reportsController');

const {
  getCompensationProfile, updateCompensationProfile, runPayroll, runPayrollBatch, getPayrollSnapshots,
  finalizePayrollSnapshot, getHRIncrementRequests, approveHRIncrementRequest, rejectHRIncrementRequest
} = require('../controllers/compensationController');

// Base authentication & platform role check
router.use(protect, tenantGuard, authorize('HR', 'ADMIN', 'SUPERADMIN'));

// Job Posts
router.get('/jobs', checkPermission('job_posts', 'view'), getJobs);
router.post('/jobs', checkPermission('job_posts', 'create'), createJob);
router.put('/jobs/:id', checkPermission('job_posts', 'edit'), updateJob);
router.delete('/jobs/:id', checkPermission('job_posts', 'delete'), deleteJob);

// Compensation & Payroll Operations
router.get('/compensation/:employeeId', checkPermission('payroll_operations', 'view'), getCompensationProfile);
router.put('/compensation/:employeeId', checkPermission('payroll_operations', 'edit'), updateCompensationProfile);
router.post('/payroll/run', checkPermission('payroll_operations', 'create'), runPayroll);
router.post('/payroll/run-batch', checkPermission('payroll_operations', 'create'), runPayrollBatch);
router.get('/payroll/snapshots', checkPermission('payroll_operations', 'view'), getPayrollSnapshots);
router.patch('/payroll/:id/finalize', checkPermission('payroll_operations', 'approve'), finalizePayrollSnapshot);

// HR Salary Increments
router.get('/payroll/increments', checkPermission('payroll_operations', 'view'), getHRIncrementRequests);
router.patch('/payroll/increments/:id/approve', checkPermission('payroll_operations', 'approve'), approveHRIncrementRequest);
router.patch('/payroll/increments/:id/reject', checkPermission('payroll_operations', 'approve'), rejectHRIncrementRequest);

// Candidates / Applications
router.get('/applications', checkPermission('candidates', 'view'), getApplications);
router.post('/applications', checkPermission('candidates', 'create'), createApplication);
router.patch('/applications/:id/status', checkPermission('candidates', 'edit'), updateApplicationStatus);
router.patch('/applications/:id/track', checkPermission('candidates', 'edit'), trackCandidateProfile);
router.delete('/applications/:id', checkPermission('candidates', 'delete'), deleteApplication);

// Offers
router.get('/offers', checkPermission('offer_management', 'view'), getOffers);
router.post('/offers', checkPermission('offer_management', 'create'), createOffer);
router.put('/offers/:id', checkPermission('offer_management', 'edit'), updateOffer);
router.delete('/offers/:id', checkPermission('offer_management', 'delete'), deleteOffer);

// Interviews
router.get('/interviews', checkPermission('interviews', 'view'), getInterviews);
router.post('/interviews', checkPermission('interviews', 'create'), scheduleInterview);
router.put('/interviews/:id', checkPermission('interviews', 'edit'), updateInterview);
router.delete('/interviews/:id', checkPermission('interviews', 'delete'), deleteInterviewById);
router.patch('/interviews/:id/status', checkPermission('interviews', 'edit'), updateInterviewStatus);
router.patch('/interviews/:id/feedback', checkPermission('interviews', 'edit'), submitInterviewFeedback);

// Employees
router.get('/employees', checkPermission('onboarding', 'view'), getAllEmployees);
router.post('/employees', checkPermission('onboarding', 'create'), subscriptionGuard('ADD_EMPLOYEE'), onboardEmployee);
router.patch('/employees/:id/deactivate', checkPermission('onboarding', 'edit'), deactivateEmployee);
router.patch('/employees/:id/confirm-probation', checkPermission('onboarding', 'approve'), confirmEmployeeProbation);
router.patch('/employees/:id/extend-probation', checkPermission('onboarding', 'edit'), extendEmployeeProbation);

// Exits / Offboarding
router.post('/terminate', checkPermission('offboarding_resignations', 'create'), initiateTermination);
router.get('/exits', checkPermission('offboarding_resignations', 'view'), getExitsList);
router.patch('/exits/:id/clearance', checkPermission('offboarding_resignations', 'edit'), updateClearanceStatus);
router.patch('/exits/:id/finalize', checkPermission('offboarding_resignations', 'approve'), finalizeExit);
router.patch('/resignations/:id/approve', checkPermission('offboarding_resignations', 'approve'), reviewResignationHr);

// Leaves
router.get('/leaves', checkPermission('dashboard', 'view'), getAllLeaves);

// Support Tickets
router.get('/tickets', checkPermission('dashboard', 'view'), getAllTickets);
router.post('/tickets', checkPermission('dashboard', 'create'), createTicket);
router.post('/tickets/:id/reply', checkPermission('dashboard', 'create'), fileUpload.single('file'), replyTicket);
router.patch('/tickets/:id/status', checkPermission('dashboard', 'edit'), updateTicketStatus);

// Onboarding
router.get('/onboarding', checkPermission('onboarding', 'view'), getOnboardingTasks);
router.post('/onboarding', checkPermission('onboarding', 'create'), createOnboardingTask);
router.put('/onboarding/:id', checkPermission('onboarding', 'edit'), updateOnboardingTask);
router.delete('/onboarding/:id', checkPermission('onboarding', 'delete'), deleteOnboardingTask);
router.post('/onboarding/:id/remind-manager', checkPermission('onboarding', 'edit'), remindManager);
router.post('/onboarding/send-welcome', checkPermission('onboarding', 'create'), sendWelcomeEmailAll);
router.post('/onboarding/:id/promote', checkPermission('onboarding', 'approve'), promoteCandidate);

const { aiCandidateSummary } = require('../controllers/aiController');

// Reports
router.get('/reports', checkPermission('reports', 'view'), getHRReports);

// AI Features
router.post('/ai/candidate-summary', aiCandidateSummary);

module.exports = router;
