import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import {
  appBootstrap,
  catalogDiscover,
  jobStatus,
  masterExport,
  projectCreate,
  projectCustomizationSave,
  projectExportArchive,
  projectOpen,
  projectHistoryUndo,
  projectSnapshotGet,
  projectSnapshotSave,
  providerSecretSet,
  providerSecretStatus,
  providerRoutingPolicyGet,
  providerRoutingPolicySave,
  qaRepair,
  sceneRegenerate,
  sceneRender,
  sourceImport,
} from "../native";

describe("native desktop bridge", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReturnValue(true);
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("uses the native broker for provider catalog discovery", async () => {
    const input = { source: "hugging-face" as const, query: "flux", limit: 12 };
    tauri.invoke.mockResolvedValueOnce({ source: input.source, items: [], nextCursor: null, retrievedAt: "2026-09-02T00:00:00Z" });

    await catalogDiscover(input);

    expect(tauri.invoke).toHaveBeenCalledWith("catalog_discover", { input });
  });

  it("keeps browser catalog pagination on the selected provider origin", async () => {
    tauri.isTauri.mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await catalogDiscover({ source: "hugging-face", cursor: "https://huggingface.co/api/models?cursor=next", limit: 12 });
    await expect(catalogDiscover({ source: "hugging-face", cursor: "https://example.com/api/models?cursor=stolen", limit: 12 }))
      .rejects.toThrow("unsafe catalog pagination cursor");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("huggingface.co/api/models");
  });

  it("uses the exact Rust input envelope for project creation", async () => {
    const input = {
      parentDirectory: "C:/Users/Akshit/Alystria/Projects",
      directoryName: "karatsuba",
      title: "Karatsuba, visually",
      locale: "en-US",
      groundingMode: "grounded" as const,
    };
    tauri.invoke.mockResolvedValueOnce({ projectDirectory: `${input.parentDirectory}/${input.directoryName}` });

    await projectCreate(input);

    expect(tauri.invoke).toHaveBeenCalledWith("project_create", { input });
  });

  it("invokes argument-free commands without inventing an input payload", async () => {
    tauri.invoke.mockResolvedValueOnce({ appVersion: "2.0.0" });

    await appBootstrap();

    expect(tauri.invoke).toHaveBeenCalledWith("app_bootstrap", undefined);
  });

  it("reopens a persisted native project through the validated Rust command", async () => {
    const input = { projectDirectory: "C:/Users/Akshit/Alystria/Projects/karatsuba", allowReadOnly: true };
    tauri.invoke.mockResolvedValueOnce({ projectDirectory: input.projectDirectory });

    await projectOpen(input);

    expect(tauri.invoke).toHaveBeenCalledWith("project_open", { input });
  });

  it("checks a rehydrated durable job with its persisted project identity", async () => {
    const input = {
      projectId: "019d0000-0000-7000-8000-000000000001",
      projectDirectory: "C:/Users/Akshit/Alystria/Projects/karatsuba",
      jobId: "019d0000-0000-7000-8000-000000000002",
    };
    tauri.invoke.mockResolvedValueOnce({ jobId: input.jobId, state: "RUNNING" });

    await jobStatus(input);

    expect(tauri.invoke).toHaveBeenCalledWith("job_status", { input });
  });

  it("passes a credential to invoke but never persists it in browser storage", async () => {
    const input = { providerId: "openai", credentialKind: "api_key", secret: "not-for-local-storage" };
    tauri.invoke.mockResolvedValueOnce({
      reference: "keyring://alystria/openai/api_key",
      providerId: "openai",
      credentialKind: "api_key",
      availability: "present",
      updatedAt: "2026-08-28T00:00:00Z",
    });

    await providerSecretSet(input);

    expect(tauri.invoke).toHaveBeenCalledWith("provider_secret_set", { input });
    expect(JSON.stringify(localStorage)).not.toContain(input.secret);
  });

  it("keeps browser demo credential values ephemeral", async () => {
    tauri.isTauri.mockReturnValue(false);
    const input = { providerId: "anthropic", credentialKind: "api_key", secret: "discard-me" };

    await providerSecretSet(input);
    const status = await providerSecretStatus({ providerId: input.providerId, credentialKind: input.credentialKind });

    expect(status.availability).toBe("present");
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(localStorage)).not.toContain(input.secret);
  });

  it("stores NVIDIA NIM as one provider keyring reference", async () => {
    const input = {
      providerId: "nvidia-nim",
      credentialKind: "api_key",
      secret: "synthetic-nim-test-value",
    };
    tauri.invoke.mockResolvedValueOnce({
      reference: "keyring://alystria/nvidia-nim/api_key",
      providerId: "nvidia-nim",
      credentialKind: "api_key",
      availability: "present",
      updatedAt: "2026-08-28T00:00:00Z",
    });

    const reference = await providerSecretSet(input);

    expect(tauri.invoke).toHaveBeenCalledWith("provider_secret_set", { input });
    expect(reference.reference).toBe("keyring://alystria/nvidia-nim/api_key");
    expect(JSON.stringify(localStorage)).not.toContain(input.secret);
  });

  it("uses narrow snapshot, source-import, and archive commands", async () => {
    const identity = {
      projectId: "019d0000-0000-7000-8000-000000000011",
      projectDirectory: "C:/Users/Akshit/Alystria/Projects/karatsuba",
    };
    tauri.invoke
      .mockResolvedValueOnce({ projectId: identity.projectId, headRevisionId: "rev_1", snapshot: {} })
      .mockResolvedValueOnce({ projectId: identity.projectId, headRevisionId: "rev_2", snapshot: { title: "Edited" } })
      .mockResolvedValueOnce({ projectId: identity.projectId, headRevisionId: "rev_3", id: "src_1" })
      .mockResolvedValueOnce({ path: `${identity.projectDirectory}/exports/tutorial.alytutorial` });

    await projectSnapshotGet(identity);
    await projectSnapshotSave({ ...identity, expectedHeadRevisionId: "rev_1", snapshot: { title: "Edited" } });
    const source = {
      ...identity,
      expectedHeadRevisionId: "rev_2",
      filename: "notes.md",
      mimeType: "text/markdown",
      privacy: "project_local" as const,
      rightsStatus: "unknown" as const,
      contentBase64: "cHJpdmF0ZSBmaWxl",
    };
    await sourceImport(source);
    await projectExportArchive(identity);

    expect(tauri.invoke).toHaveBeenNthCalledWith(1, "project_snapshot_get", { input: identity });
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "project_snapshot_save", { input: { ...identity, expectedHeadRevisionId: "rev_1", snapshot: { title: "Edited" } } });
    expect(tauri.invoke).toHaveBeenNthCalledWith(3, "source_import", { input: source });
    expect(tauri.invoke).toHaveBeenNthCalledWith(4, "project_export_archive", { input: identity });
    expect(JSON.stringify(localStorage)).not.toContain(source.contentBase64);
  });

  it("uses narrow project routing policy commands without exposing credentials", async () => {
    const identity = {
      projectId: "019d0000-0000-7000-8000-000000000031",
      projectDirectory: "C:/Users/Akshit/Alystria/Projects/routing",
    };
    const policy = {
      version: 1 as const,
      privacyMode: "cloud" as const,
      dataClassification: "project" as const,
      budget: { currency: "USD", hardLimitMicros: 1_000_000, requireKnownPricing: true, approved: true },
      approvals: [],
      routes: [],
    };
    tauri.invoke.mockResolvedValue({ policy, headRevisionId: "rev_2", revisionNumber: 2 });

    await providerRoutingPolicyGet(identity);
    const save = { ...identity, expectedHeadRevisionId: "rev_1", policy, message: "Approved reviewed policy" };
    await providerRoutingPolicySave(save);

    expect(tauri.invoke).toHaveBeenNthCalledWith(1, "provider_routing_policy_get", { input: identity });
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "provider_routing_policy_save", { input: save });
  });

  it("saves visual-bible choices through the narrow customization command", async () => {
    const input = {
      projectId: "019d0000-0000-7000-8000-000000000041",
      projectDirectory: "C:/Users/Akshit/Alystria/Projects/customization",
      expectedHeadRevisionId: "rev_1",
      customization: {
        fontPairId: "editorial" as const,
        displayFont: "Bricolage Grotesque",
        bodyFont: "Atkinson Hyperlegible Next",
        typeScale: 100,
        lineHeight: "balanced" as const,
        fonts: { displayAssetId: null, bodyAssetId: null },
        paletteId: "precision" as const,
        colors: { paper: "#F7F8FC", ink: "#151827", accent: "#5658E8", evidence: "#168F88" },
        backgroundMode: "paper" as const,
        backgroundAssetId: null,
        materialStrength: 28,
        density: "balanced" as const,
        contrast: "standard" as const,
        reducedMotion: false,
        sceneTreatment: "edge-to-edge" as const,
        cornerRadius: 14,
        shadowStrength: 24,
        captions: { position: "auto" as const, style: "soft-panel" as const, size: 100, safeInset: 8, textColor: "#FFFFFF", panelColor: "#151827", maxLines: 2 as const },
        presenter: { assetId: null, placement: "off" as const, side: "right" as const, scale: 72, crop: "portrait" as const, frame: "soft" as const },
        audio: { musicAssetId: null, sfxAssetId: null, musicLevel: 12, sfxLevel: 28, narrationDucking: 72 },
        assets: [],
      },
      message: "Updated visual bible customization",
    };
    tauri.invoke.mockResolvedValueOnce({ projectId: input.projectId, headRevisionId: "rev_2", revisionNumber: 2, customization: input.customization });

    await projectCustomizationSave(input);

    expect(tauri.invoke).toHaveBeenCalledWith("project_customization_save", { input });
  });

  it("persists reviewed routing as a separate browser project revision", async () => {
    tauri.isTauri.mockReturnValue(false);
    const handle = await projectCreate({
      parentDirectory: "/browser-demo/alystria/projects",
      directoryName: "routing-policy",
      title: "Routing policy",
      locale: "en-US",
      groundingMode: "creative",
      initialSnapshot: { title: "Routing policy", scenes: [], sources: [] },
    });
    const identity = { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory };
    const head = await projectSnapshotGet(identity);
    const policy = {
      version: 1 as const,
      privacyMode: "local" as const,
      dataClassification: "project" as const,
      budget: { currency: "USD", hardLimitMicros: 0, requireKnownPricing: true, approved: true },
      approvals: [],
      routes: [],
    };

    const saved = await providerRoutingPolicySave({ ...identity, expectedHeadRevisionId: head.headRevisionId, policy });
    const reloaded = await providerRoutingPolicyGet(identity);

    expect(saved.revisionNumber).toBe(2);
    expect(reloaded.policy).toEqual(policy);
    expect(reloaded.headRevisionId).toBe(saved.headRevisionId);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("uses narrow native control and durable history commands", async () => {
    const identity = {
      projectId: "019d0000-0000-7000-8000-000000000021",
      projectDirectory: "C:/Users/Akshit/Alystria/Projects/karatsuba",
    };
    tauri.invoke.mockResolvedValue({ jobId: "019d0000-0000-7000-8000-000000000022", state: "QUEUED" });
    const regeneration = { ...identity, baseRevisionId: "rev_2", sceneId: "scene-one", instruction: "Use a stronger contrast.", preservationLocks: ["narration" as const], alternatives: 2 };
    const render = { ...identity, baseRevisionId: "rev_2", sceneId: "scene-one", aspect: "16:9" as const, resolution: "1080p" as const, fps: 30 as const };
    const repair = { ...identity, baseRevisionId: "rev_2", baseJobId: "019d0000-0000-7000-8000-000000000020", findingIds: ["qa.caption_collision"] };
    const master = { ...identity, baseRevisionId: "rev_2", baseJobId: repair.baseJobId, aspect: "16:9" as const, resolution: "1440p" as const, fps: 30 as const, captionDeliveryMode: "sidecar" as const, transcript: true, bibliography: true };

    await projectHistoryUndo({ ...identity, expectedHeadRevisionId: "rev_2" });
    await sceneRegenerate(regeneration);
    await sceneRender(render);
    await qaRepair(repair);
    await masterExport(master);

    expect(tauri.invoke).toHaveBeenNthCalledWith(1, "project_history_undo", { input: { ...identity, expectedHeadRevisionId: "rev_2" } });
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "scene_regenerate", { input: regeneration });
    expect(tauri.invoke).toHaveBeenNthCalledWith(3, "scene_render", { input: render });
    expect(tauri.invoke).toHaveBeenNthCalledWith(4, "qa_repair", { input: repair });
    expect(tauri.invoke).toHaveBeenNthCalledWith(5, "master_export", { input: master });
  });

  it("labels browser control results as demo-only and creates no path", async () => {
    tauri.isTauri.mockReturnValue(false);
    const handle = await projectCreate({
      parentDirectory: "/browser-demo/alystria/projects",
      directoryName: "control-demo",
      title: "Control demo",
      locale: "en-US",
      groundingMode: "grounded",
      initialSnapshot: { title: "Control demo", scenes: [], sources: [] },
    });
    const receipt = await sceneRender({
      projectId: handle.manifest.projectId,
      projectDirectory: handle.projectDirectory,
      baseRevisionId: "rev_browser",
      sceneId: "scene-one",
      aspect: "16:9",
      resolution: "1080p",
      fps: 30,
    });

    expect(receipt.message).toMatch(/browser demo only/i);
    expect(receipt.result).toMatchObject({ demoOnly: true, path: null });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("keeps browser project snapshots and imported source metadata without retaining bytes", async () => {
    tauri.isTauri.mockReturnValue(false);
    const handle = await projectCreate({
      parentDirectory: "/browser-demo/alystria/projects",
      directoryName: "durable-demo",
      title: "Durable demo",
      locale: "en-US",
      groundingMode: "grounded",
      initialSnapshot: { title: "Durable demo", scenes: [], sources: [] },
    });
    const identity = { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory };
    const loaded = await projectSnapshotGet(identity);
    const saved = await projectSnapshotSave({
      ...identity,
      expectedHeadRevisionId: loaded.headRevisionId,
      snapshot: { ...loaded.snapshot, script: "Edited after restart" },
    });
    const raw = "private classroom note";
    const imported = await sourceImport({
      ...identity,
      expectedHeadRevisionId: saved.headRevisionId,
      filename: "classroom.txt",
      mimeType: "text/plain",
      privacy: "project_local",
      rightsStatus: "unknown",
      contentBase64: btoa(raw),
    });
    const reloaded = await projectSnapshotGet(identity);

    expect(reloaded.snapshot.script).toBe("Edited after restart");
    expect((reloaded.snapshot.sources as Array<{ artifactHash: string }>)[0]?.artifactHash).toBe(imported.artifactHash);
    expect(JSON.stringify(reloaded)).not.toContain(raw);
    expect(JSON.stringify(localStorage)).not.toContain(raw);
  });
});
