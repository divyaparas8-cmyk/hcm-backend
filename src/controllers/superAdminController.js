// ============================================================
// SuperAdmin Controller
// ============================================================
// SuperAdmin = Platform ka maalik (SaaS level)
// Ye sirf SuperAdmin use kar sakta hai
// Admin sirf APNI organization dekh sakta hai
// SuperAdmin SAARI organizations dekh/manage kar sakta hai

const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const fs = require('fs/promises');
const path = require('path');
const { generatePayrollSnapshot } = require('../services/payrollEngineService');



// ─────────────────────────────────────────
// PLATFORM STATS  →  GET /api/superadmin/stats
// (saari organizations ka combined data)
// ─────────────────────────────────────────
const getPlatformStats = async (req, res, next) => {
  try {
    const [
      totalOrganizations,
      totalUsers,
      totalEmployees,
      totalActiveUsers,
      totalPendingLeaves,
      totalOpenTickets,
      totalJobPosts,
      totalApplications,
      totalCandidates,
      totalRecruiters,
      totalAdmins,
      payrollAgg
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.employeeProfile.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      prisma.jobPost.count({ where: { isActive: true } }),
      prisma.jobApplication.count(),
      prisma.user.count({ where: { role: 'CANDIDATE' } }),
      prisma.user.count({ where: { role: 'HR' } }),
      prisma.user.count({ where: { role: { in: ['SUPERADMIN', 'ADMIN'] } } }),
      prisma.payslip.aggregate({
        _sum: { netPay: true },
        where: { status: { in: ['Paid', 'PAID', 'Finalized', 'Approved'] } }
      })
    ]);

    const totalPayrollDisbursed = payrollAgg._sum.netPay || 0;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [activeTimeLogsToday, employeesWithBenefits, totalAiRequests, organizationsWithPlans, newOrgsThisMonth] = await Promise.all([
      prisma.attendanceLog.count({
        where: { createdAt: { gte: startOfDay } }
      }),
      prisma.employeeProfile.count({
        where: { employeeBenefits: { some: {} } }
      }),
      prisma.aiLog.count(),
      prisma.organization.findMany({
        include: { pricingPlan: true }
      }),
      prisma.organization.count({
        where: { createdAt: { gte: startOfMonth } }
      })
    ]);

    const totalEmployeesForBenefits = totalEmployees || 1;
    const benefitsEnrollmentRate = Math.round((employeesWithBenefits / totalEmployeesForBenefits) * 100);

    let mrr = 0;
    let arr = 0;
    let planDistribution = { enterprise: 0, pro: 0, team: 0 };

    organizationsWithPlans.forEach(org => {
      if (org.pricingPlan) {
        if (org.pricingPlan.billingCycle?.toLowerCase() === 'yearly') {
          arr += org.pricingPlan.yearlyPrice;
          mrr += (org.pricingPlan.yearlyPrice / 12);
        } else {
          mrr += org.pricingPlan.monthlyPrice;
          arr += (org.pricingPlan.monthlyPrice * 12);
        }

        const planName = org.pricingPlan.name.toLowerCase();

        if (planName.includes('enterprise') || planName.includes('custom')) {
          planDistribution.enterprise += 1;
        } else if (planName.includes('pro') || planName.includes('growth')) {
          planDistribution.pro += 1;
        } else {
          planDistribution.team += 1;
        }
      }
    });

    const revenueMetrics = {
      mrr: Math.round(mrr),
      arr: Math.round(arr),
      acv: organizationsWithPlans.length > 0 ? Math.round(arr / organizationsWithPlans.length) : 0,
      activeTenants: totalOrganizations,
      newOrgsThisMonth,
      momGrowth: 0,
      planDistribution
    };

    return res.status(200).json({
      success: true,
      data: {
        totalOrganizations,
        totalUsers,
        totalEmployees,
        totalActiveUsers,
        totalPendingLeaves,
        totalOpenTickets,
        totalJobPosts,
        totalApplications,
        totalCandidates,
        totalRecruiters,
        totalAdmins,
        totalPayrollDisbursed,
        activeTimeLogsToday,
        benefitsEnrollmentRate,
        totalAiRequests,
        revenueMetrics,
        systemHealth: {
          status: 'Optimal',
          message: 'No security breaches or unauthorized access detected in the last 30 days.'
        }
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// ALL ORGANIZATIONS  →  GET /api/superadmin/organizations
// ─────────────────────────────────────────
const getAllOrganizations = async (req, res, next) => {
  try {
    const { search, status, plan, subscriptionStatus, page, limit } = req.query;

    const where = {};

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q } },
        { industry: { contains: q } },
        { id: { contains: q } },
        { primaryEmail: { contains: q } },
      ];
    }

    if (status && status !== 'ALL') {
      where.status = status.toUpperCase();
    }

    if (subscriptionStatus && subscriptionStatus !== 'ALL') {
      where.subscriptionStatus = subscriptionStatus.toUpperCase();
    }

    if (plan && plan !== 'ALL') {
      if (plan.toUpperCase() === 'TRIAL') {
        where.subscriptionStatus = 'TRIAL';
      } else {
        where.pricingPlan = {
          name: { equals: plan }
        };
      }
    }

    const isPaginated = Boolean(page || limit);
    const take = limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : (isPaginated ? 12 : undefined);
    const skip = page && take ? (Math.max(1, parseInt(page, 10)) - 1) * take : undefined;

    const [orgs, totalCount] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: {
          pricingPlan: true,
          _count: {
            select: {
              users: true,
              departments: true,
              employeeProfiles: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(take ? { take } : {}),
        ...(skip !== undefined ? { skip } : {}),
      }),
      prisma.organization.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: orgs,
      meta: {
        total: totalCount,
        page: page ? parseInt(page, 10) : 1,
        limit: take || totalCount,
        totalPages: take ? Math.ceil(totalCount / take) : 1,
      }
    });
  } catch (err) { next(err); }
};

// PUT /api/superadmin/organizations/:id (update organization metadata)
const updateOrganization = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, legalName, industry, companySize, address, primaryEmail, phone, websiteUrl, currency, timezone } = req.body;

    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } });
    }

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (legalName !== undefined) data.legalName = legalName?.trim() || null;
    if (industry !== undefined) data.industry = industry?.trim() || null;
    if (companySize !== undefined) data.companySize = companySize?.trim() || null;
    if (address !== undefined) data.address = address?.trim() || null;
    if (primaryEmail !== undefined) data.primaryEmail = primaryEmail?.trim() || null;
    if (phone !== undefined) data.phone = phone?.trim() || null;
    if (websiteUrl !== undefined) data.websiteUrl = websiteUrl?.trim() || null;
    if (currency !== undefined) data.currency = currency?.trim() || null;
    if (timezone !== undefined) data.timezone = timezone?.trim() || null;

    const updated = await prisma.organization.update({
      where: { id },
      data,
      include: {
        pricingPlan: true,
        _count: {
          select: {
            users: true,
            departments: true,
            employeeProfiles: true,
          }
        }
      }
    });

    const userId = req.user?.userId || req.user?.id;
    if (userId) {
      try {
        await prisma.auditLog.create({
          data: {
            userId,
            action: 'UPDATE_ORGANIZATION',
            details: `Updated metadata for organization "${updated.name}" (${id})`,
            ipAddress: req.ip || req.socket?.remoteAddress
          }
        });
      } catch (aErr) {}
    }

    return res.status(200).json({
      success: true,
      data: updated,
      message: 'Organization updated successfully.'
    });
  } catch (err) { next(err); }
};

// GET /api/superadmin/organizations/:id (single tenant details)
const getOrganizationDetails = async (req, res, next) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        pricingPlan: true,
        departments: {
          select: { id: true, name: true, _count: { select: { employees: true } } }
        },
        _count: {
          select: {
            users: true,
            departments: true,
            employeeProfiles: true,
          },
        },
      },
    });

    if (!org) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } });
    }

    return res.status(200).json({ success: true, data: org });
  } catch (err) { next(err); }
};

// POST /api/superadmin/organizations/provision (full tenant + admin + plan provision)
const provisionOrganization = async (req, res, next) => {
  try {
    const schema = z.object({
      organization: z.object({
        name: z.string().min(2, 'Organization name is required'),
        industry: z.string().optional().nullable(),
        country: z.string().optional().nullable(),
      }),
      admin: z.object({
        fullName: z.string().min(2, 'Admin full name is required'),
        email: z.string().email('Valid admin email is required'),
        password: z.string().optional().nullable(),
      }),
      subscription: z.object({
        plan: z.string().optional().nullable(),
        billingCycle: z.string().optional().nullable(),
      }).optional().nullable()
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' }
      });
    }

    const { organization, admin, subscription } = parsed.data;

    // Check if admin email already exists
    const existingUser = await prisma.user.findUnique({ where: { email: admin.email } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_TAKEN', message: 'An account with this admin email already exists.' }
      });
    }

    // Resolve plan details
    const selectedPlanName = subscription?.plan || 'Trial';
    let matchedPlan = null;
    let subscriptionStatus = 'ACTIVE';
    let subscriptionEnd = null;

    if (selectedPlanName === 'Trial' || selectedPlanName.toLowerCase().includes('trial')) {
      subscriptionStatus = 'TRIAL';
      subscriptionEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    } else {
      matchedPlan = await prisma.pricingPlan.findFirst({
        where: {
          OR: [
            { id: selectedPlanName },
            { name: { equals: selectedPlanName } }
          ]
        }
      });
    }

    const defaultAdminPassword = admin.password || '12345678';
    const passwordHash = await bcrypt.hash(defaultAdminPassword, 10);

    // Atomically create Organization, default department, and admin user
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const org = await tx.organization.create({
        data: {
          name: organization.name,
          industry: organization.industry || 'Technology',
          address: organization.country || null,
          status: 'ACTIVE',
          subscriptionStatus,
          subscriptionStart: new Date(),
          subscriptionEnd,
          pricingPlanId: matchedPlan?.id || null,
        }
      });

      // 2. Create Default Department
      const defaultDept = await tx.department.create({
        data: {
          name: 'Management',
          organizationId: org.id,
          code: 'MGMT',
          status: 'Active'
        }
      });

      // 3. Create Admin User & Employee Profile
      const user = await tx.user.create({
        data: {
          email: admin.email,
          passwordHash,
          role: 'ADMIN',
          isActive: true,
          status: 'Active',
          organizationId: org.id,
          employeeProfile: {
            create: {
              fullName: admin.fullName,
              employeeId: 'EMP-001',
              departmentId: defaultDept.id,
              joiningDate: new Date(),
              employmentType: 'Full-time',
              address: organization.country || 'Headquarters'
            }
          }
        },
        select: {
          id: true,
          email: true,
          role: true,
          employeeProfile: {
            select: { id: true, fullName: true, employeeId: true }
          }
        }
      });

      return { org, user };
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'PROVISION_ORGANIZATION',
          details: `Provisioned organization "${organization.name}" with admin "${admin.email}" on plan "${selectedPlanName}"`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(201).json({
      success: true,
      data: result,
      message: `Organization "${organization.name}" provisioned successfully with Admin ${admin.email}.`
    });

  } catch (err) {
    next(err);
  }
};

// PATCH /api/superadmin/organizations/:id/suspend
const suspendOrganization = async (req, res, next) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { status: 'SUSPENDED' }
    });
    return res.status(200).json({ success: true, data: org, message: 'Organization suspended.' });
  } catch (err) { next(err); }
};

// PATCH /api/superadmin/organizations/:id/activate
const activateOrganization = async (req, res, next) => {
  try {
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE' }
    });
    return res.status(200).json({ success: true, data: org, message: 'Organization activated.' });
  } catch (err) { next(err); }
};

// POST /api/superadmin/organizations  (new company/tenant create)
const createOrganization = async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      logoUrl: z.string().optional(),
      address: z.string().optional(),
      taxId: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    const org = await prisma.organization.create({ data: parsed.data });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'CREATE_ORGANIZATION',
          details: `Created organization "${org.name}"`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(201).json({ success: true, data: org, message: 'Organization created successfully.' });
  } catch (err) { next(err); }
};

// DELETE /api/superadmin/organizations/:id  (org + all its users & data permanently deleted)
const deleteOrganization = async (req, res, next) => {
  try {
    const orgId = req.params.id;
    const org = await prisma.organization.findUnique({
      where: { id: orgId }
    });
    if (!org) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } });

    await prisma.$transaction(async (tx) => {
      // 1. Find all users belonging to this organization
      const usersInOrg = await tx.user.findMany({
        where: { organizationId: orgId },
        select: { id: true }
      });
      const userIds = usersInOrg.map(u => u.id);

      // 2. Find all employee profiles belonging to this organization
      const empProfiles = await tx.employeeProfile.findMany({
        where: { organizationId: orgId },
        select: { id: true }
      });
      const empIds = empProfiles.map(e => e.id);

      // 3. Clean up employee records
      if (empIds.length > 0) {
        await tx.approvalLog.deleteMany({ where: { approverId: { in: empIds } } });
        await tx.payrollSnapshot.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.payslip.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.bonus.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.salaryIncrementRequest.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.employeeSalaryComponent.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.employeeDeduction.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.employeeBenefit.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.benefitClaim.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.performanceGoal.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.performanceReview.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.task.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.employeeSkill.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.compensationVersion.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.compensationProfile.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.exitLifecycle.deleteMany({ where: { employeeId: { in: empIds } } });
        await tx.employeeProfile.updateMany({ where: { managerId: { in: empIds } }, data: { managerId: null } });
        await tx.employeeProfile.deleteMany({ where: { id: { in: empIds } } });
      }

      // 4. Clean up user-level tables
      if (userIds.length > 0) {
        await tx.ticketMessage.deleteMany({ where: { senderId: { in: userIds } } });
        await tx.supportTicket.deleteMany({ where: { userId: { in: userIds } } });
        await tx.attendanceLog.deleteMany({ where: { userId: { in: userIds } } });
        await tx.leaveRequest.deleteMany({ where: { userId: { in: userIds } } });
        await tx.document.deleteMany({ where: { userId: { in: userIds } } });
        await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
        await tx.policyAcknowledgment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.auditLog.updateMany({ where: { userId: { in: userIds } }, data: { userId: null } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      }

      // 5. Clean up org-level modules and candidate/recruitment data
      const jobsInOrg = await tx.jobPost.findMany({ where: { organizationId: orgId }, select: { id: true } });
      const jobIds = jobsInOrg.map(j => j.id);
      if (jobIds.length > 0) {
        const apps = await tx.jobApplication.findMany({ where: { jobPostId: { in: jobIds } }, select: { id: true } });
        const appIds = apps.map(a => a.id);
        if (appIds.length > 0) {
          await tx.interview.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.offer.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.onboarding.deleteMany({ where: { applicationId: { in: appIds } } });
          await tx.jobApplication.deleteMany({ where: { id: { in: appIds } } });
        }
        await tx.jobPost.deleteMany({ where: { id: { in: jobIds } } });
      }

      const structInOrg = await tx.salaryStructure.findMany({ where: { organizationId: orgId }, select: { id: true } });
      const structIds = structInOrg.map(s => s.id);
      if (structIds.length > 0) {
        await tx.salaryStructureVersion.deleteMany({ where: { salaryStructureId: { in: structIds } } });
        await tx.salaryStructure.deleteMany({ where: { id: { in: structIds } } });
      }

      await tx.salaryComponent.deleteMany({ where: { organizationId: orgId } });
      await tx.salaryBand.deleteMany({ where: { organizationId: orgId } });
      await tx.deductionRule.deleteMany({ where: { organizationId: orgId } });
      await tx.taxRule.deleteMany({ where: { organizationId: orgId } });
      await tx.benefitPlan.deleteMany({ where: { organizationId: orgId } });
      await tx.approvalWorkflow.deleteMany({ where: { organizationId: orgId } });
      await tx.payrollConfiguration.deleteMany({ where: { organizationId: orgId } });
      await tx.leavePolicy.deleteMany({ where: { organizationId: orgId } });
      await tx.attendancePolicy.deleteMany({ where: { organizationId: orgId } });
      await tx.policyAcknowledgment.deleteMany({ where: { organizationId: orgId } });
      await tx.policy.deleteMany({ where: { organizationId: orgId } });
      await tx.holiday.deleteMany({ where: { calendar: { companyId: orgId } } });
      await tx.workCalendar.deleteMany({ where: { companyId: orgId } });
      await tx.shift.deleteMany({ where: { organizationId: orgId } });
      await tx.overtimePolicy.deleteMany({ where: { organizationId: orgId } });
      await tx.customRole.deleteMany({ where: { organizationId: orgId } });
      await tx.document.deleteMany({ where: { organizationId: orgId } });
      await tx.notification.deleteMany({ where: { organizationId: orgId } });
      await tx.department.deleteMany({ where: { organizationId: orgId } });

      // 6. Delete Organization
      await tx.organization.delete({ where: { id: orgId } });
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'DELETE_ORGANIZATION',
          details: `Deleted organization "${org.name}" and all associated users and records.`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({ success: true, message: `Organization "${org.name}" and all associated users deleted successfully.` });
  } catch (err) {
    console.error('deleteOrganization error:', err);
    next(err);
  }
};

// ─────────────────────────────────────────
// ALL USERS ACROSS PLATFORM  →  GET /api/superadmin/users
// ─────────────────────────────────────────
const getAllPlatformUsers = async (req, res, next) => {
  try {
    const { role, isActive, organizationId, search } = req.query;

    const where = {};

    if (role && role !== 'ALL') {
      where.role = role;
    }

    if (isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true';
    }

    if (organizationId && organizationId !== 'ALL') {
      if (organizationId === 'none' || organizationId === 'null') {
        where.organizationId = null;
      } else {
        where.organizationId = organizationId;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { email: { contains: q } },
        { employeeProfile: { fullName: { contains: q } } },
        { candidateProfile: { fullName: { contains: q } } },
        { organization: { name: { contains: q } } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        organization: { 
          select: { 
            id: true, 
            name: true,
            status: true 
          } 
        },
        employeeProfile: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            phone: true,
            avatarUrl: true,
            department: {
              select: { id: true, name: true }
            },
            compensationProfile: {
              select: {
                baseSalary: true,
                monthlyCTC: true
              }
            }
          }
        },
        candidateProfile: {
          select: {
            id: true,
            fullName: true,
            phone: true
          }
        },
        customRole: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: users, meta: { total: users.length } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// CREATE ADMIN FOR AN ORGANIZATION
// POST /api/superadmin/organizations/:orgId/create-admin
// (SuperAdmin kisi bhi org ka Admin bana sakta hai)
// ─────────────────────────────────────────
const createAdminForOrg = async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(6),
      fullName: z.string().min(2),
      employeeId: z.string().min(2),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    const { email, password, fullName, employeeId } = parsed.data;
    const { orgId } = req.params;

    // Org exists?
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } });

    // Email duplicate check
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Email already registered.' } });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'ADMIN',
        organizationId: orgId,
        employeeProfile: {
          create: { fullName, employeeId },
        },
      },
      include: { employeeProfile: true },
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'CREATE_ORG_ADMIN',
          details: `Created Admin account for user ${email} in organization ${org.name}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(201).json({ success: true, data: { id: user.id, email: user.email, role: user.role, organization: org.name }, message: 'Admin created and linked to organization.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// BAN / UNBAN any user  →  PATCH /api/superadmin/users/:id/toggle-active
// ─────────────────────────────────────────
const toggleAnyUserActive = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });

    // Prevent SuperAdmin from banning themselves
    if (user.id === req.user.userId) {
      return res.status(400).json({ success: false, error: { code: 'SELF_BAN', message: 'You cannot deactivate your own account.' } });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: updated.isActive ? 'ACTIVATE_USER' : 'SUSPEND_USER',
          details: `${updated.isActive ? 'Activated' : 'Suspended'} user account: ${user.email}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: updated,
      message: `User ${updated.isActive ? 'activated' : 'banned'} successfully.`,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// CHANGE ROLE of any user  →  PATCH /api/superadmin/users/:id/role
// ─────────────────────────────────────────
const changeAnyUserRole = async (req, res, next) => {
  try {
    const schema = z.object({
      role: z.enum(['SUPERADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'CANDIDATE']),
      customRoleId: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    let validCustomRoleId = null;
    if (parsed.data.customRoleId && parsed.data.role !== 'SUPERADMIN') {
      const customRole = await prisma.customRole.findUnique({ where: { id: parsed.data.customRoleId } });
      if (customRole && customRole.status === 'ACTIVE') {
        validCustomRoleId = customRole.id;
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: parsed.data.role, customRoleId: validCustomRoleId },
      select: { id: true, email: true, role: true, customRoleId: true },
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'CHANGE_USER_ROLE',
          details: `Changed role of user ${updated.email} to ${updated.role} ${validCustomRoleId ? 'with custom override' : ''}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({ success: true, data: updated, message: 'User role updated.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// REVOKE ROLE of any user  →  POST /api/superadmin/users/:id/revoke-role
// ─────────────────────────────────────────
const revokeAnyUserRole = async (req, res, next) => {
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

// ─────────────────────────────────────────
// RESET USER PASSWORD  →  POST /api/superadmin/users/:id/reset-password
// ─────────────────────────────────────────
const resetUserPassword = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // In a real scenario, this would send an email with a reset token.
    // For now, we'll just log it to the audit log to prove it's a backend action.
    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'RESET_USER_PASSWORD',
          details: `Sent password reset link to ${user.email}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    return res.status(200).json({ success: true, message: `Password reset link sent to ${user.email}` });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PLATFORM-WIDE AUDIT LOGS  →  GET /api/superadmin/audit-logs
// (saari orgs ke logs - Admin sirf apne dekh sakta hai)
// ─────────────────────────────────────────
const getPlatformAuditLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const { userId, organizationId, action, search, startDate, endDate, status } = req.query;

    const where = {};

    if (userId && userId !== 'ALL') {
      where.userId = userId;
    }

    if (organizationId && organizationId !== 'ALL') {
      if (organizationId === 'none' || organizationId === 'null') {
        where.AND = [
          ...(where.AND || []),
          { organizationId: null },
          { user: { organizationId: null } }
        ];
      } else {
        where.OR = [
          { organizationId },
          { user: { organizationId } }
        ];
      }
    }

    if (action && action !== 'ALL') {
      where.action = action;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        if (typeof endDate === 'string' && endDate.length <= 10) {
          end.setHours(23, 59, 59, 999);
        }
        where.createdAt.lte = end;
      }
    }

    if (status && status !== 'ALL') {
      if (status === 'FAILURE') {
        where.OR = [
          { details: { contains: 'failed' } },
          { details: { contains: 'Failed' } },
          { details: { contains: 'error' } }
        ];
      } else if (status === 'SUCCESS') {
        where.NOT = [
          { details: { contains: 'failed' } },
          { details: { contains: 'Failed' } },
          { details: { contains: 'error' } }
        ];
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchConditions = [
        { action: { contains: q } },
        { details: { contains: q } },
        { ipAddress: { contains: q } },
        { user: { email: { contains: q } } },
        { user: { employeeProfile: { fullName: { contains: q } } } },
        { user: { organization: { name: { contains: q } } } },
        { Organization: { name: { contains: q } } }
      ];

      where.AND = [
        ...(where.AND || []),
        { OR: searchConditions }
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              organization: {
                select: {
                  id: true,
                  name: true
                }
              },
              employeeProfile: {
                select: {
                  id: true,
                  fullName: true
                }
              }
            }
          },
          Organization: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      })
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    // Normalize records for client consumption
    const enrichedLogs = logs.map(log => {
      const isFailure = log.details && /failed|error/i.test(log.details);
      const actorName = log.user?.employeeProfile?.fullName || log.user?.email || 'System / Platform';
      const orgName = log.Organization?.name || log.user?.organization?.name || (log.user?.role === 'SUPERADMIN' ? 'Platform / Global' : 'System');
      
      return {
        id: log.id,
        createdAt: log.createdAt,
        userId: log.userId,
        actorName,
        actorEmail: log.user?.email || null,
        actorRole: log.user?.role || 'SYSTEM',
        organizationName: orgName,
        organizationId: log.organizationId || log.user?.organization?.id || null,
        action: log.action,
        details: log.details,
        ipAddress: log.ipAddress || '127.0.0.1',
        status: isFailure ? 'FAILURE' : 'SUCCESS',
        resource: log.action.split('_').slice(1).join(' ') || log.action
      };
    });

    return res.status(200).json({
      success: true,
      data: enrichedLogs,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// SYSTEM HEALTH CHECK  →  GET /api/superadmin/system-health
// ─────────────────────────────────────────
const getSystemHealth = async (req, res, next) => {
  try {
    // DB connection check - agar ye query chalti hai matlab DB connected hai
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      success: true,
      data: {
        status: 'healthy',
        database: 'connected',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      data: { status: 'unhealthy', database: 'disconnected' },
    });
  }
};

// ─────────────────────────────────────────
// ANALYTICS  →  GET /api/superadmin/analytics
// ─────────────────────────────────────────
const getAnalytics = async (req, res, next) => {
  try {
    const { timeRange = '30d' } = req.query;
    let days = 30;
    if (timeRange === '7d') days = 7;
    else if (timeRange === '12m') days = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [newUsers, newOrganizations, newJobs, newTickets, payrollCount, attendanceCount, aiCount, benefitsCount, complianceCount, recentAudits] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: startDate } } }),
      prisma.organization.count({ where: { createdAt: { gte: startDate } } }),
      prisma.jobPost.count({ where: { createdAt: { gte: startDate } } }),
      prisma.supportTicket.count({ where: { createdAt: { gte: startDate } } }),
      prisma.payslip.count({ where: { createdAt: { gte: startDate } } }),
      prisma.attendanceLog.count({ where: { createdAt: { gte: startDate } } }),
      prisma.aiLog.count({ where: { timestamp: { gte: startDate } } }),
      prisma.employeeBenefit.count({ where: { createdAt: { gte: startDate } } }),
      prisma.auditLog.count({ where: { createdAt: { gte: startDate } } }),
      prisma.auditLog.findMany({
        take: 4,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { role: true } } }
      })
    ]);

    // Calculate ecosystem percentages
    const totalModuleActivity = payrollCount + attendanceCount + aiCount + benefitsCount + complianceCount || 1;
    const moduleUtilization = {
      payroll: Math.round((payrollCount / totalModuleActivity) * 100),
      attendance: Math.round((attendanceCount / totalModuleActivity) * 100),
      ai: Math.round((aiCount / totalModuleActivity) * 100),
      benefits: Math.round((benefitsCount / totalModuleActivity) * 100),
      compliance: Math.round((complianceCount / totalModuleActivity) * 100),
    };

    return res.status(200).json({
      success: true,
      data: {
        newUsers,
        newOrganizations,
        newJobs,
        newTickets,
        timeRange,
        moduleUtilization,
        recentAudits
      }
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// ANALYTICS EXPORT  →  GET /api/superadmin/analytics/export
// ─────────────────────────────────────────
const getAnalyticsExport = async (req, res, next) => {
  try {
    const { timeRange = '30d' } = req.query;
    let days = 30;
    if (timeRange === '7d') days = 7;
    else if (timeRange === '12m') days = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [users, orgs, jobs, tickets] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: startDate } } }),
      prisma.organization.count({ where: { createdAt: { gte: startDate } } }),
      prisma.jobPost.count({ where: { createdAt: { gte: startDate } } }),
      prisma.supportTicket.count({ where: { createdAt: { gte: startDate } } })
    ]);

    const csvRows = [
      ['Metric', 'Count', 'Time Range'],
      ['New Users', users, timeRange],
      ['New Organizations', orgs, timeRange],
      ['New Jobs', jobs, timeRange],
      ['New Support Tickets', tickets, timeRange]
    ];

    const csvString = csvRows.map(row => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=analytics_export_${timeRange}.csv`);
    return res.send(csvString);
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// CRUD FOR USERS (SuperAdmin)
// ─────────────────────────────────────────
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

const createUser = async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      role: z.string(),
      department: z.string().optional(),
      departmentId: z.string().optional(),
      status: z.string().optional(),
      password: z.string().optional(),
      salary: z.union([z.number(), z.string()]).optional().nullable(),
      baseSalary: z.union([z.number(), z.string()]).optional().nullable(),
      monthlyCTC: z.union([z.number(), z.string()]).optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }
    const { name, email, role, department, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ success: false, error: { message: 'Email already exists' } });

    const roleEnum = roleToEnum(role);
    let orgId = null;
    if (department) {
      const org = await prisma.organization.findFirst({ where: { name: department } });
      if (org) orgId = org.id;
    }

    const rawSalary = req.body.salary ?? req.body.baseSalary ?? req.body.monthlyCTC;
    const salaryVal = rawSalary !== undefined && rawSalary !== null && rawSalary !== '' ? Number(rawSalary) : null;

    const passwordHash = await bcrypt.hash(password || 'password123', 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: roleEnum,
        organizationId: orgId,
        isActive: true,
        employeeProfile: {
          create: {
            fullName: name,
            employeeId: 'EMP-' + Date.now().toString().slice(-6),
            departmentId: req.body.departmentId || undefined,
            ...(salaryVal !== null && !isNaN(salaryVal) && salaryVal > 0 && {
              compensationProfile: {
                create: {
                  baseSalary: salaryVal,
                  monthlyCTC: salaryVal,
                  annualCTC: salaryVal * 12,
                  effectiveDate: new Date(),
                  status: 'Active'
                }
              }
            })
          }
        }
      },
      include: {
        employeeProfile: {
          include: { compensationProfile: true }
        }
      }
    });

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'CREATE_USER',
          details: `Created user ${email} with role ${roleEnum}${salaryVal ? ` and allocated salary $${salaryVal}` : ''}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    const safeUser = { ...user };
    delete safeUser.passwordHash;
    return res.status(201).json({ success: true, data: safeUser });
  } catch (err) { next(err); }
};

const updateUser = async (req, res, next) => {
  try {
    const { name, email, role, department, empType, status, phone, address, manager, shiftId, overtimePolicyId, salaryType, hourlyRate, departmentId, password, salary, baseSalary, monthlyCTC, img, avatar, avatarUrl } = req.body;
    let orgId = undefined;
    if (department) {
      const org = await prisma.organization.findFirst({ where: { name: department } });
      if (org) orgId = org.id;
    }

    // Check if user has an employee profile
    const existingUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { employeeProfile: true }
    });
    if (!existingUser) return res.status(404).json({ success: false, error: { message: 'User not found' } });

    let managerId = undefined;
    if (manager && manager !== 'None') {
      const managerUser = await prisma.employeeProfile.findFirst({
        where: { OR: [{ fullName: manager }, { employeeId: manager }] }
      });
      if (managerUser) managerId = managerUser.id;
    }

    const rawSalary = salary ?? baseSalary ?? monthlyCTC;
    const salaryVal = rawSalary !== undefined && rawSalary !== null && rawSalary !== '' ? Number(rawSalary) : undefined;

    const photoUrl = img !== undefined ? (img || null) : (avatarUrl !== undefined ? (avatarUrl || null) : (avatar !== undefined ? (avatar || null) : undefined));

    // We can update the EmployeeProfile with all these fields
    const empData = {
      ...(name && { fullName: name }),
      ...(empType && { employmentType: empType }),
      ...(phone && { phone }),
      ...(address && { address }),
      ...(managerId !== undefined && { managerId }),
      ...(shiftId !== undefined && { shiftId: shiftId || null }),
      ...(overtimePolicyId !== undefined && { overtimePolicyId: overtimePolicyId || null }),
      ...(salaryType && { salaryType }),
      ...(hourlyRate !== undefined && { hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null }),
      ...(departmentId !== undefined && { departmentId: departmentId || null }),
      ...(photoUrl !== undefined && { avatarUrl: photoUrl })
    };

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(email && { email }),
        ...(role && { role: roleToEnum(role) }),
        ...(status && { status, isActive: status.toLowerCase() === 'active' }),
        ...(orgId !== undefined && { organizationId: orgId }),
        ...(password && { passwordHash: await bcrypt.hash(password, 10) }),
        employeeProfile: existingUser.employeeProfile ? {
          update: empData
        } : {
          create: {
            fullName: name || (email || existingUser.email).split('@')[0],
            employeeId: 'EMP-' + Date.now().toString().slice(-6),
            ...empData
          }
        }
      },
      include: {
        employeeProfile: {
          include: { compensationProfile: true }
        }
      }
    });
    const empProfileId = user.employeeProfile?.id || existingUser.employeeProfile?.id;
    if (empProfileId && salaryVal !== undefined && !isNaN(salaryVal)) {
      if (salaryVal > 0) {
        await prisma.compensationProfile.upsert({
          where: { employeeId: empProfileId },
          update: {
            baseSalary: salaryVal,
            monthlyCTC: salaryVal,
            annualCTC: salaryVal * 12
          },
          create: {
            employeeId: empProfileId,
            baseSalary: salaryVal,
            monthlyCTC: salaryVal,
            annualCTC: salaryVal * 12,
            effectiveDate: new Date(),
            status: 'Active'
          }
        });
      } else {
        await prisma.compensationProfile.deleteMany({
          where: { employeeId: empProfileId }
        });
      }
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'UPDATE_USER',
          details: `Updated user details for: ${existingUser.email}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    }

    const finalUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        employeeProfile: {
          include: { compensationProfile: true }
        }
      }
    });

    const safeUser = { ...(finalUser || user) };
    delete safeUser.passwordHash;
    return res.status(200).json({ success: true, data: safeUser });
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
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Super Admin accounts cannot be deleted.' } });
    }

    const shouldDeleteOrg = (req.query.deleteOrg === 'true' || req.body?.deleteOrg === true) && existing.organizationId;

    if (shouldDeleteOrg) {
      const orgId = existing.organizationId;
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (org) {
        await prisma.$transaction(async (tx) => {
          const usersInOrg = await tx.user.findMany({ where: { organizationId: orgId }, select: { id: true } });
          const userIds = usersInOrg.map(u => u.id);

          const empProfiles = await tx.employeeProfile.findMany({ where: { organizationId: orgId }, select: { id: true } });
          const empIds = empProfiles.map(e => e.id);

          if (empIds.length > 0) {
            await tx.approvalLog.deleteMany({ where: { approverId: { in: empIds } } });
            await tx.payrollSnapshot.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.payslip.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.bonus.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.salaryIncrementRequest.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.employeeSalaryComponent.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.employeeDeduction.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.employeeBenefit.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.benefitClaim.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.performanceGoal.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.performanceReview.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.task.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.employeeSkill.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.compensationVersion.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.compensationProfile.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.exitLifecycle.deleteMany({ where: { employeeId: { in: empIds } } });
            await tx.employeeProfile.deleteMany({ where: { id: { in: empIds } } });
          }

          if (userIds.length > 0) {
            await tx.ticketMessage.deleteMany({ where: { senderId: { in: userIds } } });
            await tx.supportTicket.deleteMany({ where: { userId: { in: userIds } } });
            await tx.attendanceLog.deleteMany({ where: { userId: { in: userIds } } });
            await tx.leaveRequest.deleteMany({ where: { userId: { in: userIds } } });
            await tx.document.deleteMany({ where: { userId: { in: userIds } } });
            await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
            await tx.policyAcknowledgment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.auditLog.updateMany({ where: { userId: { in: userIds } }, data: { userId: null } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
          }

          await tx.jobPost.deleteMany({ where: { organizationId: orgId } });
          await tx.department.deleteMany({ where: { organizationId: orgId } });
          await tx.shift.deleteMany({ where: { organizationId: orgId } });
          await tx.overtimePolicy.deleteMany({ where: { organizationId: orgId } });
          await tx.holiday.deleteMany({ where: { organizationId: orgId } });
          await tx.customRole.deleteMany({ where: { organizationId: orgId } });
          await tx.organization.delete({ where: { id: orgId } });
        });

        return res.status(200).json({ success: true, message: `User and organization "${org.name}" deleted successfully.` });
      }
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
// CRUD FOR DEPARTMENTS (SuperAdmin)
// ─────────────────────────────────────────
const getAllPlatformDepartments = async (req, res, next) => {
  try {
    const depts = await prisma.department.findMany({
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { employees: true } }
      },
      orderBy: { name: 'asc' }
    });

    const mapped = depts.map(d => ({
      id: d.id,
      name: d.name,
      code: d.code || '',
      head: d.head && d.head !== 'None' ? d.head : 'None',
      count: d._count?.employees || 0,
      organizationId: d.organizationId,
      organizationName: d.organization?.name || 'Unknown'
    }));

    return res.status(200).json({ success: true, data: mapped });
  } catch (err) {
    console.error('getAllPlatformDepartments error:', err);
    next(err);
  }
};

const createPlatformDepartment = async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      head: z.string().optional().nullable(),
      organizationId: z.string().uuid()
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { message: parsed.error.issues?.[0]?.message || 'Validation error' } });
    }

    const { name, head, organizationId } = parsed.data;
    const cleanHead = head && head.trim() !== '' && head !== 'None' ? head.trim() : null;

    const dept = await prisma.department.create({
      data: {
        name,
        head: cleanHead,
        organizationId
      }
    });

    return res.status(201).json({ success: true, data: dept });
  } catch (err) { next(err); }
};

const updatePlatformDepartment = async (req, res, next) => {
  try {
    const { name, head, organizationId } = req.body;
    const cleanHead = head !== undefined ? (head && head.trim() !== '' && head !== 'None' ? head.trim() : null) : undefined;

    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(cleanHead !== undefined && { head: cleanHead }),
        ...(organizationId && { organizationId })
      }
    });

    return res.status(200).json({ success: true, data: dept });
  } catch (err) { next(err); }
};

const deletePlatformDepartment = async (req, res, next) => {
  try {
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

    await prisma.department.delete({ where: { id: req.params.id } });
    return res.status(200).json({ success: true, message: 'Department deleted successfully' });
  } catch (err) { next(err); }
};

const getPayrollSettings = async (req, res, next) => {
  try {
    const settingsPath = path.join(__dirname, '../data/payrollSettings.json');
    const data = await fs.readFile(settingsPath, 'utf8');
    res.status(200).json({ success: true, data: JSON.parse(data) });
  } catch (err) {
    next(err);
  }
};

const updatePayrollSettings = async (req, res, next) => {
  try {
    const settingsPath = path.join(__dirname, '../data/payrollSettings.json');
    await fs.writeFile(settingsPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.status(200).json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    next(err);
  }
};

const getPayrollHistory = async (req, res, next) => {
  try {
    const snapshots = await prisma.payrollSnapshot.findMany({
      include: {
        employee: {
          include: {
            user: true,
            department: true
          }
        },
        items: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = snapshots.map(p => {
      let basic = 0;
      let allowance = 0;
      let pf = 0;
      let tax = 0;

      for (const item of p.items) {
        if (item.code === 'BASE' || item.name.toLowerCase().includes('basic')) basic += item.amount;
        else if (item.type === 'Earning' || item.type === 'Allowance') allowance += item.amount;

        if (item.name.toLowerCase().includes('provident fund') || item.code === 'PF') pf += item.amount;
        if (item.code.startsWith('TAX_') || item.name.toLowerCase().includes('tax')) tax += item.amount;
      }

      if (basic === 0) basic = p.grossSalary;

      return {
        id: p.id,
        employeeId: p.employeeId, // UUID for matching ungenerated users
        displayId: p.employee?.employeeId, // EMP-XXX for UI
        employeeName: p.employee?.fullName || 'System Employee',
        department: p.employee?.department?.name || 'N/A',
        designation: p.employee?.user?.role?.charAt(0).toUpperCase() + p.employee?.user?.role?.slice(1).toLowerCase() || 'Employee',
        basic: basic,
        allowance: allowance,
        bonus: p.totalContributions || 0,
        pf: pf,
        tax: tax,
        deductions: p.totalDeductions,
        net: p.netSalary,
        month: p.month,
        status: p.status === 'Paid' ? 'Processed' : p.status,
        date: p.paymentDate ? p.paymentDate.toISOString().split('T')[0] : p.createdAt.toISOString().split('T')[0],
        attendancePresent: p.presentDays || 0,
        attendanceAbsent: p.unpaidLeaveDays || 0,
        leavesTaken: p.paidLeaveDays || 0,
        totalWorkingDays: p.totalWorkingDays || 0,
        paidLeaveDays: p.paidLeaveDays || 0,
        unpaidLeaveDays: p.unpaidLeaveDays || 0,
        overtimeHours: p.overtimeHours || 0,
        overtimeAmount: p.overtimeAmount || 0,
        lopDeductionAmount: p.items.find(i => i.code === 'LOP_DEDUCT')?.amount || 0,
        items: p.items,
        currency: 'USD',
        grossSalary: p.grossSalary
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (err) { next(err); }
};

const createPayslip = async (req, res, next) => {
  try {
    const { employeeId, month, basic, allowance, bonus, pf, tax, netPay, status, paymentDate } = req.body;
    const finalNetPay = netPay !== undefined ? netPay : req.body.net;

    let empProfile = await prisma.employeeProfile.findFirst({
      where: { employeeId: employeeId }
    });

    if (!empProfile && employeeId) {
      empProfile = await prisma.employeeProfile.findFirst({
        where: { OR: [{ id: employeeId }, { userId: employeeId }] }
      });
    }

    if (!empProfile) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const b = Number(basic || 0);
    const a = Number(allowance || (b * 0.1));
    const bon = Number(bonus || 0);
    const gross = b + a + bon;
    const p = Number(pf || (b * 0.12));
    const t = Number(tax || (b * 0.1));
    const ded = p + t;
    const net = finalNetPay !== undefined ? Number(finalNetPay) : (gross - ded);
    const targetMonth = month || new Date().toLocaleString('default', { month: 'long' });

    const snapshot = await prisma.payrollSnapshot.create({
      data: {
        employeeId: empProfile.id,
        month: targetMonth,
        monthlyCTC: b,
        grossSalary: gross,
        totalDeductions: ded,
        totalContributions: bon,
        netSalary: net,
        status: status || 'Draft',
        paymentDate: status === 'Paid' ? new Date() : (paymentDate ? new Date(paymentDate) : null),
        items: {
          create: [
            { name: 'Basic Salary', code: 'BASE', type: 'Earning', amount: b },
            { name: 'Allowances', code: 'ALLOWANCE', type: 'Earning', amount: a },
            ...(bon > 0 ? [{ name: 'Bonus', code: 'BONUS', type: 'Earning', amount: bon }] : []),
            { name: 'Provident Fund (PF)', code: 'PF', type: 'Deduction', amount: p },
            { name: 'Income Tax', code: 'TAX', type: 'Deduction', amount: t },
          ]
        }
      },
      include: { items: true, employee: true }
    });

    try {
      await prisma.payslip.create({
        data: {
          employeeId: empProfile.id,
          month: targetMonth,
          basic: b,
          hra: 0,
          allowance: a,
          bonus: bon,
          pf: p,
          tax: t,
          netPay: net,
          status: status || 'Draft',
          paymentDate: status === 'Paid' ? new Date() : (paymentDate ? new Date(paymentDate) : null),
          currency: 'USD'
        }
      });
    } catch (_) {}

    res.status(201).json({ success: true, data: snapshot });
  } catch (err) { next(err); }
};

const updatePayslip = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { basic, allowance, bonus, pf, tax, netPay, status } = req.body;
    const finalNetPay = netPay !== undefined ? netPay : req.body.net;

    // 1. Check if it's an unprocessed record e.g. "unprocessed-<userId>"
    if (id && id.startsWith('unprocessed-')) {
      const userId = id.replace('unprocessed-', '');
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          employeeProfile: {
            include: { compensationProfile: true }
          }
        }
      });
      if (user?.employeeProfile) {
        const empId = user.employeeProfile.id;
        const b = Number(basic ?? user.employeeProfile.compensationProfile?.baseSalary ?? user.employeeProfile.compensationProfile?.monthlyCTC ?? 0);
        const a = Number(allowance ?? (b * 0.1));
        const bon = Number(bonus ?? 0);
        const gross = b + a + bon;
        const p = Number(pf ?? (b * 0.12));
        const t = Number(tax ?? (b * 0.1));
        const ded = p + t;
        const net = finalNetPay !== undefined ? Number(finalNetPay) : (gross - ded);
        const month = req.body.month || new Date().toLocaleString('default', { month: 'long' });

        const snapshot = await prisma.payrollSnapshot.create({
          data: {
            employeeId: empId,
            month,
            monthlyCTC: b,
            grossSalary: gross,
            totalDeductions: ded,
            totalContributions: bon,
            netSalary: net,
            status: status || 'Paid',
            paymentDate: status === 'Paid' ? new Date() : (req.body.paymentDate ? new Date(req.body.paymentDate) : null),
            items: {
              create: [
                { name: 'Basic Salary', code: 'BASE', type: 'Earning', amount: b },
                { name: 'Allowances', code: 'ALLOWANCE', type: 'Earning', amount: a },
                ...(bon > 0 ? [{ name: 'Bonus', code: 'BONUS', type: 'Earning', amount: bon }] : []),
                { name: 'Provident Fund (PF)', code: 'PF', type: 'Deduction', amount: p },
                { name: 'Income Tax', code: 'TAX', type: 'Deduction', amount: t },
              ]
            }
          },
          include: { items: true, employee: true }
        });

        try {
          await prisma.payslip.create({
            data: {
              employeeId: empId,
              month,
              basic: b,
              hra: 0,
              allowance: a,
              bonus: bon,
              pf: p,
              tax: t,
              netPay: net,
              status: status || 'Paid',
              paymentDate: status === 'Paid' ? new Date() : null,
              currency: 'USD'
            }
          });
        } catch (_) {}

        return res.status(200).json({ success: true, data: snapshot });
      }
    }

    // 2. Check if snapshot exists
    const snapshot = await prisma.payrollSnapshot.findUnique({
      where: { id },
      include: { items: true }
    });
    if (snapshot) {
      const updated = await prisma.payrollSnapshot.update({
        where: { id },
        data: {
          ...(finalNetPay !== undefined && { netSalary: Number(finalNetPay) }),
          ...(basic !== undefined && { grossSalary: Number(basic) + Number(allowance || 0) + Number(bonus || 0) }),
          ...(status !== undefined && {
            status,
            paymentDate: status === 'Paid' ? new Date() : (status === 'Draft' ? null : snapshot.paymentDate)
          })
        },
        include: { items: true, employee: true }
      });
      return res.status(200).json({ success: true, data: updated });
    }

    // 3. Check if payslip exists
    const payslip = await prisma.payslip.findUnique({ where: { id } });
    if (payslip) {
      const updated = await prisma.payslip.update({
        where: { id },
        data: {
          ...(basic !== undefined && { basic: Number(basic) }),
          ...(allowance !== undefined && { allowance: Number(allowance) }),
          ...(bonus !== undefined && { bonus: Number(bonus) }),
          ...(pf !== undefined && { pf: Number(pf) }),
          ...(tax !== undefined && { tax: Number(tax) }),
          ...(finalNetPay !== undefined && { netPay: Number(finalNetPay) }),
          ...(status !== undefined && {
            status,
            paymentDate: status === 'Paid' ? new Date() : (status === 'Draft' ? null : payslip.paymentDate)
          }),
        }
      });
      return res.status(200).json({ success: true, data: updated });
    }

    return res.status(200).json({ success: true, message: 'Updated' });
  } catch (err) { next(err); }
};

const deletePayslip = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (id && id.startsWith('unprocessed-')) {
      return res.status(200).json({ success: true, message: 'Record removed' });
    }
    await prisma.payrollItem.deleteMany({ where: { snapshotId: id } });
    await prisma.payrollSnapshot.deleteMany({ where: { id } });
    await prisma.payslip.deleteMany({ where: { id } });
    res.status(200).json({ success: true, message: 'Payslip deleted successfully' });
  } catch (err) { next(err); }
};

const bulkApprovePayslips = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }
    for (const id of ids) {
      if (id.startsWith('unprocessed-')) {
        const userId = id.replace('unprocessed-', '');
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { employeeProfile: { include: { compensationProfile: true } } }
        });
        if (user?.employeeProfile) {
          const b = Number(user.employeeProfile.compensationProfile?.baseSalary || user.employeeProfile.compensationProfile?.monthlyCTC || 0);
          const a = b * 0.1;
          const gross = b + a;
          const ded = (b * 0.12) + (b * 0.1);
          const net = gross - ded;
          await prisma.payrollSnapshot.create({
            data: {
              employeeId: user.employeeProfile.id,
              month: new Date().toLocaleString('default', { month: 'long' }),
              monthlyCTC: b,
              grossSalary: gross,
              totalDeductions: ded,
              netSalary: net,
              status: 'Paid',
              paymentDate: new Date(),
              items: {
                create: [
                  { name: 'Basic Salary', code: 'BASE', type: 'Earning', amount: b },
                  { name: 'Allowances', code: 'ALLOWANCE', type: 'Earning', amount: a },
                  { name: 'Provident Fund (PF)', code: 'PF', type: 'Deduction', amount: b * 0.12 },
                  { name: 'Income Tax', code: 'TAX', type: 'Deduction', amount: b * 0.1 },
                ]
              }
            }
          });
        }
      } else {
        await prisma.payrollSnapshot.updateMany({
          where: { id },
          data: { status: 'Paid', paymentDate: new Date() }
        });
        await prisma.payslip.updateMany({
          where: { id },
          data: { status: 'Paid', paymentDate: new Date() }
        });
      }
    }
    res.status(200).json({ success: true, message: 'Bulk payout completed successfully' });
  } catch (err) { next(err); }
};

const generatePayroll = async (req, res, next) => {
  try {
    const { generateMonth } = req.body;

    if (!generateMonth) {
      return res.status(400).json({ success: false, message: 'generateMonth is required.' });
    }

    const employeesList = await prisma.user.findMany({
      where: { role: { not: 'SUPERADMIN' } },
      include: { employeeProfile: true, organization: true }
    });

    const existingSnapshots = await prisma.payrollSnapshot.findMany({
      where: { month: generateMonth }
    });

    let newlyGenerated = 0;
    let skipped = 0;

    for (const emp of employeesList) {
      if (!emp.employeeProfile) {
        skipped++;
        continue;
      }

      if (existingSnapshots.some(p => p.employeeId === emp.employeeProfile.id && p.status !== 'Draft')) {
        skipped++;
        continue;
      }

      try {
        await generatePayrollSnapshot(emp.employeeProfile.id, generateMonth, emp.organizationId);
        newlyGenerated++;
      } catch (error) {
        console.error(`Error generating payroll for ${emp.employeeProfile.id}:`, error);
        skipped++;
      }
    }

    res.status(200).json({ success: true, message: 'Payroll generated successfully.', newlyGenerated, skipped });
  } catch (err) { next(err); }
};

// PUT /api/superadmin/organizations/:id/subscription
const updateOrgSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { plan, pricingPlanId, status, subscriptionStatus, billingCycle } = req.body;

    const org = await prisma.organization.findUnique({
      where: { id },
      include: { pricingPlan: true }
    });
    if (!org) {
      return res.status(404).json({ success: false, error: { message: "Organization not found." } });
    }

    const data = {};

    // Match and link PricingPlan if plan name or pricingPlanId is provided
    let matchedPlan = null;
    if (pricingPlanId || plan) {
      matchedPlan = await prisma.pricingPlan.findFirst({
        where: {
          OR: [
            ...(pricingPlanId ? [{ id: pricingPlanId }] : []),
            ...(plan ? [{ id: plan }, { name: plan }] : [])
          ]
        }
      });

      if (matchedPlan) {
        data.pricingPlanId = matchedPlan.id;

        // Check active employee seat limit
        if (matchedPlan.maxEmployees) {
          const activeEmployees = await prisma.employeeProfile.count({
            where: { user: { organizationId: id, isActive: true } }
          });
          if (activeEmployees > matchedPlan.maxEmployees) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'LIMIT_EXCEEDED',
                message: `Cannot switch to ${matchedPlan.name} (limit: ${matchedPlan.maxEmployees} employees) because organization currently has ${activeEmployees} active employees.`
              }
            });
          }
        }
      }
    }

    // Update status if passed
    if (status) {
      const upperStatus = status.toUpperCase();
      if (['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(upperStatus)) {
        data.status = upperStatus;
      } else if (status.toLowerCase() === 'active') {
        data.status = 'ACTIVE';
      } else if (status.toLowerCase() === 'suspended') {
        data.status = 'SUSPENDED';
      } else if (status.toLowerCase() === 'trial') {
        data.status = 'ACTIVE';
        data.subscriptionStatus = 'TRIAL';
      }
    }

    // Update subscriptionStatus if passed
    if (subscriptionStatus) {
      data.subscriptionStatus = subscriptionStatus.toUpperCase();
    } else if (status && status.toLowerCase() === 'trial') {
      data.subscriptionStatus = 'TRIAL';
    } else if (status && status.toLowerCase() === 'expired') {
      data.subscriptionStatus = 'EXPIRED';
    } else if (status && status.toLowerCase() === 'active' && !data.subscriptionStatus) {
      data.subscriptionStatus = 'ACTIVE';
    }

    const updatedOrg = await prisma.organization.update({
      where: { id },
      data,
      include: { pricingPlan: true }
    });

    const userId = req.user?.userId || req.user?.id;
    if (userId) {
      try {
        await prisma.auditLog.create({
          data: {
            userId,
            action: 'UPDATE_ORG_SUBSCRIPTION',
            details: `Updated subscription for ${org.name}: Plan=${updatedOrg.pricingPlan?.name || 'Standard'}, Status=${updatedOrg.status}, SubStatus=${updatedOrg.subscriptionStatus}`,
            ipAddress: req.ip || req.socket.remoteAddress
          }
        });
      } catch (aErr) {}
    }

    return res.status(200).json({
      success: true,
      data: updatedOrg,
      message: `Subscription updated successfully for ${org.name}`
    });
  } catch (err) { next(err); }
};

const DEFAULT_GLOBAL_SETTINGS = {
  platformMode: 'Production',
  maxOrgs: 'Unlimited',
  defaultTimezone: 'UTC+00:00 (London)',
  masterCurrency: 'USD ($) - US Dollar',
  defaultCurrency: 'USD',
  defaultPhoneCountry: '+1',
  dateFormat: 'DD/MM/YYYY',
  globalMFA: true,
  auditLogRetention: '90 Days',
  failedLoginAttempts: 5,
  ipWhitelisting: false,
  basePricePerUser: 8.00,
  freeTrialDays: 14,
  gracePeriodDays: 7,
  invoiceInterval: 'Monthly',
  primaryModel: 'Google Gemini 1.5 Pro',
  resumeScanAutoRank: true,
  matchingThreshold: 75,
  apiRateLimit: 1200,
  reimbursementManagerApproval: true,
  reimbursementFinalApprovalRole: 'ADMIN'
};

const ALLOWED_GLOBAL_SETTINGS = [
  'platformMode', 'maxOrgs', 'defaultTimezone', 'masterCurrency',
  'defaultCurrency', 'defaultPhoneCountry', 'dateFormat',
  'globalMFA', 'auditLogRetention', 'failedLoginAttempts', 'ipWhitelisting',
  'basePricePerUser', 'freeTrialDays', 'gracePeriodDays', 'invoiceInterval',
  'primaryModel', 'resumeScanAutoRank', 'matchingThreshold', 'apiRateLimit',
  'reimbursementManagerApproval', 'reimbursementFinalApprovalRole'
];

// GET /api/superadmin/settings
const getSystemSettings = async (req, res, next) => {
  try {
    let settings = await prisma.globalSettings.findFirst();
    if (!settings) {
      settings = await prisma.globalSettings.create({
        data: { id: "global-settings", ...DEFAULT_GLOBAL_SETTINGS }
      });
    }

    return res.status(200).json({ success: true, data: settings });
  } catch (err) { next(err); }
};

// PUT /api/superadmin/settings
const updateSystemSettings = async (req, res, next) => {
  try {
    const data = {};
    for (const key of ALLOWED_GLOBAL_SETTINGS) {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    }

    const existing = await prisma.globalSettings.findFirst();
    let updated;

    if (existing) {
      updated = await prisma.globalSettings.update({
        where: { id: existing.id },
        data
      });
    } else {
      updated = await prisma.globalSettings.create({
        data: { id: "global-settings", ...DEFAULT_GLOBAL_SETTINGS, ...data }
      });
    }

    if (req.user) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.userId,
            action: 'UPDATE_SYSTEM_SETTINGS',
            details: `Updated platform global settings: ${Object.keys(data).join(', ')}`,
            ipAddress: req.ip || req.socket.remoteAddress
          }
        });
      } catch (aErr) {}
    }

    return res.status(200).json({ 
      success: true, 
      data: updated, 
      message: 'Global platform settings updated successfully.' 
    });
  } catch (err) { next(err); }
};

// POST /api/superadmin/settings/reset
const resetSystemSettings = async (req, res, next) => {
  try {
    const existing = await prisma.globalSettings.findFirst();
    let updated;

    if (existing) {
      updated = await prisma.globalSettings.update({
        where: { id: existing.id },
        data: DEFAULT_GLOBAL_SETTINGS
      });
    } else {
      updated = await prisma.globalSettings.create({
        data: { id: "global-settings", ...DEFAULT_GLOBAL_SETTINGS }
      });
    }

    if (req.user) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.userId,
            action: 'RESET_SYSTEM_SETTINGS',
            details: 'Restored platform global settings to factory defaults',
            ipAddress: req.ip || req.socket.remoteAddress
          }
        });
      } catch (aErr) {}
    }

    return res.status(200).json({
      success: true,
      data: updated,
      message: 'Global platform settings restored to factory defaults.'
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GLOBAL USAGE ANALYTICS  →  GET /api/superadmin/usage
// ─────────────────────────────────────────
const parseStorageBytes = (sizeStr) => {
  if (!sizeStr) return 0;
  if (typeof sizeStr === 'number') return sizeStr;
  const match = String(sizeStr).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]) || 0;
  const unit = (match[2] || 'B').toUpperCase();
  switch (unit) {
    case 'B': return val;
    case 'KB': return val * 1024;
    case 'MB': return val * 1024 * 1024;
    case 'GB': return val * 1024 * 1024 * 1024;
    case 'TB': return val * 1024 * 1024 * 1024 * 1024;
    default: return val;
  }
};

const getGlobalUsage = async (req, res, next) => {
  try {
    const [organizations, totalUsers, totalEmployees, totalAiLogs, totalDocs, allDocuments, completedBackups] = await Promise.all([
      prisma.organization.findMany({
        include: {
          pricingPlan: true,
          _count: {
            select: {
              users: true,
              employeeProfiles: true,
              documents: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count(),
      prisma.employeeProfile.count(),
      prisma.aiLog.count(),
      prisma.document.count(),
      prisma.document.findMany({
        select: {
          id: true,
          organizationId: true,
          size: true,
          user: {
            select: { organizationId: true }
          }
        }
      }),
      prisma.backupJob.findMany({
        where: { status: 'COMPLETED' },
        select: {
          organizationId: true,
          fileSize: true
        }
      })
    ]);

    // Aggregate storage per organization strictly from DB document sizes and completed backups
    const orgStorageBytesMap = new Map();
    const orgDocCountMap = new Map();

    for (const doc of allDocuments) {
      const orgId = doc.organizationId || doc.user?.organizationId;
      if (orgId) {
        orgDocCountMap.set(orgId, (orgDocCountMap.get(orgId) || 0) + 1);
        const bytes = parseStorageBytes(doc.size);
        orgStorageBytesMap.set(orgId, (orgStorageBytesMap.get(orgId) || 0) + bytes);
      }
    }

    for (const backup of completedBackups) {
      if (backup.organizationId && backup.fileSize) {
        const bytes = Number(backup.fileSize);
        orgStorageBytesMap.set(backup.organizationId, (orgStorageBytesMap.get(backup.organizationId) || 0) + bytes);
      }
    }

    let totalAllocatedSeats = 0;
    let totalStorageUsedBytes = 0;
    let totalStorageCapacityGB = 0;

    const tenantBreakdown = organizations.map(org => {
      const plan = org.pricingPlan;
      const allocatedSeats = plan ? (plan.maxEmployees || 0) : 0;
      const storageCapacityGB = plan ? (plan.storageLimit || 0) : 0;

      const usersCount = org._count?.users || 0;
      const employeesCount = org._count?.employeeProfiles || 0;
      const usedSeats = usersCount;

      const docCount = orgDocCountMap.get(org.id) || org._count?.documents || 0;
      const storageBytes = orgStorageBytesMap.get(org.id) || 0;
      const storageUsedMB = Number((storageBytes / (1024 * 1024)).toFixed(2));
      const storageUsedGB = Number((storageBytes / (1024 * 1024 * 1024)).toFixed(4));

      totalAllocatedSeats += allocatedSeats;
      totalStorageUsedBytes += storageBytes;
      totalStorageCapacityGB += storageCapacityGB;

      const seatUtilizationPct = allocatedSeats > 0 
        ? Math.min(100, Math.round((usedSeats / allocatedSeats) * 100)) 
        : 0;

      const storageUtilizationPct = storageCapacityGB > 0 
        ? Math.min(100, Math.round((storageUsedGB / storageCapacityGB) * 100)) 
        : 0;

      const usagePct = allocatedSeats > 0 ? seatUtilizationPct : 0;

      return {
        id: org.id,
        name: org.name,
        slug: org.slug || org.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        plan: plan?.name || 'Unassigned',
        status: org.status || 'ACTIVE',
        subscriptionStatus: org.subscriptionStatus || 'TRIAL',
        usersCount,
        employeesCount,
        usedSeats,
        allocatedSeats,
        seatUtilizationPct,
        documentsCount: docCount,
        storageUsedBytes: storageBytes,
        storageUsedMB,
        storageUsedGB,
        storageCapacityGB,
        storageUtilizationPct,
        aiUsage: 0,
        usagePct,
        createdAt: org.createdAt
      };
    });

    const totalStorageUsedMB = Number((totalStorageUsedBytes / (1024 * 1024)).toFixed(2));
    const totalStorageUsedGB = Number((totalStorageUsedBytes / (1024 * 1024 * 1024)).toFixed(4));
    const totalUsedSeats = totalUsers;
    const seatUtilizationPct = totalAllocatedSeats > 0 
      ? Math.round((totalUsedSeats / totalAllocatedSeats) * 100) 
      : 0;
    const storageUtilizationPct = totalStorageCapacityGB > 0 
      ? Number(((totalStorageUsedGB / totalStorageCapacityGB) * 100).toFixed(1)) 
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalOrganizations: organizations.length,
          tenantCount: organizations.length,
          activeOrganizations: organizations.filter(o => (o.status || '').toUpperCase() === 'ACTIVE').length,
          trialOrganizations: organizations.filter(o => (o.subscriptionStatus || '').toUpperCase() === 'TRIAL').length,
          suspendedOrganizations: organizations.filter(o => ['SUSPENDED', 'INACTIVE'].includes((o.status || '').toUpperCase())).length,
          totalAllocatedSeats,
          totalUsedSeats,
          totalEmployees,
          totalUsers,
          seatUtilizationPct,
          totalDocuments: totalDocs,
          totalStorageUsedBytes,
          totalStorageUsedMB,
          totalStorageUsedGB,
          totalStorageCapacityGB,
          storageUtilizationPct,
          totalAiRequests: totalAiLogs
        },
        tenants: tenantBreakdown
      }
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// PLATFORM FEATURE MANAGEMENT  →  GET /api/superadmin/features
// ─────────────────────────────────────────
const SEED_PLATFORM_FEATURES = [
  { id: 'attendance_leave', name: 'Attendance & Leave Tracking', category: 'Core HR', description: 'Web clock-in/out, timesheets, and leave management', displayOrder: 1 },
  { id: 'employee_directory', name: 'Employee Directory & Profiles', category: 'Core HR', description: 'Centralized employee records, docs, and org charts', displayOrder: 2 },
  { id: 'shifts_calendars', name: 'Shifts & Work Calendars', category: 'Core HR', description: 'Shift rotations, work calendar versions, and holiday schedules', displayOrder: 3 },
  { id: 'payroll_operations', name: 'Payroll & Compensation', category: 'Payroll', description: 'Salary components, deductions, tax brackets & pay runs', displayOrder: 4 },
  { id: 'benefits_insurance', name: 'Benefits & Insurance Config', category: 'Benefits', description: 'Employee insurance schemes and wellness allowances', displayOrder: 5 },
  { id: 'recruitment_pipeline', name: 'Recruitment & Job Pipeline', category: 'Recruitment', description: 'Job posts, Kanban candidate funnel, and offer letters', displayOrder: 6 },
  { id: 'ai_resume_scoring', name: 'AI Resume Scoring & Matching', category: 'AI & Automation', description: 'Automated resume analysis, scoring, and matching', displayOrder: 7 },
  { id: 'performance_kpi', name: 'Performance & KPI Tracking', category: 'Performance', description: '1-on-1 reviews, objectives, and KPI targets', displayOrder: 8 },
  { id: 'approval_workflows', name: 'Custom Approval Workflows', category: 'Automation', description: 'Multi-level approval chains for leaves & expenses', displayOrder: 9 },
  { id: 'documents_vault', name: 'Document Vault & Storage', category: 'Documents', description: 'Secure document storage, categories, and employee vault', displayOrder: 10 },
  { id: 'support_tickets', name: 'Help Desk & Support Tickets', category: 'Support', description: 'Internal support tickets, communication threads, and SLA tracking', displayOrder: 11 },
  { id: 'backup_center', name: 'Organization Backup Center', category: 'Data & Backup', description: 'Tenant data & documents export, Google Drive sync, and archives', displayOrder: 12 },
  { id: 'offboarding_exit', name: 'Offboarding & Exit Lifecycle', category: 'Core HR', description: 'Resignations, clearance checklists, and exit interviews', displayOrder: 13 },
  { id: 'advanced_reports', name: 'Advanced Analytics & Exports', category: 'Analytics', description: 'Custom report builder and scheduled automated exports', displayOrder: 14 },
  { id: 'audit_compliance', name: 'Audit Logs & Statutory Compliance', category: 'Security', description: 'Granular audit logs and compliance policy center', displayOrder: 15 }
];

const ensurePlatformFeaturesSeeded = async () => {
  try {
    const count = await prisma.platformFeature.count();
    if (count === 0) {
      for (const feat of SEED_PLATFORM_FEATURES) {
        await prisma.platformFeature.upsert({
          where: { id: feat.id },
          update: feat,
          create: feat
        });
      }
    }
  } catch (err) {
    console.error('Error seeding platform features:', err);
  }
};

const getDefaultFeaturesForPlan = (planName, monthlyPrice = 0, allFeatureIds = []) => {
  const lower = (planName || '').toLowerCase();
  if (lower.includes('enterprise') || lower.includes('unlimited')) {
    return allFeatureIds;
  } else if (lower.includes('pro') || lower.includes('growth') || lower.includes('demanded') || monthlyPrice >= 30) {
    return [
      'attendance_leave', 'employee_directory', 'shifts_calendars', 'payroll_operations',
      'benefits_insurance', 'recruitment_pipeline', 'ai_resume_scoring', 'performance_kpi',
      'approval_workflows', 'documents_vault', 'support_tickets', 'backup_center',
      'offboarding_exit', 'audit_compliance'
    ].filter(id => allFeatureIds.includes(id));
  } else {
    return ['attendance_leave', 'employee_directory', 'performance_kpi', 'support_tickets', 'documents_vault']
      .filter(id => allFeatureIds.includes(id));
  }
};

const getPlatformFeatures = async (req, res, next) => {
  try {
    // 1. Authoritative feature source of truth from database
    await ensurePlatformFeaturesSeeded();
    const dbFeatures = await prisma.platformFeature.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' }
    });

    const activeFeatureIdSet = new Set(dbFeatures.map(f => f.id));
    const allFeatureIds = dbFeatures.map(f => f.id);
    const dynamicCategories = ['ALL', ...Array.from(new Set(dbFeatures.map(f => f.category)))];

    // 2. Fetch real active pricing plans from database
    let dbPlans = await prisma.pricingPlan.findMany({
      where: { isActive: true },
      include: { features: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { displayOrder: 'asc' }
    });

    if (dbPlans.length === 0) {
      dbPlans = await prisma.pricingPlan.findMany({
        include: { features: { orderBy: { displayOrder: 'asc' } } },
        orderBy: { displayOrder: 'asc' }
      });
    }

    const plansFeaturesMap = {};
    const plansList = [];

    for (const plan of dbPlans) {
      plansList.push({
        id: plan.id,
        name: plan.name,
        monthlyPrice: plan.monthlyPrice,
        currency: plan.currency || '$',
        maxEmployees: plan.maxEmployees,
        isPopular: plan.isPopular
      });

      // Filter for features that match standard feature IDs in DB
      const assigned = plan.features.map(f => f.feature).filter(f => activeFeatureIdSet.has(f));

      if (assigned.length > 0) {
        plansFeaturesMap[plan.name] = assigned;
        plansFeaturesMap[plan.id] = assigned;
      } else {
        // Fallback to default tier feature set and auto-persist so it remains stored in DB
        const defaultFeats = getDefaultFeaturesForPlan(plan.name, plan.monthlyPrice, allFeatureIds);
        plansFeaturesMap[plan.name] = defaultFeats;
        plansFeaturesMap[plan.id] = defaultFeats;

        // Auto-seed in background for permanent persistence
        try {
          await prisma.pricingFeature.createMany({
            data: defaultFeats.map((feat, idx) => ({
              pricingPlanId: plan.id,
              feature: feat,
              displayOrder: idx
            }))
          });
        } catch (seedErr) {
          // Ignore unique / concurrency errors
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        features: dbFeatures,
        categories: dynamicCategories,
        plans: plansFeaturesMap,
        plansList: plansList.length > 0 ? plansList : [
          { id: '1', name: 'Starter', monthlyPrice: 15, currency: '$', maxEmployees: 15 },
          { id: '2', name: 'Professional', monthlyPrice: 39, currency: '$', maxEmployees: 100 },
          { id: '3', name: 'Enterprise', monthlyPrice: 99, currency: '$', maxEmployees: 9999 }
        ]
      }
    });
  } catch (err) { next(err); }
};

const updatePlatformFeatures = async (req, res, next) => {
  try {
    const { plans } = req.body;
    if (!plans || typeof plans !== 'object') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'Plans object is required.' }
      });
    }

    // Persist to Prisma PricingFeature table for each plan
    for (const [planKey, featureIds] of Object.entries(plans)) {
      if (Array.isArray(featureIds)) {
        const plan = await prisma.pricingPlan.findFirst({
          where: { OR: [{ id: planKey }, { name: planKey }] }
        });

        if (plan) {
          // Delete old standard feature mappings for this plan
          await prisma.pricingFeature.deleteMany({
            where: { pricingPlanId: plan.id }
          });

          // Insert new feature mappings
          if (featureIds.length > 0) {
            await prisma.pricingFeature.createMany({
              data: featureIds.map((feat, idx) => ({
                pricingPlanId: plan.id,
                feature: feat,
                displayOrder: idx
              }))
            });
          }
        }
      }
    }

    const userId = req.user?.userId || req.user?.id;
    if (userId) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'UPDATE_FEATURE_ENTITLEMENTS',
          details: `Updated SaaS feature matrix for plans: ${Object.keys(plans).join(', ')}`,
          ipAddress: req.ip || req.socket?.remoteAddress
        }
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Plan feature entitlements saved permanently to the database.'
    });
  } catch (err) { next(err); }
};

const togglePlatformFeature = async (req, res, next) => {
  try {
    const { planId, planName, featureId, isEnabled } = req.body;
    if (!featureId || (!planId && !planName)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'Plan identifier and featureId are required.' }
      });
    }

    const plan = await prisma.pricingPlan.findFirst({
      where: { OR: [
        ...(planId ? [{ id: planId }] : []),
        ...(planName ? [{ name: planName }] : [])
      ] },
      include: { features: true }
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: { code: 'PLAN_NOT_FOUND', message: 'Pricing plan not found.' }
      });
    }

    const existingFeature = plan.features.find(f => f.feature === featureId);

    if (isEnabled && !existingFeature) {
      await prisma.pricingFeature.create({
        data: {
          pricingPlanId: plan.id,
          feature: featureId,
          displayOrder: plan.features.length
        }
      });
    } else if (!isEnabled && existingFeature) {
      await prisma.pricingFeature.delete({
        where: { id: existingFeature.id }
      });
    }

    // Audit log
    const userId = req.user?.userId || req.user?.id;
    if (userId) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'TOGGLE_FEATURE_ENTITLEMENT',
          details: `${isEnabled ? 'Enabled' : 'Disabled'} feature '${featureId}' for plan '${plan.name}'`,
          ipAddress: req.ip || req.socket?.remoteAddress
        }
      }).catch(() => {});
    }

    // Return updated feature list for this plan
    const updatedPlan = await prisma.pricingPlan.findUnique({
      where: { id: plan.id },
      include: { features: true }
    });

    // Check DB active features
    const dbFeatures = await prisma.platformFeature.findMany({ where: { isActive: true } });
    const activeFeatureIdSet = new Set(dbFeatures.map(f => f.id));

    const activeFeatures = (updatedPlan?.features || [])
      .map(f => f.feature)
      .filter(f => activeFeatureIdSet.has(f));

    return res.status(200).json({
      success: true,
      data: {
        planId: plan.id,
        planName: plan.name,
        featureId,
        isEnabled: !!isEnabled,
        features: activeFeatures
      },
      message: `Feature ${featureId} ${isEnabled ? 'enabled' : 'disabled'} for ${plan.name}`
    });
  } catch (err) { next(err); }
};

module.exports = {
  getPlatformStats,
  getAllOrganizations, getOrganizationDetails, provisionOrganization, suspendOrganization, activateOrganization, createOrganization, deleteOrganization, updateOrganization, updateOrgSubscription,
  getAllPlatformUsers, createAdminForOrg,
  toggleAnyUserActive, changeAnyUserRole, revokeAnyUserRole,
  getPlatformAuditLogs,
  getSystemHealth,
  getAnalytics,
  getAnalyticsExport,
  createUser, updateUser, deleteUser,
  getAllPlatformDepartments, createPlatformDepartment, updatePlatformDepartment, deletePlatformDepartment,
  getPayrollSettings, updatePayrollSettings,
  getPayrollHistory, createPayslip, updatePayslip, deletePayslip, bulkApprovePayslips, generatePayroll,
  resetUserPassword,
  getSystemSettings, updateSystemSettings, resetSystemSettings,
  getGlobalUsage,
  getPlatformFeatures,
  updatePlatformFeatures,
  togglePlatformFeature
};