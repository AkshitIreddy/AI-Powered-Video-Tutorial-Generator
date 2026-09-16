import type { ProjectBundle, Scene, VisualContent } from "../src/index.js";

export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const NOW = "2026-08-28T00:00:00.000Z";

export function visualFor(kind: VisualContent["kind"]): VisualContent {
  switch (kind) {
    case "title": case "section-intro": case "definition": case "bullets": case "quote": case "question": case "recap": case "summary": case "outro":
      return { kind, heading: "Karatsuba multiplication", blocks: ["Split each number into high and low halves."] };
    case "comparison": case "image-comparison":
      return { kind, heading: "Three products instead of four", columns: [{ id: "column.left", label: "Grade school", points: ["Four products"] }, { id: "column.right", label: "Karatsuba", points: ["Three products"] }] };
    case "diagram":
      return { kind, nodes: [{ id: "node.input", label: "Input", shape: "rounded" }], edges: [], layout: "layered" };
    case "timeline":
      return { kind, orientation: "horizontal", events: [{ id: "event.start", label: "Split", dateLabel: "Step 1" }] };
    case "formula": case "derivation": case "graph":
      return { kind, expressions: [{ id: "expression.one", latex: "z_1=(a+b)(c+d)-z_2-z_0", verified: true }] };
    case "whiteboard":
      return { kind, boardStyle: "whiteboard", strokeTimeline: [], finalBoardDescription: "A worked multiplication example." };
    case "code": case "live-code": case "code-walkthrough": case "diff": case "file-tree": case "terminal": case "execution-trace": case "variable-state":
      return { kind, language: "python", content: "def karatsuba(x, y): return x * y", executionAllowed: false };
    case "chart": case "table": case "map":
      return { kind, title: "Complexity", data: [{ n: 2, operations: 3 }], encoding: { x: "n", y: "operations" } };
    case "image-focus": case "highlighted-document": case "ui-demonstration": case "screen-recording":
      return { kind, assetIds: ["artifact.image"], fit: "contain" };
    case "simulation":
      return { kind, simulationId: "simulation.karatsuba", parameters: { digits: 4 }, capturePolicy: "deterministic-frames", seed: 42 };
    case "presenter": case "presenter-with-slide":
      return { kind, presenter: { mode: "avatar", profileId: "presenter.ava", speakerId: "speaker.ava", voiceId: "voice.ava", usage: "hook", direction: "Warm and concise", disclosure: "visible-and-credits" }, layout: "picture-in-picture" };
    case "worked-example": case "quiz":
      return { kind, prompt: "Compute 1234 × 5678", steps: ["Split", "Compute three products", "Recombine"], answer: "7006652" };
    case "sources":
      return { kind, sourceVersionIds: ["source.version"], style: "bibliography" };
  }
}

export function sceneFor(kind: VisualContent["kind"] = "title"): Scene {
  return {
    id: `scene.${kind}`, sectionId: "section.main", title: "Karatsuba", objectiveIds: ["objective.main"], prerequisiteIds: [], visual: visualFor(kind),
    layouts: [{ target: "landscape", strategy: "reflow" }],
    choreography: [{ id: "cue.heading", targetId: "heading.main", action: "enter", startTick: 0, durationTicks: 24_000, easing: "ease-out", reducedMotionAction: "crossfade" }],
    narration: { text: "Karatsuba reduces four half-size multiplications to three.", locale: "en-US", speakerId: "speaker.main", delivery: { pace: 1, pitchSemitones: 0, energy: 0.7, style: "instructional" }, spans: [] },
    claimIds: ["claim.main"], citationSupportIds: ["support.main"], captions: [{ id: "captions.main", locale: "en-US", kind: "standard", cues: [{ id: "cue.caption", startTick: 0, endTick: 240_000, text: "Karatsuba uses three products.", speakerId: "speaker.main", position: "bottom", kind: "dialogue" }], burnIn: true }],
    audio: { sampleRate: 48000, channels: 2, targetLufs: -16, maxTruePeakDbtp: -1.5, musicEnabled: false, effectsEnabled: false },
    timing: { mode: "narration-led", minimumTicks: 240_000, maximumTicks: 2_400_000, preferredTicks: 1_200_000, overflow: "split" },
    accessibility: { description: "A title introduces the Karatsuba multiplication algorithm.", essentialVisuals: ["The three-products comparison"], readingOrder: ["heading.main"], reducedMotionAlternative: "crossfade", colorIndependent: true },
    artifactIds: ["artifact.image"], locks: [], revisionId: "revision.one",
  };
}

export function validProjectBundle(): ProjectBundle {
  const scene = sceneFor();
  return {
    manifest: { format: "alystria-project", schemaVersion: "2.0.0", projectId: "project.karatsuba", databasePath: "project.sqlite3", objectsPath: "objects/sha256", sourcesPath: "sources/original", stagingPath: "staging", exportsPath: "exports", createdAt: NOW, minimumAppVersion: "2.0.0" },
    project: { id: "project.karatsuba", schemaVersion: "2.0.0", name: "Karatsuba", status: "active", createdAt: NOW, updatedAt: NOW, headRevisionId: "revision.one", courseIds: ["course.main"], settings: { groundingMode: "strict", quality: "standard", executionMode: "local", captionsEnabled: true, musicEnabled: false, presenterMode: "auto", repairLimit: 2, privacyClassification: "private", crossProviderCritique: false, modelProfileSnapshot: { schemaVersion: 1, profileId: "profile.local-presenter", profileName: "Local presenter", capturedAt: NOW, routes: [{ medium: "lipSync", capability: "lipsync.generate", providerId: "local-runtime", modelId: "local/musetalk-1.5", modelRevision: "musetalk-hf-3ef28bc5+code-0a89dec4", installFingerprint: HASH_B, presenterProfileId: "presenter.ava", boundary: "local", retention: "local_only", regions: ["local"], fallbackConsent: false }] } }, defaultThemeId: "theme.precision" },
    courses: [{ id: "course.main", projectId: "project.karatsuba", title: "Fast Multiplication", description: "An introduction to divide-and-conquer multiplication.", locale: "en-US", moduleIds: ["module.main"], learnerProfileId: "learner.main" }],
    modules: [{ id: "module.main", courseId: "course.main", title: "Karatsuba", position: 0, lessonIds: ["lesson.main"] }],
    lessons: [{ id: "lesson.main", moduleId: "module.main", title: "Three multiplications", position: 0, locale: "en-US", sectionIds: ["section.main"], objectiveIds: ["objective.main"], estimatedDurationSeconds: 720 }],
    sections: [{ id: "section.main", lessonId: "lesson.main", title: "The key identity", position: 0, objectiveIds: ["objective.main"], sceneIds: [scene.id] }],
    revisions: [{ id: "revision.one", projectId: "project.karatsuba", parentRevisionIds: [], number: 1, kind: "manual", message: "Initial project", author: "user", createdAt: NOW, rootHash: HASH_A, changes: [], approvalStatus: "approved" }],
    research: {
      learnerProfile: { id: "learner.main", audience: "Undergraduate computer science students", knowledgeLevel: "intermediate", locale: "en-US", goals: ["Understand the recurrence"], accessibilityNeeds: ["captions"] },
      learningPlan: { id: "plan.main", learnerProfileId: "learner.main", groundingMode: "strict", objectives: [{ id: "objective.main", statement: "Derive the three-product identity", taxonomyLevel: "analyze", assessmentCriteria: ["Correctly expand the identity"] }], concepts: [{ id: "concept.identity", label: "Three-product identity", kind: "concept", objectiveIds: ["objective.main"], prerequisiteIds: [] }], misconceptions: ["Karatsuba is only useful for decimal numbers"], estimatedDurationSeconds: 720, createdAt: NOW },
      sources: [{ id: "source.version", sourceId: "source.main", locator: { kind: "doi", value: "10.1007/978-3-642-22849-3_5", canonicalUri: "https://doi.org/10.1007/978-3-642-22849-3_5" }, title: "Karatsuba multiplication", authors: ["Example Author"], retrievedAt: NOW, contentHash: HASH_A, mimeType: "text/html", language: "en-US", trust: "peer-reviewed", storagePolicy: "link-only", rightsStatus: "link-only" }],
      evidence: [{ id: "evidence.main", sourceVersionId: "source.version", text: "The method uses three recursive multiplications.", locator: { method: "text-offset", startOffset: 0, endOffset: 48 }, contentHash: HASH_B, createdAt: NOW }],
      claims: [{ id: "claim.main", statement: "Karatsuba uses three recursive half-size multiplications.", claimType: "procedural", verifiability: "externally-verifiable", supportStatus: "supported", importance: "critical", supportIds: ["support.main"] }],
      supports: [{ id: "support.main", claimId: "claim.main", evidenceChunkId: "evidence.main", relationship: "entails", assessment: 0.98, rationale: "The source states the operation count directly.", assessedBy: "human", assessedAt: NOW }],
    },
    storyboards: [{ id: "storyboard.one", projectId: "project.karatsuba", revisionId: "revision.one", visualBible: { id: "bible.main", themeId: "theme.precision", direction: "Clear geometric explanations on paper-like surfaces.", compositionRules: ["One dominant idea per frame"], imageRules: ["Use deterministic diagrams first"], motionRules: ["Motion communicates causality"], doNotUse: ["Decorative stock imagery"], seed: 42 }, theme: { id: "theme.precision", name: "Precision Studio", version: "2.0.0", colors: [{ name: "color.paper", value: "#F7F8FC", role: "background" }, { name: "color.ink", value: "#151827", role: "text" }, { name: "color.indigo", value: "#5658E8", role: "primary" }, { name: "color.teal", value: "#168F88", role: "secondary" }, { name: "color.amber", value: "#DF922E", role: "warning" }], typography: [{ name: "type.display", family: "Bricolage Grotesque", weight: 700, sizePx: 64, lineHeight: 1.05 }, { name: "type.body", family: "Atkinson Hyperlegible Next", weight: 400, sizePx: 32, lineHeight: 1.4 }, { name: "type.code", family: "JetBrains Mono", weight: 500, sizePx: 28, lineHeight: 1.3 }], spacingScale: [0, 8, 16, 32, 64], cornerStyle: "subtle", motionStyle: "precise" }, scenes: [scene], createdAt: NOW, status: "approved" }], renderManifests: [],
    artifacts: [{ id: "artifact.image", kind: "image", contentHash: HASH_A, sizeBytes: 128, mimeType: "image/svg+xml", storage: { algorithm: "sha256", relativePath: `objects/sha256/${HASH_A}` }, createdAt: NOW, state: "promoted", provenanceId: "provenance.image" }],
    provenance: [{ id: "provenance.image", assetId: "artifact.image", origin: "generated", contentHash: HASH_A, providerId: "provider.mock", modelId: "model.mock", modelRevision: "1", createdAt: NOW, rights: { status: "cleared", usage: ["preview", "edit", "render", "commercial", "redistribution"], territories: ["worldwide"], attributionRequired: false }, c2paStatus: "absent" }],
    consents: [],
    providers: [{ id: "provider.mock", name: "Deterministic Mock", adapterVersion: "2.0.0", status: "available", capabilities: [{ kind: "image", models: ["model.mock"], locality: "local", dataClasses: ["public"], retention: "none", regions: ["local"], supportsCancellation: true }], credentialMode: "none", lastVerifiedAt: NOW }],
    models: [{ id: "model.mock", providerId: "provider.mock", name: "Fixture Image Generator", revision: "1", capability: "image", status: "available", locality: "local", contentHash: HASH_B, sizeBytes: 0, licenseExpression: "MIT", licenseStatus: "approved", lastVerifiedAt: NOW }],
    pricing: [{ id: "price.mock", providerId: "provider.mock", modelId: "model.mock", meter: "image", unitSize: 1, price: { currency: "USD", micros: 0 }, effectiveAt: NOW, lastVerifiedAt: NOW }], usage: [], generationRuns: [], jobs: [], tasks: [], attempts: [], events: [], qualityGates: [], exports: [], plugins: [],
  };
}
