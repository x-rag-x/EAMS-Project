// Helper: compute day-of-week string from "YYYY-MM-DD"
function dateToDow(dateStr) {
  if (!dateStr) return 'Sunday';
  const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
  const d = new Date(cleanStr + 'T00:00:00.000Z');
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()] || 'Sunday';
}

// Helper: returns 1-based ordinal of a Saturday within its month (1st Sat, 2nd Sat…)
function satOrdinal(dateStr) {
  if (!dateStr) return 0;
  const cleanStr = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
  const d = new Date(cleanStr + 'T00:00:00.000Z');
  if (d.getUTCDay() !== 6) return 0;
  let count = 0;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  for (let day = 1; day <= d.getUTCDate(); day++) {
    const nd = new Date(Date.UTC(year, month, day));
    if (nd.getUTCDay() === 6) count++;
  }
  return count; // 1, 2, 3…
}

module.exports = { dateToDow, satOrdinal };