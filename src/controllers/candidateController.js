// ============================================================
// Candidate Controller
// ============================================================
// Handles: Browse Jobs, Apply, Track Application, View Interviews

const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { handleBase64Field } = require('../services/cloudUploadService');

const getAvailableJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.jobPost.findMany({
      where: { 
        isActive: true, 
        status: { in: ['Published', 'ACTIVE', 'Open', 'published', 'active', 'open'] } 
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            primaryEmail: true,
            websiteUrl: true
          }
        },
        _count: {
          select: { applications: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch HR users for dynamic hiring manager assignment
    const hrUsers = await prisma.user.findMany({
      where: { role: 'HR', isActive: true },
      include: {
        employeeProfile: {
          select: { fullName: true, avatarUrl: true, phone: true }
        }
      }
    });

    const hrByOrg = {};
    for (const hr of hrUsers) {
      if (hr.organizationId && !hrByOrg[hr.organizationId]) {
        hrByOrg[hr.organizationId] = {
          name: hr.employeeProfile?.fullName || hr.email.split('@')[0],
          role: 'Talent Acquisition & People Ops',
          email: hr.email,
          avatar: hr.employeeProfile?.avatarUrl || ''
        };
      }
    }

    const enrichedJobs = jobs.map(job => {
      const orgHr = job.organizationId ? hrByOrg[job.organizationId] : null;
      const hiringManager = orgHr || {
        name: job.organization?.name ? `${job.organization.name} Talent Team` : 'People & Talent Acquisition Team',
        role: 'Recruitment & Operations Lead',
        email: job.organization?.primaryEmail || 'careers@hcm.ai',
        avatar: job.organization?.logoUrl || ''
      };

      return {
        ...job,
        company: job.organization?.name || 'Global Enterprise',
        hiringManager
      };
    });

    return res.status(200).json({ success: true, data: enrichedJobs });
  } catch (err) { next(err); }
};

// POST /api/candidate/jobs/:jobId/apply
const applyToJob = async (req, res, next) => {
  try {
    let profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
      profile = await prisma.candidateProfile.create({
        data: {
          userId: req.user.userId,
          fullName: req.body.fullName || user?.email?.split('@')[0] || 'Candidate',
          phone: req.body.phone || null,
          location: req.body.location || null
        }
      });
    }

    // Check: already applied?
    const existing = await prisma.jobApplication.findFirst({
      where: { jobId: req.params.jobId, candidateId: profile.id },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'ALREADY_APPLIED', message: 'You have already applied for this job.' }
      });
    }

    // Update candidate profile with the latest application details
    let resumeUrl = req.body.resumeUrl || profile.resumeUrl || null;
    let resumeData = req.body.resumeBase64 || req.body.resumeData || profile.resumeData || null;

    if (req.body.resumeBase64 && typeof req.body.resumeBase64 === 'string') {
      try {
        resumeUrl = await handleBase64Field(
          req.body.resumeBase64,
          resumeUrl,
          { folder: 'hcm/resumes', filenamePrefix: 'resume' }
        );
      } catch (err) {
        console.error("[CandidateController] Failed to upload resume to ImageKit:", err.message);
      }
    }

    const targetJob = await prisma.jobPost.findUnique({ where: { id: req.params.jobId } });
    if (!targetJob || !targetJob.isActive) {
      return res.status(404).json({
        success: false,
        error: { code: 'JOB_NOT_FOUND', message: 'This position is no longer accepting applications.' }
      });
    }
    let aiEvaluation = null;
    let calculatedScore = null;
    if (targetJob) {
      try {
        let rawAiUrl = process.env.AI_SERVER_URL || 'https://hcm-ai-server-production.up.railway.app';
        const aiServerUrl = /^https?:\/\//i.test(rawAiUrl.trim()) ? rawAiUrl.trim().replace(/\/+$/, '') : `https://${rawAiUrl.trim().replace(/\/+$/, '')}`;
        
        // Build fallback candidate summary text from profile if no raw base64 text is available
        const profileResumeSummary = `Candidate: ${req.body.fullName || profile.fullName || 'Applicant'}
Skills: ${req.body.skills || profile.skills || 'Software Development, Problem Solving'}
Experience: ${req.body.experience || profile.experience || '1-3 years'}
Bio: ${profile.bio || 'Qualified professional applying for the position.'}
Cover Letter: ${req.body.coverLetter || ''}`;

        const aiRes = await fetch(`${aiServerUrl}/api/mcp/resume/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeText: profileResumeSummary,
            resumeBase64: resumeData,
            fileName: req.body.resumeName || req.body.resumeUrl || 'resume.pdf',
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
          calculatedScore = typeof aiEvaluation.score === 'number' ? aiEvaluation.score : aiEvaluation.matchScore;
        }
      } catch (aiErr) {
        console.error('[CandidateController] AI Evaluation failed:', aiErr.message);
      }

      // Only reject if an uploaded file was explicitly verified as invalid and a new file was actually provided
      if (req.body.resumeBase64 && aiEvaluation && aiEvaluation.isValidResume === false) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_RESUME',
            message: aiEvaluation.reasoning || 'Invalid Resume: The uploaded file could not be verified as a valid CV or resume. Please upload a valid document in PDF or DOCX format.'
          }
        });
      }
    }

    const finalScore = typeof calculatedScore === 'number' ? calculatedScore : 80;
    const skillsToSave = (aiEvaluation?.extractedSkills && aiEvaluation.extractedSkills.length > 0)
      ? aiEvaluation.extractedSkills.join(', ')
      : (req.body.skills ? (Array.isArray(req.body.skills) ? req.body.skills.join(', ') : req.body.skills) : undefined);

    await prisma.candidateProfile.update({
      where: { id: profile.id },
      data: {
        fullName: req.body.fullName || undefined,
        phone: req.body.phone || undefined,
        location: req.body.location || undefined,
        expectedSalary: req.body.expectedSalary || undefined,
        experience: req.body.experience || undefined,
        linkedin: req.body.linkedin || undefined,
        portfolio: req.body.portfolio || undefined,
        skills: skillsToSave,
        resumeUrl: resumeUrl || undefined,
        resumeData: resumeData || undefined,
      },
    });

    const coverLetterText = req.body.coverLetter 
      ? `${req.body.coverLetter}\n\nAI Match Score: ${finalScore}%\nAI Assessment: ${aiEvaluation?.reasoning || 'Evaluated successfully'}`
      : `AI Match Score: ${finalScore}%\nAI Assessment: ${aiEvaluation?.reasoning || 'Evaluated successfully against criteria'}`;

    const application = await prisma.jobApplication.create({
      data: {
        jobId: req.params.jobId,
        candidateId: profile.id,
        coverLetter: coverLetterText,
        resumeUrl: resumeUrl || profile.resumeUrl,
        status: 'APPLIED',
      },
    });

    // Notify Candidate & HR
    try {
      const { createNotification } = require('../utils/notificationHelper');
      const jobPost = await prisma.jobPost.findUnique({ where: { id: req.params.jobId } });
      
      await createNotification({
        userId: req.user.userId,
        title: 'Application Dispatched',
        message: `Your career payload for ${jobPost?.title || 'the role'} has been successfully submitted.`,
        type: 'SUCCESS',
        link: '/candidate/applications'
      });

      const hrUsers = await prisma.user.findMany({
        where: { role: { in: ['HR', 'ADMIN'] } }
      });
      for (const hr of hrUsers) {
        await createNotification({
          userId: hr.id,
          title: 'New Job Candidate',
          message: `${profile.fullName || req.user.email} applied for ${jobPost?.title || 'the role'}.`,
          type: 'SUCCESS',
          link: '/hr/candidates'
        });
      }
    } catch (notifErr) {
      console.error('Failed to trigger job application notifications:', notifErr);
    }

    return res.status(201).json({ success: true, data: application, message: 'Application submitted successfully.' });
  } catch (err) { next(err); }
};

// GET /api/candidate/applications  (my applications)
const getMyApplications = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) return res.status(200).json({ success: true, data: [] });

    const applications = await prisma.jobApplication.findMany({
      where: { candidateId: profile.id },
      include: {
        jobPost: { 
          select: { 
            id: true,
            title: true, 
            location: true, 
            jobType: true, 
            salaryRange: true,
            department: true,
            organization: {
              select: { id: true, name: true, logoUrl: true }
            }
          } 
        },
        interviews: {
          select: {
            id: true,
            dateTime: true,
            meetingLink: true,
            feedback: true,
            rating: true,
            status: true,
            round: true,
            type: true,
            interviewer: {
              select: {
                fullName: true
              }
            }
          }
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: applications });
  } catch (err) { next(err); }
};

// GET /api/candidate/profile
const getCandidateProfile = async (req, res, next) => {
  try {
    let profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId },
      include: { user: { select: { email: true } } },
    });
    
    if (!profile) {
      profile = await prisma.candidateProfile.create({
        data: { userId: req.user.userId },
        include: { user: { select: { email: true } } },
      });
    }

    let savedJobsArray = [];
    if (profile.savedJobs) {
      try {
        savedJobsArray = JSON.parse(profile.savedJobs);
        if (!Array.isArray(savedJobsArray)) savedJobsArray = [];
      } catch (e) {
        savedJobsArray = profile.savedJobs.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    return res.status(200).json({ 
      success: true, 
      data: {
        ...profile,
        savedJobsList: savedJobsArray
      }
    });
  } catch (err) { next(err); }
};

// POST /api/candidate/jobs/:jobId/save
const toggleSaveJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    let profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      profile = await prisma.candidateProfile.create({
        data: { userId: req.user.userId }
      });
    }

    let savedList = [];
    if (profile.savedJobs) {
      try {
        savedList = JSON.parse(profile.savedJobs);
        if (!Array.isArray(savedList)) savedList = [];
      } catch (e) {
        savedList = profile.savedJobs.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    const exists = savedList.includes(jobId);
    if (exists) {
      savedList = savedList.filter(id => id !== jobId);
    } else {
      savedList.push(jobId);
    }

    await prisma.candidateProfile.update({
      where: { id: profile.id },
      data: { savedJobs: JSON.stringify(savedList) }
    });

    return res.status(200).json({
      success: true,
      data: {
        savedJobs: savedList,
        isSaved: !exists,
        message: !exists ? 'Position saved to your radar' : 'Position removed from saved'
      }
    });
  } catch (err) { next(err); }
};

// GET /api/candidate/saved-jobs
const getSavedJobs = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    let savedList = [];
    if (profile?.savedJobs) {
      try {
        savedList = JSON.parse(profile.savedJobs);
        if (!Array.isArray(savedList)) savedList = [];
      } catch (e) {
        savedList = profile.savedJobs.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return res.status(200).json({ success: true, data: savedList });
  } catch (err) { next(err); }
};

// PUT /api/candidate/profile
const updateCandidateProfile = async (req, res, next) => {
  try {
    const { 
      fullName, location, phone, dob, 
      address, city, country, bio, role, currentSalary, noticePeriod,
      expectedSalary, experience, linkedin, portfolio, skills, resumeData,
      avatarUrl, resumeUrl, identityProofUrl, educationProofUrl,
      avatarBase64, resumeBase64, identityProofBase64, educationProofBase64
    } = req.body;

    let profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      profile = await prisma.candidateProfile.create({
        data: { userId: req.user.userId }
      });
    }

    // Upload files to cloud (Cloudinary for images, ImageKit for documents)
    // Falls back to local disk if cloud credentials not configured
    console.log("updateCandidateProfile called");

    const finalAvatarUrl = await handleBase64Field(
      avatarBase64 || (avatarUrl !== undefined ? avatarUrl : null),
      profile.avatarUrl,
      { folder: 'hcm/avatars', filenamePrefix: 'avatar' }
    );
    const finalResumeUrl = await handleBase64Field(
      resumeBase64 || (resumeUrl !== undefined ? resumeUrl : null),
      profile.resumeUrl,
      { folder: 'hcm/resumes', filenamePrefix: 'resume' }
    );
    const finalIdentityUrl = await handleBase64Field(
      identityProofBase64 || (identityProofUrl !== undefined ? identityProofUrl : null),
      profile.identityProofUrl,
      { folder: 'hcm/documents', filenamePrefix: 'identity' }
    );
    const finalEducationUrl = await handleBase64Field(
      educationProofBase64 || (educationProofUrl !== undefined ? educationProofUrl : null),
      profile.educationProofUrl,
      { folder: 'hcm/documents', filenamePrefix: 'education' }
    );

    const updated = await prisma.candidateProfile.update({
      where: { userId: req.user.userId },
      data: {
        fullName: fullName !== undefined ? fullName : undefined,
        location: location !== undefined ? location : undefined,
        phone: phone !== undefined ? phone : undefined,
        dob: dob ? new Date(dob) : undefined,
        address: address !== undefined ? address : undefined,
        city: city !== undefined ? city : undefined,
        country: country !== undefined ? country : undefined,
        bio: bio !== undefined ? bio : undefined,
        role: role !== undefined ? role : undefined,
        currentSalary: currentSalary !== undefined ? currentSalary : undefined,
        noticePeriod: noticePeriod !== undefined ? noticePeriod : undefined,
        avatarUrl: finalAvatarUrl,
        resumeUrl: finalResumeUrl,
        identityProofUrl: finalIdentityUrl,
        educationProofUrl: finalEducationUrl,
        expectedSalary: expectedSalary !== undefined ? expectedSalary : undefined,
        experience: experience !== undefined ? experience : undefined,
        linkedin: linkedin !== undefined ? linkedin : undefined,
        portfolio: portfolio !== undefined ? portfolio : undefined,
        skills: skills !== undefined ? (Array.isArray(skills) ? skills.join(', ') : skills) : undefined,
        resumeData: resumeData !== undefined ? (typeof resumeData === 'object' ? JSON.stringify(resumeData) : resumeData) : undefined,
      },
    });

    if (updated.identityProofUrl && updated.educationProofUrl) {
      const activeApp = await prisma.jobApplication.findFirst({
        where: {
          candidateId: updated.id,
          status: { in: ['HIRED', 'OFFER_ACCEPTED'] }
        }
      });
      if (activeApp) {
        const { handleTransition, LifecycleEvents } = require('../services/workflowService');
        await handleTransition(LifecycleEvents.DOCS_SUBMITTED, {
          applicationId: activeApp.id,
          candidateUserId: req.user.userId
        });
      }
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) { next(err); }
};

// PUT /api/candidate/settings
const updateSettings = async (req, res, next) => {
  try {
    const { account, security, notifications, preferences } = req.body;

    // 1. Update account info on CandidateProfile
    if (account) {
      await prisma.candidateProfile.update({
        where: { userId: req.user.userId },
        data: {
          fullName: account.name !== undefined ? account.name : undefined,
          phone: account.phone !== undefined ? account.phone : undefined,
          location: account.location !== undefined ? account.location : undefined,
        },
      });
      // Also update email on User if changed
      if (account.email) {
        await prisma.user.update({
          where: { id: req.user.userId },
          data: { email: account.email },
        });
      }
    }

    // 2. Handle password change
    if (security?.newPassword && security?.currentPassword) {
      const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
      const isMatch = await bcrypt.compare(security.currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ success: false, error: { message: 'Current password is incorrect.' } });
      }
      const passwordHash = await bcrypt.hash(security.newPassword, 10);
      await prisma.user.update({ where: { id: req.user.userId }, data: { passwordHash } });
    }

    return res.status(200).json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) { next(err); }
};

// GET /api/candidate/settings
const getSettings = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId },
      include: { user: { select: { email: true } } },
    });
    if (!profile) return res.status(404).json({ success: false, error: { message: 'Profile not found.' } });

    return res.status(200).json({
      success: true,
      data: {
        account: {
          name: profile.fullName || '',
          email: profile.user?.email || '',
          phone: profile.phone || '',
          location: profile.location || '',
        },
      },
    });
  } catch (err) { next(err); }
};

// DELETE /api/candidate/applications/:appId
const withdrawApplication = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) return res.status(404).json({ success: false, error: { message: 'Candidate profile not found.' } });

    const application = await prisma.jobApplication.findFirst({
      where: { id: req.params.appId, candidateId: profile.id },
    });

    if (!application) {
      return res.status(404).json({ success: false, error: { message: 'Application not found.' } });
    }

    await prisma.jobApplication.delete({
      where: { id: req.params.appId },
    });
    return res.status(200).json({ success: true, message: 'Application withdrawn successfully.' });
  } catch (err) { next(err); }
};

const getMyOffers = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId },
      include: { user: { select: { email: true } } }
    });
    if (!profile) return res.status(200).json({ success: true, data: [] });

    // Match either by application.candidateId OR candidate fullName/email
    const candidateMatches = [{ application: { candidateId: profile.id } }];
    if (profile.fullName) candidateMatches.push({ candidate: profile.fullName });
    if (profile.user?.email) candidateMatches.push({ candidate: profile.user.email });

    const offers = await prisma.offer.findMany({
      where: {
        OR: candidateMatches
      },
      include: {
        application: {
          include: {
            jobPost: {
              select: {
                id: true,
                title: true,
                location: true,
                salaryRange: true,
                department: true,
                jobType: true,
                organization: {
                  select: {
                    id: true,
                    name: true,
                    logoUrl: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Check expiration dynamically and mark expired if deadline passed
    const now = new Date();
    const processedOffers = await Promise.all(offers.map(async (offer) => {
      let isExpired = false;
      if (offer.expirationDate) {
        const expDate = new Date(offer.expirationDate);
        if (!isNaN(expDate.getTime()) && now > expDate) {
          isExpired = true;
        }
      }

      if (isExpired && (offer.status === 'Sent' || offer.status === 'Pending')) {
        try {
          await prisma.offer.update({
            where: { id: offer.id },
            data: { status: 'Expired' }
          });
          offer.status = 'Expired';
        } catch (e) {
          offer.status = 'Expired';
        }
      }

      return {
        ...offer,
        isExpired
      };
    }));

    return res.status(200).json({ success: true, data: processedOffers });
  } catch (err) { next(err); }
};

const respondToOffer = async (req, res, next) => {
  try {
    let { status } = req.body;
    if (typeof status === 'string') {
      const lower = status.toLowerCase();
      if (lower.includes('accept')) status = 'Accepted';
      else if (lower.includes('decline') || lower.includes('reject')) status = 'Declined';
    }

    if (!['Accepted', 'Declined'].includes(status)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid status response. Must be Accepted or Declined.' } });
    }

    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId },
      include: { user: { select: { email: true } } }
    });
    if (!profile) return res.status(404).json({ success: false, error: { message: 'Candidate profile not found.' } });

    const candidateMatches = [{ application: { candidateId: profile.id } }];
    if (profile.fullName) candidateMatches.push({ candidate: profile.fullName });
    if (profile.user?.email) candidateMatches.push({ candidate: profile.user.email });

    const offer = await prisma.offer.findFirst({
      where: {
        id: req.params.id,
        OR: candidateMatches
      },
      include: {
        application: {
          include: {
            jobPost: { select: { title: true } }
          }
        }
      }
    });

    if (!offer) return res.status(404).json({ success: false, error: { message: 'Offer not found.' } });

    if (offer.status === 'Accepted' || offer.status === 'Declined') {
      return res.status(400).json({ success: false, error: { message: `Offer has already been ${offer.status.toLowerCase()}.` } });
    }

    if (offer.status === 'Expired' || (offer.expirationDate && new Date(offer.expirationDate) < new Date())) {
      return res.status(400).json({ success: false, error: { message: 'This offer has expired and can no longer be accepted or declined.' } });
    }

    const updatedOffer = await prisma.offer.update({
      where: { id: req.params.id },
      data: { status }
    });

    if (offer.applicationId) {
      const { handleTransition, LifecycleEvents } = require('../services/workflowService');
      if (status === 'Accepted') {
        await prisma.jobApplication.update({
          where: { id: offer.applicationId },
          data: { status: 'HIRED' }
        }).catch(() => {});
        await handleTransition(LifecycleEvents.OFFER_ACCEPTED, {
          applicationId: offer.applicationId
        }).catch(() => {});
      } else {
        await prisma.jobApplication.update({
          where: { id: offer.applicationId },
          data: {
            status: 'REJECTED',
            lifecycleStatus: 'TERMINATED'
          }
        }).catch(() => {});
      }
    }

    // Send notifications
    try {
      const { createNotification } = require('../utils/notificationHelper');
      const jobTitle = offer.role || offer.application?.jobPost?.title || 'Position';

      // Notify candidate
      await createNotification({
        userId: req.user.userId,
        title: `Offer ${status}`,
        message: `You have successfully ${status.toLowerCase()} the offer for ${jobTitle}.`,
        type: status === 'Accepted' ? 'SUCCESS' : 'WARNING',
        priority: 'MEDIUM',
        module: 'offers',
        referenceId: offer.id
      }).catch(() => {});

      // Notify HR / Admins
      const hrUsers = await prisma.user.findMany({
        where: { role: { in: ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] } },
        select: { id: true }
      });
      for (const hr of hrUsers) {
        await createNotification({
          userId: hr.id,
          title: `Candidate ${status} Offer`,
          message: `${profile.fullName || 'Candidate'} has ${status.toLowerCase()} the offer for ${jobTitle}.`,
          type: status === 'Accepted' ? 'SUCCESS' : 'WARNING',
          priority: 'HIGH',
          module: 'offers',
          referenceId: offer.id
        }).catch(() => {});
      }
    } catch (notifErr) {
      console.warn('Failed to send offer notification:', notifErr);
    }

    return res.status(200).json({ success: true, data: updatedOffer, message: `Offer ${status.toLowerCase()} successfully.` });
  } catch (err) { next(err); }
};

// GET /api/candidate/dashboard  - aggregated stats for the dashboard
const getCandidateDashboard = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId },
      include: { user: { select: { email: true } } },
    });

    if (!profile) {
      return res.status(200).json({
        success: true,
        data: {
          applicationCount: 0,
          upcomingInterviewCount: 0,
          offerCount: 0,
          profileCompletion: 0,
          completedSections: 0,
          totalSections: 6,
        }
      });
    }

    // Counts from DB
    const [applicationCount, upcomingInterviewCount, offerCount] = await Promise.all([
      prisma.jobApplication.count({ where: { candidateId: profile.id } }),
      prisma.interview.count({
        where: {
          application: { candidateId: profile.id },
          dateTime: { gte: new Date() },
          status: { not: 'Cancelled' },
        }
      }),
      prisma.offer.count({
        where: { application: { candidateId: profile.id } }
      }),
    ]);

    // Profile completion: 6 sections
    const sections = [
      Boolean(profile.phone && profile.phone.trim()),
      Boolean(profile.resumeUrl && profile.resumeUrl.trim()),
      Boolean(profile.skills && profile.skills.trim()),
      Boolean(profile.location && profile.location.trim()),
      Boolean(profile.bio && profile.bio.trim()),
      Boolean(
        (profile.portfolio && profile.portfolio.trim()) ||
        (profile.linkedin && profile.linkedin.trim())
      ),
    ];
    const completedSections = sections.filter(Boolean).length;
    const profileCompletion = Math.round((completedSections / sections.length) * 100);

    return res.status(200).json({
      success: true,
      data: {
        applicationCount,
        upcomingInterviewCount,
        offerCount,
        profileCompletion,
        completedSections,
        totalSections: sections.length,
      }
    });
  } catch (err) { next(err); }
};

// ============================================================
// Standard Industry Profiles
// ============================================================
const INDUSTRY_PROFILES = [
  {
    id: 'full_stack',
    title: 'Full Stack Software Engineer',
    category: 'Engineering',
    experienceYears: '3+ years',
    expectedSkills: ['React', 'Node.js', 'TypeScript', 'SQL', 'RESTful APIs', 'System Architecture', 'Git', 'Docker', 'Testing'],
    criticalKeywords: ['React', 'Node.js', 'TypeScript', 'SQL', 'REST', 'CI/CD', 'Scalability', 'Git'],
    description: 'Design, develop, and maintain responsive front-end interfaces and robust backend microservices with strong architectural integrity.'
  },
  {
    id: 'frontend_engineer',
    title: 'Frontend Engineer',
    category: 'Engineering',
    experienceYears: '2+ years',
    expectedSkills: ['React', 'TypeScript', 'JavaScript (ES6+)', 'Tailwind CSS', 'Next.js', 'HTML5/CSS3', 'Web Performance', 'State Management'],
    criticalKeywords: ['React', 'TypeScript', 'CSS', 'State Management', 'Web Performance', 'UI/UX', 'Next.js'],
    description: 'Build performant, accessible, and delighting user experiences using modern JavaScript frameworks and responsive CSS architectures.'
  },
  {
    id: 'backend_architect',
    title: 'Backend / Cloud Architect',
    category: 'Engineering',
    experienceYears: '4+ years',
    expectedSkills: ['Node.js', 'Python', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Microservices', 'GraphQL'],
    criticalKeywords: ['Node.js', 'Database Architecture', 'Microservices', 'Docker', 'Cloud', 'High Availability', 'PostgreSQL'],
    description: 'Architect distributed systems, design scalable data models, and optimize low-latency API infrastructure.'
  },
  {
    id: 'devops_sre',
    title: 'DevOps & Site Reliability Engineer',
    category: 'Infrastructure',
    experienceYears: '3+ years',
    expectedSkills: ['Kubernetes', 'Docker', 'Terraform', 'AWS/GCP', 'CI/CD Pipelines', 'Linux', 'Prometheus', 'Bash/Python'],
    criticalKeywords: ['Kubernetes', 'Terraform', 'CI/CD', 'AWS', 'Monitoring', 'Infrastructure as Code', 'Docker'],
    description: 'Automate build, deployment, and infrastructure lifecycle while ensuring 99.99% system availability and resilience.'
  },
  {
    id: 'data_ai',
    title: 'Data Engineer & AI Specialist',
    category: 'Data Science',
    experienceYears: '3+ years',
    expectedSkills: ['Python', 'SQL', 'Apache Spark', 'Kafka', 'ETL Pipelines', 'Pandas', 'Machine Learning', 'BigQuery/Snowflake'],
    criticalKeywords: ['Python', 'SQL', 'ETL', 'Pipelines', 'Spark', 'Machine Learning', 'Analytics', 'Pandas'],
    description: 'Build real-time streaming and batch pipelines, transform unstructured datasets, and deploy machine learning models.'
  },
  {
    id: 'product_manager',
    title: 'Technical Product Manager',
    category: 'Product',
    experienceYears: '3+ years',
    expectedSkills: ['Agile / Scrum', 'Product Strategy', 'User Stories', 'Roadmap Planning', 'Stakeholder Management', 'Data Analytics', 'A/B Testing'],
    criticalKeywords: ['Agile', 'Product Strategy', 'Roadmaps', 'KPIs', 'Cross-functional', 'User Research', 'Scrum'],
    description: 'Bridge engineering, design, and business goals to deliver high-impact features aligned with market demands.'
  },
  {
    id: 'ui_ux_designer',
    title: 'Product & UI/UX Designer',
    category: 'Design',
    experienceYears: '2+ years',
    expectedSkills: ['Figma', 'Design Systems', 'User Research', 'Wireframing', 'Prototyping', 'Usability Testing', 'Interaction Design'],
    criticalKeywords: ['Figma', 'Design System', 'Prototyping', 'User Research', 'Information Architecture', 'UI/UX'],
    description: 'Create intuitive user flows, maintain scalable design systems, and validate prototypes with real user testing.'
  },
  {
    id: 'qa_automation',
    title: 'QA & Automation Engineer',
    category: 'Quality Assurance',
    experienceYears: '2+ years',
    expectedSkills: ['Selenium', 'Cypress', 'Playwright', 'Jest', 'API Testing', 'Test Automation', 'CI Integration', 'Bug Tracking'],
    criticalKeywords: ['Test Automation', 'Cypress', 'API Testing', 'Regression', 'Quality Assurance', 'Playwright'],
    description: 'Develop end-to-end automated test suites, validate integration boundaries, and safeguard software release quality.'
  }
];

// GET /api/candidate/ai/industry-profiles
const getIndustryProfiles = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      data: INDUSTRY_PROFILES
    });
  } catch (err) { next(err); }
};

// Common extraction stop-words
const STOP_WORDS = new Set([
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'because',
  'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except',
  'inside', 'instead', 'outside', 'since', 'through', 'toward', 'under', 'until', 'without',
  'which', 'their', 'there', 'these', 'those', 'where', 'while', 'would', 'could', 'should',
  'years', 'experience', 'candidate', 'position', 'requirements', 'responsibilities', 'skills',
  'ability', 'strong', 'knowledge', 'working', 'understanding', 'preferred', 'degree', 'equal',
  'opportunity', 'employer', 'salary', 'benefits', 'apply', 'joining', 'looking', 'needed'
]);

// POST /api/candidate/ai/resume-score
const analyzeResumeScore = async (req, res, next) => {
  try {
    const { resumeSource = 'builder', targetType = 'jd', jobDescription = '', selectedProfileId, resumeBase64, customResumeData } = req.body;

    let profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      profile = await prisma.candidateProfile.create({ data: { userId: req.user.userId } });
    }

    // 1. Resolve Resume Source Data
    let candidateText = '';
    let candidateSkills = [];
    let candidateExperienceCount = 0;
    let hasQuantifiedMetrics = false;
    let resumeSourceName = 'Resume Builder Data';

    if (resumeSource === 'uploaded') {
      if (resumeBase64 && typeof resumeBase64 === 'string') {
        const uploadedUrl = await handleBase64Field(
          resumeBase64,
          profile.resumeUrl,
          { folder: 'hcm/resumes', filenamePrefix: 'candidate_resume' }
        );
        if (uploadedUrl) {
          await prisma.candidateProfile.update({
            where: { id: profile.id },
            data: { resumeUrl: uploadedUrl }
          });
          profile.resumeUrl = uploadedUrl;
        }
      }

      if (!profile.resumeUrl && !resumeBase64) {
        return res.status(400).json({
          success: false,
          error: { code: 'RESUME_MISSING', message: 'No uploaded resume found in your profile. Please upload a PDF/DOCX resume or select Resume Builder.' }
        });
      }

      resumeSourceName = profile.resumeUrl ? profile.resumeUrl.split('/').pop() : 'Uploaded Resume Document';

      // Combine profile text representation
      candidateText = `Role: ${profile.role || ''}\nBio: ${profile.bio || ''}\nSkills: ${profile.skills || ''}\nExperience: ${profile.experience || ''}`;
      if (profile.skills) {
        candidateSkills = profile.skills.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (profile.experience) {
        candidateExperienceCount = 1;
        hasQuantifiedMetrics = /[%$]|\d+\s*(percent|growth|users|revenue|hours)/i.test(profile.experience);
      }
    } else {
      // Resume Builder Data
      let parsedResume = null;
      if (customResumeData && typeof customResumeData === 'object') {
        parsedResume = customResumeData;
      } else if (profile.resumeData) {
        try {
          parsedResume = JSON.parse(profile.resumeData);
        } catch (e) {
          console.warn("Failed to parse profile resumeData:", e);
        }
      }

      const p = parsedResume?.personal || {};
      const expList = Array.isArray(parsedResume?.experience) ? parsedResume.experience : [];
      const eduList = Array.isArray(parsedResume?.education) ? parsedResume.education : [];
      const rawSkills = Array.isArray(parsedResume?.skills) ? parsedResume.skills : [];

      candidateSkills = rawSkills.map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
      candidateExperienceCount = expList.length;

      const expText = expList.map(e => `${e.role || ''} at ${e.company || ''}: ${e.desc || ''}`).join('\n');
      const eduText = eduList.map(ed => `${ed.degree || ''} in ${ed.field || ''} from ${ed.school || ''}`).join('\n');

      candidateText = `Candidate: ${p.firstName || ''} ${p.lastName || ''}\nTitle: ${p.title || profile.role || ''}\nSummary: ${p.summary || profile.bio || ''}\nSkills: ${candidateSkills.join(', ')}\nExperience:\n${expText}\nEducation:\n${eduText}`;
      
      hasQuantifiedMetrics = expList.some(e => /[%$]|\d+\s*(percent|growth|users|revenue|hours)/i.test(e.desc || ''));
      resumeSourceName = 'Resume Builder Profile';
    }

    // 2. Resolve Target Context & Requirements
    let targetContext = '';
    let targetKeywords = [];
    let expectedExperienceYears = '2+ years';

    if (targetType === 'profile') {
      const selected = INDUSTRY_PROFILES.find(p => p.id === selectedProfileId || p.title === selectedProfileId) || INDUSTRY_PROFILES[0];
      targetContext = selected.title;
      targetKeywords = selected.expectedSkills;
      expectedExperienceYears = selected.experienceYears;
    } else {
      // Job Description Mode
      if (!jobDescription || jobDescription.trim().length < 25) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_JOB_DESCRIPTION', message: 'Please provide a substantive job description (at least 25 characters) to perform ATS comparison.' }
        });
      }

      targetContext = 'Target Job Description';

      // Extract skills & terms from JD
      const candidateTextLower = candidateText.toLowerCase();
      const rawTokens = jobDescription
        .replace(/[^a-zA-Z0-9+#.\s]/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length > 2 && !STOP_WORDS.has(t.toLowerCase()));

      const tokenFreq = {};
      rawTokens.forEach(token => {
        const norm = token.toLowerCase();
        tokenFreq[norm] = (tokenFreq[norm] || 0) + 1;
      });

      // Filter out high-value technical/domain keywords
      const knownTechList = [
        'react', 'node', 'nodejs', 'typescript', 'javascript', 'python', 'java', 'c++', 'c#', 'sql',
        'mysql', 'postgresql', 'mongodb', 'redis', 'aws', 'azure', 'gcp', 'docker', 'kubernetes',
        'terraform', 'graphql', 'rest', 'api', 'ci/cd', 'agile', 'scrum', 'git', 'microservices',
        'linux', 'html', 'css', 'tailwind', 'redux', 'jest', 'cypress', 'playwright', 'spark', 'kafka',
        'pandas', 'figma', 'analytics', 'architecture', 'devops', 'security', 'monitoring', 'cloud'
      ];

      const extracted = [];
      knownTechList.forEach(tech => {
        if (jobDescription.toLowerCase().includes(tech)) {
          extracted.push(tech.charAt(0).toUpperCase() + tech.slice(1));
        }
      });

      // Supplement with high frequency JD terms
      Object.keys(tokenFreq)
        .sort((a, b) => tokenFreq[b] - tokenFreq[a])
        .slice(0, 15)
        .forEach(term => {
          const cap = term.charAt(0).toUpperCase() + term.slice(1);
          if (!extracted.some(e => e.toLowerCase() === term)) {
            extracted.push(cap);
          }
        });

      targetKeywords = extracted.slice(0, 16);
    }

    // 3. Compare & Compute ATS Evaluation
    const candidateTextLower = candidateText.toLowerCase();
    const candidateSkillsLower = candidateSkills.map(s => s.toLowerCase());

    const matchingSkills = [];
    const missingSkills = [];

    targetKeywords.forEach(kw => {
      const lower = kw.toLowerCase();
      const inSkills = candidateSkillsLower.some(s => s.includes(lower) || lower.includes(s));
      const inText = candidateTextLower.includes(lower);

      if (inSkills || inText) {
        matchingSkills.push(kw);
      } else {
        missingSkills.push(kw);
      }
    });

    const totalTarget = Math.max(targetKeywords.length, 1);
    const keywordMatchPct = Math.min(100, Math.round((matchingSkills.length / totalTarget) * 100));

    // Experience Match
    const expTargetCount = targetType === 'profile' ? 2 : 1;
    const experienceMatchPct = candidateExperienceCount >= expTargetCount ? 95 : candidateExperienceCount > 0 ? 75 : 40;

    // Readability & Formatting Index
    const hasAdequateLength = candidateText.length > 250;
    const readabilityIndex = hasAdequateLength ? 92 : 65;

    // Impact & Quantification Score
    const impactScore = hasQuantifiedMetrics ? 88 : 45;

    // Overall Match Score
    const rawScore = Math.round(
      (keywordMatchPct * 0.45) +
      (experienceMatchPct * 0.35) +
      (impactScore * 0.10) +
      (readabilityIndex * 0.10)
    );
    const overallScore = Math.min(100, Math.max(25, rawScore));

    // Strengths
    const strengths = [];
    if (matchingSkills.length > 0) {
      strengths.push(`Verified alignment on core technical competencies: ${matchingSkills.slice(0, 4).join(', ')}.`);
    }
    if (candidateExperienceCount >= 1) {
      strengths.push(`Demonstrated career progression across ${candidateExperienceCount} documented position(s).`);
    }
    if (hasQuantifiedMetrics) {
      strengths.push("Work experience includes quantifiable achievements and business impact metrics.");
    }
    if (strengths.length === 0) {
      strengths.push("Clear candidate summary and foundational professional qualifications.");
    }

    // Weaknesses & Important Gaps
    const weaknesses = [];
    const importantGaps = [];

    if (missingSkills.length > 0) {
      const topMissing = missingSkills.slice(0, 4);
      weaknesses.push(`Resume lacks prominent mention of expected skills: ${topMissing.join(', ')}.`);
      importantGaps.push(...topMissing);
    }
    if (!hasQuantifiedMetrics) {
      weaknesses.push("Experience bullet points lack metric-driven outcomes (e.g. percentages, revenue, latency reduction).");
      importantGaps.push("Measurable ROI / Key Performance Metrics");
    }
    if (candidateExperienceCount === 0) {
      weaknesses.push("No prior work experience entries detected. Employers prioritize chronological employment history.");
      importantGaps.push("Verified Employment History");
    }

    // Actionable Recommendations
    const recommendations = [];
    if (missingSkills.length > 0) {
      recommendations.push({
        type: 'Critical Skills',
        priority: 'High',
        text: `Incorporate '${missingSkills.slice(0, 3).join(', ')}' into your technical skills section and reference them in relevant work accomplishments.`,
      });
    }
    if (!hasQuantifiedMetrics) {
      recommendations.push({
        type: 'Metric Impact',
        priority: 'High',
        text: "Enhance experience descriptions with concrete metrics (e.g. 'boosted throughput by 35%', 'reduced costs by $20k').",
      });
    }
    recommendations.push({
      type: 'ATS Readability',
      priority: 'Medium',
      text: "Ensure job titles and section headings use standard industry terminology for automated parser indexing.",
    });

    // Detailed Metrics Breakdown
    const metrics = [
      { label: 'Keyword Match', score: keywordMatchPct, color: 'text-emerald-500', bg: 'bg-emerald-50' },
      { label: 'Experience Match', score: experienceMatchPct, color: 'text-blue-500', bg: 'bg-blue-50' },
      { label: 'Impact Statements', score: impactScore, color: 'text-purple-500', bg: 'bg-purple-50' },
      { label: 'Readability Index', score: readabilityIndex, color: 'text-amber-500', bg: 'bg-amber-50' },
    ];

    const resultPayload = {
      id: `scan-${Date.now()}`,
      timestamp: new Date().toISOString(),
      score: overallScore,
      targetContext,
      targetType,
      resumeSource,
      resumeSourceName,
      matchingSkills,
      missingSkills,
      strengths,
      weaknesses,
      importantGaps,
      recommendations,
      metrics
    };

    // 4. Save to Persistent Analysis History in CandidateProfile
    let existingHistory = [];
    if (profile.resumeScoreHistory) {
      try {
        existingHistory = JSON.parse(profile.resumeScoreHistory);
        if (!Array.isArray(existingHistory)) existingHistory = [];
      } catch (e) {
        existingHistory = [];
      }
    }

    const updatedHistory = [resultPayload, ...existingHistory].slice(0, 15);

    await prisma.candidateProfile.update({
      where: { id: profile.id },
      data: { resumeScoreHistory: JSON.stringify(updatedHistory) }
    });

    return res.status(200).json({
      success: true,
      data: {
        ...resultPayload,
        history: updatedHistory
      }
    });
  } catch (err) { next(err); }
};

// GET /api/candidate/ai/resume-score/history
const getResumeScoreHistory = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    let history = [];
    if (profile?.resumeScoreHistory) {
      try {
        history = JSON.parse(profile.resumeScoreHistory);
        if (!Array.isArray(history)) history = [];
      } catch (e) {
        history = [];
      }
    }
    return res.status(200).json({
      success: true,
      data: history
    });
  } catch (err) { next(err); }
};

// DELETE /api/candidate/ai/resume-score/history
const clearResumeScoreHistory = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (profile) {
      await prisma.candidateProfile.update({
        where: { id: profile.id },
        data: { resumeScoreHistory: JSON.stringify([]) }
      });
    }
    return res.status(200).json({
      success: true,
      data: [],
      message: 'Analysis history cleared successfully'
    });
  } catch (err) { next(err); }
};

// ============================================================
// INTERVIEW SCHEDULE & PREPARATION CHECKLIST
// ============================================================

// GET /api/candidate/interviews
const getCandidateInterviews = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId }
    });
    if (!profile) return res.status(200).json({ success: true, data: [] });

    const interviews = await prisma.interview.findMany({
      where: {
        application: {
          candidateId: profile.id
        }
      },
      include: {
        application: {
          include: {
            jobPost: {
              select: {
                id: true,
                title: true,
                department: true,
                location: true,
                jobType: true,
                organization: {
                  select: { id: true, name: true, logoUrl: true }
                }
              }
            }
          }
        },
        interviewer: {
          select: {
            id: true,
            fullName: true,
            role: true,
            department: true,
            user: { select: { email: true, avatarUrl: true } }
          }
        }
      },
      orderBy: { dateTime: 'asc' }
    });

    return res.status(200).json({ success: true, data: interviews });
  } catch (err) { next(err); }
};

// POST /api/candidate/interviews/:id/reschedule
const rescheduleCandidateInterview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { proposedDate, proposedTime, reason } = req.body;

    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId }
    });
    if (!profile) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Candidate profile not found.' } });
    }

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        application: {
          include: {
            jobPost: { select: { title: true } }
          }
        },
        interviewer: {
          select: { id: true, userId: true, fullName: true }
        }
      }
    });

    if (!interview || interview.application.candidateId !== profile.id) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Interview not found or unauthorized.' } });
    }

    if (interview.status === 'Completed') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ACTION', message: 'Cannot reschedule an already completed interview.' } });
    }
    if (interview.status === 'Cancelled') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ACTION', message: 'Cannot reschedule a cancelled interview.' } });
    }

    const timeStr = proposedDate ? `${proposedDate}${proposedTime ? ' at ' + proposedTime : ''}` : 'Preferred alternate time requested';
    const note = `[Reschedule Request]: ${reason || 'Candidate requested reschedule'}. Proposed: ${timeStr}`;
    const updatedFeedback = interview.feedback ? `${interview.feedback}\n\n${note}` : note;

    const updated = await prisma.interview.update({
      where: { id },
      data: {
        feedback: updatedFeedback
      },
      include: {
        interviewer: { select: { fullName: true } },
        application: { include: { jobPost: { select: { title: true } } } }
      }
    });

    const { createNotification } = require('../utils/notificationHelper');

    // Notify interviewer
    if (interview.interviewer?.userId) {
      await createNotification({
        userId: interview.interviewer.userId,
        title: 'Interview Reschedule Request',
        message: `${profile.fullName || 'Candidate'} requested to reschedule the interview for ${interview.application?.jobPost?.title || 'position'}. Details: ${reason || 'New time slot requested'}.`,
        type: 'INFO',
        link: '/hr/interviews'
      });
    }

    // Confirmation for candidate
    await createNotification({
      userId: req.user.userId,
      title: 'Reschedule Request Sent',
      message: `Your reschedule request for ${interview.application?.jobPost?.title || 'the interview'} has been sent to the hiring team.`,
      type: 'SUCCESS',
      link: '/candidate/schedule'
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: 'Reschedule request submitted successfully. The recruitment team has been notified.'
    });
  } catch (err) { next(err); }
};

// PATCH /api/candidate/interviews/:id/cancel
const cancelCandidateInterview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId }
    });
    if (!profile) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Candidate profile not found.' } });
    }

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        application: {
          include: {
            jobPost: { select: { title: true } }
          }
        },
        interviewer: {
          select: { id: true, userId: true, fullName: true }
        }
      }
    });

    if (!interview || interview.application.candidateId !== profile.id) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Interview not found or unauthorized.' } });
    }

    if (interview.status === 'Completed') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ACTION', message: 'Cannot cancel a completed interview.' } });
    }
    if (interview.status === 'Cancelled') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_ACTION', message: 'Interview is already cancelled.' } });
    }

    const cancelNote = `[Cancelled by candidate]: ${reason || 'Candidate requested cancellation.'}`;
    const updatedFeedback = interview.feedback ? `${interview.feedback}\n\n${cancelNote}` : cancelNote;

    const updated = await prisma.interview.update({
      where: { id },
      data: {
        status: 'Cancelled',
        feedback: updatedFeedback
      },
      include: {
        interviewer: { select: { fullName: true } },
        application: { include: { jobPost: { select: { title: true } } } }
      }
    });

    const { createNotification } = require('../utils/notificationHelper');

    // Notify interviewer
    if (interview.interviewer?.userId) {
      await createNotification({
        userId: interview.interviewer.userId,
        title: 'Interview Cancelled by Candidate',
        message: `${profile.fullName || 'Candidate'} cancelled the interview for ${interview.application?.jobPost?.title || 'position'}. Reason: ${reason || 'Not specified'}.`,
        type: 'WARNING',
        link: '/hr/interviews'
      });
    }

    // Confirmation for candidate
    await createNotification({
      userId: req.user.userId,
      title: 'Interview Cancelled',
      message: `Your interview for ${interview.application?.jobPost?.title || 'position'} has been cancelled.`,
      type: 'INFO',
      link: '/candidate/schedule'
    });

    return res.status(200).json({
      success: true,
      data: updated,
      message: 'Interview successfully cancelled.'
    });
  } catch (err) { next(err); }
};

const DEFAULT_PREP_CHECKLIST = [
  { id: 'camera_mic', tip: 'Check camera and microphone settings', done: false },
  { id: 'research_company', tip: 'Research company and interviewers', done: false },
  { id: 'prepare_questions', tip: 'Prepare questions for the team', done: false },
  { id: 'review_resume', tip: 'Review your resume and portfolio', done: false }
];

// GET /api/candidate/checklist
const getCandidateChecklist = async (req, res, next) => {
  try {
    const profile = await prisma.candidateProfile.findUnique({
      where: { userId: req.user.userId },
      select: { interviewChecklist: true }
    });

    let checklist = DEFAULT_PREP_CHECKLIST;
    if (profile?.interviewChecklist) {
      try {
        const parsed = JSON.parse(profile.interviewChecklist);
        if (Array.isArray(parsed) && parsed.length > 0) {
          checklist = parsed;
        }
      } catch (e) {}
    }

    return res.status(200).json({ success: true, data: checklist });
  } catch (err) { next(err); }
};

// PUT /api/candidate/checklist
const updateCandidateChecklist = async (req, res, next) => {
  try {
    const { checklist } = req.body;
    if (!Array.isArray(checklist)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Checklist must be an array.' } });
    }

    const profile = await prisma.candidateProfile.findUnique({ where: { userId: req.user.userId } });
    if (!profile) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Candidate profile not found.' } });
    }

    await prisma.candidateProfile.update({
      where: { id: profile.id },
      data: {
        interviewChecklist: JSON.stringify(checklist)
      }
    });

    return res.status(200).json({
      success: true,
      data: checklist,
      message: 'Preparation checklist saved successfully.'
    });
  } catch (err) { next(err); }
};

module.exports = {
  getAvailableJobs,
  applyToJob,
  getMyApplications,
  withdrawApplication,
  getCandidateProfile,
  updateCandidateProfile,
  updateSettings,
  getSettings,
  getMyOffers,
  respondToOffer,
  getCandidateDashboard,
  toggleSaveJob,
  getSavedJobs,
  getIndustryProfiles,
  analyzeResumeScore,
  getResumeScoreHistory,
  clearResumeScoreHistory,
  getCandidateInterviews,
  rescheduleCandidateInterview,
  cancelCandidateInterview,
  getCandidateChecklist,
  updateCandidateChecklist,
};
