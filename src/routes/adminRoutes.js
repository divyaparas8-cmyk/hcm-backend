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
  getPolicies, createPolicy, updatePolicy, deletePolicy, toggleArchivePolicy, renewPolicy, sendPolicyReminder, resolvePolicy,
  getRoles, createRole, updateRole, deleteRole, getRoleHistory,
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
  getBenefitPlans, createBenefitPlan, updateBenefitPlan, deleteBenefitPlan,
  getAiModules, updateAiModule, getAiLogs, createAiLog,
  getIntegrations, createIntegration, updateIntegration, deleteIntegration,
  getBillingPlan, updateBillingPlan, getInvoices, createInvoice, updateInvoice, deleteInvoice, exportInvoices,
  getPaymentMethod, savePaymentMethod,
  getAllAttendance, addManualAttendance, updateAttendance, deleteAttendance, getAllLeaves, reviewLeave,
  getAdminResignations, overrideResignation
} = require('../controllers/adminController');

const {
  getGeneratedReports, createGeneratedReport, deleteGeneratedReport, getReportData
} = require('../controllers/reportsAdminController');

const {
  getSalaryStructures, createSalaryStructure, updateSalaryStructure, deleteSalaryStructure, setDefaultSalaryStructure,
  getSalaryComponents, createSalaryComponent, updateSalaryComponent, deleteSalaryComponent,
  getDeductions, createDeduction, updateDeduction, deleteDeduction,
  getTaxRules, createTaxRule, updateTaxRule, deleteTaxRule,
  getWorkflows, createWorkflow
} = require('../controllers/payrollConfigController');

const {
  getShifts, createShift, updateShift, deleteShift
} = require('../controllers/shiftController');

const {
  getOvertimePolicies, createOvertimePolicy, updateOvertimePolicy, deleteOvertimePolicy
} = require('../controllers/overtimePolicyController');

const { getOrgChart } = require('../controllers/orgChartController');
const {
  getAdminSettings,
  updateAdminSettings,
  resetAdminSettings
} = require('../controllers/adminSettingsController');

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

// System Settings (Tenant-Isolated)
router.get('/settings', checkPermission('settings', 'view'), getAdminSettings);
router.put('/settings', checkPermission('settings', 'edit'), updateAdminSettings);
router.post('/settings/reset', checkPermission('settings', 'edit'), resetAdminSettings);

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
router.get('/payslips', checkPermission('payroll_center', 'view'), subscriptionGuard('payroll_operations'), getAllPayslips);
router.post('/payslips', checkPermission('payroll_center', 'create'), subscriptionGuard('payroll_operations'), generatePayslip);
router.patch('/payslips/:id/pay', checkPermission('payroll_center', 'approve'), subscriptionGuard('payroll_operations'), markPayslipPaid);

// Salary Structures
router.get('/salary-structures', checkPermission('payroll_center', 'view'), subscriptionGuard('payroll_operations'), getSalaryStructures);
router.post('/salary-structures', checkPermission('payroll_center', 'create'), subscriptionGuard('payroll_operations'), createSalaryStructure);
router.put('/salary-structures/:id', checkPermission('payroll_center', 'edit'), subscriptionGuard('payroll_operations'), updateSalaryStructure);
router.delete('/salary-structures/:id', checkPermission('payroll_center', 'delete'), subscriptionGuard('payroll_operations'), deleteSalaryStructure);
router.patch('/salary-structures/:id/default', checkPermission('payroll_center', 'edit'), subscriptionGuard('payroll_operations'), setDefaultSalaryStructure);

// Payroll Configuration
router.get('/payroll-config/components', checkPermission('payroll_center', 'view'), subscriptionGuard('payroll_operations'), getSalaryComponents);
router.post('/payroll-config/components', checkPermission('payroll_center', 'create'), subscriptionGuard('payroll_operations'), createSalaryComponent);
router.put('/payroll-config/components/:id', checkPermission('payroll_center', 'edit'), subscriptionGuard('payroll_operations'), updateSalaryComponent);
router.delete('/payroll-config/components/:id', checkPermission('payroll_center', 'delete'), subscriptionGuard('payroll_operations'), deleteSalaryComponent);

router.get('/payroll-config/deductions', checkPermission('payroll_center', 'view'), subscriptionGuard('payroll_operations'), getDeductions);
router.post('/payroll-config/deductions', checkPermission('payroll_center', 'create'), subscriptionGuard('payroll_operations'), createDeduction);
router.put('/payroll-config/deductions/:id', checkPermission('payroll_center', 'edit'), subscriptionGuard('payroll_operations'), updateDeduction);
router.delete('/payroll-config/deductions/:id', checkPermission('payroll_center', 'delete'), subscriptionGuard('payroll_operations'), deleteDeduction);

router.get('/payroll-config/taxes', checkPermission('payroll_center', 'view'), subscriptionGuard('payroll_operations'), getTaxRules);
router.post('/payroll-config/taxes', checkPermission('payroll_center', 'create'), subscriptionGuard('payroll_operations'), createTaxRule);
router.put('/payroll-config/taxes/:id', checkPermission('payroll_center', 'edit'), subscriptionGuard('payroll_operations'), updateTaxRule);
router.delete('/payroll-config/taxes/:id', checkPermission('payroll_center', 'delete'), subscriptionGuard('payroll_operations'), deleteTaxRule);

// Approval Workflows
router.get('/workflows', checkPermission('approval_workflows', 'view'), subscriptionGuard('approval_workflows'), getWorkflows);
router.post('/workflows', checkPermission('approval_workflows', 'create'), subscriptionGuard('approval_workflows'), createWorkflow);

// Audit Logs
router.get('/audit-logs', checkPermission('audit_logs', 'view'), subscriptionGuard('audit_compliance'), getAuditLogs);

// Compliance Policies
router.get('/policies', checkPermission('compliance', 'view'), subscriptionGuard('audit_compliance'), getPolicies);
router.post('/policies', checkPermission('compliance', 'create'), subscriptionGuard('audit_compliance'), createPolicy);
router.put('/policies/:id', checkPermission('compliance', 'edit'), subscriptionGuard('audit_compliance'), updatePolicy);
router.delete('/policies/:id', checkPermission('compliance', 'delete'), subscriptionGuard('audit_compliance'), deletePolicy);
router.patch('/policies/:id/archive', checkPermission('compliance', 'edit'), subscriptionGuard('audit_compliance'), toggleArchivePolicy);
router.post('/policies/:id/renew', checkPermission('compliance', 'create'), subscriptionGuard('audit_compliance'), renewPolicy);
router.post('/policies/:id/remind', checkPermission('compliance', 'edit'), subscriptionGuard('audit_compliance'), sendPolicyReminder);
router.patch('/policies/:id/resolve', checkPermission('compliance', 'edit'), subscriptionGuard('audit_compliance'), resolvePolicy);

// Roles & Permissions Matrix Management
router.get('/roles', checkPermission('roles_permissions', 'view'), getRoles);
router.get('/roles/history', checkPermission('roles_permissions', 'view'), getRoleHistory);
router.post('/roles', checkPermission('roles_permissions', 'create'), createRole);
router.put('/roles/:id', checkPermission('roles_permissions', 'edit'), updateRole);
router.delete('/roles/:id', checkPermission('roles_permissions', 'delete'), deleteRole);

// Holidays
router.get('/holidays', checkPermission('holidays', 'view'), subscriptionGuard('shifts_calendars'), getHolidays);
router.post('/holidays', checkPermission('holidays', 'create'), subscriptionGuard('shifts_calendars'), createHoliday);
router.put('/holidays/:id', checkPermission('holidays', 'edit'), subscriptionGuard('shifts_calendars'), updateHoliday);
router.delete('/holidays/:id', checkPermission('holidays', 'delete'), subscriptionGuard('shifts_calendars'), deleteHoliday);

// Benefit Plans
router.get('/benefits', checkPermission('benefits_config', 'view'), subscriptionGuard('benefits_insurance'), getBenefitPlans);
router.post('/benefits', checkPermission('benefits_config', 'create'), subscriptionGuard('benefits_insurance'), createBenefitPlan);
router.put('/benefits/:id', checkPermission('benefits_config', 'edit'), subscriptionGuard('benefits_insurance'), updateBenefitPlan);
router.delete('/benefits/:id', checkPermission('benefits_config', 'delete'), subscriptionGuard('benefits_insurance'), deleteBenefitPlan);

// Shift Management
router.get('/shifts', checkPermission('shift_management', 'view'), subscriptionGuard('shifts_calendars'), getShifts);
router.post('/shifts', checkPermission('shift_management', 'create'), subscriptionGuard('shifts_calendars'), createShift);
router.put('/shifts/:id', checkPermission('shift_management', 'edit'), subscriptionGuard('shifts_calendars'), updateShift);
router.delete('/shifts/:id', checkPermission('shift_management', 'delete'), subscriptionGuard('shifts_calendars'), deleteShift);

// Overtime Policies
router.get('/overtime-policies', checkPermission('overtime_rules', 'view'), subscriptionGuard('shifts_calendars'), getOvertimePolicies);
router.post('/overtime-policies', checkPermission('overtime_rules', 'create'), subscriptionGuard('shifts_calendars'), createOvertimePolicy);
router.put('/overtime-policies/:id', checkPermission('overtime_rules', 'edit'), subscriptionGuard('shifts_calendars'), updateOvertimePolicy);
router.delete('/overtime-policies/:id', checkPermission('overtime_rules', 'delete'), subscriptionGuard('shifts_calendars'), deleteOvertimePolicy);

// AI Center
router.get('/ai/modules', checkPermission('ai_center', 'view'), subscriptionGuard('ai_resume_scoring'), getAiModules);
router.put('/ai/modules/:id', checkPermission('ai_center', 'edit'), subscriptionGuard('ai_resume_scoring'), updateAiModule);
router.get('/ai/logs', checkPermission('ai_center', 'view'), subscriptionGuard('ai_resume_scoring'), getAiLogs);
router.post('/ai/logs', checkPermission('ai_center', 'create'), subscriptionGuard('ai_resume_scoring'), createAiLog);

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
router.get('/billing/payment-method', checkPermission('billing', 'view'), getPaymentMethod);
router.post('/billing/payment-method', checkPermission('billing', 'edit'), savePaymentMethod);

// Attendance & Leaves
router.get('/attendance', checkPermission('dashboard', 'view'), subscriptionGuard('attendance_leave'), getAllAttendance);
router.post('/attendance', checkPermission('dashboard', 'create'), subscriptionGuard('attendance_leave'), addManualAttendance);
router.put('/attendance/:id', checkPermission('dashboard', 'edit'), subscriptionGuard('attendance_leave'), updateAttendance);
router.delete('/attendance/:id', checkPermission('dashboard', 'delete'), subscriptionGuard('attendance_leave'), deleteAttendance);
router.get('/leaves', checkPermission('dashboard', 'view'), subscriptionGuard('attendance_leave'), getAllLeaves);
router.patch('/leaves/:id', checkPermission('dashboard', 'approve'), subscriptionGuard('attendance_leave'), reviewLeave);

// Resignations
router.get('/resignations', checkPermission('resignations', 'view'), subscriptionGuard('offboarding_exit'), getAdminResignations);
router.patch('/resignations/:id/override', checkPermission('resignations', 'approve'), subscriptionGuard('offboarding_exit'), overrideResignation);

// Generated Reports
router.get('/reports/data', checkPermission('reports', 'view'), subscriptionGuard('advanced_reports'), getReportData);
router.get('/reports', checkPermission('reports', 'view'), subscriptionGuard('advanced_reports'), getGeneratedReports);
router.post('/reports', checkPermission('reports', 'create'), subscriptionGuard('advanced_reports'), createGeneratedReport);
router.delete('/reports/:id', checkPermission('reports', 'delete'), subscriptionGuard('advanced_reports'), deleteGeneratedReport);

module.exports = router;
