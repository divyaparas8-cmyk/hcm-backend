const prisma = require('../config/prisma');

// GET /api/admin/reports — list generated reports for this org
const getGeneratedReports = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) return res.status(400).json({ success: false, message: 'No organization context.' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, reports] = await Promise.all([
      prisma.generatedReport.count({ where: { organizationId } }),
      prisma.generatedReport.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          createdByUser: {
            select: { id: true, email: true, employeeProfile: { select: { fullName: true } } }
          }
        }
      })
    ]);

    const mapped = reports.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      modules: (() => { try { return JSON.parse(r.modules || '[]'); } catch { return []; } })(),
      format: r.format,
      department: r.department,
      period: r.period,
      status: r.status,
      size: r.fileSize,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      creator: r.createdByUser
        ? (r.createdByUser.employeeProfile?.fullName || r.createdByUser.email)
        : 'System'
    }));

    return res.status(200).json({ success: true, data: mapped, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
};

// POST /api/admin/reports — create/save a generated report
const createGeneratedReport = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) return res.status(400).json({ success: false, message: 'No organization context.' });

    const { title, category, modules = [], format, department, period, status = 'Generated', fileSize, size, reportConfig } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Report title is required.' });

    const approxBytes = fileSize || size || `${120 + (Array.isArray(modules) ? modules.length : 0) * 28 + Math.floor(Math.random() * 15)} KB`;

    const report = await prisma.generatedReport.create({
      data: {
        organizationId,
        createdByUserId: req.user?.id || null,
        title: title.trim(),
        category: category || null,
        modules: JSON.stringify(Array.isArray(modules) ? modules : []),
        format: format || 'Full Analytics',
        department: department || 'All Departments',
        period: period || 'All-Time',
        status,
        fileSize: approxBytes,
        reportConfig: reportConfig ? JSON.stringify(reportConfig) : null
      },
      include: { createdByUser: { select: { id: true, email: true, employeeProfile: { select: { fullName: true } } } } }
    });

    return res.status(201).json({
      success: true,
      data: {
        id: report.id, title: report.title, category: report.category,
        modules: (() => { try { return JSON.parse(report.modules || '[]'); } catch { return []; } })(),
        format: report.format, department: report.department, period: report.period,
        status: report.status, size: report.fileSize, createdAt: report.createdAt,
        creator: report.createdByUser ? (report.createdByUser.employeeProfile?.fullName || report.createdByUser.email) : 'System'
      }
    });
  } catch (err) { next(err); }
};

// DELETE /api/admin/reports/:id
const deleteGeneratedReport = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const { id } = req.params;
    const report = await prisma.generatedReport.findFirst({ where: { id, organizationId } });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
    await prisma.generatedReport.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Report deleted.' });
  } catch (err) { next(err); }
};

// GET /api/admin/reports/data — fetch real org data for PDF generation
const getReportData = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) return res.status(400).json({ success: false, message: 'No organization context.' });

    const modules = req.query.modules ? req.query.modules.split(',').map(m => m.trim()) : [];
    const all = modules.length === 0;
    const has = (k) => all || modules.some(m => m.toLowerCase().includes(k));

    const [users, departments, payrollSnapshots, payslips, benefitPlans, leaveRequests, attendanceLogs, policies, auditLogs] = await Promise.all([
      has('workforce') || has('employee') || has('user')
        ? prisma.user.findMany({
            where: { organizationId },
            select: {
              id: true, email: true, role: true, status: true, isActive: true, createdAt: true,
              employeeProfile: { select: { fullName: true, employeeId: true, jobTitle: true, employmentType: true, lifecycleStatus: true, department: { select: { name: true } } } }
            }
          })
        : Promise.resolve([]),

      prisma.department.findMany({ where: { organizationId }, include: { employees: { select: { id: true, fullName: true } } } }),

      has('financial') || has('payroll')
        ? prisma.payrollSnapshot.findMany({
            where: { employee: { organizationId } },
            select: { id: true, month: true, grossSalary: true, netSalary: true, totalDeductions: true, status: true, paymentDate: true, employee: { select: { fullName: true, employeeId: true, department: { select: { name: true } } } } },
            orderBy: { month: 'desc' }, take: 500
          })
        : Promise.resolve([]),

      has('financial') || has('payroll')
        ? prisma.payslip.findMany({
            where: { employee: { organizationId } },
            select: { id: true, month: true, salary: true, status: true, employee: { select: { fullName: true, employeeId: true } } },
            take: 500
          })
        : Promise.resolve([]),

      has('benefit')
        ? prisma.benefitPlan.findMany({ where: { organizationId }, select: { id: true, name: true, type: true, status: true, employerContribution: true } })
        : Promise.resolve([]),

      has('leave') || has('attendance')
        ? prisma.leaveRequest.findMany({ where: { employee: { organizationId } }, select: { id: true, type: true, status: true, startDate: true, endDate: true, reason: true, employee: { select: { fullName: true, department: { select: { name: true } } } } }, take: 500 })
        : Promise.resolve([]),

      has('leave') || has('attendance')
        ? prisma.attendanceLog.findMany({ where: { employee: { organizationId } }, select: { id: true, date: true, checkIn: true, checkOut: true, status: true, employee: { select: { fullName: true } } }, take: 500 })
        : Promise.resolve([]),

      has('compliance') || has('policy')
        ? prisma.policy.findMany({ where: { organizationId }, select: { id: true, title: true, category: true, status: true, effectiveDate: true } })
        : Promise.resolve([]),

      has('audit') || has('system')
        ? prisma.auditLog.findMany({
            where: { OR: [{ organizationId }, { user: { organizationId } }] },
            select: { id: true, action: true, resource: true, level: true, createdAt: true, user: { select: { email: true, role: true } } },
            orderBy: { createdAt: 'desc' }, take: 200
          })
        : Promise.resolve([])
    ]);

    return res.status(200).json({ success: true, data: { users, departments, payrollSnapshots, payslips, benefitPlans, leaveRequests, attendanceLogs, policies, auditLogs } });
  } catch (err) { next(err); }
};

module.exports = { getGeneratedReports, createGeneratedReport, deleteGeneratedReport, getReportData };
