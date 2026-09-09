// ============================================================
// Manager Routes  →  /api/manager/*
// ============================================================
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');

const tenantGuard = require('../middlewares/tenantGuard');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { checkPermission } = require('../middlewares/permissionMiddleware');

const {
  getManagerDashboard,
  getTeam, addTeamMember,
  getTeamLeaves, reviewLeave,
  assignTask, getTeamTasks, updateTask, deleteTask,
  getTeamPerformance, addPerformanceGoal, updatePerformanceGoal, deletePerformanceGoal,
  getTeamAttendance, addManualAttendance,
  getOrgEmployees, addTeamLeaveRequest,
  getTeamReviews, createTeamReview, updateTeamReview, deleteTeamReview,
  getIncrementRequests, approveIncrementRequest, rejectIncrementRequest,
  getResignations, reviewResignation,
  getManagerReimbursements, reviewManagerReimbursement,
  requestSalaryIncrement
} = require('../controllers/managerController');

// Base authentication & platform role check
router.use(protect, tenantGuard, authorize('MANAGER', 'ADMIN', 'SUPERADMIN'));

// Dashboard
router.get('/dashboard', checkPermission('team_members', 'view'), getManagerDashboard);

// Team Members
router.get('/team', checkPermission('team_members', 'view'), getTeam);
router.post('/team', checkPermission('team_members', 'create'), addTeamMember);
router.get('/org-employees', checkPermission('team_members', 'view'), getOrgEmployees);

// Attendance Review
router.get('/attendance', checkPermission('attendance_review', 'view'), subscriptionGuard('attendance_leave'), getTeamAttendance);
router.post('/attendance', checkPermission('attendance_review', 'create'), subscriptionGuard('attendance_leave'), addManualAttendance);

// Leave Approval
router.get('/leaves', checkPermission('leave_approval', 'view'), subscriptionGuard('attendance_leave'), getTeamLeaves);
router.post('/leaves', checkPermission('leave_approval', 'create'), subscriptionGuard('attendance_leave'), addTeamLeaveRequest);
router.patch('/leaves/:id', checkPermission('leave_approval', 'approve'), subscriptionGuard('attendance_leave'), reviewLeave);

// Tasks
router.get('/tasks', checkPermission('tasks', 'view'), getTeamTasks);
router.post('/tasks', checkPermission('tasks', 'create'), assignTask);
router.patch('/tasks/:id', checkPermission('tasks', 'edit'), updateTask);
router.delete('/tasks/:id', checkPermission('tasks', 'delete'), deleteTask);


// KPI Tracking & Performance
router.get('/performance', checkPermission('kpi_tracking', 'view'), subscriptionGuard('performance_kpi'), getTeamPerformance);
router.post('/performance', checkPermission('kpi_tracking', 'create'), subscriptionGuard('performance_kpi'), addPerformanceGoal);
router.patch('/performance/:id', checkPermission('kpi_tracking', 'edit'), subscriptionGuard('performance_kpi'), updatePerformanceGoal);
router.delete('/performance/:id', checkPermission('kpi_tracking', 'edit'), subscriptionGuard('performance_kpi'), deletePerformanceGoal);

// Reviews
router.get('/reviews', checkPermission('reviews', 'view'), subscriptionGuard('performance_kpi'), getTeamReviews);
router.post('/reviews', checkPermission('reviews', 'create'), subscriptionGuard('performance_kpi'), createTeamReview);
router.patch('/reviews/:id', checkPermission('reviews', 'edit'), subscriptionGuard('performance_kpi'), updateTeamReview);
router.delete('/reviews/:id', checkPermission('reviews', 'edit'), subscriptionGuard('performance_kpi'), deleteTeamReview);


// Salary Increments
router.post('/increments', checkPermission('reviews', 'create'), subscriptionGuard('payroll_operations'), requestSalaryIncrement);
router.get('/increments', checkPermission('reviews', 'view'), subscriptionGuard('payroll_operations'), getIncrementRequests);
router.patch('/increments/:id/approve', checkPermission('reviews', 'approve'), subscriptionGuard('payroll_operations'), approveIncrementRequest);
router.patch('/increments/:id/reject', checkPermission('reviews', 'approve'), subscriptionGuard('payroll_operations'), rejectIncrementRequest);

// Team Resignations
router.get('/resignations', checkPermission('team_resignations', 'view'), subscriptionGuard('offboarding_exit'), getResignations);
router.patch('/resignations/:id', checkPermission('team_resignations', 'approve'), subscriptionGuard('offboarding_exit'), reviewResignation);

// Reimbursements
router.get('/reimbursements', checkPermission('reimbursements', 'view'), getManagerReimbursements);
router.patch('/reimbursements/:id/review', checkPermission('reimbursements', 'approve'), reviewManagerReimbursement);

// AI Features
const {
  aiAttendanceInsights,
  aiLeaveRecommendations,
  aiPerformanceSummaries
} = require('../controllers/aiController');

router.get('/ai/attendance-insights', checkPermission('attendance_review', 'view'), subscriptionGuard('ai_resume_scoring'), aiAttendanceInsights);
router.post('/ai/leave-recommendations', checkPermission('leave_approval', 'view'), subscriptionGuard('ai_resume_scoring'), aiLeaveRecommendations);
router.post('/ai/performance-summaries', checkPermission('reviews', 'view'), subscriptionGuard('ai_resume_scoring'), aiPerformanceSummaries);

module.exports = router;
