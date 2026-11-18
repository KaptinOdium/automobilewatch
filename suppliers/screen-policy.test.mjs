import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAssessment} from './screen-policy.mjs';

const policy = {maxEvidenceAgeDays:3,normalLeadWeekdays:3,severeLeadCalendarDays:7};
const match = {kind:'company-city',decision:'candidate',event:{date:'2026-11-23',category:'strike',lastChecked:'2026-11-18'}};
test('uses the owner policy and counts weekdays across a weekend', () => {
  assert.equal(projectAssessment(match,null,'2026-11-18'),'');
  assert.match(projectAssessment(match,policy,'2026-11-18'),/procurement exposure/);
  const later = {...match,event:{...match.event,date:'2026-11-24'}};
  assert.match(projectAssessment(later,policy,'2026-11-18'),/window/);
  assert.match(projectAssessment({...later,event:{...later.event,screening:{severe:true}}},policy,'2026-11-18'),/procurement exposure/);
});
test('stale and area-only evidence cannot clear escalation gates', () => {
  assert.match(projectAssessment(match,policy,'2026-11-24'),/Reconfirm/);
  assert.match(projectAssessment({...match,kind:'locality'},policy,'2026-11-18'),/local site/);
});
