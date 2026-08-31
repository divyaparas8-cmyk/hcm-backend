// ============================================================
// Manager Routes  →  /api/manager/*
// ============================================================
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');

const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { checkPermission } = require('../middlewares/permissionMiddleware');

const {
  getManagerDashboard,
  getTeam, addTeamMember,
  getTeamLeaves, reviewLeave,
  assignTask, getTeamTasks, updateTask,
  getTeamPerformance, addPerformanceGoal, updatePerformanceGoal,
  getTeamAttendance, addManualAttendance,
  getOrgEmployees, addTeamLeaveRequest,
  getTeamReviews, createTeamReview, updateTeamReview,
  getIncrementRequests, approveIncrementRequest, rejectIncrementRequest,
  getResignations, reviewResignation,
  getManagerReimbursements, reviewManagerReimbursement,
  requestSalaryIncrement
} = require('../controllers/managerController');

// Base authentication & platform role check
router.use(protect, authorize('MANAGER', 'ADMIN', 'SUPERADMIN'));

// Dashboard
router.get('/dashboard', checkPermission('team_members', 'view'), getManagerDashboard);

// Team Members
router.get('/team', checkPermission('team_members', 'view'), getTeam);
router.post('/team', checkPermission('team_members', 'create'), addTeamMember);
router.get('/org-employees', checkPermission('team_members', 'view'), getOrgEmployees);

// Attendance Review
router.get('/attendance', checkPermission('attendance_review', 'view'), getTeamAttendance);
router.post('/attendance', checkPermission('attendance_review', 'create'), addManualAttendance);

// Leave Approval
router.get('/leaves', checkPermission('leave_approval', 'view'), getTeamLeaves);
router.post('/leaves', checkPermission('leave_approval', 'create'), addTeamLeaveRequest);
router.patch('/leaves/:id', checkPermission('leave_approval', 'approve'), reviewLeave);

// Tasks
router.get('/tasks', checkPermission('tasks', 'view'), getTeamTasks);
router.post('/tasks', checkPermission('tasks', 'create'), assignTask);
router.patch('/tasks/:id', checkPermission('tasks', 'edit'), updateTask);

// KPI Tracking & Performance
router.get('/performance', checkPermission('kpi_tracking', 'view'), getTeamPerformance);
router.post('/performance', checkPermission('kpi_tracking', 'create'), addPerformanceGoal);
router.patch('/performance/:id', checkPermission('kpi_tracking', 'edit'), updatePerformanceGoal);

// Reviews
router.get('/reviews', checkPermission('reviews', 'view'), getTeamReviews);
router.post('/reviews', checkPermission('reviews', 'create'), createTeamReview);
router.patch('/reviews/:id', checkPermission('reviews', 'edit'), updateTeamReview);

// Salary Increments
router.post('/increments', checkPermission('reviews', 'create'), requestSalaryIncrement);
router.get('/increments', checkPermission('reviews', 'view'), getIncrementRequests);
router.patch('/increments/:id/approve', checkPermission('reviews', 'approve'), approveIncrementRequest);
router.patch('/increments/:id/reject', checkPermission('reviews', 'approve'), rejectIncrementRequest);

// Team Resignations
router.get('/resignations', checkPermission('team_resignations', 'view'), getResignations);
router.patch('/resignations/:id', checkPermission('team_resignations', 'approve'), reviewResignation);

// Reimbursements
router.get('/reimbursements', checkPermission('reimbursements', 'view'), getManagerReimbursements);
router.patch('/reimbursements/:id/review', checkPermission('reimbursements', 'approve'), reviewManagerReimbursement);

// AI Features
const {
  aiAttendanceInsights,
  aiLeaveRecommendations,
  aiPerformanceSummaries
} = require('../controllers/aiController');

router.get('/ai/attendance-insights', checkPermission('attendance_review', 'view'), aiAttendanceInsights);
router.post('/ai/leave-recommendations', checkPermission('leave_approval', 'view'), aiLeaveRecommendations);
router.post('/ai/performance-summaries', checkPermission('reviews', 'view'), aiPerformanceSummaries);

module.exports = router;
