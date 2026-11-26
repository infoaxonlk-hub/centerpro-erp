import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colomboDateTimeToISOString, isCalendarDate } from '../lib/water-treatment-dates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');

test('Water Treatment registry pages require the module permission and list RLS-visible plants', () => {
  const layout = read('app/dashboard/water-treatment/layout.tsx');
  const page = read('app/dashboard/water-treatment/page.tsx');
  assert.match(layout, /requirePermission\("water_treatment", "water_treatment"\)/);
  assert.match(page, /readAll<PlantListRow>\(s, "water_treatment_plants"/);
  assert.match(page, /readAll<CustomerRow>\(s, "customers"/);
  assert.match(page, /\/dashboard\/water-treatment\/new/);
});

test('plant writes derive organization and center server-side and do not expose deletes', () => {
  const actions = read('app/dashboard/water-treatment/actions.ts');
  const form = read('app/dashboard/water-treatment/plant-form.tsx');
  assert.match(actions, /requirePermission\("water_treatment", "water_treatment"\)/);
  assert.match(actions, /\.eq\("organization_id", profile\.organization_id\)/);
  assert.match(actions, /center_id: customer\.center_id/);
  assert.match(actions, /organization_id: profile\.organization_id, created_by: profile\.id/);
  assert.match(form, /Plant Code<input value=\{plant\?\.plant_code[^\n]*readOnly/);
  assert.doesNotMatch(actions, /\.delete\(\)/);
});

test('history form only appends allowed history types and has no edit or delete action', () => {
  const actions = read('app/dashboard/water-treatment/actions.ts');
  const form = read('app/dashboard/water-treatment/plant-history-form.tsx');
  const migration = read('supabase/migrations/067_water_treatment_plants.sql');
  assert.match(actions, /\["installation", "service", "repair", "maintenance", "inspection"\]/);
  assert.match(actions, /recorded_by: profile\.id/);
  assert.match(form, /addPlantHistory\(form\)/);
  assert.doesNotMatch(actions, /water_treatment_plant_history"\)\.update|water_treatment_plant_history"\)\.delete/);
  assert.match(migration, /before update or delete on public\.water_treatment_plant_history/);
});

test('installation and next-service dates must be real Gregorian calendar dates', () => {
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2000-02-29'), true);
  assert.equal(isCalendarDate('1900-02-29'), false);
  assert.equal(isCalendarDate('2025-02-29'), false);
  assert.equal(isCalendarDate('2024-04-31'), false);
  assert.equal(isCalendarDate('2024-13-01'), false);
  assert.equal(isCalendarDate('2024-2-01'), false);
  const actions = read('app/dashboard/water-treatment/actions.ts');
  assert.match(actions, /isCalendarDate\(installationDate\)/);
  assert.match(actions, /isCalendarDate\(nextServiceDate\)/);
  assert.match(actions, /real installation date/);
  assert.match(actions, /real next service date/);
});

test('datetime-local values are interpreted in Asia/Colombo independently of server timezone', () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu';
    assert.equal(colomboDateTimeToISOString('2025-01-02T12:34'), '2025-01-02T07:04:00.000Z');
    assert.equal(colomboDateTimeToISOString('2025-01-02T00:15'), '2025-01-01T18:45:00.000Z');
    assert.equal(colomboDateTimeToISOString('2024-02-29T23:59:59.125'), '2024-02-29T18:29:59.125Z');
    assert.equal(colomboDateTimeToISOString('2025-02-29T12:00'), null);
    assert.equal(colomboDateTimeToISOString('2025-01-02T24:00'), null);
    assert.equal(colomboDateTimeToISOString('2025-01-02 12:34'), null);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  const actions = read('app/dashboard/water-treatment/actions.ts');
  assert.match(actions, /colomboDateTimeToISOString\(occurredAt\)/);
  assert.match(actions, /occurred_at: occurredAtUtc/);
  assert.doesNotMatch(actions, /new Date\(occurredAt\)/);
});
