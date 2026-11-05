// Shared helpers for the server tests. Not a test file.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/** Share the already downloaded speech model, so tests do not download it again. */
export function useSharedModels() {
  process.env.DANDELION_KIT_MODELS ??= join(homedir(), '.dandelion-kit', 'models');
}

/**
 * A kit server and a client joined in memory.
 * @param {{demo?: boolean}} [options]
 */
export async function connectKit(options = {}) {
  const { createKitServer } = await import('../server/index.mjs');
  const server = createKitServer(options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'kit-test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    server,
    client,
    /** Call a tool and return the MCP result. @param {string} name @param {Record<string, any>} [args] */
    async call(name, args = {}) {
      return /** @type {any} */ (await client.callTool({ name, arguments: args }));
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** The text of a tool result. @param {any} result */
export const textOf = (result) => result.content.map((/** @type {any} */ c) => c.text).join('\n');

/** The characters we never write: em dash and en dash. */
export const DASH_RE = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);

/** Wait through the tool's documented background replies without starting a second build.
 * @param {{call:(name:string,args?:Record<string,any>)=>Promise<any>}} kit
 * @param {string} name
 * @param {Record<string,any>} args
 * @param {number} [timeoutMs]
 */
export async function callFinished(kit, name, args, timeoutMs = 360000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const result = await kit.call(name, args);
    if (result.isError || !result.structuredContent?.pending) return result;
    if (Date.now() >= end) throw new Error(`Timed out waiting for ${name} to finish.`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
