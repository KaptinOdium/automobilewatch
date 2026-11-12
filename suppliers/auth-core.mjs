const SESSION_KEY = 'supplier-atlas-auth-v1';
const ALLOWED_ROLES = new Set(['owner', 'editor', 'viewer']);
export class AccessError extends Error {}
export class ConflictError extends Error {}

export function consumeAccountLink(href, replace) {
  const url = new URL(href);
  // Clear every query/fragment value before validation or any network work.
  replace(url.pathname);
  const params = new URLSearchParams(url.hash.slice(1));
  const type = params.get('type');
  const tokenHash = params.get('token_hash');
  if (url.search || !['invite', 'recovery'].includes(type) ||
      params.getAll('type').length !== 1 || params.getAll('token_hash').length !== 1 ||
      [...params.keys()].some(key => !['type', 'token_hash'].includes(key)) ||
      !/^[A-Za-z0-9_-]{32,512}$/.test(tokenHash || '')) {
    throw new AccessError('This account link is invalid. Ask the site owner for a new invitation or password-reset link.');
  }
  return { type, tokenHash };
}

export function configured(raw) {
  if (!raw?.supabaseUrl || !raw?.supabaseAnonKey) return null;
  let url;
  try { url = new URL(raw.supabaseUrl); }
  catch { throw new Error('Account configuration is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Account configuration is invalid.');
  }
  const key = String(raw.supabaseAnonKey).trim();
  if (key.startsWith('sb_secret_')) throw new Error('A secret key must never be used in the browser.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const parts = key.split('.');
      if (parts.length !== 3) throw Error();
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') throw Error();
    } catch { throw new Error('Account configuration requires a public key.'); }
  }
  return { url: url.origin, key };
}

export class AuthClient {
  constructor(config, { fetcher = fetch, storage = null, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetcher = fetcher;
    this.storage = storage;
    this.now = now;
    this.session = null;
    this.identity = null;
    this.refreshing = null;
    this.accountFlow = null;
    this.generation = 0;
    try {
      const session = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
      if (session && typeof session.access_token === 'string' && session.access_token &&
          typeof session.refresh_token === 'string' && session.refresh_token &&
          Number.isFinite(session.expires_at) && session.expires_at > 0) {
        this.session = session;
      } else if (session) this.clear();
    } catch { this.clear(); }
  }

  clear() {
    this.generation++;
    this.session = null;
    this.identity = null;
    this.refreshing = null;
    this.accountFlow = null;
    try { this.storage?.removeItem(SESSION_KEY); } catch {}
  }

  assertCurrent(generation) {
    if (generation !== this.generation) throw new AccessError('The sign-in session changed. Sign in again.');
  }

  remember(data) {
    if (typeof data?.access_token !== 'string' || !data.access_token ||
        typeof data.refresh_token !== 'string' || !data.refresh_token) {
      throw new AccessError('Sign-in did not return a valid session.');
    }
    const expiresAt = Number(data.expires_at) || Math.floor(this.now() / 1000) + Number(data.expires_in || 3600);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= this.now()) {
      throw new AccessError('Sign-in returned an expired session.');
    }
    this.session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt };
    try { this.storage?.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch {}
  }

  async request(path, { method = 'GET', body, token } = {}) {
    const headers = { apikey: this.config.key };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await this.fetcher(this.config.url + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000)
      });
    } catch { throw new Error('The account service is unavailable. Try again shortly.'); }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      if (path === '/auth/v1/verify' && [400, 403, 422].includes(response.status)) {
        throw new AccessError('This account link is invalid or has expired. Ask the site owner for a new link.');
      }
      if (path === '/auth/v1/user' && method === 'PUT' && [400, 422].includes(response.status)) {
        throw new Error('The password could not be accepted. Choose a different strong password or request a fresh account link.');
      }
      if (response.status === 409 || data?.code === '40001') {
        throw new ConflictError('The shared list changed. Load the latest version before saving again.');
      }
      if (response.status === 401 || response.status === 403 || data?.code === '42501' ||
          (response.status === 400 && path === '/auth/v1/token?grant_type=refresh_token')) {
        throw new AccessError('Sign-in expired or this account has no access.');
      }
      throw new Error(path.startsWith('/auth/v1/token')
        ? 'Sign-in failed. Check your email and password.'
        : 'The request could not be completed. Try again shortly.');
    }
    return data;
  }

  async signIn(email, password) {
    this.clear();
    const generation = this.generation;
    const data = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    this.assertCurrent(generation);
    this.remember(data);
    try { return await this.verify(); }
    catch (error) {
      if (generation === this.generation) await this.signOut();
      throw error;
    }
  }

  async verifyAccountLink({ type, tokenHash } = {}) {
    this.clear();
    if (!['invite', 'recovery'].includes(type) || !/^[A-Za-z0-9_-]{32,512}$/.test(tokenHash || '')) {
      throw new AccessError('This account link is invalid.');
    }
    const generation = this.generation;
    const data = await this.request('/auth/v1/verify', {
      method: 'POST', body: { type, token_hash: tokenHash }
    });
    this.assertCurrent(generation);
    this.remember(data);
    try {
      const member = await this.verify();
      this.assertCurrent(generation);
      this.accountFlow = type;
      return member;
    } catch (error) {
      if (generation === this.generation) await this.signOut();
      throw error;
    }
  }

  async setAccountPassword(password) {
    if (!['invite', 'recovery'].includes(this.accountFlow)) throw new AccessError('Open a valid invitation or password-reset link first.');
    if (typeof password !== 'string' || password.length < 12) throw new Error('Use a password with at least 12 characters.');
    const generation = this.generation;
    const identity = await this.verify();
    const token = await this.token();
    this.assertCurrent(generation);
    const user = await this.request('/auth/v1/user', { method: 'PUT', token, body: { password } });
    this.assertCurrent(generation);
    if (user?.id !== identity.id) throw new AccessError('The password change could not be verified. Sign in again.');
    await this.signOut();
  }

  async token() {
    if (!this.session) throw new AccessError('Sign in to continue.');
    const generation = this.generation;
    if (this.session.expires_at * 1000 <= this.now() + 60000) {
      if (!this.refreshing) {
        const refreshToken = this.session.refresh_token;
        const pending = this.request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', body: { refresh_token: refreshToken }
        }).then(data => {
          this.assertCurrent(generation);
          this.remember(data);
        }).catch(error => {
          // A rejected refresh token ends the session. A temporary outage must
          // keep the token so the user can retry without losing local edits.
          if (generation === this.generation && error instanceof AccessError) this.clear();
          throw error;
        }).finally(() => {
          if (this.refreshing === pending) this.refreshing = null;
        });
        this.refreshing = pending;
      }
      await this.refreshing;
    }
    this.assertCurrent(generation);
    if (!this.session) throw new AccessError('Sign in to continue.');
    return this.session.access_token;
  }

  async verify() {
    const generation = this.generation;
    this.identity = null;
    const token = await this.token();
    const user = await this.request('/auth/v1/user', { token });
    this.assertCurrent(generation);
    if (!user?.id) throw new AccessError('Sign in to continue.');
    const list = await this.request('/rest/v1/supplier_members?select=user_id,active,display_name,role&user_id=eq.' +
      encodeURIComponent(user.id) + '&active=eq.true&limit=1', { token });
    this.assertCurrent(generation);
    const member = Array.isArray(list) ? list.find(row => row.user_id === user.id && row.active === true) : null;
    if (!member || !ALLOWED_ROLES.has(member.role)) throw new AccessError('This account has not been invited to Supplier Atlas.');
    this.identity = Object.freeze({ id: user.id, email: user.email || '', name: member.display_name || user.email || 'Member', role: member.role });
    return this.identity;
  }

  async signOut() {
    const token = this.session?.access_token;
    this.clear();
    if (token) try { await this.request('/auth/v1/logout?scope=local', { method: 'POST', token }); } catch {}
  }

  async loadShared() {
    const generation = this.generation;
    await this.verify();
    const token = await this.token();
    const data = await this.request('/rest/v1/supplier_datasets?id=eq.main&select=*', { token });
    this.assertCurrent(generation);
    if (!Array.isArray(data) || data.length !== 1 || data[0].id !== 'main' ||
        !Array.isArray(data[0].suppliers) || !Number.isSafeInteger(data[0].revision) || data[0].revision < 0) {
      throw new AccessError('The shared list is unavailable or this account has no access.');
    }
    return data[0];
  }

  async saveShared(rows, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Load the current shared list before saving.');
    if (!Array.isArray(rows) || rows.length > 10000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('The supplier list is invalid.');
    }
    const generation = this.generation;
    const identity = await this.verify();
    if (!['owner', 'editor'].includes(identity.role)) throw new AccessError('This account has read-only access to the shared list.');
    const token = await this.token();
    this.assertCurrent(generation);
    const data = await this.request('/rest/v1/rpc/save_supplier_dataset', {
      method: 'POST', token, body: { expected_revision: revision, supplier_rows: rows }
    });
    this.assertCurrent(generation);
    if (!data || data.id !== 'main' || data.revision !== revision + 1 || !Array.isArray(data.suppliers)) {
      throw new Error('The shared save response is invalid.');
    }
    return data;
  }
}
