// MCP client for Dandelion: one signed-in connection, proxy helpers for the tools the kit uses, and the account state the post card shows.
// Sign-in lives in oauth.mjs, the token file in auth-store.mjs, file upload in upload.mjs, and the send flow in send.mjs.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as log from '../../core/util/log.mjs';
import { clearRecord, hasSavedSignIn } from './auth-store.mjs';
import { DandelionError, NotSignedInError, kitVersion, mcpUrl, plainDandelionError } from './config.mjs';
import { toDandelionPlatform, toKitPlatform } from './ids.mjs';
import { KitAuthProvider, SIGN_IN_WINDOW_MS, explain, pendingSignIn, startSignIn } from './oauth.mjs';

export { DandelionError, NotSignedInError } from './config.mjs';
export { setBrowserOpener } from './oauth.mjs';

/** Tools that only read. Safe to ask again if the connection dropped. */
const READ_TOOLS = new Set(['list_brands', 'list_channels', 'get_started', 'get_usage', 'get_connect_link', 'get_job', 'list_flows', 'get_content', 'list_content']);

// ---------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------

/** @type {Promise<{client: Client, transport: StreamableHTTPClientTransport, url: string}> | null} */
let sessionPromise = null;

async function openSession() {
  const url = mcpUrl();
  if (!hasSavedSignIn(url)) throw new NotSignedInError();
  const provider = new KitAuthProvider({ serverUrl: url, interactive: false });
  const client = new Client({ name: 'dandelion-kit', version: kitVersion() }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw error instanceof UnauthorizedError ? new NotSignedInError() : explain(error);
  }
  return { client, transport, url };
}

/** Forget the open connection (the next call opens a new one and re-reads the saved sign-in). */
export async function closeSession() {
  const pending = sessionPromise;
  sessionPromise = null;
  if (!pending) return;
  try {
    const s = await pending;
    await s.client.close();
  } catch {
    // Nothing to close.
  }
}

function session() {
  if (!sessionPromise) {
    sessionPromise = openSession();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/**
 * Read what a Dandelion tool answered. Dandelion puts the answer in the text as JSON.
 * @param {any} result
 */
function parseResult(result) {
  const text = Array.isArray(result?.content) ? (result.content.find((/** @type {any} */ c) => c?.type === 'text')?.text ?? '') : '';
  /** @type {any} */
  let parsed;
  let isJson = false;
  try {
    parsed = JSON.parse(text);
    isJson = true;
  } catch {
    // Plain text.
  }
  if (result?.isError) {
    const e = isJson ? parsed?.error : undefined;
    const code = String(e?.code ?? 'error');
    throw new DandelionError(plainDandelionError(code, String(e?.message ?? text ?? '')), code);
  }
  if (isJson) return parsed;
  if (result?.structuredContent) {
    const s = result.structuredContent;
    return Array.isArray(s.items) && Object.keys(s).length === 1 ? s.items : s;
  }
  return text;
}

/**
 * Call one Dandelion tool and return its answer as plain data.
 * @param {string} name
 * @param {Record<string, any>} [args]
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<any>}
 */
export async function callTool(name, args = {}, options = {}) {
  /** @type {unknown} */
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const s = await session();
      const result = await s.client.callTool({ name, arguments: args }, undefined, { timeout: options.timeoutMs ?? 120_000, signal: options.signal });
      return parseResult(result);
    } catch (error) {
      if (error instanceof DandelionError && !(error instanceof NotSignedInError)) throw error;
      last = error;
      const signedOut = error instanceof NotSignedInError || error instanceof UnauthorizedError;
      await closeSession();
      // A rejected sign-in did nothing on the server, so asking again is safe (the saved sign-in is read again from disk, and
      // another kit window may have renewed it). After any other break only a read is asked again.
      const again = signedOut || READ_TOOLS.has(name);
      if (!again || attempt === 1) break;
    }
  }
  if (last instanceof UnauthorizedError) throw new NotSignedInError();
  const explained = explain(last);
  if (!READ_TOOLS.has(name) && explained.code === 'network') {
    throw new DandelionError(`${explained.message} If you were sending something, check dandelion_status or your Dandelion library before sending it again.`, 'network');
  }
  throw explained;
}

// ---------------------------------------------------------------------------
// Proxy helpers (one per Dandelion tool the kit uses)
// ---------------------------------------------------------------------------

/** @returns {Promise<{id: string, name: string, [k: string]: any}[]>} */
export async function listBrands() {
  const r = await callTool('list_brands');
  return Array.isArray(r) ? r : (r?.items ?? []);
}

/** @param {string} brandId */
export async function listChannels(brandId) {
  const r = await callTool('list_channels', { brand_id: brandId });
  return /** @type {{id: string, platform: string, handle: string|null, can_post: boolean, [k: string]: any}[]} */ (Array.isArray(r) ? r : (r?.items ?? []));
}

export function getUsage() {
  return callTool('get_usage');
}

/** @param {string} [brandId] */
export function getStarted(brandId) {
  return callTool('get_started', brandId ? { brand_id: brandId } : {});
}

/**
 * A link the person opens to connect one app. Accepts the kit's id for the app (x) or Dandelion's (twitter).
 * @param {string} brandId
 * @param {string} platform
 */
export async function getConnectLink(brandId, platform) {
  const r = await callTool('get_connect_link', { brand_id: brandId, platform: toDandelionPlatform(platform) });
  return /** @type {{url: string, platform: string, app: string, how?: string}} */ (r);
}

/** @param {{brandId: string, filename: string, bytes: number, mime: string}} input */
export async function createUpload(input) {
  return /** @type {{upload_id: string, url: string, method: 'PUT', headers: Record<string, string>, expires_at: string}} */ (
    await callTool('create_upload', { brand_id: input.brandId, filename: input.filename, bytes: input.bytes, mime: input.mime })
  );
}

/** @param {{brandId: string, caption?: string, title?: string, mediaUrls?: string[], uploadIds?: string[]}} input */
export async function addContent(input) {
  return /** @type {{id: string, status: string, [k: string]: any}} */ (
    await callTool(
      'add_content',
      {
        brand_id: input.brandId,
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.title ? { title: input.title } : {}),
        media_urls: input.mediaUrls ?? [],
        upload_ids: input.uploadIds ?? [],
      },
      { timeoutMs: 300_000 },
    )
  );
}

/** @param {{contentId: string, channelIds: string[], mode?: 'review'|'auto', postAt?: string}} input */
export async function shareContent(input) {
  return /** @type {{job_ids: string[], mode: string}} */ (
    await callTool('share_content', {
      content_id: input.contentId,
      channel_ids: input.channelIds,
      mode: input.mode ?? 'review',
      ...(input.postAt ? { post_at: input.postAt } : {}),
    })
  );
}

/** @param {string} jobId */
export function getJob(jobId) {
  return callTool('get_job', { job_id: jobId });
}

/** @param {string} jobId @param {Record<string, any>} copy  update_job_copy fields: caption, title, description, hashtags (no #). */
export function updateJobCopy(jobId, copy) {
  return callTool('update_job_copy', { job_id: jobId, ...copy });
}

/** @param {string} brandId */
export async function listFlows(brandId) {
  const r = await callTool('list_flows', { brand_id: brandId });
  return /** @type {any[]} */ (r?.flows ?? []);
}

/**
 * Approve one post. This publishes to a real account: only after the person said yes to this exact post.
 * @param {string} jobId
 * @param {string} [postAt]  ISO time with a zone.
 */
export function approveJob(jobId, postAt) {
  return callTool('approve_job', { job_id: jobId, ...(postAt ? { post_at: postAt } : {}) });
}

/** @param {string} jobId */
export function skipJob(jobId) {
  return callTool('skip_job', { job_id: jobId });
}

// ---------------------------------------------------------------------------
// Account state (what the post card draws)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 30_000;
const MAX_BRANDS_LOOKED_AT = 8;

/** @type {{at: number, key: string, value: import('../../core/types.mjs').DandelionState} | null} */
let stateCache = null;

/** Forget the cached account state (after signing in, sending or approving). */
export function invalidateState() {
  stateCache = null;
}

/**
 * Where the person stands: signed in or not, plan, brands, apps that can post, and connect links.
 * Never throws unless `strict` is set. With no saved sign-in it answers at once without touching the network.
 * @param {{brandId?: string, fresh?: boolean, strict?: boolean}} [options]
 * @returns {Promise<import('../../core/types.mjs').DandelionState>}
 */
export async function getState(options = {}) {
  const url = mcpUrl();
  if (!hasSavedSignIn(url)) return { connected: false };
  const key = `${url}|${options.brandId ?? ''}`;
  if (!options.fresh && stateCache && stateCache.key === key && Date.now() - stateCache.at < STATE_TTL_MS) return stateCache.value;
  try {
    const started = await getStarted(options.brandId);
    const brands = (started.brands ?? []).map((/** @type {any} */ b) => ({ id: b.id, name: b.name }));
    /** @type {any[]} */
    const channels = (started.channels ?? []).map(mapChannel(started.brand?.id));
    for (const b of brands.slice(0, MAX_BRANDS_LOOKED_AT)) {
      if (b.id === started.brand?.id) continue;
      try {
        for (const c of await listChannels(b.id)) channels.push(mapChannel(b.id)(c));
      } catch (error) {
        if (error instanceof NotSignedInError) throw error;
        log.warn(`Could not list the apps on brand ${b.name}:`, error);
      }
    }
    /** @type {import('../../core/types.mjs').DandelionState} */
    const state = {
      connected: true,
      ...(started.plan_name ? { plan: String(started.plan_name) } : started.plan ? { plan: String(started.plan) } : {}),
      brands,
      channels,
      connect_links: (started.connect_links ?? []).map((/** @type {any} */ l) => ({ platform: toKitPlatform(l.platform), url: l.url })),
    };
    if (started.usage && typeof started.usage.used === 'number' && typeof started.usage.limit === 'number') {
      state.usage = { used: started.usage.used, limit: started.usage.limit, ...(started.usage.resets_at ? { resets_at: started.usage.resets_at } : {}) };
    }
    stateCache = { at: Date.now(), key, value: state };
    return state;
  } catch (error) {
    if (error instanceof NotSignedInError) return { connected: false };
    if (options.strict) throw error;
    log.warn('Could not read the Dandelion account:', error);
    return { connected: false };
  }
}

/** @param {string|undefined} fallbackBrandId */
function mapChannel(fallbackBrandId) {
  return (/** @type {any} */ c) => ({
    id: String(c.id),
    brand_id: String(c.brand_id ?? fallbackBrandId ?? ''),
    platform: toKitPlatform(String(c.platform)),
    handle: String(c.handle ?? c.display_name ?? ''),
    can_post: Boolean(c.can_post),
  });
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

/**
 * Sign the person in. Opens the browser, then waits up to `waitMs` for them. If they are slower than that, the sign-in keeps
 * waiting in the background (3 minutes in all) and the answer is {pending: true, connect_url}: ask again with dandelion_status.
 * @param {{waitMs?: number, windowMs?: number}} [options]
 * @returns {Promise<{connected: true, state: import('../../core/types.mjs').DandelionState} | {connected: false, pending: true, connect_url: string}>}
 */
export async function connect(options = {}) {
  const url = mcpUrl();
  if (hasSavedSignIn(url) && !pendingSignIn()) {
    const state = await getState({ fresh: true });
    if (state.connected) return { connected: true, state };
  }
  const windowMs = options.windowMs ?? SIGN_IN_WINDOW_MS;
  const flow = startSignIn({ windowMs });
  // Asked to wait as long as the sign-in stays open (the command line does)? Then wait for the sign-in itself, so a tie
  // never reads as "still waiting" when it really timed out.
  const asked = options.waitMs ?? 50_000;
  const waitMs = asked >= windowMs ? windowMs + 60_000 : asked;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const outcome = await Promise.race([
    flow.done.then(() => 'done'),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve('wait'), waitMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (outcome === 'wait') {
    // Give the first answer from Dandelion a moment so the link is ready to show.
    for (let i = 0; i < 20 && !flow.authUrl() && pendingSignIn() === flow; i += 1) await new Promise((r) => setTimeout(r, 100));
    return { connected: false, pending: true, connect_url: flow.authUrl() };
  }
  await closeSession();
  invalidateState();
  const state = await getState({ fresh: true, strict: true });
  if (!state.connected) throw new NotSignedInError();
  return { connected: true, state };
}

/** The link of a sign-in that is waiting for the person, or null. */
export function pendingConnect() {
  const flow = pendingSignIn();
  return flow ? { connect_url: flow.authUrl(), started_at: flow.startedAt } : null;
}

/** Forget the saved sign-in on this computer. */
export async function signOut() {
  await closeSession();
  invalidateState();
  await clearRecord(mcpUrl(), true);
}
