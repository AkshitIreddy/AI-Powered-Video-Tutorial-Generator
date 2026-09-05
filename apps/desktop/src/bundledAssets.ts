import biologySeedlingUrl from "./assets/teaching/biology-seedling-v1.png";
import computingWorkbenchUrl from "./assets/teaching/computing-workbench-v1.png";
import energyLandscapeUrl from "./assets/teaching/energy-landscape-v1.png";
import geometryObjectsUrl from "./assets/teaching/geometry-objects-v1.png";
import historyExcavationUrl from "./assets/teaching/history-excavation-v1.png";
import scienceLabUrl from "./assets/teaching/science-lab-v1.png";
import slideCalloutUrl from "./assets/teaching/slide-callout-v1.png";
import slideChapterUrl from "./assets/teaching/slide-chapter-v1.png";
import slideInkUrl from "./assets/teaching/slide-ink-v1.png";
import slidePaperUrl from "./assets/teaching/slide-paper-v1.png";
import slideUnderlineUrl from "./assets/teaching/slide-underline-v1.png";
import slideWatercolorUrl from "./assets/teaching/slide-watercolor-v1.png";
import {
  projectAssetImport,
  type ProjectAssetImportReceipt,
  type ProjectIdentityRequest,
} from "./native";

export type BundledAssetKind = "background" | "element";

export interface BundledAsset {
  id: string;
  url: string;
  label: string;
  description: string;
  kind: BundledAssetKind;
  sha256: string;
  byteSize: number;
  filename: string;
  category: string;
}

export interface NativeBundledAssetIdentity extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
}

export interface BundledAssetImportResult {
  asset: BundledAsset;
  receipt: ProjectAssetImportReceipt;
}

export interface BundledAssetImportDependencies {
  fetchAsset?: typeof fetch;
  importAsset?: typeof projectAssetImport;
}

export const bundledAssets: readonly BundledAsset[] = Object.freeze([
  {
    id: "slide-paper",
    url: slidePaperUrl,
    label: "Warm paper canvas",
    description: "A softly layered ivory paper surface with a quiet center for titles, diagrams, and readable lesson copy.",
    kind: "background",
    sha256: "8bda5d7b9a5332d3d6f2ea0f48adc8721f253641b1be0934ccd819b9a572edf9",
    byteSize: 1_664_653,
    filename: "slide-paper-v1.png",
    category: "Slide surfaces",
  },
  {
    id: "slide-watercolor",
    url: slideWatercolorUrl,
    label: "Watercolor corners",
    description: "Airy teal and lavender washes frame a bright center without competing with editable teaching content.",
    kind: "background",
    sha256: "8f3722548a79ce39914777a42773a67e4cc7887a653198b0c19bf26f9a985f8d",
    byteSize: 1_764_142,
    filename: "slide-watercolor-v1.png",
    category: "Slide surfaces",
  },
  {
    id: "slide-ink",
    url: slideInkUrl,
    label: "Midnight ink",
    description: "A deep blue-black painted surface with restrained teal edges for high-contrast technical explanations.",
    kind: "background",
    sha256: "1bb76ffac08f2624be6281c55b97d58dcce4a6472894cf210553b5b16264f0d7",
    byteSize: 1_862_857,
    filename: "slide-ink-v1.png",
    category: "Slide surfaces",
  },
  {
    id: "slide-chapter",
    url: slideChapterUrl,
    label: "Chapter glow",
    description: "A cinematic navy canvas with warm amber movement around a calm center for chapter openings and key ideas.",
    kind: "background",
    sha256: "c796a9eb40a415676572ed61385d3c3ce617d5521fc71303408a846e1964dbe8",
    byteSize: 1_982_397,
    filename: "slide-chapter-v1.png",
    category: "Slide surfaces",
  },
  {
    id: "slide-callout",
    url: slideCalloutUrl,
    label: "Torn-paper callout",
    description: "A wide translucent-edge paper strip for a definition, question, quotation, or compact worked step.",
    kind: "element",
    sha256: "bec8f528f715a87a75bb1e20697a82f898362ed2430f23475f23b08ae60b9af4",
    byteSize: 1_141_258,
    filename: "slide-callout-v1.png",
    category: "Layout accents",
  },
  {
    id: "slide-underline",
    url: slideUnderlineUrl,
    label: "Teal brush underline",
    description: "A transparent hand-painted stroke that can underline a phrase or anchor a short annotation.",
    kind: "element",
    sha256: "f0fdc8101f8212a2c5a1495c58d6d0246e1b4e210cd680b311b7b3b5f69651c4",
    byteSize: 486_676,
    filename: "slide-underline-v1.png",
    category: "Layout accents",
  },
  {
    id: "biology-seedling",
    url: biologySeedlingUrl,
    label: "Bean seedling",
    description: "A warm painted-paper cutaway with clear leaves, stem, soil, and branching roots for life-science callouts.",
    kind: "element",
    sha256: "f5b34946132e53a29117aa6a96301910b2ed920356fb00331fcf229fb2e0e1ed",
    byteSize: 2_417_429,
    filename: "biology-seedling-v1.png",
    category: "Life science",
  },
  {
    id: "science-lab",
    url: scienceLabUrl,
    label: "Science workbench",
    description: "An inviting microscope, glassware, test-tube rack, and blank notebook for laboratory introductions.",
    kind: "element",
    sha256: "56a84f8453f13c5b2ca0ddc408577528d357d3dfd237f190c73161a768c31642",
    byteSize: 2_581_603,
    filename: "science-lab-v1.png",
    category: "Science",
  },
  {
    id: "computing-workbench",
    url: computingWorkbenchUrl,
    label: "Computer workbench",
    description: "A neatly separated desktop chassis, motherboard, memory, processor, drive, and blank monitor for editable hardware lessons.",
    kind: "element",
    sha256: "ffbe9b01e4542746db2678a9e1d3ae339afeafb4f8d894370bef51164b7e9d49",
    byteSize: 3_104_173,
    filename: "computing-workbench-v1.png",
    category: "Computing",
  },
  {
    id: "energy-landscape",
    url: energyLandscapeUrl,
    label: "Renewable energy valley",
    description: "A river valley with a small village, rooftop solar, wind turbines, and open sky for sustainability lessons.",
    kind: "element",
    sha256: "4f7b64ce2086896d066d1605cbe3293cf70fd650e80fb962d65e223e97d677d3",
    byteSize: 2_792_189,
    filename: "energy-landscape-v1.png",
    category: "Energy",
  },
  {
    id: "history-excavation",
    url: historyExcavationUrl,
    label: "Archaeology field study",
    description: "A careful excavation trench, pottery fragments, tools, and distant foundations for evidence-literacy stories.",
    kind: "element",
    sha256: "79de9a7230967ee148468ad753c572017a94121b0943f925aa2f4ad9054a9e59",
    byteSize: 3_203_421,
    filename: "history-excavation-v1.png",
    category: "History",
  },
  {
    id: "geometry-objects",
    url: geometryObjectsUrl,
    label: "Geometry manipulatives",
    description: "Six clearly separated classroom solids with natural shadows and room for editable names or properties.",
    kind: "element",
    sha256: "56ef322ba362820415c9e2e46e22686f6b877329332a577cd60aaa6f47ed749f",
    byteSize: 2_353_294,
    filename: "geometry-objects-v1.png",
    category: "Mathematics",
  },
]);

export async function verifyBundledAssetBytes(asset: BundledAsset, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== asset.byteSize) {
    throw new Error(`${asset.label} did not match its pinned byte size.`);
  }
  const owned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(owned).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", owned);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== asset.sha256) {
    throw new Error(`${asset.label} failed its bundled SHA-256 check.`);
  }
}

export async function importBundledAsset(
  asset: BundledAsset,
  identity: NativeBundledAssetIdentity,
  dependencies: BundledAssetImportDependencies = {},
): Promise<BundledAssetImportResult> {
  const fetchAsset = dependencies.fetchAsset ?? globalThis.fetch;
  const importAsset = dependencies.importAsset ?? projectAssetImport;
  const response = await fetchAsset(asset.url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${asset.label} could not be read from the offline library.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyBundledAssetBytes(asset, bytes);
  const receipt = await importAsset({
    ...identity,
    kind: asset.kind === "background" ? "backgroundImage" : "editorImage",
    filename: asset.filename,
    mimeType: "image/png",
    privacy: "public",
    rights: {
      status: "owned",
      creator: "AI Video Tutorial Generator built-in image library",
      license: "Included generated asset · project use and export allowed",
      attribution: `Built into AI Video Tutorial Generator · generated and visually reviewed 2026-09-05 · ${asset.sha256}`,
      commercialUse: "allowed",
      redistribution: "allowed",
      modelInput: "allowed",
    },
    contentBase64: bytesToBase64(bytes),
  });
  if (receipt.artifact.sha256.toLowerCase() !== asset.sha256) {
    throw new Error(`${asset.label} was imported with an unexpected content hash.`);
  }
  return {
    asset,
    receipt,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}
