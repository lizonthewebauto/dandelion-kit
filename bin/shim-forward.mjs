// After the first-run shim hands off to the real server, this forwards the host's stdin one line at a time.
// A host that ignores "tools/list_changed" still thinks the only tool is setup_status, and the real server has no such
// tool, so a setup_status call is answered here instead of reaching it. Zero dependencies: the shim runs before
// node_modules exists.

export const READY_TEXT =
  'Setup is done and all the Dandelion Kit tools are ready. If you only see setup_status, start a new session so the tools load, then call doctor.';

/**
 * Line-buffered forwarder. Every complete line goes to `write` unchanged and newline-terminated, except a setup_status
 * tools/call with an id, which is answered through `answer` and not forwarded.
 * @param {(line: string) => void} write
 * @param {(msg: any) => void} answer
 * @param {string} [pending] Text already read that has no newline yet.
 */
export function createForwarder(write, answer, pending = '') {
  let buf = pending;
  /** @param {string} line */
  const route = (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg?.method === 'tools/call' && msg.params?.name === 'setup_status' && msg.id !== undefined && msg.id !== null) {
        answer({ id: msg.id, result: { content: [{ type: 'text', text: READY_TEXT }], isError: false } });
        return;
      }
    } catch {
      // Not JSON; pass it on.
    }
    write(`${line}\n`);
  };
  return {
    /** @param {string|Buffer} chunk */
    push(chunk) {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        route(line);
      }
    },
    /** Send whatever is left when stdin ends. */
    flush() {
      const rest = buf;
      buf = '';
      if (rest.trim()) route(rest);
    },
  };
}
