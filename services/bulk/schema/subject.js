const columns = [
  {
    key: 'name',
    label: 'SubjectName',
    required: true,
    aliases: ['subjectname', 'name', 'title', 'subjecttitle'],
    example: 'Operating Systems',
    help: 'Official curricular subject course title',
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'SubjectName missing';
      return null;
    }
  },
  {
    key: 'code',
    label: 'Code',
    required: true,
    aliases: ['code', 'subjectcode'],
    example: 'CS302',
    help: 'Unique curricular subject code',
    normalize: v => String(v || '').trim().toUpperCase(),
    validate: (v) => {
      if (!v) return 'SubjectCode missing';
      return null;
    }
  },
  {
    key: 'department',
    label: 'Department',
    required: true,
    aliases: ['department', 'dept', 'deptname', 'deptcode'],
    example: 'CSE',
    help: 'Department code or official department name',
    normalize: v => String(v || '').trim(),
    validate: (v) => {
      if (!v) return 'Department missing';
      return null;
    }
  },
  {
    key: 'credits',
    label: 'Credits',
    required: false,
    aliases: ['credits', 'credit'],
    example: '4',
    help: 'Academic credit weighting (defaults to 3)',
    normalize: v => Number(v) || 3,
    validate: () => null
  },
  {
    key: 'type',
    label: 'Type',
    required: false,
    aliases: ['type', 'subjecttype'],
    example: 'Theory',
    help: 'Theory or Practical (defaults to Theory)',
    normalize: v => String(v || 'Theory').trim() || 'Theory',
    validate: () => null
  }
];

module.exports = {
  type: 'subject',
  label: 'Subjects',
  columns,
  uniqueKeys: ['code']
};
