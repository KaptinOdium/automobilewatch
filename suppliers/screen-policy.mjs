const DAY = 86400000;
function utcDay(value) {
  const text = typeof value === 'string' ? value.slice(0,10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(text+'T00:00:00Z') : NaN;
}

function weekdaysUntil(now, target) {
  const days = Math.round((target-now)/DAY);
  let weekdays = Math.floor(days/7)*5;
  for (let d = days - days%7 + 1; d <= days; d++) {
    const weekday = new Date(now + d*DAY).getUTCDay();
    if (weekday !== 0 && weekday !== 6) weekdays++;
  }
  return weekdays;
}

// Project-specific thresholds and procurement checks come from the member's
// private register. This assesses a lead independently of the upstream decision.
export function projectAssessment(match, policy, today) {
  if (!policy || !Number.isInteger(policy.maxEvidenceAgeDays)) return '';
  const event = match.event;
  const now = utcDay(today);
  const checked = utcDay(event.reviewedAt || event.lastChecked);
  const start = utcDay(event.date);
  const saved = event.screening || {};
  if (!Number.isFinite(checked) || now - checked > policy.maxEvidenceAgeDays * DAY)
    return 'Reconfirm the event and continuing impact before escalation.';
  if (event.category === 'strike' && start > now) {
    const severe = saved.severe === true;
    const within = severe ? (start-now)/DAY <= policy.severeLeadCalendarDays :
      weekdaysUntil(now,start) <= policy.normalLeadWeekdays;
    if (!within) return 'Monitor until the project’s preventive screening window opens.';
  }
  if (match.kind === 'locality') return 'Check the local site, access or freight impact with an operator or authority.';
  if (match.kind === 'company-only') return 'Verify the affected legal entity and operating site before checking procurement exposure.';
  if (match.decision === 'watch' || match.decision === 'unreviewed')
    return 'Monitor and corroborate operational impact before a buyer alert.';
  if (saved.exposureVerified !== true || saved.operationalImpactVerified !== true || saved.buyerActionVerified !== true)
    return 'Internal review required. Confirm current procurement exposure, operational impact and a buyer action.';
  return 'Review the documented exposure, impact and buyer action for escalation.';
}
