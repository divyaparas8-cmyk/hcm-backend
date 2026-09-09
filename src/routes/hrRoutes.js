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

const { addTeamLeaveRequest } = require('../controllers/managerController');
const { reviewLeave } = require('../controllers/adminController');

// Base authentication & platform role check
router.use(protect, tenantGuard, authorize('HR', 'ADMIN', 'SUPERADMIN'));

// Job Posts
router.get('/jobs', checkPermission('job_posts', 'view'), subscriptionGuard('recruitment_pipeline'), getJobs);
router.post('/jobs', checkPermission('job_posts', 'create'), subscriptionGuard('recruitment_pipeline'), createJob);
router.put('/jobs/:id', checkPermission('job_posts', 'edit'), subscriptionGuard('recruitment_pipeline'), updateJob);
router.delete('/jobs/:id', checkPermission('job_posts', 'delete'), subscriptionGuard('recruitment_pipeline'), deleteJob);

// Compensation & Payroll Operations
router.get('/compensation/:employeeId', checkPermission('payroll_operations', 'view'), subscriptionGuard('payroll_operations'), getCompensationProfile);
router.put('/compensation/:employeeId', checkPermission('payroll_operations', 'edit'), subscriptionGuard('payroll_operations'), updateCompensationProfile);
router.post('/payroll/run', checkPermission('payroll_operations', 'create'), subscriptionGuard('payroll_operations'), runPayroll);
router.post('/payroll/run-batch', checkPermission('payroll_operations', 'create'), subscriptionGuard('payroll_operations'), runPayrollBatch);
router.get('/payroll/snapshots', checkPermission('payroll_operations', 'view'), subscriptionGuard('payroll_operations'), getPayrollSnapshots);
router.patch('/payroll/:id/finalize', checkPermission('payroll_operations', 'approve'), subscriptionGuard('payroll_operations'), finalizePayrollSnapshot);

// HR Salary Increments
router.get('/payroll/increments', checkPermission('payroll_operations', 'view'), subscriptionGuard('payroll_operations'), getHRIncrementRequests);
router.patch('/payroll/increments/:id/approve', checkPermission('payroll_operations', 'approve'), subscriptionGuard('payroll_operations'), approveHRIncrementRequest);
router.patch('/payroll/increments/:id/reject', checkPermission('payroll_operations', 'approve'), subscriptionGuard('payroll_operations'), rejectHRIncrementRequest);

// Candidates
router.get('/candidates/:id/track', subscriptionGuard('recruitment_pipeline'), trackCandidateProfile);

// Interviews
router.get('/interviews', checkPermission('interviews', 'view'), subscriptionGuard('recruitment_pipeline'), getInterviews);
router.post('/interviews', checkPermission('interviews', 'create'), subscriptionGuard('recruitment_pipeline'), scheduleInterview);
router.put('/interviews/:id', checkPermission('interviews', 'edit'), subscriptionGuard('recruitment_pipeline'), updateInterview);
router.delete('/interviews/:id', checkPermission('interviews', 'delete'), subscriptionGuard('recruitment_pipeline'), deleteInterviewById);
router.patch('/interviews/:id/status', checkPermission('interviews', 'edit'), subscriptionGuard('recruitment_pipeline'), updateInterviewStatus);
router.patch('/interviews/:id/feedback', checkPermission('interviews', 'edit'), subscriptionGuard('recruitment_pipeline'), submitInterviewFeedback);

// Applications
router.get('/applications', checkPermission('hiring_pipeline', 'view'), subscriptionGuard('recruitment_pipeline'), getApplications);
router.post('/applications', checkPermission('hiring_pipeline', 'create'), subscriptionGuard('recruitment_pipeline'), fileUpload.single('resume'), createApplication);
router.patch('/applications/:id/status', checkPermission('hiring_pipeline', 'edit'), subscriptionGuard('recruitment_pipeline'), updateApplicationStatus);
router.delete('/applications/:id', checkPermission('hiring_pipeline', 'delete'), subscriptionGuard('recruitment_pipeline'), deleteApplication);

// Offers
router.get('/offers', checkPermission('offer_management', 'view'), subscriptionGuard('recruitment_pipeline'), getOffers);
router.post('/offers', checkPermission('offer_management', 'create'), subscriptionGuard('recruitment_pipeline'), createOffer);
router.put('/offers/:id', checkPermission('offer_management', 'edit'), subscriptionGuard('recruitment_pipeline'), updateOffer);
router.delete('/offers/:id', checkPermission('offer_management', 'delete'), subscriptionGuard('recruitment_pipeline'), deleteOffer);

// Employees
router.get('/employees', checkPermission('dashboard', 'view'), getAllEmployees);
router.post('/employees', checkPermission('onboarding', 'create'), onboardEmployee);
router.patch('/employees/:id/deactivate', checkPermission('dashboard', 'edit'), deactivateEmployee);
router.patch('/employees/:id/confirm-probation', checkPermission('onboarding', 'edit'), confirmEmployeeProbation);
router.patch('/employees/:id/extend-probation', checkPermission('onboarding', 'edit'), extendEmployeeProbation);

// Exits / Offboarding
router.post('/terminate', checkPermission('offboarding_resignations', 'create'), subscriptionGuard('offboarding_exit'), initiateTermination);
router.get('/exits', checkPermission('offboarding_resignations', 'view'), subscriptionGuard('offboarding_exit'), getExitsList);
router.patch('/exits/:id/clearance', checkPermission('offboarding_resignations', 'edit'), subscriptionGuard('offboarding_exit'), updateClearanceStatus);
router.patch('/exits/:id/finalize', checkPermission('offboarding_resignations', 'approve'), subscriptionGuard('offboarding_exit'), finalizeExit);
router.patch('/resignations/:id/approve', checkPermission('offboarding_resignations', 'approve'), subscriptionGuard('offboarding_exit'), reviewResignationHr);

// Leaves
router.get('/leaves', checkPermission('dashboard', 'view'), subscriptionGuard('attendance_leave'), getAllLeaves);
router.post('/leaves', checkPermission('dashboard', 'create'), subscriptionGuard('attendance_leave'), addTeamLeaveRequest);
router.patch('/leaves/:id', checkPermission('dashboard', 'approve'), subscriptionGuard('attendance_leave'), reviewLeave);

// Support Tickets
router.get('/tickets', checkPermission('dashboard', 'view'), subscriptionGuard('support_tickets'), getAllTickets);
router.post('/tickets', checkPermission('dashboard', 'create'), subscriptionGuard('support_tickets'), createTicket);
router.post('/tickets/:id/reply', checkPermission('dashboard', 'create'), subscriptionGuard('support_tickets'), fileUpload.single('file'), replyTicket);
router.patch('/tickets/:id/status', checkPermission('dashboard', 'edit'), subscriptionGuard('support_tickets'), updateTicketStatus);

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
router.get('/reports', checkPermission('reports', 'view'), subscriptionGuard('advanced_reports'), getHRReports);

// AI Features
router.post('/ai/candidate-summary', subscriptionGuard('ai_resume_scoring'), aiCandidateSummary);

module.exports = router;
