// Signing in to Dandelion: the whole OAuth trip against a fake Dandelion on 127.0.0.1, the token file, refresh, and the early-return path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { authFilePath, updateRecord } from '../server/dandelion/auth-store.mjs';
import { DandelionError, NotSignedInError, dandelionBase, mcpUrl, plainDandelionError } from '../server/dandelion/config.mjs';
import { setBrowserOpener } from '../server/dandelion/oauth.mjs';
import { useFakeDandelion } from './dandelion-fake.mjs';

/** @param {() => boolean} cond @param {number} [ms] */
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('sign-in: registers as "Dandelion Kit", uses PKCE on a loopback address, and ends up connected', async () => {
  const t = await useFakeDandelion();
  try {
    const r = await t.client.connect({ waitMs: 15000 });
    assert.equal(r.connected, true);
    const reg = t.fake.state.registrations;
    assert.equal(reg.length, 1);
    assert.equal(reg[0].client_name, 'Dandelion Kit');
    assert.equal(reg[0].client_uri, 'https://dandelionapp.io/kit');
    assert.equal(reg[0].token_endpoint_auth_method, 'none');
    assert.deepEqual(reg[0].grant_types, ['authorization_code', 'refresh_token']);
    assert.deepEqual(reg[0].response_types, ['code']);
    assert.match(reg[0].redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const q = /** @type {URLSearchParams} */ (t.fake.state.authorizeQuery);
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.ok(q.get('state'), 'a state value is sent');
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('scope'), 'mcp');
    const tokenRequest = t.fake.state.tokenRequests[0];
    assert.equal(tokenRequest.grant_type, 'authorization_code');
    assert.ok(tokenRequest.code_verifier && tokenRequest.code_verifier.length >= 43);
    assert.equal(tokenRequest.client_secret, undefined, 'a public client sends no secret');
    // The state the kit reads back.
    if (!r.connected) throw new Error('unreachable');
    assert.equal(r.state.connected, true);
    assert.equal(r.state.plan, 'Free');
    assert.deepEqual(r.state.brands?.map((b) => b.name), ['Dandelion QA', 'Second Brand']);
    assert.deepEqual(r.state.usage, { used: 12, limit: 60, resets_at: '2026-11-01T00:00:00.000Z' });
    // Dandelion calls X "twitter". The kit calls it "x".
    const platforms = r.state.connect_links?.map((l) => l.platform) ?? [];
    assert.ok(platforms.includes('x') && !platforms.includes('twitter'));
    assert.equal(r.state.connect_links?.find((l) => l.platform === 'x')?.url.startsWith(t.fake.base), true);
  } finally {
    await t.stop();
  }
});

test('token file: mode 0600, written atomically, holds tokens and the client', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const file = authFilePath();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const record = saved.servers[new URL(mcpUrl()).href];
    assert.ok(record.tokens.access_token && record.tokens.refresh_token, 'tokens are saved');
    assert.ok(record.client.client_id, 'the registered client is saved');
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600, 'owner read and write only');
      assert.equal(statSync(dirname(file)).mode & 0o022, 0, 'the folder is not writable by others');
    }
    // A later write keeps the mode and leaves no temp file behind.
    await updateRecord(mcpUrl(), (r) => ({ ...r }));
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dirname(file)).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    await t.stop();
  }
});

test('the next run reuses the saved sign-in and registration (no browser, no second registration)', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    await t.client.closeSession();
    t.client.invalidateState();
    setBrowserOpener(() => {
      throw new Error('the browser must not open');
    });
    const again = await t.client.connect({ waitMs: 5000 });
    assert.equal(again.connected, true);
    assert.equal(t.fake.state.registrations.length, 1);
    assert.equal((await t.client.listBrands()).length, 2);
  } finally {
    await t.stop();
  }
});

test('refresh: an expired access token is renewed by itself and the new tokens are saved (the old refresh token is retired)', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const key = new URL(mcpUrl()).href;
    const before = JSON.parse(readFileSync(authFilePath(), 'utf8')).servers[key].tokens;
    t.fake.expireAccessTokens();
    await t.client.closeSession();
    const brands = await t.client.listBrands();
    assert.equal(brands.length, 2);
    assert.equal(t.fake.state.refreshCount, 1);
    const after = JSON.parse(readFileSync(authFilePath(), 'utf8')).servers[key].tokens;
    assert.notEqual(after.access_token, before.access_token);
    assert.notEqual(after.refresh_token, before.refresh_token);
    assert.equal(t.fake.state.refreshTokens.has(before.refresh_token), false, 'the server retired the old refresh token');
    assert.equal(t.fake.state.registrations.length, 1);
  } finally {
    await t.stop();
  }
});

test('refresh that fails: the person is told to connect again, and status says not connected (the browser never opens by itself)', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    t.fake.expireAccessTokens();
    t.fake.state.refreshTokens.clear();
    await t.client.closeSession();
    t.client.invalidateState();
    let opened = 0;
    setBrowserOpener(() => {
      opened += 1;
    });
    await assert.rejects(() => t.client.listBrands(), (e) => e instanceof NotSignedInError && /connect Dandelion/.test(e.message));
    assert.equal(opened, 0);
    assert.deepEqual(await t.client.getState({ fresh: true }), { connected: false });
  } finally {
    await t.stop();
  }
});

test('no saved sign-in: state answers at once without touching the network, and calls say to connect', async () => {
  const t = await useFakeDandelion();
  try {
    assert.deepEqual(await t.client.getState(), { connected: false });
    assert.deepEqual(await t.client.getState({ fresh: true, strict: true }), { connected: false });
    await assert.rejects(() => t.client.listBrands(), (e) => e instanceof NotSignedInError && /connect Dandelion/.test(e.message));
    assert.equal(t.fake.state.mcpAuthHeaders.length, 0, 'nothing was sent to Dandelion');
  } finally {
    await t.stop();
  }
});

test('early return: when the person is slow, connect answers pending with the link and the sign-in finishes in the background', async () => {
  const t = await useFakeDandelion();
  try {
    /** @type {string[]} */
    const urls = [];
    setBrowserOpener((url) => {
      urls.push(url);
    });
    const first = await t.client.connect({ waitMs: 300 });
    assert.equal(first.connected, false);
    assert.ok('pending' in first && first.pending);
    const link = /** @type {{connect_url: string}} */ (first).connect_url;
    assert.match(link, /\/authorize\?/);
    assert.deepEqual(urls, [link]);
    assert.equal(t.client.pendingConnect()?.connect_url, link);
    // Asking again joins the same sign-in: same link, no second browser window, no second registration.
    const second = await t.client.connect({ waitMs: 100 });
    assert.equal(/** @type {{connect_url: string}} */ (second).connect_url, link);
    assert.equal(urls.length, 1);
    assert.equal(t.fake.state.registrations.length, 1);
    // Status while waiting is "not connected" and a pending sign-in is visible.
    assert.equal((await t.client.getState({ fresh: true })).connected, false);
    // The person finishes in the browser.
    await t.fake.approveInBrowser(link);
    await until(() => t.client.pendingConnect() === null);
    const state = await t.client.getState({ fresh: true, strict: true });
    assert.equal(state.connected, true);
  } finally {
    await t.stop();
  }
});

test('the loopback page ignores a wrong state value and keeps waiting', async () => {
  const t = await useFakeDandelion();
  try {
    /** @type {string[]} */
    const urls = [];
    setBrowserOpener((url) => {
      urls.push(url);
    });
    const pending = await t.client.connect({ waitMs: 200 });
    const link = new URL(/** @type {{connect_url: string}} */ (pending).connect_url);
    const callback = new URL(/** @type {string} */ (link.searchParams.get('redirect_uri')));
    assert.equal(callback.hostname, '127.0.0.1');
    callback.searchParams.set('code', 'stolen');
    callback.searchParams.set('state', 'wrong');
    const bad = await fetch(callback);
    assert.equal(bad.status, 400);
    await bad.text();
    const elsewhere = await fetch(new URL('/other', callback));
    assert.equal(elsewhere.status, 404);
    await elsewhere.text();
    assert.ok(t.client.pendingConnect(), 'still waiting');
    await t.fake.approveInBrowser(link.href);
    await until(() => t.client.pendingConnect() === null);
    assert.equal((await t.client.getState({ fresh: true })).connected, true);
  } finally {
    await t.stop();
  }
});

test('the person says no: a plain message and nothing is saved', async () => {
  const t = await useFakeDandelion();
  try {
    setBrowserOpener(async (url) => {
      const u = new URL(url);
      const cb = new URL(/** @type {string} */ (u.searchParams.get('redirect_uri')));
      cb.searchParams.set('error', 'access_denied');
      cb.searchParams.set('state', /** @type {string} */ (u.searchParams.get('state')));
      await (await fetch(cb)).text();
    });
    await assert.rejects(() => t.client.connect({ waitMs: 10000 }), (e) => e instanceof DandelionError && /chose not to allow/.test(e.message));
    assert.equal(t.client.pendingConnect(), null);
    assert.deepEqual(await t.client.getState(), { connected: false });
  } finally {
    await t.stop();
  }
});

test('the person never finishes: the sign-in times out, closes its loopback listener, and a new one can start', async () => {
  const t = await useFakeDandelion();
  try {
    /** @type {string[]} */
    const urls = [];
    setBrowserOpener((url) => {
      urls.push(url);
    });
    await assert.rejects(() => t.client.connect({ waitMs: 5000, windowMs: 300 }), (e) => e instanceof DandelionError && /not finished in time/.test(e.message));
    assert.equal(t.client.pendingConnect(), null);
    const callback = new URL(/** @type {string} */ (new URL(urls[0]).searchParams.get('redirect_uri')));
    await assert.rejects(() => fetch(callback), 'the listener is closed');
    // A new try works.
    setBrowserOpener((url) => t.fake.approveInBrowser(url).then(() => undefined));
    assert.equal((await t.client.connect({ waitMs: 15000 })).connected, true);
  } finally {
    await t.stop();
  }
});

test('asked to wait as long as the sign-in stays open, a time out is an error, never "still waiting"', async () => {
  const t = await useFakeDandelion();
  try {
    setBrowserOpener(() => {});
    await assert.rejects(() => t.client.connect({ waitMs: 300, windowMs: 300 }), (e) => e instanceof DandelionError && /not finished in time/.test(e.message));
  } finally {
    await t.stop();
  }
});

test('a plan that cannot use the API gets the plain "cannot use the API yet" sentence', async () => {
  const t = await useFakeDandelion({ planBlocked: true });
  try {
    await assert.rejects(() => t.client.connect({ waitMs: 15000 }), (e) => e instanceof DandelionError && e.code === 'plan_required' && /cannot use the API yet/.test(e.message));
    assert.match(plainDandelionError('plan_required', 'x'), /cannot use the API yet/);
  } finally {
    await t.stop();
  }
});

test('signOut forgets the sign-in on this computer', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    await t.client.signOut();
    assert.deepEqual(await t.client.getState({ fresh: true }), { connected: false });
    const saved = JSON.parse(readFileSync(authFilePath(), 'utf8'));
    assert.deepEqual(saved.servers, {});
  } finally {
    await t.stop();
  }
});

test('DANDELION_URL: https anywhere, http only for this computer', () => {
  const previous = process.env.DANDELION_URL;
  try {
    delete process.env.DANDELION_URL;
    assert.equal(dandelionBase(), 'https://dandelionapp.io');
    assert.equal(mcpUrl(), 'https://dandelionapp.io/api/mcp');
    process.env.DANDELION_URL = 'https://staging.example.com/';
    assert.equal(dandelionBase(), 'https://staging.example.com');
    process.env.DANDELION_URL = 'http://127.0.0.1:3000';
    assert.equal(mcpUrl(), 'http://127.0.0.1:3000/api/mcp');
    process.env.DANDELION_URL = 'http://dandelionapp.example.com';
    assert.throws(() => dandelionBase(), /https/);
    process.env.DANDELION_URL = 'not a url';
    assert.throws(() => dandelionBase(), /web address/);
  } finally {
    if (previous === undefined) delete process.env.DANDELION_URL;
    else process.env.DANDELION_URL = previous;
  }
});

test('plain error words', () => {
  assert.match(plainDandelionError('invalid_key', ''), /connect Dandelion/);
  assert.match(plainDandelionError('rate_limited', ''), /slow down/);
  assert.equal(plainDandelionError('conflict', 'Only posts waiting for review can be approved.'), 'Only posts waiting for review can be approved.');
  assert.doesNotMatch(plainDandelionError('server_error', ''), /Error:|\n\s+at /);
});
