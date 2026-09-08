// Centralized Permission Configuration for Custom Roles and Platform Roles

// Defines all modules available in the system mapped to base roles
const ROLE_MODULES = {
  SUPERADMIN: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'organizations', label: 'Organizations' },
    { id: 'users', label: 'Platform Users' },
    { id: 'payroll_global', label: 'Global Payroll' },
    { id: 'audit_logs', label: 'System Logs' },
    { id: 'settings', label: 'Platform Settings' },
  ],
  ADMIN: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'org_setup', label: 'Org Setup' },
    { id: 'departments', label: 'Departments' },
    { id: 'users', label: 'Users' },
    { id: 'roles_permissions', label: 'Roles & Permissions' },
    { id: 'payroll_center', label: 'Payroll Center' },
    { id: 'holidays', label: 'Holidays' },
    { id: 'benefits_config', label: 'Benefits Config' },
    { id: 'ai_center', label: 'AI Center' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'billing', label: 'Billing' },
    { id: 'shift_management', label: 'Shift Management' },
    { id: 'overtime_rules', label: 'Overtime Rules' },
    { id: 'resignations', label: 'Resignations' },
    { id: 'reimbursements', label: 'Reimbursements' },
    { id: 'approval_workflows', label: 'Approval Workflows' },
    { id: 'audit_logs', label: 'Audit Logs' },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Settings' },
  ],
  HR: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'job_posts', label: 'Job Posts' },
    { id: 'candidates', label: 'Candidates' },
    { id: 'interviews', label: 'Interviews' },
    { id: 'hiring_pipeline', label: 'Hiring Pipeline' },
    { id: 'offer_management', label: 'Offer Management' },
    { id: 'onboarding', label: 'Onboarding' },
    { id: 'offboarding_resignations', label: 'Offboarding & Resignations' },
    { id: 'payroll_operations', label: 'Payroll Operations' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'reports', label: 'Reports' },
    { id: 'messages', label: 'Messages' },
  ],
  MANAGER: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'team_members', label: 'Team Members' },
    { id: 'attendance_review', label: 'Attendance Review' },
    { id: 'leave_approval', label: 'Leave Approval' },
    { id: 'kpi_tracking', label: 'KPI Tracking' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'team_resignations', label: 'Team Resignations' },
    { id: 'reimbursements', label: 'Reimbursements' },
    { id: 'reports', label: 'Reports' },
  ],
  EMPLOYEE: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'profile', label: 'Profile' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'leave', label: 'Leave' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'benefits', label: 'Benefits' },
    { id: 'documents', label: 'Documents' },
    { id: 'performance', label: 'Performance' },
    { id: 'help_desk', label: 'Help Desk' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'resignation', label: 'Resignation' },
  ],
  CANDIDATE: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'browse_jobs', label: 'Browse Jobs' },
    { id: 'my_applications', label: 'My Applications' },
    { id: 'resume_builder', label: 'Resume Builder' },
    { id: 'ai_score', label: 'AI Resume Score' },
    { id: 'interview_schedule', label: 'Interview Schedule' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'messages', label: 'Messages' },
    { id: 'offers', label: 'Offers' },
    { id: 'settings', label: 'Settings' },
  ],
};

// Available actions for modules - allow granular full matrix actions
const ALL_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'manage'];

const MODULE_ACTIONS = new Proxy({}, {
  get: function () {
    return ALL_ACTIONS;
  }
});

// Permission Dependencies: 
// E.g., if you have 'create', you MUST have 'view'.
// Selecting 'manage' auto-selects all capabilities.
const PERMISSION_DEPENDENCIES = {
  create: ['view'],
  edit: ['view'],
  delete: ['view'],
  approve: ['view'],
  manage: ['view', 'create', 'edit', 'delete', 'approve'],
};

// Helper function to resolve dependencies
const resolveDependencies = (actions = []) => {
  const resolved = new Set(actions);
  actions.forEach(action => {
    if (PERMISSION_DEPENDENCIES[action]) {
      PERMISSION_DEPENDENCIES[action].forEach(dep => resolved.add(dep));
    }
  });
  return Array.from(resolved);
};

module.exports = {
  ROLE_MODULES,
  MODULE_ACTIONS,
  PERMISSION_DEPENDENCIES,
  resolveDependencies,
};
