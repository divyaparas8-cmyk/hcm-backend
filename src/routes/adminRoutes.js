// ============================================================
// Admin Routes  →  /api/admin/*
// ============================================================
const express = require('express');
const router = express.Router();
const { protect, tenantGuard, authorize } = require('../middlewares/authMiddleware');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { checkPermission } = require('../middlewares/permissionMiddleware');

const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const {
  getDashboardStats,
  getOrganization, createOrganization, updateOrganization,
  updateOrganizationLogo, deleteOrganizationLogo,
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  getAllUsers, createUser, updateUser, changeUserRole, revokeUserRole, toggleUserActive, deleteUser,
  getAllPayslips, generatePayslip, markPayslipPaid,
  getAuditLogs,
  getPolicies, createPolicy, updatePolicy, deletePolicy, toggleArchivePolicy, renewPolicy, sendPolicyReminder,
  getRoles, createRole, updateRole, deleteRole, getRoleHistory,
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
  getBenefitPlans, createBenefitPlan, updateBenefitPlan, deleteBenefitPlan,
  getAiModules, updateAiModule, getAiLogs, createAiLog,
  getIntegrations, createIntegration, updateIntegration, deleteIntegration,
  getBillingPlan, updateBillingPlan, getInvoices, createInvoice, updateInvoice, deleteInvoice, exportInvoices,
  getAllAttendance, addManualAttendance, getAllLeaves, reviewLeave,
  getAdminResignations, overrideResignation
} = require('../controllers/adminController');

const {
  getSalaryComponents, createSalaryComponent, updateSalaryComponent, deleteSalaryComponent,
  getDeductions,
  createDeduction,
  deleteDeduction,
  getTaxRules, createTaxRule,
  deleteTaxRule,
  getWorkflows, createWorkflow
} = require('../controllers/payrollConfigController');

const {
  getShifts, createShift, updateShift, deleteShift
} = require('../controllers/shiftController');

const {
  getOvertimePolicies, createOvertimePolicy, updateOvertimePolicy, deleteOvertimePolicy
} = require('../controllers/overtimePolicyController');

const { getOrgChart } = require('../controllers/orgChartController');

// Base authentication & platform role check
router.use(protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'));

// Dashboard Stats
router.get('/stats', checkPermission('dashboard', 'view'), getDashboardStats);

// Organization / Org Setup
router.get('/organization', checkPermission('org_setup', 'view'), getOrganization);
router.post('/organization', checkPermission('org_setup', 'create'), createOrganization);
router.put('/organization/:id', checkPermission('org_setup', 'edit'), updateOrganization);
router.patch('/organization/logo', checkPermission('org_setup', 'edit'), upload.any(), updateOrganizationLogo);
router.post('/organization/logo', checkPermission('org_setup', 'edit'), upload.any(), updateOrganizationLogo);
router.delete('/organization/logo', checkPermission('org_setup', 'edit'), deleteOrganizationLogo);
router.post('/organizations/:id/complete-setup', checkPermission('org_setup', 'edit'), (req, res) => res.status(200).json({ success: true, message: 'Setup marked complete' }));

// Departments
router.get('/departments', checkPermission('departments', 'view'), getDepartments);
router.post('/departments', checkPermission('departments', 'create'), createDepartment);
router.put('/departments/:id', checkPermission('departments', 'edit'), updateDepartment);
router.delete('/departments/:id', checkPermission('departments', 'delete'), deleteDepartment);

// Organization Chart
router.get('/org-chart', checkPermission('departments', 'view'), getOrgChart);

// Users
router.get('/users', checkPermission('users', 'view'), getAllUsers);
router.post('/users', checkPermission('users', 'create'), subscriptionGuard('ADD_EMPLOYEE'), createUser);
router.put('/users/:id', checkPermission('users', 'edit'), updateUser);
router.patch('/users/:id/role', checkPermission('users', 'edit'), changeUserRole);
router.post('/users/:id/revoke-role', checkPermission('users', 'edit'), revokeUserRole);
router.patch('/users/:id/toggle-active', checkPermission('users', 'edit'), toggleUserActive);
router.delete('/users/:id', checkPermission('users', 'delete'), deleteUser);

// Payroll Center & Payslips
router.get('/payslips', checkPermission('payroll_center', 'view'), getAllPayslips);
router.post('/payslips', checkPermission('payroll_center', 'create'), generatePayslip);
router.patch('/payslips/:id/pay', checkPermission('payroll_center', 'approve'), markPayslipPaid);

// Payroll Configuration
router.get('/payroll-config/components', checkPermission('payroll_center', 'view'), getSalaryComponents);
router.post('/payroll-config/components', checkPermission('payroll_center', 'create'), createSalaryComponent);
router.put('/payroll-config/components/:id', checkPermission('payroll_center', 'edit'), updateSalaryComponent);
router.delete('/payroll-config/components/:id', checkPermission('payroll_center', 'delete'), deleteSalaryComponent);

router.get('/payroll-config/deductions', checkPermission('payroll_center', 'view'), getDeductions);
router.post('/payroll-config/deductions', checkPermission('payroll_center', 'create'), createDeduction);
router.delete('/payroll-config/deductions/:id', checkPermission('payroll_center', 'delete'), deleteDeduction);

router.get('/payroll-config/taxes', checkPermission('payroll_center', 'view'), getTaxRules);
router.post('/payroll-config/taxes', checkPermission('payroll_center', 'create'), createTaxRule);
router.delete('/payroll-config/taxes/:id', checkPermission('payroll_center', 'delete'), deleteTaxRule);

// Approval Workflows
router.get('/workflows', checkPermission('approval_workflows', 'view'), getWorkflows);
router.post('/workflows', checkPermission('approval_workflows', 'create'), createWorkflow);

// Audit Logs
router.get('/audit-logs', checkPermission('audit_logs', 'view'), getAuditLogs);

// Compliance Policies
router.get('/policies', checkPermission('compliance', 'view'), getPolicies);
router.post('/policies', checkPermission('compliance', 'create'), createPolicy);
router.put('/policies/:id', checkPermission('compliance', 'edit'), updatePolicy);
router.delete('/policies/:id', checkPermission('compliance', 'delete'), deletePolicy);
router.patch('/policies/:id/archive', checkPermission('compliance', 'edit'), toggleArchivePolicy);
router.post('/policies/:id/renew', checkPermission('compliance', 'create'), renewPolicy);
router.post('/policies/:id/remind', checkPermission('compliance', 'edit'), sendPolicyReminder);

// Roles & Permissions Matrix Management
router.get('/roles', checkPermission('roles_permissions', 'view'), getRoles);
router.get('/roles/history', checkPermission('roles_permissions', 'view'), getRoleHistory);
router.post('/roles', checkPermission('roles_permissions', 'create'), createRole);
router.put('/roles/:id', checkPermission('roles_permissions', 'edit'), updateRole);
router.delete('/roles/:id', checkPermission('roles_permissions', 'delete'), deleteRole);

// Holidays
router.get('/holidays', checkPermission('holidays', 'view'), getHolidays);
router.post('/holidays', checkPermission('holidays', 'create'), createHoliday);
router.put('/holidays/:id', checkPermission('holidays', 'edit'), updateHoliday);
router.delete('/holidays/:id', checkPermission('holidays', 'delete'), deleteHoliday);

// Benefit Plans
router.get('/benefits', checkPermission('benefits_config', 'view'), getBenefitPlans);
router.post('/benefits', checkPermission('benefits_config', 'create'), createBenefitPlan);
router.put('/benefits/:id', checkPermission('benefits_config', 'edit'), updateBenefitPlan);
router.delete('/benefits/:id', checkPermission('benefits_config', 'delete'), deleteBenefitPlan);

// AI Center
router.get('/ai/modules', checkPermission('ai_center', 'view'), getAiModules);
router.put('/ai/modules/:id', checkPermission('ai_center', 'edit'), updateAiModule);
router.get('/ai/logs', checkPermission('ai_center', 'view'), getAiLogs);
router.post('/ai/logs', checkPermission('ai_center', 'create'), createAiLog);

// System Integrations
router.get('/integrations', checkPermission('integrations', 'view'), getIntegrations);
router.post('/integrations', checkPermission('integrations', 'create'), createIntegration);
router.put('/integrations/:id', checkPermission('integrations', 'edit'), updateIntegration);
router.delete('/integrations/:id', checkPermission('integrations', 'delete'), deleteIntegration);

// Billing & Invoices
router.get('/billing/plan', checkPermission('billing', 'view'), getBillingPlan);
router.put('/billing/plan/:id', checkPermission('billing', 'edit'), updateBillingPlan);
router.get('/billing/invoices', checkPermission('billing', 'view'), getInvoices);
router.post('/billing/invoices', checkPermission('billing', 'create'), createInvoice);
router.put('/billing/invoices/:id', checkPermission('billing', 'edit'), updateInvoice);
router.delete('/billing/invoices/:id', checkPermission('billing', 'delete'), deleteInvoice);
router.get('/billing/invoices/export', checkPermission('billing', 'view'), exportInvoices);

// Attendance & Leaves
router.get('/attendance', checkPermission('dashboard', 'view'), getAllAttendance);
router.post('/attendance', checkPermission('dashboard', 'create'), addManualAttendance);
router.get('/leaves', checkPermission('dashboard', 'view'), getAllLeaves);
router.patch('/leaves/:id', checkPermission('dashboard', 'approve'), reviewLeave);

// Resignations
router.get('/resignations', checkPermission('resignations', 'view'), getAdminResignations);
router.patch('/resignations/:id/override', checkPermission('resignations', 'approve'), overrideResignation);

// Shifts
router.get('/shifts', checkPermission('shift_management', 'view'), getShifts);
router.post('/shifts', checkPermission('shift_management', 'create'), createShift);
router.put('/shifts/:id', checkPermission('shift_management', 'edit'), updateShift);
router.delete('/shifts/:id', checkPermission('shift_management', 'delete'), deleteShift);

// Overtime Policies
router.get('/overtime-policies', checkPermission('overtime_rules', 'view'), getOvertimePolicies);
router.post('/overtime-policies', checkPermission('overtime_rules', 'create'), createOvertimePolicy);
router.put('/overtime-policies/:id', checkPermission('overtime_rules', 'edit'), updateOvertimePolicy);
router.delete('/overtime-policies/:id', checkPermission('overtime_rules', 'delete'), deleteOvertimePolicy);

// Holidays
router.get('/holidays', checkPermission('holidays', 'view'), getHolidays);
router.post('/holidays', checkPermission('holidays', 'create'), createHoliday);
router.put('/holidays/:id', checkPermission('holidays', 'edit'), updateHoliday);
router.delete('/holidays/:id', checkPermission('holidays', 'delete'), deleteHoliday);

// Benefit Plans
router.get('/benefits', checkPermission('benefits_config', 'view'), getBenefitPlans);
router.post('/benefits', checkPermission('benefits_config', 'create'), createBenefitPlan);
router.put('/benefits/:id', checkPermission('benefits_config', 'edit'), updateBenefitPlan);
router.delete('/benefits/:id', checkPermission('benefits_config', 'delete'), deleteBenefitPlan);

module.exports = router;
