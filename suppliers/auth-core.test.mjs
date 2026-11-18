import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthClient, AccessError, ConflictError, configured, consumeAccountLink } from './auth-core.mjs';

const NOW = 1_800_000_000_000;
const config = { url: 'https://example.supabase.co', key: 'sb_publishable_example' };
const session = { access_token: 'access', refresh_token: 'refresh', expires_at: NOW / 1000 + 3600 };
const member = { user_id: 'user-1', active: true, display_name: 'Member', role: 'editor' };
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, text) => value = text, removeItem: () => value = null, value: () => value };
}
function setup({ role = 'editor', members, handler = () => response(null) } = {}) {
  const calls = [], saved = storage(), client = new AuthClient(config, { now: () => NOW, storage: saved,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/v1/user')) return response({ id: 'user-1', email: 'member@example.test' });
      if (url.includes('/supplier_members?')) return response(members ?? [{ ...member, role }]);
      return handler(url, options);
    }
  });
  client.remember(session);
  return { client, calls, saved };
}
function deferred() { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; }

test('default browser fetch keeps its required global receiver', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = function (url) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    calls++;
    assert.equal(url, config.url + '/auth/v1/health');
    return Promise.resolve(response({ ok: true }));
  };
  try {
    const client = new AuthClient(config);
    assert.deepEqual(await client.request('/auth/v1/health'), { ok: true });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('configuration only accepts HTTPS origins and public keys', () => {
  assert.equal(configured({}), null);
  assert.deepEqual(configured({ supabaseUrl: config.url + '/', supabaseAnonKey: config.key }), config);
  for (const url of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?secret=x']) {
    assert.throws(() => configured({ supabaseUrl: url, supabaseAnonKey: config.key }));
  }
  const jwt = role => 'header.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature';
  for (const key of ['sb_secret_never_publish', jwt('service_role'), 'sb_publishable_', 'invalid']) {
    assert.throws(() => configured({ supabaseUrl: config.url, supabaseAnonKey: key }));
  }
  assert.equal(configured({ supabaseUrl: config.url, supabaseAnonKey: jwt('anon') }).url, config.url);
});

test('stored sessions provide no identity until user and membership are verified', async () => {
  const saved = storage(JSON.stringify(session));
  const client = new AuthClient(config, { storage: saved, now: () => NOW, fetcher: async () => response(null, 401) });
  assert.equal(client.identity, null);
  await assert.rejects(client.verify(), AccessError);
  const corrupt = storage('{invalid');
  assert.equal(new AuthClient(config, { storage: corrupt }).session, null);
  assert.equal(corrupt.value(), null);
});

test('non-members, inactive members, and invalid roles are denied', async () => {
  for (const members of [[], [{ ...member, active: false }], [{ ...member, user_id: 'another-user' }], [{ ...member, role: 'admin' }]]) {
    const { client } = setup({ members });
    await assert.rejects(client.verify(), AccessError);
    assert.equal(client.identity, null);
  }
});

test('successful sign-in verifies membership and never persists a password', async () => {
  const { client, saved, calls } = setup({ handler: () => response(session) });
  const identity = await client.signIn('member@example.test', 'sensitive-password');
  assert.equal(identity.id, 'user-1');
  assert.equal(identity.role, 'editor');
  assert.ok(Object.isFrozen(identity));
  assert.equal(saved.value().includes('sensitive-password'), false);
  assert.equal(calls[0].options.credentials, 'omit');
});

test('failed allowlist check clears a newly signed-in session', async () => {
  const { client, saved } = setup({ members: [], handler: () => response(session) });
  await assert.rejects(client.signIn('member@example.test', 'password'), AccessError);
  assert.equal(client.session, null);
  assert.equal(saved.value(), null);
});

test('concurrent token requests share one refresh', async () => {
  const refresh = deferred();
  let refreshCount = 0;
  const { client } = setup({ handler: () => { refreshCount++; return refresh.promise; } });
  client.session.expires_at = NOW / 1000 + 10;
  const first = client.token(), second = client.token();
  refresh.resolve(response({ ...session, access_token: 'new-access' }));
  assert.deepEqual(await Promise.all([first, second]), ['new-access', 'new-access']);
  assert.equal(refreshCount, 1);
});

test('logout during refresh cannot resurrect the session', async () => {
  const refresh = deferred();
  const { client, saved } = setup({ handler: url => url.includes('refresh_token') ? refresh.promise : response(null, 204) });
  client.session.expires_at = NOW / 1000 + 10;
  const refreshing = client.token();
  await client.signOut();
  refresh.resolve(response({ ...session, access_token: 'late-access' }));
  await assert.rejects(refreshing, AccessError);
  assert.equal(client.session, null);
  assert.equal(client.identity, null);
  assert.equal(saved.value(), null);
});

test('logout during a sign-in response cannot resurrect the session', async () => {
  const login = deferred();
  const { client } = setup({ handler: () => login.promise });
  const signingIn = client.signIn('member@example.test', 'password');
  await client.signOut();
  login.resolve(response(session));
  await assert.rejects(signingIn, AccessError);
  assert.equal(client.session, null);
});

test('rejected refresh clears stored credentials', async () => {
  const { client, saved } = setup({ handler: () => response({ error: 'invalid_grant' }, 400) });
  client.session.expires_at = NOW / 1000 + 10;
  await assert.rejects(client.token(), AccessError);
  assert.equal(client.session, null);
  assert.equal(saved.value(), null);
});

test('temporary refresh failure retains credentials and permits a retry', async () => {
  for (const outage of [() => { throw Error('offline'); }, () => response(null, 503), () => response(null, 429)]) {
    let attempts = 0;
    const { client, saved } = setup({ handler: () => ++attempts === 1 ? outage() : response({ ...session, access_token: 'renewed' }) });
    client.session.expires_at = NOW / 1000 + 10;
    await assert.rejects(client.token(), error => !(error instanceof AccessError));
    assert.equal(client.session.refresh_token, 'refresh');
    assert.notEqual(saved.value(), null);
    assert.equal(client.refreshing, null);
    assert.equal(await client.token(), 'renewed');
  }
});

test('network failure on logout still clears local credentials', async () => {
  const { client, saved } = setup({ handler: () => { throw Error('offline'); } });
  await client.signOut();
  assert.equal(client.session, null);
  assert.equal(saved.value(), null);
});

test('empty RLS-filtered results cannot masquerade as an empty supplier list', async () => {
  const { client } = setup({ handler: () => response([]) });
  await assert.rejects(client.loadShared(), AccessError);
});

test('member can load only a valid main dataset', async () => {
  const dataset = { id: 'main', revision: 3, suppliers: [{ name: 'Part maker' }] };
  const { client } = setup({ handler: () => response([dataset]) });
  assert.deepEqual(await client.loadShared(), dataset);
});

test('viewer cannot issue a save RPC, and revoked members are rechecked', async () => {
  const viewer = setup({ role: 'viewer' });
  await assert.rejects(viewer.client.saveShared([], 0), /read-only/);
  assert.equal(viewer.calls.some(call => call.url.includes('/rpc/')), false);
  const revoked = setup({ members: [] });
  revoked.client.identity = { role: 'owner', id: 'user-1' };
  await assert.rejects(revoked.client.saveShared([], 0), AccessError);
  assert.equal(revoked.calls.some(call => call.url.includes('/rpc/')), false);
});

test('editor sends expected revision and receives the incremented revision', async () => {
  const { client, calls } = setup({ handler: () => response({ id: 'main', revision: 8, suppliers: [] }) });
  assert.equal((await client.saveShared([], 7)).revision, 8);
  const rpc = calls.find(call => call.url.includes('/rpc/'));
  assert.deepEqual(JSON.parse(rpc.options.body), { expected_revision: 7, supplier_rows: [] });
  assert.equal(rpc.options.headers.Authorization, 'Bearer access');
});

test('revision conflict and server access denial remain distinct', async () => {
  const conflict = setup({ handler: () => response({ code: '40001' }, 409) });
  await assert.rejects(conflict.client.saveShared([], 7), ConflictError);
  const denied = setup({ handler: () => response({ code: '42501' }, 403) });
  await assert.rejects(denied.client.saveShared([], 7), AccessError);
});

test('invalid rows and revisions fail before making a network request', async () => {
  const { client, calls } = setup();
  for (const [rows, revision] of [[[null], 0], [[[]], 0], [[], -1], [[], 0.5]]) {
    await assert.rejects(client.saveShared(rows, revision));
  }
  assert.equal(calls.length, 0);
});

const accountHash = 'a'.repeat(64);
test('account links accept only invite/recovery fragments and scrub the URL first', () => {
  for (const type of ['invite', 'recovery']) {
    let cleanPath;
    const value = consumeAccountLink('https://example.test/suppliers/account.html#token_hash=' + accountHash + '&type=' + type,
      path => cleanPath = path);
    assert.equal(cleanPath, '/suppliers/account.html');
    assert.deepEqual(value, { type, tokenHash: accountHash });
  }
  for (const suffix of ['', '?token_hash=' + accountHash + '&type=invite', '#type=signup&token_hash=' + accountHash,
    '#type=invite&token_hash=short', '#type=invite&type=recovery&token_hash=' + accountHash,
    '#type=invite&token_hash=' + accountHash + '&redirect_to=https://evil.example', '#access_token=secret']) {
    let scrubbed = false;
    assert.throws(() => consumeAccountLink('https://example.test/suppliers/account.html' + suffix,
      path => { scrubbed = true; assert.equal(path, '/suppliers/account.html'); }), AccessError);
    assert.equal(scrubbed, true);
  }
});

test('account activation verifies membership, sets own password and ends its in-memory session', async () => {
  for (const type of ['invite', 'recovery']) {
    const calls = [];
    const client = new AuthClient(config, { now: () => NOW, fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/verify')) return response(session);
      if (url.endsWith('/user')) return response({ id: 'user-1', email: 'member@example.test' });
      if (url.includes('/supplier_members?')) return response([member]);
      return response(null, 204);
    } });
    assert.equal((await client.verifyAccountLink({ type, tokenHash: accountHash })).id, 'user-1');
    assert.equal(client.storage, null);
    assert.deepEqual(JSON.parse(calls[0].options.body), { type, token_hash: accountHash });
    assert.equal(calls[0].options.method, 'POST');
    await client.setAccountPassword('a-new-unique-passphrase');
    const update = calls.find(call => call.options.method === 'PUT');
    assert.ok(update.url.endsWith('/auth/v1/user'));
    assert.deepEqual(JSON.parse(update.options.body), { password: 'a-new-unique-passphrase' });
    assert.equal(update.options.headers.Authorization, 'Bearer access');
    assert.equal(client.session, null);
    assert.equal(client.accountFlow, null);
    assert.equal(calls.some(call => call.url.includes('/supplier_datasets')), false);
  }
});

test('invalid, expired and non-member account links cannot enable password setup', async () => {
  const invalid = setup();
  await assert.rejects(invalid.client.verifyAccountLink({ type: 'signup', tokenHash: accountHash }), AccessError);
  assert.equal(invalid.calls.length, 0);
  const expired = setup({ handler: () => response({ error_code: 'otp_expired' }, 403) });
  await assert.rejects(expired.client.verifyAccountLink({ type: 'invite', tokenHash: accountHash }), /expired/);
  assert.equal(expired.client.session, null);
  const denied = setup({ members: [], handler: () => response(session) });
  await assert.rejects(denied.client.verifyAccountLink({ type: 'invite', tokenHash: accountHash }), AccessError);
  assert.equal(denied.client.session, null);
  assert.equal(denied.client.accountFlow, null);
  const regular = setup();
  await regular.client.verify();
  await assert.rejects(regular.client.setAccountPassword('a-new-unique-passphrase'), AccessError);
  assert.equal(regular.calls.some(call => call.options.method === 'PUT'), false);
});

test('logout while an account link is verifying cannot restore its session', async () => {
  const verification = deferred();
  const { client } = setup({ handler: () => verification.promise });
  const activating = client.verifyAccountLink({ type: 'invite', tokenHash: accountHash });
  await client.signOut();
  verification.resolve(response(session));
  await assert.rejects(activating, AccessError);
  assert.equal(client.session, null);
  assert.equal(client.accountFlow, null);
});
