// ============================================================
// Employee Routes  →  /api/employee/*
// ============================================================
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const tenantGuard = require('../middlewares/tenantGuard');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { checkPermission } = require('../middlewares/permissionMiddleware');

const {
  getProfile, updateProfile,
  clockIn, clockOut, getAttendance,
  getLeaves, applyLeave, cancelLeave,
  getPayslips, getPerformance, createGoal, updateGoal, updateGoalProgress, deleteGoal, upsertSkill, deleteSkill,
  getTickets, createTicket, replyTicket, deleteTicketMessage,
  getBenefits, submitBenefitClaim, enrollBenefitPlan, unenrollBenefitPlan, getTasks,
  getDocuments, uploadDocument, deleteDocument,
  getHolidays, getAnnouncements,
  submitResignation, getResignation,
  getPolicies, acknowledgePolicy
} = require('../controllers/employeeController');

const {
  getCompensationProfile, requestIncrement, getPayrollSnapshots
} = require('../controllers/compensationController');

// All routes require authentication
router.use(protect);
router.use(tenantGuard);

// Profile
router.get('/profile', checkPermission('profile', 'view'), getProfile);
router.put('/profile', checkPermission('profile', 'edit'), updateProfile);

// Attendance
router.post('/attendance/clock-in', checkPermission('attendance', 'create'), clockIn);
router.post('/attendance/clock-out', checkPermission('attendance', 'create'), clockOut);
router.get('/attendance', checkPermission('attendance', 'view'), getAttendance);

// Resignation
router.post('/resignation', checkPermission('resignation', 'create'), submitResignation);
router.get('/resignation', checkPermission('resignation', 'view'), getResignation);

// Leaves
router.get('/leaves', checkPermission('leave', 'view'), getLeaves);
router.post('/leaves', checkPermission('leave', 'create'), applyLeave);
router.delete('/leaves/:id', checkPermission('leave', 'delete'), cancelLeave);

// Payroll & Payslips
router.get('/payslips', checkPermission('payroll', 'view'), getPayslips);
router.get('/compensation', checkPermission('payroll', 'view'), (req, res, next) => {
  req.params.employeeId = req.user.employeeProfileId;
  getCompensationProfile(req, res, next);
});
router.post('/compensation/increment', checkPermission('payroll', 'create'), requestIncrement);
router.get('/payroll/snapshots', checkPermission('payroll', 'view'), getPayrollSnapshots);
router.post('/compensation/increment', requestIncrement);
router.get('/payroll/snapshots', getPayrollSnapshots);
router.get('/performance', getPerformance);
router.post('/performance/goals', createGoal);
router.patch('/performance/goals/:id', updateGoal);
router.put('/performance/goals/:id', updateGoal);
router.post('/performance/goals/:id/progress', updateGoalProgress);
router.delete('/performance/goals/:id', deleteGoal);
router.post('/performance/skills', upsertSkill);
router.delete('/performance/skills/:id', deleteSkill);
router.get('/benefits', getBenefits);
router.post('/benefits/claims', submitBenefitClaim);
router.post('/benefits/enroll', enrollBenefitPlan);
router.post('/benefits/unenroll', unenrollBenefitPlan);
router.get('/tasks', getTasks);

// Performance
router.get('/performance', checkPermission('performance', 'view'), getPerformance);
router.post('/performance/goals', checkPermission('performance', 'create'), createGoal);
router.patch('/performance/goals/:id', checkPermission('performance', 'edit'), updateGoal);
router.put('/performance/goals/:id', checkPermission('performance', 'edit'), updateGoal);
router.post('/performance/goals/:id/progress', checkPermission('performance', 'create'), updateGoalProgress);
router.delete('/performance/goals/:id', checkPermission('performance', 'delete'), deleteGoal);
router.post('/performance/skills', checkPermission('performance', 'create'), upsertSkill);
router.delete('/performance/skills/:id', checkPermission('performance', 'delete'), deleteSkill);

// Benefits
router.get('/benefits', checkPermission('benefits', 'view'), getBenefits);
router.post('/benefits/claims', checkPermission('benefits', 'create'), submitBenefitClaim);
router.post('/benefits/enroll', checkPermission('benefits', 'create'), enrollBenefitPlan);
router.post('/benefits/unenroll', checkPermission('benefits', 'create'), unenrollBenefitPlan);
router.get('/tasks', checkPermission('dashboard', 'view'), getTasks);

// Support Help Desk
router.get('/tickets', checkPermission('help_desk', 'view'), getTickets);
router.post('/tickets', checkPermission('help_desk', 'create'), createTicket);
router.post('/tickets/:id/reply', checkPermission('help_desk', 'create'), replyTicket);
router.delete('/tickets/:id/messages/:msgId', checkPermission('help_desk', 'delete'), deleteTicketMessage);

// Holidays & Announcements
router.get('/holidays', checkPermission('dashboard', 'view'), getHolidays);
router.get('/announcements', checkPermission('dashboard', 'view'), getAnnouncements);

const multer = require('multer');
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// Documents
router.get('/documents', checkPermission('documents', 'view'), getDocuments);
router.post('/documents', checkPermission('documents', 'create'), (req, res, next) => {
  console.log('[UPLOAD ROUTE HIT]', req.method, req.originalUrl);
  next();
}, docUpload.single('file'), (req, res, next) => {
  console.log('[MULTER RESULT]', { file: req.file, body: req.body });
  next();
}, uploadDocument);
router.delete('/documents/:id', checkPermission('documents', 'delete'), deleteDocument);

// Compliance Policies
router.get('/policies', checkPermission('compliance', 'view'), getPolicies);
router.post('/policies/:id/acknowledge', checkPermission('compliance', 'create'), acknowledgePolicy);

// AI Features
const {
  aiBuildResume,
  aiPolicyAssistant,
  aiPayrollInsights,
  aiDocumentAnalyze,
  aiGenerateLetter
} = require('../controllers/aiController');
const fileUpload = require('../middlewares/fileUpload');

router.post('/ai/resume-builder', aiBuildResume);
router.post('/ai/policy-assistant', aiPolicyAssistant);
router.post('/ai/payroll-insights', aiPayrollInsights);
router.post('/ai/document-analyze', fileUpload.single('file'), aiDocumentAnalyze);
router.post('/ai/generate-letter', aiGenerateLetter);

module.exports = router;
