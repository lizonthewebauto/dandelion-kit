// A stand-in for Dandelion for the tests. Not a test file.
// It speaks the real protocol on 127.0.0.1: OAuth discovery, dynamic client registration, authorize (PKCE), token and refresh,
// the MCP endpoint with the same tool names and answer shapes as dandelionapp.io, a PUT endpoint for uploads, and the public rules.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const SNAPSHOT = new URL('../assets/platform-rules.snapshot.json', import.meta.url);

/** @param {import('node:http').IncomingMessage} req @returns {Promise<Buffer>} */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

const ok = (/** @type {any} */ data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: Array.isArray(data) ? { items: data } : data });
const bad = (/** @type {string} */ code, /** @type {string} */ message) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }] });

/**
 * @param {object} [options]
 * @param {boolean} [options.withChannels]    Give the QA brand connected apps (Instagram and X).
 * @param {boolean} [options.autoFlow]        Add an Autoshare in auto mode that reads uploads.
 * @param {boolean} [options.planBlocked]     Answer every MCP call with plan_required (403).
 */
export async function startFakeDandelion(options = {}) {
  const brandId = randomUUID();
  const otherBrandId = randomUUID();
  const state = {
    registrations: /** @type {any[]} */ ([]),
    codes: /** @type {Map<string, {challenge: string, redirect: string, client: string}>} */ (new Map()),
    accessTokens: /** @type {Set<string>} */ (new Set()),
    refreshTokens: /** @type {Set<string>} */ (new Set()),
    refreshCount: 0,
    tokenRequests: /** @type {any[]} */ ([]),
    authorizeQuery: /** @type {URLSearchParams | null} */ (null),
    calls: /** @type {{tool: string, args: any}[]} */ ([]),
    uploads: /** @type {Map<string, {path: string, mime: string, bytes: number, used: boolean}>} */ (new Map()),
    putBodies: /** @type {Map<string, Buffer>} */ (new Map()),
    putFailures: 0,
    putCount: 0,
    putHeaders: /** @type {any[]} */ ([]),
    content: /** @type {Map<string, any>} */ (new Map()),
    jobs: /** @type {Map<string, any>} */ (new Map()),
    rulesHits: 0,
    mcpAuthHeaders: /** @type {string[]} */ ([]),
    brands: [
      { id: brandId, name: 'Dandelion QA', color: '#f5b400', timezone: 'America/New_York' },
      { id: otherBrandId, name: 'Second Brand', color: '#222222', timezone: 'America/New_York' },
    ],
    channels: /** @type {any[]} */ (
      options.withChannels
        ? [
            { id: randomUUID(), brand_id: brandId, platform: 'instagram', handle: 'qa_insta', display_name: 'QA', connected: true, status: 'active', can_post: true },
            { id: randomUUID(), brand_id: brandId, platform: 'twitter', handle: 'qa_x', display_name: 'QA X', connected: true, status: 'active', can_post: true },
            { id: randomUUID(), brand_id: brandId, platform: 'youtube', handle: 'qa_yt', display_name: 'QA YT', connected: true, status: 'expired', can_post: false },
          ]
        : []
    ),
    flows: /** @type {any[]} */ (options.autoFlow ? [{ id: randomUUID(), brand_id: brandId, name: 'Auto uploads', active: true, mode: 'auto', sources: { list: [], uploads: true } }] : []),
    /** Make the next get_job answers say "processing" this many times. */
    processingPolls: 0,
    /** Make the next share_content say "not ready" this many times. */
    notReady: 0,
    /** Make update_job_copy reject. */
    copyError: /** @type {string | null} */ (null),
    plan: 'Free',
  };

  /** @type {string} */
  let base = '';
  const mcpFor = () => {
    const server = new McpServer({ name: 'dandelion', version: '1.0.0' });
    const tool = (/** @type {string} */ name, /** @type {any} */ shape, /** @type {(a: any) => any} */ fn) =>
      server.registerTool(name, { description: name, inputSchema: shape }, /** @type {any} */ (async (/** @type {any} */ a) => {
        state.calls.push({ tool: name, args: a });
        try {
          return fn(a ?? {});
        } catch (error) {
          return bad('server_error', String(/** @type {any} */ (error)?.message ?? error));
        }
      }));
    const known = (/** @type {string} */ id) => state.brands.find((b) => b.id === id);
    const channelView = (/** @type {any} */ c) => ({ id: c.id, platform: c.platform, handle: c.handle, display_name: c.display_name, connected: c.connected, status: c.status, platform_name: c.platform, can_post: c.can_post });
    const jobView = (/** @type {any} */ j) => ({ id: j.id, brand_id: j.brand_id, content_id: j.content_id, channel_id: j.channel_id, platform: j.platform, format: null, mode: 'review', status: j.status, scheduled_for: j.scheduled_for ?? null, copy: j.copy });

    tool('list_brands', {}, () => ok(state.brands));
    tool('list_channels', { brand_id: z.string() }, (a) => (known(a.brand_id) ? ok(state.channels.filter((c) => c.brand_id === a.brand_id).map(channelView)) : bad('not_found', 'We could not find that brand.')));
    tool('get_usage', {}, () => ok({ plan: { id: 'free', name: state.plan }, period: '2026-10', ai_actions: 12, ai_actions_limit: 60 }));
    tool('get_started', { brand_id: z.string().optional() }, (a) => {
      const brand = a.brand_id ? known(a.brand_id) : state.brands[0];
      if (!brand) return bad('not_found', 'We could not find that brand.');
      const channels = state.channels.filter((c) => c.brand_id === brand.id).map((c) => ({ id: c.id, brand_id: c.brand_id, platform: c.platform, handle: c.handle, can_post: c.can_post }));
      const live = new Set(channels.filter((c) => c.can_post).map((c) => c.platform));
      const connect_links = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter', 'threads', 'facebook', 'pinterest']
        .filter((p) => !live.has(p))
        .map((p) => ({ platform: p, app: p, url: `${base}/app/connect?platform=${p}&brand=${brand.id}` }));
      return ok({
        brand: { id: brand.id, name: brand.name },
        brands: state.brands.map((b) => ({ id: b.id, name: b.name })),
        channels,
        connect_links,
        plan: 'free',
        plan_name: state.plan,
        usage: { used: 12, limit: 60, resets_at: '2026-11-01T00:00:00.000Z' },
        reposts: { used: 0, limit_text: '15' },
        kit_url: 'https://dandelionapp.io/kit',
        next_step: 'x',
      });
    });
    tool('get_connect_link', { brand_id: z.string(), platform: z.string() }, (a) => ok({ url: `${base}/app/connect?platform=${a.platform}&brand=${a.brand_id}`, platform: a.platform, app: a.platform, how: 'open it' }));
    tool('list_flows', { brand_id: z.string().optional() }, (a) => ok({ flows: state.flows.filter((f) => !a.brand_id || f.brand_id === a.brand_id) }));
    tool('create_upload', { brand_id: z.string(), filename: z.string(), bytes: z.number(), mime: z.string() }, (a) => {
      if (!known(a.brand_id)) return bad('not_found', 'We could not find that brand.');
      if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/.test(a.mime)) return bad('invalid_input', `Dandelion cannot post ${a.mime}.`);
      const id = randomUUID();
      const uploadId = `up_${id}`;
      state.uploads.set(uploadId, { path: id, mime: a.mime, bytes: a.bytes, used: false });
      return ok({ upload_id: uploadId, url: `${base}/upload/${id}`, method: 'PUT', headers: { 'content-type': a.mime }, expires_at: new Date(Date.now() + 7_200_000).toISOString(), max_bytes: 471859200 });
    });
    tool('add_content', { brand_id: z.string(), caption: z.string().optional(), title: z.string().optional(), media_urls: z.array(z.string()).default([]), upload_ids: z.array(z.string()).default([]) }, (a) => {
      if (!known(a.brand_id)) return bad('not_found', 'We could not find that brand.');
      if (!a.caption && !a.media_urls.length && !a.upload_ids.length) return bad('invalid_input', 'Send a caption, at least one media link or upload_id, or both.');
      for (const id of a.upload_ids) {
        const up = state.uploads.get(id);
        if (!up) return bad('invalid_input', 'This upload_id is not valid. Ask for a new upload link with create_upload.');
        if (!state.putBodies.has(up.path)) return bad('invalid_input', 'That file did not arrive. Send it to the link first.');
        up.used = true;
      }
      const item = { id: randomUUID(), brand_id: a.brand_id, kind: a.upload_ids.length ? 'upload' : 'text', caption: a.caption ?? null, status: 'ready', upload_ids: a.upload_ids, media_count: a.upload_ids.length };
      state.content.set(item.id, item);
      return ok({ id: item.id, brand_id: item.brand_id, kind: item.kind, caption: item.caption, status: item.status, media_count: item.media_count });
    });
    tool('share_content', { content_id: z.string(), channel_ids: z.array(z.string()).min(1), mode: z.enum(['review', 'auto']).default('review'), post_at: z.string().optional() }, (a) => {
      const item = state.content.get(a.content_id);
      if (!item) return bad('not_found', 'We could not find that content.');
      if (state.notReady > 0) {
        state.notReady -= 1;
        return bad('conflict', 'This content is not ready yet (it is processing). Try again in a minute.');
      }
      const ids = [];
      for (const cid of a.channel_ids) {
        const ch = state.channels.find((c) => c.id === cid);
        if (!ch) return bad('not_found', `We could not find channel ${cid}.`);
        const job = { id: randomUUID(), brand_id: item.brand_id, content_id: item.id, channel_id: ch.id, platform: ch.platform, status: 'review', copy: {}, scheduled_for: null, handle: ch.handle };
        state.jobs.set(job.id, job);
        ids.push(job.id);
      }
      return ok({ job_ids: ids, mode: a.mode });
    });
    tool('get_job', { job_id: z.string() }, (a) => {
      const j = state.jobs.get(a.job_id);
      if (!j) return bad('not_found', 'We could not find that post.');
      let status = j.status;
      if (state.processingPolls > 0 && j.status === 'review') {
        state.processingPolls -= 1;
        status = 'processing';
      }
      return ok({ ...jobView({ ...j, status }), checks: j.checks ?? [], channel: { id: j.channel_id, platform: j.platform, handle: j.handle }, original: { id: j.content_id } });
    });
    tool('update_job_copy', { job_id: z.string(), caption: z.string().optional(), title: z.string().optional(), description: z.string().optional(), hashtags: z.array(z.string()).optional() }, (a) => {
      const j = state.jobs.get(a.job_id);
      if (!j) return bad('not_found', 'We could not find that post.');
      if (state.copyError) return bad('invalid_input', state.copyError);
      const { job_id: _drop, ...fields } = a;
      j.copy = { ...j.copy, ...fields };
      return ok({ job: jobView(j), warnings: [] });
    });
    tool('approve_job', { job_id: z.string(), post_at: z.string().optional() }, (a) => {
      const j = state.jobs.get(a.job_id);
      if (!j) return bad('not_found', 'We could not find that post.');
      if (j.status !== 'review') return bad('conflict', `Only posts waiting for review can be approved. This one is ${j.status}.`);
      j.status = a.post_at ? 'scheduled' : 'approved';
      j.scheduled_for = a.post_at ?? null;
      return ok({ job: jobView(j), warnings: [] });
    });
    tool('skip_job', { job_id: z.string() }, (a) => {
      const j = state.jobs.get(a.job_id);
      if (!j) return bad('not_found', 'We could not find that post.');
      j.status = 'skipped';
      return ok({ job: jobView(j) });
    });
    return server;
  };

  const challengeOf = (/** @type {string} */ verifier) => createHash('sha256').update(verifier).digest('base64url');

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base || 'http://127.0.0.1');
    const json = (/** @type {number} */ status, /** @type {any} */ body, /** @type {Record<string,string>} */ headers = {}) =>
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
    try {
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return json(200, { resource: `${base}/api/mcp`, authorization_servers: [base], scopes_supported: ['mcp'], bearer_methods_supported: ['header'] });
      }
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: ['mcp'],
        });
      }
      if (url.pathname === '/register' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const loopback = (body.redirect_uris ?? []).every((/** @type {string} */ u) => /^http:\/\/127\.0\.0\.1:\d+\//.test(u));
        if (!loopback) return json(400, { error: 'invalid_redirect_uri' });
        const client = { ...body, client_id: `client_${randomBytes(6).toString('hex')}`, client_id_issued_at: Math.floor(Date.now() / 1000) };
        state.registrations.push(client);
        return json(201, client);
      }
      if (url.pathname === '/authorize') {
        state.authorizeQuery = url.searchParams;
        const client = state.registrations.find((c) => c.client_id === url.searchParams.get('client_id'));
        const redirect = url.searchParams.get('redirect_uri') ?? '';
        if (!client) return json(400, { error: 'invalid_client' });
        // RFC 8252: a loopback address may use any port.
        const registered = new URL(client.redirect_uris[0]);
        const asked = new URL(redirect);
        if (asked.hostname !== registered.hostname || asked.pathname !== registered.pathname) return json(400, { error: 'invalid_redirect_uri' });
        if (url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge')) return json(400, { error: 'invalid_request' });
        const code = `code_${randomBytes(8).toString('hex')}`;
        state.codes.set(code, { challenge: /** @type {string} */ (url.searchParams.get('code_challenge')), redirect, client: client.client_id });
        const back = new URL(redirect);
        back.searchParams.set('code', code);
        const st = url.searchParams.get('state');
        if (st) back.searchParams.set('state', st);
        return void res.writeHead(302, { location: back.href }).end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const form = new URLSearchParams((await readBody(req)).toString('utf8'));
        state.tokenRequests.push(Object.fromEntries(form));
        if (form.get('grant_type') === 'authorization_code') {
          const entry = state.codes.get(form.get('code') ?? '');
          if (!entry || challengeOf(form.get('code_verifier') ?? '') !== entry.challenge || form.get('client_id') !== entry.client) return json(400, { error: 'invalid_grant' });
          state.codes.delete(form.get('code') ?? '');
          const at = `at_${randomBytes(8).toString('hex')}`;
          const rt = `rt_${randomBytes(8).toString('hex')}`;
          state.accessTokens.add(at);
          state.refreshTokens.add(rt);
          return json(200, { access_token: at, token_type: 'Bearer', expires_in: 3600, refresh_token: rt, scope: 'mcp' });
        }
        if (form.get('grant_type') === 'refresh_token') {
          const old = form.get('refresh_token') ?? '';
          if (!state.refreshTokens.has(old)) return json(400, { error: 'invalid_grant' });
          state.refreshTokens.delete(old); // rotation
          state.refreshCount += 1;
          const at = `at_${randomBytes(8).toString('hex')}`;
          const rt = `rt_${randomBytes(8).toString('hex')}`;
          state.accessTokens.add(at);
          state.refreshTokens.add(rt);
          return json(200, { access_token: at, token_type: 'Bearer', expires_in: 3600, refresh_token: rt, scope: 'mcp' });
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (url.pathname === '/api/mcp') {
        const auth = req.headers.authorization ?? '';
        state.mcpAuthHeaders.push(auth ? 'present' : 'missing');
        const token = auth.replace(/^Bearer /, '');
        if (!state.accessTokens.has(token)) {
          return json(401, { error: { code: 'missing_key', message: 'Sign in.' } }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` });
        }
        if (options.planBlocked) return json(403, { error: { code: 'plan_required', message: 'The API and MCP are part of Pro. You are on Free.' } });
        const server = mcpFor();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        const raw = await readBody(req);
        return void (await transport.handleRequest(req, res, raw.length ? JSON.parse(raw.toString('utf8')) : undefined));
      }
      if (url.pathname.startsWith('/upload/') && req.method === 'PUT') {
        const id = url.pathname.slice('/upload/'.length);
        state.putCount += 1;
        state.putHeaders.push({ 'content-type': req.headers['content-type'], 'content-length': req.headers['content-length'] });
        const body = await readBody(req);
        if (state.putFailures > 0) {
          state.putFailures -= 1;
          return json(503, { error: 'busy' });
        }
        if (String(body.length) !== req.headers['content-length']) return json(400, { error: 'length mismatch' });
        state.putBodies.set(id, body);
        return json(200, { Key: id });
      }
      if (url.pathname === '/api/kit/platform-rules') {
        state.rulesHits += 1;
        return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }).end(readFileSync(SNAPSHOT));
      }
      json(404, { error: 'not found' });
    } catch (error) {
      if (!res.headersSent) json(500, { error: String(/** @type {any} */ (error)?.message ?? error) });
    }
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', () => resolve(undefined)));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (http.address()).port}`;

  return {
    base,
    brandId,
    otherBrandId,
    state,
    /** The browser: open the sign-in link and follow it back to the kit's loopback page, as a signed-in person's browser would. */
    async approveInBrowser(/** @type {string} */ authUrl) {
      const r = await fetch(authUrl, { redirect: 'follow' });
      await r.text();
      return r.status;
    },
    /** Make every access token stop working (they "expired"). */
    expireAccessTokens() {
      state.accessTokens.clear();
    },
    async close() {
      http.closeAllConnections();
      await new Promise((resolve) => http.close(() => resolve(undefined)));
    },
  };
}

/**
 * Start the fake and point the kit at it: DANDELION_URL, a fresh kit home, and a "browser" that approves at once.
 * @param {Parameters<typeof startFakeDandelion>[0]} [options]
 */
export async function useFakeDandelion(options = {}) {
  const { makeTempDir } = await import('../core/util/fs.mjs');
  const { rmSync } = await import('node:fs');
  const fake = await startFakeDandelion(options);
  const previous = {
    home: process.env.DANDELION_KIT_HOME,
    url: process.env.DANDELION_URL,
    offline: process.env.DANDELION_KIT_OFFLINE,
    wait: process.env.DANDELION_KIT_CONNECT_WAIT_MS,
  };
  const home = makeTempDir('kit-dandelion-test-');
  process.env.DANDELION_KIT_HOME = home;
  process.env.DANDELION_URL = fake.base;
  delete process.env.DANDELION_KIT_OFFLINE;
  const client = await import('../server/dandelion/client.mjs');
  client.setBrowserOpener((url) => fake.approveInBrowser(url).then(() => undefined));
  return {
    fake,
    home,
    client,
    async stop() {
      client.setBrowserOpener(null);
      await client.closeSession();
      client.invalidateState();
      await fake.close();
      for (const [key, value] of /** @type {[string, string | undefined][]} */ ([
        ['DANDELION_KIT_HOME', previous.home],
        ['DANDELION_URL', previous.url],
        ['DANDELION_KIT_OFFLINE', previous.offline],
        ['DANDELION_KIT_CONNECT_WAIT_MS', previous.wait],
      ])) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
}
