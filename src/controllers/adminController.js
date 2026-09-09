// ============================================================
// Admin Controller
// ============================================================
// Handles: Organization, Departments, Users, Payroll, Audit Logs, Dashboard Stats

const prisma = require('../config/prisma');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { ensureDefaultRoles } = require('../utils/roleSeeder');
const { isWorkflowEnabled, processApproval } = require('../services/approval.service');
const calendarResolver = require('../utils/calendarResolver');
const { handleBase64Field, isBase64DataUrl, uploadImage } = require('../services/cloudUploadService');

const roleToEnum = (role = '') => {
  const normalized = String(role).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const map = {
    SUPER_ADMIN: 'SUPERADMIN',
    ADMIN: 'ADMIN',
    HR: 'HR',
    HR_MANAGER: 'HR',
    MANAGER: 'MANAGER',
    EMPLOYEE: 'EMPLOYEE',
    CANDIDATE: 'CANDIDATE',
  };
  return map[normalized] || normalized;
};

const optionalString = () => z.string().trim().nullish();

const organizationSchema = z.object({
  name: optionalString(),
  legalName: optionalString(),
  websiteUrl: optionalString(),
  industry: optionalString(),
  companySize: optionalString(),
  logoUrl: z.string().nullish(),
  address: optionalString(),
  taxId: optionalString(),
  primaryEmail: optionalString(),
  supportPhone: optionalString(),
  timezone: optionalString(),
  currency: optionalString(),
});

const buildOrganizationPayload = (body) => {
  const parsed = organizationSchema.safeParse(body);
  if (!parsed.success) return { error: parsed.error.issues?.[0]?.message || 'Invalid organization data.' };

  const data = Object.fromEntries(
    Object.entries(parsed.data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
  );

  return {
    data: {
      ...data,
      name: data.name || data.legalName || data.primaryEmail || 'Organization',
      logoUrl: data.logoUrl || null,
      address: data.address || null,
      taxId: data.taxId || null,
      legalName: data.legalName || null,
      websiteUrl: data.websiteUrl || null,
      industry: data.industry || null,
      companySize: data.companySize || null,
      primaryEmail: data.primaryEmail || null,
      supportPhone: data.supportPhone || null,
      timezone: data.timezone || null,
      currency: data.currency || null,
    }
  };
};

// ─────────────────────────────────────────
// DASHBOARD STATS  →  GET /api/admin/stats
// ─────────────────────────────────────────
const getDashboardStats = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(200).json({
        success: true,
        data: {
          totalEmployees: 0,
          activeEmployees: 0,
          totalDepartments: 0,
          customRoles: 0,
          targetPayroll: 0,
          complianceAlerts: 0,
          pendingLeaves: 0,
          openTickets: 0,
          todayAttendance: 0,
          unpaidPayslips: 0,
          attendanceSummary: {
            present: '0%',
            onLeave: '0%',
            lateAbsent: '0%',
            presentCount: 0,
            onLeaveCount: 0,
            lateAbsentCount: 0
          },
          recentActivities: [],
          growthTrend: {
            '6months': [],
            '12months': [],
            'year2026': []
          },
          organizationScore: 100
        },
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [
      totalEmployees,
      activeEmployees,
      totalDepartments,
      customRoles,
      activeCompProfiles,
      policies,
      pendingLeaves,
      openTickets,
      attendanceLogs,
      leavesToday,
      unpaidPayslips,
      recentActivities,
      allOrgUsers,
    ] = await Promise.all([
      prisma.user.count({
        where: { organizationId, role: { notIn: ['SUPERADMIN', 'CANDIDATE'] } }
      }),
      prisma.user.count({
        where: { organizationId, status: 'Active', role: { notIn: ['SUPERADMIN', 'CANDIDATE'] } }
      }),
      prisma.department.count({
        where: { organizationId }
      }),
      prisma.customRole.count({
        where: { organizationId }
      }),
      prisma.employeeProfile.findMany({
        where: { user: { organizationId, status: 'Active', role: { notIn: ['SUPERADMIN', 'CANDIDATE'] } } },
        include: { compensationProfile: true }
      }),
      prisma.policy.findMany({
        where: { organizationId, status: { not: 'Archived' } }
      }),
      prisma.leaveRequest.count({
        where: { user: { organizationId }, status: 'PENDING' }
      }),
      prisma.supportTicket.count({
        where: { user: { organizationId }, status: 'OPEN' }
      }),
      prisma.attendanceLog.findMany({
        where: { user: { organizationId }, date: { gte: today } }
      }),
      prisma.leaveRequest.findMany({ 
        where: { 
          user: { organizationId },
          status: 'APPROVED', 
          startDate: { lte: new Date() },
          endDate: { gte: today }
        }
      }),
      prisma.payslip.count({
        where: { employee: { user: { organizationId } }, status: 'Unpaid' }
      }),
      prisma.auditLog.findMany({
        take: 8,
        where: { user: { organizationId } },
        orderBy: { createdAt: 'desc' },
        include: { 
          user: { 
            select: { 
              email: true, 
              role: true,
              employeeProfile: { select: { fullName: true } } 
            } 
          } 
        }
      }),
      prisma.user.findMany({
        where: { organizationId, role: { notIn: ['SUPERADMIN', 'CANDIDATE'] } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          employeeProfile: { 
            select: { 
              joiningDate: true,
              compensationProfile: { select: { baseSalary: true, monthlyCTC: true } }
            } 
          }
        }
      })
    ]);

    // Target Payroll Calculation
    let targetPayroll = 0;
    activeCompProfiles.forEach(emp => {
      const comp = emp.compensationProfile;
      if (comp?.monthlyCTC && comp.monthlyCTC > 0) {
        targetPayroll += Number(comp.monthlyCTC);
      } else if (comp?.baseSalary && comp.baseSalary > 0) {
        targetPayroll += Number(comp.baseSalary);
      }
    });

    // Compliance Alerts (Expiring / Overdue / Renewing Policies)
    const expiringPoliciesCount = policies.filter(p => {
      if (p.status === 'Archived' || p.status === 'Resolved') return false;
      const statusStr = String(p.status || '').toLowerCase().replace(/_/g, ' ');
      if (statusStr === 'renewing' || statusStr === 'expiring soon') return true;
      if (!p.expiryDate) return false;
      const exp = new Date(p.expiryDate);
      return !isNaN(exp.getTime()) && exp <= thirtyDaysFromNow;
    }).length;

    // Attendance Calculations
    const presentCount = attendanceLogs.filter(a => a.status === 'Present' || a.punchIn).length;
    const lateCount = attendanceLogs.filter(a => a.status === 'Late' || a.lateMinutes > 0).length;
    const leaveCount = leavesToday.length;
    const absentCount = Math.max(0, activeEmployees - presentCount - leaveCount);

    const totalForAttendance = Math.max(activeEmployees, 1);
    const presentPct = Math.round((presentCount / totalForAttendance) * 100);
    const leavePct = Math.round((leaveCount / totalForAttendance) * 100);
    const lateAbsentPct = Math.round(((lateCount + absentCount) / totalForAttendance) * 100);

    const attendanceSummary = {
      present: `${presentPct}%`,
      onLeave: `${leavePct}%`,
      lateAbsent: `${lateAbsentPct}%`,
      presentCount,
      onLeaveCount: leaveCount,
      lateAbsentCount: lateCount + absentCount
    };

    // Growth Trend Analytics
    const now = new Date();
    const computeGrowth = (numMonths, customYear = null) => {
      const result = [];
      for (let i = numMonths - 1; i >= 0; i--) {
        const d = customYear
          ? new Date(customYear, 11 - i, 1)
          : new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('en-US', { month: 'short' });
        const year = d.getFullYear();
        const endOfMonth = new Date(year, d.getMonth() + 1, 0, 23, 59, 59);

        const count = allOrgUsers.filter(u => {
          const joinRaw = u.employeeProfile?.joiningDate || u.createdAt;
          if (!joinRaw) return true;
          const joinDate = new Date(joinRaw);
          return !isNaN(joinDate.getTime()) ? joinDate <= endOfMonth : true;
        }).length;

        result.push({ label, year, count });
      }
      const maxCount = Math.max(...result.map(m => m.count), 1);
      return result.map(m => ({
        ...m,
        pct: Math.max(12, Math.round((m.count / maxCount) * 100))
      }));
    };

    const growthTrend = {
      '6months': computeGrowth(6),
      '12months': computeGrowth(12),
      'year2026': computeGrowth(12, 2026)
    };

    // Format Recent Activity Stream
    const formattedActivities = recentActivities.map(log => ({
      id: log.id,
      text: log.action,
      action: log.action,
      details: log.details || '',
      module: log.module || log.action?.split('_')[0] || 'SYSTEM',
      level: log.level || 'Info',
      time: log.createdAt,
      user: log.user?.employeeProfile?.fullName || log.user?.email || 'System'
    }));

    // Dynamic Organization Health Score
    // Starts at 100 and applies proportional penalties
    const totalPolicies = Math.max(policies.length, 1);
    const policyComplianceRatio = Math.max(0, (policies.length - expiringPoliciesCount) / totalPolicies);
    const attendanceRatio = activeEmployees > 0 ? (presentCount / activeEmployees) : 1;

    let baseScore = 100;
    baseScore -= (pendingLeaves * 2);
    baseScore -= (openTickets * 3);
    baseScore -= (unpaidPayslips * 2);
    baseScore -= (expiringPoliciesCount * 4);

    // Factor in attendance and compliance ratio
    const organizationScore = Math.max(
      15, 
      Math.min(100, Math.round(baseScore * 0.7 + (policyComplianceRatio * 15) + (attendanceRatio * 15)))
    );

    return res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        totalDepartments,
        customRoles,
        targetPayroll,
        complianceAlerts: expiringPoliciesCount,
        pendingLeaves,
        openTickets,
        todayAttendance: presentCount,
        unpaidPayslips,
        attendanceSummary,
        growthTrend,
        recentActivities: formattedActivities,
        organizationScore
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// ORGANIZATION
// ─────────────────────────────────────────

// GET /api/admin/organization
const getOrganization = async (req, res, next) => {
  try {
    const orgId = req.user?.organizationId || req.tenant?.id;
    let org = orgId ? await prisma.organization.findUnique({ where: { id: orgId } }) : null;
    if (!org) {
      org = await prisma.organization.findFirst();
    }
    if (org) {
      org.setupComplete = true;
    }
    return res.status(200).json({ success: true, data: org });
  } catch (err) { next(err); }
};

// POST /api/admin/organization  (create if not exists)
const createOrganization = async (req, res, next) => {
  try {
    const payload = buildOrganizationPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: payload.error } });
    }

    // Upload logo to Cloudinary if it's a base64 data URL
    if (payload.data.logoUrl) {
      payload.data.logoUrl = await handleBase64Field(
        payload.data.logoUrl, null,
        { folder: 'hcm/logos', filenamePrefix: 'logo' }
      );
    }

    const org = await prisma.organization.create({ data: payload.data });
    if (req.user?.id && !req.user?.organizationId) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { organizationId: org.id }
      }).catch(() => {});
    }
    return res.status(201).json({ success: true, data: org, message: 'Organization created.' });
  } catch (err) { next(err); }
};

// PUT /api/admin/organization/:id
const updateOrganization = async (req, res, next) => {
  try {
    const payload = buildOrganizationPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: payload.error } });
    }

    // Upload logo to Cloudinary if it's a base64 data URL
    if (payload.data.logoUrl) {
      const existingOrg = await prisma.organization.findUnique({ where: { id: req.params.id } });
      payload.data.logoUrl = await handleBase64Field(
        payload.data.logoUrl, existingOrg?.logoUrl,
        { folder: 'hcm/logos', filenamePrefix: 'logo' }
      );
    }

    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: payload.data,
    });
    return res.status(200).json({ success: true, data: org });
  } catch (err) { next(err); }
};

// PATCH or POST /api/admin/organization/logo
const updateOrganizationLogo = async (req, res, next) => {
  try {
    let logoUrl = null;
    const uploadedFile = req.file || (Array.isArray(req.files) ? req.files[0] : (req.files?.logo?.[0] || req.files?.file?.[0]));

    if (uploadedFile) {
      const result = await uploadImage(uploadedFile, { folder: 'hcm/logos', filenamePrefix: 'logo' });
      logoUrl = result.url;
    } else if (req.body?.logo || req.body?.logoUrl || req.body?.file) {
      const rawLogo = req.body.logo || req.body.logoUrl || req.body.file;
      logoUrl = await handleBase64Field(rawLogo, null, { folder: 'hcm/logos', filenamePrefix: 'logo' });
    }

    if (!logoUrl) {
      return res.status(400).json({ success: false, error: { message: 'No logo file or URL provided.' } });
    }

    const orgId = req.user?.organizationId || req.tenant?.id || req.body?.organizationId;
    let org = orgId ? await prisma.organization.findUnique({ where: { id: orgId } }) : null;
    if (!org && !orgId) {
      org = await prisma.organization.findFirst();
    }

    if (!org) {
      org = await prisma.organization.create({
        data: { name: req.body?.name || req.user?.companyName || 'My Organization', logoUrl }
      });
    } else {
      org = await prisma.organization.update({
        where: { id: org.id },
        data: { logoUrl }
      });
    }

    // Link user to org if not linked
    if (req.user?.id && !req.user?.organizationId) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { organizationId: org.id }
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Logo updated successfully',
      data: {
        organizationId: org.id,
        logoUrl: org.logoUrl,
        name: org.name
      }
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/organization/logo
const deleteOrganizationLogo = async (req, res, next) => {
  try {
    const orgId = req.user?.organizationId || req.tenant?.id;
    let org = orgId ? await prisma.organization.findUnique({ where: { id: orgId } }) : null;
    if (!org) {
      org = await prisma.organization.findFirst();
    }
    if (org) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { logoUrl: null }
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Logo removed successfully',
      data: { logoUrl: null }
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────
// DEPARTMENTS
// ─────────────────────────────────────────

// GET /api/admin/departments
// ─────────────────────────────────────────
// DEPARTMENT HIERARCHY UTILITIES
// ─────────────────────────────────────────

/**
 * Validates that setting `proposedParentId` as the parent of `departmentId`
 * does NOT create a circular hierarchy (e.g. A→B→C→A).
 * Returns null if valid, or an error message string if circular.
 */
const validateNoCircularHierarchy = async (departmentId, proposedParentId) => {
  if (!proposedParentId) return null; // null parent = root, always valid
  if (proposedParentId === departmentId) return 'A department cannot be its own parent.';

  let currentId = proposedParentId;
  const visited = new Set();
  const MAX_DEPTH = 50; // safety cap

  for (let i = 0; i < MAX_DEPTH; i++) {
    if (visited.has(currentId)) return 'Circular hierarchy detected.';
    visited.add(currentId);

    const dept = await prisma.department.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });

    if (!dept || !dept.parentId) return null; // reached root, no cycle
    if (dept.parentId === departmentId) return 'Circular hierarchy detected. The proposed parent is a descendant of this department.';
    currentId = dept.parentId;
  }

  return 'Department hierarchy is too deep (exceeds 50 levels).';
};

// ─────────────────────────────────────────
// DEPARTMENT MANAGEMENT
// ─────────────────────────────────────────

const getDepartments = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(200).json({ success: true, data: [] });
    }

    const [departments, users] = await Promise.all([
      prisma.department.findMany({
        where: { organizationId },
        include: {
          _count: { select: { employees: true, subDepartments: true } },
          parentDept: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { organizationId },
        include: {
          employeeProfile: { select: { fullName: true } },
          candidateProfile: { select: { fullName: true } }
        }
      })
    ]);

    const validNames = new Set(
      users.flatMap(u => [u.employeeProfile?.fullName, u.candidateProfile?.fullName, u.email]).filter(Boolean)
    );

    const mapped = departments.map(d => {
      const isValidHead = d.head && d.head !== 'None' && validNames.has(d.head);
      return {
        ...d,
        head: isValidHead ? d.head : (d.head || 'None'),
        parent: d.parent || d.parentDept?.name || 'Corporate',
      };
    });

    return res.status(200).json({ success: true, data: mapped });
  } catch (err) { next(err); }
};

const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Department name must be at least 2 characters'),
  organizationId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullish(),
  code: z.string().trim().nullish(),
  head: z.string().trim().nullish(),
  parent: z.string().trim().nullish(),
  description: z.string().trim().nullish(),
  color: z.string().trim().nullish(),
  status: z.string().trim().nullish(),
});

// POST /api/admin/departments
const createDepartment = async (req, res, next) => {
  try {
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Invalid department data.' },
      });
    }

    const organizationId = req.user?.organizationId || req.tenant?.id || parsed.data.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_ORGANIZATION', message: 'Organization must be configured before creating departments.' },
      });
    }

    // Check for duplicate department name within this organization
    const existingDept = await prisma.department.findFirst({
      where: {
        organizationId,
        name: parsed.data.name,
      },
    });

    if (existingDept) {
      return res.status(409).json({
        success: false,
        error: { code: 'NAME_TAKEN', message: 'A department with this name already exists in your organization.' },
      });
    }

    // Check for duplicate department code within this organization if provided
    if (parsed.data.code) {
      const existingCode = await prisma.department.findFirst({
        where: {
          organizationId,
          code: parsed.data.code,
        },
      });
      if (existingCode) {
        return res.status(409).json({
          success: false,
          error: { code: 'CODE_TAKEN', message: 'A department with this code already exists in your organization.' },
        });
      }
    }

    // Resolve parentId and sync legacy parent string
    let parentId = parsed.data.parentId || null;
    let parentName = parsed.data.parent || 'Corporate';

    if (parentId) {
      const parentDept = await prisma.department.findFirst({
        where: { id: parentId, organizationId },
        select: { name: true },
      });
      if (!parentDept) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARENT', message: 'The specified parent department does not exist.' },
        });
      }
      parentName = parentDept.name;
    }

    const dept = await prisma.department.create({
      data: {
        name: parsed.data.name,
        organizationId,
        parentId,
        code: parsed.data.code || null,
        head: parsed.data.head || null,
        parent: parentName,
        description: parsed.data.description || null,
        color: parsed.data.color || '#4f46e5',
        status: parsed.data.status || 'Active',
      },
      include: {
        _count: { select: { employees: true, subDepartments: true } },
        parentDept: { select: { id: true, name: true } },
      },
    });
    return res.status(201).json({ success: true, data: dept, message: 'Department created.' });
  } catch (err) {
    console.error('[createDepartment] Error:', err.message, err.code, err.meta);
    next(err);
  }
};

// PUT /api/admin/departments/:id
const updateDepartment = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const parsed = departmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Invalid department data.' },
      });
    }

    const data = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined)
    );

    // Check duplicate code if code changed
    if (data.code && organizationId) {
      const existingCode = await prisma.department.findFirst({
        where: {
          organizationId,
          code: data.code,
          id: { not: req.params.id },
        },
      });
      if (existingCode) {
        return res.status(409).json({
          success: false,
          error: { code: 'CODE_TAKEN', message: 'A department with this code already exists in your organization.' },
        });
      }
    }

    // If parentId is being changed, validate no circular hierarchy
    if ('parentId' in data) {
      const circularError = await validateNoCircularHierarchy(req.params.id, data.parentId);
      if (circularError) {
        return res.status(400).json({
          success: false,
          error: { code: 'CIRCULAR_HIERARCHY', message: circularError },
        });
      }

      // Sync legacy parent string
      if (data.parentId) {
        const parentDept = await prisma.department.findFirst({
          where: { id: data.parentId, ...(organizationId ? { organizationId } : {}) },
          select: { name: true },
        });
        if (parentDept) {
          data.parent = parentDept.name;
        }
      } else {
        data.parent = 'Corporate';
      }
    }

    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data,
      include: {
        _count: { select: { employees: true, subDepartments: true } },
        parentDept: { select: { id: true, name: true } },
      },
    });
    return res.status(200).json({ success: true, data: dept, message: 'Department updated.' });
  } catch (err) { next(err); }
};

// DELETE /api/admin/departments/:id
const deleteDepartment = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const whereClause = { id: req.params.id, ...(organizationId ? { organizationId } : {}) };

    // Check for child departments
    const childCount = await prisma.department.count({ where: { parentId: req.params.id } });
    if (childCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'HAS_CHILDREN',
          message: `Cannot delete: This department has ${childCount} child department(s). Reassign or delete them first.`,
        },
      });
    }

    // Check for assigned employees
    const employeeCount = await prisma.employeeProfile.count({ where: { departmentId: req.params.id } });
    if (employeeCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'HAS_EMPLOYEES',
          message: `Cannot delete: ${employeeCount} employee(s) are assigned to this department. Reassign them first.`,
        },
      });
    }

    await prisma.department.delete({ where: whereClause });
    return res.status(200).json({ success: true, message: 'Department deleted.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────

const getAllUsers = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;

    if (!organizationId) {
      return res.status(200).json({ success: true, data: [], meta: { total: 0 } });
    }

    const users = await prisma.user.findMany({
      where: {
        role: { notIn: ['SUPERADMIN'] },
        organizationId: organizationId,
      },
      include: {
        customRole: { select: { id: true, name: true, inheritsFrom: true, status: true } },
        employeeProfile: {
          include: {
            department: true,
            manager: true,
            compensationProfile: true,
          }
        },
        candidateProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: users, meta: { total: users.length } });
  } catch (err) { next(err); }
};

// POST /api/admin/users
const createUser = async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2, 'Full name is required.'),
      email: z.string().trim().email('Valid email is required.'),
      phone: z.string().regex(/^\d{8,15}$/, 'Phone number must be between 8 and 15 digits.'),
      password: z.string().min(6, 'Password must be at least 6 characters.').optional(),
      empId: z.string().trim().min(2, 'Employee ID is required.'),
      role: z.string().trim().min(1, 'Organization role is required.'),
      department: z.string().trim().min(1, 'Department is required.'),
      manager: z.string().trim().min(1, 'Reporting manager is required.'),
      joinDate: z.string().trim().min(1, 'Joining date is required.'),
      empType: z.string().trim().min(1, 'Employment type is required.'),
      status: z.enum(['Active', 'Inactive', 'Pending']),
      address: z.string().trim().min(1, 'Residential address is required.'),
      img: z.string().optional(),
      monthlyCTC: z.union([z.number(), z.string()]).optional().nullable(),
      baseSalary: z.union([z.number(), z.string()]).optional().nullable(),
      salary: z.union([z.number(), z.string()]).optional().nullable(),
      salaryStructureId: z.string().optional().nullable(),
      salaryVersionId: z.string().optional().nullable(),
      effectiveDate: z.string().optional().nullable(),
      customRoleId: z.string().optional().nullable(),
      shiftId: z.string().optional().nullable(),
      overtimePolicyId: z.string().optional().nullable(),
      salaryType: z.enum(['Monthly', 'Hourly']).optional(),
      hourlyRate: z.union([z.number(), z.string()]).optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    const data = parsed.data;
    const role = roleToEnum(data.role);
    if (!['SUPERADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'CANDIDATE'].includes(role)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid organization role.' } });
    }

    if (role === 'SUPERADMIN' && req.user?.role !== 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can assign SuperAdmin role.' } });
    }

    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: { code: 'NO_ORGANIZATION', message: 'Organization is not configured.' } });
    }

    const [existingEmail, existingEmpId] = await Promise.all([
      prisma.user.findUnique({ where: { email: data.email } }),
      prisma.employeeProfile.findFirst({
        where: {
          employeeId: data.empId,
          organizationId,
        },
      }),
    ]);

    if (existingEmail) {
      return res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Email already exists.' } });
    }
    if (existingEmpId) {
      return res.status(409).json({ success: false, error: { code: 'EMPID_TAKEN', message: 'Employee ID already exists in your organization.' } });
    }
    const department = await prisma.department.findFirst({
      where: {
        OR: [{ id: data.department }, { name: data.department }],
        organizationId,
      },
      select: { id: true },
    });

    if (!department) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Selected department was not found in your organization.' } });
    }

    let managerId = null;
    if (data.manager !== 'None') {
      const manager = await prisma.employeeProfile.findFirst({
        where: {
          OR: [{ id: data.manager }, { fullName: data.manager }, { employeeId: data.manager }],
          organizationId,
        },
        select: { id: true },
      });
      if (!manager) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Selected reporting manager was not found in your organization.' } });
      }
      managerId = manager.id;
    }

    const defaultStructure = await prisma.salaryStructure.findFirst({
      where: { organizationId, isDefault: true }
    }) || await prisma.salaryStructure.findFirst({
      where: { organizationId }
    });

    const passwordHash = await bcrypt.hash(data.password || 'password123', 10);

    let validCustomRoleId = null;
    if (data.customRoleId && role !== 'SUPERADMIN') {
      const customRole = await prisma.customRole.findUnique({ where: { id: data.customRoleId } });
      if (customRole && customRole.status === 'ACTIVE') {
        validCustomRoleId = customRole.id;
      }
    }

    const targetStructureId = data.salaryStructureId || (defaultStructure ? defaultStructure.id : null);
    const targetVersionId = data.salaryVersionId || (defaultStructure ? defaultStructure.currentVersionId : null);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        role,
        isActive: data.status === 'Active',
        status: data.status,
        organizationId,
        customRoleId: validCustomRoleId,
        employeeProfile: {
          create: {
            employeeId: data.empId,
            fullName: data.name,
            phone: data.phone,
            address: data.address,
            organizationId,
            joiningDate: new Date(data.joinDate),
            employmentType: data.empType,
            avatarUrl: data.img || null,
            departmentId: department.id,
            managerId,
            salaryType: data.salaryType || 'Monthly',
            hourlyRate: data.hourlyRate ? Number(data.hourlyRate) : null,
            shiftId: data.shiftId || null,
            overtimePolicyId: data.overtimePolicyId || null,
            compensationProfile: {
              create: {
                baseSalary: Number(data.monthlyCTC ?? data.baseSalary ?? data.salary ?? 0),
                monthlyCTC: Number(data.monthlyCTC ?? data.baseSalary ?? data.salary ?? 0),
                annualCTC: Number(data.monthlyCTC ?? data.baseSalary ?? data.salary ?? 0) * 12,
                effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : new Date(data.joinDate),
                status: 'Active',
                ...(targetStructureId ? { salaryStructure: { connect: { id: targetStructureId } } } : {}),
                ...(targetVersionId ? { salaryVersion: { connect: { id: targetVersionId } } } : {})
              }
            }
          },
        },
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        status: true,
        createdAt: true,
        employeeProfile: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            phone: true,
            address: true,
            joiningDate: true,
            employmentType: true,
            avatarUrl: true,
            department: { select: { id: true, name: true } },
            manager: { select: { id: true, fullName: true, employeeId: true } },
          },
        },
      },
    });

    return res.status(201).json({ success: true, data: user, message: 'User created.' });
  } catch (err) { next(err); }
};

// PATCH /api/admin/users/:id/role
const changeUserRole = async (req, res, next) => {
  try {
    const schema = z.object({
      role: z.string().trim().min(1, 'Role is required'),
      customRoleId: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    const role = roleToEnum(parsed.data.role);
    if (!['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'CANDIDATE'].includes(role)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid organization role.' } });
    }

    if (role === 'SUPERADMIN' && req.user?.role !== 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can assign SuperAdmin role.' } });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser || targetUser.role === 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (req.user?.organizationId && targetUser.organizationId && targetUser.organizationId !== req.user.organizationId && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot modify user outside your organization.' } });
    }

    let validCustomRoleId = null;
    if (parsed.data.customRoleId && role !== 'SUPERADMIN') {
      const customRole = await prisma.customRole.findUnique({ where: { id: parsed.data.customRoleId } });
      if (customRole && customRole.status === 'ACTIVE') {
        validCustomRoleId = customRole.id;
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role, customRoleId: validCustomRoleId },
      select: { id: true, email: true, role: true, customRoleId: true },
    });

    if (req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE_USER_ROLE',
          details: `Updated role for user ${user.email} to ${role} ${validCustomRoleId ? 'with custom override' : ''}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    try {
      const { createNotification } = require('../utils/notificationHelper');
      await createNotification({
        userId: user.id,
        title: 'System Security Patch',
        message: `Your account role has been updated to ${role}.`,
        type: 'WARNING',
        link: '/employee/settings'
      });
    } catch (notifErr) {
      console.error('Failed to trigger user role update notification:', notifErr);
    }

    return res.status(200).json({ success: true, data: user, message: 'Role updated.' });
  } catch (err) { next(err); }
};

// POST /api/admin/users/:id/revoke-role
const revokeUserRole = async (req, res, next) => {
  try {
    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { customRole: true, employeeProfile: true, candidateProfile: true }
    });
    if (!targetUser || targetUser.role === 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    const previousRole = targetUser.customRole?.name || targetUser.role;
    const fallbackRole = targetUser.role === 'CANDIDATE' ? 'CANDIDATE' : 'EMPLOYEE';
    const userName = targetUser.employeeProfile?.fullName || targetUser.candidateProfile?.fullName || targetUser.email;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: fallbackRole, customRoleId: null },
      select: { id: true, email: true, role: true, customRoleId: true },
    });

    if (req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'REVOKE_USER_ROLE',
          details: `Revoked role "${previousRole}" from ${userName} (${user.email}). Reverted to ${fallbackRole}.`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
      message: `Role ${previousRole} revoked for ${user.email}.`
    });
  } catch (err) { next(err); }
};

// GET /api/admin/roles/history
const getRoleHistory = async (req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'UPDATE_USER_ROLE',
            'CHANGE_USER_ROLE',
            'REVOKE_USER_ROLE',
            'ASSIGN_USER_ROLE',
            'UPDATE_ROLE',
            'CREATE_ROLE',
            'DELETE_ROLE'
          ]
        }
      },
      include: {
        user: {
          select: {
            email: true,
            role: true,
            employeeProfile: { select: { fullName: true, avatarUrl: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const formatted = logs.map(log => ({
      id: log.id,
      action: log.action,
      details: log.details,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt,
      actor: log.user?.employeeProfile?.fullName || log.user?.email || 'Administrator',
      actorEmail: log.user?.email || 'admin@hcm.ai',
      actorRole: log.user?.role || 'SUPERADMIN'
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (err) { next(err); }
};

// PATCH /api/admin/users/:id/toggle-active
const toggleUserActive = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    if (user.role === 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (req.user?.userId === req.params.id) {
      return res.status(400).json({ success: false, error: { code: 'SELF_DEACTIVATION_BLOCKED', message: 'You cannot deactivate your own active admin account.' } });
    }

    if (user.role === 'ADMIN' && user.isActive) {
      const activeAdminCount = await prisma.user.count({
        where: { organizationId: user.organizationId, role: 'ADMIN', isActive: true }
      });
      if (activeAdminCount <= 1) {
        return res.status(400).json({ success: false, error: { code: 'LAST_ADMIN_PROTECTED', message: 'Cannot deactivate the sole active Admin account in the organization.' } });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive, status: !user.isActive ? 'Active' : 'Inactive' },
    });

    try {
      const { createNotification } = require('../utils/notificationHelper');
      await createNotification({
        userId: updated.id,
        title: 'System Security Patch',
        message: `Your account status has been set to ${updated.isActive ? 'Active' : 'Inactive'}.`,
        type: 'WARNING',
        link: '/employee/settings'
      });
    } catch (notifErr) {
      console.error('Failed to trigger user status update notification:', notifErr);
    }

    return res.status(200).json({ success: true, data: { isActive: updated.isActive }, message: `User ${updated.isActive ? 'activated' : 'deactivated'}.` });
  } catch (err) { next(err); }
};

// PUT /api/admin/users/:id
const updateUser = async (req, res, next) => {
  try {
    const { name, email, role, department, empType, status, phone, address, manager, shiftId, overtimePolicyId, 
      salaryType, hourlyRate, departmentId, password, customRoleId, img, avatar, avatarUrl } = req.body;
      
    const existingUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { employeeProfile: true }
    });
    if (!existingUser) return res.status(404).json({ success: false, error: { message: 'User not found' } });
    if (existingUser.role === 'SUPERADMIN' && req.user?.role !== 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden: Cannot edit a SuperAdmin' } });
    }
    
    if (role && roleToEnum(role) === 'SUPERADMIN' && req.user?.role !== 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can assign SuperAdmin role.' } });
    }

    let finalDeptId = departmentId;
    if (department) {
      const dept = await prisma.department.findFirst({
        where: { OR: [{ id: department }, { name: department }] }
      });
      if (dept) finalDeptId = dept.id;
    }

    let managerId = undefined;
    if (manager) {
      if (manager === 'None') {
        managerId = null;
      } else {
        const managerUser = await prisma.employeeProfile.findFirst({
          where: { OR: [{ fullName: manager }, { employeeId: manager }, { id: manager }] }
        });
        if (managerUser) managerId = managerUser.id;
      }
    }

    const photoUrl = img !== undefined ? (img || null) : (avatarUrl !== undefined ? (avatarUrl || null) : (avatar !== undefined ? (avatar || null) : undefined));

    const empData = {
      ...(name !== undefined && { fullName: name }),
      ...(empType !== undefined && { employmentType: empType }),
      ...(phone !== undefined && { phone }),
      ...(address !== undefined && { address }),
      ...(managerId !== undefined && { managerId }),
      ...(shiftId !== undefined && { shiftId: shiftId || null }),
      ...(overtimePolicyId !== undefined && { overtimePolicyId: overtimePolicyId || null }),
      ...(salaryType !== undefined && { salaryType }),
      ...(hourlyRate !== undefined && { hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null }),
      ...(finalDeptId !== undefined && { departmentId: finalDeptId || null }),
      ...(photoUrl !== undefined && { avatarUrl: photoUrl })
    };

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(email !== undefined && { email }),
        ...(role !== undefined && { role: roleToEnum(role) }),
        ...(status !== undefined && { status, isActive: status.toLowerCase() === 'active' }),
        ...(customRoleId !== undefined && { customRoleId: customRoleId || null }),
        ...(password && { passwordHash: await bcrypt.hash(password, 10) }),
        employeeProfile: existingUser.employeeProfile ? {
          update: empData
        } : {
          create: {
            fullName: name || (email || existingUser.email).split('@')[0],
            employeeId: 'EMP-' + Math.floor(Math.random() * 100000),
            ...empData
          }
        }
      },
      include: { employeeProfile: true }
    });

    const rawSalary = req.body.monthlyCTC ?? req.body.baseSalary ?? req.body.salary;
    const salaryVal = rawSalary !== undefined && rawSalary !== null && rawSalary !== '' ? Number(rawSalary) : undefined;

    if (existingUser.employeeProfile && salaryVal !== undefined && !isNaN(salaryVal)) {
      const existingComp = await prisma.compensationProfile.findUnique({
        where: { employeeId: existingUser.employeeProfile.id }
      });
      if (existingComp) {
        await prisma.compensationProfile.update({
          where: { employeeId: existingUser.employeeProfile.id },
          data: {
            baseSalary: salaryVal,
            monthlyCTC: salaryVal,
            annualCTC: salaryVal * 12
          }
        });
      } else if (salaryVal > 0) {
        await prisma.compensationProfile.create({
          data: {
            employeeId: existingUser.employeeProfile.id,
            baseSalary: salaryVal,
            monthlyCTC: salaryVal,
            annualCTC: salaryVal * 12,
            effectiveDate: new Date(),
            status: 'Active'
          }
        });
      }
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE_USER',
          details: `Updated user profile for ${user.email}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (err) { next(err); }
};

const deleteUser = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employeeProfile: true,
        candidateProfile: true
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }

    if (existing.role === 'SUPERADMIN') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Superadmin user cannot be deleted.' } });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Employee-related cleanup
      if (existing.employeeProfile) {
        const empId = existing.employeeProfile.id;

        // Collect all entity IDs associated with this employee
        const userLeaveIds = (await tx.leaveRequest.findMany({ where: { userId }, select: { id: true } })).map(l => l.id);
        const userIncrementIds = (await tx.salaryIncrementRequest.findMany({ where: { employeeId: empId }, select: { id: true } })).map(i => i.id);
        const userExitIds = (await tx.exitLifecycle.findMany({ where: { employeeId: empId }, select: { id: true } })).map(e => e.id);
        const allEntityIds = [...userLeaveIds, ...userIncrementIds, ...userExitIds];

        if (allEntityIds.length > 0) {
          await tx.approvalLog.deleteMany({
            where: { entityId: { in: allEntityIds } }
          });
        }

        // Unassign direct reports where this employee is the manager
        await tx.employeeProfile.updateMany({
          where: { managerId: empId },
          data: { managerId: null }
        });

        // Delete interviews where this employee was the interviewer
        await tx.interview.deleteMany({
          where: { interviewerId: empId }
        });

        // Delete approval logs where this employee was the approver
        await tx.approvalLog.deleteMany({
          where: { approverId: empId }
        });

        // Delete other employee-linked records
        await tx.payrollSnapshot.deleteMany({ where: { employeeId: empId } });
        await tx.payslip.deleteMany({ where: { employeeId: empId } });
        await tx.bonus.deleteMany({ where: { employeeId: empId } });
        await tx.salaryIncrementRequest.deleteMany({ where: { employeeId: empId } });
        await tx.employeeSalaryComponent.deleteMany({ where: { employeeId: empId } });
        await tx.employeeDeduction.deleteMany({ where: { employeeId: empId } });
        await tx.employeeBenefit.deleteMany({ where: { employeeId: empId } });
        await tx.benefitClaim.deleteMany({ where: { employeeId: empId } });
        await tx.performanceGoal.deleteMany({ where: { employeeId: empId } });
        await tx.performanceReview.deleteMany({ where: { employeeId: empId } });
        await tx.task.deleteMany({ where: { employeeId: empId } });
        await tx.employeeSkill.deleteMany({ where: { employeeId: empId } });
        await tx.compensationVersion.deleteMany({ where: { employeeId: empId } });
        await tx.compensationProfile.deleteMany({ where: { employeeId: empId } });
        await tx.exitLifecycle.deleteMany({ where: { employeeId: empId } });
      }

      // 2. Candidate-related cleanup
      if (existing.candidateProfile) {
        const candId = existing.candidateProfile.id;
        const apps = await tx.jobApplication.findMany({
          where: { candidateId: candId },
          select: { id: true }
        });
        const appIds = apps.map(a => a.id);
        if (appIds.length > 0) {
          await tx.interview.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.offer.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.onboarding.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.exitLifecycle.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.jobApplication.deleteMany({ where: { id: { in: appIds } } });
        }
      }

      // 3. User-level relations
      const userNames = [
        existing.email,
        existing.employeeProfile?.fullName,
        existing.candidateProfile?.fullName
      ].filter(Boolean);

      // Automatically unassign this user if they were head of any departments
      await tx.department.updateMany({
        where: { head: { in: userNames } },
        data: { head: null }
      });

      await tx.ticketMessage.deleteMany({ where: { senderId: userId } });
      await tx.supportTicket.deleteMany({ where: { userId } });
      await tx.attendanceLog.deleteMany({ where: { userId } });
      await tx.leaveRequest.deleteMany({ where: { userId } });
      await tx.document.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.policyAcknowledgment.deleteMany({ where: { userId } });
      await tx.customRole.updateMany({ where: { createdById: userId }, data: { createdById: null } });
      await tx.customRole.updateMany({ where: { updatedById: userId }, data: { updatedById: null } });
      await tx.auditLog.updateMany({ where: { userId }, data: { userId: null } });

      // 4. Finally delete the user
      await tx.user.delete({ where: { id: userId } });
    });

    if (existing) {
      try {
        let actorId = null;
        if (req.user?.userId) {
          const actorExists = await prisma.user.findUnique({ where: { id: req.user.userId } });
          if (actorExists) actorId = actorExists.id;
        }
        await prisma.auditLog.create({
          data: {
            userId: actorId,
            action: 'DELETE_USER',
            details: `Deleted user: ${existing.email} (${existing.role})`,
            ipAddress: req.ip || req.socket.remoteAddress
          }
        });
      } catch (auditErr) {
        console.error('Failed to create audit log on deleteUser:', auditErr);
      }
    }

    return res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PAYROLL MANAGEMENT
// ─────────────────────────────────────────

// GET /api/admin/payslips
const getAllPayslips = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const { month, status } = req.query;

    const payslips = await prisma.payslip.findMany({
      where: {
        ...(organizationId ? { employee: { user: { organizationId } } } : {}),
        ...(month && { month }),
        ...(status && { status }),
      },
      include: {
        employee: { select: { fullName: true, employeeId: true, userId: true, department: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: payslips });
  } catch (err) { next(err); }
};

// POST /api/admin/payslips  (generate payslip)
const generatePayslip = async (req, res, next) => {
  try {
    const schema = z.object({
      employeeId: z.string(),
      month: z.string(),
      basic: z.number(),
      hra: z.number(),
      allowance: z.number(),
      bonus: z.number().optional(),
      pf: z.number(),
      tax: z.number(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    const { employeeId, month, basic, hra, allowance, bonus = 0, pf, tax } = parsed.data;

    let targetProfileId = employeeId;
    let profile = await prisma.employeeProfile.findUnique({
      where: { id: targetProfileId },
      include: { overtimePolicy: true }
    });

    if (!profile) {
      profile = await prisma.employeeProfile.findUnique({
        where: { userId: targetProfileId }
      });

      if (!profile) {
        const user = await prisma.user.findUnique({
          where: { id: targetProfileId }
        });
        if (user) {
          profile = await prisma.employeeProfile.create({
            data: {
              userId: user.id,
              fullName: user.email.split('@')[0],
              employeeId: 'EMP-' + user.id.slice(0, 3).toUpperCase(),
            }
          });
        }
      }

      if (profile) {
        targetProfileId = profile.id;
      } else {
        return res.status(444).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee profile not found and could not be created.' } });
      }
    }

    const settings = await prisma.globalSettings.findFirst();
    let currencyCode = 'USD';
    if (settings?.masterCurrency) {
      const curr = settings.masterCurrency;
      if (curr.includes('INR') || curr.includes('₹')) currencyCode = 'INR';
      else if (curr.includes('EUR') || curr.includes('€')) currencyCode = 'EUR';
      else if (curr.includes('GBP') || curr.includes('£')) currencyCode = 'GBP';
      else if (curr.includes('AED') || curr.includes('د.إ')) currencyCode = 'AED';
    }

    // DYNAMIC PAYROLL LOGIC
    const logs = await prisma.attendanceLog.findMany({
      where: { userId: profile.userId }
    });

    const targetMonthStr = month.toLowerCase();
    const isYYYYMM = /^\d{4}-\d{2}$/.test(month);

    // --- INTEGRATE ENTERPRISE CALENDAR FOR WORKING DAYS ---
    let calendarWorkingDays = 0;
    let calendarDays = 0;
    let holidaysCount = 0;
    let weekendsCount = 0;

    if (isYYYYMM) {
      try {
        const [yyyy, mm] = month.split('-');
        const daysInMonth = new Date(yyyy, mm, 0).getDate();
        calendarDays = daysInMonth;

        for (let day = 1; day <= daysInMonth; day++) {
          const checkDate = new Date(yyyy, mm - 1, day);
          const dayType = await calendarResolver.getDayType(profile.userId, checkDate);

          if (dayType.type === 'WORKING_DAY') {
            calendarWorkingDays += 1;
          } else if (dayType.type === 'WEEKEND') {
            if (dayType.detail.type === 'HALF_DAY') calendarWorkingDays += 0.5;
            weekendsCount++;
          } else if (dayType.type === 'HOLIDAY') {
            holidaysCount++;
          }
        }
        console.log(`[Payroll Calendar] Employee: ${profile.userId}, Month: ${month} -> Working Days: ${calendarWorkingDays}, Weekends: ${weekendsCount}, Holidays: ${holidaysCount}`);
      } catch (calErr) {
        console.warn(`[Payroll Calendar Warning] ${calErr.message}. Defaulting working days logic.`);
      }
    }
    // ------------------------------------------------------

    let totalWorkedMin = 0;
    let totalOTMin = 0;

    logs.forEach(log => {
      const d = new Date(log.date);
      let match = false;
      if (isYYYYMM) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        if (`${yyyy}-${mm}` === month) match = true;
      } else {
        const logMonth = d.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
        const logMonthShort = d.toLocaleString('en-US', { month: 'short', year: 'numeric' }).toLowerCase();
        if (targetMonthStr === logMonth || targetMonthStr === logMonthShort || targetMonthStr.includes(logMonth) || targetMonthStr.includes(logMonthShort)) {
          match = true;
        }
      }

      if (match) {
        totalWorkedMin += log.totalWorkedMin;
        totalOTMin += log.overtimeMinutes;
      }
    });

    let finalBasic = basic;
    let finalBonus = bonus || 0;

    if (profile.salaryType === 'Hourly' && profile.hourlyRate) {
      const hoursWorked = totalWorkedMin / 60;
      finalBasic = hoursWorked * profile.hourlyRate;
    }

    if (totalOTMin > 0) {
      let hourlyRate = profile.hourlyRate || 0;
      if (!hourlyRate && profile.salaryType === 'Monthly') {
        const base = finalBasic + hra + allowance;
        hourlyRate = base / 160;
      }

      let otRateMultiplier = 1.0;
      if (profile.overtimePolicy) {
        otRateMultiplier = profile.overtimePolicy.weekdayMultiplier || 1.5;
      } else {
        const defPolicy = await prisma.overtimePolicy.findFirst({ where: { isDefault: true } });
        if (defPolicy) otRateMultiplier = defPolicy.weekdayMultiplier;
      }

      const otHours = totalOTMin / 60;
      const otPay = otHours * hourlyRate * otRateMultiplier;
      finalBonus += otPay;
    }

    const netPay = finalBasic + hra + allowance + finalBonus - pf - tax;

    // Check if a payslip already exists for this employee and month
    const existing = await prisma.payslip.findFirst({
      where: { employeeId: targetProfileId, month }
    });

    let payslip;
    if (existing) {
      payslip = await prisma.payslip.update({
        where: { id: existing.id },
        data: { basic: finalBasic, hra, allowance, bonus: finalBonus, pf, tax, netPay, currency: currencyCode }
      });
    } else {
      payslip = await prisma.payslip.create({
        data: { employeeId: targetProfileId, month, basic: finalBasic, hra, allowance, bonus: finalBonus, pf, tax, netPay, status: 'Unpaid', currency: currencyCode },
      });
    }

    try {
      const { createNotification } = require('../utils/notificationHelper');
      const empProfile = await prisma.employeeProfile.findUnique({
        where: { id: targetProfileId },
        select: { userId: true }
      });
      if (empProfile && empProfile.userId) {
        await createNotification({
          userId: empProfile.userId,
          title: 'Payroll Processed',
          message: `Your payout sheet for ${month} is ready.`,
          type: 'SUCCESS',
          link: '/employee/payroll'
        });
      }
    } catch (notifErr) {
      console.error('Failed to trigger payslip generation notification:', notifErr);
    }

    return res.status(201).json({ success: true, data: payslip, message: 'Payslip generated.' });
  } catch (err) { next(err); }
};

// PATCH /api/admin/payslips/:id/pay
const markPayslipPaid = async (req, res, next) => {
  try {
    const payslip = await prisma.payslip.update({
      where: { id: req.params.id },
      data: { status: 'Paid', paymentDate: new Date() },
    });

    try {
      const { createNotification } = require('../utils/notificationHelper');
      const empProfile = await prisma.employeeProfile.findUnique({
        where: { id: payslip.employeeId },
        select: { userId: true }
      });
      if (empProfile && empProfile.userId) {
        await createNotification({
          userId: empProfile.userId,
          title: 'Payroll Processed',
          message: `Your payout sheet for ${payslip.month} has been paid.`,
          type: 'SUCCESS',
          link: '/employee/payroll'
        });
      }
    } catch (notifErr) {
      console.error('Failed to trigger payslip payment notification:', notifErr);
    }

    return res.status(200).json({ success: true, data: payslip, message: 'Payslip marked as paid.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// AUDIT LOGS
// ─────────────────────────────────────────

// GET /api/admin/audit-logs
const getAuditLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const { search, module, level, environment, action, userId, startDate, endDate } = req.query;

    const where = {};
    const organizationId = req.user.organizationId;

    // Tenant Security: Must belong to this org.
    // If a user is deleted, userId becomes null, so we must rely on organizationId column if present,
    // OR fallback to checking user's org if the legacy log didn't store organizationId.
    if (organizationId) {
      where.OR = [
        { organizationId: organizationId },
        { user: { organizationId: organizationId } }
      ];
    }

    if (search) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { action: { contains: search, mode: 'insensitive' } },
          { details: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } }
        ]
      });
    }

    // Explicit Action filter
    if (action && action !== 'All') {
      where.action = { contains: action, mode: 'insensitive' };
    }

    // Module Filter (matches the prefix of the action, e.g., USER_LOGIN -> USER)
    if (module && module !== 'All') {
      where.action = { ...where.action, startsWith: module, mode: 'insensitive' };
    }

    // Level Filter (derived from action keywords)
    if (level && level !== 'All') {
      const lvl = level.toLowerCase();
      if (lvl === 'critical') {
        where.action = { ...where.action, contains: 'delete', mode: 'insensitive' };
      } else if (lvl === 'security') {
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { action: { contains: 'auth', mode: 'insensitive' } },
            { action: { contains: 'login', mode: 'insensitive' } },
            { action: { contains: 'role', mode: 'insensitive' } },
            { action: { contains: 'security', mode: 'insensitive' } }
          ]
        });
      } else if (lvl === 'warning') {
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { action: { contains: 'update', mode: 'insensitive' } },
            { action: { contains: 'edit', mode: 'insensitive' } },
            { action: { contains: 'override', mode: 'insensitive' } }
          ]
        });
      } else if (lvl === 'info') {
        // Exclude critical/security/warning keywords
        where.AND = where.AND || [];
        where.AND.push({
          NOT: {
            OR: [
              { action: { contains: 'delete', mode: 'insensitive' } },
              { action: { contains: 'auth', mode: 'insensitive' } },
              { action: { contains: 'login', mode: 'insensitive' } },
              { action: { contains: 'role', mode: 'insensitive' } },
              { action: { contains: 'update', mode: 'insensitive' } },
              { action: { contains: 'override', mode: 'insensitive' } }
            ]
          }
        });
      }
    }

    // Environment Filter based on IP (heuristic)
    if (environment && environment !== 'All') {
      if (environment.toLowerCase() === 'production') {
        where.NOT = { ipAddress: { in: ['127.0.0.1', '::1', 'localhost'] } };
      } else if (environment.toLowerCase() === 'staging' || environment.toLowerCase() === 'development') {
        where.ipAddress = { in: ['127.0.0.1', '::1', 'localhost'] };
      }
    }

    if (userId) {
      where.userId = userId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              employeeProfile: { select: { fullName: true, avatarUrl: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where })
    ]);

    // Map logs to include derived fields directly in the backend response
    const mappedLogs = logs.map(log => {
      const act = log.action?.toLowerCase() || '';
      let derivedLevel = 'Info';
      if (act.includes('delete') || act.includes('reject') || act.includes('remove')) derivedLevel = 'Critical';
      else if (act.includes('security') || act.includes('auth') || act.includes('role') || act.includes('login') || act.includes('logout')) derivedLevel = 'Security';
      else if (act.includes('update') || act.includes('edit') || act.includes('override') || act.includes('modify')) derivedLevel = 'Warning';

      return {
        ...log,
        level: derivedLevel,
        module: log.action?.split('_')[0] || 'SYSTEM',
      };
    });

    return res.status(200).json({
      success: true,
      data: mappedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    });
  } catch (err) { next(err); }
};

// ============================================================
// 12. COMPLIANCE POLICIES
// ============================================================

// GET /api/admin/policies
const getPolicies = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const policies = await prisma.policy.findMany({
      where: organizationId ? { organizationId } : {},
      include: {
        policyAcknowledgments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                employeeProfile: {
                  select: {
                    fullName: true,
                    employeeId: true,
                    avatarUrl: true,
                    department: { select: { name: true } }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({ success: true, data: policies });
  } catch (err) { next(err); }
};

// POST /api/admin/policies
const createPolicy = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const { name, category, department, owner, effectiveDate, expiryDate, version, requiresSignature, status, description, pdfName, pdfData, acknowledgments } = req.body;
    
    let finalPdfData = pdfData;
    if (pdfData && typeof pdfData === 'string' && pdfData.includes('base64,')) {
      finalPdfData = await handleBase64Field(
        pdfData,
        null,
        { folder: 'hcm/policies', filenamePrefix: 'policy' }
      );
    }

    const policy = await prisma.policy.create({
      data: {
        name,
        category,
        owner,
        organizationId,
        ...(department && { department }),
        ...(effectiveDate && { effectiveDate }),
        ...(expiryDate && { expiryDate }),
        ...(version && { version }),
        ...(requiresSignature !== undefined && { requiresSignature }),
        ...(status && { status }),
        ...(description && { description }),
        ...(pdfName && { pdfName }),
        ...(finalPdfData && { pdfData: finalPdfData }),
        ...(acknowledgments && { acknowledgments }),
      },
    });
    return res.status(201).json({ success: true, data: policy, message: 'Policy created.' });
  } catch (err) { next(err); }
};

// PUT /api/admin/policies/:id
const updatePolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, category, department, owner, effectiveDate, expiryDate, version, requiresSignature, status, description, pdfName, pdfData, acknowledgments } = req.body;
    
    let finalPdfData = pdfData;
    if (pdfData && typeof pdfData === 'string' && pdfData.includes('base64,')) {
      const existing = await prisma.policy.findUnique({ where: { id } });
      finalPdfData = await handleBase64Field(
        pdfData,
        existing?.pdfData,
        { folder: 'hcm/policies', filenamePrefix: 'policy' }
      );
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(category && { category }),
        ...(department && { department }),
        ...(owner && { owner }),
        ...(effectiveDate && { effectiveDate }),
        ...(expiryDate && { expiryDate }),
        ...(version && { version }),
        ...(requiresSignature !== undefined && { requiresSignature }),
        ...(status && { status }),
        ...(description && { description }),
        ...(pdfName && { pdfName }),
        ...(finalPdfData && { pdfData: finalPdfData }),
        ...(acknowledgments && { acknowledgments }),
      },
    });
    return res.status(200).json({ success: true, data: policy, message: 'Policy updated.' });
  } catch (err) { next(err); }
};

// DELETE /api/admin/policies/:id
const deletePolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.policy.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Policy deleted.' });
  } catch (err) { next(err); }
};

// PATCH /api/admin/policies/:id/archive
const toggleArchivePolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const policy = await prisma.policy.findUnique({ where: { id } });
    if (!policy) {
      return res.status(404).json({ success: false, error: { message: 'Policy not found.' } });
    }
    const newStatus = policy.status === 'Archived' ? 'Active' : 'Archived';
    const updated = await prisma.policy.update({
      where: { id },
      data: { status: newStatus },
    });
    return res.status(200).json({ success: true, data: updated, message: `Policy marked as ${newStatus}.` });
  } catch (err) { next(err); }
};

// POST /api/admin/policies/:id/renew
const renewPolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, category, department, owner, effectiveDate, expiryDate, version, requiresSignature, description, pdfName, pdfData } = req.body;

    // Update the policy itself with new data
    const policy = await prisma.policy.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(category && { category }),
        ...(department && { department }),
        ...(owner && { owner }),
        ...(effectiveDate && { effectiveDate }),
        ...(expiryDate && { expiryDate }),
        ...(version && { version }),
        ...(requiresSignature !== undefined && { requiresSignature }),
        status: 'Active',
        ...(description !== undefined && { description }),
        ...(pdfName !== undefined && { pdfName }),
        ...(pdfData !== undefined && { pdfData }),
        // Reset acknowledgment string format (e.g. 0/50 instead of 45/50)
        // We will just set it to '0' initially, frontend logic will format it to `0/totalEmployees`
        acknowledgments: '0'
      },
    });

    // Wipe all existing employee acknowledgments for this policy
    await prisma.policyAcknowledgment.deleteMany({
      where: { policyId: id }
    });

    return res.status(200).json({ success: true, data: policy, message: 'Policy renewed successfully.' });
  } catch (err) { next(err); }
};

// POST /api/admin/policies/:id/remind
const sendPolicyReminder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const policy = await prisma.policy.findUnique({ where: { id } });
    if (!policy) {
      return res.status(404).json({ success: false, error: { message: 'Policy not found.' } });
    }

    // Get all users who have not acknowledged this policy
    const acknowledgedUsers = await prisma.policyAcknowledgment.findMany({
      where: { policyId: id },
      select: { userId: true }
    });

    const ackUserIds = acknowledgedUsers.map(a => a.userId);
    const organizationId = req.user?.organizationId || req.tenant?.id;

    // Find active employees who have NOT acknowledged it
    const pendingUsers = await prisma.user.findMany({
      where: {
        ...(organizationId && { organizationId }),
        isActive: true,
        role: { not: 'SUPERADMIN' },
        id: { notIn: ackUserIds }
      }
    });

    const { createNotification } = require('../utils/notificationHelper');
    let sentCount = 0;

    for (const user of pendingUsers) {
      await createNotification({
        userId: user.id,
        title: 'Action Required: Policy Acknowledgment',
        message: `Please review and acknowledge the updated policy: ${policy.name}`,
        type: 'WARNING',
        link: '/employee/compliance'
      });
      sentCount++;
    }

    return res.status(200).json({ success: true, message: `Reminder sent to ${sentCount} employees.` });
  } catch (err) { next(err); }
};

// PATCH /api/admin/policies/:id/resolve
const resolvePolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    const policy = await prisma.policy.findUnique({ where: { id } });
    if (!policy) {
      return res.status(404).json({ success: false, error: { message: 'Policy not found.' } });
    }
    const newStatus = policy.status === 'Resolved' ? 'Active' : 'Resolved';
    const updated = await prisma.policy.update({
      where: { id },
      data: { status: newStatus },
    });
    return res.status(200).json({ success: true, data: updated, message: `Policy status updated to ${newStatus}.` });
  } catch (err) { next(err); }
};

// (ensureDefaultRoles is now imported from src/utils/roleSeeder.js)

const getRoles = async (req, res, next) => {
  try {
    await ensureDefaultRoles();
    const customRoles = await prisma.customRole.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { users: true }
        }
      }
    });
    const mapped = customRoles.map(r => {
      let parsedPerms = r.permissions || {};
      if (typeof parsedPerms === 'string') {
        try { parsedPerms = JSON.parse(parsedPerms); } catch (e) { }
      }
      return {
        ...r,
        permissions: parsedPerms,
        assignedUsersCount: r._count?.users || 0
      };
    });

    return res.status(200).json({ success: true, data: mapped });
  } catch (err) { next(err); }
};

const createRole = async (req, res, next) => {
  try {
    const { name, description, isCustom, permissions, inheritsFrom, landingPage, assignedUsers } = req.body;

    const role = await prisma.$transaction(async (tx) => {
      const createdRole = await tx.customRole.create({
        data: {
          name,
          description,
          isCustom: isCustom ?? true,
          permissions: typeof permissions === 'string' ? permissions : JSON.stringify(permissions || {}),
          inheritsFrom: inheritsFrom || 'EMPLOYEE',
          landingPage: landingPage || null,
          createdById: req.user?.userId
        }
      });

      if (Array.isArray(assignedUsers) && assignedUsers.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: assignedUsers } },
          data: { customRoleId: createdRole.id }
        });
      }

      return createdRole;
    });

    if (req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'CREATE_ROLE',
          details: `Created custom role: ${name}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    let parsedPerms = role.permissions;
    if (typeof parsedPerms === 'string') {
      try { parsedPerms = JSON.parse(parsedPerms); } catch (e) { }
    }
    return res.status(201).json({ success: true, data: { ...role, permissions: parsedPerms } });
  } catch (err) { next(err); }
};

const updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, isCustom, permissions, inheritsFrom, landingPage, status, assignedUsers } = req.body;

    const existing = await prisma.customRole.findUnique({ where: { id } });

    const role = await prisma.$transaction(async (tx) => {
      const updatedRole = await tx.customRole.update({
        where: { id },
        data: {
          name,
          description,
          isCustom,
          permissions: permissions ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : undefined,
          inheritsFrom,
          landingPage,
          status,
          updatedById: req.user?.userId,
          permissionVersion: existing ? existing.permissionVersion + 1 : 1
        }
      });

      if (Array.isArray(assignedUsers)) {
        // 1. Remove this customRoleId from users who are no longer in the assignedUsers list
        await tx.user.updateMany({
          where: {
            customRoleId: id,
            id: { notIn: assignedUsers }
          },
          data: { customRoleId: null }
        });

        // 2. Add this customRoleId to users in the assignedUsers list
        if (assignedUsers.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: assignedUsers } },
            data: { customRoleId: id }
          });
        }
      }

      return updatedRole;
    });

    if (req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE_ROLE',
          details: `Updated custom role: ${role.name}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    let parsedPerms = role.permissions;
    if (typeof parsedPerms === 'string') {
      try { parsedPerms = JSON.parse(parsedPerms); } catch (e) { }
    }
    return res.status(200).json({ success: true, data: { ...role, permissions: parsedPerms } });
  } catch (err) { next(err); }
};

const deleteRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Hard delete the custom role from the DB. Prisma's onDelete: SetNull will clear customRoleId on affected users automatically.
    const role = await prisma.customRole.delete({
      where: { id }
    });

    if (req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'DELETE_ROLE',
          details: `Deleted custom role: ${role.name}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({ success: true, message: 'Role deleted.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// HOLIDAYS
// ─────────────────────────────────────────

const getHolidays = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    let holidays = await prisma.holiday.findMany({
      where: organizationId ? {
        OR: [
          { calendar: { companyId: organizationId } },
          { calendarId: null }
        ]
      } : {},
      orderBy: { date: 'asc' }
    });

    // If no holidays exist yet, auto-seed standard company holidays
    if (holidays.length === 0) {
      const currentYear = new Date().getFullYear();
      const defaultHolidays = [
        { name: "New Year's Day", date: `${currentYear}-01-01`, type: "PUBLIC", region: "Global", status: "Passed", repeat: true, description: "Worldwide New Year Celebration" },
        { name: "Martin Luther King Jr. Day", date: `${currentYear}-01-19`, type: "PUBLIC", region: "USA", status: "Passed", repeat: true, description: "Federal Holiday" },
        { name: "Republic Day", date: `${currentYear}-01-26`, type: "PUBLIC", region: "India", status: "Passed", repeat: true, description: "National Holiday" },
        { name: "Good Friday", date: `${currentYear}-04-03`, type: "PUBLIC", region: "Global", status: "Upcoming", repeat: true, description: "Spring Holiday" },
        { name: "Easter Monday", date: `${currentYear}-04-06`, type: "PUBLIC", region: "Europe", status: "Upcoming", repeat: true, description: "Easter Celebration" },
        { name: "Memorial Day", date: `${currentYear}-05-25`, type: "PUBLIC", region: "USA", status: "Upcoming", repeat: true, description: "Federal Observance" },
        { name: "Independence Day", date: `${currentYear}-07-04`, type: "PUBLIC", region: "USA", status: "Upcoming", repeat: true, description: "US Independence Day" },
        { name: "Independence Day (India)", date: `${currentYear}-08-15`, type: "PUBLIC", region: "India", status: "Upcoming", repeat: true, description: "National Independence Day" },
        { name: "Labor Day", date: `${currentYear}-09-07`, type: "PUBLIC", region: "USA", status: "Upcoming", repeat: true, description: "Workforce Day" },
        { name: "Diwali / Deepavali", date: `${currentYear}-11-08`, type: "PUBLIC", region: "India", status: "Upcoming", repeat: true, description: "Festival of Lights" },
        { name: "Thanksgiving Day", date: `${currentYear}-11-26`, type: "PUBLIC", region: "USA", status: "Upcoming", repeat: true, description: "National Thanksgiving" },
        { name: "Christmas Day", date: `${currentYear}-12-25`, type: "PUBLIC", region: "Global", status: "Upcoming", repeat: true, description: "Christmas Holiday" },
      ];

      await prisma.holiday.createMany({
        data: defaultHolidays
      });

      holidays = await prisma.holiday.findMany({
        where: organizationId ? {
          OR: [
            { calendar: { companyId: organizationId } },
            { calendarId: null }
          ]
        } : {},
        orderBy: { date: 'asc' }
      });
    }

    return res.status(200).json({ success: true, data: holidays });
  } catch (err) { next(err); }
};

const createHoliday = async (req, res, next) => {
  try {
    const { name, date, type, region, status, repeat, description, calendarId } = req.body;
    let holidayType = 'PUBLIC';
    if (type) {
      const upper = type.toUpperCase();
      if (['PUBLIC', 'OPTIONAL', 'RESTRICTED', 'COMPANY'].includes(upper)) {
        holidayType = upper;
      }
    }
    const holiday = await prisma.holiday.create({
      data: {
        name: name || 'Holiday',
        date: String(date || new Date().toISOString().split('T')[0]),
        type: holidayType,
        region: region || 'All Regions',
        status: status || 'Upcoming',
        repeat: Boolean(repeat),
        description: description || null,
        ...(calendarId && { calendarId })
      }
    });
    return res.status(201).json({ success: true, data: holiday });
  } catch (err) { next(err); }
};

const updateHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, date, type, region, status, repeat, description, calendarId } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (date !== undefined) updateData.date = String(date);
    if (type !== undefined) {
      const upper = type.toUpperCase();
      if (['PUBLIC', 'OPTIONAL', 'RESTRICTED', 'COMPANY'].includes(upper)) {
        updateData.type = upper;
      }
    }
    if (region !== undefined) updateData.region = region;
    if (status !== undefined) updateData.status = status;
    if (repeat !== undefined) updateData.repeat = Boolean(repeat);
    if (description !== undefined) updateData.description = description;
    if (calendarId !== undefined) updateData.calendarId = calendarId || null;

    const holiday = await prisma.holiday.update({
      where: { id },
      data: updateData
    });
    return res.status(200).json({ success: true, data: holiday });
  } catch (err) { next(err); }
};

const deleteHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.holiday.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Holiday deleted.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// BENEFIT PLANS
// ─────────────────────────────────────────

const getBenefitPlans = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    let plans = await prisma.benefitPlan.findMany({
      where: organizationId ? {
        OR: [
          { organizationId },
          { organizationId: null }
        ]
      } : {},
      orderBy: { name: 'asc' },
      include: {
        employeeBenefits: true
      }
    });

    // Auto-seed default corporate benefit plans if none exist
    if (plans.length === 0) {
      const defaultPlans = [
        {
          name: 'Comprehensive Health & Dental',
          category: 'Insurance',
          provider: 'Blue Cross Shield',
          contribution: '$450/mo',
          eligibility: 'All Employees',
          status: 'Active',
          empContribution: '$50/mo',
          autoEnroll: true,
          description: 'Full medical, dental, and vision coverage with low copay.',
          organizationId: organizationId || null
        },
        {
          name: '401(k) Retirement Plan',
          category: 'Retirement',
          provider: 'Vanguard Group',
          contribution: '5% Match',
          eligibility: 'Full-time Only',
          status: 'Active',
          empContribution: 'Up to 10%',
          autoEnroll: false,
          description: 'Employer matching up to 5% with pre-tax and Roth options.',
          organizationId: organizationId || null
        },
        {
          name: 'Wellness & Gym Stipend',
          category: 'Wellness',
          provider: 'ActiveFit Global',
          contribution: '$75/mo',
          eligibility: 'All Employees',
          status: 'Active',
          empContribution: '$0/mo',
          autoEnroll: false,
          description: 'Monthly reimbursement for gym memberships and mental wellness apps.',
          organizationId: organizationId || null
        },
        {
          name: 'Remote Work Allowance',
          category: 'Allowance',
          provider: 'Company Direct',
          contribution: '$150/mo',
          eligibility: 'All Employees',
          status: 'Active',
          empContribution: '$0/mo',
          autoEnroll: true,
          description: 'Home office ergonomic equipment and high-speed internet stipend.',
          organizationId: organizationId || null
        }
      ];

      for (const p of defaultPlans) {
        await prisma.benefitPlan.create({ data: p });
      }

      plans = await prisma.benefitPlan.findMany({
        where: organizationId ? {
          OR: [
            { organizationId },
            { organizationId: null }
          ]
        } : {},
        orderBy: { name: 'asc' },
        include: {
          employeeBenefits: true
        }
      });
    }

    return res.status(200).json({ success: true, data: plans });
  } catch (err) { next(err); }
};

const createBenefitPlan = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const {
      name,
      category,
      provider,
      contribution,
      eligibility,
      status,
      empContribution,
      description,
      autoEnroll
    } = req.body;

    const plan = await prisma.benefitPlan.create({
      data: {
        name: name || 'Benefit Plan',
        category: category || 'Insurance',
        provider: provider || 'Corporate Provider',
        contribution: String(contribution || '0'),
        eligibility: eligibility || 'All Employees',
        status: status || 'Active',
        empContribution: String(empContribution || '0.00'),
        description: description || null,
        autoEnroll: Boolean(autoEnroll),
        organizationId: organizationId || null
      },
      include: {
        employeeBenefits: true
      }
    });

    try {
      const { createNotification } = require('../utils/notificationHelper');
      const users = await prisma.user.findMany({ 
        where: { 
          role: 'EMPLOYEE',
          ...(organizationId && { organizationId })
        } 
      });
      for (const u of users) {
        await createNotification({
          userId: u.id,
          title: 'Benefits Enrollment',
          message: `${plan.name} enrollment is now open.`,
          type: 'INFO',
          link: '/employee/benefits'
        });
      }
    } catch (notifErr) {
      console.error('Failed to trigger benefits enrollment notifications:', notifErr);
    }

    return res.status(201).json({ success: true, data: plan });
  } catch (err) { next(err); }
};

const updateBenefitPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      category,
      provider,
      contribution,
      eligibility,
      status,
      empContribution,
      description,
      autoEnroll
    } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (category !== undefined) data.category = category;
    if (provider !== undefined) data.provider = provider;
    if (contribution !== undefined) data.contribution = String(contribution);
    if (eligibility !== undefined) data.eligibility = eligibility;
    if (status !== undefined) data.status = status;
    if (empContribution !== undefined) data.empContribution = String(empContribution);
    if (description !== undefined) data.description = description;
    if (autoEnroll !== undefined) data.autoEnroll = Boolean(autoEnroll);

    const plan = await prisma.benefitPlan.update({
      where: { id },
      data,
      include: {
        employeeBenefits: true
      }
    });
    return res.status(200).json({ success: true, data: plan });
  } catch (err) { next(err); }
};

const deleteBenefitPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Delete any dependent employee benefit records first
    await prisma.employeeBenefit.deleteMany({
      where: { benefitPlanId: id }
    });
    await prisma.benefitPlan.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Benefit plan deleted successfully.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// AI CENTER
// ─────────────────────────────────────────

const getAiModules = async (req, res, next) => {
  try {
    const modules = await prisma.aiModule.findMany({ orderBy: { name: 'asc' } });
    const mapped = modules.map(m => ({
      ...m,
      settings: JSON.parse(m.settings || '{}')
    }));
    return res.status(200).json({ success: true, data: mapped });
  } catch (err) { next(err); }
};

const updateAiModule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, desc, status, confidence, settings } = req.body;
    const mod = await prisma.aiModule.update({
      where: { id },
      data: {
        name,
        desc,
        status,
        confidence,
        settings: settings ? JSON.stringify(settings) : undefined
      }
    });
    return res.status(200).json({ success: true, data: { ...mod, settings: JSON.parse(mod.settings) } });
  } catch (err) { next(err); }
};

const getAiLogs = async (req, res, next) => {
  try {
    const logs = await prisma.aiLog.findMany({ orderBy: { timestamp: 'desc' }, take: 50 });
    return res.status(200).json({ success: true, data: logs });
  } catch (err) { next(err); }
};

const createAiLog = async (req, res, next) => {
  try {
    const log = await prisma.aiLog.create({ data: req.body });
    return res.status(201).json({ success: true, data: log });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// SYSTEM INTEGRATIONS
// ─────────────────────────────────────────

const getIntegrations = async (req, res, next) => {
  try {
    const integrations = await prisma.integration.findMany({ orderBy: { name: 'asc' } });
    return res.status(200).json({ success: true, data: integrations });
  } catch (err) { next(err); }
};

const createIntegration = async (req, res, next) => {
  try {
    const integration = await prisma.integration.create({ data: req.body });
    return res.status(201).json({ success: true, data: integration });
  } catch (err) { next(err); }
};

const updateIntegration = async (req, res, next) => {
  try {
    const { id } = req.params;
    const integration = await prisma.integration.update({
      where: { id },
      data: req.body
    });
    return res.status(200).json({ success: true, data: integration });
  } catch (err) { next(err); }
};

const deleteIntegration = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.integration.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Integration deleted.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// BILLING & INVOICES
// ─────────────────────────────────────────

const getBillingPlan = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    let plan = await prisma.billingPlan.findFirst({
      where: organizationId ? { organizationId } : {}
    });
    if (!plan) {
      plan = await prisma.billingPlan.create({
        data: {
          organizationId,
          name: "Professional",
          price: 29,
          cycle: "Monthly",
          users: 42,
          addons: JSON.stringify(["Premium Support"])
        }
      });
    }
    return res.status(200).json({ success: true, data: { ...plan, addons: JSON.parse(plan.addons || "[]") } });
  } catch (err) { next(err); }
};

const updateBillingPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const { name, price, cycle, users, addons } = req.body;
    
    // Ensure plan belongs to organization if provided
    const existing = await prisma.billingPlan.findUnique({ where: { id } });
    if (existing && existing.organizationId && organizationId && existing.organizationId !== organizationId) {
      return res.status(403).json({ success: false, error: { message: "Unauthorized access to billing plan" } });
    }

    const plan = await prisma.billingPlan.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(price !== undefined && { price: Number(price) }),
        ...(cycle && { cycle }),
        ...(users !== undefined && { users: typeof users === 'number' ? users : parseInt(users) || 42 }),
        ...(addons && { addons: JSON.stringify(addons) })
      }
    });
    return res.status(200).json({ success: true, data: { ...plan, addons: JSON.parse(plan.addons || "[]") } });
  } catch (err) { next(err); }
};

const getInvoices = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    let invoices = await prisma.invoice.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { date: 'desc' }
    });

    if (invoices.length === 0) {
      await prisma.invoice.createMany({
        data: [
          { organizationId, amount: '$4,280.00', method: 'Visa •••• 4242', status: 'Paid', date: new Date('2026-10-01') },
          { organizationId, amount: '$4,280.00', method: 'Visa •••• 4242', status: 'Paid', date: new Date('2026-09-01') },
          { organizationId, amount: '$4,200.00', method: 'Visa •••• 4242', status: 'Paid', date: new Date('2026-08-01') },
          { organizationId, amount: '$4,200.00', method: 'Visa •••• 4242', status: 'Refunded', date: new Date('2026-07-01') },
        ]
      });
      invoices = await prisma.invoice.findMany({
        where: organizationId ? { organizationId } : {},
        orderBy: { date: 'desc' }
      });
    }
    return res.status(200).json({ success: true, data: invoices });
  } catch (err) { next(err); }
};

const createInvoice = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const invoice = await prisma.invoice.create({
      data: {
        ...req.body,
        organizationId
      }
    });
    return res.status(201).json({ success: true, data: invoice });
  } catch (err) { next(err); }
};

const updateInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { message: "Invoice not found" } });
    }
    if (existing.organizationId && organizationId && existing.organizationId !== organizationId) {
      return res.status(403).json({ success: false, error: { message: "Unauthorized invoice access" } });
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: req.body
    });
    return res.status(200).json({ success: true, data: invoice });
  } catch (err) { next(err); }
};

const deleteInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { message: "Invoice not found" } });
    }
    if (existing.organizationId && organizationId && existing.organizationId !== organizationId) {
      return res.status(403).json({ success: false, error: { message: "Unauthorized invoice access" } });
    }

    await prisma.invoice.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Invoice deleted.' });
  } catch (err) { next(err); }
};

const exportInvoices = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const invoices = await prisma.invoice.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { date: 'desc' }
    });

    // CSV Header
    let csv = 'ID,Date,Amount,Method,Status\n';

    invoices.forEach(inv => {
      const row = [
        inv.id,
        new Date(inv.date).toISOString().split('T')[0],
        `"${inv.amount}"`,
        `"${inv.method}"`,
        inv.status
      ];
      csv += row.join(',') + '\n';
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('invoices.csv');
    return res.status(200).send(csv);
  } catch (err) { next(err); }
};

const getPaymentMethod = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    let pm = await prisma.organizationPaymentMethod.findFirst({
      where: organizationId ? { organizationId } : {}
    });

    if (!pm && organizationId) {
      pm = await prisma.organizationPaymentMethod.create({
        data: {
          organizationId,
          type: 'Visa',
          last4: '4242',
          expiry: '12/28',
          cardholder: 'Enterprise Client',
          isDefault: true
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: pm || {
        type: 'Visa',
        last4: '4242',
        expiry: '12/28',
        cardholder: 'Enterprise Client'
      }
    });
  } catch (err) { next(err); }
};

const savePaymentMethod = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const { type, last4, expiry, cardholder } = req.body;

    if (!organizationId) {
      return res.status(400).json({ success: false, error: { message: "Organization context required" } });
    }

    let pm = await prisma.organizationPaymentMethod.findFirst({
      where: { organizationId }
    });

    if (pm) {
      pm = await prisma.organizationPaymentMethod.update({
        where: { id: pm.id },
        data: { type, last4, expiry, cardholder }
      });
    } else {
      pm = await prisma.organizationPaymentMethod.create({
        data: {
          organizationId,
          type: type || 'Visa',
          last4: last4 || '4242',
          expiry: expiry || '12/28',
          cardholder: cardholder || 'Enterprise Client',
          isDefault: true
        }
      });
    }

    return res.status(200).json({ success: true, data: pm, message: 'Payment method updated successfully.' });
  } catch (err) { next(err); }
};

// ATTENDANCE & LEAVES
const getAllAttendance = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const { date, departmentId } = req.query;

    const where = {};
    if (organizationId) {
      where.user = { organizationId };
    }
    if (date) {
      const targetDate = new Date(date);
      const startOfDay = new Date(new Date(targetDate).setHours(0, 0, 0, 0));
      const endOfDay = new Date(new Date(targetDate).setHours(23, 59, 59, 999));
      where.date = { gte: startOfDay, lte: endOfDay };
    }
    if (departmentId) {
      where.user = {
        ...where.user,
        employeeProfile: { departmentId }
      };
    }

    const logs = await prisma.attendanceLog.findMany({
      where,
      include: {
        user: {
          include: {
            employeeProfile: {
              include: {
                department: true,
              }
            }
          }
        }
      },
      orderBy: { date: 'desc' }
    });
    return res.status(200).json({ success: true, data: logs });
  } catch (err) { next(err); }
};

const addManualAttendance = async (req, res, next) => {
  try {
    const { userId, date, clockIn, clockOut, status, mode, totalWorkedMin } = req.body;
    
    let finalWorkedMin = totalWorkedMin || 0;
    let breakMinutes = 0;

    const logDate = new Date(date);
    const dateOnlyStr = typeof date === 'string' ? date.split('T')[0] : logDate.toISOString().split('T')[0];
    const startOfDay = new Date(`${dateOnlyStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateOnlyStr}T23:59:59.999Z`);

    let parsedClockIn = null;
    if (clockIn) {
      if (clockIn.includes('T')) {
        parsedClockIn = new Date(clockIn);
      } else {
        parsedClockIn = new Date(`${dateOnlyStr}T${clockIn.length === 5 ? clockIn + ':00' : clockIn}Z`);
      }
    } else {
      parsedClockIn = new Date(`${dateOnlyStr}T09:00:00.000Z`);
    }

    let parsedClockOut = null;
    if (clockOut) {
      if (clockOut.includes('T')) {
        parsedClockOut = new Date(clockOut);
      } else {
        parsedClockOut = new Date(`${dateOnlyStr}T${clockOut.length === 5 ? clockOut + ':00' : clockOut}Z`);
      }
    }

    if (parsedClockOut && parsedClockIn && !finalWorkedMin) {
      finalWorkedMin = Math.max(0, Math.floor((parsedClockOut.getTime() - parsedClockIn.getTime()) / 60000));
    }

    if (parsedClockOut) {
      const employee = await prisma.employeeProfile.findUnique({ 
        where: { userId }, 
        select: { shiftId: true } 
      });
      
      let shift = null;
      if (employee?.shiftId) {
        shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
      } else {
        shift = await prisma.shift.findFirst({ where: { isDefault: true } });
      }

      if (shift) {
        breakMinutes = shift.breakDurationMin;
        if (finalWorkedMin > (shift.workingHoursMin / 2)) {
          finalWorkedMin = Math.max(0, finalWorkedMin - breakMinutes);
        }
      }
    }

    // Upsert if a record already exists for this user on this day
    const existing = await prisma.attendanceLog.findFirst({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay }
      }
    });

    let log;
    if (existing) {
      log = await prisma.attendanceLog.update({
        where: { id: existing.id },
        data: {
          clockIn: parsedClockIn,
          clockOut: parsedClockOut,
          status: status || 'Present',
          mode: mode || 'Office',
          totalWorkedMin: finalWorkedMin,
          breakMinutes
        },
        include: { user: { include: { employeeProfile: { include: { department: true } } } } }
      });
    } else {
      log = await prisma.attendanceLog.create({
        data: {
          userId,
          date: logDate,
          clockIn: parsedClockIn,
          clockOut: parsedClockOut,
          status: status || 'Present',
          mode: mode || 'Office',
          totalWorkedMin: finalWorkedMin,
          breakMinutes
        },
        include: { user: { include: { employeeProfile: { include: { department: true } } } } }
      });
    }

    return res.status(201).json({ success: true, data: log, message: 'Attendance record saved.' });
  } catch (err) { next(err); }
};

const updateAttendance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, clockIn, clockOut, totalWorkedMin, mode } = req.body;

    const existing = await prisma.attendanceLog.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { message: 'Attendance record not found' } });
    }

    const data = {};
    if (status !== undefined) data.status = status;
    if (mode !== undefined) data.mode = mode;
    if (clockIn !== undefined) data.clockIn = clockIn ? new Date(clockIn) : null;
    if (clockOut !== undefined) data.clockOut = clockOut ? new Date(clockOut) : null;
    if (totalWorkedMin !== undefined) data.totalWorkedMin = totalWorkedMin;

    const updated = await prisma.attendanceLog.update({
      where: { id },
      data,
      include: {
        user: {
          include: {
            employeeProfile: {
              include: {
                department: true,
              }
            }
          }
        }
      }
    });

    return res.status(200).json({ success: true, data: updated, message: 'Attendance updated.' });
  } catch (err) { next(err); }
};

const deleteAttendance = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.attendanceLog.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Attendance record deleted.' });
  } catch (err) { next(err); }
};

const getAllLeaves = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const leaves = await prisma.leaveRequest.findMany({
      where: organizationId ? { user: { organizationId } } : {},
      include: { user: { include: { employeeProfile: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return res.status(200).json({ success: true, data: leaves });
  } catch (err) { next(err); }
};

const reviewLeave = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminComment, hrComment } = req.body;

    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave not found.' } });

    // --- GENERIC APPROVAL ENGINE INTEGRATION ---
    const orgId = req.user.organizationId;
    const workflowActive = await isWorkflowEnabled('LeaveRequest', orgId);

    if (workflowActive) {
      try {
        const action = status === 'REJECTED' ? 'REJECT' : 'APPROVE';
        const comment = adminComment || hrComment || '';
        const result = await processApproval('LeaveRequest', leave.id, req.user.userId, action, comment);

        let newLeaveStatus = 'MANAGER_APPROVED';
        if (result.finalized) {
          newLeaveStatus = action === 'REJECT' ? 'REJECTED' : 'APPROVED';
        } else {
          const nextRole = result.nextStepConfig?.approverRole?.toUpperCase() || '';
          if (nextRole === 'HR') {
            newLeaveStatus = 'MANAGER_APPROVED';
          } else if (nextRole === 'ADMIN') {
            newLeaveStatus = 'HR_APPROVED';
          } else {
            newLeaveStatus = 'Pending';
          }
        }

        const updatedLeave = await prisma.leaveRequest.update({
          where: { id: leave.id },
          data: { status: newLeaveStatus },
          include: { user: { include: { employeeProfile: true } } }
        });
        return res.status(200).json({ success: true, data: updatedLeave, message: `Leave ${action.toLowerCase()}d via Generic Engine.`, workflowResult: result });
      } catch (workflowErr) {
        if (workflowErr.message === "No pending approval found for this entity.") {
          console.warn(`[Approval Engine] Skipping generic approval for ${leave.id}:`, workflowErr.message);
          // Fallthrough to legacy logic
        } else {
          return res.status(400).json({ success: false, message: workflowErr.message });
        }
      }
    }

    // --- LEGACY LOGIC ---
    const updatedLeave = await prisma.leaveRequest.update({
      where: { id },
      data: { status },
      include: { user: { include: { employeeProfile: true } } }
    });
    return res.status(200).json({ success: true, data: updatedLeave });
  } catch (err) { next(err); }
};

// GET /api/admin/resignations
// GET /api/admin/resignations
const getAdminResignations = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const resignations = await prisma.exitLifecycle.findMany({
      where: {
        exitType: 'RESIGNATION',
        ...(organizationId ? { employee: { OR: [{ organizationId }, { user: { organizationId } }] } } : {})
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            fullName: true,
            avatarUrl: true,
            department: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.status(200).json({ success: true, data: resignations });
  } catch (err) { next(err); }
};

// PATCH /api/admin/resignations/:id/override
const overrideResignation = async (req, res, next) => {
  try {
    const { status, adminComment } = req.body;
    const exitId = req.params.id;
    const organizationId = req.user?.organizationId || req.tenant?.id;

    const validStatuses = [
      'PENDING_MANAGER_APPROVAL',
      'PENDING_HR_APPROVAL',
      'APPROVED',
      'REJECTED_BY_MANAGER',
      'REJECTED_BY_HR',
      'EMPLOYEE_RELIEVED',
      'INITIATED',
      'CLEARANCE_IN_PROGRESS',
      'COMPLETED',
      'CANCELLED'
    ];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid status for admin override.' } });
    }

    const existingExit = await prisma.exitLifecycle.findFirst({
      where: {
        id: exitId,
        exitType: 'RESIGNATION',
        ...(organizationId ? { employee: { OR: [{ organizationId }, { user: { organizationId } }] } } : {})
      },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeId: true, userId: true }
        }
      }
    });

    if (!existingExit) {
      return res.status(404).json({ success: false, error: { message: 'Resignation record not found or access denied.' } });
    }

    const previousStatus = existingExit.status;

    // Update resignation record
    const updated = await prisma.exitLifecycle.update({
      where: { id: exitId },
      data: {
        status,
        hrComment: adminComment ? `[ADMIN OVERRIDE] ${adminComment}` : existingExit.hrComment,
        hrDecisionDate: new Date()
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            fullName: true,
            avatarUrl: true,
            department: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } }
          }
        }
      }
    });

    // Synchronize employee lifecycle status based on new resignation status
    if (existingExit.employeeId) {
      let targetLifecycleStatus = null;
      if (['APPROVED', 'CLEARANCE_IN_PROGRESS', 'PENDING_HR_APPROVAL'].includes(status)) {
        targetLifecycleStatus = 'ON_NOTICE';
      } else if (['EMPLOYEE_RELIEVED', 'COMPLETED'].includes(status)) {
        targetLifecycleStatus = 'RESIGNED';
      } else if (['REJECTED_BY_MANAGER', 'REJECTED_BY_HR', 'CANCELLED'].includes(status)) {
        targetLifecycleStatus = 'ACTIVE';
      }

      if (targetLifecycleStatus) {
        await prisma.employeeProfile.update({
          where: { id: existingExit.employeeId },
          data: { lifecycleStatus: targetLifecycleStatus }
        });
      }
    }

    // Create Audit Log
    const currentUserId = req.user?.id || req.user?.userId;
    if (currentUserId) {
      await prisma.auditLog.create({
        data: {
          userId: currentUserId,
          organizationId: organizationId || null,
          action: 'RESIGNATION_OVERRIDDEN',
          details: `Admin overridden resignation status for ${existingExit.employee?.fullName || 'Employee'} (${existingExit.employee?.employeeId || exitId}) from ${previousStatus} to ${status}.${adminComment ? ` Reason: ${adminComment}` : ''}`,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
        }
      });
    }

    return res.status(200).json({ success: true, data: updated, message: 'Resignation overridden successfully.' });
  } catch (err) { next(err); }
};

module.exports = {
  getDashboardStats,
  getOrganization, createOrganization, updateOrganization,
  updateOrganizationLogo, deleteOrganizationLogo,
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  getAllUsers, createUser, updateUser, changeUserRole, revokeUserRole, toggleUserActive, deleteUser,
  getAllPayslips, generatePayslip, markPayslipPaid,
  getAuditLogs,
  getPolicies, createPolicy, updatePolicy, deletePolicy,
  toggleArchivePolicy,
  renewPolicy,
  sendPolicyReminder,
  resolvePolicy,
  getRoles, createRole, updateRole, deleteRole, getRoleHistory,
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
  getBenefitPlans, createBenefitPlan, updateBenefitPlan, deleteBenefitPlan,
  getAiModules, updateAiModule, getAiLogs, createAiLog,
  getIntegrations, createIntegration, updateIntegration, deleteIntegration,
  getBillingPlan, updateBillingPlan, getInvoices, createInvoice, updateInvoice, deleteInvoice, exportInvoices,
  getPaymentMethod, savePaymentMethod,
  getAllAttendance, addManualAttendance, updateAttendance, deleteAttendance, getAllLeaves, reviewLeave,
  getAdminResignations, overrideResignation
};
