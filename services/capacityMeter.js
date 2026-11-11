/**
 * Capacity Meter Utility for Timetable and Semester Subject Sets
 *
 * Matrix standard:
 * - Mon–Sat x 9 periods = 54 periods per week (separate Saturday order)
 * - Mon–Fri x 9 periods = 45 periods per week (copy of weekday order)
 */

function computeCapacity(set, saturdayMode = 'separate') {
  const isSeparate = saturdayMode !== 'copy_weekday';
  const totalCapacity = isSeparate ? 54 : 45;

  const subjects = Array.isArray(set?.subjects) ? set.subjects : [];
  const flagged = [];

  let allotted = 0;
  let theorySlotsTotal = 0;
  let labSlotsTotal = 0;

  subjects.forEach(s => {
    let subSlots = 0;
    if (s.isBlend) {
      const t = Number(s.blendTheorySlots) || 0;
      const l = Number(s.blendLabSlots) || 0;
      subSlots = t + l;
      theorySlotsTotal += t;
      labSlotsTotal += l;
      if (subSlots === 0) {
        flagged.push({
          type: 'warning',
          message: `Blend subject (${s.subjectName || 'Subject'}) has 0 allocated theory/lab slots.`
        });
      }
    } else {
      subSlots = Number(s.slotsTarget ?? s.slotsMin ?? 5);
      if (s.component === 'lab') {
        labSlotsTotal += subSlots;
      } else {
        theorySlotsTotal += subSlots;
      }
      if (subSlots <= 0) {
        flagged.push({
          type: 'warning',
          message: `Subject (${s.subjectName || 'Subject'}) has 0 weekly target slots.`
        });
      }
    }
    allotted += subSlots;
  });

  const free = Math.max(0, totalCapacity - allotted);
  const isOverCapacity = allotted > totalCapacity;

  if (isOverCapacity) {
    flagged.push({
      type: 'blocker',
      message: `Over-capacity: Total allotted slots (${allotted}) exceed matrix capacity (${totalCapacity}) by ${allotted - totalCapacity} slots.`
    });
  } else if (free > 0) {
    flagged.push({
      type: 'info',
      message: `${free} free slot${free === 1 ? '' : 's'} remaining; top-up engine will assign additional priority periods.`
    });
  }

  if (!isSeparate && allotted > 45) {
    flagged.push({
      type: 'blocker',
      message: `Saturday mode is set to 'copy weekday' (max 45 distinct slots), but ${allotted} slots are allocated.`
    });
  }

  // Combined groups analysis
  const combinedGroups = Array.isArray(set?.combinedGroups) ? set.combinedGroups : [];
  const combinedSubjectsCount = combinedGroups.length;

  return {
    saturdayMode: isSeparate ? 'separate' : 'copy_weekday',
    totalCapacity,
    allotted,
    free,
    isOverCapacity,
    theorySlotsTotal,
    labSlotsTotal,
    combinedSubjectsCount,
    summaryText: `Allotted ${allotted}, Capacity ${totalCapacity}, ${free} free`,
    flagged
  };
}

module.exports = {
  computeCapacity,
};
