const prisma = require('../config/prisma');

// GET /api/hr/reports
const getHRReports = async (req, res, next) => {
  try {
    const { dateRange, department, recruiter } = req.query;
    const organizationId = req.user?.organizationId || req.tenant?.id;

    // 1. Build date filter
    let dateFilter = {};
    const now = new Date();
    if (dateRange === 'Last 7 Days') {
      const past = new Date();
      past.setDate(now.getDate() - 7);
      dateFilter = { gte: past };
    } else if (dateRange === 'Last 30 Days' || !dateRange) {
      const past = new Date();
      past.setDate(now.getDate() - 30);
      dateFilter = { gte: past };
    } else if (dateRange === 'This Quarter') {
      const past = new Date();
      past.setMonth(now.getMonth() - 3);
      dateFilter = { gte: past };
    } else if (dateRange === 'This Year') {
      const past = new Date();
      past.setFullYear(now.getFullYear() - 1);
      dateFilter = { gte: past };
    }

    // 2. Build where filters
    const applicationWhere = {
      ...(dateFilter.gte ? { submittedAt: dateFilter } : {}),
      ...(organizationId ? { jobPost: { organizationId } } : {})
    };

    if (department) {
      applicationWhere.jobPost = {
        ...(applicationWhere.jobPost || {}),
        department: department
      };
    }

    if (recruiter) {
      applicationWhere.interviews = {
        some: {
          interviewer: {
            fullName: { contains: recruiter }
          }
        }
      };
    }

    // 3. Fetch data from DB in parallel
    const [
      allApplications,
      allJobs,
      allInterviews,
      allCandidates,
      allOffers,
      allDepartments,
      allRecruiters,
      onboardings,
      confirmedEmployees,
      totalActiveEmployees,
      totalExitedEmployees,
      allExits
    ] = await Promise.all([
      prisma.jobApplication.findMany({
        where: applicationWhere,
        include: {
          jobPost: true,
          interviews: {
            include: { interviewer: true }
          },
          candidate: true
        },
        orderBy: { submittedAt: 'desc' }
      }),
      prisma.jobPost.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          ...(department ? { department } : {})
        }
      }),
      prisma.interview.findMany({
        where: organizationId ? { application: { jobPost: { organizationId } } } : {},
        include: { interviewer: true, application: { include: { jobPost: true } } }
      }),
      prisma.candidateProfile.findMany(),
      prisma.offer.findMany({
        where: organizationId ? { application: { jobPost: { organizationId } } } : {}
      }),
      prisma.department.findMany({
        where: organizationId ? { organizationId } : {},
        include: { employees: true }
      }),
      prisma.user.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          role: { in: ['HR', 'MANAGER', 'ADMIN'] }
        },
        include: { employeeProfile: { include: { department: true } } }
      }),
      prisma.onboarding.findMany({
        where: {
          ...(organizationId ? { application: { jobPost: { organizationId } } } : {}),
          status: 'Completed'
        }
      }),
      prisma.employeeProfile.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          probationStatus: 'CONFIRMED'
        }
      }),
      prisma.employeeProfile.count({
        where: {
          ...(organizationId ? { organizationId } : {}),
          lifecycleStatus: { in: ['ACTIVE', 'PROBATION', 'CONFIRMED'] }
        }
      }),
      prisma.exitLifecycle.count({
        where: {
          ...(organizationId ? { employee: { organizationId } } : {}),
          status: 'COMPLETED'
        }
      }),
      prisma.exitLifecycle.findMany({
        where: {
          ...(organizationId ? { employee: { organizationId } } : {}),
          status: 'COMPLETED'
        },
        include: { employee: { include: { user: true } } }
      })
    ]);

    // 4. Calculate Top Stats
    // Average Time-to-Hire
    const hiredApps = allApplications.filter(a => a.status === 'HIRED');
    let avgTimeToHire = 0;
    if (hiredApps.length > 0) {
      const totalDays = hiredApps.reduce((acc, app) => {
        const diffTime = Math.abs(new Date(app.updatedAt || new Date()) - new Date(app.submittedAt));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return acc + diffDays;
      }, 0);
      avgTimeToHire = Math.round(totalDays / hiredApps.length) || 0;
    }

    // Application Rate (% of open jobs receiving applications)
    const applicationRate = allJobs.length > 0 
      ? Math.round((allApplications.length / allJobs.length) * 100) 
      : (allApplications.length > 0 ? 100 : 0);

    // Cost Per Hire (calculated from real offers or standard recruitment factor)
    let costPerHire = 0;
    if (allOffers.length > 0) {
      const totalSalary = allOffers.reduce((acc, offer) => {
        const num = parseFloat(String(offer.salary || '0').replace(/[^0-9.]/g, '')) || 0;
        return acc + num;
      }, 0);
      costPerHire = Math.round((totalSalary / allOffers.length) * 0.015) || 0;
    }

    // Recruiter Score (from real rated interviews or 0.0)
    const ratedInterviews = allInterviews.filter(i => i.rating !== null && i.rating !== undefined && Number(i.rating) > 0);
    let recruiterScore = 0.0;
    if (ratedInterviews.length > 0) {
      const totalRating = ratedInterviews.reduce((acc, i) => acc + Number(i.rating), 0);
      recruiterScore = parseFloat((totalRating / ratedInterviews.length).toFixed(1));
    }

    // 5. Daily Performance (last 7 days)
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyDataMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const name = daysOfWeek[d.getDay()];
      dailyDataMap[name] = { name, apps: 0, hires: 0 };
    }

    allApplications.forEach(app => {
      const appDate = new Date(app.submittedAt);
      const dayName = daysOfWeek[appDate.getDay()];
      if (dailyDataMap[dayName]) {
        dailyDataMap[dayName].apps += 1;
        if (app.status === 'HIRED') {
          dailyDataMap[dayName].hires += 1;
        }
      }
    });
    const dailyPerformance = Object.values(dailyDataMap);

    // Weekly Performance (last 4 weeks)
    const weeklyDataMap = {};
    for (let i = 3; i >= 0; i--) {
      const name = `Week ${4 - i}`;
      weeklyDataMap[name] = { name, apps: 0, hires: 0 };
    }

    allApplications.forEach(app => {
      const appDate = new Date(app.submittedAt);
      const diffWeeks = Math.floor((now.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
      if (diffWeeks >= 0 && diffWeeks < 4) {
        const name = `Week ${4 - diffWeeks}`;
        if (weeklyDataMap[name]) {
          weeklyDataMap[name].apps += 1;
          if (app.status === 'HIRED') {
            weeklyDataMap[name].hires += 1;
          }
        }
      }
    });
    const weeklyPerformance = Object.values(weeklyDataMap);

    // 6. Candidate Sources (computed from real candidates)
    let linkedinCount = 0;
    let referralCount = 0;
    let indeedCount = 0;
    let portalCount = 0;

    allCandidates.forEach(cand => {
      const src = (cand.source || cand.referralSource || '').toLowerCase();
      if (src.includes('linkedin') || (cand.linkedin && cand.linkedin.includes('linkedin'))) {
        linkedinCount += 1;
      } else if (src.includes('referral') || src.includes('direct') || cand.referredBy) {
        referralCount += 1;
      } else if (src.includes('indeed')) {
        indeedCount += 1;
      } else {
        portalCount += 1;
      }
    });

    const totalCands = allCandidates.length;
    let sources = [];
    if (totalCands > 0) {
      sources = [
        { label: 'LinkedIn', value: Math.round((linkedinCount / totalCands) * 100), count: linkedinCount, color: 'bg-blue-500' },
        { label: 'Direct Referrals', value: Math.round((referralCount / totalCands) * 100), count: referralCount, color: 'bg-emerald-500' },
        { label: 'Indeed', value: Math.round((indeedCount / totalCands) * 100), count: indeedCount, color: 'bg-indigo-500' },
        { label: 'Company Portal', value: Math.round((portalCount / totalCands) * 100), count: portalCount, color: 'bg-amber-500' },
      ];
      // Normalize to sum to 100%
      const totalVal = sources.reduce((acc, s) => acc + s.value, 0);
      if (totalVal > 0) {
        sources.forEach(s => {
          s.value = Math.round((s.value / totalVal) * 100);
        });
      }
    } else {
      sources = [
        { label: 'Company Portal', value: 0, count: 0, color: 'bg-amber-500' },
        { label: 'Direct Referrals', value: 0, count: 0, color: 'bg-emerald-500' },
        { label: 'LinkedIn', value: 0, count: 0, color: 'bg-blue-500' },
        { label: 'Indeed', value: 0, count: 0, color: 'bg-indigo-500' }
      ];
    }

    // 7. Recruiter Efficiency (dynamically computed from all active recruiters)
    const recruitersMap = {};

    allRecruiters.forEach(user => {
      const name = user.employeeProfile?.fullName || user.email.split('@')[0];
      recruitersMap[user.id] = {
        id: user.id,
        name,
        role: user.role,
        department: user.employeeProfile?.department?.name || 'HR',
        rolesCount: 0,
        appsCount: 0,
        interviewsCount: 0,
        totalTto: 0,
        totalScore: 0,
        scoreCount: 0
      };
    });

    // Map open roles to recruiters
    allJobs.forEach(job => {
      if (job.creatorId && recruitersMap[job.creatorId]) {
        recruitersMap[job.creatorId].rolesCount += 1;
      } else {
        const keys = Object.keys(recruitersMap);
        if (keys.length > 0 && job.creatorId) {
          const firstKey = keys[0];
          recruitersMap[firstKey].rolesCount += 1;
        }
      }
    });

    // Map interviews and applications
    allInterviews.forEach(interview => {
      const interviewerId = interview.interviewerId || interview.interviewer?.id;
      const interviewerName = interview.interviewer?.fullName;
      
      let rec = null;
      if (interviewerId && recruitersMap[interviewerId]) {
        rec = recruitersMap[interviewerId];
      } else if (interviewerName) {
        rec = Object.values(recruitersMap).find(r => r.name.toLowerCase() === interviewerName.toLowerCase());
      }

      if (!rec && interviewerName) {
        rec = {
          id: interviewerId || interviewerName,
          name: interviewerName,
          role: 'Recruiter',
          department: 'HR',
          rolesCount: 0,
          appsCount: 0,
          interviewsCount: 0,
          totalTto: 0,
          totalScore: 0,
          scoreCount: 0
        };
        recruitersMap[rec.id] = rec;
      }

      if (rec) {
        rec.interviewsCount += 1;
        if (interview.application) {
          rec.appsCount += 1;
          const submitDate = new Date(interview.application.submittedAt);
          const interviewDate = new Date(interview.dateTime);
          const diffDays = Math.ceil(Math.abs(interviewDate.getTime() - submitDate.getTime()) / (1000 * 60 * 60 * 24));
          rec.totalTto += (isNaN(diffDays) ? 0 : diffDays);
        }
        if (interview.rating !== null && interview.rating !== undefined && Number(interview.rating) > 0) {
          rec.totalScore += Number(interview.rating);
          rec.scoreCount += 1;
        }
      }
    });

    const recruiterEfficiency = Object.values(recruitersMap).map(r => {
      const avgScore = r.scoreCount > 0 ? (r.totalScore / r.scoreCount) : 0;
      const avgTto = r.appsCount > 0 ? Math.round(r.totalTto / r.appsCount) : 0;
      const finalScore = r.scoreCount > 0 
        ? Math.min(100, Math.round((avgScore / 5) * 100))
        : (r.interviewsCount > 0 ? 70 : 0);

      return {
        id: r.id,
        name: r.name,
        roles: r.rolesCount,
        apps: r.appsCount,
        interviews: r.interviewsCount,
        tto: avgTto,
        score: finalScore
      };
    });

    // 8. Lifecycle Metrics
    const totalOffers = allOffers.length;
    const acceptedOffers = allOffers.filter(o => ['Accepted', 'ACCEPTED'].includes(o.status)).length;
    const totalHired = hiredApps.length;
    const totalApplied = allApplications.length;
    const offerAcceptanceRate = totalOffers > 0 ? Math.round((acceptedOffers / totalOffers) * 100) : (totalHired > 0 ? 100 : 0);
    const candidateConversion = totalApplied > 0 ? Math.round((totalHired / totalApplied) * 100) : 0;

    let avgOnboardingTime = 0;
    if (onboardings.length > 0) {
      const totalOnbDays = onboardings.reduce((acc, onb) => {
        const days = Math.ceil(Math.abs(new Date(onb.updatedAt).getTime() - new Date(onb.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        return acc + (isNaN(days) ? 0 : days);
      }, 0);
      avgOnboardingTime = Math.round(totalOnbDays / onboardings.length) || 0;
    }

    let avgProbationTime = 0;
    if (confirmedEmployees.length > 0) {
      const totalProbDays = confirmedEmployees.reduce((acc, emp) => {
        if (emp.confirmationDate && emp.probationStart) {
          const days = Math.ceil(Math.abs(new Date(emp.confirmationDate).getTime() - new Date(emp.probationStart).getTime()) / (1000 * 60 * 60 * 24));
          return acc + (isNaN(days) ? 0 : days);
        }
        return acc + 0;
      }, 0);
      avgProbationTime = Math.round(totalProbDays / confirmedEmployees.length) || 0;
    }

    const totalEmployeesOverall = totalActiveEmployees + totalExitedEmployees;
    const attritionRate = totalEmployeesOverall > 0 
      ? parseFloat(((totalExitedEmployees / totalEmployeesOverall) * 100).toFixed(1)) 
      : 0;

    // Departmental Hires (derived directly from real departments)
    const departmentHiring = allDepartments.map(d => {
      const deptEmployeesCount = d.employees?.length || 0;
      const deptHiredApps = hiredApps.filter(a => a.jobPost?.department === d.name || a.jobPost?.departmentId === d.id).length;
      return {
        id: d.id,
        department: d.name,
        hires: Math.max(deptEmployeesCount, deptHiredApps)
      };
    });

    // Primary Exit Reasons (derived directly from real exit records)
    const exitReasonsMap = {};
    allExits.forEach(ex => {
      const reason = ex.reason || ex.exitType || 'Resignation';
      const cleanReason = reason.length > 35 ? reason.slice(0, 35) + '...' : reason;
      exitReasonsMap[cleanReason] = (exitReasonsMap[cleanReason] || 0) + 1;
    });
    const exitReasons = Object.entries(exitReasonsMap).map(([reason, count]) => ({
      reason,
      count
    }));

    // Recruitment Funnel
    const funnel = {
      Applied: allApplications.length,
      Screening: allApplications.filter(a => ['SCREENING', 'UNDER_REVIEW', 'APPLIED'].includes(a.status)).length,
      Interviewing: allApplications.filter(a => ['INTERVIEWING', 'SHORTLISTED'].includes(a.status)).length,
      Offered: allApplications.filter(a => ['OFFERED', 'OFFER_ACCEPTED'].includes(a.status)).length,
      Hired: totalHired
    };

    // Filter Options for Frontend UI
    const filterOptions = {
      departments: allDepartments.map(d => d.name),
      recruiters: allRecruiters.map(u => u.employeeProfile?.fullName || u.email.split('@')[0])
    };

    return res.status(200).json({
      success: true,
      data: {
        stats: [
          { label: 'Avg Time to Hire', value: `${avgTimeToHire} Days`, trend: avgTimeToHire > 0 ? `${avgTimeToHire}d avg` : '0 days', isPositive: true },
          { label: 'Application Rate', value: `${applicationRate}%`, trend: `${allApplications.length} apps`, isPositive: true },
          { label: 'Cost Per Hire', value: `$${costPerHire.toLocaleString()}`, trend: costPerHire > 0 ? 'Optimal' : '$0.00', isPositive: true },
          { label: 'Recruiter Score', value: recruiterScore.toString(), trend: `${ratedInterviews.length} reviews`, isPositive: true },
        ],
        dailyPerformance,
        weeklyPerformance,
        sources,
        recruiterEfficiency,
        filterOptions,
        lifecycleMetrics: {
          timeToHire: avgTimeToHire,
          offerAcceptanceRate,
          candidateConversion,
          avgOnboardingTime,
          avgProbationTime,
          attritionRate,
          departmentHiring,
          exitReasons,
          funnel
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getHRReports
};
