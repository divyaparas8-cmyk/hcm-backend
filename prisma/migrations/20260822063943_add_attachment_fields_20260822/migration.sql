/*
  Warnings:

  - You are about to drop the `AttendanceLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BenefitClaim` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CandidateProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Interview` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobApplication` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobPost` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LeaveRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Organization` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Payslip` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PerformanceGoal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SupportTicket` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Task` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TicketMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `AttendanceLog` DROP FOREIGN KEY `AttendanceLog_userId_fkey`;

-- DropForeignKey
ALTER TABLE `AuditLog` DROP FOREIGN KEY `AuditLog_userId_fkey`;

-- DropForeignKey
ALTER TABLE `BenefitClaim` DROP FOREIGN KEY `BenefitClaim_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `CandidateProfile` DROP FOREIGN KEY `CandidateProfile_userId_fkey`;

-- DropForeignKey
ALTER TABLE `EmployeeProfile` DROP FOREIGN KEY `EmployeeProfile_managerId_fkey`;

-- DropForeignKey
ALTER TABLE `EmployeeProfile` DROP FOREIGN KEY `EmployeeProfile_userId_fkey`;

-- DropForeignKey
ALTER TABLE `Interview` DROP FOREIGN KEY `Interview_applicationId_fkey`;

-- DropForeignKey
ALTER TABLE `Interview` DROP FOREIGN KEY `Interview_interviewerId_fkey`;

-- DropForeignKey
ALTER TABLE `JobApplication` DROP FOREIGN KEY `JobApplication_candidateId_fkey`;

-- DropForeignKey
ALTER TABLE `JobApplication` DROP FOREIGN KEY `JobApplication_jobId_fkey`;

-- DropForeignKey
ALTER TABLE `LeaveRequest` DROP FOREIGN KEY `LeaveRequest_userId_fkey`;

-- DropForeignKey
ALTER TABLE `Payslip` DROP FOREIGN KEY `Payslip_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `PerformanceGoal` DROP FOREIGN KEY `PerformanceGoal_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `SupportTicket` DROP FOREIGN KEY `SupportTicket_userId_fkey`;

-- DropForeignKey
ALTER TABLE `Task` DROP FOREIGN KEY `Task_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `TicketMessage` DROP FOREIGN KEY `TicketMessage_senderId_fkey`;

-- DropForeignKey
ALTER TABLE `TicketMessage` DROP FOREIGN KEY `TicketMessage_ticketId_fkey`;

-- DropForeignKey
ALTER TABLE `User` DROP FOREIGN KEY `User_organizationId_fkey`;

-- DropForeignKey
ALTER TABLE `department` DROP FOREIGN KEY `Department_organizationId_fkey`;

-- DropTable
DROP TABLE `AttendanceLog`;

-- DropTable
DROP TABLE `AuditLog`;

-- DropTable
DROP TABLE `BenefitClaim`;

-- DropTable
DROP TABLE `CandidateProfile`;

-- DropTable
DROP TABLE `EmployeeProfile`;

-- DropTable
DROP TABLE `Interview`;

-- DropTable
DROP TABLE `JobApplication`;

-- DropTable
DROP TABLE `JobPost`;

-- DropTable
DROP TABLE `LeaveRequest`;

-- DropTable
DROP TABLE `Organization`;

-- DropTable
DROP TABLE `Payslip`;

-- DropTable
DROP TABLE `PerformanceGoal`;

-- DropTable
DROP TABLE `SupportTicket`;

-- DropTable
DROP TABLE `Task`;

-- DropTable
DROP TABLE `TicketMessage`;

-- DropTable
DROP TABLE `User`;

-- CreateTable
CREATE TABLE `organization` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NULL,
    `websiteUrl` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `companySize` VARCHAR(191) NULL,
    `logoUrl` LONGTEXT NULL,
    `address` VARCHAR(191) NULL,
    `taxId` VARCHAR(191) NULL,
    `primaryEmail` VARCHAR(191) NULL,
    `supportPhone` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `pricingPlanId` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'CANDIDATE') NOT NULL DEFAULT 'EMPLOYEE',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `customRoleId` VARCHAR(191) NULL,

    UNIQUE INDEX `user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeprofile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `dob` DATETIME(3) NULL,
    `gender` VARCHAR(191) NULL,
    `bloodGroup` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `joiningDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `employmentType` VARCHAR(191) NOT NULL DEFAULT 'Full-time',
    `avatarUrl` TEXT NULL,
    `bio` TEXT NULL,
    `language` VARCHAR(191) NULL DEFAULT 'English (US)',
    `timezone` VARCHAR(191) NULL DEFAULT 'UTC+00:00 (London)',
    `dateFormat` VARCHAR(191) NULL DEFAULT 'MM/DD/YYYY',
    `emailNotif` BOOLEAN NOT NULL DEFAULT true,
    `pushNotif` BOOLEAN NOT NULL DEFAULT true,
    `weeklySummary` BOOLEAN NOT NULL DEFAULT true,
    `emergencyName` VARCHAR(191) NULL,
    `emergencyPhone` VARCHAR(191) NULL,
    `emergencyRelation` VARCHAR(191) NULL,
    `departmentId` VARCHAR(191) NULL,
    `managerId` VARCHAR(191) NULL,
    `applicationId` VARCHAR(191) NULL,
    `probationStart` DATETIME(3) NULL,
    `probationEnd` DATETIME(3) NULL,
    `probationReviewDate` DATETIME(3) NULL,
    `probationExtension` INTEGER NULL,
    `confirmationDate` DATETIME(3) NULL,
    `probationStatus` ENUM('UNDER_PROBATION', 'EXTENDED', 'CONFIRMED', 'REJECTED') NULL DEFAULT 'UNDER_PROBATION',
    `lifecycleStatus` ENUM('APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'OFFER_ACCEPTED', 'ONBOARDING', 'ACTIVE', 'PROBATION', 'CONFIRMED', 'ON_NOTICE', 'EXIT_CLEARANCE', 'RESIGNED', 'TERMINATED') NULL DEFAULT 'ACTIVE',
    `shiftId` VARCHAR(191) NULL,
    `overtimePolicyId` VARCHAR(191) NULL,
    `salaryType` VARCHAR(191) NOT NULL DEFAULT 'Monthly',
    `hourlyRate` DOUBLE NULL,

    UNIQUE INDEX `employeeprofile_userId_key`(`userId`),
    UNIQUE INDEX `employeeprofile_employeeId_key`(`employeeId`),
    UNIQUE INDEX `employeeprofile_applicationId_key`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidateprofile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `dob` DATETIME(3) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `bio` TEXT NULL,
    `role` VARCHAR(191) NULL,
    `currentSalary` VARCHAR(191) NULL,
    `noticePeriod` VARCHAR(191) NULL,
    `avatarUrl` LONGTEXT NULL,
    `resumeUrl` LONGTEXT NULL,
    `identityProofUrl` LONGTEXT NULL,
    `educationProofUrl` LONGTEXT NULL,
    `expectedSalary` VARCHAR(191) NULL,
    `experience` VARCHAR(191) NULL,
    `linkedin` VARCHAR(191) NULL,
    `portfolio` VARCHAR(191) NULL,
    `skills` VARCHAR(191) NULL,
    `resumeData` LONGTEXT NULL,
    `profileViews` INTEGER NOT NULL DEFAULT 0,
    `resumeDownloads` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `candidateprofile_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobpost` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `requirements` TEXT NOT NULL,
    `salaryRange` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `jobType` VARCHAR(191) NULL,
    `experience` VARCHAR(191) NULL,
    `openings` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Published',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobapplication` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `status` ENUM('APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'APPLIED',
    `resumeUrl` VARCHAR(191) NULL,
    `coverLetter` TEXT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lifecycleStatus` ENUM('APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'OFFER_ACCEPTED', 'ONBOARDING', 'ACTIVE', 'PROBATION', 'CONFIRMED', 'ON_NOTICE', 'EXIT_CLEARANCE', 'RESIGNED', 'TERMINATED') NULL DEFAULT 'APPLIED',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interview` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `interviewerId` VARCHAR(191) NOT NULL,
    `dateTime` DATETIME(3) NOT NULL,
    `meetingLink` VARCHAR(191) NULL,
    `feedback` TEXT NULL,
    `rating` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Scheduled',
    `round` VARCHAR(191) NULL,
    `type` VARCHAR(191) NULL DEFAULT 'Video Call',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `breakDurationMin` INTEGER NOT NULL DEFAULT 60,
    `workingHoursMin` INTEGER NOT NULL DEFAULT 480,
    `graceInMin` INTEGER NOT NULL DEFAULT 15,
    `graceOutMin` INTEGER NOT NULL DEFAULT 15,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `organizationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtimepolicy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `weekdayMultiplier` DOUBLE NOT NULL DEFAULT 1.5,
    `weekendMultiplier` DOUBLE NOT NULL DEFAULT 2.0,
    `holidayMultiplier` DOUBLE NOT NULL DEFAULT 2.0,
    `minOvertimeMin` INTEGER NOT NULL DEFAULT 30,
    `maxOvertimeMin` INTEGER NOT NULL DEFAULT 240,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `organizationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendancelog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `clockIn` DATETIME(3) NOT NULL,
    `clockOut` DATETIME(3) NULL,
    `totalWorkedMin` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Present',
    `mode` VARCHAR(191) NOT NULL DEFAULT 'Office',
    `shiftId` VARCHAR(191) NULL,
    `lateMinutes` INTEGER NOT NULL DEFAULT 0,
    `earlyExitMinutes` INTEGER NOT NULL DEFAULT 0,
    `overtimeMinutes` INTEGER NOT NULL DEFAULT 0,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `isHalfDay` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leavepolicy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT true,
    `yearlyAllowance` INTEGER NOT NULL DEFAULT 0,
    `organizationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leavepolicy_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leaverequest` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `leaveType` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `totalDays` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'MANAGER_APPROVED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `managerComment` VARCHAR(191) NULL,
    `emergencyContact` VARCHAR(191) NULL,
    `attachmentUrl` TEXT NULL,
    `attachmentName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslip` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `basic` DOUBLE NOT NULL,
    `hra` DOUBLE NOT NULL,
    `allowance` DOUBLE NOT NULL,
    `bonus` DOUBLE NOT NULL DEFAULT 0,
    `pf` DOUBLE NOT NULL,
    `tax` DOUBLE NOT NULL,
    `netPay` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Unpaid',
    `paymentDate` DATETIME(3) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `benefitclaim` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Submitted',
    `managerStatus` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `managerComment` TEXT NULL,
    `receiptUrl` TEXT NULL,
    `receiptName` VARCHAR(191) NULL,
    `managerApprovedAt` DATETIME(3) NULL,
    `finalApprovalStatus` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `finalApproverId` VARCHAR(191) NULL,
    `finalApproverRole` VARCHAR(191) NULL,
    `finalApprovalComment` TEXT NULL,
    `finalApprovedAt` DATETIME(3) NULL,
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `paymentMethod` VARCHAR(191) NULL,
    `paymentReference` VARCHAR(191) NULL,
    `paymentDate` DATETIME(3) NULL,
    `overallStatus` VARCHAR(191) NOT NULL DEFAULT 'Submitted',
    `approvalHistory` LONGTEXT NULL,
    `claimedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `performancegoal` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'Medium',
    `deadline` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'Medium',
    `dueDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supportticket` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `priority` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticketmessage` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `attachmentUrl` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auditlog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` TEXT NOT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NULL DEFAULT 'All',
    `owner` VARCHAR(191) NOT NULL,
    `effectiveDate` VARCHAR(191) NULL,
    `expiryDate` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL DEFAULT '1.0',
    `requiresSignature` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('Active', 'Expiring Soon', 'Renewing', 'Archived') NOT NULL DEFAULT 'Active',
    `description` TEXT NULL,
    `pdfName` VARCHAR(191) NULL,
    `pdfData` LONGTEXT NULL,
    `acknowledgments` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policyacknowledgment` (
    `id` VARCHAR(191) NOT NULL,
    `policyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `policyacknowledgment_policyId_userId_key`(`policyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customrole` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isCustom` BOOLEAN NOT NULL DEFAULT true,
    `permissions` TEXT NOT NULL,
    `inheritsFrom` ENUM('SUPERADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'CANDIDATE') NOT NULL DEFAULT 'EMPLOYEE',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `landingPage` VARCHAR(191) NULL,
    `permissionVersion` INTEGER NOT NULL DEFAULT 1,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customrole_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holiday` (
    `id` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `type` ENUM('PUBLIC', 'COMPANY', 'REGIONAL', 'OPTIONAL') NOT NULL DEFAULT 'PUBLIC',
    `region` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Upcoming',
    `repeat` BOOLEAN NOT NULL DEFAULT false,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `benefitplan` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `contribution` VARCHAR(191) NOT NULL,
    `eligibility` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `empContribution` VARCHAR(191) NOT NULL DEFAULT '0.00',
    `description` TEXT NULL,
    `autoEnroll` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aimodule` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `desc` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `confidence` INTEGER NOT NULL DEFAULT 90,
    `settings` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `aimodule_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ailog` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Disconnected',
    `health` VARCHAR(191) NOT NULL DEFAULT '-',
    `sync` VARCHAR(191) NOT NULL DEFAULT 'Manual',
    `icon` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `integration_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billingplan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL,
    `cycle` VARCHAR(191) NOT NULL,
    `users` INTEGER NOT NULL,
    `addons` VARCHAR(191) NOT NULL DEFAULT '[]',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `billingplan_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `amount` VARCHAR(191) NOT NULL DEFAULT '$0.00',
    `method` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `priority` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `size` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeskill` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `performancereview` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `reviewer` VARCHAR(191) NOT NULL,
    `rating` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `globalsettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'global-settings',
    `defaultCurrency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `defaultPhoneCountry` VARCHAR(191) NOT NULL DEFAULT '+1',
    `dateFormat` VARCHAR(191) NOT NULL DEFAULT 'DD/MM/YYYY',
    `platformMode` VARCHAR(191) NOT NULL DEFAULT 'Production',
    `maxOrgs` VARCHAR(191) NOT NULL DEFAULT 'Unlimited',
    `defaultTimezone` VARCHAR(191) NOT NULL DEFAULT 'UTC+00:00 (London)',
    `masterCurrency` VARCHAR(191) NOT NULL DEFAULT 'USD ($) - US Dollar',
    `globalMFA` BOOLEAN NOT NULL DEFAULT true,
    `auditLogRetention` VARCHAR(191) NOT NULL DEFAULT '90 Days',
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 5,
    `ipWhitelisting` BOOLEAN NOT NULL DEFAULT false,
    `basePricePerUser` DOUBLE NOT NULL DEFAULT 8.00,
    `freeTrialDays` INTEGER NOT NULL DEFAULT 14,
    `gracePeriodDays` INTEGER NOT NULL DEFAULT 7,
    `invoiceInterval` VARCHAR(191) NOT NULL DEFAULT 'Monthly',
    `primaryModel` VARCHAR(191) NOT NULL DEFAULT 'Google Gemini 1.5 Pro',
    `resumeScanAutoRank` BOOLEAN NOT NULL DEFAULT true,
    `matchingThreshold` INTEGER NOT NULL DEFAULT 75,
    `apiRateLimit` INTEGER NOT NULL DEFAULT 1200,
    `reimbursementManagerApproval` BOOLEAN NOT NULL DEFAULT true,
    `reimbursementFinalApprovalRole` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offer` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `candidate` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `salary` VARCHAR(191) NOT NULL,
    `joiningDate` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Sent',
    `sentDate` VARCHAR(191) NOT NULL,
    `letterContent` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `offer_applicationId_key`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NULL,
    `manager` VARCHAR(191) NULL,
    `joiningDate` VARCHAR(191) NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Not Started',
    `avatar` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `onboarding_applicationId_key`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exitlifecycle` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `exitType` ENUM('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'DEATH') NOT NULL DEFAULT 'RESIGNATION',
    `status` ENUM('PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'APPROVED', 'REJECTED_BY_MANAGER', 'REJECTED_BY_HR', 'EMPLOYEE_RELIEVED', 'INITIATED', 'CLEARANCE_IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'INITIATED',
    `submissionDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastWorkingDay` DATETIME(3) NOT NULL,
    `reason` TEXT NULL,
    `itClearance` BOOLEAN NOT NULL DEFAULT false,
    `financeClearance` BOOLEAN NOT NULL DEFAULT false,
    `hrClearance` BOOLEAN NOT NULL DEFAULT false,
    `exitInterviewFeedback` TEXT NULL,
    `exitInterviewRating` INTEGER NULL,
    `managerId` VARCHAR(191) NULL,
    `managerComment` TEXT NULL,
    `managerDecisionDate` DATETIME(3) NULL,
    `hrId` VARCHAR(191) NULL,
    `hrComment` TEXT NULL,
    `hrDecisionDate` DATETIME(3) NULL,
    `attachmentUrl` TEXT NULL,
    `finalLastWorkingDay` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `exitlifecycle_applicationId_key`(`applicationId`),
    UNIQUE INDEX `exitlifecycle_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `type` ENUM('INFO', 'SUCCESS', 'WARNING', 'ALERT') NOT NULL DEFAULT 'INFO',
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `link` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demobooking` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `companySize` VARCHAR(191) NOT NULL,
    `requirement` VARCHAR(191) NOT NULL,
    `selectedDate` VARCHAR(191) NOT NULL,
    `selectedSlot` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `message` VARCHAR(191) NULL,
    `modules` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pricingplan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `monthlyPrice` DOUBLE NOT NULL,
    `yearlyPrice` DOUBLE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'Monthly',
    `trialDays` INTEGER NOT NULL DEFAULT 14,
    `maxEmployees` INTEGER NOT NULL DEFAULT 100,
    `maxAdmins` INTEGER NOT NULL DEFAULT 3,
    `storageLimit` INTEGER NOT NULL DEFAULT 10,
    `aiCredits` INTEGER NULL DEFAULT 0,
    `supportLevel` VARCHAR(191) NOT NULL DEFAULT 'Standard',
    `buttonText` VARCHAR(191) NOT NULL DEFAULT 'Start Trial',
    `buttonLink` VARCHAR(191) NOT NULL DEFAULT '/login',
    `isPopular` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pricingplan_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pricingfeature` (
    `id` VARCHAR(191) NOT NULL,
    `pricingPlanId` VARCHAR(191) NOT NULL,
    `feature` VARCHAR(191) NOT NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `compensationprofile` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `baseSalary` DOUBLE NULL,
    `monthlyCTC` DOUBLE NOT NULL DEFAULT 0,
    `annualCTC` DOUBLE NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `salaryStructureId` VARCHAR(191) NULL,
    `salaryVersionId` VARCHAR(191) NULL,
    `salaryBandId` VARCHAR(191) NULL,
    `effectiveDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `compensationprofile_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `compensationversion` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `previousSalary` DOUBLE NOT NULL,
    `newSalary` DOUBLE NOT NULL,
    `difference` DOUBLE NOT NULL,
    `reason` VARCHAR(191) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `effectiveDate` DATETIME(3) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `version` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salaryband` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `minSalary` DOUBLE NOT NULL,
    `maxSalary` DOUBLE NOT NULL,
    `recommendedSalary` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salarycomponent` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'Earning',
    `calculationType` VARCHAR(191) NOT NULL DEFAULT 'Fixed',
    `calculationBase` VARCHAR(191) NULL,
    `value` VARCHAR(191) NOT NULL,
    `formula` TEXT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `isTaxable` BOOLEAN NOT NULL DEFAULT true,
    `isAutoBalance` BOOLEAN NOT NULL DEFAULT false,
    `isEmployerContribution` BOOLEAN NOT NULL DEFAULT false,
    `isEmployeeDeduction` BOOLEAN NOT NULL DEFAULT false,
    `roundingRule` VARCHAR(191) NOT NULL DEFAULT 'Nearest',
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `salarycomponent_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeesalarycomponent` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `componentId` VARCHAR(191) NOT NULL,
    `customValue` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `effectiveDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deductionrule` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `valueType` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `isPreTax` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `deductionrule_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeededuction` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `deductionId` VARCHAR(191) NOT NULL,
    `customValue` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `effectiveDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `taxrule` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `slabs` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeebenefit` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `benefitPlanId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `enrollmentDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bonus` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `reason` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `isTaxable` BOOLEAN NOT NULL DEFAULT true,
    `effectiveMonth` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salaryincrementrequest` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `requestedSalary` DOUBLE NOT NULL,
    `reason` TEXT NULL,
    `effectiveDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `workflowId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvalworkflow` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `effectiveDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvalstep` (
    `id` VARCHAR(191) NOT NULL,
    `workflowId` VARCHAR(191) NOT NULL,
    `stepOrder` INTEGER NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `approverType` VARCHAR(191) NOT NULL DEFAULT 'ROLE',
    `approverRole` VARCHAR(191) NOT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `canSkip` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approvallog` (
    `id` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `workflowId` VARCHAR(191) NULL,
    `workflowVersion` INTEGER NULL,
    `stepOrder` INTEGER NOT NULL,
    `previousStep` INTEGER NULL,
    `nextStep` INTEGER NULL,
    `approverId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `comments` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendancepolicy` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `lateMarkThresholdMin` INTEGER NOT NULL DEFAULT 15,
    `lateMarksForHalfDay` INTEGER NOT NULL DEFAULT 3,
    `earlyExitThresholdMin` INTEGER NOT NULL DEFAULT 15,
    `earlyExitsForHalfDay` INTEGER NOT NULL DEFAULT 3,
    `halfDayWorkMin` INTEGER NOT NULL DEFAULT 240,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendancepolicy_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrollconfiguration` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `masterCurrency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `payrollCycle` VARCHAR(191) NOT NULL DEFAULT 'Monthly',
    `calculationBase` VARCHAR(191) NOT NULL DEFAULT 'Fixed Days',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payrollconfiguration_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrollsnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `monthlyCTC` DOUBLE NOT NULL DEFAULT 0,
    `salaryStructureVersionId` VARCHAR(191) NULL,
    `grossSalary` DOUBLE NOT NULL,
    `totalDeductions` DOUBLE NOT NULL,
    `totalContributions` DOUBLE NOT NULL DEFAULT 0,
    `netSalary` DOUBLE NOT NULL,
    `employerCost` DOUBLE NOT NULL DEFAULT 0,
    `totalWorkingDays` DOUBLE NOT NULL DEFAULT 0,
    `presentDays` DOUBLE NOT NULL DEFAULT 0,
    `paidLeaveDays` DOUBLE NOT NULL DEFAULT 0,
    `unpaidLeaveDays` DOUBLE NOT NULL DEFAULT 0,
    `overtimeHours` DOUBLE NOT NULL DEFAULT 0,
    `overtimeAmount` DOUBLE NOT NULL DEFAULT 0,
    `calculationLog` LONGTEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Draft',
    `paymentDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrollitem` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salarystructure` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `country` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `currentVersionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salarystructureversion` (
    `id` VARCHAR(191) NOT NULL,
    `structureId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `effectiveFrom` DATETIME(3) NULL,
    `effectiveTo` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salarystructurecomponent` (
    `id` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `componentId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `category` VARCHAR(191) NULL,
    `calculationType` VARCHAR(191) NULL,
    `calculationBase` VARCHAR(191) NULL,
    `value` VARCHAR(191) NULL,
    `formula` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workcalendar` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `isDefaultCompanyCalendar` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workcalendarversion` (
    `id` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL DEFAULT 1,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workcalendarweekend` (
    `id` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `dayOfWeek` VARCHAR(191) NOT NULL,
    `type` ENUM('FULL_DAY', 'HALF_DAY', 'WORKING_DAY') NOT NULL DEFAULT 'FULL_DAY',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workcalendarassignment` (
    `id` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NOT NULL,
    `entityType` ENUM('EMPLOYEE', 'DEPARTMENT', 'LOCATION', 'SHIFT', 'BRANCH') NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `organization` ADD CONSTRAINT `organization_pricingPlanId_fkey` FOREIGN KEY (`pricingPlanId`) REFERENCES `pricingplan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_customRoleId_fkey` FOREIGN KEY (`customRoleId`) REFERENCES `customrole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department` ADD CONSTRAINT `department_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeprofile` ADD CONSTRAINT `employeeprofile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeprofile` ADD CONSTRAINT `employeeprofile_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeprofile` ADD CONSTRAINT `employeeprofile_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `employeeprofile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeprofile` ADD CONSTRAINT `employeeprofile_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `jobapplication`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeprofile` ADD CONSTRAINT `employeeprofile_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeprofile` ADD CONSTRAINT `employeeprofile_overtimePolicyId_fkey` FOREIGN KEY (`overtimePolicyId`) REFERENCES `overtimepolicy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidateprofile` ADD CONSTRAINT `candidateprofile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobapplication` ADD CONSTRAINT `jobapplication_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `jobpost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobapplication` ADD CONSTRAINT `jobapplication_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidateprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interview` ADD CONSTRAINT `interview_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `jobapplication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interview` ADD CONSTRAINT `interview_interviewerId_fkey` FOREIGN KEY (`interviewerId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift` ADD CONSTRAINT `shift_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `overtimepolicy` ADD CONSTRAINT `overtimepolicy_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendancelog` ADD CONSTRAINT `attendancelog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendancelog` ADD CONSTRAINT `attendancelog_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leavepolicy` ADD CONSTRAINT `leavepolicy_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leaverequest` ADD CONSTRAINT `leaverequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip` ADD CONSTRAINT `payslip_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `benefitclaim` ADD CONSTRAINT `benefitclaim_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `performancegoal` ADD CONSTRAINT `performancegoal_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supportticket` ADD CONSTRAINT `supportticket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketmessage` ADD CONSTRAINT `ticketmessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `supportticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketmessage` ADD CONSTRAINT `ticketmessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auditlog` ADD CONSTRAINT `auditlog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policyacknowledgment` ADD CONSTRAINT `policyacknowledgment_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `policy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policyacknowledgment` ADD CONSTRAINT `policyacknowledgment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customrole` ADD CONSTRAINT `customrole_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customrole` ADD CONSTRAINT `customrole_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holiday` ADD CONSTRAINT `holiday_calendarId_fkey` FOREIGN KEY (`calendarId`) REFERENCES `workcalendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `benefitplan` ADD CONSTRAINT `benefitplan_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeeskill` ADD CONSTRAINT `employeeskill_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `performancereview` ADD CONSTRAINT `performancereview_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offer` ADD CONSTRAINT `offer_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `jobapplication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding` ADD CONSTRAINT `onboarding_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `jobapplication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exitlifecycle` ADD CONSTRAINT `exitlifecycle_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `jobapplication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exitlifecycle` ADD CONSTRAINT `exitlifecycle_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pricingfeature` ADD CONSTRAINT `pricingfeature_pricingPlanId_fkey` FOREIGN KEY (`pricingPlanId`) REFERENCES `pricingplan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compensationprofile` ADD CONSTRAINT `compensationprofile_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compensationprofile` ADD CONSTRAINT `compensationprofile_salaryStructureId_fkey` FOREIGN KEY (`salaryStructureId`) REFERENCES `salarystructure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compensationprofile` ADD CONSTRAINT `compensationprofile_salaryVersionId_fkey` FOREIGN KEY (`salaryVersionId`) REFERENCES `salarystructureversion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compensationprofile` ADD CONSTRAINT `compensationprofile_salaryBandId_fkey` FOREIGN KEY (`salaryBandId`) REFERENCES `salaryband`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compensationversion` ADD CONSTRAINT `compensationversion_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salaryband` ADD CONSTRAINT `salaryband_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salarycomponent` ADD CONSTRAINT `salarycomponent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeesalarycomponent` ADD CONSTRAINT `employeesalarycomponent_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeesalarycomponent` ADD CONSTRAINT `employeesalarycomponent_componentId_fkey` FOREIGN KEY (`componentId`) REFERENCES `salarycomponent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deductionrule` ADD CONSTRAINT `deductionrule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeededuction` ADD CONSTRAINT `employeededuction_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeededuction` ADD CONSTRAINT `employeededuction_deductionId_fkey` FOREIGN KEY (`deductionId`) REFERENCES `deductionrule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taxrule` ADD CONSTRAINT `taxrule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeebenefit` ADD CONSTRAINT `employeebenefit_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employeebenefit` ADD CONSTRAINT `employeebenefit_benefitPlanId_fkey` FOREIGN KEY (`benefitPlanId`) REFERENCES `benefitplan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bonus` ADD CONSTRAINT `bonus_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salaryincrementrequest` ADD CONSTRAINT `salaryincrementrequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvalworkflow` ADD CONSTRAINT `approvalworkflow_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvalstep` ADD CONSTRAINT `approvalstep_workflowId_fkey` FOREIGN KEY (`workflowId`) REFERENCES `approvalworkflow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approvallog` ADD CONSTRAINT `approvallog_approverId_fkey` FOREIGN KEY (`approverId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendancepolicy` ADD CONSTRAINT `attendancepolicy_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payrollconfiguration` ADD CONSTRAINT `payrollconfiguration_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payrollsnapshot` ADD CONSTRAINT `payrollsnapshot_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employeeprofile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payrollsnapshot` ADD CONSTRAINT `payrollsnapshot_salaryStructureVersionId_fkey` FOREIGN KEY (`salaryStructureVersionId`) REFERENCES `salarystructureversion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payrollitem` ADD CONSTRAINT `payrollitem_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `payrollsnapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salarystructure` ADD CONSTRAINT `salarystructure_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salarystructureversion` ADD CONSTRAINT `salarystructureversion_structureId_fkey` FOREIGN KEY (`structureId`) REFERENCES `salarystructure`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salarystructurecomponent` ADD CONSTRAINT `salarystructurecomponent_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `salarystructureversion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salarystructurecomponent` ADD CONSTRAINT `salarystructurecomponent_componentId_fkey` FOREIGN KEY (`componentId`) REFERENCES `salarycomponent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workcalendar` ADD CONSTRAINT `workcalendar_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workcalendarversion` ADD CONSTRAINT `workcalendarversion_calendarId_fkey` FOREIGN KEY (`calendarId`) REFERENCES `workcalendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workcalendarweekend` ADD CONSTRAINT `workcalendarweekend_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `workcalendarversion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workcalendarassignment` ADD CONSTRAINT `workcalendarassignment_calendarId_fkey` FOREIGN KEY (`calendarId`) REFERENCES `workcalendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
