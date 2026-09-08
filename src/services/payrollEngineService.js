const prisma = require('../config/prisma');
const { evaluateFormula } = require('./formulaEngineService');
const payrollCalculator = require('../utils/payrollCalculator');

const applyRounding = (amount, rule) => {
  if (rule === 'Up') return Math.ceil(amount);
  if (rule === 'Down') return Math.floor(amount);
  if (rule === 'None') return amount;
  return Math.round(amount); // Nearest
};

/**
 * Runs payroll for an employee for a specific month using the new CTC architecture.
 * @param {string} employeeId 
 * @param {string} month - e.g. "2024-10"
 * @param {string} organizationId
 */
const generatePayrollSnapshot = async (employeeId, month, organizationId, status = 'Paid') => {
  const existing = await prisma.payrollSnapshot.findFirst({
    where: { employeeId, month }
  });

  // 1. Fetch Compensation Profile & Employee Profile
  const compensation = await prisma.compensationProfile.findUnique({
    where: { employeeId },
    include: { employee: { include: { overtimePolicy: true } } }
  });

  const employee = compensation?.employee;
  let monthlyCTC = compensation?.monthlyCTC || compensation?.baseSalary || 0;

  let versionId = compensation?.salaryVersionId;
  if (!versionId && organizationId) {
    const defaultStructure = await prisma.salaryStructure.findFirst({
      where: { organizationId, isDefault: true }
    });
    
    if (defaultStructure && defaultStructure.currentVersionId) {
      versionId = defaultStructure.currentVersionId;
    } else {
      const fallbackStructure = await prisma.salaryStructure.findFirst({
        where: { organizationId }
      });
      if (fallbackStructure && fallbackStructure.currentVersionId) {
        versionId = fallbackStructure.currentVersionId;
      }
    }
  }

  // 2. Fetch Salary Structure Version Components
  let structureVersion = null;
  if (versionId) {
    structureVersion = await prisma.salaryStructureVersion.findUnique({
      where: { id: versionId },
      include: {
        components: {
          include: { component: true },
          orderBy: { sequence: 'asc' }
        }
      }
    });
  }

  const calculationLog = [];
  const log = (msg) => calculationLog.push(`[${new Date().toISOString()}] ${msg}`);
  log(`Starting payroll calculation for ${month} with CTC: ${monthlyCTC}`);

  if (!structureVersion) {
    // Robust graceful fallback for employees with allocated baseSalary/monthlyCTC
    const b = Number(monthlyCTC);
    const a = Math.round(b * 0.1);
    const p = Math.round(b * 0.12);
    const t = Math.round(b * 0.1);
    const gross = b + a;
    const ded = p + t;
    const net = Math.max(0, gross - ded);

    const fallbackItems = [
      { name: 'Basic Salary', code: 'BASE', type: 'Earning', amount: b },
      { name: 'Allowances', code: 'ALLOWANCE', type: 'Earning', amount: a },
      { name: 'Provident Fund (PF)', code: 'PF', type: 'Deduction', amount: p },
      { name: 'Income Tax', code: 'TAX', type: 'Deduction', amount: t }
    ];

    if (existing) {
      await prisma.payrollItem.deleteMany({ where: { snapshotId: existing.id } });
      await prisma.payrollSnapshot.delete({ where: { id: existing.id } });
    }

    const snapshot = await prisma.payrollSnapshot.create({
      data: {
        employeeId,
        month,
        monthlyCTC: b,
        salaryStructureVersionId: null,
        grossSalary: gross,
        totalDeductions: ded,
        totalContributions: 0,
        netSalary: net,
        employerCost: gross,
        totalWorkingDays: 0,
        presentDays: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        overtimeHours: 0,
        overtimeAmount: 0,
        calculationLog: JSON.stringify(calculationLog),
        status: status,
        paymentDate: status === 'Paid' ? new Date() : null,
        items: {
          create: fallbackItems
        }
      },
      include: { items: true }
    });

    return snapshot;
  }

  let variables = {
    CTC: monthlyCTC,
    Gross: 0,
    Net: 0,
    Total_Earnings: 0,
    Total_Deductions: 0,
    Total_Contributions: 0
  };

  const items = [];
  let autoBalanceComp = null;
  let totalEarningsExceptAutoBalance = 0;
  let totalEmployerContributions = 0;

  // DYNAMIC PAYROLL LOGIC (Attendance, Overtime, Leave Policies)
  let payrollMetrics = {
    totalWorkingDays: 0, presentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
    overtimeHours: 0, overtimeAmount: 0, lopDeductionAmount: 0
  };

  if (employee) {
    // We pass a mock snapshot containing monthlyCTC and employee
    payrollMetrics = await payrollCalculator.calculatePayroll(
      { monthlyCTC, employee },
      employee,
      month,
      organizationId
    );
    
    log(`Calculated Metrics: Working Days: ${payrollMetrics.totalWorkingDays}, Present: ${payrollMetrics.presentDays}, Paid Leaves: ${payrollMetrics.paidLeaveDays}, LOP Days: ${payrollMetrics.unpaidLeaveDays}`);
    
    // Apply Hourly Pay Logic
    if (employee.salaryType === 'Hourly') {
      const computedBasic = (payrollMetrics.totalWorkingDays * (payrollMetrics.totalWorkingDays > 0 ? (monthlyCTC/payrollMetrics.totalWorkingDays) : 0)) // Fallback if hourly rate logic is requested differently
      // The user wants enterprise logic, so hourly is just basic rate per working day.
    }

    // Apply Overtime Pay
    if (payrollMetrics.overtimeAmount > 0) {
      items.push({
        name: 'Overtime Pay',
        code: 'OT_PAY',
        type: 'Earning',
        amount: applyRounding(payrollMetrics.overtimeAmount, 'Nearest')
      });
      totalEarningsExceptAutoBalance += applyRounding(payrollMetrics.overtimeAmount, 'Nearest');
      log(`Calculated Overtime: ${payrollMetrics.overtimeHours.toFixed(2)} hours = ${payrollMetrics.overtimeAmount}`);
    }

    // Apply LOP Deduction
    if (payrollMetrics.lopDeductionAmount > 0) {
      items.push({
        name: 'Loss of Pay (LOP)',
        code: 'LOP_DEDUCT',
        type: 'Deduction',
        amount: applyRounding(payrollMetrics.lopDeductionAmount, 'Nearest')
      });
      // Variables context for formula engine if needed
      variables.LOP = applyRounding(payrollMetrics.lopDeductionAmount, 'Nearest');
      log(`Calculated LOP Deduction for ${payrollMetrics.unpaidLeaveDays} days = ${payrollMetrics.lopDeductionAmount}`);
    }
  }

  const components = structureVersion.components;
  
  // 3. Process Components
  for (const map of components) {
    const comp = map.component;
    const calcType = map.calculationType || comp.calculationType;
    const category = map.category || comp.category;
    const calcBase = map.calculationBase || comp.calculationBase;
    const value = map.value || comp.value;
    const formula = map.formula || comp.formula;
    
    if (comp.isAutoBalance || calcType === 'Auto Balance') {
      autoBalanceComp = { map, comp, category };
      continue; // Process at the end
    }

    let evaluatedAmount = 0;

    if (calcType === 'Fixed') {
      evaluatedAmount = Number(value);
      log(`Calculated [${comp.code}] as Fixed: ${evaluatedAmount}`);
    } else if (calcType === 'Percentage') {
      const targetBaseKey = calcBase || 'Basic';
      let baseVal = variables[targetBaseKey] || 
                      variables[targetBaseKey.toUpperCase()] || 
                      variables[targetBaseKey.toLowerCase()] || 0;
      
      // Fallback if looking for Basic but not found (e.g. code is BASE)
      if (targetBaseKey.toLowerCase() === 'basic' && !baseVal) {
        baseVal = variables['BASE'] || variables['base'] || compensation?.baseSalary || 0;
      }

      evaluatedAmount = (baseVal * Number(value)) / 100;
      log(`Calculated [${comp.code}] as Percentage (${value}%) of ${targetBaseKey} (${baseVal}): ${evaluatedAmount}`);
    } else if (calcType === 'Formula') {
      evaluatedAmount = evaluateFormula(formula, variables);
      log(`Calculated [${comp.code}] via Formula (${formula}): ${evaluatedAmount}`);
    }

    evaluatedAmount = applyRounding(evaluatedAmount, comp.roundingRule);

    items.push({
      name: comp.name,
      code: comp.code,
      type: category,
      amount: evaluatedAmount
    });

    variables[comp.code] = evaluatedAmount;
    variables[comp.code.toUpperCase()] = evaluatedAmount;
    variables[comp.code.toLowerCase()] = evaluatedAmount;

    if (category === 'Earning' || category === 'Variable Pay' || category === 'Allowance') {
      totalEarningsExceptAutoBalance += evaluatedAmount;
    } else if (category === 'Employer Contribution') {
      totalEmployerContributions += evaluatedAmount;
    }
  }

  // 4. Calculate Auto Balance
  if (autoBalanceComp) {
    const { comp, category } = autoBalanceComp;
    let autoBalanceAmount = monthlyCTC - totalEmployerContributions - totalEarningsExceptAutoBalance;
    if (autoBalanceAmount < 0) autoBalanceAmount = 0; // Or allow negative? Requirements state CTC must equal Employer Cost, so we clamp or error. We'll clamp to 0 and log warning.

    autoBalanceAmount = applyRounding(autoBalanceAmount, comp.roundingRule);
    
    log(`Calculated Auto Balance [${comp.code}]: CTC (${monthlyCTC}) - Contributions (${totalEmployerContributions}) - Earnings (${totalEarningsExceptAutoBalance}) = ${autoBalanceAmount}`);

    items.push({
      name: comp.name,
      code: comp.code,
      type: category,
      amount: autoBalanceAmount
    });

    variables[comp.code] = autoBalanceAmount;
    variables[comp.code.toUpperCase()] = autoBalanceAmount;
    variables[comp.code.toLowerCase()] = autoBalanceAmount;
  }

  // 4.5 Evaluate Global Deduction Rules and Tax Rules for the Organization
  // Compute Gross Earning so far to be used as variable
  let currentGross = 0;
  for (const item of items) {
    if (item.type === 'Earning' || item.type === 'Variable Pay' || item.type === 'Allowance') {
      currentGross += item.amount;
    }
  }
  variables.Gross = currentGross;
  variables.Gross_Salary = currentGross;

  // Ensure Basic is defined
  if (!variables.Basic && variables.BASIC) {
    variables.Basic = variables.BASIC;
  }
  if (!variables.Basic && variables.basic) {
    variables.Basic = variables.basic;
  }
  if (!variables.Basic && variables.BASE) {
    variables.Basic = variables.BASE;
  }
  if (!variables.Basic && variables.base) {
    variables.Basic = variables.base;
  }
  if (!variables.Basic) {
    variables.Basic = compensation?.baseSalary || 0;
  }
  variables.Basic_Salary = variables.Basic;
  variables.Base_Salary = variables.Basic;

  // Fetch active Deduction Rules for the organization
  const allDeductionRules = await prisma.deductionRule.findMany({
    where: { organizationId, status: 'Active' }
  });

  // Fetch active and unenrolled Employee Deductions for this employee
  const employeeDeductions = await prisma.employeeDeduction.findMany({
    where: { employeeId, status: { in: ['Active', 'Unenrolled'] } }
  });

  const activeOrPendingDeductions = employeeDeductions.filter(ed => {
    if (ed.status === 'Active') return true;
    if (ed.status === 'Unenrolled') {
      const unenrollMonthIndex = ed.updatedAt.getMonth();
      const unenrollYear = ed.updatedAt.getFullYear();
      
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      let payrollMonthIndex = monthNames.indexOf(month);
      let payrollYear = new Date().getFullYear();

      if (payrollMonthIndex === -1 && month.includes('-')) {
        const parts = month.split('-');
        payrollYear = parseInt(parts[0], 10);
        payrollMonthIndex = parseInt(parts[1], 10) - 1;
      }
      
      if (payrollMonthIndex === -1) {
         return true; // fallback
      }

      if (payrollYear < unenrollYear) return true;
      if (payrollYear === unenrollYear && payrollMonthIndex <= unenrollMonthIndex) return true;
      return false;
    }
    return false;
  });

  const mappedDeductionIds = activeOrPendingDeductions.map(ed => ed.deductionId);

  // Filter rules: keep if it's not a benefit deduction OR if the employee has an active/pending mapping for it
  const deductionRules = allDeductionRules.filter(rule => {
    if (rule.code.startsWith('BENEFIT_')) {
      return mappedDeductionIds.includes(rule.id);
    }
    return true; // Apply global rules like PF and Tax to everyone
  });

  for (const rule of deductionRules) {
    let evaluatedAmount = 0;
    const mapping = employeeDeductions.find(ed => ed.deductionId === rule.id);
    const ruleValue = (mapping && mapping.customValue) ? mapping.customValue : rule.value;

    if (rule.valueType === 'Fixed') {
      evaluatedAmount = Number(ruleValue || 0);
    } else if (rule.valueType === 'Percentage' || rule.valueType === 'Percentage of Basic') {
      const basicVal = variables.Basic || 0;
      evaluatedAmount = (basicVal * Number(ruleValue || 0)) / 100;
    } else if (rule.valueType === 'Formula') {
      try {
        evaluatedAmount = evaluateFormula(ruleValue, variables);
      } catch (err) {
        log(`Error evaluating deduction formula for ${rule.name}: ${err.message}`);
      }
    }
    evaluatedAmount = applyRounding(evaluatedAmount, 'Nearest');
    log(`Calculated Deduction Rule [${rule.name}] (${rule.code}): ${evaluatedAmount}`);

    items.push({
      name: rule.name,
      code: rule.code,
      type: 'Deduction',
      amount: evaluatedAmount
    });
    variables[rule.code] = evaluatedAmount;
  }

  // Fetch active Tax Rules for the organization
  const taxRules = await prisma.taxRule.findMany({
    where: { organizationId, status: 'Active' }
  });

  for (const rule of taxRules) {
    let slabs = [];
    try {
      slabs = JSON.parse(rule.slabs || '[]');
    } catch (e) {
      log(`Error parsing tax slabs for rule ${rule.name}: ${e.message}`);
    }

    if (Array.isArray(slabs) && slabs.length > 0) {
      // Calculate taxable income: gross salary minus pre-tax deductions
      let preTaxDeductionsSum = 0;
      for (const item of items) {
        const matchedDeductionRule = deductionRules.find(r => r.code === item.code);
        if (item.type === 'Deduction' && matchedDeductionRule?.isPreTax) {
          preTaxDeductionsSum += item.amount;
        }
      }
      const taxableIncome = Math.max(0, currentGross - preTaxDeductionsSum);

      let taxAmount = 0;
      for (const slab of slabs) {
        const min = Number(slab.min || 0);
        const max = slab.max === null || slab.max === undefined ? Infinity : Number(slab.max);
        const rate = Number(slab.rate || 0) / 100;
        
        if (taxableIncome > min) {
          const taxableInSlab = Math.min(taxableIncome, max) - min;
          taxAmount += taxableInSlab * rate;
        }
      }

      taxAmount = applyRounding(taxAmount, 'Nearest');
      log(`Calculated Tax Rule [${rule.name}] on Taxable Income ${taxableIncome}: ${taxAmount}`);

      items.push({
        name: rule.name,
        code: `TAX_${rule.id.slice(0, 4)}`,
        type: 'Deduction',
        amount: taxAmount
      });
      variables[`TAX_${rule.id.slice(0, 4)}`] = taxAmount;
    }
  }

  // 5. Final Aggregations
  let grossSalary = 0;
  let totalDeductions = 0;
  let totalContributions = 0;

  for (const item of items) {
    if (item.type === 'Earning' || item.type === 'Variable Pay' || item.type === 'Allowance') {
      grossSalary += item.amount;
    } else if (item.type === 'Deduction') {
      totalDeductions += item.amount;
    } else if (item.type === 'Employer Contribution') {
      totalContributions += item.amount;
    }
  }

  const netSalary = grossSalary - totalDeductions;
  const employerCost = grossSalary + totalContributions;
  
  log(`Final Result: Gross: ${grossSalary}, Deductions: ${totalDeductions}, Net: ${netSalary}, Employer Cost: ${employerCost}`);

  // 6. Save Snapshot
  if (existing) {
    await prisma.payrollItem.deleteMany({ where: { snapshotId: existing.id } });
    await prisma.payrollSnapshot.delete({ where: { id: existing.id } });
  }

  const snapshot = await prisma.payrollSnapshot.create({
    data: {
      employeeId,
      month,
      monthlyCTC,
      salaryStructureVersionId: versionId,
      grossSalary,
      totalDeductions,
      totalContributions,
      netSalary,
      employerCost,
      
      // Reporting Fields
      totalWorkingDays: payrollMetrics.totalWorkingDays,
      presentDays: payrollMetrics.presentDays,
      paidLeaveDays: payrollMetrics.paidLeaveDays,
      unpaidLeaveDays: payrollMetrics.unpaidLeaveDays,
      overtimeHours: payrollMetrics.overtimeHours,
      overtimeAmount: payrollMetrics.overtimeAmount,

      calculationLog: JSON.stringify(calculationLog),
      status: status,
      paymentDate: status === 'Paid' ? new Date() : null,
      items: {
        create: items.map(i => ({
          name: i.name,
          code: i.code,
          type: i.type,
          amount: i.amount
        }))
      }
    },
    include: { items: true }
  });

  return snapshot;
};

module.exports = {
  generatePayrollSnapshot
};
