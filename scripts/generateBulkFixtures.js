const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures', 'bulk');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

async function buildFixtures() {
  // 1. Dept fixture
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Departments');
    ws.addRow(['Name', 'Code', 'Number', 'CourseType', 'Branch']);
    // Clean row
    ws.addRow(['Computer Science & Engineering', 'CSE', '101', 'UG', 'B.E']);
    // Bad row: missing code and courseType
    ws.addRow(['Mechanical Engineering', '', '102', '', 'B.E']);
    // Bad row: missing name
    ws.addRow(['', 'ECE', '103', 'UG', 'B.E']);
    await wb.xlsx.writeFile(path.join(fixturesDir, 'dept.xlsx'));
  }

  // 2. Teacher fixture
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Teachers');
    ws.addRow(['Name', 'Department', 'EmployeeID', 'Designation', 'Email', 'Username', 'Password']);
    // Clean row
    ws.addRow(['Dr. Alice Smith', 'Computer Science & Engineering', 'EMP1001', 'Professor', 'alice.smith@example.com', 'alicesmith', 'Teacher@123']);
    // Bad row: invalid email containing letter s (which used to be blocked by A3)
    ws.addRow(['Dr. Samuel Stone', 'Computer Science & Engineering', 'EMP1002', 'Assoc Professor', 'samuel.stone@example.com', 'samuelstone', 'Teacher@123']);
    // Bad row: missing name & username
    ws.addRow(['', 'Computer Science & Engineering', 'EMP1003', 'Asst Professor', 'no.name@example.com', '', 'Teacher@123']);
    await wb.xlsx.writeFile(path.join(fixturesDir, 'teacher.xlsx'));
  }

  // 3. Class fixture
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Classes');
    ws.addRow(['Department', 'HallNo', 'Semester', 'Batch', 'Year']);
    // Clean row
    ws.addRow(['Computer Science & Engineering', 'LH-101', 'III', '2025-2029', 'II Year']);
    // Bad row: missing hallNo
    ws.addRow(['Computer Science & Engineering', '', 'IV', '2025-2029', 'II Year']);
    // Bad row: missing department
    ws.addRow(['', 'LH-102', 'V', '2025-2029', 'III Year']);
    await wb.xlsx.writeFile(path.join(fixturesDir, 'class.xlsx'));
  }

  // 4. Subject fixture
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Subjects');
    ws.addRow(['SubjectName', 'Code', 'Credits', 'Type', 'Department']);
    // Clean row
    ws.addRow(['Data Structures', 'CS201', '4', 'Theory', 'Computer Science & Engineering']);
    // Bad row: missing code
    ws.addRow(['Algorithms Laboratory', '', '2', 'Practical', 'Computer Science & Engineering']);
    // Bad row: missing department
    ws.addRow(['Database Systems', 'CS202', '3', 'Theory', '']);
    await wb.xlsx.writeFile(path.join(fixturesDir, 'subject.xlsx'));
  }

  // 5. Student fixture
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Students');
    ws.addRow([
      'FullName', 'RegisterNo', 'Gender', 'AcademicYear', 'Batch',
      'CourseType', 'Branch', 'Department', 'Class', 'Email',
      'Username', 'Password', 'Residency'
    ]);
    // Clean row with s in email
    ws.addRow([
      'Joseph Stalin', 'REG2025001', 'Male', '2025-2026', '2025-2029',
      'UG', 'B.E', 'Computer Science & Engineering', '25-29 CSE', 'joseph.stalin@student.college.edu',
      'jstalin', 'Student@123', 'dayscholar'
    ]);
    // Bad row: invalid email (no domain/at)
    ws.addRow([
      'Jane Doe', 'REG2025002', 'Female', '2025-2026', '2025-2029',
      'UG', 'B.E', 'Computer Science & Engineering', '25-29 CSE', 'notanemail',
      'jdoe', 'Student@123', 'hosteller'
    ]);
    // Bad row: missing regNo & invalid courseType
    ws.addRow([
      'Bob Smith', '', 'Male', '2025-2026', '2025-2029',
      'INVALID_COURSE', 'B.E', 'Computer Science & Engineering', '25-29 CSE', 'bob.smith@student.college.edu',
      'bsmith', 'Student@123', 'dayscholar'
    ]);
    await wb.xlsx.writeFile(path.join(fixturesDir, 'student.xlsx'));
  }

  console.log('Successfully generated 5 fixture workbooks in', fixturesDir);
}

buildFixtures().catch(err => {
  console.error('Error generating fixtures:', err);
  process.exit(1);
});
