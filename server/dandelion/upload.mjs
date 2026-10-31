// Sending a file from this computer to Dandelion: create_upload gives a one-time link, the file is streamed to it with PUT,
// and the upload_id it returned goes into add_content. Retries twice on a network error or a server hiccup.
import { createReadStream, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import * as log from '../../core/util/log.mjs';
import { DandelionError } from './config.mjs';

/** The file types Dandelion takes, by ending. */
export const UPLOAD_MIME = Object.freeze(
  /** @type {Record<string, string>} */ ({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
  }),
);

/** Dandelion's file size limit. */
export const MAX_UPLOAD_BYTES = 450 * 1024 * 1024;

/** @param {string} file */
export function mimeFor(file) {
  return UPLOAD_MIME[extname(file).toLowerCase()];
}

/**
 * @typedef {object} UploadedFile
 * @property {string} file
 * @property {string} upload_id
 * @property {string} mime
 * @property {number} bytes
 */

/**
 * Upload one file. `createUpload` is client.createUpload (passed in so tests can stand in for Dandelion).
 * @param {object} options
 * @param {string} options.brandId
 * @param {string} options.file
 * @param {(input: {brandId: string, filename: string, bytes: number, mime: string}) => Promise<{upload_id: string, url: string, headers?: Record<string, string>, method?: string}>} options.createUpload
 * @param {(sentBytes: number, totalBytes: number) => void} [options.onProgress]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.retries]     Extra tries after the first. Default 2.
 * @param {number} [options.retryDelayMs]
 * @returns {Promise<UploadedFile>}
 */
export async function uploadFile({ brandId, file, createUpload, onProgress, fetchImpl = fetch, retries = 2, retryDelayMs = 800 }) {
  const name = basename(file);
  const mime = mimeFor(file);
  if (!mime) throw new DandelionError(`Dandelion cannot post ${name}. Use JPG, PNG, WEBP, GIF, MP4, MOV or WEBM.`, 'invalid_input');
  let bytes;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    bytes = st.size;
  } catch {
    throw new DandelionError(`I could not find the file ${file}.`, 'invalid_input');
  }
  if (bytes < 1) throw new DandelionError(`${name} is empty.`, 'invalid_input');
  if (bytes > MAX_UPLOAD_BYTES) throw new DandelionError(`${name} is too big. Dandelion takes files up to 450 MB.`, 'invalid_input');

  /** @type {unknown} */
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    // A fresh link every try: a half-used link may not be usable again.
    const upload = await createUpload({ brandId, filename: name, bytes, mime });
    let sent = 0;
    let lastLogged = 0;
    async function* chunks() {
      for await (const chunk of createReadStream(file)) {
        sent += chunk.length;
        onProgress?.(sent, bytes);
        if (bytes > 5_000_000 && sent - lastLogged >= bytes / 10) {
          lastLogged = sent;
          log.info(`Uploading ${name}: ${Math.round((sent / bytes) * 100)}%`);
        }
        yield chunk;
      }
    }
    try {
      const response = await fetchImpl(upload.url, {
        method: 'PUT',
        headers: { ...(upload.headers ?? {}), 'content-type': upload.headers?.['content-type'] ?? mime, 'content-length': String(bytes) },
        body: /** @type {any} */ (Readable.toWeb(Readable.from(chunks(), { objectMode: false }))),
        // @ts-ignore Node needs this for a streamed body.
        duplex: 'half',
      });
      if (response.ok) {
        await response.arrayBuffer().catch(() => {});
        return { file, upload_id: upload.upload_id, mime, bytes };
      }
      await response.arrayBuffer().catch(() => {});
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        lastError = new DandelionError(`Dandelion's storage was busy (${response.status}).`, 'storage_busy', response.status);
        continue;
      }
      throw new DandelionError(
        response.status === 413
          ? `${name} is too big for Dandelion.`
          : `Dandelion's storage did not accept ${name} (error ${response.status}). Try sending it again.`,
        'upload_refused',
        response.status,
      );
    } catch (error) {
      if (error instanceof DandelionError && error.code === 'upload_refused') throw error;
      lastError = error;
    }
  }
  if (lastError instanceof DandelionError) throw lastError;
  throw new DandelionError(`The upload of ${name} did not finish. Check your internet connection and try again.`, 'network');
}

/**
 * Upload several files one after another.
 * @param {object} options
 * @param {string} options.brandId
 * @param {string[]} options.files
 * @param {Parameters<typeof uploadFile>[0]['createUpload']} options.createUpload
 * @param {(fraction: number, message: string) => void} [options.progress]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.retries]
 * @param {number} [options.retryDelayMs]
 * @returns {Promise<UploadedFile[]>}
 */
export async function uploadFiles({ brandId, files, createUpload, progress, fetchImpl, retries, retryDelayMs }) {
  const totalBytes = files.reduce((n, f) => {
    try {
      return n + statSync(f).size;
    } catch {
      return n;
    }
  }, 0);
  let done = 0;
  /** @type {UploadedFile[]} */
  const out = [];
  for (const file of files) {
    const before = done;
    const uploaded = await uploadFile({
      brandId,
      file,
      createUpload,
      fetchImpl,
      retries,
      retryDelayMs,
      onProgress: (sent) => progress?.(totalBytes ? (before + sent) / totalBytes : 0, `Uploading ${basename(file)}`),
    });
    done += uploaded.bytes;
    out.push(uploaded);
  }
  return out;
}
