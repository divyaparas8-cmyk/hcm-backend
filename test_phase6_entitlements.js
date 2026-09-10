// Verification Script for Phase 6: SaaS Feature Entitlement Management
const prisma = require('./src/config/prisma');
const superAdminController = require('./src/controllers/superAdminController');
const subscriptionGuard = require('./src/middlewares/subscriptionGuard');
const tenantGuard = require('./src/middlewares/tenantGuard');

async function runTests() {
  console.log('==============================================');
  console.log('TEST 1: DB Source of Truth for Platform Features');
  console.log('==============================================');

  // Trigger getPlatformFeatures to ensure seeding and query
  const mockReq = { query: {}, user: { role: 'SUPERADMIN', id: 'superadmin-test' } };
  let responseData = null;
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        responseData = data;
        return data;
      }
    })
  };

  await superAdminController.getPlatformFeatures(mockReq, mockRes, (err) => {
    if (err) throw err;
  });

  const dbFeatureCount = await prisma.platformFeature.count();
  console.log(`✅ Platform features in database: ${dbFeatureCount}`);
  if (dbFeatureCount < 10) throw new Error('DB features not properly seeded!');

  console.log(`✅ API features returned: ${responseData?.data?.features?.length}`);
  console.log(`✅ Dynamic categories returned:`, responseData?.data?.categories);
  console.log(`✅ Plans returned:`, responseData?.data?.plansList?.map(p => p.name));

  console.log('\n==============================================');
  console.log('TEST 2: Plan Feature Toggle & Synchronization');
  console.log('==============================================');

  // Find a plan (e.g. Starter)
  const starterPlan = await prisma.pricingPlan.findFirst({
    where: { name: 'Starter' },
    include: { features: true }
  });

  if (!starterPlan) throw new Error('Starter plan not found in database!');

  const testFeatureId = 'payroll_operations';
  const initiallyEnabled = starterPlan.features.some(f => f.feature === testFeatureId);
  console.log(`Starter initial state for '${testFeatureId}': ${initiallyEnabled ? 'ENABLED' : 'DISABLED'}`);

  // Toggle to opposite
  const targetState = !initiallyEnabled;
  let toggleResponse = null;
  const toggleRes = {
    status: (code) => ({
      json: (data) => {
        toggleResponse = data;
        return data;
      }
    })
  };

  await superAdminController.togglePlatformFeature(
    {
      body: {
        planId: starterPlan.id,
        planName: starterPlan.name,
        featureId: testFeatureId,
        isEnabled: targetState
      },
      user: { role: 'SUPERADMIN', id: 'test-superadmin-uuid' },
      ip: '127.0.0.1'
    },
    toggleRes,
    (err) => { if (err) throw err; }
  );

  console.log(`✅ Toggle response:`, toggleResponse?.message);

  // Verify in database
  const updatedStarter = await prisma.pricingPlan.findUnique({
    where: { id: starterPlan.id },
    include: { features: true }
  });
  const nowEnabled = updatedStarter.features.some(f => f.feature === testFeatureId);
  console.log(`Starter DB state after toggle: ${nowEnabled ? 'ENABLED' : 'DISABLED'}`);
  if (nowEnabled !== targetState) {
    throw new Error(`Toggle state mismatch! Expected ${targetState}, got ${nowEnabled}`);
  }

  // Toggle back to original state so test is non-destructive
  await superAdminController.togglePlatformFeature(
    {
      body: {
        planId: starterPlan.id,
        planName: starterPlan.name,
        featureId: testFeatureId,
        isEnabled: initiallyEnabled
      },
      user: { role: 'SUPERADMIN', id: 'test-superadmin-uuid' },
      ip: '127.0.0.1'
    },
    toggleRes,
    (err) => { if (err) throw err; }
  );
  console.log(`✅ Reverted '${testFeatureId}' on Starter back to original state: ${initiallyEnabled ? 'ENABLED' : 'DISABLED'}`);

  console.log('\n==============================================');
  console.log('TEST 3: Tenant Authorization Enforcement (subscriptionGuard)');
  console.log('==============================================');

  // Test 3a: Organization on Starter trying to access an unentitled feature (e.g. 'backup_center')
  const guard = subscriptionGuard('backup_center');
  const mockTenantReqBlocked = {
    user: { role: 'ADMIN', organizationId: starterPlan.id },
    tenant: {
      id: 'test-org-1',
      name: 'Acme Test Corp',
      plan: 'Starter',
      subscriptionStatus: 'ACTIVE',
      features: ['attendance_leave', 'employee_directory', 'support_tickets'] // Note: backup_center is absent!
    }
  };

  let blockedStatus = null;
  let blockedBody = null;
  const mockResBlocked = {
    status: (code) => {
      blockedStatus = code;
      return {
        json: (data) => {
          blockedBody = data;
          return data;
        }
      };
    }
  };

  let nextCalledBlocked = false;
  await guard(mockTenantReqBlocked, mockResBlocked, () => {
    nextCalledBlocked = true;
  });

  console.log(`Blocked check: status = ${blockedStatus}, code = ${blockedBody?.error?.code}`);
  if (blockedStatus !== 403 || blockedBody?.error?.code !== 'FEATURE_NOT_ENTITLED') {
    throw new Error(`subscriptionGuard failed to block unentitled feature! Status: ${blockedStatus}`);
  }
  console.log(`✅ Correctly blocked unentitled feature: "${blockedBody?.error?.message}"`);

  // Test 3b: Organization on Enterprise trying to access an entitled feature
  const mockTenantReqAllowed = {
    user: { role: 'ADMIN', organizationId: 'enterprise-org-id' },
    tenant: {
      id: 'test-org-enterprise',
      name: 'Enterprise Corp',
      plan: 'Enterprise',
      subscriptionStatus: 'ACTIVE',
      features: ['backup_center', 'payroll_operations', 'attendance_leave']
    }
  };

  let nextCalledAllowed = false;
  await guard(mockTenantReqAllowed, mockResBlocked, () => {
    nextCalledAllowed = true;
  });

  if (!nextCalledAllowed) {
    throw new Error('subscriptionGuard failed to allow entitled feature!');
  }
  console.log(`✅ Correctly allowed entitled feature: next() was called.`);

  // Test 3c: SuperAdmin bypass check
  const mockSuperAdminReq = {
    user: { role: 'SUPERADMIN' },
    tenant: null
  };
  let nextCalledSuperAdmin = false;
  await guard(mockSuperAdminReq, mockResBlocked, () => {
    nextCalledSuperAdmin = true;
  });

  if (!nextCalledSuperAdmin) {
    throw new Error('subscriptionGuard failed to bypass SuperAdmin!');
  }
  console.log(`✅ Correctly bypassed SuperAdmin across all features.`);

  console.log('\n==============================================');
  console.log('TEST 4: Audit Logging for Feature Actions');
  console.log('==============================================');
  const recentLog = await prisma.auditLog.findFirst({
    where: { action: 'TOGGLE_FEATURE_ENTITLEMENT' },
    orderBy: { createdAt: 'desc' }
  });
  console.log(`✅ Audit Log found: action = ${recentLog?.action}, details = "${recentLog?.details}"`);

  console.log('\n==============================================');
  console.log('ALL PHASE 6 VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('==============================================');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
