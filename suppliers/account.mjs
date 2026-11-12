import { AuthClient, AccessError, configured, consumeAccountLink } from './auth-core.mjs';

const $ = id => document.getElementById(id);
let auth = null;
let active = true;
let link = null;
let linkError = null;
try {
  link = consumeAccountLink(location.href, path => history.replaceState(null, '', path));
} catch (error) {
  linkError = error;
}

function message(text) { $('accountNotice').textContent = text; }
function clearPasswords() { $('newPassword').value = ''; $('confirmPassword').value = ''; }
function closeForm() { $('passwordForm').hidden = true; clearPasswords(); }

window.addEventListener('pagehide', () => {
  active = false;
  link = null;
  closeForm();
  auth?.clear();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    closeForm();
    message('This account session has ended. Return to sign in or ask the site owner for a fresh link.');
    $('nextStep').hidden = false;
  }
});

$('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!active || !auth || $('setPasswordButton').disabled) return;
  if ($('newPassword').value !== $('confirmPassword').value) {
    message('The passwords do not match. Enter the same password in both fields.');
    return;
  }
  $('setPasswordButton').disabled = true;
  message('Saving your password...');
  try {
    await auth.setAccountPassword($('newPassword').value);
    if (!active) return;
    closeForm();
    message('Your password is saved. Sign in with your email and new password.');
    $('nextStep').hidden = false;
  } catch (error) {
    if (!active) return;
    clearPasswords();
    if (error instanceof AccessError) { closeForm(); await auth.signOut(); }
    message(error.message);
  } finally {
    $('setPasswordButton').disabled = false;
  }
});

async function start() {
  try {
    if (linkError) throw linkError;
    const response = await fetch('./config.json', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Account setup is not available yet. Contact the site owner.');
    const config = configured(await response.json());
    if (!config) throw new Error('Account setup is not available yet. Contact the site owner.');
    if (!active) return;
    // Invitation/recovery sessions stay in memory; no browser storage is used.
    auth = new AuthClient(config);
    const member = await auth.verifyAccountLink(link);
    if (!active) return;
    $('passwordForm').hidden = false;
    message('Account verified for ' + member.email + '. Choose your password below.');
    $('newPassword').focus();
  } catch (error) {
    if (active) message(error.message);
  } finally {
    link = null;
    linkError = null;
  }
}
start();
