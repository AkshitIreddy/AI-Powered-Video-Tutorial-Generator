import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type {
  FontAssetInput,
  FontAssetMediaType,
  FontAssetRole,
} from "./contracts.js";

const MAX_FONT_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_FONT_ASSET_TOTAL_BYTES = 48 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const FAMILY_PATTERN = /^AlystriaImported-[0-9a-f]{16}$/;

export interface FontAssetPayload extends Omit<FontAssetInput, "path"> {
  readonly bytes: Uint8Array;
}

export interface FontAssetManifest {
  readonly outputDirectory: string;
  readonly fontAssets?: readonly FontAssetInput[];
}

function isWithin(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === "" || (!part.startsWith("..") && !part.startsWith("/") && !part.startsWith("\\"));
}

function hasAt(bytes: Uint8Array, offset: number, ...values: number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function assertFontMagic(bytes: Uint8Array, mediaType: FontAssetMediaType, id: string): void {
  const sfnt = hasAt(bytes, 0, 0x00, 0x01, 0x00, 0x00)
    || hasAt(bytes, 0, 0x74, 0x72, 0x75, 0x65)
    || hasAt(bytes, 0, 0x74, 0x79, 0x70, 0x31);
  const valid = mediaType === "font/ttf"
    ? sfnt
    : mediaType === "font/otf"
      ? hasAt(bytes, 0, 0x4f, 0x54, 0x54, 0x4f)
      : hasAt(bytes, 0, 0x77, 0x4f, 0x46, 0x46);
  if (!valid) throw new TypeError(`Font asset ${id} bytes do not match declared media type ${mediaType}`);
}

function assertFontInput(input: FontAssetInput): void {
  if (!input.id.trim() || input.id.length > 200) throw new TypeError("Font asset id must be bounded and non-empty");
  if (!SHA256_PATTERN.test(input.sha256)) throw new TypeError(`Font asset ${input.id} must have a SHA-256 binding`);
  if (!FAMILY_PATTERN.test(input.family)) throw new TypeError(`Font asset ${input.id} must use its deterministic renderer family alias`);
  if (input.inspectionStatus !== "metadata-inspected" || input.exportEligible !== true) {
    throw new TypeError(`Font asset ${input.id} is not cleared for final rendering`);
  }
  if (!(["installable", "previewPrint", "editable"] as const).includes(input.embeddingPermission)) {
    throw new TypeError(`Font asset ${input.id} has unsupported embedding permission`);
  }
  if (!Array.isArray(input.roles) || input.roles.length === 0 || input.roles.length > 4) {
    throw new TypeError(`Font asset ${input.id} needs one to four typography roles`);
  }
  const roleSet = new Set<FontAssetRole>();
  for (const role of input.roles) {
    if (!(["display", "body", "code", "caption"] as const).includes(role) || roleSet.has(role)) {
      throw new TypeError(`Font asset ${input.id} has unsupported or duplicate typography roles`);
    }
    roleSet.add(role);
  }
  const weights = typeof input.weight === "number" ? [input.weight] : input.weight;
  if (weights.length < 1 || weights.length > 2 || weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 1_000)) {
    throw new RangeError(`Font asset ${input.id} weight must stay within OpenType's 1..1000 range`);
  }
  if (weights.length === 2 && weights[0]! > weights[1]!) throw new RangeError(`Font asset ${input.id} variable weight range is reversed`);
  if (input.style !== "normal" && input.style !== "italic") throw new TypeError(`Font asset ${input.id} has unsupported style`);
}

export function assertFontAssetInputs(inputs: readonly FontAssetInput[]): void {
  const ids = new Set<string>();
  const roles = new Set<FontAssetRole>();
  for (const input of inputs) {
    assertFontInput(input);
    if (ids.has(input.id)) throw new TypeError(`Duplicate font asset id ${input.id}`);
    ids.add(input.id);
    for (const role of input.roles) {
      if (roles.has(role)) throw new TypeError(`Typography role ${role} is bound by more than one font asset`);
      roles.add(role);
    }
  }
}

async function loadOne(input: FontAssetInput, boundaryRoot: string): Promise<FontAssetPayload> {
  const candidate = resolve(input.path);
  const resolvedBoundary = resolve(boundaryRoot);
  if (!isWithin(resolvedBoundary, candidate)) throw new TypeError(`Font asset ${input.id} must be staged inside the renderer attempt root`);
  const linkInfo = await lstat(candidate);
  if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) throw new TypeError(`Font asset ${input.id} must be a regular non-symlink file`);
  if (linkInfo.size <= 0 || linkInfo.size > MAX_FONT_ASSET_BYTES) {
    throw new RangeError(`Font asset ${input.id} must be between 1 and ${MAX_FONT_ASSET_BYTES} bytes`);
  }
  const canonicalPath = await realpath(candidate);
  if (!isWithin(resolvedBoundary, canonicalPath)) throw new TypeError(`Font asset ${input.id} resolves outside the renderer attempt root`);
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(candidate, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== linkInfo.size) throw new TypeError(`Font asset ${input.id} changed before it could be read`);
    const bytes = new Uint8Array(await handle.readFile());
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new TypeError(`Font asset ${input.id} changed while it was being read`);
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== input.sha256.toLowerCase()) throw new TypeError(`Font asset ${input.id} SHA-256 does not match its manifest binding`);
    assertFontMagic(bytes, input.mediaType, input.id);
    const { path: _path, ...portable } = input;
    return Object.freeze({ ...portable, sha256: actualHash, bytes });
  } finally {
    await handle.close();
  }
}

/** Read each attempt-local font once after containment, hash and magic validation. */
export async function loadFontAssetPayloads(manifest: FontAssetManifest): Promise<readonly FontAssetPayload[]> {
  const inputs = manifest.fontAssets ?? [];
  assertFontAssetInputs(inputs);
  if (inputs.length === 0) return [];
  const attemptRoot = resolve(dirname(resolve(manifest.outputDirectory)));
  const payloads: FontAssetPayload[] = [];
  let total = 0;
  for (const input of inputs) {
    const payload = await loadOne(input, attemptRoot);
    total += payload.bytes.byteLength;
    if (total > MAX_FONT_ASSET_TOTAL_BYTES) throw new RangeError(`Font assets exceed the ${MAX_FONT_ASSET_TOTAL_BYTES}-byte render limit`);
    payloads.push(payload);
  }
  return Object.freeze(payloads);
}

function fontFormat(mediaType: FontAssetMediaType): string {
  if (mediaType === "font/ttf") return "truetype";
  if (mediaType === "font/otf") return "opentype";
  return "woff";
}

/**
 * Installs hash-verified bytes through the browser FontFace API. It exposes no
 * local path and assigns a promise consumed by PinnedBrowserCapture before any
 * screenshot. A rejected font decode therefore fails the render visibly.
 */
export function attachFontAssetBootstrap(html: string, payloads: readonly FontAssetPayload[]): string {
  if (payloads.length === 0) return html;
  const records = payloads.map((payload) => ({
    family: payload.family,
    mediaType: payload.mediaType,
    format: fontFormat(payload.mediaType),
    base64: Buffer.from(payload.bytes).toString("base64"),
    style: payload.style,
    weight: typeof payload.weight === "number" ? String(payload.weight) : `${payload.weight[0]} ${payload.weight[1]}`,
  }));
  const serialized = JSON.stringify(records).replace(/</g, "\\u003c");
  const bootstrap = `<script>(()=>{const records=${serialized};const urls=[];globalThis.__alystriaFontReady=(async()=>{for(const record of records){const binary=atob(record.base64);const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);const url=URL.createObjectURL(new Blob([bytes],{type:record.mediaType}));urls.push(url);const face=new FontFace(record.family,'url("'+url+'") format("'+record.format+'")',{style:record.style,weight:record.weight,display:'block'});document.fonts.add(face);await face.load();if(face.status!=='loaded')throw new Error('Verified font did not load: '+record.family);}await document.fonts.ready;return records.map(record=>record.family);})().catch(error=>{document.body.dataset.renderError=String(error&&error.message||error);throw error;});globalThis.__alystriaFontUrls=urls;})();</script>`;
  const head = html.lastIndexOf("</head>");
  if (head < 0) throw new TypeError("Rendered HTML is missing a closing head element");
  return `${html.slice(0, head)}${bootstrap}${html.slice(head)}`;
}

export function rendererFontFamily(sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) throw new TypeError("Renderer font family requires a SHA-256 hash");
  return `AlystriaImported-${sha256.toLowerCase().slice(0, 16)}`;
}
