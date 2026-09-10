const prisma = require('../config/prisma');

// ============================================================
// GET /api/reimbursements/approvals
// Returns ALL claims for this organization with correct scoping.
// Admins/SuperAdmins see all org claims; query params allow tab-filtering.
// ============================================================
const getFinalApprovals = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    const { status: tabStatus, search } = req.query;

    // Build where clause
    let whereClause = {};

    // Organization scoping — only see claims from employees in this org
    if (organizationId) {
      whereClause.employee = {
        user: { organizationId }
      };
    }

    // Tab filter
    if (tabStatus === 'pending_approval') {
      whereClause.finalApprovalStatus = 'Pending';
    } else if (tabStatus === 'pending_payment') {
      whereClause.finalApprovalStatus = 'Approved';
      whereClause.paymentStatus = 'Pending';
    } else if (tabStatus === 'completed') {
      whereClause.OR = [
        { paymentStatus: 'Processed' },
        { finalApprovalStatus: 'Rejected' }
      ];
    }
    // tabStatus === 'all' or undefined → no additional filter

    const claims = await prisma.benefitClaim.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            avatarUrl: true,
            department: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } }
          }
        }
      },
      orderBy: { claimedAt: 'desc' }
    });

    // Apply search filter in-memory (across title, employee name, employeeId)
    let filteredClaims = claims;
    if (search && search.trim()) {
      const term = search.toLowerCase().trim();
      filteredClaims = claims.filter(c =>
        c.title?.toLowerCase().includes(term) ||
        c.employee?.fullName?.toLowerCase().includes(term) ||
        c.employee?.employeeId?.toLowerCase().includes(term) ||
        c.id?.toLowerCase().includes(term) ||
        c.provider?.toLowerCase().includes(term)
      );
    }

    // Compute summary counts from ALL org claims (not filtered)
    const pendingApprovals = claims.filter(c => c.finalApprovalStatus === 'Pending').length;
    const pendingPayment = claims.filter(c => c.finalApprovalStatus === 'Approved' && c.paymentStatus === 'Pending').length;
    const completed = claims.filter(c => c.paymentStatus === 'Processed' || c.finalApprovalStatus === 'Rejected').length;
    const total = claims.length;

    return res.status(200).json({
      success: true,
      data: filteredClaims,
      stats: { pendingApprovals, pendingPayment, completed, total }
    });
  } catch (err) { next(err); }
};

// ============================================================
// PATCH /api/reimbursements/:id/approve
// Final approve or reject a claim. Only valid from ADMIN/SUPERADMIN.
// ============================================================
const reviewFinalApproval = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;
    const organizationId = req.user?.organizationId;

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid status. Must be Approved or Rejected.' } });
    }

    const claim = await prisma.benefitClaim.findUnique({
      where: { id },
      include: {
        employee: {
          include: {
            user: { select: { id: true, organizationId: true } }
          }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ success: false, error: { message: 'Claim not found.' } });
    }

    // Organization check — ensure claim belongs to this org
    if (organizationId && claim.employee?.user?.organizationId !== organizationId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied: This claim does not belong to your organization.' } });
    }

    // Prevent re-processing already finalized claims
    if (claim.finalApprovalStatus !== 'Pending') {
      return res.status(409).json({
        success: false,
        error: { message: `Claim has already been ${claim.finalApprovalStatus.toLowerCase()}. Cannot change status again.` }
      });
    }

    const approverProfile = await prisma.employeeProfile.findFirst({ where: { userId: req.user.userId } });
    const approverName = approverProfile?.fullName || req.user.role;

    const overallStatus = status === 'Approved' ? 'Approved' : 'Rejected by Final Approver';

    let history = [];
    if (claim.approvalHistory) {
      try { history = JSON.parse(claim.approvalHistory); } catch (e) {}
    }
    history.push({
      action: status === 'Approved' ? 'Final Approved' : 'Final Rejected',
      actor: approverName,
      role: req.user.role,
      date: new Date().toISOString(),
      comment: comment || ''
    });

    const updatedClaim = await prisma.benefitClaim.update({
      where: { id },
      data: {
        finalApprovalStatus: status,
        finalApproverId: req.user.userId,
        finalApproverRole: req.user.role,
        finalApprovalComment: comment || null,
        finalApprovedAt: new Date(),
        overallStatus,
        approvalHistory: JSON.stringify(history)
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            avatarUrl: true,
            department: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } }
          }
        }
      }
    });

    // Notify employee
    try {
      await prisma.notification.create({
        data: {
          userId: claim.employee.userId,
          type: status === 'Approved' ? 'SUCCESS' : 'WARNING',
          title: 'Reimbursement Claim Update',
          message: `Your reimbursement claim "${claim.title}" has been ${status.toLowerCase()} by the admin.${comment ? ` Note: "${comment}"` : ''}`,
          isRead: false
        }
      });
    } catch (notifErr) {
      console.warn('Notification create failed:', notifErr.message);
    }

    // Audit log
    const adminUserId = req.user?.id || req.user?.userId;
    if (adminUserId) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: adminUserId,
            organizationId: organizationId || null,
            action: `REIMBURSEMENT_${status.toUpperCase()}_BY_ADMIN`,
            details: `Admin ${approverName} ${status.toLowerCase()} reimbursement claim "${claim.title}" (ID: ${claim.id}) for employee ${claim.employee?.fullName} (${claim.employee?.employeeId}).${comment ? ` Reason: ${comment}` : ''}`,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
          }
        });
      } catch (auditErr) {
        console.warn('Audit log create failed:', auditErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      data: updatedClaim,
      message: `Claim ${status.toLowerCase()} successfully.`
    });
  } catch (err) { next(err); }
};

// ============================================================
// PATCH /api/reimbursements/:id/process-payment
// Process payment for an approved claim. Prevents duplicate payment.
// ============================================================
const processPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { paymentDate, paymentMethod, paymentReference, notes } = req.body;
    const organizationId = req.user?.organizationId;

    if (!paymentMethod) {
      return res.status(400).json({ success: false, error: { message: 'Payment method is required.' } });
    }

    const claim = await prisma.benefitClaim.findUnique({
      where: { id },
      include: {
        employee: {
          include: {
            user: { select: { id: true, organizationId: true } }
          }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ success: false, error: { message: 'Claim not found.' } });
    }

    // Organization check
    if (organizationId && claim.employee?.user?.organizationId !== organizationId) {
      return res.status(403).json({ success: false, error: { message: 'Access denied: This claim does not belong to your organization.' } });
    }

    // Must be approved before payment
    if (claim.finalApprovalStatus !== 'Approved') {
      return res.status(400).json({
        success: false,
        error: { message: 'Claim must be approved before processing payment.' }
      });
    }

    // Prevent duplicate payment processing
    if (claim.paymentStatus === 'Processed') {
      return res.status(409).json({
        success: false,
        error: {
          message: `Payment has already been processed for this claim${claim.paymentReference ? ` (Ref: ${claim.paymentReference})` : ''}.`
        }
      });
    }

    const processorProfile = await prisma.employeeProfile.findFirst({ where: { userId: req.user.userId } });
    const processorName = processorProfile?.fullName || req.user.role;

    let history = [];
    if (claim.approvalHistory) {
      try { history = JSON.parse(claim.approvalHistory); } catch (e) {}
    }
    history.push({
      action: 'Payment Processed',
      actor: processorName,
      role: req.user.role,
      date: new Date().toISOString(),
      comment: [
        `Method: ${paymentMethod}`,
        paymentReference ? `Ref: ${paymentReference}` : null,
        notes ? `Notes: ${notes}` : null
      ].filter(Boolean).join('. ')
    });

    const updatedClaim = await prisma.benefitClaim.update({
      where: { id },
      data: {
        paymentStatus: 'Processed',
        paymentMethod,
        paymentReference: paymentReference || null,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        overallStatus: 'Completed',
        approvalHistory: JSON.stringify(history)
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            avatarUrl: true,
            department: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } }
          }
        }
      }
    });

    // Notify employee
    try {
      await prisma.notification.create({
        data: {
          userId: claim.employee.userId,
          type: 'SUCCESS',
          title: 'Reimbursement Payment Processed',
          message: `Payment of ${claim.amount} for your reimbursement claim "${claim.title}" has been processed via ${paymentMethod}.${paymentReference ? ` Ref: ${paymentReference}` : ''}`,
          isRead: false
        }
      });
    } catch (notifErr) {
      console.warn('Notification create failed:', notifErr.message);
    }

    // Audit log
    const adminUserId = req.user?.id || req.user?.userId;
    if (adminUserId) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: adminUserId,
            organizationId: organizationId || null,
            action: 'REIMBURSEMENT_PAYMENT_PROCESSED',
            details: `Admin ${processorName} processed payment for reimbursement claim "${claim.title}" (ID: ${claim.id}) for employee ${claim.employee?.fullName}. Method: ${paymentMethod}.${paymentReference ? ` Ref: ${paymentReference}` : ''}${notes ? ` Notes: ${notes}` : ''}`,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
          }
        });
      } catch (auditErr) {
        console.warn('Audit log create failed:', auditErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      data: updatedClaim,
      message: 'Payment processed successfully.'
    });
  } catch (err) { next(err); }
};

module.exports = {
  getFinalApprovals,
  reviewFinalApproval,
  processPayment
};
