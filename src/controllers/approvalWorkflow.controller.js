const prisma = require('../config/prisma');
const { validateWorkflow } = require('../services/workflowValidation.service');
const approvalService = require('../services/approval.service');

// Helper to resolve orgId
const resolveOrgId = async (req) => {
  let orgId = req.user?.organizationId;
  if (!orgId) {
    const firstOrg = await prisma.organization.findFirst();
    if (firstOrg) orgId = firstOrg.id;
  }
  return orgId;
};

// Helper for audit logging
const logAudit = async (userId, action, details) => {
  try {
    if (!userId) return;
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress: 'Approval Workflow'
      }
    });
  } catch (err) {
    console.error('[Workflow Audit] Failed to write audit log:', err);
  }
};

// ─────────────────────────────────────────
// WORKFLOW CONFIGURATION APIS
// ─────────────────────────────────────────

const getWorkflows = async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    const workflows = await prisma.approvalWorkflow.findMany({
      where: orgId ? { organizationId: orgId } : {},
      include: { steps: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });
    return res.status(200).json({ success: true, data: workflows });
  } catch (err) { next(err); }
};

const getWorkflowByModule = async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    const { module } = req.params;
    const workflow = await prisma.approvalWorkflow.findFirst({
      where: { 
        ...(orgId ? { organizationId: orgId } : {}), 
        module, 
        isActive: true, 
        status: 'Active' 
      },
      include: { steps: { orderBy: { sequence: 'asc' } } }
    });
    
    if (!workflow) {
      return res.status(404).json({ success: false, message: 'No active workflow found for this module.' });
    }
    return res.status(200).json({ success: true, data: workflow });
  } catch (err) { next(err); }
};

const createWorkflow = async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);

    if (!orgId) {
      return res.status(400).json({ success: false, error: { message: 'Organization ID could not be identified.' } });
    }

    const { name, module, description, steps, status, isActive } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: { message: 'Workflow name is required.' } });
    }

    await validateWorkflow({ module, steps });

    const willBeActive = isActive !== undefined ? Boolean(isActive) : (status ? status === 'Active' : true);
    const statusText = willBeActive ? 'Active' : (status || 'Inactive');

    // If activating, mark previous active version for this module as inactive/archived
    if (willBeActive) {
      await prisma.approvalWorkflow.updateMany({
        where: { organizationId: orgId, module, isActive: true },
        data: { isActive: false, status: 'Archived' }
      });
    }

    // Find latest version number
    const latest = await prisma.approvalWorkflow.findFirst({
      where: { organizationId: orgId, module },
      orderBy: { version: 'desc' }
    });
    const newVersion = latest ? latest.version + 1 : 1;

    // Create new workflow with steps
    const newWorkflow = await prisma.approvalWorkflow.create({
      data: {
        organizationId: orgId,
        name: name.trim(),
        module,
        description: description || null,
        version: newVersion,
        status: statusText,
        isActive: willBeActive,
        effectiveDate: new Date(),
        steps: {
          create: steps.map((s, idx) => ({
            stepOrder: s.sequence !== undefined ? parseInt(s.sequence, 10) : (idx + 1),
            sequence: s.sequence !== undefined ? parseInt(s.sequence, 10) : (idx + 1),
            approverType: s.approverType || 'ROLE',
            approverRole: s.approverRole || 'MANAGER',
            canSkip: Boolean(s.canSkip),
            isRequired: s.isRequired !== undefined ? Boolean(s.isRequired) : true
          }))
        }
      },
      include: { steps: { orderBy: { sequence: 'asc' } } }
    });

    await logAudit(
      req.user?.userId || req.user?.id,
      'WORKFLOW_CREATED',
      `Created workflow "${newWorkflow.name}" (v${newWorkflow.version}) for module "${module}" with ${steps.length} steps.`
    );

    return res.status(201).json({ success: true, data: newWorkflow });
  } catch (err) { 
    console.error('Workflow creation error:', err);
    return res.status(400).json({ success: false, error: { message: err.message } }); 
  }
};

const updateWorkflow = async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    const { id } = req.params;
    const { name, module, description, steps, status, isActive } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: { message: 'Workflow name is required.' } });
    }

    await validateWorkflow({ module, steps });

    const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Workflow not found.' });

    // Check if we are modifying in-place or creating a new version
    const willBeActive = isActive !== undefined ? Boolean(isActive) : (status ? status === 'Active' : true);
    const statusText = willBeActive ? 'Active' : (status || 'Inactive');

    if (willBeActive) {
      await prisma.approvalWorkflow.updateMany({
        where: { organizationId: orgId || existing.organizationId, module, isActive: true, id: { not: id } },
        data: { isActive: false, status: 'Archived' }
      });
    }

    // Archive the existing version
    await prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive: false, status: 'Archived' }
    });

    const newVersion = existing.version + 1;

    const newWorkflow = await prisma.approvalWorkflow.create({
      data: {
        organizationId: orgId || existing.organizationId,
        name: name.trim(),
        module,
        description: description || null,
        version: newVersion,
        status: statusText,
        isActive: willBeActive,
        effectiveDate: new Date(),
        steps: {
          create: steps.map((s, idx) => ({
            stepOrder: s.sequence !== undefined ? parseInt(s.sequence, 10) : (idx + 1),
            sequence: s.sequence !== undefined ? parseInt(s.sequence, 10) : (idx + 1),
            approverType: s.approverType || 'ROLE',
            approverRole: s.approverRole || 'MANAGER',
            canSkip: Boolean(s.canSkip),
            isRequired: s.isRequired !== undefined ? Boolean(s.isRequired) : true
          }))
        }
      },
      include: { steps: { orderBy: { sequence: 'asc' } } }
    });

    await logAudit(
      req.user?.userId || req.user?.id,
      'WORKFLOW_UPDATED',
      `Updated workflow "${newWorkflow.name}" to version ${newWorkflow.version} for module "${module}".`
    );

    return res.status(200).json({ success: true, data: newWorkflow });
  } catch (err) {
    return res.status(400).json({ success: false, error: { message: err.message } }); 
  }
};

const toggleStatusWorkflow = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;

    const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Workflow not found.' });

    const newActiveState = isActive !== undefined ? Boolean(isActive) : !existing.isActive;
    const newStatus = status || (newActiveState ? 'Active' : 'Inactive');

    if (newActiveState) {
      // Deactivate other active workflows for the same module and org
      await prisma.approvalWorkflow.updateMany({
        where: {
          organizationId: existing.organizationId,
          module: existing.module,
          isActive: true,
          id: { not: id }
        },
        data: { isActive: false, status: 'Archived' }
      });
    }

    const updated = await prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive: newActiveState, status: newStatus },
      include: { steps: { orderBy: { sequence: 'asc' } } }
    });

    await logAudit(
      req.user?.userId || req.user?.id,
      'WORKFLOW_STATUS_CHANGED',
      `Changed status of workflow "${updated.name}" (v${updated.version}) to ${newStatus}.`
    );

    return res.status(200).json({ success: true, data: updated, message: `Workflow status updated to ${newStatus}.` });
  } catch (err) { next(err); }
};

const deleteWorkflow = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Workflow not found.' });

    await prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive: false, status: 'Archived' }
    });

    await logAudit(
      req.user?.userId || req.user?.id,
      'WORKFLOW_ARCHIVED',
      `Archived workflow "${existing.name}" (v${existing.version}).`
    );

    return res.status(200).json({ success: true, message: 'Workflow archived successfully.' });
  } catch (err) { next(err); }
};

const unarchiveWorkflow = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Workflow not found.' });

    // Deactivate other active workflows for same module
    await prisma.approvalWorkflow.updateMany({
      where: {
        organizationId: existing.organizationId,
        module: existing.module,
        isActive: true,
        id: { not: id }
      },
      data: { isActive: false, status: 'Archived' }
    });

    const updated = await prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive: true, status: 'Active' },
      include: { steps: { orderBy: { sequence: 'asc' } } }
    });

    await logAudit(
      req.user?.userId || req.user?.id,
      'WORKFLOW_UNARCHIVED',
      `Unarchived and activated workflow "${updated.name}" (v${updated.version}).`
    );

    return res.status(200).json({ success: true, data: updated, message: 'Workflow unarchived successfully.' });
  } catch (err) { next(err); }
};

const hardDeleteWorkflow = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.approvalWorkflow.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Workflow not found.' });

    // Check if any approval logs reference this workflow
    const logsCount = await prisma.approvalLog.count({ where: { workflowId: id } });
    if (logsCount > 0) {
      await prisma.approvalWorkflow.update({
        where: { id },
        data: { isActive: false, status: 'Archived' }
      });
      await logAudit(
        req.user?.userId || req.user?.id,
        'WORKFLOW_ARCHIVED',
        `Safely archived workflow "${existing.name}" due to existing historical approval logs.`
      );
      return res.status(200).json({
        success: true,
        message: 'Workflow has historical approval logs and was safely archived rather than deleted.'
      });
    }

    await prisma.approvalWorkflow.delete({
      where: { id }
    });

    await logAudit(
      req.user?.userId || req.user?.id,
      'WORKFLOW_DELETED',
      `Permanently deleted workflow "${existing.name}" (v${existing.version}).`
    );

    return res.status(200).json({ success: true, message: 'Workflow deleted successfully.' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GENERIC APPROVAL APIS
// ─────────────────────────────────────────

const approveEntity = async (req, res, next) => {
  try {
    const { module, entityId } = req.params;
    const { comments } = req.body;
    const approverUserId = req.user?.userId || req.user?.id;

    const result = await approvalService.processApproval(module, entityId, approverUserId, 'APPROVE', comments);
    
    return res.status(200).json({ success: true, data: result, message: 'Approval processed successfully.' });
  } catch (err) {
    return res.status(400).json({ success: false, error: { message: err.message } });
  }
};

const rejectEntity = async (req, res, next) => {
  try {
    const { module, entityId } = req.params;
    const { comments } = req.body;
    const approverUserId = req.user?.userId || req.user?.id;

    const result = await approvalService.processApproval(module, entityId, approverUserId, 'REJECT', comments);
    
    return res.status(200).json({ success: true, data: result, message: 'Rejection processed successfully.' });
  } catch (err) {
    return res.status(400).json({ success: false, error: { message: err.message } });
  }
};

const getTimeline = async (req, res, next) => {
  try {
    const { module, entityId } = req.params;
    const timeline = await approvalService.getApprovalHistory(module, entityId);
    return res.status(200).json({ success: true, data: timeline });
  } catch (err) { next(err); }
};

const getCurrentStep = async (req, res, next) => {
  try {
    const { module, entityId } = req.params;
    const current = await approvalService.getCurrentStep(module, entityId);
    return res.status(200).json({ success: true, data: current });
  } catch (err) { next(err); }
};

module.exports = {
  getWorkflows,
  getWorkflowByModule,
  createWorkflow,
  updateWorkflow,
  toggleStatusWorkflow,
  deleteWorkflow,
  hardDeleteWorkflow,
  unarchiveWorkflow,
  approveEntity,
  rejectEntity,
  getTimeline,
  getCurrentStep
};

