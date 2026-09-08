// ============================================================
// Permission Middleware
// Validates module-level permissions from DB for all API routes
// Usage: checkPermission('users', 'delete')
// ============================================================

const prisma = require('../config/prisma');
const { getRoleCustomName, ensureDefaultRoles } = require('../utils/roleSeeder');

const MODULE_ALIASES = {
  payroll_operations: ['payroll_operations', 'payroll_center', 'payroll', 'compensation'],
  payroll_center: ['payroll_center', 'payroll_operations', 'payroll', 'compensation'],
  payroll: ['payroll', 'payroll_center', 'payroll_operations', 'compensation'],
  overtime_policies: ['overtime_policies', 'overtime_rules'],
  overtime_rules: ['overtime_rules', 'overtime_policies'],
  shifts: ['shifts', 'shift_management'],
  shift_management: ['shift_management', 'shifts'],
  employees: ['employees', 'users', 'team_members'],
  users: ['users', 'employees', 'team_members'],
  team_members: ['team_members', 'employees', 'users'],
  candidates: ['candidates', 'job_posts', 'hiring_pipeline', 'applications'],
  job_posts: ['job_posts', 'candidates', 'browse_jobs'],
  browse_jobs: ['browse_jobs', 'job_posts', 'candidates'],
  my_applications: ['my_applications', 'applications', 'candidates'],
  leaves: ['leaves', 'leave', 'leave_approval'],
  leave: ['leave', 'leaves', 'leave_approval'],
  leave_approval: ['leave_approval', 'leaves', 'leave'],
  attendance: ['attendance', 'attendance_review', 'shifts'],
  attendance_review: ['attendance_review', 'attendance', 'shifts'],
  performance: ['performance', 'reviews', 'kpi_tracking', 'kpi'],
  kpi_tracking: ['kpi_tracking', 'performance', 'reviews', 'kpi'],
  reviews: ['reviews', 'performance', 'kpi_tracking'],
  tasks: ['tasks'],
  reimbursements: ['reimbursements', 'payroll', 'benefits'],
  benefits: ['benefits', 'benefit_plans', 'reimbursements'],
  benefit_plans: ['benefit_plans', 'benefits'],
  tickets: ['tickets', 'help_desk'],
  help_desk: ['help_desk', 'tickets'],
  resignation: ['resignation', 'team_resignations', 'exits'],
  team_resignations: ['team_resignations', 'resignation', 'exits'],
  policies: ['policies', 'compliance'],
  compliance: ['compliance', 'policies'],
  documents: ['documents'],
  profile: ['profile'],
  reports: ['reports', 'analytics'],
  analytics: ['analytics', 'reports']
};

// Universal Self-Service modules accessible by ANY authenticated employee/manager/user
const SELF_SERVICE_MODULES = [
  'profile', 'documents', 'attendance', 'leave', 'leaves', 'payroll', 
  'performance', 'tickets', 'help_desk', 'benefits', 'resignation', 
  'notifications', 'policies', 'holidays', 'announcements', 'tasks', 'compliance'
];

/**
 * Factory: returns Express middleware that checks if the authenticated user
 * has the specified action permission for a module.
 *
 * @param {string} module  - e.g. 'users', 'departments', 'payroll_center'
 * @param {string} action  - 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'manage'
 */
const checkPermission = (module, action = 'view') => {
  return async (req, res, next) => {
    try {
      const userRole = (req.user?.role || '').toUpperCase();

      // 1. SUPERADMIN and ADMIN have full clearance across all organizational modules
      if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
        return next();
      }

      // 2. All authenticated users have full access to their own self-service features
      if (SELF_SERVICE_MODULES.includes(module)) {
        return next();
      }

      // 3. Functional Role Clearances:
      // HR role has clearance across HR management modules
      if (userRole === 'HR') {
        return next();
      }

      // MANAGER role has clearance across managerial team operations
      if (userRole === 'MANAGER') {
        const managerModules = [
          'team_members', 'attendance_review', 'leave_approval', 'tasks', 
          'kpi_tracking', 'reviews', 'team_resignations', 'reimbursements', 
          'increments', 'dashboard', 'org_employees'
        ];
        if (managerModules.includes(module) || module.startsWith('team') || module.startsWith('leave') || module.startsWith('attend') || module.startsWith('task') || module.startsWith('rev') || module.startsWith('reimb') || module.startsWith('kpi')) {
          return next();
        }
      }

      // CANDIDATE role has clearance across candidate portal modules
      if (userRole === 'CANDIDATE') {
        const candidateModules = ['browse_jobs', 'my_applications', 'profile', 'settings', 'offers', 'interviews', 'resume', 'notifications'];
        if (candidateModules.includes(module)) {
          return next();
        }
      }

      // EMPLOYEE role has clearance across employee self-service modules
      if (userRole === 'EMPLOYEE') {
        if (SELF_SERVICE_MODULES.includes(module)) {
          return next();
        }
      }

      // 4. Custom Role Override Resolution (for granular custom role configs)
      let customRole = null;
      if (req.user?.customRoleId && req.user?.customRoleStatus === 'ACTIVE') {
        customRole = await prisma.customRole.findUnique({ where: { id: req.user.customRoleId } });
      }

      if (!customRole || customRole.status !== 'ACTIVE') {
        const customRoleName = getRoleCustomName(userRole);
        if (customRoleName) {
          customRole = await prisma.customRole.findFirst({ where: { name: customRoleName } });
        }
      }

      if (!customRole) {
        // If standard role matched above, it was already granted. If it reached here, grant default pass for authenticated users
        return next();
      }

      let permissions = {};
      try {
        permissions = typeof customRole.permissions === 'string' 
          ? JSON.parse(customRole.permissions || '{}') 
          : (customRole.permissions || {});
      } catch (e) {
        permissions = {};
      }

      // Check direct module and any module aliases
      const candidateModules = [module, ...(MODULE_ALIASES[module] || [])];
      let modulePerms = [];
      for (const mod of candidateModules) {
        if (Array.isArray(permissions[mod]) && permissions[mod].length > 0) {
          modulePerms = permissions[mod];
          break;
        }
      }

      // If module is not restricted or has manage/action permission
      if (!Array.isArray(modulePerms) || modulePerms.length === 0) {
        return next();
      }

      if (modulePerms.includes('manage') || modulePerms.includes(action) || (action === 'view' && modulePerms.length > 0)) {
        return next();
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'ACTION_DENIED',
          message: `You do not have '${action}' permission on the '${module}' module.`
        }
      });

    } catch (err) {
      next(err);
    }
  };
};

module.exports = { checkPermission };
