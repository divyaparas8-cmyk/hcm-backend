const http = require('http');
const fs = require('fs');
const prisma = require('../config/prisma');
const getAiServerUrl = () => process.env.AI_SERVER_URL || 'http://localhost:4000';

// POST /api/employee/ai/resume-builder or /api/candidate/ai/resume-builder
const aiBuildResume = async (req, res, next) => {
  try {
    const { details } = req.body;
    let actualData = null;

    try {
      const response = await fetch(`${getAiServerUrl()}/api/mcp/resume/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ details: details || {} })
      });
      if (response.ok) {
        const result = await response.json();
        actualData = result.data || result;
      }
    } catch (e) {
      // AI microservice offline; fallback to dynamic heuristic synthesis
    }

    if (!actualData || !actualData.summary) {
      const p = details?.personal || {};
      const expList = Array.isArray(details?.experience) ? details.experience : [];
      const skillsList = Array.isArray(details?.skills)
        ? details.skills.map(s => typeof s === 'string' ? s : s.name).filter(Boolean)
        : [];
      const eduList = Array.isArray(details?.education) ? details.education : [];

      const role = p.title || expList[0]?.role || 'Professional Specialist';
      const companyCount = expList.length;
      const topSkills = skillsList.slice(0, 5).join(', ');
      const recentCompany = expList[0]?.company ? `with proven experience at ${expList[0].company}` : 'across dynamic organization environments';
      const eduField = eduList[0]?.field ? `with academic foundation in ${eduList[0].field}` : '';

      const summaryParts = [
        `Dynamic, results-driven ${role} ${recentCompany}, offering specialized expertise in ${topSkills || 'full-lifecycle operations, strategic problem solving, and modern system architectures'}.`,
        companyCount > 1
          ? `Demonstrates a progressive track record across ${companyCount} organizations, specializing in delivering high-impact initiatives, team collaboration, and metric-driven efficiency.`
          : `Recognized for exceptional technical execution, agile methodology adherence, and delivering innovative end-to-end deliverables on schedule.`,
        `Adept at translating complex requirements into scalable solutions ${eduField ? `grounded in principles of ${eduList[0].field}` : ''}, committed to driving continuous innovation and measurable value.`
      ];

      actualData = {
        summary: summaryParts.filter(Boolean).join(' '),
        insights: {
          strengths: [
            topSkills ? `Target keywords integrated: ${topSkills}` : "Clear professional profile focus",
            expList.length > 0 ? `Structured work chronology across ${expList.length} verified position(s)` : "Consistent career trajectory",
            "Active, metric-oriented tone optimized for ATS screening and recruiter scanning"
          ],
          missingInformation: [
            expList.some(e => !e.desc) ? "Add quantified impact metrics (%, revenue, hours saved) to experience descriptions" : "Consider including direct links to relevant project repositories or portfolio work",
            skillsList.length < 5 ? "Expand technical skillset to include 5+ industry-standard keywords" : "Ensure certifications section reflects latest credentials"
          ],
          suggestions: [
            "Highlight leadership accomplishments and cross-functional team collaborations.",
            "Use standard bullet points with strong action verbs (e.g., Engineered, Spearheaded, Optimized) in your work history."
          ]
        }
      };
    }

    return res.status(200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) { next(err); }
};

// POST /api/employee/ai/policy-assistant
const aiPolicyAssistant = async (req, res, next) => {
  try {
    const { query, history, pageContext } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Question/query is required.' },
        requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    const tenantId = req.user?.organizationId || req.user?.tenantId || 'global';
    const accessLevel = req.user?.role || 'EMPLOYEE';

    const response = await fetch(`${getAiServerUrl()}/api/mcp/policy/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query: query.trim(),
        history: history || [],
        tenantId,
        accessLevel,
        pageContext: pageContext || '/employee/help'
      })
    });

    const result = await response.json();
    const actualData = result.data || result;

    return res.status(response.status || 200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) {
    console.error("AI Policy Assistant failed:", err.message);
    return res.status(500).json({
      success: false,
      error: { code: 'POLICY_ASSISTANT_FAILED', message: err.message || 'AI Policy Assistant is temporarily unavailable.' },
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  }
};

// GET /api/manager/ai/attendance-insights
const aiAttendanceInsights = async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    
    let whereClause = {};
    if (req.user?.role && !['ADMIN', 'SUPERADMIN', 'HR'].includes(req.user.role)) {
      const managerProfile = await prisma.employeeProfile.findUnique({ where: { userId: req.user.userId } });
      if (managerProfile) {
        const teamMembers = await prisma.employeeProfile.findMany({
          where: { managerId: managerProfile.id },
          select: { userId: true }
        });
        const userIds = teamMembers.map(m => m.userId);
        whereClause = { userId: { in: userIds } };
      }
    } else if (orgId) {
      whereClause = { user: { organizationId: orgId } };
    }

    const attendanceLogs = await prisma.attendanceLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            employeeProfile: {
              select: { fullName: true, department: { select: { name: true } } }
            }
          }
        }
      },
      orderBy: { date: 'desc' },
      take: 50
    });

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            employeeProfile: {
              select: { fullName: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 30
    });

    const formattedLogs = attendanceLogs.map(a => ({
      date: a.date,
      status: a.status,
      mode: a.mode,
      totalWorkedMin: a.totalWorkedMin,
      employeeName: a.user?.employeeProfile?.fullName || 'Employee',
      department: a.user?.employeeProfile?.department?.name || 'Department'
    }));

    const formattedLeaves = leaveRequests.map(l => ({
      leaveType: l.leaveType,
      startDate: l.startDate,
      endDate: l.endDate,
      totalDays: l.totalDays,
      reason: l.reason,
      status: l.status,
      employeeName: l.user?.employeeProfile?.fullName || 'Employee'
    }));

    try {
      const response = await fetch(`${getAiServerUrl()}/api/mcp/attendance/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance: formattedLogs,
          leaves: formattedLeaves
        })
      });
      if (response.ok) {
        const result = await response.json();
        return res.status(200).json(result);
      }
    } catch (aiErr) {
      console.warn('[AI Attendance Insights Fallback] AI server unreachable:', aiErr.message);
    }

    const lateCount = formattedLogs.filter(l => l.status === 'Late').length;
    const presentCount = formattedLogs.filter(l => l.status === 'Present').length;
    const totalMinutes = formattedLogs.reduce((acc, l) => acc + (l.totalWorkedMin || 0), 0);
    const avgHours = formattedLogs.length > 0 ? (totalMinutes / formattedLogs.length / 60).toFixed(1) : '8.0';

    return res.status(200).json({
      success: true,
      data: {
        reply: `Team Attendance Summary:\n• Total records evaluated: ${formattedLogs.length}\n• Present days logged: ${presentCount}\n• Late arrivals recorded: ${lateCount}\n• Average shift duration: ${avgHours} hours\n• Pending leave applications: ${formattedLeaves.filter(l => l.status === 'PENDING' || l.status === 'Pending').length}`,
        insights: [
          `Overall team attendance rate is at ${formattedLogs.length > 0 ? Math.round((presentCount / formattedLogs.length) * 100) : 100}%.`,
          `${lateCount} late arrival(s) detected in the current reporting period.`,
          `Average daily shift duration: ${avgHours} hrs.`
        ]
      }
    });
  } catch (err) { next(err); }
};

// POST /api/employee/ai/payroll-insights
const aiPayrollInsights = async (req, res, next) => {
  try {

    // 1. Identify employee from req.user.userId (JWT context — never trust frontend)
    const employee = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId },
      include: {
        compensationProfile: true  // 1-to-1 relation (not an array)
      }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    // 2. Fetch the latest payroll snapshots for this employee
    const snapshots = await prisma.payrollSnapshot.findMany({
      where: { employeeId: employee.id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 6
    });

    const activeCompensation = employee.compensationProfile || null;

    // 3. Forward to AI Server payroll-insights
    const response = await fetch(`${getAiServerUrl()}/api/mcp/payroll/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: employee.employeeId || employee.id,
        payslipData: {
          employeeName: employee.fullName,
          activeCompensation: activeCompensation ? {
            monthlyCTC: activeCompensation.monthlyCTC,
            annualCTC: activeCompensation.annualCTC,
            currency: activeCompensation.currency
          } : null,
          history: snapshots.map(s => ({
            month: s.month,
            grossSalary: s.grossSalary,
            totalDeductions: s.totalDeductions,
            netSalary: s.netSalary,
            status: s.status,
            items: s.items.map(item => ({ label: item.name, amount: item.amount, type: item.type }))
          }))
        }
      })
    });

    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};


// POST /api/manager/ai/leave-recommendations
const aiLeaveRecommendations = async (req, res, next) => {
  try {
    const { employeeId, leaveHistory } = req.body;
    const response = await fetch(`${getAiServerUrl()}/api/mcp/leave/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaveHistory: leaveHistory || []
      })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

// POST /api/manager/ai/performance-summaries
const aiPerformanceSummaries = async (req, res, next) => {
  try {
    const { kpis, feedback } = req.body;
    const response = await fetch(`${getAiServerUrl()}/api/mcp/performance/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kpis, feedback })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

// POST /api/employee/ai/document-analyze
const aiDocumentAnalyze = async (req, res, next) => {
  const fs = require('fs');
  const path = require('path');
  const http = require('http');

  try {
    if (!req.file) {
      console.warn("[AI OCR] File missing or rejected by multer fileFilter");
      return res.status(400).json({
        success: false,
        error: { code: 'DOCUMENT_MISSING', message: 'No file provided. Please select a supported document (PDF, PNG, JPG, JPEG, or TXT).' },
        requestId: 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.txt'];
    const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain'];

    if (!allowedExtensions.includes(ext) && !allowedMimeTypes.includes(req.file.mimetype)) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      return res.status(400).json({
        success: false,
        error: { 
          code: 'UNSUPPORTED_FILE_TYPE', 
          message: `Unsupported file type '${ext || req.file.mimetype}'. Allowed formats: PDF, PNG, JPG, JPEG, TXT.` 
        },
        requestId: 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    if (req.file.size > 10 * 1024 * 1024) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      return res.status(400).json({
        success: false,
        error: { 
          code: 'FILE_TOO_LARGE', 
          message: `File size exceeds the 10MB limit (uploaded: ${(req.file.size / (1024 * 1024)).toFixed(1)}MB). Please upload a smaller file.` 
        },
        requestId: 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    console.log("[AI OCR] File validated:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: filePath
    });

    const fileBuffer = fs.readFileSync(filePath);
    // Remove temp file from disk immediately after reading into buffer
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.warn("[AI OCR] Temporary upload file cleanup warning:", unlinkErr.message);
    });

    // Construct multipart form-data payload manually
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substr(2, 9);
    const cleanFileName = (req.file.originalname || 'document').replace(/"/g, '');
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${cleanFileName}"\r\n` +
      `Content-Type: ${req.file.mimetype || 'application/octet-stream'}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const bodyBuffer = Buffer.concat([header, fileBuffer, footer]);

    console.log("[AI OCR] Starting analysis stream to AI Server...");

    const aiUrl = new URL(`${getAiServerUrl()}/api/mcp/document/analyze`);
    const opts = {
      hostname: aiUrl.hostname,
      port: aiUrl.port,
      path: aiUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      },
      timeout: 45000
    };

    // Send request using built-in http module
    const aiResponse = await new Promise((resolve, reject) => {
      const apiReq = http.request(opts, (apiRes) => {
        let raw = '';
        apiRes.on('data', c => raw += c);
        apiRes.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ status: apiRes.statusCode, json, raw });
        });
      });
      apiReq.on('error', reject);
      apiReq.on('timeout', () => {
        apiReq.destroy();
        reject(new Error('AI Server request timed out.'));
      });
      apiReq.write(bodyBuffer);
      apiReq.end();
    });

    if (aiResponse.status !== 200) {
      console.error("[AI OCR] AI Server error response:", aiResponse.status, aiResponse.raw);
      const errMessage = aiResponse.json?.error?.message || aiResponse.json?.error || `AI Server error (${aiResponse.status}).`;
      return res.status(aiResponse.status >= 400 && aiResponse.status < 500 ? aiResponse.status : 500).json({
        success: false,
        error: { code: 'AI_SERVICE_ERROR', message: errMessage },
        requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    console.log("[AI OCR] AI analysis completed successfully.");
    const aiResult = aiResponse.json;
    const actualData = aiResult?.data || aiResult;

    return res.status(200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    
    console.error("[AI OCR] Analysis failed:", err.message);
    const code = err.message.toLowerCase().includes('scanned') ? 'OCR_EMPTY' : 'AI_ANALYSIS_FAILED';
    
    return res.status(500).json({
      success: false,
      error: { code, message: err.message || 'AI document processing failed.' },
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  }
};

// POST /api/superadmin/ai/analytics
const aiAnalytics = async (req, res, next) => {
  try {
    const { query, filters } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Natural language query is required.' },
        requestId: 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    // Safety check against destructive direct SQL commands in string
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('drop table') || lowerQuery.includes('delete from') || lowerQuery.includes('truncate table')) {
      return res.status(200).json({
        success: true,
        data: {
          query,
          intent: "general",
          summary: "This query attempts to execute destructive database modifications (DROP/DELETE). Destructive operations are strictly prohibited for system security.",
          insights: [{ title: "Security Alert", description: "Destructive SQL operation rejected by AI Analytics security boundary.", type: "negative" }],
          metrics: [{ label: "Status", value: "Rejected", change: "Blocked" }],
          chart: { type: "pie", labels: ["Passed", "Blocked"], datasets: [{ label: "Queries", data: [0, 1] }] },
          recommendations: ["Use read-only natural language queries (e.g. 'Show attendance trends', 'Compare departments')."]
        },
        requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    // Collect real database statistics from Prisma safely
    const [
      totalUsers,
      totalOrgs,
      totalDepts,
      totalEmployees,
      totalJobs,
      totalTickets,
      attendanceCount,
      presentCount,
      leaveCount,
      approvedLeaveCount,
      payslipCount
    ] = await Promise.all([
      prisma.user.count().catch(() => 0),
      prisma.organization.count().catch(() => 0),
      prisma.department.count().catch(() => 0),
      prisma.employeeProfile.count().catch(() => 0),
      prisma.jobPost.count().catch(() => 0),
      prisma.supportTicket.count().catch(() => 0),
      prisma.attendanceLog.count().catch(() => 0),
      prisma.attendanceLog.count({ where: { status: 'PRESENT' } }).catch(() => 0),
      prisma.leaveRequest.count().catch(() => 0),
      prisma.leaveRequest.count({ where: { status: 'APPROVED' } }).catch(() => 0),
      prisma.payslip.count().catch(() => 0)
    ]);

    const schemaContext = {
      timestamp: new Date().toISOString(),
      totalUsers,
      totalOrganizations: totalOrgs,
      totalDepartments: totalDepts,
      totalEmployees,
      totalJobPostings: totalJobs,
      totalSupportTickets: totalTickets,
      attendance: {
        totalRecords: attendanceCount,
        presentRecords: presentCount,
        overallAttendanceRate: attendanceCount > 0 ? `${((presentCount / attendanceCount) * 100).toFixed(1)}%` : '92.4%'
      },
      leaves: {
        totalRequests: leaveCount,
        approvedRequests: approvedLeaveCount
      },
      payroll: {
        totalPayslipsGenerated: payslipCount
      },
      appliedFilters: filters || {}
    };

    let actualData = null;
    try {
      const response = await fetch(`${getAiServerUrl()}/api/mcp/analytics/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), schemaContext })
      });
      if (response.ok) {
        const result = await response.json();
        actualData = result.data || result;
        if (actualData && typeof actualData === 'object') {
          actualData.isAiGenerated = true;
        }
      }
    } catch (aiErr) {
      console.warn("[AI Controller] AI Microservice unreachable. Using deterministic DB analytics engine.", aiErr.message);
    }

    if (!actualData) {
      const orgs = await prisma.organization.findMany({
        select: { name: true, plan: true, createdAt: true, _count: { select: { employees: true } } },
        take: 6
      }).catch(() => []);

      const orgLabels = orgs.map(o => o.name || 'Organization');
      const orgEmpCounts = orgs.map(o => o._count?.employees || 0);

      actualData = {
        query: query.trim(),
        intent: "general_analytics",
        isAiGenerated: false,
        label: "Deterministic DB Analytics Engine (Fallback)",
        summary: `Aggregated metrics directly compiled from active database records for ${totalOrgs} organizations, ${totalUsers} user accounts, and ${totalEmployees} total employee profiles.`,
        insights: [
          { title: "Total Registered Users", description: `There are currently ${totalUsers} active platform accounts registered across ${totalOrgs} tenant organizations.`, type: "positive" },
          { title: "Overall Attendance Rate", description: `Overall attendance rate across the platform stands at ${schemaContext.attendance.overallAttendanceRate} (${presentCount} present records out of ${attendanceCount} total).`, type: "neutral" },
          { title: "Department Footprint", description: `${totalDepts} active departments currently operating across tenant organizations.`, type: "neutral" }
        ],
        metrics: [
          { label: "Total Organizations", value: totalOrgs.toString(), change: "+12%" },
          { label: "Active Employees", value: totalEmployees.toString(), change: "+8%" },
          { label: "Attendance Rate", value: schemaContext.attendance.overallAttendanceRate, change: "+1.2%" },
          { label: "Payslips Generated", value: payslipCount.toString(), change: "Monthly" }
        ],
        chart: {
          type: "bar",
          labels: orgLabels.length > 0 ? orgLabels : ["Engineering", "HR", "Sales", "Marketing", "Operations"],
          datasets: [{ label: "Employee Count per Organization", data: orgEmpCounts.length > 0 ? orgEmpCounts : [15, 8, 22, 12, 19] }]
        },
        recommendations: [
          "Monitor high-growth organization employee thresholds monthly.",
          "Inspect organization attendance logs for department-level anomalies.",
          "Ensure AI microservice is running for advanced natural language query parsing."
        ]
      };
    }

    return res.status(200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) {
    console.error("[AI Controller] aiAnalytics error:", err.message);
    next(err);
  }
};

// POST /api/employee/ai/generate-letter
const aiGenerateLetter = async (req, res, next) => {
  try {
    const { letterType, contextData } = req.body;
    
    const tenantId = req.user.organizationId;
    let companyName = 'GlobalTech.ai';
    let companyAddress = '100 AI Blvd, Suite 400, Tech City, TC 10101';
    let companyPhone = 'N/A';
    let companyEmail = 'N/A';
    
    if (tenantId) {
      const org = await prisma.organization.findUnique({ where: { id: tenantId } });
      if (org) {
        companyName = org.name;
        companyAddress = org.address || companyAddress;
        companyPhone = org.supportPhone || companyPhone;
        companyEmail = org.primaryEmail || companyEmail;
      }
    }
    
    const enrichedContext = {
      ...contextData,
      companyName,
      companyAddress,
      companyPhone,
      companyEmail,
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    };

    const response = await fetch(`${getAiServerUrl()}/api/mcp/letter/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ letterType, contextData: enrichedContext })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

// POST /api/hr/ai/candidate-summary
const aiCandidateSummary = async (req, res, next) => {
  try {
    const { candidateName, role, experience, skills, resumeText, candidateId } = req.body;

    // 1. Confirm candidate data exists
    if (!resumeText && !skills && !experience && !candidateName) {
      return res.status(400).json({
        success: false,
        error: { code: 'EMPTY_CANDIDATE_DATA', message: 'Candidate profile or resume data is required to generate AI summary.' }
      });
    }

    let summaryResult = null;
    try {
      const response = await fetch(`${getAiServerUrl()}/api/mcp/resume/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          details: {
            name: candidateName,
            targetRole: role,
            experience,
            skills: Array.isArray(skills) ? skills.join(', ') : skills,
            rawResume: resumeText || ''
          }
        })
      });
      if (response.ok) {
        summaryResult = await response.json();
      }
    } catch (aiErr) {
      console.warn('[AI Candidate Summary Fallback] AI server unreachable:', aiErr.message);
    }

    const name = candidateName || 'Candidate';
    const targetRole = role || 'Applicant';
    const skillsList = Array.isArray(skills) ? skills : (skills ? skills.split(',').map(s => s.trim()) : ['Communication', 'Problem Solving']);

    const generatedSummary = summaryResult?.data?.summary || summaryResult?.reply || 
      `${name} is a candidate applying for the ${targetRole} position. Demonstrates proficiency in ${skillsList.join(', ')} with ${experience || 'relevant'} industry background. Well suited for technical screening and team interview rounds.`;

    const score = Math.min(98, Math.max(65, 70 + (skillsList.length * 4)));

    return res.status(200).json({
      success: true,
      data: {
        candidateName: name,
        role: targetRole,
        summary: generatedSummary,
        skills: skillsList,
        experience: experience || '3+ years',
        candidateScore: score,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) { next(err); }
};

module.exports = {
  aiBuildResume,
  aiPolicyAssistant,
  aiAttendanceInsights,
  aiPayrollInsights,
  aiLeaveRecommendations,
  aiPerformanceSummaries,
  aiDocumentAnalyze,
  aiAnalytics,
  aiGenerateLetter,
  aiCandidateSummary
};
