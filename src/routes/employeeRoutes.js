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
  clockIn, clockOut, getAttendance, getCurrentAttendance, getAttendanceHistory,
  getLeaves, getLeaveBalance, applyLeave, cancelLeave,
  getPayslips, getPerformance, createGoal, updateGoal, updateGoalProgress, deleteGoal, upsertSkill, deleteSkill, requestPerformanceReview,
  getTickets, createTicket, replyTicket, deleteTicketMessage, updateTicketStatus,
  getBenefits, submitBenefitClaim, enrollBenefitPlan, unenrollBenefitPlan, getTasks,
  getDocuments, uploadDocument, deleteDocument,
  getHolidays, getAnnouncements,
  submitResignation, getResignation,
  getPolicies, acknowledgePolicy,
  getSettings, updateSettings,
  getEmployeeDashboard
} = require('../controllers/employeeController');


const {
  getCompensationProfile, requestIncrement, getPayrollSnapshots,
  getEmployeePayroll, downloadPayslip
} = require('../controllers/compensationController');

// All routes require authentication
router.use(protect);
router.use(tenantGuard);

// Dashboard
router.get('/dashboard', checkPermission('dashboard', 'view'), getEmployeeDashboard);

// Profile
router.get('/profile', checkPermission('profile', 'view'), getProfile);
router.put('/profile', checkPermission('profile', 'edit'), updateProfile);

// Settings (display name, language, timezone, date format, notifications, preferences)
router.get('/settings', checkPermission('profile', 'view'), getSettings);
router.put('/settings', checkPermission('profile', 'edit'), updateSettings);

// Password change (proxies to auth controller)
const { changePassword } = require('../controllers/authController');
router.put('/password', changePassword);


// Attendance
router.post('/attendance/clock-in', checkPermission('attendance', 'create'), subscriptionGuard('attendance_leave'), clockIn);
router.post('/attendance/clock-out', checkPermission('attendance', 'create'), subscriptionGuard('attendance_leave'), clockOut);
router.post('/attendance/check-in', checkPermission('attendance', 'create'), subscriptionGuard('attendance_leave'), clockIn);
router.post('/attendance/check-out', checkPermission('attendance', 'create'), subscriptionGuard('attendance_leave'), clockOut);
router.get('/attendance/current', checkPermission('attendance', 'view'), subscriptionGuard('attendance_leave'), getCurrentAttendance);
router.get('/attendance/history', checkPermission('attendance', 'view'), subscriptionGuard('attendance_leave'), getAttendanceHistory);
router.get('/attendance', checkPermission('attendance', 'view'), subscriptionGuard('attendance_leave'), getAttendanceHistory);

// Resignation
router.post('/resignation', checkPermission('resignation', 'create'), subscriptionGuard('offboarding_exit'), submitResignation);
router.get('/resignation', checkPermission('resignation', 'view'), subscriptionGuard('offboarding_exit'), getResignation);

// Leaves
router.get('/leaves/balance', checkPermission('leave', 'view'), subscriptionGuard('attendance_leave'), getLeaveBalance);
router.get('/leaves', checkPermission('leave', 'view'), subscriptionGuard('attendance_leave'), getLeaves);
router.post('/leaves/request', checkPermission('leave', 'create'), subscriptionGuard('attendance_leave'), applyLeave);
router.post('/leaves', checkPermission('leave', 'create'), subscriptionGuard('attendance_leave'), applyLeave);
router.delete('/leaves/:id', checkPermission('leave', 'delete'), subscriptionGuard('attendance_leave'), cancelLeave);
router.patch('/leaves/:id/cancel', checkPermission('leave', 'delete'), subscriptionGuard('attendance_leave'), cancelLeave);

// Payroll & Payslips
router.get('/payslips', checkPermission('payroll', 'view'), subscriptionGuard('payroll_operations'), getPayslips);
router.get('/compensation', checkPermission('payroll', 'view'), subscriptionGuard('payroll_operations'), (req, res, next) => {
  req.params.employeeId = req.user.employeeProfileId;
  getCompensationProfile(req, res, next);
});
router.post('/compensation/increment', checkPermission('payroll', 'create'), subscriptionGuard('payroll_operations'), requestIncrement);
router.get('/payroll/snapshots', checkPermission('payroll', 'view'), subscriptionGuard('payroll_operations'), getPayrollSnapshots);
router.get('/payroll', checkPermission('payroll', 'view'), subscriptionGuard('payroll_operations'), getEmployeePayroll);
router.get('/payslip/:id/download', checkPermission('payroll', 'view'), subscriptionGuard('payroll_operations'), downloadPayslip);

// Performance
router.get('/performance', checkPermission('performance', 'view'), subscriptionGuard('performance_kpi'), getPerformance);
router.post('/performance/goals', checkPermission('performance', 'create'), subscriptionGuard('performance_kpi'), createGoal);
router.patch('/performance/goals/:id', checkPermission('performance', 'edit'), subscriptionGuard('performance_kpi'), updateGoal);
router.put('/performance/goals/:id', checkPermission('performance', 'edit'), subscriptionGuard('performance_kpi'), updateGoal);
router.post('/performance/goals/:id/progress', checkPermission('performance', 'create'), subscriptionGuard('performance_kpi'), updateGoalProgress);
router.delete('/performance/goals/:id', checkPermission('performance', 'delete'), subscriptionGuard('performance_kpi'), deleteGoal);
router.post('/performance/skills', checkPermission('performance', 'create'), subscriptionGuard('performance_kpi'), upsertSkill);
router.delete('/performance/skills/:id', checkPermission('performance', 'delete'), subscriptionGuard('performance_kpi'), deleteSkill);
router.post('/performance/request-review', checkPermission('performance', 'view'), subscriptionGuard('performance_kpi'), requestPerformanceReview);

// Benefits
router.get('/benefits', checkPermission('benefits', 'view'), subscriptionGuard('benefits_insurance'), getBenefits);
router.post('/benefits/claims', checkPermission('benefits', 'create'), subscriptionGuard('benefits_insurance'), submitBenefitClaim);
router.post('/benefits/enroll', checkPermission('benefits', 'create'), subscriptionGuard('benefits_insurance'), enrollBenefitPlan);
router.post('/benefits/:id/enroll', checkPermission('benefits', 'create'), subscriptionGuard('benefits_insurance'), (req, res, next) => {
  req.body.benefitPlanId = req.params.id;
  enrollBenefitPlan(req, res, next);
});
router.post('/benefits/unenroll', checkPermission('benefits', 'create'), subscriptionGuard('benefits_insurance'), unenrollBenefitPlan);
router.post('/benefits/:id/unenroll', checkPermission('benefits', 'create'), subscriptionGuard('benefits_insurance'), (req, res, next) => {
  req.body.benefitPlanId = req.params.id;
  unenrollBenefitPlan(req, res, next);
});
// Reimbursements (dedicated routes)
router.get('/reimbursements', checkPermission('benefits', 'view'), subscriptionGuard('benefits_insurance'), (req, res, next) => {
  // Reuse getBenefits but return only claims
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    if (data?.success && data?.data?.claims) {
      return originalJson({ success: true, data: data.data.claims });
    }
    return originalJson(data);
  };
  getBenefits(req, res, next);
});
router.post('/reimbursements', checkPermission('benefits', 'create'), subscriptionGuard('benefits_insurance'), (req, res, next) => {
  // Map reimbursement fields to benefit claim fields
  if (req.body.title) req.body.type = req.body.title;
  if (req.body.category && !req.body.type) req.body.type = req.body.category;
  submitBenefitClaim(req, res, next);
});
router.get('/tasks', checkPermission('dashboard', 'view'), getTasks);


// Support Help Desk
router.get('/tickets', checkPermission('help_desk', 'view'), subscriptionGuard('support_tickets'), getTickets);
router.post('/tickets', checkPermission('help_desk', 'create'), subscriptionGuard('support_tickets'), createTicket);
router.post('/tickets/:id/reply', checkPermission('help_desk', 'create'), subscriptionGuard('support_tickets'), replyTicket);
router.patch('/tickets/:id/status', checkPermission('help_desk', 'create'), subscriptionGuard('support_tickets'), updateTicketStatus);
router.delete('/tickets/:id/messages/:msgId', checkPermission('help_desk', 'delete'), subscriptionGuard('support_tickets'), deleteTicketMessage);

// Holidays & Announcements
router.get('/holidays', checkPermission('dashboard', 'view'), getHolidays);
router.get('/announcements', checkPermission('dashboard', 'view'), getAnnouncements);

const multer = require('multer');
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// Documents
router.get('/documents', checkPermission('documents', 'view'), subscriptionGuard('documents_vault'), getDocuments);
router.post('/documents', checkPermission('documents', 'create'), subscriptionGuard('documents_vault'), docUpload.single('file'), uploadDocument);
router.delete('/documents/:id', checkPermission('documents', 'delete'), subscriptionGuard('documents_vault'), deleteDocument);

// Documents – extra endpoints
router.get('/documents/dashboard', checkPermission('documents', 'view'), subscriptionGuard('documents_vault'), async (req, res, next) => {
  try {
    const docs = await require('../config/prisma').document.findMany({ where: { userId: req.user.userId } });
    const totalFiles = docs.length;
    // Sum all stored size strings like "1.2 MB" or "345 KB"
    let storageMB = 0;
    docs.forEach(d => {
      const s = (d.size || '').toString().trim();
      const match = s.match(/([\d.]+)\s*(MB|KB|GB)/i);
      if (match) {
        const n = parseFloat(match[1]);
        if (match[2].toUpperCase() === 'GB') storageMB += n * 1024;
        else if (match[2].toUpperCase() === 'KB') storageMB += n / 1024;
        else storageMB += n;
      }
    });
    const storageUsed = storageMB >= 1024
      ? `${(storageMB / 1024).toFixed(2)} GB`
      : `${storageMB.toFixed(1)} MB`;

    const verifiedDocuments = docs.filter(d => d.verified !== false).length;
    return res.json({
      success: true,
      data: { totalFiles, storageUsed, verifiedDocuments, retrievalStatus: 'Ready' }
    });
  } catch (err) { next(err); }
});

router.get('/document-categories', checkPermission('documents', 'view'), subscriptionGuard('documents_vault'), async (req, res, next) => {
  try {
    const docs = await require('../config/prisma').document.findMany({ where: { userId: req.user.userId }, select: { category: true } });
    const ALL_CATEGORIES = ['Identity Documents', 'Education', 'Employment', 'Certificates', 'Contracts', 'Tax Documents', 'Other'];
    const countMap = {};
    docs.forEach(d => { const cat = d.category || 'Other'; countMap[cat] = (countMap[cat] || 0) + 1; });
    const categories = ALL_CATEGORIES.map(name => ({ name, count: countMap[name] || 0 }));
    return res.json({ success: true, data: categories });
  } catch (err) { next(err); }
});

router.get('/documents/:id/download', checkPermission('documents', 'view'), subscriptionGuard('documents_vault'), async (req, res, next) => {
  try {
    const prisma = require('../config/prisma');
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    if (doc.userId !== req.user.userId) return res.status(403).json({ success: false, error: { message: 'Unauthorized' } });
    // Return signed URL / redirect
    const url = doc.url || doc.fileUrl || doc.secureUrl;
    if (!url) return res.status(404).json({ success: false, error: { message: 'File URL not available' } });
    return res.redirect(url);
  } catch (err) { next(err); }
});



// Compliance Policies
router.get('/policies', checkPermission('compliance', 'view'), subscriptionGuard('audit_compliance'), getPolicies);
router.post('/policies/:id/acknowledge', checkPermission('compliance', 'create'), subscriptionGuard('audit_compliance'), acknowledgePolicy);
router.post('/policies/:id/accept', checkPermission('compliance', 'create'), subscriptionGuard('audit_compliance'), acknowledgePolicy);

// AI Features
const {
  aiBuildResume,
  aiPolicyAssistant,
  aiPayrollInsights,
  aiDocumentAnalyze,
  aiGenerateLetter
} = require('../controllers/aiController');
const fileUpload = require('../middlewares/fileUpload');

router.post('/ai/resume-builder', subscriptionGuard('ai_resume_scoring'), aiBuildResume);
router.post('/ai/policy-assistant', subscriptionGuard('ai_resume_scoring'), aiPolicyAssistant);
router.post('/ai/payroll-insights', subscriptionGuard('ai_resume_scoring'), aiPayrollInsights);
router.post('/ai/document-analyze', subscriptionGuard('ai_resume_scoring'), fileUpload.single('file'), aiDocumentAnalyze);
router.post('/ai/generate-letter', subscriptionGuard('ai_resume_scoring'), aiGenerateLetter);

module.exports = router;
