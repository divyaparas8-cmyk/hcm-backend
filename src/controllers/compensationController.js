const prisma = require('../config/prisma');
const { isWorkflowEnabled, startWorkflow, processApproval } = require('../services/approval.service');
const { generatePayrollSnapshot } = require('../services/payrollEngineService');

// ==========================================
// Compensation Profiles
// ==========================================
exports.getCompensationProfile = async (req, res) => {
  try {
    let { employeeId } = req.params;
    if (!employeeId && req.user?.userId) {
      const emp = await prisma.employeeProfile.findUnique({ where: { userId: req.user.userId } });
      employeeId = emp?.id;
    }
    if (!employeeId) return res.json(null);

    let profile = await prisma.compensationProfile.findUnique({
      where: { employeeId },
      include: { salaryBand: true, salaryStructure: true, employee: true }
    });

    if (!profile) {
      const emp = await prisma.employeeProfile.findUnique({ where: { userId: employeeId } });
      if (emp) {
        profile = await prisma.compensationProfile.findUnique({
          where: { employeeId: emp.id },
          include: { salaryBand: true, salaryStructure: true, employee: true }
        });
      }
    }

    if (!profile) return res.json(null);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateCompensationProfile = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { baseSalary, monthlyCTC, annualCTC, salaryBandId, salaryStructureId, salaryVersionId, effectiveDate, reason } = req.body;

    // Get existing to create version
    const existing = await prisma.compensationProfile.findUnique({ where: { employeeId } });

    if (existing) {
      const prevSal = existing.monthlyCTC || existing.baseSalary || 0;
      const newSal = monthlyCTC || baseSalary || 0;
      
      await prisma.compensationVersion.create({
        data: {
          employee: { connect: { id: employeeId } },
          previousSalary: prevSal,
          newSalary: newSal,
          difference: newSal - prevSal,
          reason: reason || "Standard Update",
          effectiveDate: new Date(effectiveDate || Date.now()),
          version: existing.version || 1
        }
      });
    }

    const cleanStructureId = salaryStructureId === '' ? null : salaryStructureId;
    const cleanVersionId = salaryVersionId === '' ? null : salaryVersionId;
    const cleanBandId = salaryBandId === '' ? null : salaryBandId;

    const calculatedAnnualCTC = monthlyCTC ? (Number(monthlyCTC) * 12) : 0;

    const updated = await prisma.compensationProfile.upsert({
      where: { employeeId },
      update: {
        baseSalary,
        monthlyCTC,
        annualCTC: calculatedAnnualCTC,
        salaryBandId: cleanBandId,
        salaryStructureId: cleanStructureId,
        salaryVersionId: cleanVersionId,
        effectiveDate: new Date(effectiveDate || Date.now()),
        version: existing ? existing.version + 1 : 1
      },
      create: {
        employeeId,
        baseSalary,
        monthlyCTC,
        annualCTC: calculatedAnnualCTC,
        salaryBandId: cleanBandId,
        salaryStructureId: cleanStructureId,
        salaryVersionId: cleanVersionId,
        effectiveDate: new Date(effectiveDate || Date.now())
      }
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ==========================================
// Salary Increment Requests
// ==========================================
exports.requestIncrement = async (req, res) => {
  try {
    const { requestedSalary, reason, effectiveDate } = req.body;
    const employeeId = req.user.employeeProfileId; // Assuming middleware sets this
    if (!employeeId) return res.status(400).json({ message: "Employee profile not found for user." });

    const request = await prisma.salaryIncrementRequest.create({
      data: {
        employeeId,
        requestedSalary,
        reason,
        effectiveDate: new Date(effectiveDate)
      }
    });

    // Try to initiate workflow
    try {
      const workflowActive = await isWorkflowEnabled('SalaryIncrementRequest', req.user.organizationId);
      if (workflowActive) {
        const log = await startWorkflow('SalaryIncrementRequest', request.id, req.user.organizationId, req.user.userId);
        await prisma.salaryIncrementRequest.update({
          where: { id: request.id },
          data: { workflowId: log.workflowId }
        });
      }
    } catch (wfError) {
      console.warn("Workflow not initiated:", wfError.message);
    }

    // ── Notify the employee's manager about the new increment request ──
    try {
      const { createNotification } = require('../utils/notificationHelper');
      const empProfile = await prisma.employeeProfile.findUnique({
        where: { id: employeeId },
        include: { manager: true }
      });
      if (empProfile && empProfile.manager?.userId) {
        await createNotification({
          userId: empProfile.manager.userId,
          title: 'Salary Increment Request',
          message: `${empProfile.fullName} has requested a salary increment of ₹${Number(requestedSalary).toLocaleString()}. Reason: ${reason || 'Not specified'}.`,
          type: 'WARNING',
          link: '/manager/compensation'
        });
      }
    } catch (notifErr) {
      console.error('Failed to send increment request notification:', notifErr);
    }

    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// ==========================================
// Payroll Snapshot Generation (Trigger)
// ==========================================
exports.runPayroll = async (req, res) => {
  try {
    const { employeeId, month, status = 'Paid' } = req.body;
    let empId = employeeId;
    const user = await prisma.user.findUnique({ where: { id: employeeId }, include: { employeeProfile: true } });
    if (user?.employeeProfile) {
      empId = user.employeeProfile.id;
    }
    const targetMonth = month || new Date().toLocaleString('default', { month: 'long' });
    const snapshot = await generatePayrollSnapshot(empId, targetMonth, req.user?.organizationId, status);
    res.status(201).json({ success: true, data: snapshot });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.runPayrollBatch = async (req, res) => {
  try {
    const { employeeIds, month, status = 'Paid' } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: "employeeIds array is required" });
    }
    
    const snapshots = [];
    const errors = [];
    const targetMonth = month || new Date().toLocaleString('default', { month: 'long' });

    for (const rawId of employeeIds) {
      try {
        let empId = rawId;
        const user = await prisma.user.findUnique({ where: { id: rawId }, include: { employeeProfile: true } });
        if (user?.employeeProfile) {
          empId = user.employeeProfile.id;
        }
        const snap = await generatePayrollSnapshot(empId, targetMonth, req.user?.organizationId, status);
        snapshots.push(snap);
      } catch (err) {
        errors.push({ employeeId: rawId, error: err.message });
      }
    }

    res.status(201).json({ success: true, snapshots, errors });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getPayrollSnapshots = async (req, res) => {
  try {
    let whereClause = {};

    if (req.user?.role === 'EMPLOYEE') {
      whereClause = { employee: { userId: req.user.userId } };
    } else if (req.user?.role === 'SUPERADMIN') {
      whereClause = req.query.organizationId ? { employee: { user: { organizationId: req.query.organizationId } } } : {};
    } else if (req.user?.organizationId) {
      whereClause = { employee: { user: { organizationId: req.user.organizationId } } };
    }

    if (req.query.month) whereClause.month = req.query.month;

    const snapshots = await prisma.payrollSnapshot.findMany({
      where: whereClause,
      include: { 
        items: true, 
        employee: { 
          select: { 
            fullName: true, 
            employeeId: true,
            avatarUrl: true,
            user: { select: { id: true, role: true, organizationId: true } }
          } 
        } 
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.finalizePayrollSnapshot = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.payrollSnapshot.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: { message: "Payroll snapshot not found" } });
    }
    if (existing.status !== 'Draft' && existing.status !== 'Pending') {
      return res.status(400).json({ success: false, error: { message: `Snapshot is already ${existing.status} and locked.` } });
    }

    const updated = await prisma.payrollSnapshot.update({
      where: { id },
      data: {
        status: 'Paid',
        paymentDate: new Date()
      }
    });

    try {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: 'PAYROLL_FINALIZED',
          details: `Payroll snapshot for employee ${existing.employeeId} (${existing.month}) finalized. Net Pay: $${existing.netSalary}`,
          ipAddress: req.ip || req.socket.remoteAddress
        }
      });
    } catch (aErr) {}

    return res.status(200).json({ success: true, data: updated, message: 'Payroll finalized and locked successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: { message: error.message } });
  }
};

exports.getHRIncrementRequests = async (req, res) => {
  try {
    const hrProfile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId }
    });

    let assignedIds = [];
    if (hrProfile) {
      const pendingLogs = await prisma.approvalLog.findMany({
        where: { approverId: hrProfile.id, status: 'Pending', entityType: 'SalaryIncrementRequest' },
        select: { entityId: true }
      });
      assignedIds = pendingLogs.map(l => l.entityId);
    }

    const requests = await prisma.salaryIncrementRequest.findMany({
      where: {
        employee: { user: { organizationId: req.user.organizationId } },
        status: { in: ['Pending', 'ManagerApproved', 'Approved', 'Rejected'] }
      },
      include: {
        employee: {
          select: {
            fullName: true,
            employeeId: true,
            avatarUrl: true,
            compensationProfile: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const activeWorkflowLogs = await prisma.approvalLog.findMany({
      where: {
        entityId: { in: requests.map(r => r.id) },
        entityType: 'SalaryIncrementRequest',
        status: 'Pending'
      },
      include: {
        approver: { include: { user: true } }
      }
    });

    const pendingLogMap = {};
    activeWorkflowLogs.forEach(l => {
      pendingLogMap[l.entityId] = l;
    });

    const requestsWithRole = requests.map(req => {
      let pendingRole = null;
      if (req.status === 'Pending' && pendingLogMap[req.id]) {
        pendingRole = pendingLogMap[req.id].approver?.user?.role;
      }
      return {
        ...req,
        pendingApproverRole: pendingRole
      };
    });

    res.status(200).json({ success: true, data: requestsWithRole });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveHRIncrementRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await prisma.salaryIncrementRequest.findFirst({
      where: {
        id,
        employee: {
          user: {
            organizationId: req.user.organizationId
          }
        }
      },
      include: { employee: true }
    });

    if (!request) return res.status(404).json({ message: 'Increment request not found.' });
    if (request.status !== 'ManagerApproved' && request.status !== 'Pending') {
      return res.status(400).json({ message: `Request status is ${request.status}, cannot approve.` });
    }

    const workflowActive = await isWorkflowEnabled('SalaryIncrementRequest', req.user.organizationId);

    let newStatus = 'Approved';

    if (workflowActive) {
      const result = await processApproval('SalaryIncrementRequest', id, req.user.userId, 'APPROVE', 'Approved by HR');
      if (!result.finalized) {
        newStatus = 'ManagerApproved'; // Intermediate
      }
    }

    const updated = await prisma.salaryIncrementRequest.update({
      where: { id },
      data: { status: newStatus }
    });

    if (newStatus === 'Approved' && request.employeeId) {
      await prisma.compensationProfile.update({
        where: { employeeId: request.employeeId },
        data: {
          monthlyCTC: request.requestedSalary,
          annualCTC: request.requestedSalary * 12,
          effectiveDate: request.effectiveDate
        }
      });
    }

    // ── Notify the employee that HR approved their increment ──
    try {
      const { createNotification } = require('../utils/notificationHelper');
      if (request.employee?.userId) {
        await createNotification({
          userId: request.employee.userId,
          title: 'Salary Increment Approved',
          message: `Your salary increment request has been approved by HR. Your new salary of ₹${Number(request.requestedSalary).toLocaleString()} is now effective.`,
          type: 'SUCCESS',
          link: '/employee/compensation'
        });
      }
    } catch (notifErr) {
      console.error('Failed to send HR approval notification:', notifErr);
    }

    res.json({ success: true, data: updated, message: 'Increment request approved and implemented successfully.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.rejectHRIncrementRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await prisma.salaryIncrementRequest.findFirst({
      where: {
        id,
        employee: {
          user: {
            organizationId: req.user.organizationId
          }
        }
      },
      include: { employee: { include: { user: true } } }
    });

    if (!request) return res.status(404).json({ message: 'Increment request not found.' });

    const workflowActive = await isWorkflowEnabled('SalaryIncrementRequest', req.user.organizationId);

    if (workflowActive) {
      await processApproval('SalaryIncrementRequest', id, req.user.userId, 'REJECT', 'Rejected by HR');
    }

    const updated = await prisma.salaryIncrementRequest.update({
      where: { id },
      data: { status: 'Rejected' }
    });

    // ── Notify the employee that HR rejected their increment ──
    try {
      const { createNotification } = require('../utils/notificationHelper');
      if (request.employee?.userId) {
        await createNotification({
          userId: request.employee.userId,
          title: 'Salary Increment Rejected',
          message: `Your salary increment request has been rejected by HR.`,
          type: 'ALERT',
          link: '/employee/compensation'
        });
      }
    } catch (notifErr) {
      console.error('Failed to send HR rejection notification:', notifErr);
    }

    res.json({ success: true, data: updated, message: 'Increment request rejected.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================================
// GET /api/employee/payroll  (unified endpoint)
// ==========================================
exports.getEmployeePayroll = async (req, res) => {
  try {
    // Resolve employeeProfileId
    const emp = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId },
      include: { user: { select: { organizationId: true } } }
    });
    if (!emp) return res.status(404).json({ success: false, error: { message: 'Employee profile not found.' } });

    // Fetch CompensationProfile
    const compensation = await prisma.compensationProfile.findUnique({
      where: { employeeId: emp.id },
      include: { salaryStructure: true, salaryBand: true, salaryVersion: true }
    });

    // Fetch PayrollSnapshots (most recent first)
    const snapshots = await prisma.payrollSnapshot.findMany({
      where: { employeeId: emp.id },
      include: {
        items: true,
        salaryStructureVersion: { include: { structure: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Format payslips for frontend
    const payslips = snapshots.map(s => ({
      id: s.id,
      month: s.month,
      grossSalary: s.grossSalary,
      totalDeductions: s.totalDeductions,
      netSalary: s.netSalary,
      status: s.status,
      paymentDate: s.paymentDate,
      totalWorkingDays: s.totalWorkingDays,
      presentDays: s.presentDays,
      paidLeaveDays: s.paidLeaveDays,
      unpaidLeaveDays: s.unpaidLeaveDays,
      items: s.items,
      employeeName: emp.fullName,
      employeeCode: emp.employeeId,
      designation: emp.designation,
    }));

    // Resolve salary structure name
    let salaryStructureName = 'Not assigned';
    if (compensation?.salaryStructure?.name) {
      salaryStructureName = compensation.salaryStructure.name;
    } else if (compensation?.salaryBand?.name) {
      salaryStructureName = `Band: ${compensation.salaryBand.name}`;
    }

    return res.json({
      success: true,
      data: {
        salaryStructure: salaryStructureName,
        monthlyCTC: compensation?.monthlyCTC || 0,
        annualCTC: compensation?.annualCTC || 0,
        currency: compensation?.currency || 'USD',
        salaryBand: compensation?.salaryBand?.name || null,
        status: compensation?.status || null,
        payslips
      }
    });
  } catch (error) {
    console.error('getEmployeePayroll error:', error);
    return res.status(500).json({ success: false, error: { message: error.message } });
  }
};

// ==========================================
// GET /api/employee/payslip/:id/download
// ==========================================
exports.downloadPayslip = async (req, res) => {
  try {
    const { id } = req.params;

    // Find snapshot and verify ownership
    const emp = await prisma.employeeProfile.findUnique({ where: { userId: req.user.userId } });
    if (!emp) return res.status(403).json({ success: false, error: { message: 'Access denied.' } });

    const snapshot = await prisma.payrollSnapshot.findFirst({
      where: { id, employeeId: emp.id },
      include: { items: true }
    });
    if (!snapshot) return res.status(404).json({ success: false, error: { message: 'Payslip not found.' } });

    // Get org name for header
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { organization: { select: { name: true } } } });
    const orgName = user?.organization?.name || 'GlobalTech Solutions';

    // Generate PDF with pdfkit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    const filename = `Payslip_${snapshot.month.replace(/[^a-zA-Z0-9_-]/g, '_')}_${emp.employeeId || emp.id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // ── Header ──
    doc.fontSize(18).font('Helvetica-Bold').text(orgName, 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8').text('Enterprise Employee Paystub', 50, 72);
    doc.fontSize(9).fillColor('#94a3b8')
      .text(`PAYSLIP ID: ${snapshot.id.slice(0, 8).toUpperCase()}`, 400, 50, { align: 'right' })
      .text(`Month: ${snapshot.month}`, 400, 63, { align: 'right' });

    doc.moveTo(50, 90).lineTo(545, 90).strokeColor('#e2e8f0').stroke();

    // ── Employee Details & Attendance ──
    doc.moveDown(2);
    const y1 = 105;
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#94a3b8').text('EMPLOYEE DETAILS', 50, y1);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(emp.fullName || 'Employee', 50, y1 + 12);
    doc.fontSize(8).font('Helvetica').fillColor('#64748b')
      .text(`Employee ID: ${emp.employeeId || 'N/A'}`, 50, y1 + 26)
      .text(`Designation: ${emp.designation || 'N/A'}`, 50, y1 + 38);

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#94a3b8').text('ATTENDANCE SUMMARY', 300, y1, { align: 'left' });
    doc.fontSize(8).font('Helvetica').fillColor('#64748b')
      .text(`Working Days: ${snapshot.totalWorkingDays ?? 0}`, 300, y1 + 12)
      .text(`Days Present: ${snapshot.presentDays ?? 0}`, 300, y1 + 24)
      .text(`Paid Leaves: ${snapshot.paidLeaveDays ?? 0}`, 300, y1 + 36)
      .text(`LOP Days: ${snapshot.unpaidLeaveDays ?? 0}`, 300, y1 + 48);

    doc.moveTo(50, y1 + 62).lineTo(545, y1 + 62).strokeColor('#e2e8f0').stroke();

    // ── Earnings & Deductions ──
    const earnings = (snapshot.items || []).filter(i => ['Earning', 'Allowance', 'Variable Pay'].includes(i.type));
    const deductions = (snapshot.items || []).filter(i => i.type === 'Deduction');

    let yE = y1 + 75;
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#10b981').text('EARNINGS', 50, yE);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#ef4444').text('DEDUCTIONS', 300, yE);
    yE += 14;

    const maxRows = Math.max(earnings.length || 1, deductions.length || 1);
    for (let i = 0; i < maxRows; i++) {
      const e = earnings[i];
      const d = deductions[i];
      const rowBg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
      doc.rect(50, yE - 2, 495, 16).fill(rowBg).fillColor('#1e293b');
      if (e) {
        doc.fontSize(8).font('Helvetica').fillColor('#374151').text(e.name, 55, yE).text(`${Number(e.amount).toLocaleString('en', { style: 'currency', currency: snapshot.currency || 'USD' })}`, 200, yE, { align: 'right', width: 70 });
      }
      if (d) {
        doc.fontSize(8).font('Helvetica').fillColor('#374151').text(d.name, 305, yE).text(`-${Number(d.amount).toLocaleString('en', { style: 'currency', currency: snapshot.currency || 'USD' })}`, 450, yE, { align: 'right', width: 95 });
      }
      yE += 16;
    }

    // Totals row
    yE += 4;
    doc.moveTo(50, yE).lineTo(545, yE).strokeColor('#e2e8f0').stroke();
    yE += 8;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
      .text('Gross Earnings', 55, yE)
      .text(`${Number(snapshot.grossSalary).toLocaleString('en', { style: 'currency', currency: 'USD' })}`, 200, yE, { align: 'right', width: 70 });
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
      .text('Total Withheld', 305, yE)
      .text(`-${Number(snapshot.totalDeductions).toLocaleString('en', { style: 'currency', currency: 'USD' })}`, 450, yE, { align: 'right', width: 95 });

    // ── Net Pay Box ──
    yE += 30;
    doc.rect(50, yE, 495, 55).fill('#f0fdf4').fillColor('#1e293b');
    doc.moveTo(50, yE).lineTo(545, yE).strokeColor('#86efac').lineWidth(1).stroke();
    doc.moveTo(50, yE + 55).lineTo(545, yE + 55).strokeColor('#86efac').lineWidth(1).stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#16a34a').text('NET SALARY PAYABLE', 65, yE + 10);
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#15803d')
      .text(`${Number(snapshot.netSalary).toLocaleString('en', { style: 'currency', currency: 'USD' })}`, 65, yE + 22);
    const statusColor = ['Paid', 'Processed'].includes(snapshot.status) ? '#16a34a' : '#d97706';
    const statusBg = ['Paid', 'Processed'].includes(snapshot.status) ? '#dcfce7' : '#fef3c7';
    doc.rect(420, yE + 15, 70, 20).fill(statusBg);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(statusColor).text(snapshot.status.toUpperCase(), 420, yE + 21, { width: 70, align: 'center' });

    // ── Footer ──
    doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
      .text('This is a computer-generated document and does not require a physical signature.', 50, 760, { align: 'center', width: 495 })
      .text(`${orgName} Payroll Processing Service Platform. Confidential. © ${new Date().getFullYear()}`, 50, 771, { align: 'center', width: 495 });

    doc.end();
  } catch (error) {
    console.error('downloadPayslip error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: { message: error.message } });
    }
  }
};
