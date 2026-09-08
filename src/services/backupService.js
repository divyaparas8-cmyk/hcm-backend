// ============================================================
// Organization Backup Service (Tenant-Scoped)
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const archiver = require('archiver');
const prisma = require('../config/prisma');

const BACKUP_DIR = path.join(__dirname, '../../public/backups');
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// All available tenant modules for backup
const AVAILABLE_MODULES = [
  { key: 'organization', label: 'Organization Information', description: 'Company profile, regional preferences, and policies' },
  { key: 'users', label: 'Users & Accounts', description: 'User accounts without security credentials' },
  { key: 'employee_profiles', label: 'Employee Profiles', description: 'Staff directory, compensation, personal details' },
  { key: 'roles', label: 'Roles & Permissions', description: 'Custom roles and permission matrices' },
  { key: 'departments', label: 'Departments & Hierarchy', description: 'Org units and reporting structure' },
  { key: 'attendance', label: 'Attendance Records', description: 'Time logs, work hours, overtime minutes' },
  { key: 'leaves', label: 'Leave & Policies', description: 'Leave requests, allowances, and company leave rules' },
  { key: 'shifts', label: 'Shifts & Work Calendars', description: 'Shift schedules, weekend rules, corporate calendars' },
  { key: 'payroll', label: 'Payroll & Compensation', description: 'Salary structures, components, payslip history' },
  { key: 'benefits', label: 'Benefits & Claims', description: 'Company health plans, insurance, employee enrollments' },
  { key: 'recruitment', label: 'Recruitment & Candidates', description: 'Job posts, candidate profiles, interviews, offers' },
  { key: 'documents', label: 'Documents & Vault', description: 'Document metadata records and uploaded assets' },
  { key: 'support_tickets', label: 'Support Tickets', description: 'Help desk tickets and internal communications' },
  { key: 'notifications', label: 'Notifications', description: 'System alerts and notification history' },
  { key: 'audit_logs', label: 'Audit Logs', description: 'Activity history and administrative audit trail' },
  { key: 'workflows', label: 'Approval Workflows', description: 'Multi-stage approval routing configurations' },
  { key: 'settings', label: 'Tenant Settings', description: 'Compliance policies and operational settings' },
  { key: 'offboarding', label: 'Offboarding & Resignations', description: 'Resignation requests, clearance tasks, exit interviews' },
  { key: 'tasks_goals', label: 'Tasks & Performance Goals', description: 'Employee OKRs, performance goals, team tasks' }
];

/**
 * Calculates SHA-256 checksum of a file
 */
const calculateFileChecksum = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
};

/**
 * Sanitize user records to strictly strip passwords and secrets
 */
const sanitizeUsers = (users) => {
  return users.map(u => {
    const { passwordHash, ...safeUser } = u;
    return {
      ...safeUser,
      securityNote: 'Password hashes are excluded for security. Users will receive a password reset link upon restoration.'
    };
  });
};

/**
 * Collect all data belonging exclusively to a specific organization
 */
const collectTenantData = async (organizationId, selectedModules = []) => {
  const data = {};
  const recordCounts = {};
  const modulesToFetch = new Set(selectedModules.length > 0 ? selectedModules : AVAILABLE_MODULES.map(m => m.key));

  // 1. Organization info
  if (modulesToFetch.has('organization')) {
    const [org, attendancePolicy, payrollConfig] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        include: { pricingPlan: { select: { id: true, name: true } } }
      }),
      prisma.attendancePolicy.findUnique({ where: { organizationId } }).catch(() => null),
      prisma.payrollConfiguration.findUnique({ where: { organizationId } }).catch(() => null)
    ]);
    data.organization = { profile: org, attendancePolicy, payrollConfig };
    recordCounts.organization = org ? 1 : 0;
  }

  // 2. Users (Without passwords!)
  if (modulesToFetch.has('users')) {
    const users = await prisma.user.findMany({
      where: {
        organizationId,
        role: { notIn: ['SUPERADMIN'] }
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        status: true,
        customRoleId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    data.users = sanitizeUsers(users);
    recordCounts.users = users.length;
  }

  // 3. Employee Profiles
  if (modulesToFetch.has('employee_profiles')) {
    const profiles = await prisma.employeeProfile.findMany({
      where: { user: { organizationId } },
      include: {
        compensationProfile: true,
        skills: true,
        reviews: true,
        bonuses: true,
        salaryIncrementRequests: true
      }
    });
    data.employee_profiles = profiles;
    recordCounts.employee_profiles = profiles.length;
  }

  // 4. Custom Roles & Permissions
  if (modulesToFetch.has('roles')) {
    const roles = await prisma.customRole.findMany({
      where: { organizationId }
    });
    data.roles = roles;
    recordCounts.roles = roles.length;
  }

  // 5. Departments
  if (modulesToFetch.has('departments')) {
    const depts = await prisma.department.findMany({
      where: { organizationId }
    });
    data.departments = depts;
    recordCounts.departments = depts.length;
  }

  // 6. Attendance Logs
  if (modulesToFetch.has('attendance')) {
    const logs = await prisma.attendanceLog.findMany({
      where: { user: { organizationId } }
    });
    data.attendance = logs;
    recordCounts.attendance = logs.length;
  }

  // 7. Leave Policies & Requests
  if (modulesToFetch.has('leaves')) {
    const [policies, requests] = await Promise.all([
      prisma.leavePolicy.findMany({ where: { organizationId } }),
      prisma.leaveRequest.findMany({ where: { user: { organizationId } } })
    ]);
    data.leaves = { policies, requests };
    recordCounts.leaves = policies.length + requests.length;
  }

  // 8. Shifts & Work Calendars
  if (modulesToFetch.has('shifts')) {
    const [shifts, overtime, calendars, holidays] = await Promise.all([
      prisma.shift.findMany({ where: { organizationId } }),
      prisma.overtimePolicy.findMany({ where: { organizationId } }),
      prisma.workCalendar.findMany({
        where: { companyId: organizationId },
        include: { versions: { include: { weekends: true } }, assignments: true }
      }),
      prisma.holiday.findMany({
        where: {
          OR: [
            { calendar: { companyId: organizationId } },
            { calendarId: null }
          ]
        }
      })
    ]);
    data.shifts = { shifts, overtimePolicies: overtime, workCalendars: calendars, holidays };
    recordCounts.shifts = shifts.length + overtime.length + calendars.length + holidays.length;
  }

  // 9. Payroll & Compensation
  if (modulesToFetch.has('payroll')) {
    const [structures, components, deductions, taxRules, bands, payslips, snapshots] = await Promise.all([
      prisma.salaryStructure.findMany({
        where: { organizationId },
        include: { versions: { include: { components: true } } }
      }),
      prisma.salaryComponent.findMany({ where: { organizationId } }),
      prisma.deductionRule.findMany({ where: { organizationId } }),
      prisma.taxRule.findMany({ where: { organizationId } }),
      prisma.salaryBand.findMany({ where: { organizationId } }),
      prisma.payslip.findMany({ where: { employee: { user: { organizationId } } } }),
      prisma.payrollSnapshot.findMany({
        where: { employee: { user: { organizationId } } },
        include: { items: true }
      })
    ]);
    data.payroll = { structures, components, deductions, taxRules, bands, payslips, snapshots };
    recordCounts.payroll = structures.length + components.length + deductions.length + taxRules.length + bands.length + payslips.length + snapshots.length;
  }

  // 10. Benefits & Claims
  if (modulesToFetch.has('benefits')) {
    const [plans, claims] = await Promise.all([
      prisma.benefitPlan.findMany({
        where: { organizationId },
        include: { employeeBenefits: true }
      }),
      prisma.benefitClaim.findMany({
        where: { employee: { user: { organizationId } } }
      })
    ]);
    data.benefits = { plans, claims };
    recordCounts.benefits = plans.length + claims.length;
  }

  // 11. Recruitment Pipeline
  if (modulesToFetch.has('recruitment')) {
    const [jobPosts, candidates, applications, interviews, offers, onboardings] = await Promise.all([
      prisma.jobPost.findMany({ where: { organizationId } }),
      prisma.candidateProfile.findMany({ where: { user: { organizationId } } }),
      prisma.jobApplication.findMany({ where: { jobPost: { organizationId } } }),
      prisma.interview.findMany({ where: { application: { jobPost: { organizationId } } } }),
      prisma.offer.findMany({ where: { application: { jobPost: { organizationId } } } }),
      prisma.onboarding.findMany({ where: { application: { jobPost: { organizationId } } } })
    ]);
    data.recruitment = { jobPosts, candidates, applications, interviews, offers, onboardings };
    recordCounts.recruitment = jobPosts.length + candidates.length + applications.length + interviews.length + offers.length + onboardings.length;
  }

  // 12. Documents Metadata
  if (modulesToFetch.has('documents')) {
    const documents = await prisma.document.findMany({
      where: { organizationId }
    });
    data.documents = documents;
    recordCounts.documents = documents.length;
  }

  // 13. Support Tickets
  if (modulesToFetch.has('support_tickets')) {
    const tickets = await prisma.supportTicket.findMany({
      where: { user: { organizationId } },
      include: { messages: true }
    });
    data.support_tickets = tickets;
    recordCounts.support_tickets = tickets.length;
  }

  // 14. Notifications
  if (modulesToFetch.has('notifications')) {
    const notifications = await prisma.notification.findMany({
      where: { user: { organizationId } }
    });
    data.notifications = notifications;
    recordCounts.notifications = notifications.length;
  }

  // 15. Audit Logs
  if (modulesToFetch.has('audit_logs')) {
    const logs = await prisma.auditLog.findMany({
      where: { user: { organizationId } }
    });
    data.audit_logs = logs;
    recordCounts.audit_logs = logs.length;
  }

  // 16. Approval Workflows
  if (modulesToFetch.has('workflows')) {
    const workflows = await prisma.approvalWorkflow.findMany({
      where: { organizationId },
      include: { steps: true }
    });
    data.workflows = workflows;
    recordCounts.workflows = workflows.length;
  }

  // 17. Settings & Compliance Policies
  if (modulesToFetch.has('settings')) {
    const policies = await prisma.policy.findMany({
      where: { organizationId },
      include: { policyAcknowledgments: true }
    });
    data.settings = { policies };
    recordCounts.settings = policies.length;
  }

  // 18. Offboarding & Resignations
  if (modulesToFetch.has('offboarding')) {
    const exits = await prisma.exitLifecycle.findMany({
      where: { employee: { user: { organizationId } } }
    });
    data.offboarding = exits;
    recordCounts.offboarding = exits.length;
  }

  // 19. Tasks & Performance Goals
  if (modulesToFetch.has('tasks_goals')) {
    const [goals, tasks] = await Promise.all([
      prisma.performanceGoal.findMany({ where: { employee: { user: { organizationId } } } }),
      prisma.task.findMany({ where: { employee: { user: { organizationId } } } })
    ]);
    data.tasks_goals = { goals, tasks };
    recordCounts.tasks_goals = goals.length + tasks.length;
  }

  return { data, recordCounts };
};

/**
 * Helper to initialize zip archiver
 */
const createZipArchive = (options = {}) => {
  if (typeof archiver === 'function') {
    return archiver('zip', options);
  }
  if (archiver.ZipArchive) {
    return new archiver.ZipArchive(options);
  }
  if (archiver.create) {
    return archiver.create('zip', options);
  }
  throw new Error('Unable to initialize zip archiver.');
};

/**
 * Execute the Backup Job in Background
 */
const runBackupJob = async (jobId) => {
  try {
    const job = await prisma.backupJob.findUnique({
      where: { id: jobId },
      include: { organization: true, createdByUser: true }
    });

    if (!job) return;

    // Update status to PROCESSING
    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: 'PROCESSING',
        progress: 10,
        progressStep: 'Extracting organization database records'
      }
    });

    const organizationId = job.organizationId;
    const selectedModules = job.includedModules ? JSON.parse(job.includedModules) : [];
    
    // Collect tenant data
    const { data: tenantData, recordCounts } = await collectTenantData(organizationId, selectedModules);

    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        progress: 35,
        progressStep: 'Generating manifest and modular schemas',
        recordCounts: JSON.stringify(recordCounts)
      }
    });

    // Create file name
    const orgSlug = (job.organization?.name || 'HCM').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `HCM_Backup_${orgSlug}_${dateStr}.zip`;
    const zipPath = path.join(BACKUP_DIR, fileName);

    const output = fs.createWriteStream(zipPath);
    const archive = createZipArchive({ zlib: { level: 9 } });

    const archivePromise = new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(output);

    // Build Manifest
    const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
    const manifest = {
      backupVersion: '1.0',
      application: 'HCM SaaS Platform',
      organizationId: job.organizationId,
      organizationName: job.organization?.name || 'Organization',
      createdAt: new Date().toISOString(),
      createdBy: job.createdByUser?.email || 'Admin',
      type: job.type,
      totalRecords,
      recordCounts,
      includedModules: selectedModules.length > 0 ? selectedModules : AVAILABLE_MODULES.map(m => m.key),
      restorationReady: true
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Append README.txt
    const readmeContent = `===============================================================
HCM SaaS Platform — Organization Backup Archive
===============================================================
Organization:   ${manifest.organizationName}
Organization ID: ${manifest.organizationId}
Generated At:   ${manifest.createdAt}
Created By:     ${manifest.createdBy}
Backup Type:    ${job.type}
Total Records:  ${totalRecords}
===============================================================
This backup is restoration-ready and contains all tenant-scoped
records, configuration, and structural hierarchies.
All password hashes and platform credentials are safely omitted.
===============================================================`;
    archive.append(readmeContent, { name: 'README.txt' });

    // Append each module JSON file
    for (const [key, value] of Object.entries(tenantData)) {
      archive.append(JSON.stringify(value, null, 2), { name: `${key}.json` });
    }

    // ── Document Binary Files Handling (when DATA_AND_DOCUMENTS) ──
    if (job.type === 'DATA_AND_DOCUMENTS' && Array.isArray(tenantData.documents) && tenantData.documents.length > 0) {
      await prisma.backupJob.update({
        where: { id: jobId },
        data: { progress: 55, progressStep: 'Packaging document binary assets' }
      });

      const docsSummary = [];
      for (const doc of tenantData.documents) {
        try {
          const cleanName = (doc.name || doc.fileName || doc.title || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
          const entryName = `documents/${doc.id}_${cleanName}`;
          const targetUrl = doc.url || doc.fileUrl || '';

          // Check if local file exists
          let localPath = doc.filePath;
          if (!localPath && targetUrl) {
            const potentialLocal = path.join(UPLOADS_DIR, path.basename(targetUrl));
            if (fs.existsSync(potentialLocal)) {
              localPath = potentialLocal;
            } else if (fs.existsSync(targetUrl)) {
              localPath = targetUrl;
            }
          }

          if (localPath && fs.existsSync(localPath)) {
            archive.file(localPath, { name: entryName });
            docsSummary.push({ id: doc.id, fileName: cleanName, status: 'included_local' });
          } else if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
            // Fetch cloud storage asset (Cloudinary / ImageKit)
            try {
              const fileRes = await axios.get(targetUrl, { responseType: 'arraybuffer', timeout: 5000 });
              archive.append(Buffer.from(fileRes.data), { name: entryName });
              docsSummary.push({ id: doc.id, fileName: cleanName, status: 'included_cloud' });
            } catch (dlErr) {
              docsSummary.push({ id: doc.id, fileName: cleanName, status: 'cloud_fetch_error', error: dlErr.message });
            }
          } else {
            docsSummary.push({ id: doc.id, fileName: cleanName, status: 'metadata_only' });
          }
        } catch (docErr) {
          console.warn(`[BackupJob] Skipping document ${doc.id}:`, docErr.message);
        }
      }
      archive.append(JSON.stringify(docsSummary, null, 2), { name: 'documents_manifest.json' });
    }

    await prisma.backupJob.update({
      where: { id: jobId },
      data: { progress: 75, progressStep: 'Compressing and generating ZIP archive' }
    });

    // Finalize the archive
    await archive.finalize();
    await archivePromise;

    // Calculate file size and SHA-256 checksum
    const stats = fs.statSync(zipPath);
    const checksum = await calculateFileChecksum(zipPath);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days retention

    // Update job to COMPLETED
    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        progressStep: 'Backup completed successfully',
        fileName,
        filePath: zipPath,
        fileSize: BigInt(stats.size),
        checksum,
        completedAt: new Date(),
        expiresAt
      }
    });

    // Create Audit Log
    if (job.createdByUserId) {
      await prisma.auditLog.create({
        data: {
          userId: job.createdByUserId,
          action: 'BACKUP_CREATED',
          details: `Generated ${job.type} backup "${fileName}" (${(stats.size / (1024 * 1024)).toFixed(2)} MB, ${totalRecords} records)`,
          organizationId: job.organizationId
        }
      }).catch(() => {});
    }

  } catch (err) {
    console.error(`[BackupJob ${jobId}] Failed:`, err);
    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        progress: 0,
        progressStep: 'Failed',
        errorMessage: err.message || 'Failed to complete backup archive creation.'
      }
    }).catch(() => {});
  }
};

module.exports = {
  AVAILABLE_MODULES,
  BACKUP_DIR,
  collectTenantData,
  runBackupJob,
  calculateFileChecksum
};
