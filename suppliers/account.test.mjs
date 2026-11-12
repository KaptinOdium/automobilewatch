import test from 'node:test';
import assert from 'node:assert/strict';

let run = 0;
const hash = 'b'.repeat(64);
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function page(suffix, members = [{ user_id: 'member', active: true, role: 'editor', display_name: 'Member' }]) {
  const ids = ['accountNotice', 'newPassword', 'confirmPassword', 'passwordForm', 'setPasswordButton', 'nextStep'];
  const nodes = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', disabled: false,
    hidden: ['passwordForm', 'nextStep'].includes(id), events: {},
    addEventListener(type, callback) { this.events[type] = callback; }, focus() {} }]));
  const events = {}, calls = [], replacements = [];
  const previous = Object.fromEntries(['document', 'window', 'location', 'history', 'fetch'].map(key => [key, globalThis[key]]));
  globalThis.document = { getElementById: id => nodes[id] };
  globalThis.window = { addEventListener: (type, callback) => events[type] = callback };
  globalThis.location = { href: 'https://example.test/suppliers/account.html' + suffix };
  globalThis.history = { replaceState: (_state, _title, path) => replacements.push(path) };
  globalThis.fetch = async (url, options) => {
    assert.equal(replacements.length, 1, 'callback URL must be scrubbed before any request');
    calls.push({ url, options });
    if (url === './config.json') return json({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_example' });
    if (url.endsWith('/verify')) return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    if (url.endsWith('/user')) return json({ id: 'member', email: 'member@example.test' });
    if (url.includes('/supplier_members?')) return json(members);
    if (url.includes('/logout')) return json(null, 204);
    throw new Error('Unexpected request');
  };
  await import('./account.mjs?page-test=' + ++run);
  await tick();
  return { nodes, calls, replacements, events, restore() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  } };
}

test('invalid account callback is scrubbed and makes no requests', async () => {
  const p = await page('?token_hash=do-not-log&type=invite');
  try {
    assert.deepEqual(p.replacements, ['/suppliers/account.html']);
    assert.equal(p.calls.length, 0);
    assert.equal(p.nodes.passwordForm.hidden, true);
    assert.match(p.nodes.accountNotice.textContent, /invalid/);
  } finally { p.restore(); }
});

test('invited member sets password and returns to normal sign-in without supplier reads', async () => {
  const p = await page('#token_hash=' + hash + '&type=invite');
  try {
    assert.equal(p.nodes.passwordForm.hidden, false);
    p.nodes.newPassword.value = 'a-private-unique-passphrase';
    p.nodes.confirmPassword.value = 'different';
    await p.nodes.passwordForm.events.submit({ preventDefault() {} });
    assert.match(p.nodes.accountNotice.textContent, /do not match/);
    assert.equal(p.calls.some(call => call.options?.method === 'PUT'), false);
    p.nodes.confirmPassword.value = p.nodes.newPassword.value;
    await p.nodes.passwordForm.events.submit({ preventDefault() {} });
    assert.equal(p.nodes.passwordForm.hidden, true);
    assert.equal(p.nodes.newPassword.value, '');
    assert.equal(p.nodes.confirmPassword.value, '');
    assert.equal(p.nodes.nextStep.hidden, false);
    assert.match(p.nodes.accountNotice.textContent, /password is saved/);
    assert.equal(p.calls.some(call => call.url.includes('supplier_datasets')), false);
    assert.equal(p.calls.some(call => call.url.includes(hash)), false);
  } finally { p.restore(); }
});

test('non-member recovery callback never shows password form or supplier data', async () => {
  const p = await page('#token_hash=' + hash + '&type=recovery', []);
  try {
    assert.equal(p.nodes.passwordForm.hidden, true);
    assert.match(p.nodes.accountNotice.textContent, /not been invited/);
    assert.equal(p.calls.some(call => call.url.includes('supplier_datasets')), false);
  } finally { p.restore(); }
});

test('leaving account page clears forms and back navigation cannot restore setup', async () => {
  const p = await page('#token_hash=' + hash + '&type=recovery');
  try {
    p.nodes.newPassword.value = 'private-not-yet-saved';
    p.events.pagehide();
    assert.equal(p.nodes.newPassword.value, '');
    assert.equal(p.nodes.passwordForm.hidden, true);
    p.events.pageshow({ persisted: true });
    assert.match(p.nodes.accountNotice.textContent, /session has ended/);
    assert.equal(p.nodes.passwordForm.hidden, true);
  } finally { p.restore(); }
});
