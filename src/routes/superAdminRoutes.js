// ============================================================
// SuperAdmin Routes  →  /api/superadmin/*
// ============================================================
// SIRF SUPERADMIN access kar sakta hai inhe
// Admin, HR, Manager, Employee - KISI ko bhi access nahi

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');

const {
  getPlatformStats,
  getAllOrganizations, getOrganizationDetails, provisionOrganization, suspendOrganization, activateOrganization, createOrganization, deleteOrganization, updateOrgSubscription,
  getAllPlatformUsers, createAdminForOrg,
  toggleAnyUserActive, changeAnyUserRole, revokeAnyUserRole,
  getPlatformAuditLogs,
  getSystemHealth,
  getAnalytics,
  getAnalyticsExport,
  createUser, updateUser, deleteUser,
  getAllPlatformDepartments, createPlatformDepartment, updatePlatformDepartment, deletePlatformDepartment,
  getPayrollHistory, getPayrollSettings, updatePayrollSettings,
  createPayslip, updatePayslip, deletePayslip, bulkApprovePayslips, generatePayroll, resetUserPassword,
  getSystemSettings, updateSystemSettings,
  getGlobalUsage, getPlatformFeatures, updatePlatformFeatures
} = require('../controllers/superAdminController');

// 🔒 STRICT: Sirf SUPERADMIN
router.use(protect, authorize('SUPERADMIN'));

// Platform Overview
router.get('/stats', getPlatformStats);     // GET  /api/superadmin/stats
router.get('/system-health', getSystemHealth);      // GET  /api/superadmin/system-health
router.get('/analytics', getAnalytics);         // GET  /api/superadmin/analytics
router.get('/analytics/export', getAnalyticsExport); // GET /api/superadmin/analytics/export
router.get('/usage', getGlobalUsage);           // GET /api/superadmin/usage
router.get('/features', getPlatformFeatures);   // GET /api/superadmin/features
router.put('/features', updatePlatformFeatures); // PUT /api/superadmin/features

// Settings & Config
router.get('/settings', getSystemSettings);
router.put('/settings', updateSystemSettings);

// Organizations (multi-tenant management)
router.get('/organizations', getAllOrganizations);   // GET  /api/superadmin/organizations
router.get('/organizations/:id', getOrganizationDetails); // GET /api/superadmin/organizations/:id
router.post('/organizations', createOrganization);   // POST /api/superadmin/organizations
router.post('/organizations/provision', provisionOrganization); // POST /api/superadmin/organizations/provision
router.patch('/organizations/:id/suspend', suspendOrganization); // PATCH /api/superadmin/organizations/:id/suspend
router.patch('/organizations/:id/activate', activateOrganization); // PATCH /api/superadmin/organizations/:id/activate
router.put('/organizations/:id/subscription', updateOrgSubscription); // PUT /api/superadmin/organizations/:id/subscription
router.delete('/organizations/:id', deleteOrganization);   // DEL  /api/superadmin/organizations/:id
router.post('/organizations/:orgId/create-admin', createAdminForOrg); // POST /api/superadmin/organizations/:orgId/create-admin

// Departments
router.get('/departments', getAllPlatformDepartments);
router.post('/departments', createPlatformDepartment);
router.put('/departments/:id', updatePlatformDepartment);
router.delete('/departments/:id', deletePlatformDepartment);

// Users (platform-wide)
router.get('/users', getAllPlatformUsers);    // GET  /api/superadmin/users
router.post('/users', createUser);             // POST /api/superadmin/users
router.put('/users/:id', updateUser);             // PUT  /api/superadmin/users/:id
router.delete('/users/:id', deleteUser);             // DEL  /api/superadmin/users/:id
router.patch('/users/:id/role', changeAnyUserRole);      // PATCH /api/superadmin/users/:id/role
router.post('/users/:id/revoke-role', revokeAnyUserRole); // POST /api/superadmin/users/:id/revoke-role
router.patch('/users/:id/toggle-active', toggleAnyUserActive);   // PATCH /api/superadmin/users/:id/toggle-active
router.post('/users/:id/reset-password', resetUserPassword);   // POST /api/superadmin/users/:id/reset-password

// Audit Logs (all orgs)
router.get('/audit-logs', getPlatformAuditLogs);   // GET  /api/superadmin/audit-logs

// Payroll
router.get('/payroll', getPayrollHistory);
router.get('/payroll/settings', getPayrollSettings);
router.put('/payroll/settings', updatePayrollSettings);
router.post('/payroll', createPayslip);
router.post('/payroll/generate', generatePayroll);
router.put('/payroll/:id', updatePayslip);
router.delete('/payroll/:id', deletePayslip);
router.patch('/payroll/bulk-approve', bulkApprovePayslips);

// AI Features
const { aiAnalytics } = require('../controllers/aiController');
router.post('/ai/analytics', aiAnalytics);

module.exports = router;
