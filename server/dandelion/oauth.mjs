// Signing in to Dandelion from inside the chat: OAuth 2.1 with a public client, PKCE (done by the MCP SDK), and a loopback
// listener on 127.0.0.1 that catches the browser's return trip. The person types their password in the browser, never here.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as log from '../../core/util/log.mjs';
import { clearRecord, readRecord, updateRecord } from './auth-store.mjs';
import { DandelionError, NotSignedInError, kitVersion, mcpUrl, plainDandelionError } from './config.mjs';

/** What Dandelion shows on its consent page, and how it recognizes the Kit. Do not change these strings. */
export const CLIENT_NAME = 'Dandelion Kit';
export const CLIENT_URI = 'https://dandelionapp.io/kit';

/** How long a sign-in may stay open. */
export const SIGN_IN_WINDOW_MS = 3 * 60 * 1000;

/**
 * The OAuth provider the SDK drives. `interactive` false means "never open a browser": if the saved sign-in no longer works,
 * the call fails with NotSignedInError and the person is told to connect again.
 */
export class KitAuthProvider {
  /**
   * @param {object} options
   * @param {string} options.serverUrl
   * @param {string} [options.redirectUrl]   The loopback address for this sign-in, such as http://127.0.0.1:51234/callback.
   * @param {boolean} [options.interactive]
   * @param {(url: URL) => void} [options.onAuthorizationUrl]
   */
  constructor({ serverUrl, redirectUrl, interactive = false, onAuthorizationUrl }) {
    this.serverUrl = serverUrl;
    this.redirect = redirectUrl ?? 'http://127.0.0.1:8976/callback';
    this.interactive = interactive;
    this.onAuthorizationUrl = onAuthorizationUrl;
    /** @type {string|undefined} */
    this._state = undefined;
    /** @type {string|undefined} */
    this._verifier = undefined;
  }

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata() {
    return {
      client_name: CLIENT_NAME,
      client_uri: CLIENT_URI,
      redirect_uris: [this.redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp',
    };
  }

  /** The OAuth state value for this sign-in. */
  state() {
    if (!this._state) this._state = randomBytes(18).toString('hex');
    return this._state;
  }

  clientInformation() {
    return readRecord(this.serverUrl).client;
  }

  /** @param {any} info */
  async saveClientInformation(info) {
    await updateRecord(this.serverUrl, (r) => ({ ...r, client: info }));
  }

  tokens() {
    return readRecord(this.serverUrl).tokens;
  }

  /** @param {any} tokens */
  async saveTokens(tokens) {
    await updateRecord(this.serverUrl, (r) => ({ ...r, tokens: { ...tokens, saved_at: Date.now() } }));
  }

  /** @param {URL} url */
  async redirectToAuthorization(url) {
    if (!this.interactive) throw new NotSignedInError('The Dandelion sign-in ran out. Say "connect Dandelion" and finish it in your browser.');
    this.onAuthorizationUrl?.(url);
  }

  /** @param {string} verifier */
  saveCodeVerifier(verifier) {
    this._verifier = verifier; // memory only, never written to disk
  }

  codeVerifier() {
    if (!this._verifier) throw new DandelionError('The sign-in lost track of itself. Say "connect Dandelion" again.', 'bad_state');
    return this._verifier;
  }

  /** @param {'all'|'client'|'tokens'|'verifier'|'discovery'} scope */
  async invalidateCredentials(scope) {
    if (scope === 'all') await clearRecord(this.serverUrl, true);
    else if (scope === 'client') await updateRecord(this.serverUrl, (r) => ({ tokens: r.tokens }));
    else if (scope === 'tokens') await updateRecord(this.serverUrl, (r) => ({ client: r.client }));
    else if (scope === 'verifier') this._verifier = undefined;
  }
}

// ---------------------------------------------------------------------------
// Opening the browser
// ---------------------------------------------------------------------------

/** @type {((url: string) => void | Promise<void>) | null} */
let opener = null;

/** For tests: replace the browser. Pass null to go back to the real one. @param {((url: string) => void | Promise<void>) | null} fn */
export function setBrowserOpener(fn) {
  opener = fn;
}

/** @param {string} url */
async function openBrowser(url) {
  try {
    if (opener) {
      await opener(url);
      return;
    }
    if (process.env.DANDELION_KIT_NO_BROWSER) return;
    const mod = await import('open');
    await mod.default(url);
  } catch (error) {
    log.warn('Could not open the browser by itself:', error);
  }
}

// ---------------------------------------------------------------------------
// The sign-in flow
// ---------------------------------------------------------------------------

const PAGE = (/** @type {string} */ title, /** @type {string} */ line) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>body{font:18px/1.5 system-ui,sans-serif;background:#fffaf0;color:#2b2118;display:grid;place-items:center;min-height:100vh;margin:0}` +
  `main{max-width:30rem;padding:2rem}h1{font-size:1.6rem;margin:0 0 .5rem}p{margin:0}</style></head>` +
  `<body><main><h1>${title}</h1><p>${line}</p></main></body></html>`;

/**
 * @typedef {object} SignInFlow
 * @property {Promise<void>} done          Settles when sign-in finishes (resolves) or fails (rejects).
 * @property {() => string} authUrl        The link the person opens ("" until Dandelion has answered).
 * @property {number} startedAt
 * @property {() => void} cancel
 */

/** @type {SignInFlow | null} */
let current = null;

/** The sign-in that is waiting for the person, if any. */
export function pendingSignIn() {
  return current;
}

/**
 * Start a sign-in (or join the one that is already waiting).
 * @param {{windowMs?: number}} [options]
 * @returns {SignInFlow}
 */
export function startSignIn(options = {}) {
  if (current) return current;
  const windowMs = options.windowMs ?? SIGN_IN_WINDOW_MS;
  const serverUrl = mcpUrl();
  let authUrl = '';
  /** @type {(code: string) => void} */
  let gotCode = () => {};
  /** @type {(error: Error) => void} */
  let gotError = () => {};
  const codePromise = new Promise((resolve, reject) => {
    gotCode = resolve;
    gotError = reject;
  });
  codePromise.catch(() => {});

  /** @type {import('node:http').Server | null} */
  let listener = null;
  let finished = false;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;

  const cleanup = () => {
    finished = true;
    if (timer) clearTimeout(timer);
    try {
      listener?.close();
      listener?.closeAllConnections?.();
    } catch {
      // Already closed.
    }
    current = null;
  };

  const flow = /** @type {SignInFlow} */ ({
    startedAt: Date.now(),
    authUrl: () => authUrl,
    cancel: () => gotError(new DandelionError('The sign-in was cancelled.', 'cancelled')),
    done: Promise.resolve(),
  });
  current = flow;

  flow.done = (async () => {
    try {
      listener = createServer();
      await new Promise((resolve, reject) => {
        /** @type {import('node:http').Server} */ (listener).once('error', reject);
        /** @type {import('node:http').Server} */ (listener).listen(0, '127.0.0.1', () => resolve(undefined));
      });
      const address = /** @type {import('node:net').AddressInfo} */ (listener.address());
      const redirectUrl = `http://127.0.0.1:${address.port}/callback`;
      const provider = new KitAuthProvider({
        serverUrl,
        redirectUrl,
        interactive: true,
        onAuthorizationUrl: (url) => {
          authUrl = url.href;
          log.info(`Finish signing in to Dandelion in your browser. If it did not open, go to: ${authUrl}`);
          void openBrowser(authUrl);
        },
      });

      listener.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUrl);
        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
          return;
        }
        if (url.searchParams.get('state') !== provider.state()) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('That link is not for this sign-in', 'Go back to your chat and say "connect Dandelion" to start again.'));
          return;
        }
        const denied = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (denied) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Dandelion was not connected', 'You chose not to allow it. Nothing was changed. You can close this tab.'));
          gotError(new DandelionError('You chose not to allow the Dandelion Kit. Nothing was changed.', 'access_denied'));
          return;
        }
        if (!code) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Something is missing', 'Go back to your chat and say "connect Dandelion" to start again.'));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('You are connected', 'Dandelion is connected to your kit. You can close this tab and go back to your chat.'));
        gotCode(code);
      });

      timer = setTimeout(() => gotError(new DandelionError('The Dandelion sign-in was not finished in time. Say "connect Dandelion" to try again.', 'timeout')), windowMs);
      timer.unref?.();

      const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider });
      const client = new Client({ name: 'dandelion-kit', version: kitVersion() }, { capabilities: {} });
      try {
        await client.connect(transport);
        await client.close().catch(() => {});
        return; // Already signed in: the saved sign-in still works.
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw explain(error);
      }
      const code = await codePromise;
      try {
        await transport.finishAuth(/** @type {string} */ (code));
        // Prove it works with a fresh connection.
        const check = new Client({ name: 'dandelion-kit', version: kitVersion() }, { capabilities: {} });
        const checkTransport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: new KitAuthProvider({ serverUrl, redirectUrl, interactive: false }) });
        await check.connect(checkTransport);
        await check.close().catch(() => {});
      } catch (error) {
        throw explain(error);
      }
    } finally {
      if (!finished) cleanup();
    }
  })();
  flow.done.catch(() => {});
  return flow;
}

/**
 * Turn a failure while connecting into a DandelionError with plain words.
 * @param {unknown} error
 */
export function explain(error) {
  if (error instanceof DandelionError) return error;
  const e = /** @type {any} */ (error);
  const message = String(e?.message ?? e ?? '');
  if (e?.code === 'ECONNREFUSED' || e?.cause?.code === 'ECONNREFUSED' || /fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/i.test(message) || /fetch failed/i.test(String(e?.cause?.message ?? ''))) {
    return new DandelionError('I could not reach Dandelion. Check your internet connection and try again.', 'network');
  }
  if (e instanceof UnauthorizedError) return new NotSignedInError();
  // The SDK puts the body of an HTTP error in the message. Dandelion's body is {"error":{"code":"plan_required",...}}.
  const body = /"code"\s*:\s*"([a-z_]+)"[^}]*?"message"\s*:\s*"([^"]*)"/.exec(message);
  if (body) {
    const code = body[1];
    if (code === 'invalid_key' || code === 'missing_key') return new NotSignedInError();
    return new DandelionError(plainDandelionError(code, body[2]), code, typeof e?.code === 'number' ? e.code : undefined);
  }
  if (typeof e?.status === 'number' || /HTTP \d{3}/.test(message)) {
    const status = e.status ?? e.code;
    return new DandelionError(`Dandelion answered with an error (${status}). Try again in a minute.`, 'http', typeof status === 'number' ? status : undefined);
  }
  return new DandelionError(message.length > 0 && message.length < 300 ? message : 'Something went wrong talking to Dandelion. Try again in a minute.', 'error');
}
