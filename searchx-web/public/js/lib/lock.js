// App lock: a 4-digit code (stored salted + hashed) and optional Face ID / Touch ID through a
// local passkey (WebAuthn platform authenticator). The passkey only gates the UI on this device.

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

export function newSalt() {
  return hex(randomBytes(16));
}

export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}:searchx`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

export async function biometricsAvailable() {
  try {
    return Boolean(window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Creates the local passkey; returns its id (base64url). Requires a user gesture. */
export async function registerBiometrics() {
  authBusy = true;
  try {
    return await createCredential();
  } finally {
    setTimeout(() => { authBusy = false; }, 800);
  }
}

async function createCredential() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'SearchX', id: location.hostname },
      user: { id: randomBytes(16), name: 'SearchX', displayName: 'SearchX' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none'
    }
  });
  if (!cred) throw new Error('Annulé');
  return b64url(cred.rawId);
}

/** True while the Face ID sheet is on screen (it briefly blurs the page: don't treat that as leaving). */
export let authBusy = false;

/** Prompts Face ID / Touch ID for the stored passkey (iOS offers the device passcode as fallback). */
export async function verifyBiometrics(id) {
  authBusy = true;
  try {
    return await getAssertion(id);
  } finally {
    setTimeout(() => { authBusy = false; }, 800);
  }
}

async function getAssertion(id) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: fromB64url(id), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000
    }
  });
  return Boolean(assertion);
}
