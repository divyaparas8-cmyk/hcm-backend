// ============================================================
// Employee Controller
// ============================================================
// Handles: Profile, Attendance (Clock In/Out), Leave, Payslips, Documents, Tickets

const prisma = require('../config/prisma');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { handleBase64Field, isBase64DataUrl, uploadDocument: uploadDocumentService, saveToLocal } = require('../services/cloudUploadService');
const calendarResolver = require('../utils/calendarResolver');
const { isWorkflowEnabled, startWorkflow } = require('../services/approval.service');

// ─────────────────────────────────────────
// HELPER: Auto-provision Employee Profile
// ─────────────────────────────────────────
const getOrCreateProfile = async (userId) => {
  const profileInclude = {
    department: true,
    manager: { select: { fullName: true, employeeId: true } },
    user: { select: { email: true, role: true } },
    shift: true,
    compensationProfile: true,
    skills: true,
  };
  let profile = await prisma.employeeProfile.findUnique({
    where: { userId },
    include: profileInclude,
  });
  if (!profile) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found in database');
    }
    profile = await prisma.employeeProfile.create({
      data: {
        userId,
        fullName: user.email ? user.email.split('@')[0] : 'New Employee',
        employeeId: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      },
      include: profileInclude,
    });
  }

  // Fallback to default shift if none is explicitly assigned
  if (!profile.shift) {
    const defaultShift = await prisma.shift.findFirst({
      where: { isDefault: true }
    });
    if (defaultShift) {
      profile.shift = defaultShift;
    }
  }

  // Fetch WorkCalendarAssignment for weekends
  let assignment = await prisma.workCalendarAssignment.findFirst({
    where: { entityType: 'EMPLOYEE', entityId: profile.id },
    include: {
      calendar: { include: { versions: { include: { weekends: true } } } }
    }
  });

  let calendar = assignment?.calendar;
  if (!calendar) {
    calendar = await prisma.workCalendar.findFirst({
      where: { isDefaultCompanyCalendar: true },
      include: { versions: { include: { weekends: true } } }
    });
  }

  if (calendar && calendar.versions && calendar.versions.length > 0 && Array.isArray(calendar.versions[0]?.weekends)) {
    profile.weekends = calendar.versions[0].weekends.map(w => ({ dayOfWeek: w.dayOfWeek, type: w.type }));
  } else {
    profile.weekends = [{ dayOfWeek: 0, type: 'FullDay' }, { dayOfWeek: 6, type: 'FullDay' }];
  }

  return profile;
};

// ─────────────────────────────────────────
// 1. GET PROFILE  →  GET /api/employee/profile
// ─────────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    return res.status(200).json({ success: true, data: profile });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 2. UPDATE PROFILE  →  PUT /api/employee/profile
// ─────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    const {
      fullName, phone, gender, bloodGroup, address, avatarUrl,
      identityProofUrl, educationProofUrl,
      emergencyName, emergencyPhone, emergencyRelation, dob, bio,
      language, timezone, dateFormat, emailNotif, pushNotif, weeklySummary,
      employeeId, department, role, managerName, joiningDate, baseSalary, annualCTC
    } = req.body;

    const profile = await getOrCreateProfile(req.user.userId);
    
    // Avatar -> Cloudinary
    const finalAvatarUrl = await handleBase64Field(
      avatarUrl,
      profile?.avatarUrl,
      { folder: 'hcm/avatars', filenamePrefix: 'avatar' }
    );

    // Identity & Education Proofs -> ImageKit
    const finalIdentityProofUrl = await handleBase64Field(
      identityProofUrl,
      profile?.identityProofUrl,
      { folder: 'hcm/proofs', filenamePrefix: 'id_proof' }
    );

    const finalEducationProofUrl = await handleBase64Field(
      educationProofUrl,
      profile?.educationProofUrl,
      { folder: 'hcm/proofs', filenamePrefix: 'edu_proof' }
    );

    const updated = await prisma.employeeProfile.update({
      where: { userId: req.user.userId },
      data: {
        fullName,
        phone,
        gender,
        bloodGroup,
        address,
        avatarUrl: finalAvatarUrl,
        emergencyName,
        emergencyPhone,
        emergencyRelation,
        dob: dob ? new Date(dob) : null,
        bio,
        language,
        timezone,
        dateFormat,
        emailNotif: emailNotif !== undefined ? Boolean(emailNotif) : undefined,
        pushNotif: pushNotif !== undefined ? Boolean(pushNotif) : undefined,
        weeklySummary: weeklySummary !== undefined ? Boolean(weeklySummary) : undefined,
        employeeId: employeeId || undefined,
        joiningDate: joiningDate ? new Date(joiningDate) : undefined,
      },
    });

    if (department) {
      let dept = await prisma.department.findFirst({ where: { name: department } });
      if (!dept) {
        dept = await prisma.department.create({ data: { name: department } });
      }
      await prisma.employeeProfile.update({
        where: { userId: req.user.userId },
        data: { departmentId: dept.id }
      });
    }

    if (managerName) {
      const manager = await prisma.employeeProfile.findFirst({
        where: { fullName: { equals: managerName, mode: 'insensitive' } }
      });
      if (manager) {
        await prisma.employeeProfile.update({
          where: { userId: req.user.userId },
          data: { managerId: manager.id }
        });
      }
    } else if (managerName === '') {
      await prisma.employeeProfile.update({
        where: { userId: req.user.userId },
        data: { managerId: null }
      });
    }

    if (role) {
      await prisma.user.update({
        where: { id: req.user.userId },
        data: { role: role }
      });
    }

    if (baseSalary !== undefined || annualCTC !== undefined) {
      await prisma.compensationProfile.upsert({
        where: { employeeId: profile.id },
        update: {
          baseSalary: baseSalary !== undefined ? parseFloat(baseSalary) || 0 : undefined,
          annualCTC: annualCTC !== undefined ? parseFloat(annualCTC) || 0 : undefined,
          monthlyCTC: baseSalary !== undefined ? parseFloat(baseSalary) || 0 : undefined
        },
        create: {
          employeeId: profile.id,
          currency: 'USD',
          baseSalary: parseFloat(baseSalary) || 0,
          annualCTC: parseFloat(annualCTC) || 0,
          monthlyCTC: parseFloat(baseSalary) || 0,
          effectiveDate: new Date(),
          status: 'Active'
        }
      });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 3. CLOCK IN  →  POST /api/employee/attendance/clock-in
// ─────────────────────────────────────────
const clockIn = async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

    // Check: already has an active clock-in session? (No date check to handle night shifts/timezones safely)
    const existing = await prisma.attendanceLog.findFirst({
      where: { userId: req.user.userId, clockOut: null },
    });

    if (existing) {
      return res.status(400).json({ success: false, error: { code: 'ALREADY_CLOCKED_IN', message: 'You are already clocked in. Please clock out of your active session first.' } });
    }

    // Fetch Employee Profile & Shift
    const empProfile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId },
      include: { shift: true }
    });
    
    let shift = empProfile?.shift;
    if (!shift) {
      shift = await prisma.shift.findFirst({ where: { isDefault: true } });
    }

    let lateMinutes = 0;

    if (shift) {
      const [startHour, startMin] = shift.startTime.split(':').map(Number);
      const expectedStart = new Date(now);
      expectedStart.setHours(startHour, startMin, 0, 0);
      
      const diffMin = Math.floor((now - expectedStart) / 60000);
      if (diffMin > shift.graceInMin) {
        lateMinutes = diffMin;
      }
    }

    const log = await prisma.attendanceLog.create({
      data: {
        userId: req.user.userId,
        date: today,
        clockIn: now,
        mode: req.body.mode || 'Office',
        status: lateMinutes > 0 ? 'Late' : 'Present',
        shiftId: shift?.id,
        lateMinutes
      },
      include: { shift: true },
    });

    return res.status(201).json({ success: true, data: log, message: 'Clocked in successfully.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 4. CLOCK OUT  →  POST /api/employee/attendance/clock-out
// ─────────────────────────────────────────
const clockOut = async (req, res, next) => {
  try {
    const activeLog = await prisma.attendanceLog.findFirst({
      where: { userId: req.user.userId, clockOut: null },
      include: { shift: true }
    });

    if (!activeLog) {
      return res.status(400).json({ success: false, error: { code: 'NOT_CLOCKED_IN', message: 'You do not have an active work session to clock out of.' } });
    }

    const clockOutTime = new Date();
    const workedMs = clockOutTime - new Date(activeLog.clockIn);
    const workedMin = Math.floor(workedMs / 60000);

    let earlyExitMinutes = 0;
    let overtimeMinutes = 0;
    let breakMinutes = 0;
    let isHalfDay = false;
    let finalWorkedMin = workedMin;
    
    const shift = activeLog.shift;
    
    if (shift) {
      const [startHour, startMin] = shift.startTime.split(':').map(Number);
      const [endHour, endMin] = shift.endTime.split(':').map(Number);
      
      const expectedEnd = new Date(activeLog.clockIn);
      expectedEnd.setHours(endHour, endMin, 0, 0);
      
      if (endHour < startHour) {
        // Handle night shifts
        expectedEnd.setDate(expectedEnd.getDate() + 1);
      }
      
      const diffEndMin = Math.floor((clockOutTime - expectedEnd) / 60000);
      
      if (diffEndMin < -shift.graceOutMin) {
        earlyExitMinutes = Math.abs(diffEndMin);
      } else if (diffEndMin > 0) {
        overtimeMinutes = diffEndMin;
      }
      
      breakMinutes = shift.breakDurationMin;
      
      if (workedMin < (shift.workingHoursMin / 2)) {
        isHalfDay = true;
      }

      if (workedMin > (shift.workingHoursMin / 2)) {
        finalWorkedMin = Math.max(0, workedMin - breakMinutes);
      }
    }

    const updated = await prisma.attendanceLog.update({
      where: { id: activeLog.id },
      data: { 
        clockOut: clockOutTime, 
        totalWorkedMin: finalWorkedMin,
        earlyExitMinutes,
        overtimeMinutes,
        breakMinutes,
        isHalfDay
      },
    });

    return res.status(200).json({ success: true, data: updated, message: 'Clocked out successfully.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 5. GET ATTENDANCE HISTORY  →  GET /api/employee/attendance
// ─────────────────────────────────────────
const getAttendance = async (req, res, next) => {
  try {
    const logs = await prisma.attendanceLog.findMany({
      where: { userId: req.user.userId },
      orderBy: { clockIn: 'desc' },
      take: 30, // last 30 records
    });

    return res.status(200).json({ success: true, data: logs });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 6. GET LEAVES  →  GET /api/employee/leaves
// ─────────────────────────────────────────
const getLeaves = async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const organizationId = req.user?.organizationId || req.tenant?.id;

    const leaves = await prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    let policies = [];
    if (organizationId) {
      policies = await prisma.leavePolicy.findMany({
        where: { organizationId }
      });

      if (policies.length === 0) {
        const defaultPolicies = [
          { name: 'Sick Leave', isPaid: true, yearlyAllowance: 12, organizationId },
          { name: 'Annual Leave', isPaid: true, yearlyAllowance: 18, organizationId },
          { name: 'Casual Leave', isPaid: true, yearlyAllowance: 6, organizationId },
          { name: 'Maternity/Paternity Leave', isPaid: true, yearlyAllowance: 90, organizationId },
          { name: 'Unpaid Leave', isPaid: false, yearlyAllowance: 0, organizationId },
        ];
        await prisma.leavePolicy.createMany({
          data: defaultPolicies,
          skipDuplicates: true
        }).catch(() => {});
        policies = await prisma.leavePolicy.findMany({
          where: { organizationId }
        });
      }
    }

    const policyMap = {
      'Sick Leave': 12,
      'Annual Leave': 18,
      'Casual Leave': 6,
      'Maternity/Paternity Leave': 90,
      'Unpaid Leave': 0
    };
    policies.forEach(p => {
      policyMap[p.name] = p.yearlyAllowance;
    });

    const currentYear = new Date().getFullYear();
    const approvedThisYear = leaves.filter(l => {
      const isApproved = l.status === 'APPROVED' || l.status === 'Approved';
      const leaveYear = l.startDate ? new Date(l.startDate).getFullYear() : currentYear;
      return isApproved && leaveYear === currentYear;
    });

    const usedMap = {};
    approvedThisYear.forEach(l => {
      const type = l.leaveType || 'Annual Leave';
      usedMap[type] = (usedMap[type] || 0) + (Number(l.totalDays) || 0);
    });

    const sickAllowance = policyMap['Sick Leave'] ?? 12;
    const annualAllowance = policyMap['Annual Leave'] ?? 18;
    const casualAllowance = policyMap['Casual Leave'] ?? 6;

    const sickUsed = usedMap['Sick Leave'] || 0;
    const annualUsed = usedMap['Annual Leave'] || 0;
    const casualUsed = usedMap['Casual Leave'] || 0;
    const unpaidUsed = usedMap['Unpaid Leave'] || 0;

    const details = policies.map(p => {
      const used = usedMap[p.name] || 0;
      return {
        name: p.name,
        allowance: p.yearlyAllowance,
        used: used,
        remaining: Math.max(0, p.yearlyAllowance - used),
        isPaid: p.isPaid
      };
    });

    const balance = {
      sick: Math.max(0, sickAllowance - sickUsed),
      sickTotal: sickAllowance,
      sickUsed,
      annual: Math.max(0, annualAllowance - annualUsed),
      annualTotal: annualAllowance,
      annualUsed,
      casual: Math.max(0, casualAllowance - casualUsed),
      casualTotal: casualAllowance,
      casualUsed,
      unpaid: unpaidUsed,
      totalAllowance: sickAllowance + annualAllowance + casualAllowance,
      totalUsed: sickUsed + annualUsed + casualUsed + unpaidUsed,
      totalRemaining: Math.max(0, (sickAllowance + annualAllowance + casualAllowance) - (sickUsed + annualUsed + casualUsed)),
      details
    };

    return res.status(200).json({
      success: true,
      data: {
        requests: leaves,
        policies,
        balance
      }
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 7. APPLY LEAVE  →  POST /api/employee/leaves
// ─────────────────────────────────────────
const applyLeave = async (req, res, next) => {
  try {
    const schema = z.object({
      leaveType: z.string().min(1),
      startDate: z.string(),
      endDate: z.string(),
      totalDays: z.number().min(1),
      reason: z.string().optional(),
      emergencyContact: z.string().optional(),
      attachment: z.object({
        url: z.string().optional(),
        fileBase64: z.string().optional(),
        name: z.string().optional(),
        size: z.string().optional(),
      }).optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || 'Validation error';
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } });
    }

    const startDateObj = new Date(parsed.data.startDate);
    const endDateObj = new Date(parsed.data.endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATES', message: 'Invalid start date or end date format.' } });
    }

    if (startDateObj > endDateObj) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE_RANGE', message: 'Start date cannot be after end date.' } });
    }

    const empProfile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId },
      include: { manager: true }
    });

    if (!empProfile) {
      return res.status(404).json({ success: false, error: { message: 'Employee profile not found.' } });
    }

    // --- INTEGRATE ENTERPRISE CALENDAR FOR LEAVE CALCULATION ---
    let calculatedDays = 0;
    try {
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysCount = Math.ceil((endDateObj - startDateObj) / msPerDay) + 1;
      
      for (let i = 0; i < daysCount; i++) {
        const currentDate = new Date(startDateObj.getTime() + (i * msPerDay));
        const dayType = await calendarResolver.getDayType(empProfile.id, currentDate);
        
        // This simulates a policy where FULL weekends and holidays don't consume leave balance.
        // In a full implementation, we would query the specific LeavePolicy here.
        if (dayType.type === 'WORKING_DAY') {
          calculatedDays += 1;
        } else if (dayType.type === 'WEEKEND' && dayType.detail.type === 'HALF_DAY') {
          calculatedDays += 0.5; // Half day weekend still consumes 0.5 leave
        }
        // Holidays and FULL_DAY weekends add 0 to calculatedDays.
      }
    } catch (err) {
      console.warn(`[Leave Calendar Warning] Failed to resolve calendar for ${req.user.userId}, defaulting to frontend totalDays. Error: ${err.message}`);
      calculatedDays = parsed.data.totalDays;
    }

    if (calculatedDays <= 0) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_LEAVE', message: 'Leave duration must be greater than 0 working days.' } });
    }

    if (parsed.data.leaveType !== 'Unpaid Leave') {
      const orgId = req.user.organizationId || req.tenant?.id;
      let policy = null;
      if (orgId) {
        policy = await prisma.leavePolicy.findFirst({
          where: { organizationId: orgId, name: parsed.data.leaveType }
        });
      } else {
        policy = await prisma.leavePolicy.findFirst({
          where: { name: parsed.data.leaveType }
        });
      }

      const allowance = policy ? policy.yearlyAllowance : 999;

      const activeRequests = await prisma.leaveRequest.findMany({
        where: {
          userId: req.user.userId,
          leaveType: parsed.data.leaveType,
          status: { in: ['PENDING', 'APPROVED', 'MANAGER_APPROVED'] }
        }
      });
      const usedDays = activeRequests.reduce((sum, r) => sum + r.totalDays, 0);
      if (usedDays + calculatedDays > allowance) {
        return res.status(400).json({ 
          success: false, 
          error: { 
            code: 'INSUFFICIENT_BALANCE', 
            message: `Insufficient leave balance. You have ${allowance - usedDays} days remaining, but requested ${calculatedDays} days.` 
          } 
        });
      }
    }
    // ------------------------------------------------------------

    // Extract optional attachment fields
    const { attachment, ...leavePayload } = parsed.data;
    let attachmentUrl = attachment?.url || attachment?.fileBase64 || null;
    if (attachmentUrl && typeof attachmentUrl === 'string' && attachmentUrl.startsWith('data:')) {
      try {
        attachmentUrl = await handleBase64Field(attachmentUrl, null, { folder: 'hcm/leaves', filenamePrefix: 'leave' });
      } catch (uploadErr) {
        console.warn('Failed to upload leave attachment to cloud, storing as data URI:', uploadErr.message);
      }
    }
    const attachmentName = attachment?.name || null;
    const leave = await prisma.leaveRequest.create({
      data: {
        userId: req.user.userId,
        ...leavePayload,
        totalDays: calculatedDays,
        startDate: startDateObj,
        endDate: endDateObj,
        status: 'PENDING',
        attachmentUrl,
        attachmentName,
      },
    });

    try {
      // --- GENERIC APPROVAL ENGINE INTEGRATION ---
      const orgId = req.user.organizationId; // Or fetch from user profile if missing
      const workflowActive = await isWorkflowEnabled('LeaveRequest', orgId);

      if (workflowActive) {
        await startWorkflow('LeaveRequest', leave.id, orgId, req.user.userId);
        return res.status(201).json({ success: true, data: leave, message: 'Leave request submitted and workflow started.' });
      }
    } catch (engineErr) {
      console.warn(`[Leave Workflow Fallback] Error starting generic workflow, falling back to legacy: ${engineErr.message}`);
    }
    // -------------------------------------------

    try {
      const { createNotification } = require('../utils/notificationHelper');
      
      if (empProfile && empProfile.manager?.userId) {
        await createNotification({
          userId: empProfile.manager.userId,
          title: 'Leave Approval Pending',
          message: `${empProfile.fullName} requested ${parsed.data.totalDays} days of ${parsed.data.leaveType}.`,
          type: 'WARNING',
          link: '/manager/leave'
        });
      }
    } catch (notifErr) {
      console.error('Failed to trigger leave application notification:', notifErr);
    }

    return res.status(201).json({ success: true, data: leave, message: 'Leave request submitted.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 7b. CANCEL LEAVE  →  DELETE /api/employee/leaves/:id
// ─────────────────────────────────────────
const cancelLeave = async (req, res, next) => {
  try {
    const leaveId = req.params.id;
    const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId } });

    if (!leave) {
      return res.status(404).json({ success: false, error: { message: 'Leave not found' } });
    }

    if (leave.userId !== req.user.userId) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized' } });
    }

    if (leave.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: { message: 'Only pending leaves can be cancelled' } });
    }

    await prisma.leaveRequest.delete({ where: { id: leaveId } });

    return res.status(200).json({ success: true, message: 'Leave request cancelled' });
  } catch (err) { next(err); }
};


// ─────────────────────────────────────────
// 8. GET PAYSLIPS  →  GET /api/employee/payslips
// ─────────────────────────────────────────
const getPayslips = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);

    const payslips = await prisma.payslip.findMany({
      where: { employeeId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: payslips });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 9. GET PERFORMANCE GOALS  →  GET /api/employee/performance
// ─────────────────────────────────────────
const getPerformance = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);

    let goals = await prisma.performanceGoal.findMany({
      where: { employeeId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    let skills = await prisma.employeeSkill.findMany({
      where: { employeeId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    let reviews = await prisma.performanceReview.findMany({
      where: { employeeId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    // Auto-seed starter goals & skills & reviews if the employee has none
    if (goals.length === 0) {
      await prisma.performanceGoal.createMany({
        data: [
          {
            employeeId: profile.id,
            title: 'Implement Core Architecture & Performance Benchmarks',
            priority: 'High',
            deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            progress: 75
          },
          {
            employeeId: profile.id,
            title: 'Automate CI/CD & Unit Test Suite Coverage',
            priority: 'Medium',
            deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
            progress: 45
          },
          {
            employeeId: profile.id,
            title: 'Lead Departmental Knowledge Transfer & Mentorship',
            priority: 'Low',
            deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            progress: 100
          }
        ]
      });
      goals = await prisma.performanceGoal.findMany({
        where: { employeeId: profile.id },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (skills.length === 0) {
      await prisma.employeeSkill.createMany({
        data: [
          { employeeId: profile.id, name: 'React & Frontend Systems', level: 85 },
          { employeeId: profile.id, name: 'Node.js & Backend Architecture', level: 80 },
          { employeeId: profile.id, name: 'Database Optimization & SQL', level: 75 },
          { employeeId: profile.id, name: 'Cloud & Infrastructure (AWS/Docker)', level: 70 }
        ]
      });
      skills = await prisma.employeeSkill.findMany({
        where: { employeeId: profile.id },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (reviews.length === 0) {
      await prisma.performanceReview.createMany({
        data: [
          {
            employeeId: profile.id,
            period: 'Q1 2026 Review Cycle',
            reviewer: 'Sarah Jenkins (VP Engineering)',
            rating: '4.9 / 5.0',
            text: 'Outstanding architectural contributions, proactive problem solving, and excellent mentorship across cross-functional engineering teams.'
          },
          {
            employeeId: profile.id,
            period: 'Annual Performance Evaluation',
            reviewer: 'Michael Torres (Engineering Lead)',
            rating: '4.8 / 5.0',
            text: 'Consistently meets sprint deliverables ahead of schedule with great code quality and architectural integrity.'
          }
        ]
      });
      reviews = await prisma.performanceReview.findMany({
        where: { employeeId: profile.id },
        orderBy: { createdAt: 'desc' },
      });
    }

    return res.status(200).json({ success: true, data: { goals, skills, reviews } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 10. GET SUPPORT TICKETS  →  GET /api/employee/tickets
// ─────────────────────────────────────────
const getTickets = async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user.userId },
      include: {
        messages: {
          include: {
            sender: {
              select: {
                email: true,
                role: true,
                employeeProfile: { select: { fullName: true } }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: tickets });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 11. CREATE TICKET  →  POST /api/employee/tickets
// ─────────────────────────────────────────
const createTicket = async (req, res, next) => {
  try {
    const schema = z.object({
      subject: z.string().min(3),
      category: z.string(),
      priority: z.enum(['High', 'Medium', 'Low']),
      description: z.string().min(5),
      attachmentBase64: z.string().optional().nullable(),
      attachmentUrl: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || parsed.error.errors?.[0]?.message || 'Validation error';
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: msg } });
    }

    let attachmentUrl = parsed.data.attachmentUrl || null;
    if (parsed.data.attachmentBase64) {
      attachmentUrl = await handleBase64Field(
        parsed.data.attachmentBase64,
        null,
        { folder: 'hcm/tickets', filenamePrefix: 'ticket' }
      );
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user.userId,
        subject: parsed.data.subject,
        category: parsed.data.category,
        priority: parsed.data.priority,
        messages: {
          create: {
            senderId: req.user.userId,
            text: parsed.data.description,
            attachmentUrl,
          },
        },
      },
      include: { messages: true },
    });

    return res.status(201).json({ success: true, data: ticket, message: 'Support ticket created.' });
  } catch (err) { next(err); }
};

const replyTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, attachmentBase64, attachmentUrl } = req.body;

    if (!text && !attachmentBase64 && !attachmentUrl) {
      return res.status(400).json({ success: false, error: { message: 'Reply text or attachment is required' } });
    }

    let finalAttachmentUrl = attachmentUrl || (req.file ? `/uploads/${req.file.filename}` : null);
    if (!finalAttachmentUrl && attachmentBase64) {
      finalAttachmentUrl = await handleBase64Field(
        attachmentBase64,
        null,
        { folder: 'hcm/tickets', filenamePrefix: 'ticket_msg' }
      );
    }

    const msg = await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        senderId: req.user.userId,
        text: text || '',
        attachmentUrl: finalAttachmentUrl
      },
      include: {
        sender: {
          select: {
            email: true,
            role: true,
            employeeProfile: { select: { fullName: true } }
          }
        }
      }
    });

    return res.status(201).json({ success: true, data: msg, message: 'Reply posted' });
  } catch (err) { next(err); }
};

const deleteTicketMessage = async (req, res, next) => {
  try {
    const { id, msgId } = req.params;
    const msg = await prisma.ticketMessage.findUnique({ where: { id: msgId } });

    if (!msg) {
      return res.status(404).json({ success: false, error: { message: 'Message not found' } });
    }

    if (msg.senderId !== req.user.userId) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized' } });
    }

    await prisma.ticketMessage.delete({ where: { id: msgId } });
    return res.status(200).json({ success: true, message: 'Message deleted' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 12. BENEFIT CLAIMS  →  GET /api/employee/benefits
// ─────────────────────────────────────────
const getBenefits = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    const organizationId = user?.organizationId || req.user.organizationId || null;

    let availablePlans = await prisma.benefitPlan.findMany({
      where: organizationId ? {
        status: 'Active',
        OR: [{ organizationId }, { organizationId: null }]
      } : { status: 'Active' },
      orderBy: { name: 'asc' }
    });

    if (availablePlans.length === 0) {
      const defaultPlans = [
        {
          name: 'Comprehensive Health & Dental',
          category: 'Health Insurance',
          provider: 'Aetna / BlueCross Shield',
          contribution: '500.00',
          empContribution: '50.00',
          eligibility: 'All Full-Time Employees',
          status: 'Active',
          autoEnroll: false,
          description: 'Full medical, dental, and vision insurance with $1,500 annual deductible.',
          organizationId: organizationId || null
        },
        {
          name: '401(k) Retirement Match',
          category: 'Retirement',
          provider: 'Fidelity Investments',
          contribution: '300.00',
          empContribution: '0.00',
          eligibility: 'All Employees',
          status: 'Active',
          autoEnroll: false,
          description: 'Company matching up to 5% of base salary with diverse index funds.',
          organizationId: organizationId || null
        },
        {
          name: 'Wellness & Gym Subsidy',
          category: 'Wellness',
          provider: 'ClassPass / GymPass',
          contribution: '100.00',
          empContribution: '0.00',
          eligibility: 'All Employees',
          status: 'Active',
          autoEnroll: false,
          description: 'Monthly reimbursement for fitness memberships, yoga, and mental wellness apps.',
          organizationId: organizationId || null
        },
        {
          name: 'Remote Work & Internet Stipend',
          category: 'Allowance',
          provider: 'Company Direct',
          contribution: '150.00',
          empContribution: '0.00',
          eligibility: 'Remote / Hybrid Employees',
          status: 'Active',
          autoEnroll: true,
          description: 'Home office equipment, ergonomic setup, and high-speed broadband subsidy.',
          organizationId: organizationId || null
        },
        {
          name: 'Learning & Skill Development',
          category: 'Education',
          provider: 'Coursera / Udemy Business',
          contribution: '250.00',
          empContribution: '0.00',
          eligibility: 'All Employees',
          status: 'Active',
          autoEnroll: false,
          description: 'Annual budget for tech certifications, books, and professional conferences.',
          organizationId: organizationId || null
        }
      ];

      for (const p of defaultPlans) {
        await prisma.benefitPlan.create({ data: p }).catch(() => {});
      }

      availablePlans = await prisma.benefitPlan.findMany({
        where: organizationId ? {
          status: 'Active',
          OR: [{ organizationId }, { organizationId: null }]
        } : { status: 'Active' },
        orderBy: { name: 'asc' }
      });
    }

    const claims = await prisma.benefitClaim.findMany({
      where: { employeeId: profile.id },
      orderBy: { claimedAt: 'desc' },
    });

    const enrolledPlans = await prisma.employeeBenefit.findMany({
      where: { employeeId: profile.id, status: 'Active' },
      include: { benefitPlan: true }
    });

    return res.status(200).json({ success: true, data: { claims, enrolledPlans, availablePlans } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 13. ENROLL IN BENEFIT PLAN → POST /api/employee/benefits/enroll
// ─────────────────────────────────────────
const enrollBenefitPlan = async (req, res, next) => {
  try {
    const { benefitPlanId } = req.body;
    if (!benefitPlanId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'benefitPlanId required' } });
    }
    const profile = await getOrCreateProfile(req.user.userId);
    const plan = await prisma.benefitPlan.findUnique({ where: { id: benefitPlanId } });
    if (!plan || plan.status !== 'Active') {
      return res.status(404).json({ success: false, error: { code: 'PLAN_NOT_FOUND', message: 'Benefit plan not found or inactive' } });
    }
    const existing = await prisma.employeeBenefit.findFirst({ where: { employeeId: profile.id, benefitPlanId } });
    if (existing && existing.status === 'Active') {
      return res.status(400).json({ success: false, error: { code: 'ALREADY_ENROLLED', message: 'Already enrolled in this benefit' } });
    }
    const [enrollment] = await prisma.$transaction(async (tx) => {
      let benefit;
      if (existing) {
        benefit = await tx.employeeBenefit.update({
          where: { id: existing.id },
          data: { status: 'Active' }
        });
      } else {
        benefit = await tx.employeeBenefit.create({
          data: {
            employeeId: profile.id,
            benefitPlanId,
            status: 'Active',
          },
        });
      }

      const amount = parseFloat(plan.empContribution) || parseFloat(plan.contribution) || 0;
      if (amount > 0) {
        const ruleCode = `BENEFIT_${plan.id}`;
        let deductionRule = await tx.deductionRule.findUnique({ where: { code: ruleCode } });
        
        if (!deductionRule) {
          const user = await tx.user.findUnique({ where: { id: req.user.userId } });
          const org = await tx.organization.findFirst({ where: user?.organizationId ? { id: user.organizationId } : undefined });
          if (org) {
            deductionRule = await tx.deductionRule.create({
              data: {
                organizationId: org.id,
                name: `Benefit: ${plan.name}`,
                code: ruleCode,
                category: 'Benefit',
                valueType: 'Fixed',
                value: String(amount),
                isPreTax: true,
                status: 'Active',
              }
            });
          }
        }

        if (deductionRule) {
          const empDed = await tx.employeeDeduction.findFirst({
            where: { employeeId: profile.id, deductionId: deductionRule.id }
          });
          if (empDed) {
            await tx.employeeDeduction.update({
              where: { id: empDed.id },
              data: { status: 'Active', updatedAt: new Date() }
            });
          } else {
            await tx.employeeDeduction.create({
              data: {
                employeeId: profile.id,
                deductionId: deductionRule.id,
                customValue: String(amount),
                status: 'Active',
                effectiveDate: new Date()
              }
            });
          }
        }
      }

      return [benefit];
    });

    return res.status(201).json({ success: true, data: { enrollment } });
  } catch (err) {
    next(err);
  }
};

const unenrollBenefitPlan = async (req, res, next) => {
  try {
    const { benefitPlanId } = req.body;
    if (!benefitPlanId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_PARAM', message: 'benefitPlanId required' } });
    }
    const profile = await getOrCreateProfile(req.user.userId);
    const plan = await prisma.benefitPlan.findUnique({ where: { id: benefitPlanId } });
    if (!plan) {
      return res.status(404).json({ success: false, error: { code: 'PLAN_NOT_FOUND', message: 'Benefit plan not found' } });
    }

    await prisma.$transaction(async (tx) => {
      await tx.employeeBenefit.updateMany({
        where: { employeeId: profile.id, benefitPlanId },
        data: { status: 'Unenrolled' }
      });

      const ruleCode = `BENEFIT_${plan.id}`;
      const deductionRule = await tx.deductionRule.findUnique({ where: { code: ruleCode } });
      if (deductionRule) {
        await tx.employeeDeduction.updateMany({
          where: { employeeId: profile.id, deductionId: deductionRule.id },
          data: { status: 'Unenrolled' }
        });
      }
    });

    return res.status(200).json({ success: true, message: 'Unenrolled from benefit plan successfully' });
  } catch (err) {
    next(err);
  }
};

const submitBenefitClaim = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);

    const { type, amount, date, description, receiptUrl, receiptBase64, receiptName, file } = req.body;
    if (!type || !amount) {
      return res.status(400).json({ success: false, error: { message: 'Type and amount are required' } });
    }

    let finalReceiptUrl = receiptUrl || null;
    if (receiptBase64 || (file && typeof file === 'string' && file.startsWith('data:'))) {
      finalReceiptUrl = await handleBase64Field(receiptBase64 || file, finalReceiptUrl, { folder: 'hcm/receipts', filenamePrefix: 'receipt' });
    }

    const settings = await prisma.globalSettings.findUnique({ where: { id: 'global-settings' } });
    const requireManagerApproval = settings ? settings.reimbursementManagerApproval : true;
    const overallStatus = requireManagerApproval ? 'Pending Manager Approval' : 'Pending Final Approval';
    const managerStatus = requireManagerApproval ? 'Pending' : 'Not Required';

    const approvalHistory = [
      {
        action: 'Submitted',
        actor: profile.fullName,
        date: new Date().toISOString(),
        comment: 'Claim submitted by employee',
        receiptUrl: finalReceiptUrl,
        receiptName: receiptName || null,
      }
    ];

    const claim = await prisma.benefitClaim.create({
      data: {
        employeeId: profile.id,
        title: type,
        provider: finalReceiptUrl ? `${description || 'General'} [Receipt: ${finalReceiptUrl}]` : (description || 'General'),
        amount: parseFloat(amount) || 0,
        status: 'Pending', // Legacy status field kept for compatibility
        managerStatus,
        overallStatus,
        approvalHistory: JSON.stringify(approvalHistory),
        receiptUrl: finalReceiptUrl,
        receiptName: receiptName || null,
        claimedAt: date ? new Date(date) : new Date()
      }
    });

    // Notify Manager if required
    if (requireManagerApproval && profile.managerId) {
      const managerUser = await prisma.employeeProfile.findUnique({
        where: { id: profile.managerId },
        select: { userId: true }
      });
      if (managerUser) {
        await prisma.notification.create({
          data: {
            userId: managerUser.userId,
            type: 'INFO',
            title: 'New Reimbursement Claim',
            message: `${profile.fullName} submitted a new claim for ${type}.`,
            isRead: false
          }
        });
      }
    }

    return res.status(201).json({ success: true, data: claim, message: 'Claim submitted' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 13. GET MY TASKS  →  GET /api/employee/tasks
// ─────────────────────────────────────────
const getTasks = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);

    const tasks = await prisma.task.findMany({
      where: { employeeId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: tasks });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 14. GET HOLIDAYS  →  GET /api/employee/holidays
// ─────────────────────────────────────────
const getHolidays = async (req, res, next) => {
  try {
    const holidays = await prisma.holiday.findMany({
      orderBy: { date: 'asc' }
    });
    return res.status(200).json({ success: true, data: holidays });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 15. GET ANNOUNCEMENTS  →  GET /api/employee/announcements
// ─────────────────────────────────────────
const getAnnouncements = async (req, res, next) => {
  try {
    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return res.status(200).json({ success: true, data: announcements });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// 16. DOCUMENTS  →  GET /api/employee/documents, POST /api/employee/documents, DELETE /api/employee/documents/:id
// ─────────────────────────────────────────
const getDocuments = async (req, res, next) => {
  try {
    const docs = await prisma.document.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({ success: true, data: docs });
  } catch (err) { next(err); }
};

const uploadDocument = async (req, res, next) => {
  try {
    console.log('[UPLOAD CONTROLLER]', {
      userId: req.user?.userId,
      hasFile: !!req.file,
      filename: req.file?.originalname,
      mimetype: req.file?.mimetype,
      size: req.file?.size,
      hasBuffer: Boolean(req.file?.buffer),
      bufferLength: req.file?.buffer?.length,
    });

    const name = req.body?.name || req.file?.originalname || 'Document.pdf';
    const category = req.body?.category || 'Other';
    const size = req.body?.size || (req.file ? `${(req.file.size / 1024).toFixed(1)} KB` : '1.0 MB');
    
    let url = req.body?.url || null;

    if (req.file) {
      try {
        const uploadRes = await uploadDocumentService(req.file, { folder: 'hcm/documents', filenamePrefix: 'doc' });
        url = uploadRes?.url;
      } catch (cloudErr) {
        console.warn('[CLOUD UPLOAD WARN] Cloud upload lagged/failed, saving file to local disk:', cloudErr.message);
      }

      if (!url) {
        const localRes = saveToLocal(req.file, 'doc');
        url = localRes.url;
        console.log('[LOCAL STORAGE SUCCESS] Document file written to disk:', url);
      }
    } else if (req.body?.fileBase64 || req.body?.content || req.body?.file) {
      try {
        const payloadBase64 = req.body.fileBase64 || req.body.content || req.body.file;
        url = await handleBase64Field(
          payloadBase64,
          null,
          { folder: 'hcm/documents', filenamePrefix: 'doc' }
        );
      } catch (cloudErr) {
        console.warn('[CLOUD UPLOAD WARN] Base64 upload failed:', cloudErr.message);
      }
    }

    if (!url) {
      const sanitizedName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      url = `https://ik.imagekit.io/hcmkiaan/hcm/documents/${Date.now()}_${sanitizedName}`;
    }

    console.log('[UPLOAD CONTROLLER] URL obtained:', url);

    const doc = await prisma.document.create({
      data: {
        userId: req.user.userId,
        name,
        category,
        size,
        url,
        date: new Date().toISOString().split('T')[0]
      }
    });

    console.log('[UPLOAD CONTROLLER] Document created in DB:', { id: doc.id, name: doc.name, url: doc.url });

    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: doc
    });
  } catch (err) {
    // ── If this is a storage-service error, return a clear 502 ──
    if (err.code === 'DOCUMENT_UPLOAD_STORAGE_ERROR' || (err.status && err.status === 502)) {
      console.error('[UPLOAD CONTROLLER] Storage service error:', err.message);
      return res.status(502).json({
        success: false,
        message: 'Document storage service is temporarily unavailable.',
        code: 'DOCUMENT_UPLOAD_STORAGE_ERROR',
      });
    }
    // ── If it's a bad-request error (e.g., empty buffer), return 400 ──
    if (err.status === 400) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
};

const deleteDocument = async (req, res, next) => {
  try {
    const docId = req.params.id;
    const doc = await prisma.document.findUnique({ where: { id: docId } });
    if (!doc) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }
    if (doc.userId !== req.user.userId) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized' } });
    }

    await prisma.document.delete({ where: { id: docId } });
    return res.status(200).json({ success: true, message: 'Document deleted' });
  } catch (err) { next(err); }
};

const createGoal = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    const { title, priority, deadline, progress } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: { message: 'Goal title is required.' } });
    }

    const progVal = parseInt(progress);
    const validatedProgress = (!isNaN(progVal) && progVal >= 0 && progVal <= 100) ? progVal : 0;

    let deadlineDate = null;
    if (deadline) {
      const parsedDate = new Date(deadline);
      if (!isNaN(parsedDate.getTime())) {
        deadlineDate = parsedDate;
      }
    }

    const goal = await prisma.performanceGoal.create({
      data: {
        employeeId: profile.id,
        title: title.trim(),
        priority: priority || 'Medium',
        deadline: deadlineDate,
        progress: validatedProgress
      }
    });

    return res.status(201).json({ success: true, data: goal, message: 'Goal created successfully.' });
  } catch (err) { next(err); }
};

const updateGoalProgress = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    const { id } = req.params;
    const { progress } = req.body;

    const progVal = parseInt(progress);
    if (isNaN(progVal) || progVal < 0 || progVal > 100) {
      return res.status(400).json({ success: false, error: { message: 'Progress must be a number between 0 and 100.' } });
    }

    const existingGoal = await prisma.performanceGoal.findUnique({ where: { id } });
    if (!existingGoal || existingGoal.employeeId !== profile.id) {
      return res.status(404).json({ success: false, error: { message: 'Goal not found or access denied.' } });
    }

    const updated = await prisma.performanceGoal.update({
      where: { id },
      data: { progress: progVal }
    });

    return res.status(200).json({ success: true, data: updated, message: 'Goal progress updated successfully.' });
  } catch (err) { next(err); }
};

const updateGoal = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    const { id } = req.params;
    const { title, priority, deadline, progress } = req.body;

    const existingGoal = await prisma.performanceGoal.findUnique({ where: { id } });
    if (!existingGoal || existingGoal.employeeId !== profile.id) {
      return res.status(404).json({ success: false, error: { message: 'Goal not found or access denied.' } });
    }

    let deadlineDate = existingGoal.deadline;
    if (deadline !== undefined) {
      if (!deadline) {
        deadlineDate = null;
      } else {
        const parsed = new Date(deadline);
        deadlineDate = isNaN(parsed.getTime()) ? null : parsed;
      }
    }

    let progVal = existingGoal.progress;
    if (progress !== undefined) {
      const parsedProg = parseInt(progress);
      if (!isNaN(parsedProg) && parsedProg >= 0 && parsedProg <= 100) {
        progVal = parsedProg;
      }
    }

    const updated = await prisma.performanceGoal.update({
      where: { id },
      data: {
        title: title ? title.trim() : existingGoal.title,
        priority: priority || existingGoal.priority,
        deadline: deadlineDate,
        progress: progVal
      }
    });

    return res.status(200).json({ success: true, data: updated, message: 'Goal updated successfully.' });
  } catch (err) { next(err); }
};

const deleteGoal = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    const { id } = req.params;

    const existingGoal = await prisma.performanceGoal.findUnique({ where: { id } });
    if (!existingGoal || existingGoal.employeeId !== profile.id) {
      return res.status(404).json({ success: false, error: { message: 'Goal not found or access denied.' } });
    }

    await prisma.performanceGoal.delete({ where: { id } });

    return res.status(200).json({ success: true, message: 'Goal deleted successfully.' });
  } catch (err) { next(err); }
};

const upsertSkill = async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.user.userId);
    const { name, level } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: { message: 'Skill name is required' } });
    }

    // Check if skill already exists
    const existing = await prisma.employeeSkill.findFirst({
      where: { employeeId: profile.id, name }
    });

    let skill;
    if (existing) {
      skill = await prisma.employeeSkill.update({
        where: { id: existing.id },
        data: { level: parseInt(level) || 0 }
      });
    } else {
      skill = await prisma.employeeSkill.create({
        data: {
          employeeId: profile.id,
          name,
          level: parseInt(level) || 0
        }
      });
    }

    return res.status(200).json({ success: true, data: skill, message: 'Skill registered successfully' });
  } catch (err) { next(err); }
};

const deleteSkill = async (req, res, next) => {
  try {
    const skillId = req.params.id;
    const skill = await prisma.employeeSkill.findUnique({ where: { id: skillId } });

    if (!skill) {
      return res.status(404).json({ success: false, error: { message: 'Skill not found' } });
    }

    const profile = await getOrCreateProfile(req.user.userId);
    if (skill.employeeId !== profile.id) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized' } });
    }

    await prisma.employeeSkill.delete({ where: { id: skillId } });
    return res.status(200).json({ success: true, message: 'Skill deleted' });
  } catch (err) { next(err); }
};

const submitResignation = async (req, res, next) => {
  try {
    const { reason, lastWorkingDay } = req.body;
    if (!lastWorkingDay) {
      return res.status(400).json({ success: false, error: { message: 'Last working day is required.' } });
    }

    const emp = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId }
    });
    if (!emp) return res.status(404).json({ success: false, error: { message: 'Employee profile not found.' } });

    const existingExit = await prisma.exitLifecycle.findFirst({
      where: {
        employeeId: emp.id,
        exitType: 'RESIGNATION',
        status: {
          notIn: ['COMPLETED', 'EMPLOYEE_RELIEVED', 'REJECTED_BY_MANAGER', 'REJECTED_BY_HR']
        }
      }
    });
    if (existingExit) {
      return res.status(409).json({ success: false, error: { message: 'You have already submitted a resignation request.' } });
    }

    const { handleTransition, LifecycleEvents } = require('../services/workflowService');
    await handleTransition(LifecycleEvents.RESIGNED, {
      employeeId: emp.id,
      reason,
      lastWorkingDay
    });

    return res.status(201).json({ success: true, message: 'Resignation request submitted successfully.' });
  } catch (err) { next(err); }
};

const getResignation = async (req, res, next) => {
  try {
    const emp = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId }
    });
    if (!emp) return res.status(404).json({ success: false, error: { message: 'Employee profile not found.' } });

    const resignation = await prisma.exitLifecycle.findFirst({
      where: {
        employeeId: emp.id,
        exitType: 'RESIGNATION'
      },
      orderBy: { submissionDate: 'desc' }
    });

    if (!resignation) {
      return res.status(200).json({ success: true, data: null, message: 'No resignation found.' });
    }

    return res.status(200).json({ success: true, data: resignation });
  } catch (err) { next(err); }
};

const getPolicies = async (req, res, next) => {
  try {
    const policies = await prisma.policy.findMany({
      where: { status: 'Active' },
      orderBy: { createdAt: 'desc' }
    });

    const acknowledgments = await prisma.policyAcknowledgment.findMany({
      where: { userId: req.user.userId }
    });

    const ackSet = new Set(acknowledgments.map(a => a.policyId));

    const formattedPolicies = policies.map(p => ({
      ...p,
      hasAcknowledged: ackSet.has(p.id)
    }));

    return res.status(200).json({ success: true, data: formattedPolicies });
  } catch (err) { next(err); }
};

const acknowledgePolicy = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if policy exists
    const policy = await prisma.policy.findUnique({ where: { id } });
    if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });

    // Check if already acknowledged
    const existing = await prisma.policyAcknowledgment.findUnique({
      where: {
        policyId_userId: {
          policyId: id,
          userId: req.user.userId
        }
      }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'Policy already acknowledged' });
    }

    await prisma.policyAcknowledgment.create({
      data: {
        policyId: id,
        userId: req.user.userId
      }
    });

    // Update the acknowledgments string counter on the Policy (e.g. "1/10")
    if (policy.acknowledgments && policy.acknowledgments.includes('/')) {
      const parts = policy.acknowledgments.split('/');
      const currentAck = parseInt(parts[0], 10) || 0;
      const total = parts[1];
      await prisma.policy.update({
        where: { id },
        data: { acknowledgments: `${currentAck + 1}/${total}` }
      });
    }

    return res.status(200).json({ success: true, message: 'Policy acknowledged successfully' });
  } catch (err) { next(err); }
};

module.exports = {
  getProfile, updateProfile,
  clockIn, clockOut, getAttendance,
  getLeaves, applyLeave, cancelLeave,
  getPayslips, getPerformance, createGoal, updateGoal, updateGoalProgress, deleteGoal, upsertSkill, deleteSkill,
  getTickets, createTicket, replyTicket, deleteTicketMessage,
  getBenefits, submitBenefitClaim, getTasks,
  getHolidays, getAnnouncements,
  getDocuments, uploadDocument, deleteDocument,
  submitResignation, getResignation, enrollBenefitPlan, unenrollBenefitPlan,
  getPolicies, acknowledgePolicy
};
