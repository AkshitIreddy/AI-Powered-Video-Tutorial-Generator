import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { RenderManifest, VisualAssetInput, VisualAssetMediaType } from "./contracts.js";

const MAX_VISUAL_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_VISUAL_ASSET_TOTAL_BYTES = 128 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export interface VisualAssetPayload {
  readonly id: string;
  readonly sha256: string;
  readonly mediaType: VisualAssetMediaType;
  readonly bytes: Uint8Array;
}

function isWithin(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === "" || (!part.startsWith("..") && !part.startsWith("/") && !part.startsWith("\\"));
}

function assertImageMagic(bytes: Uint8Array, mediaType: VisualAssetMediaType, id: string): void {
  const has = (...values: number[]): boolean => values.every((value, index) => bytes[index] === value);
  const valid = mediaType === "image/png"
    ? has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : mediaType === "image/jpeg"
      ? has(0xff, 0xd8, 0xff)
      : has(0x52, 0x49, 0x46, 0x46) && bytes.length >= 12
        && hasAt(bytes, 8, 0x57, 0x45, 0x42, 0x50);
  if (!valid) throw new TypeError(`Visual asset ${id} bytes do not match declared media type ${mediaType}`);
}

function hasAt(bytes: Uint8Array, offset: number, ...values: number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

async function loadOne(input: VisualAssetInput, boundaryRoot: string): Promise<VisualAssetPayload> {
  const candidate = resolve(input.path);
  const resolvedBoundary = resolve(boundaryRoot);
  if (!isWithin(resolvedBoundary, candidate)) {
    throw new TypeError(`Visual asset ${input.id} must be staged inside the renderer attempt root`);
  }
  const linkInfo = await lstat(candidate);
  if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) {
    throw new TypeError(`Visual asset ${input.id} must be a regular non-symlink file`);
  }
  if (linkInfo.size <= 0 || linkInfo.size > MAX_VISUAL_ASSET_BYTES) {
    throw new RangeError(`Visual asset ${input.id} must be between 1 and ${MAX_VISUAL_ASSET_BYTES} bytes`);
  }
  const canonicalPath = await realpath(candidate);
  if (!isWithin(resolvedBoundary, canonicalPath)) {
    throw new TypeError(`Visual asset ${input.id} resolves outside the renderer attempt root`);
  }
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(candidate, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== linkInfo.size) {
      throw new TypeError(`Visual asset ${input.id} changed before it could be read`);
    }
    const bytes = new Uint8Array(await handle.readFile());
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new TypeError(`Visual asset ${input.id} changed while it was being read`);
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (!SHA256_PATTERN.test(input.sha256) || actualHash !== input.sha256.toLowerCase()) {
      throw new TypeError(`Visual asset ${input.id} SHA-256 does not match its manifest binding`);
    }
    assertImageMagic(bytes, input.mediaType, input.id);
    return Object.freeze({ id: input.id, sha256: actualHash, mediaType: input.mediaType, bytes });
  } finally {
    await handle.close();
  }
}

/**
 * Reads attempt-local image copies exactly once, after containment, regular-file,
 * size, magic and SHA-256 validation. Browser pages never receive their paths.
 */
export async function loadVisualAssetPayloads(manifest: RenderManifest): Promise<readonly VisualAssetPayload[]> {
  const inputs = manifest.visualAssets ?? [];
  if (inputs.length === 0) return [];
  const attemptRoot = resolve(dirname(resolve(manifest.outputDirectory)));
  const payloads: VisualAssetPayload[] = [];
  let total = 0;
  for (const input of inputs) {
    const payload = await loadOne(input, attemptRoot);
    total += payload.bytes.byteLength;
    if (total > MAX_VISUAL_ASSET_TOTAL_BYTES) {
      throw new RangeError(`Visual assets exceed the ${MAX_VISUAL_ASSET_TOTAL_BYTES}-byte render limit`);
    }
    payloads.push(payload);
  }
  return Object.freeze(payloads);
}

function replaceReadyState(html: string): string {
  const ready = 'data-render-ready="true"';
  if (!html.includes(ready)) throw new TypeError("Rendered HTML is missing its readiness marker");
  return html.replace(ready, 'data-render-ready="false"');
}

/**
 * Adds a trusted, deterministic browser bootstrap. The source SVG keeps only
 * `alystria-asset:sha256/...` references; the browser receives bytes inline and
 * turns them into page-scoped `blob:` URLs after DOM creation. No filesystem or
 * network URL enters the document, and readiness waits for every image decode.
 */
export function attachVisualAssetBootstrap(
  html: string,
  payloads: readonly VisualAssetPayload[],
): string {
  if (payloads.length === 0) return html;
  const records = payloads.map((payload) => ({
    hash: payload.sha256,
    mediaType: payload.mediaType,
    base64: Buffer.from(payload.bytes).toString("base64"),
  }));
  const serialized = JSON.stringify(records).replace(/</g, "\\u003c");
  const bootstrap = `<script>(async()=>{const records=${serialized};const urls=new Map();for(const record of records){const binary=atob(record.base64);const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);urls.set(record.hash,URL.createObjectURL(new Blob([bytes],{type:record.mediaType})));}const images=[...document.querySelectorAll('image[href^="alystria-asset:sha256/"]')];await Promise.all(images.map(async image=>{const hash=image.getAttribute('href').slice('alystria-asset:sha256/'.length);const url=urls.get(hash);if(!url)throw new Error('Missing verified visual asset '+hash);const preload=new Image();preload.src=url;if(typeof preload.decode==='function')await preload.decode();else await new Promise((resolve,reject)=>{preload.onload=resolve;preload.onerror=()=>reject(new Error('Could not decode verified visual asset '+hash));});image.setAttribute('href',url);image.setAttributeNS('http://www.w3.org/1999/xlink','href',url);}));document.body.dataset.renderReady='true';})().catch(error=>{document.body.dataset.renderError=String(error&&error.message||error);});</script>`;
  const close = html.lastIndexOf("</body>");
  if (close < 0) throw new TypeError("Rendered HTML is missing a closing body element");
  const waiting = replaceReadyState(html);
  const waitingClose = waiting.lastIndexOf("</body>");
  return `${waiting.slice(0, waitingClose)}${bootstrap}${waiting.slice(waitingClose)}`;
}
