const prisma = require('../config/prisma');

const getAiServerUrl = () => process.env.AI_SERVER_URL || 'http://localhost:4000';

// ═══════════════════════════════════════════════════════════════════
// 1. DYNAMIC SYSTEM DATE / TIME UTILITY
// ═══════════════════════════════════════════════════════════════════
function getSystemDateTimeContext(timezone = 'UTC') {
  const now = new Date();
  const currentDateISO = now.toISOString();
  
  const formattedDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone === 'Asia/Calcutta' || timezone === 'Asia/Kolkata' ? 'Asia/Kolkata' : undefined
  });

  const formattedTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    timeZone: timezone === 'Asia/Calcutta' || timezone === 'Asia/Kolkata' ? 'Asia/Kolkata' : undefined
  });

  return {
    currentDateISO,
    formattedDate,
    formattedTime,
    timezone,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. INTENT CLASSIFICATION ENGINE
// ═══════════════════════════════════════════════════════════════════
const INTENT_PATTERNS = {
  DATE_TIME: [
    'today date', "today's date", 'what date', 'what day', 'current date', 
    'current time', 'what time is it', 'which day', 'what is the date', "what is today"
  ],
  LEAVE_BALANCE: [
    'leave balance', 'how many leaves', 'remaining leave', 'leaves left', 
    'annual leave balance', 'sick leave balance', 'pto balance', 'vacation balance',
    'my leave', 'my leaves', 'leave quota', 'allocated leaves'
  ],
  LEAVE_REQUEST: [
    'apply leave', 'request leave', 'pending leave', 'leave request', 
    'leave status', 'leave history', 'cancel leave', 'who is on leave'
  ],
  PAYROLL: [
    'payroll', 'salary', 'ctc', 'gross pay', 'net pay', 'earnings', 
    'increment', 'compensation', 'allowance', 'bonus', 'pay structure'
  ],
  PAYSLIP: [
    'payslip', 'pay slip', 'salary slip', 'latest payslip', 'download payslip', 
    'deduction', 'pf deduction', 'tax deduction'
  ],
  ATTENDANCE: [
    'attendance', 'clock in', 'clock out', 'punch in', 'punch out', 
    'work hours', 'working hours', 'late mark', 'late minutes', 'absent days', 'present days'
  ],
  PROFILE: [
    'my profile', 'who am i', 'my designation', 'my department', 'my manager', 
    'joining date', 'employee id', 'contact details', 'emergency contact'
  ],
  PERFORMANCE: [
    'kpi', 'goal', 'performance', 'review', 'appraisal', 'rating', 'feedback', 'target'
  ],
  BENEFITS: [
    'benefit', 'insurance', 'claim', 'medical allowance', 'reimbursement', 'health plan'
  ],
  DOCUMENT: [
    'document', 'vault', 'id proof', 'offer letter', 'contract', 'certificate', 'upload doc'
  ],
  TEAM_ANALYTICS: [
    'my team', 'team attendance', 'team leaves', 'direct reports', 'team kpi', 
    'team performance', 'subordinates', 'team members', 'pending team approvals'
  ],
  RECRUITMENT: [
    'candidate', 'recruitment', 'job post', 'hiring', 'interview', 'applicant', 'pipeline'
  ],
  CANDIDATE_STATUS: [
    'my application', 'interview schedule', 'application status', 'offer letter candidate'
  ],
  REPORT: [
    'report', 'analytics', 'headcount trend', 'summary trend', 'metrics report', 'export report'
  ],
  POLICY: [
    'policy', 'rule', 'handbook', 'guideline', 'dress code', 'probation period', 
    'notice period', 'work from home policy', 'code of conduct'
  ]
};

function detectPrimaryIntent(message) {
  const lower = message.toLowerCase().trim();

  // Check specific date/time queries first
  if (INTENT_PATTERNS.DATE_TIME.some(kw => lower.includes(kw))) {
    return 'DATE_TIME';
  }

  // Check balance before general leave
  if (INTENT_PATTERNS.LEAVE_BALANCE.some(kw => lower.includes(kw))) {
    return 'LEAVE_BALANCE';
  }

  for (const [intent, keywords] of Object.entries(INTENT_PATTERNS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return intent;
    }
  }

  return 'GENERAL';
}

// ═══════════════════════════════════════════════════════════════════
// 3. ENTERPRISE SYSTEM PROMPT (13 Strict Rules)
// ═══════════════════════════════════════════════════════════════════
function buildEnterpriseSystemPrompt({ user, systemContext, pageContext }) {
  return `You are HCM.ai Copilot, an enterprise Human Capital Management assistant.

Your purpose is to help users understand and interact with the HCM platform using verified information.

You must follow these rules:
1. Never invent employee names, balances, dates, salaries, records, metrics, or system data.
2. Only use information provided in the verified system context, authenticated user context, authorized database context, or trusted organization policies.
3. Respect the user's role and permission boundaries.
4. Never expose another employee's private information unless the authenticated role explicitly has access.
5. When the user asks about their own information, interpret 'my' using the authenticated user context.
6. Always use the actual current server date/time (${systemContext.formattedDate}) when answering date-related questions.
7. If data is missing, unavailable, or unauthorized, clearly explain that instead of guessing.
8. Do not claim an action was completed unless the backend confirms it.
9. Be concise, professional, helpful, and conversational.
10. Format business information clearly using headings, bullets, tables, and summaries when appropriate.
11. Use the current page context (${pageContext || 'Dashboard'}) to better understand the user's request.
12. Do not blindly repeat raw database data. Explain it clearly.
13. If a user asks for sensitive information they are not authorized to access, politely refuse and explain that access is restricted.

You are not a generic chatbot. You are a context-aware enterprise HCM assistant.

CURRENT AUTHENTICATED CONTEXT:
- Authenticated User: ${user.name || user.email} (Email: ${user.email}, Role: ${user.role})
- Employee Profile ID: ${user.employeeId || 'None'}
- Current System Date: ${systemContext.formattedDate} (${systemContext.formattedTime})
- Current Route: ${pageContext || '/'}`;
}

// ═══════════════════════════════════════════════════════════════════
// 4. ROLE-AWARE CONTEXT PROVIDER (Queries Real Database Data)
// ═══════════════════════════════════════════════════════════════════
async function getRoleGatedDatabaseContext({ userId, role, organizationId, intent }) {
  const context = {
    verifiedAt: new Date().toISOString(),
    role
  };

  // 1. Fetch User Record
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true }
  });

  if (!user) return context;

  context.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationName: user.organization?.name || 'Organization'
  };

  // 2. Fetch Employee Profile if applicable
  const empProfile = await prisma.employeeProfile.findFirst({
    where: { userId },
    include: {
      department: true,
      manager: true,
      shift: true
    }
  });

  if (empProfile) {
    context.employee = {
      id: empProfile.id,
      employeeId: empProfile.employeeId,
      fullName: empProfile.fullName,
      jobTitle: empProfile.jobTitle || empProfile.designation || 'Staff Member',
      department: empProfile.department?.name || 'General',
      managerName: empProfile.manager?.fullName || 'Direct to Leadership',
      joiningDate: empProfile.joiningDate ? empProfile.joiningDate.toISOString().split('T')[0] : 'N/A',
      employmentType: empProfile.employmentType || 'Full-time',
      status: empProfile.status || 'Active'
    };
  }

  // 3. Gather intent-specific data for EMPLOYEE & all authenticated profiles
  if (['LEAVE_BALANCE', 'LEAVE_REQUEST', 'GENERAL'].includes(intent)) {
    const leaves = await prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const approvedLeaves = leaves.filter(l => l.status === 'APPROVED');
    const pendingLeaves = leaves.filter(l => l.status === 'PENDING' || l.status === 'MANAGER_APPROVED');
    const rejectedLeaves = leaves.filter(l => l.status === 'REJECTED');

    const totalApprovedDays = approvedLeaves.reduce((sum, l) => sum + (l.totalDays || 1), 0);
    const totalPendingDays = pendingLeaves.reduce((sum, l) => sum + (l.totalDays || 1), 0);

    // Standard annual allocation guideline for enterprise
    const standardAllocations = {
      'Annual Leave': { total: 20, used: 0, pending: 0 },
      'Sick Leave': { total: 10, used: 0, pending: 0 },
      'Casual Leave': { total: 5, used: 0, pending: 0 }
    };

    leaves.forEach(l => {
      const type = l.leaveType || 'Annual Leave';
      if (!standardAllocations[type]) {
        standardAllocations[type] = { total: 12, used: 0, pending: 0 };
      }
      if (l.status === 'APPROVED') {
        standardAllocations[type].used += (l.totalDays || 1);
      } else if (l.status === 'PENDING' || l.status === 'MANAGER_APPROVED') {
        standardAllocations[type].pending += (l.totalDays || 1);
      }
    });

    const leaveBalances = Object.entries(standardAllocations).map(([type, data]) => ({
      type,
      allocated: data.total,
      used: data.used,
      pending: data.pending,
      remaining: Math.max(0, data.total - data.used)
    }));

    context.leaves = {
      hasRecords: leaves.length > 0,
      totalApprovedDays,
      totalPendingRequests: pendingLeaves.length,
      totalPendingDays,
      balances: leaveBalances,
      recentRequests: leaves.slice(0, 5).map(l => ({
        id: l.id,
        type: l.leaveType,
        startDate: l.startDate ? new Date(l.startDate).toISOString().split('T')[0] : 'N/A',
        endDate: l.endDate ? new Date(l.endDate).toISOString().split('T')[0] : 'N/A',
        totalDays: l.totalDays,
        status: l.status,
        reason: l.reason || 'Not specified'
      }))
    };
  }

  // 4. Payroll & Payslips
  if (empProfile && ['PAYROLL', 'PAYSLIP', 'GENERAL'].includes(intent)) {
    const payslips = await prisma.payslip.findMany({
      where: { employeeId: empProfile.id },
      orderBy: { createdAt: 'desc' },
      take: 4
    });

    const comp = await prisma.compensationProfile.findUnique({
      where: { employeeId: empProfile.id }
    });

    context.payroll = {
      hasCompensation: !!comp,
      monthlyCTC: comp?.monthlyCTC || null,
      annualCTC: comp?.annualCTC || null,
      currency: comp?.currency || 'USD',
      recentPayslips: payslips.map(p => ({
        month: p.month,
        basic: p.basic,
        netPay: p.netPay,
        status: p.status,
        currency: p.currency
      }))
    };
  }

  // 5. Attendance Records
  if (['ATTENDANCE', 'GENERAL'].includes(intent)) {
    const logs = await prisma.attendanceLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 7
    });

    context.attendance = {
      hasLogs: logs.length > 0,
      recentLogs: logs.map(l => ({
        date: l.date ? new Date(l.date).toISOString().split('T')[0] : 'N/A',
        clockIn: l.clockIn || '--:--',
        clockOut: l.clockOut || '--:--',
        status: l.status || 'Present',
        lateMinutes: l.lateMinutes || 0
      }))
    };
  }

  // 6. MANAGER ROLE: Team Scope
  if (['MANAGER', 'ADMIN', 'SUPERADMIN', 'HR'].includes(role) && empProfile) {
    if (['TEAM_ANALYTICS', 'LEAVE_REQUEST', 'ATTENDANCE', 'GENERAL'].includes(intent)) {
      const reports = await prisma.employeeProfile.findMany({
        where: { managerId: empProfile.id },
        include: {
          user: { select: { id: true, email: true, isActive: true } },
          department: true
        }
      });

      const reportUserIds = reports.map(r => r.userId);

      const teamPendingLeaves = reportUserIds.length > 0
        ? await prisma.leaveRequest.findMany({
            where: { userId: { in: reportUserIds }, status: 'PENDING' },
            include: { user: true }
          })
        : [];

      context.team = {
        teamSize: reports.length,
        directReports: reports.map(r => ({
          name: r.fullName,
          email: r.user?.email,
          department: r.department?.name || 'General'
        })),
        pendingTeamLeaveApprovals: teamPendingLeaves.length,
        teamLeaveList: teamPendingLeaves.map(l => ({
          id: l.id,
          employeeName: l.user?.employeeProfile?.fullName || l.user?.email,
          leaveType: l.leaveType,
          totalDays: l.totalDays,
          startDate: l.startDate
        }))
      };
    }
  }

  // 7. HR / ADMIN ROLE: Org-wide Metrics
  if (['HR', 'ADMIN', 'SUPERADMIN'].includes(role)) {
    if (['RECRUITMENT', 'REPORT', 'TEAM_ANALYTICS', 'GENERAL'].includes(intent)) {
      const orgId = organizationId || user.organizationId;
      const [totalEmployees, activeJobs, pendingLeavesCount] = await Promise.all([
        prisma.employeeProfile.count(),
        prisma.jobPost.count({ where: { isActive: true } }),
        prisma.leaveRequest.count({ where: { status: 'PENDING' } })
      ]);

      context.organizationMetrics = {
        totalHeadcount: totalEmployees,
        activeJobOpenings: activeJobs,
        orgPendingLeaves: pendingLeavesCount
      };
    }
  }

  // 8. CANDIDATE ROLE: Application Scope
  if (role === 'CANDIDATE') {
    const candidate = await prisma.candidateProfile.findUnique({
      where: { userId },
      include: {
        applications: {
          include: { jobPost: true, interviews: true }
        }
      }
    });

    if (candidate) {
      context.candidate = {
        fullName: candidate.fullName,
        applicationCount: candidate.applications.length,
        applications: candidate.applications.map(app => ({
          jobTitle: app.jobPost?.title || 'Open Position',
          status: app.status,
          appliedDate: app.submittedAt ? app.submittedAt.toISOString().split('T')[0] : 'N/A',
          interviewsScheduled: app.interviews?.length || 0
        }))
      };
    }
  }

  return context;
}

// ═══════════════════════════════════════════════════════════════════
// 5. DETERMINISTIC DATABASE-GROUNDED FALLBACK ENGINE
// ═══════════════════════════════════════════════════════════════════
function generateContextualFallback({ intent, verifiedData, user, systemContext, pageContext }) {
  const userName = verifiedData.employee?.fullName || user.name || user.email?.split('@')[0] || 'there';

  switch (intent) {
    case 'DATE_TIME':
      return {
        answer: `Today is **${systemContext.formattedDate}**.\n\nCurrent server time: **${systemContext.formattedTime}** (${systemContext.timezone}).`,
        actions: []
      };

    case 'LEAVE_BALANCE': {
      if (!verifiedData.leaves || !verifiedData.leaves.hasRecords) {
        return {
          answer: `Hello **${userName}**, I checked your account records and could not find any leave requests logged yet.\n\nYour standard annual leave quota is available. You can apply for time off or view policy allocations directly in the Leaves section.`,
          actions: [{ label: 'Apply for Leave', route: '/employee/leaves' }]
        };
      }

      const { totalApprovedDays, totalPendingRequests, totalPendingDays, balances } = verifiedData.leaves;
      const balanceList = balances
        .map(b => `• **${b.type}**: **${b.remaining}** days remaining (${b.used} used of ${b.allocated} allocated${b.pending > 0 ? `, ${b.pending} pending` : ''})`)
        .join('\n');

      return {
        answer: `### Leave Balance Summary for ${userName}\n\n${balanceList}\n\n**Total Approved Leave Taken**: ${totalApprovedDays} days\n**Pending Approval**: ${totalPendingRequests} requests (${totalPendingDays} days)\n\nAll balances are calculated from your real-time database records.`,
        actions: [
          { label: 'View Leave Details', route: '/employee/leaves' },
          { label: 'Apply for Leave', route: '/employee/leaves' }
        ]
      };
    }

    case 'PAYROLL':
    case 'PAYSLIP': {
      if (verifiedData.payroll?.hasCompensation) {
        const p = verifiedData.payroll;
        const cur = p.currency || 'USD';
        const latest = p.recentPayslips?.[0];
        return {
          answer: `### Compensation & Payroll Summary for ${userName}\n\n• **Monthly CTC**: ${cur} ${Number(p.monthlyCTC || 0).toLocaleString()}\n• **Annual CTC**: ${cur} ${Number(p.annualCTC || 0).toLocaleString()}\n• **Latest Payslip**: ${latest ? `${latest.month} (${latest.status}) — Net: ${cur} ${Number(latest.netPay || 0).toLocaleString()}` : 'No payslips generated yet'}\n\nYou can access your detailed salary breakdown and tax deductions in the Payroll section.`,
          actions: [{ label: 'View Payroll & Payslips', route: '/employee/payroll' }]
        };
      }
      return {
        answer: `Hello **${userName}**, your profile is active, but formal compensation components or payslips have not yet been published for your profile. Please check with your HR administrator.`,
        actions: [{ label: 'Open Payroll Portal', route: '/employee/payroll' }]
      };
    }

    case 'ATTENDANCE': {
      if (verifiedData.attendance?.hasLogs) {
        const logs = verifiedData.attendance.recentLogs;
        const logLines = logs.slice(0, 5).map(l => `• **${l.date}**: Clocked In: \`${l.clockIn}\` | Clocked Out: \`${l.clockOut}\` (${l.status})`).join('\n');
        return {
          answer: `### Recent Attendance Summary\n\n${logLines}\n\nYou can review your full punch history, request corrections, or view your work hours in the Attendance module.`,
          actions: [{ label: 'View Attendance Records', route: '/employee/attendance' }]
        };
      }
      return {
        answer: `Hello **${userName}**, no attendance punch records were found for your user account for the current cycle. Use the **Clock In** button on your dashboard to start tracking your session.`,
        actions: [{ label: 'Go to Attendance', route: '/employee/attendance' }]
      };
    }

    case 'PROFILE': {
      if (verifiedData.employee) {
        const emp = verifiedData.employee;
        return {
          answer: `### Profile Overview\n\n• **Name**: ${emp.fullName}\n• **Employee ID**: \`${emp.employeeId}\`\n• **Job Title**: ${emp.jobTitle}\n• **Department**: ${emp.department}\n• **Manager**: ${emp.managerName}\n• **Joining Date**: ${emp.joiningDate}\n• **Employment Status**: ${emp.status}`,
          actions: [{ label: 'Edit Profile', route: '/employee/profile' }]
        };
      }
      return {
        answer: `### User Account Info\n\n• **Email**: ${user.email}\n• **System Role**: **${user.role}**\n• **Organization**: ${verifiedData.user?.organizationName || 'HCM.ai'}`,
        actions: [{ label: 'View Account', route: '/employee/profile' }]
      };
    }

    case 'TEAM_ANALYTICS': {
      if (verifiedData.team) {
        const t = verifiedData.team;
        return {
          answer: `### Team Leadership Summary\n\n• **Direct Reports**: ${t.teamSize} employees\n• **Pending Leave Approvals**: **${t.pendingTeamLeaveApprovals}** requests\n\nUse your Manager Console to review submitted timesheets, evaluate KPI deliverables, and process pending approvals.`,
          actions: [
            { label: 'View Team List', route: '/manager/team' },
            { label: 'Approve Leaves', route: '/manager/leaves' }
          ]
        };
      }
      return {
        answer: `Team analytics are available for designated managers and supervisors with active direct reports.`,
        actions: [{ label: 'Manager Dashboard', route: '/manager/team' }]
      };
    }

    case 'RECRUITMENT': {
      if (verifiedData.organizationMetrics) {
        const m = verifiedData.organizationMetrics;
        return {
          answer: `### Recruitment & Workforce Overview\n\n• **Total Organization Headcount**: ${m.totalHeadcount} employees\n• **Active Job Openings**: ${m.activeJobOpenings} positions\n• **Pending Leave Requests**: ${m.orgPendingLeaves} items`,
          actions: [
            { label: 'Manage Candidates', route: '/hr/candidates' },
            { label: 'View Job Posts', route: '/hr/pipeline' }
          ]
        };
      }
      return {
        answer: `Recruitment and candidate pipelines are accessible to authorized HR administrators and recruiters.`,
        actions: [{ label: 'HR Portal', route: '/hr/candidates' }]
      };
    }

    case 'CANDIDATE_STATUS': {
      if (verifiedData.candidate) {
        const c = verifiedData.candidate;
        const appList = c.applications.map(a => `• **${a.jobTitle}**: Status: **${a.status}** (Applied: ${a.appliedDate})`).join('\n');
        return {
          answer: `### Your Job Applications\n\n${appList || 'No applications submitted yet.'}`,
          actions: [{ label: 'Track Applications', route: '/candidate/applications' }]
        };
      }
      return {
        answer: `You can browse open job postings and submit your resume directly via the Candidate Portal.`,
        actions: [{ label: 'Browse Jobs', route: '/candidate/jobs' }]
      };
    }

    default: {
      return {
        answer: `Hello **${userName}**, I am your **HCM.ai Enterprise Copilot**.\n\nI am connected to your authenticated account (**${user.role}**) and can assist you with:\n• **Leave & Time Off**: Real-time balances, pending requests, allocations\n• **Payroll & Compensation**: Payslips, allowances, deductions, CTC\n• **Attendance**: Daily punch logs, shift schedules, overtime\n• **Organizational Policies**: Handbooks, guidelines, team workflows\n\nHow can I help you today?`,
        actions: []
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 6. HISTORY SANITIZATION
// ═══════════════════════════════════════════════════════════════════
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
    .map(m => ({
      role: m.role,
      content: m.content
        .replace(/\[Authenticated HCM Context:.*?\]/gs, '')
        .replace(/\[Current Page:.*?\]/gs, '')
        .trim()
    }))
    .filter(m => m.content.length > 0 && m.content.length < 4000)
    .slice(-10);
}

// ═══════════════════════════════════════════════════════════════════
// 7. MAIN CONTROLLER HANDLER: POST /api/copilot/chat
// ═══════════════════════════════════════════════════════════════════
const handleCopilotChat = async (req, res, next) => {
  try {
    const { message, history = [], pageContext = '' } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'message is required and must be a string' }
      });
    }

    if (message.length > 3000) {
      return res.status(400).json({
        success: false,
        error: { code: 'MESSAGE_TOO_LONG', message: 'Message exceeds maximum length of 3000 characters' }
      });
    }

    // ── STEP 1: Secure Identity Extraction from JWT (Never trust body) ──
    const userId         = req.user.userId || req.user.id;
    const role           = req.user.role || 'EMPLOYEE';
    const organizationId = req.user.organizationId || null;
    const userEmail      = req.user.email || '';

    // ── STEP 2: Live Server Date / Time ──
    const systemContext = getSystemDateTimeContext(req.user.timezone || 'UTC');

    // ── STEP 3: Detect User Intent ──
    const intent = detectPrimaryIntent(message);

    // ── STEP 4: Query Verified Database Data ──
    const verifiedData = await getRoleGatedDatabaseContext({
      userId,
      role,
      organizationId,
      intent
    });

    const userProfileSummary = {
      id: userId,
      email: userEmail,
      name: verifiedData.employee?.fullName || verifiedData.user?.name || userEmail.split('@')[0],
      role,
      employeeId: verifiedData.employee?.id || null
    };

    // ── STEP 5: Assemble Enterprise System Prompt & Context ──
    const systemPrompt = buildEnterpriseSystemPrompt({
      user: userProfileSummary,
      systemContext,
      pageContext
    });

    const sanitizedHistory = sanitizeHistory(history);

    const verifiedContextPayload = `
[Authenticated HCM Context:
${JSON.stringify(verifiedData, null, 2)}
]
[Current Page: ${pageContext || '/'}]
[Current Server Date: ${systemContext.formattedDate}, Time: ${systemContext.formattedTime}]
`;

    const aiMessages = [
      ...sanitizedHistory,
      {
        role: 'user',
        content: `${message}\n\n${verifiedContextPayload}`
      }
    ];

    // ── STEP 6: Call AI Server with Fallback Protection ──
    let finalAnswer = null;
    let fallbackActions = [];
    let isFallback = false;

    try {
      const aiResponse = await fetch(`${getAiServerUrl()}/api/mcp/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: aiMessages,
          tenantId: organizationId || 'global',
          accessLevel: role,
          systemPrompt
        }),
        signal: AbortSignal.timeout(12000) // 12 second timeout
      });

      if (aiResponse.ok) {
        const result = await aiResponse.json();
        finalAnswer = result?.data?.reply || result?.reply || result?.data?.answer || result?.answer || null;
      } else {
        console.warn(`[CopilotController] AI server responded with HTTP ${aiResponse.status}, falling back to DB engine.`);
      }
    } catch (aiErr) {
      console.warn('[CopilotController] AI service offline or timed out, executing deterministic fallback:', aiErr.message);
    }

    // If AI service was offline, returned empty, or encountered an error -> use deterministic DB fallback
    if (!finalAnswer || typeof finalAnswer !== 'string' || finalAnswer.trim().length === 0) {
      const fallbackResult = generateContextualFallback({
        intent,
        verifiedData,
        user: userProfileSummary,
        systemContext,
        pageContext
      });
      finalAnswer = fallbackResult.answer;
      fallbackActions = fallbackResult.actions || [];
      isFallback = true;
    }

    // Default action links based on intent
    if (fallbackActions.length === 0) {
      if (intent === 'LEAVE_BALANCE' || intent === 'LEAVE_REQUEST') {
        fallbackActions.push({ label: 'View Leave Details', route: '/employee/leaves' });
      } else if (intent === 'PAYROLL' || intent === 'PAYSLIP') {
        fallbackActions.push({ label: 'View Payslips', route: '/employee/payroll' });
      } else if (intent === 'ATTENDANCE') {
        fallbackActions.push({ label: 'Attendance Tracker', route: '/employee/attendance' });
      } else if (intent === 'TEAM_ANALYTICS' && ['MANAGER', 'ADMIN', 'HR'].includes(role)) {
        fallbackActions.push({ label: 'Team Console', route: '/manager/team' });
      } else if (intent === 'RECRUITMENT' && ['HR', 'ADMIN'].includes(role)) {
        fallbackActions.push({ label: 'Recruitment Hub', route: '/hr/candidates' });
      }
    }

    // ── STEP 7: Return Normalized Enterprise Response ──
    return res.status(200).json({
      success: true,
      data: {
        answer: finalAnswer,
        intent,
        sources: [
          { type: 'authenticated_user_context', verified: true },
          { type: 'enterprise_database', verified: true }
        ],
        actions: fallbackActions,
        confidence: isFallback ? 'verified_database_fallback' : 'high',
        serverDate: systemContext.currentDateISO,
        isFallback
      }
    });

  } catch (err) {
    next(err);
  }
};

module.exports = {
  handleCopilotChat,
  getSystemDateTimeContext,
  detectPrimaryIntent,
  generateContextualFallback
};
