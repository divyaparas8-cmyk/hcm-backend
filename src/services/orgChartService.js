// ============================================================
// Org Chart Service
// ============================================================
// Builds a fully nested hierarchical tree structure for the
// Organization Chart from departments and employees.
// Uses exactly 2 database queries (departments + employees)
// and assembles the tree in O(N) time using hash maps.

const prisma = require('../config/prisma');

/**
 * Builds the complete org chart tree for a given organization.
 * @param {string} organizationId - The tenant organization ID.
 * @param {string|null} departmentId - Optional: load only a specific branch.
 * @returns {Object} { organization, tree, unassignedEmployees, stats }
 */
const buildOrgChart = async (organizationId, departmentId = null) => {
  // 1. Fetch organization info
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      industry: true,
    },
  });

  if (!organization) {
    throw new Error('Organization not found');
  }

  // 2. Fetch all departments (Query 1)
  const departmentWhere = { organizationId };
  const departments = await prisma.department.findMany({
    where: departmentWhere,
    select: {
      id: true,
      name: true,
      code: true,
      head: true,
      color: true,
      status: true,
      description: true,
      parentId: true,
      parent: true,
      _count: { select: { employees: true } },
    },
    orderBy: { name: 'asc' },
  });

  // 3. Fetch all employees with user and manager info (Query 2)
  const employees = await prisma.employeeProfile.findMany({
    where: {
      user: { organizationId },
    },
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      employeeId: true,
      phone: true,
      address: true,
      bio: true,
      joiningDate: true,
      departmentId: true,
      managerId: true,
      employmentType: true,
      lifecycleStatus: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
        },
      },
      department: {
        select: {
          id: true,
          name: true,
          code: true,
          color: true,
        },
      },
      manager: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          user: {
            select: {
              role: true,
            },
          },
        },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  // 4. Build department tree using hash map — O(N) with cycle detection
  const deptMap = new Map();
  const rootDepts = [];

  // Initialize department nodes
  for (const dept of departments) {
    deptMap.set(dept.id, {
      type: 'department',
      id: dept.id,
      name: dept.name,
      code: dept.code,
      head: dept.head,
      color: dept.color || '#4f46e5',
      status: dept.status || 'Active',
      description: dept.description || '',
      parentId: dept.parentId,
      parentName: dept.parent || 'Corporate',
      employeeCount: dept._count.employees,
      children: [],    // child departments
      employees: [],   // root-level employees in this department
      allMembers: [],  // all employees assigned to this department
    });
  }

  // Detect and break circular parentId references in departments
  for (const dept of departments) {
    const visited = new Set([dept.id]);
    let currParentId = dept.parentId;
    while (currParentId && deptMap.has(currParentId)) {
      if (visited.has(currParentId)) {
        console.warn(`[orgChart] Circular parentId detected for department ${dept.name} (${dept.id}). Disconnecting.`);
        const node = deptMap.get(dept.id);
        if (node) node.parentId = null;
        break;
      }
      visited.add(currParentId);
      const parentNode = deptMap.get(currParentId);
      currParentId = parentNode?.parentId;
    }
  }

  // Link departments to their parents
  for (const dept of departments) {
    const node = deptMap.get(dept.id);
    if (node.parentId && deptMap.has(node.parentId)) {
      deptMap.get(node.parentId).children.push(node);
    } else {
      rootDepts.push(node);
    }
  }

  // 5. Build employee reporting tree within each department — O(N) with cycle detection
  const empMap = new Map();

  // Initialize employee nodes
  for (const emp of employees) {
    empMap.set(emp.id, {
      type: 'employee',
      id: emp.id,
      employeeId: emp.employeeId,
      fullName: emp.fullName,
      avatarUrl: emp.avatarUrl || null,
      email: emp.user?.email,
      role: emp.user?.role || 'Employee',
      userStatus: emp.user?.status || 'Active',
      phone: emp.phone || null,
      address: emp.address || null,
      bio: emp.bio || null,
      joiningDate: emp.joiningDate,
      employmentType: emp.employmentType || 'Full-time',
      lifecycleStatus: emp.lifecycleStatus || 'ACTIVE',
      departmentId: emp.departmentId,
      departmentName: emp.department?.name || 'Unassigned',
      departmentCode: emp.department?.code || null,
      departmentColor: emp.department?.color || '#4f46e5',
      managerId: emp.managerId,
      managerName: emp.manager?.fullName || null,
      managerRole: emp.manager?.user?.role || null,
      managerAvatar: emp.manager?.avatarUrl || null,
      directReports: [],
    });
  }

  // Detect and break circular managerId reporting chains
  for (const emp of employees) {
    const visited = new Set([emp.id]);
    let currManagerId = emp.managerId;
    while (currManagerId && empMap.has(currManagerId)) {
      if (visited.has(currManagerId)) {
        console.warn(`[orgChart] Circular reporting line detected for employee ${emp.fullName} (${emp.id}). Breaking loop.`);
        const node = empMap.get(emp.id);
        if (node) node.managerId = null;
        break;
      }
      visited.add(currManagerId);
      const managerNode = empMap.get(currManagerId);
      currManagerId = managerNode?.managerId;
    }
  }

  // Build manager → reports tree
  const rootEmployees = []; // employees with no manager or manager not in this org
  for (const emp of employees) {
    const empNode = empMap.get(emp.id);
    if (empNode.managerId && empMap.has(empNode.managerId)) {
      empMap.get(empNode.managerId).directReports.push(empNode);
    } else {
      rootEmployees.push(empNode);
    }
  }

  // 6. Attach employees to their department nodes
  for (const emp of employees) {
    const empNode = empMap.get(emp.id);
    if (emp.departmentId && deptMap.has(emp.departmentId)) {
      const dept = deptMap.get(emp.departmentId);
      // Track in allMembers list
      dept.allMembers.push(empNode);

      // Only add root-level employees (no manager or manager in different dept)
      // to department.employees to avoid duplicate cards in the tree
      const isRootInDept = !emp.managerId || !empMap.has(emp.managerId) ||
        empMap.get(emp.managerId).departmentId !== emp.departmentId;
      if (isRootInDept) {
        dept.employees.push(empNode);
      }
    }
  }

  // 7. Handle unassigned employees (no department)
  const unassignedEmployees = rootEmployees.filter(e => !e.departmentId);
  const allUnassigned = employees.filter(e => !e.departmentId).map(e => empMap.get(e.id));

  // If unassigned employees exist and no specific department is filtered, add an "Unassigned Staff" branch
  if (!departmentId && allUnassigned.length > 0) {
    const unassignedNode = {
      type: 'department',
      id: 'unassigned-dept',
      name: 'Unassigned Staff',
      code: 'UNASSIGNED',
      head: null,
      color: '#64748b',
      status: 'Active',
      description: 'Staff members currently not assigned to a department',
      parentId: null,
      parentName: 'Corporate',
      employeeCount: allUnassigned.length,
      children: [],
      employees: unassignedEmployees,
      allMembers: allUnassigned,
    };
    rootDepts.push(unassignedNode);
  }

  // If filtering by specific department, return just that branch
  if (departmentId && deptMap.has(departmentId)) {
    return {
      organization,
      tree: [deptMap.get(departmentId)],
      unassignedEmployees: allUnassigned,
      stats: {
        totalDepartments: 1,
        totalEmployees: deptMap.get(departmentId).allMembers.length,
        rootDepartments: 1,
        unassignedCount: allUnassigned.length,
      },
    };
  }

  return {
    organization,
    tree: rootDepts,
    unassignedEmployees: allUnassigned,
    stats: {
      totalDepartments: departments.length,
      totalEmployees: employees.length,
      rootDepartments: rootDepts.length,
      unassignedCount: allUnassigned.length,
    },
  };
};

module.exports = { buildOrgChart };
