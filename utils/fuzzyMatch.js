/**
 * utils/fuzzyMatch.js
 *
 * Zero-dependency entity resolution & fuzzy matching engine for EAMS Timetable Import.
 * Resolves course codes, teacher names, special activities, and room numbers
 * using normalized Levenshtein distance, token overlap, institutional designation stripping,
 * and course legend cross-referencing.
 */

// ── Standard Levenshtein Distance (DP matrix) ──
function levenshteinDistance(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;
  const s1 = String(a).toLowerCase().trim();
  const s2 = String(b).toLowerCase().trim();
  if (s1 === s2) return 0;

  const m = s1.length;
  const n = s2.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost     // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  return prev[n];
}

// ── Normalized String Similarity (0.0 to 1.0) ──
function stringSimilarity(a, b) {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;
  const s1 = String(a).toLowerCase().trim();
  const s2 = String(b).toLowerCase().trim();
  if (s1 === s2) return 1.0;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, parseFloat((1 - dist / maxLen).toFixed(3)));
}

// ── Token Set Similarity (handles word order differences e.g. "S. Ramasamy" vs "Ramasamy S") ──
function tokenize(str) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

function tokenSimilarity(a, b) {
  const t1 = tokenize(a);
  const t2 = tokenize(b);
  if (t1.length === 0 || t2.length === 0) return 0.0;

  const set2 = new Set(t2);
  let matches = 0;

  for (const tok of t1) {
    if (set2.has(tok)) {
      matches += 1.0;
    } else {
      // Partial match for abbreviations or typos in tokens
      for (const s of set2) {
        if (tok.length > 2 && s.length > 2 && (tok.includes(s) || s.includes(tok) || levenshteinDistance(tok, s) <= 1)) {
          matches += 0.8;
          break;
        }
      }
    }
  }

  const score = (2 * matches) / (t1.length + t2.length);
  return Math.min(1.0, parseFloat(score.toFixed(3)));
}

// Combined hybrid similarity: higher of string similarity or token similarity
function hybridSimilarity(a, b) {
  const strScore = stringSimilarity(a, b);
  const tokScore = tokenSimilarity(a, b);
  return Math.max(strScore, tokScore);
}

// ── Clean Institutional Faculty Names ──
// Strips designations, departments, salutations, trailing slash annotations
function cleanFacultyName(raw) {
  if (!raw) return '';
  let str = String(raw).trim();

  // 1. Remove designations and department annotations e.g. "/ AP / CSE", "(AP/CSE)", "/ HOD", "/ Math"
  str = str.replace(/[\/\(\[\-]\s*(?:AP|ASP|PROF|PROFESSOR|HOD|DEAN|DIR|DIRECTOR|CSE|IT|ECE|EEE|MECH|CIVIL|AIDS|AIML|MATH|MATHEMATICS|PHY|PHYSICS|CHEM|CHEMISTRY|ENG|ENGLISH)[^\)\]]*[\)\]]?/gi, ' ');
  str = str.replace(/\s*[\/\\].*$/, ' '); // strip everything after a slash

  // 2. Remove salutations
  str = str.replace(/\b(?:Dr|Prof|Mr|Mrs|Ms|Er|Capt)\.?\s+/gi, ' ');

  // 3. Normalize dots and whitespace (e.g. "S. Ramasamy" -> "S Ramasamy")
  str = str.replace(/\./g, ' ');
  str = str.replace(/\s+/g, ' ').trim();

  return str;
}

// ── Clean Course Codes ──
function cleanCourseCode(code) {
  if (!code) return '';
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Generate Acronym from Course Title (e.g. "Data Structures and Algorithms" -> "DSA") ──
function generateAcronym(title) {
  if (!title) return '';
  const stopWords = new Set(['and', 'of', 'in', 'for', 'the', '&', 'to', 'with', 'a', 'an']);
  const words = String(title)
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));
  if (words.length <= 1) return '';
  return words.map(w => w[0].toUpperCase()).join('');
}

/**
 * Resolve a raw course label to a Subject, SpecialActivity, or Legend entry.
 *
 * @param {string} rawLabel - The text in the timetable grid cell (e.g. "25CSC321", "DSA", "VERBAL", "KVD LAB 2")
 * @param {Object} context - { subjects: [], specialActivities: [], legend: [] }
 * @returns {Object} Resolution result
 */
function resolveCourse(rawLabel, context = {}) {
  const { subjects = [], specialActivities = [], legend = [] } = context;
  const rawClean = String(rawLabel || '').trim();
  const rawCodeClean = cleanCourseCode(rawClean);
  const rawLower = rawClean.toLowerCase();

  if (!rawClean) {
    return { resolved: false, type: 'empty', confidence: 0, candidate: null };
  }

  // 1. Direct Exact Match against SpecialActivity (shortLabel or name)
  for (const act of specialActivities) {
    const actLabel = (act.shortLabel || '').trim().toLowerCase();
    const actName = (act.name || '').trim().toLowerCase();
    if (actLabel === rawLower || actName === rawLower) {
      return {
        resolved: true,
        type: 'activity',
        confidence: 1.0,
        activityId: act._id,
        activityLabel: act.shortLabel || act.name,
        name: act.name,
        matchSource: 'exact_activity'
      };
    }
  }

  // 2. Direct Exact Match against Subject (subjectCode, shortName, code)
  for (const subj of subjects) {
    const sCode = cleanCourseCode(subj.subjectCode || subj.code);
    const sShort = (subj.shortName || '').trim().toLowerCase();
    const sName = (subj.name || '').trim().toLowerCase();

    if (rawCodeClean && sCode && rawCodeClean === sCode) {
      return {
        resolved: true,
        type: 'subject',
        confidence: 1.0,
        subjectId: subj._id,
        subjectCode: subj.subjectCode || subj.code,
        subjectName: subj.name,
        matchSource: 'exact_subject_code'
      };
    }

    if (sShort && sShort === rawLower) {
      return {
        resolved: true,
        type: 'subject',
        confidence: 1.0,
        subjectId: subj._id,
        subjectCode: subj.subjectCode || subj.code,
        subjectName: subj.name,
        matchSource: 'exact_subject_shortname'
      };
    }

    if (sName && sName === rawLower) {
      return {
        resolved: true,
        type: 'subject',
        confidence: 1.0,
        subjectId: subj._id,
        subjectCode: subj.subjectCode || subj.code,
        subjectName: subj.name,
        matchSource: 'exact_subject_name'
      };
    }
  }

  // 3. Cross-reference with Section Legend Table
  // Check if rawLabel matches any legend item's courseCode, courseTitle, or generated acronym
  for (const leg of legend) {
    const lCodeClean = cleanCourseCode(leg.courseCode);
    const lTitleClean = (leg.courseTitle || '').trim().toLowerCase();
    const lAcronym = generateAcronym(leg.courseTitle).toLowerCase();

    const matchesLegend = (
      (rawCodeClean && lCodeClean && rawCodeClean === lCodeClean) ||
      (lTitleClean && (lTitleClean === rawLower || lTitleClean.includes(rawLower) || rawLower.includes(lTitleClean))) ||
      (lAcronym && (lAcronym === rawLower || rawLower.startsWith(lAcronym)))
    );

    if (matchesLegend) {
      // Find the corresponding DB Subject for this legend code
      const matchedSubj = subjects.find(s => cleanCourseCode(s.subjectCode || s.code) === lCodeClean);
      if (matchedSubj) {
        return {
          resolved: true,
          type: 'subject',
          confidence: 0.95,
          subjectId: matchedSubj._id,
          subjectCode: matchedSubj.subjectCode || matchedSubj.code,
          subjectName: matchedSubj.name,
          legendItem: leg,
          matchSource: 'legend_crossref'
        };
      } else {
        // Matched the legend, but Subject is not yet in DB
        return {
          resolved: true,
          type: 'legend_only',
          confidence: 0.85,
          subjectCode: leg.courseCode,
          subjectName: leg.courseTitle,
          legendItem: leg,
          matchSource: 'legend_only'
        };
      }
    }
  }

  // 4. Fuzzy Match against Subject Codes & Names
  const candidates = [];

  for (const subj of subjects) {
    const sCode = cleanCourseCode(subj.subjectCode || subj.code);
    const codeScore = rawCodeClean && sCode ? stringSimilarity(rawCodeClean, sCode) : 0;
    const nameScore = hybridSimilarity(rawClean, subj.name || '');
    const shortScore = subj.shortName ? hybridSimilarity(rawClean, subj.shortName) : 0;
    const maxScore = Math.max(codeScore, nameScore, shortScore);

    if (maxScore >= 0.70) {
      candidates.push({
        type: 'subject',
        item: subj,
        score: maxScore,
        label: `${subj.subjectCode || subj.code} - ${subj.name}`
      });
    }
  }

  // Fuzzy Match against SpecialActivities
  for (const act of specialActivities) {
    const labelScore = hybridSimilarity(rawClean, act.shortLabel || '');
    const nameScore = hybridSimilarity(rawClean, act.name || '');
    const maxScore = Math.max(labelScore, nameScore);

    if (maxScore >= 0.70) {
      candidates.push({
        type: 'activity',
        item: act,
        score: maxScore,
        label: `${act.shortLabel} (${act.name})`
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0 && candidates[0].score >= 0.82) {
    const best = candidates[0];
    if (best.type === 'subject') {
      return {
        resolved: true,
        type: 'subject',
        confidence: best.score,
        subjectId: best.item._id,
        subjectCode: best.item.subjectCode || best.item.code,
        subjectName: best.item.name,
        matchSource: 'fuzzy_subject',
        suggestions: candidates.slice(0, 3)
      };
    } else {
      return {
        resolved: true,
        type: 'activity',
        confidence: best.score,
        activityId: best.item._id,
        activityLabel: best.item.shortLabel || best.item.name,
        name: best.item.name,
        matchSource: 'fuzzy_activity',
        suggestions: candidates.slice(0, 3)
      };
    }
  }

  // 5. Unresolved Fallback
  return {
    resolved: false,
    type: 'unmatched',
    confidence: candidates.length > 0 ? candidates[0].score : 0,
    rawLabel: rawClean,
    suggestions: candidates.slice(0, 5)
  };
}

/**
 * Resolve a raw teacher name to a Teacher document in DB.
 *
 * @param {string} rawName - e.g. "Dr. S. Ramasamy / AP / CSE" or "Alice"
 * @param {Array} teachers - List of Teacher documents
 * @param {string|ObjectId} preferredDeptId - Optional department preference
 * @returns {Object} Resolution result
 */
function resolveTeacher(rawName, teachers = [], preferredDeptId = null) {
  const rawClean = String(rawName || '').trim();
  if (!rawClean) {
    return { resolved: false, confidence: 0, teacherId: null, teacherName: '' };
  }

  const cleaned = cleanFacultyName(rawClean);
  const cleanedLower = cleaned.toLowerCase();

  // 1. Exact Match against fullName
  for (const t of teachers) {
    const tName = (t.fullName || '').trim().toLowerCase();
    const tClean = cleanFacultyName(t.fullName).toLowerCase();

    if (tName === cleanedLower || tClean === cleanedLower) {
      const isDeptMatch = preferredDeptId && String(t.deptId) === String(preferredDeptId);
      return {
        resolved: true,
        confidence: isDeptMatch ? 1.0 : 0.98,
        teacherId: t._id,
        teacherTrackId: t.trackId,
        teacherName: t.fullName,
        deptId: t.deptId,
        matchSource: 'exact'
      };
    }
  }

  // 2. Token / Hybrid Similarity Match
  const candidates = [];

  for (const t of teachers) {
    const tClean = cleanFacultyName(t.fullName);
    const score = hybridSimilarity(cleaned, tClean);
    const isDeptMatch = preferredDeptId && String(t.deptId) === String(preferredDeptId);
    // Slight boost for same department
    const adjustedScore = isDeptMatch ? Math.min(1.0, score + 0.05) : score;

    if (adjustedScore >= 0.70) {
      candidates.push({
        teacher: t,
        score: parseFloat(adjustedScore.toFixed(3)),
        label: `${t.fullName} (${t.department || t.deptCode || 'Teacher'})`
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0 && candidates[0].score >= 0.80) {
    const best = candidates[0].teacher;
    return {
      resolved: true,
      confidence: candidates[0].score,
      teacherId: best._id,
      teacherTrackId: best.trackId,
      teacherName: best.fullName,
      deptId: best.deptId,
      matchSource: 'fuzzy',
      suggestions: candidates.slice(0, 3)
    };
  }

  // 3. Unresolved Fallback
  return {
    resolved: false,
    confidence: candidates.length > 0 ? candidates[0].score : 0,
    rawName: rawClean,
    cleanedName: cleaned,
    suggestions: candidates.slice(0, 5)
  };
}

/**
 * Resolve Room / Hall No to a Room document in DB.
 *
 * @param {string} rawHall - e.g. "TP-2D", "Hall 401", "Lab 2"
 * @param {Array} rooms - List of Room documents
 * @returns {Object} Resolution result
 */
function resolveRoom(rawHall, rooms = []) {
  const rawClean = String(rawHall || '').trim();
  if (!rawClean) {
    return { resolved: false, confidence: 0, roomId: null, hallNo: '' };
  }

  const cleanHall = rawClean.toUpperCase().replace(/\s+/g, ' ');
  const alphaNumHall = cleanHall.replace(/[^A-Z0-9]/g, '');

  for (const r of rooms) {
    const rHall = (r.hallNo || '').trim().toUpperCase();
    const rAlphaNum = rHall.replace(/[^A-Z0-9]/g, '');

    if (rHall === cleanHall || (alphaNumHall && rAlphaNum === alphaNumHall)) {
      return {
        resolved: true,
        confidence: 1.0,
        roomId: r._id,
        hallNo: r.hallNo,
        roomName: r.name || r.hallNo,
        capacity: r.capacity
      };
    }
  }

  // Fuzzy match
  const candidates = [];
  for (const r of rooms) {
    const score = stringSimilarity(cleanHall, r.hallNo || '');
    if (score >= 0.70) {
      candidates.push({ room: r, score, label: `${r.hallNo} (${r.name || ''})` });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0 && candidates[0].score >= 0.85) {
    const best = candidates[0].room;
    return {
      resolved: true,
      confidence: candidates[0].score,
      roomId: best._id,
      hallNo: best.hallNo,
      roomName: best.name || best.hallNo,
      capacity: best.capacity,
      matchSource: 'fuzzy'
    };
  }

  return {
    resolved: false,
    confidence: candidates.length > 0 ? candidates[0].score : 0,
    rawHall: rawClean,
    hallNo: rawClean, // Fallback preserving the text
    suggestions: candidates.slice(0, 3)
  };
}

/**
 * Comprehensive resolution for an entire parsed Section block.
 * Connects parsed slots with parsed legend items, subjects, teachers, activities, and rooms.
 *
 * @param {Object} section - Section block from timetableExcelParser
 * @param {Object} dbData - { subjects, teachers, specialActivities, rooms }
 * @param {string|ObjectId} deptId - Active Department ID
 * @returns {Object} Enriched section with resolved entities and unmatched queues
 */
function resolveSectionEntities(section, dbData = {}, deptId = null) {
  const { subjects = [], teachers = [], specialActivities = [], rooms = [] } = dbData;
  const unmatched = { courses: [], faculty: [], rooms: [] };

  // 1. Resolve Class Advisor
  let resolvedAdvisor = null;
  if (section.meta && section.meta.advisorRaw) {
    const advRes = resolveTeacher(section.meta.advisorRaw, teachers, deptId);
    if (advRes.resolved) {
      resolvedAdvisor = {
        teacherId: advRes.teacherId,
        teacherTrackId: advRes.teacherTrackId,
        teacherName: advRes.teacherName,
        confidence: advRes.confidence
      };
    } else {
      unmatched.faculty.push({
        raw: section.meta.advisorRaw,
        role: 'Class Advisor',
        suggestions: advRes.suggestions
      });
    }
  }

  // 2. Resolve Section Default Room
  let resolvedRoom = null;
  if (section.meta && section.meta.hallNo) {
    const roomRes = resolveRoom(section.meta.hallNo, rooms);
    if (roomRes.resolved) {
      resolvedRoom = {
        roomId: roomRes.roomId,
        hallNo: roomRes.hallNo,
        confidence: roomRes.confidence
      };
    } else {
      unmatched.rooms.push({
        raw: section.meta.hallNo,
        role: 'Section Classroom',
        suggestions: roomRes.suggestions
      });
    }
  }

  // 3. Resolve Legend Items (Courses & Faculty)
  const resolvedLegend = (section.legend || []).map(leg => {
    // Resolve course
    const courseRes = resolveCourse(leg.courseCode || leg.courseTitle, { subjects, specialActivities, legend: section.legend });
    // Resolve teacher
    const teacherRes = resolveTeacher(leg.facultyRaw, teachers, deptId);

    if (!courseRes.resolved) {
      unmatched.courses.push({
        raw: leg.courseCode || leg.courseTitle,
        title: leg.courseTitle,
        suggestions: courseRes.suggestions
      });
    }

    if (leg.facultyRaw && !teacherRes.resolved) {
      unmatched.faculty.push({
        raw: leg.facultyRaw,
        courseCode: leg.courseCode,
        suggestions: teacherRes.suggestions
      });
    }

    return {
      ...leg,
      resolvedSubject: courseRes.resolved ? {
        subjectId: courseRes.subjectId,
        subjectCode: courseRes.subjectCode,
        subjectName: courseRes.subjectName,
        confidence: courseRes.confidence
      } : null,
      resolvedTeacher: teacherRes.resolved ? {
        teacherId: teacherRes.teacherId,
        teacherTrackId: teacherRes.teacherTrackId,
        teacherName: teacherRes.teacherName,
        confidence: teacherRes.confidence
      } : null
    };
  });

  // Build a lookup map from legend for rapid slot assignment
  const legendCourseMap = new Map();
  resolvedLegend.forEach(leg => {
    if (leg.courseCode) legendCourseMap.set(cleanCourseCode(leg.courseCode), leg);
    if (leg.courseTitle) legendCourseMap.set(leg.courseTitle.trim().toLowerCase(), leg);
    const acr = generateAcronym(leg.courseTitle);
    if (acr) legendCourseMap.set(acr.toLowerCase(), leg);
  });

  // 4. Resolve Grid Slots
  const resolvedSlots = (section.slots || []).map(slot => {
    const courseRes = resolveCourse(slot.rawLabel, { subjects, specialActivities, legend: resolvedLegend });
    let teacherId = null;
    let teacherTrackId = '';
    let teacherName = '';

    // If course resolved to a subject, try to link the faculty assigned in the legend
    if (courseRes.type === 'subject') {
      const matchedLegend = resolvedLegend.find(l =>
        (l.resolvedSubject && String(l.resolvedSubject.subjectId) === String(courseRes.subjectId)) ||
        (l.courseCode && cleanCourseCode(l.courseCode) === cleanCourseCode(courseRes.subjectCode))
      );
      if (matchedLegend && matchedLegend.resolvedTeacher) {
        teacherId = matchedLegend.resolvedTeacher.teacherId;
        teacherTrackId = matchedLegend.resolvedTeacher.teacherTrackId;
        teacherName = matchedLegend.resolvedTeacher.teacherName;
      }
    } else if (courseRes.type === 'activity' && courseRes.activityId) {
      // If special activity has default teachers, use first
      const act = specialActivities.find(a => String(a._id) === String(courseRes.activityId));
      if (act && act.defaultTeacherIds && act.defaultTeacherIds.length > 0) {
        const defT = teachers.find(t => String(t._id) === String(act.defaultTeacherIds[0]));
        if (defT) {
          teacherId = defT._id;
          teacherTrackId = defT.trackId;
          teacherName = defT.fullName;
        }
      }
    }

    // Hall resolution for slot (uses section default room unless slot specifies a lab/hall)
    const slotHall = resolvedRoom ? resolvedRoom.hallNo : (section.meta.hallNo || '');
    const slotRoomId = resolvedRoom ? resolvedRoom.roomId : null;

    if (!courseRes.resolved && !unmatched.courses.some(c => c.raw === slot.rawLabel)) {
      unmatched.courses.push({
        raw: slot.rawLabel,
        suggestions: courseRes.suggestions
      });
    }

    return {
      day: slot.day,
      period: slot.period,
      span: slot.span || 1,
      rawLabel: slot.rawLabel,
      isLab: !!slot.isLab,
      resolvedType: courseRes.type,
      confidence: courseRes.confidence,
      subjectId: courseRes.subjectId || null,
      subjectCode: courseRes.subjectCode || '',
      subjectName: courseRes.subjectName || '',
      activityId: courseRes.activityId || null,
      activityLabel: courseRes.activityLabel || '',
      teacherId: teacherId,
      teacherTrackId: teacherTrackId,
      teacherName: teacherName,
      hallNo: slotHall,
      roomId: slotRoomId
    };
  });

  return {
    ...section,
    meta: {
      ...section.meta,
      resolvedAdvisor,
      resolvedRoom
    },
    legend: resolvedLegend,
    slots: resolvedSlots,
    unmatched
  };
}

module.exports = {
  levenshteinDistance,
  stringSimilarity,
  tokenSimilarity,
  hybridSimilarity,
  cleanFacultyName,
  cleanCourseCode,
  generateAcronym,
  resolveCourse,
  resolveTeacher,
  resolveRoom,
  resolveSectionEntities
};
