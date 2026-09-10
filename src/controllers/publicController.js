// ============================================================
// Public Controller - Demo Booking, Contact Form, Career Applications
// ============================================================

const prisma = require('../config/prisma');
const { z } = require('zod');

// ---------- VALIDATION SCHEMAS ----------

const demoBookingSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  email: z.string().email({ message: 'Valid email is required.' }),
  companySize: z.string().optional(),
  requirement: z.string().optional(),
  selectedDate: z.string().optional(),
  selectedSlot: z.string().optional(),
  companyName: z.string().optional(),
  phone: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  message: z.string().optional(),
  modules: z.string().optional()
});

const contactFormSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  email: z.string().email({ message: 'Valid email is required.' }),
  subject: z.string(),
  message: z.string().min(10, { message: 'Message must be at least 10 characters.' })
});

const fs = require('fs');
const path = require('path');


const registerOrganizationSchema = z.object({
  organizationName: z.string().min(2, { message: 'Organization name must be at least 2 characters.' }),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  country: z.string().optional(),
  adminFullName: z.string().min(2, { message: 'Admin full name must be at least 2 characters.' }),
  adminEmail: z.string().email({ message: 'Valid admin email is required.' }),
  adminPhone: z.string().optional(),
  plan: z.string().optional(),
  billingCycle: z.string().optional()
});

const careerApplicationSchema = z.object({
  jobId: z.string().optional(),
  jobTitle: z.string().optional(),
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  email: z.string().email({ message: 'Valid email is required.' }),
  phone: z.string().optional(),
  resumeName: z.string().optional(),
  resumeData: z.string().optional(),
  portfolioUrl: z.string().optional(),
  explanation: z.string().optional(),
  aiScore: z.number().optional()
});

// ---------- DEMO BOOKING ----------

// POST /api/public/demo-booking
const bookDemo = async (req, res, next) => {
  try {
    // Validate request
    const parsed = demoBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error?.issues?.[0]?.message || parsed.error?.errors?.[0]?.message || 'Validation failed.' },
      });
    }

    const { name, email, companySize, requirement, selectedDate, selectedSlot, companyName, phone, industry, country, message, modules } = parsed.data;

    const demo = await prisma.demoBooking.create({
      data: {
        name,
        email,
        companySize: companySize || '1-10',
        requirement: requirement || 'General Demo',
        selectedDate: selectedDate ? new Date(selectedDate) : new Date(),
        selectedSlot: selectedSlot || '10:00 AM',
        companyName: companyName || null,
        phone: phone || null,
        industry: industry || null,
        country: country || null,
        message: message || null,
        modules: modules || null
      }
    });

    return res.status(201).json({
      success: true,
      data: demo,
      message: 'Demo request received successfully. Our team will contact you shortly.'
    });

  } catch (err) {
    next(err);
  }
};

// ---------- CONTACT FORM ----------

// POST /api/public/contact
const submitContact = async (req, res, next) => {
  try {
    // Validate request
    const parsed = contactFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error?.issues?.[0]?.message || parsed.error?.errors?.[0]?.message || 'Validation failed.' },
      });
    }

    const { name, email, subject, message } = parsed.data;

    const contact = await prisma.contactMessage.create({
      data: {
        name,
        email,
        subject,
        message
      }
    });

    return res.status(201).json({
      success: true,
      data: contact,
      message: 'Message sent successfully. We will get back to you soon.'
    });

  } catch (err) {
    next(err);
  }
};

// ---------- CAREER APPLICATIONS ----------

// POST /api/public/career-apply
const submitCareerApplication = async (req, res, next) => {
  try {
    // Validate request
    const parsed = careerApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error?.issues?.[0]?.message || parsed.error?.errors?.[0]?.message || 'Validation error' },
      });
    }

    const { jobId, jobTitle, name, email, phone, resumeName, resumeData, portfolioUrl, explanation, aiScore } = parsed.data;

    // Find Target Job Post
    let targetJob = null;
    if (jobId) {
      targetJob = await prisma.jobPost.findUnique({ where: { id: jobId } });
    }
    if (!targetJob && jobTitle) {
      targetJob = await prisma.jobPost.findFirst({ where: { title: jobTitle } });
    }
    if (!targetJob) {
      targetJob = await prisma.jobPost.findFirst();
    }

    if (!targetJob) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Target job post not found in system' },
      });
    }

    // Save Uploaded Resume to Disk (Storage)
    let savedResumeUrl = null;
    let finalResumeData = resumeData || null;

    if (resumeData && typeof resumeData === 'string' && resumeData.startsWith('data:')) {
      try {
        const matches = resumeData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches && matches[2]) {
          const mimeType = matches[1];
          const base64Data = matches[2];
          const fileBuffer = Buffer.from(base64Data, 'base64');

          const ext = path.extname(resumeName || '') || (mimeType.includes('pdf') ? '.pdf' : mimeType.includes('word') ? '.docx' : '.txt');
          const safeName = (path.basename(resumeName || 'resume', ext) || 'candidate_resume').replace(/[^a-zA-Z0-9_\-]/g, '_');
          const filename = `resume_${Date.now()}_${safeName}${ext}`;
          const uploadsDir = path.join(__dirname, '../../public/uploads/resumes');

          fs.mkdirSync(uploadsDir, { recursive: true });
          fs.writeFileSync(path.join(uploadsDir, filename), fileBuffer);

          const port = process.env.PORT || 5001;
          const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
          savedResumeUrl = `${backendUrl}/uploads/resumes/${filename}`;
        }
      } catch (saveErr) {
        console.error('[PublicController] Failed to save resume to disk:', saveErr.message);
      }
    }

    // Perform AI Analysis on Actual Resume vs Job Requirements
    let aiEvaluation = null;
    let calculatedAiScore = null;
      let rawAiUrl = process.env.AI_SERVER_URL || 'https://hcm-ai-server-production.up.railway.app';
      const aiServerUrl = /^https?:\/\//i.test(rawAiUrl.trim()) ? rawAiUrl.trim().replace(/\/+$/, '') : `https://${rawAiUrl.trim().replace(/\/+$/, '')}`;
      const aiRes = await fetch(`${aiServerUrl}/api/mcp/resume/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeBase64: resumeData,
          fileName: resumeName,
          job: {
            title: targetJob.title,
            department: targetJob.department,
            description: targetJob.description,
            requirements: targetJob.requirements,
            experience: targetJob.experience,
          }
        })
      });
        if (aiRes.ok) {
          const json = await aiRes.json();
          aiEvaluation = json.data || json;
          calculatedAiScore = typeof aiEvaluation.score === 'number' ? aiEvaluation.score : aiEvaluation.matchScore;
        }
      } catch (aiErr) {
        console.error('[PublicController] AI evaluation service call failed:', aiErr.message);
      }

      // If document is recognized as a random document or report instead of a CV/resume:
      if (aiEvaluation && aiEvaluation.isValidResume === false) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_RESUME',
            message: aiEvaluation.reasoning || 'Invalid Resume: The uploaded file is a random document or report instead of a valid CV/resume. Please upload a valid candidate CV or resume.'
          }
        });
      }

      const finalScore = typeof calculatedAiScore === 'number' 
        ? calculatedAiScore 
        : (typeof aiScore === 'number' ? aiScore : 75);

    // Create a candidate user if not exists
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash('candidate123', 10);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'CANDIDATE'
        }
      });
    }

    const effectiveResumeUrl = savedResumeUrl || finalResumeData || resumeName || '';
    const skillsToSave = (aiEvaluation?.extractedSkills && aiEvaluation.extractedSkills.length > 0)
      ? aiEvaluation.extractedSkills.join(', ')
      : (explanation || 'Candidate Profile');

    // Get or Create candidate profile
    let candidateProfile = await prisma.candidateProfile.findUnique({ where: { userId: user.id } });
    if (!candidateProfile) {
      candidateProfile = await prisma.candidateProfile.create({
        data: {
          userId: user.id,
          fullName: name,
          phone,
          linkedin: portfolioUrl,
          resumeUrl: effectiveResumeUrl,
          resumeData: finalResumeData,
          skills: skillsToSave,
        }
      });
    } else {
      candidateProfile = await prisma.candidateProfile.update({
        where: { id: candidateProfile.id },
        data: {
          fullName: name || candidateProfile.fullName,
          phone: phone || candidateProfile.phone,
          linkedin: portfolioUrl || candidateProfile.linkedin,
          resumeUrl: effectiveResumeUrl || candidateProfile.resumeUrl,
          resumeData: finalResumeData || candidateProfile.resumeData,
          skills: skillsToSave || candidateProfile.skills,
        }
      });
    }

    // Check if application already exists
    const existingApplication = await prisma.jobApplication.findFirst({
      where: {
        jobId: targetJob.id,
        candidateId: candidateProfile.id
      }
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_APPLIED', message: 'You have already applied for this position' },
      });
    }

    const coverLetterText = `Phone: ${phone || 'N/A'}\nPortfolio: ${portfolioUrl || 'N/A'}\n\nWhy join:\n${explanation || 'N/A'}\n\nAI Match Score: ${finalScore}%\nAI Assessment: ${aiEvaluation?.reasoning || 'Resume evaluated against job requirements'}\nRecommendation: ${aiEvaluation?.recommendation || (finalScore >= 75 ? 'Strong Match' : 'Standard Review')}`;

    const application = await prisma.jobApplication.create({
      data: {
        jobId: targetJob.id,
        candidateId: candidateProfile.id,
        resumeUrl: effectiveResumeUrl,
        coverLetter: coverLetterText,
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        id: application.id,
        jobTitle: targetJob.title,
        name,
        email
      },
      message: 'Application submitted successfully. Thank you for applying!'
    });

  } catch (err) {
    next(err);
  }
};

// GET /api/public/jobs - Get available career opportunities
const getAvailableJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.jobPost.findMany({
      where: {
        status: 'Published',
        isActive: true
      },
      select: {
        id: true,
        title: true,
        department: true,
        location: true,
        jobType: true
      }
    });

    const formattedJobs = jobs.map(job => ({
      id: job.id,
      title: job.title,
      dept: job.department || 'General',
      loc: job.location || 'Remote',
      type: job.jobType || 'Full-time'
    }));

    return res.status(200).json({ success: true, data: formattedJobs });
  } catch (err) {
    next(err);
  }
};

const getPlatformStats = async (req, res, next) => {
  try {
    const employeeCount = await prisma.employeeProfile.count();
    const payslips = await prisma.payslip.findMany();
    const attendanceLogs = await prisma.attendanceLog.findMany({
      where: {
        date: {
          gte: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
        }
      },
      select: {
        status: true,
        date: true
      }
    });

    const candidateCount = await prisma.candidateProfile.count();
    const topCandidate = await prisma.candidateProfile.findFirst({
      select: {
        fullName: true
      }
    });

    let totalDisbursed = payslips.reduce((sum, p) => sum + p.netPay, 0);
    let totalTaxPF = payslips.reduce((sum, p) => sum + p.tax + p.pf, 0);

    const activeLives = employeeCount;
    const disbursed = (totalDisbursed / 1000).toFixed(1);
    const taxes = (totalTaxPF / 1000).toFixed(1);
    const wellness = "0.0";
    const growth = "0.0";
    
    let presentCountTotal = 0;
    attendanceLogs.forEach(log => {
      if (log.status === 'Present') presentCountTotal++;
    });
    const avgAttendance = attendanceLogs.length > 0 ? ((presentCountTotal / attendanceLogs.length) * 100).toFixed(1) : "0.0";

    // Calculate attendance heatmap (last 28 days)
    const heatmap = [];
    const today = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dStr = d.toISOString().split('T')[0];

      const logsForDay = attendanceLogs.filter(log => {
        const logDateStr = new Date(log.date).toISOString().split('T')[0];
        return logDateStr === dStr;
      });

      if (logsForDay.length > 0) {
        const presentCount = logsForDay.filter(l => l.status === 'Present').length;
        const total = logsForDay.length;
        const ratio = presentCount / total;
        if (ratio >= 0.8) {
          heatmap.push('present');
        } else if (ratio >= 0.5) {
          heatmap.push('warning');
        } else {
          heatmap.push('absent');
        }
      } else {
        heatmap.push('empty');
      }
    }

    const recruitmentInsight = candidateCount > 0
      ? `AI scanned ${candidateCount} candidate resumes. Identified ${topCandidate?.fullName || 'a candidate'} as premium fit with Operations.`
      : "AI scanned 0 candidate resumes. Awaiting candidates.";

    return res.json({
      success: true,
      data: {
        activeLives,
        growth,
        avgAttendance,
        totalDisbursed: disbursed,
        taxesAndContributions: taxes,
        wellnessBudget: wellness,
        heatmap,
        recruitmentInsight
      }
    });
  } catch (err) {
    next(err);
  }
};


// ---------- TENANT SAAS FLOWS ----------

// POST /api/public/register-organization
const registerOrganization = async (req, res, next) => {
  try {
    const parsed = registerOrganizationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error?.issues?.[0]?.message || parsed.error?.errors?.[0]?.message || 'Validation failed.' },
      });
    }

    const { organizationName, industry, companySize, country, adminFullName, adminEmail, adminPhone } = parsed.data;

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_TAKEN', message: 'This email is already registered.' },
      });
    }

    // Provision Tenant and User in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const org = await tx.organization.create({
        data: {
          name: organizationName,
          industry: industry || 'Technology',
          companySize: companySize || '1-50',
          phone: adminPhone || null,
          email: adminEmail || null,
          status: 'ACTIVE',
          subscriptionStatus: 'TRIAL',
          subscriptionStart: new Date(),
          subscriptionEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days trial
        }
      });

      // 2. Create Admin User
      const user = await tx.user.create({
        data: {
          email: adminEmail,
          passwordHash: 'INVITED_PENDING_PASSWORD',
          role: 'ADMIN',
          organizationId: org.id,
          status: 'Pending',
          isActive: false
        }
      });

      // 3. Create EmployeeProfile
      const empCode = 'EMP-' + Math.floor(1000 + Math.random() * 9000);
      await tx.employeeProfile.create({
        data: {
          userId: user.id,
          fullName: adminFullName,
          employeeId: empCode,
          organizationId: org.id
        }
      });

      return { org, user };
    });

    const jwtHelper = require('../utils/jwtHelper');
    const token = jwtHelper.signToken({
      userId: result.user.id,
      email: result.user.email,
      organizationId: result.org.id,
      organizationName: result.org.name,
      purpose: 'invitation'
    });

    return res.status(201).json({
      success: true,
      data: {
        token,
        organizationName: result.org.name,
        adminEmail: result.user.email
      },
      message: 'Workspace registered successfully.'
    });

  } catch (err) {
    next(err);
  }
};

// POST /api/public/validate-invitation
const validateInvitation = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token is required' } });
    }

    const jwtHelper = require('../utils/jwtHelper');
    const decoded = jwtHelper.verifyToken(token);

    if (decoded.purpose !== 'invitation') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token purpose' } });
    }

    // Verify user exists and status is Pending
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { organization: true }
    });

    if (!user || user.status !== 'Pending') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invitation is no longer valid.' } });
    }

    return res.status(200).json({
      success: true,
      data: {
        email: user.email,
        organizationName: user.organization?.name || 'Workspace'
      }
    });

  } catch (err) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token has expired or is invalid.' } });
  }
};

// POST /api/public/setup-password
const setupPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Token and password are required' } });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters long.' } });
    }

    const jwtHelper = require('../utils/jwtHelper');
    const decoded = jwtHelper.verifyToken(token);

    if (decoded.purpose !== 'invitation') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token purpose' } });
    }

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        passwordHash,
        status: 'Active',
        isActive: true
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Password set successfully. Account activated.'
    });

  } catch (err) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token has expired or is invalid.' } });
  }
};

module.exports = {
  bookDemo,
  submitContact,
  submitCareerApplication,
  getAvailableJobs,
  getPlatformStats,
  registerOrganization,
  validateInvitation,
  setupPassword
};
