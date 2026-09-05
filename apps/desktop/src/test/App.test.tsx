import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { canonicalFixtureIdFromTopic, hydrateDurableProject, isDurableNativeJob, normalizeAppSnapshot, projectTitleFromTopic } from "../project-utils";
import { defaultSnapshot, exampleSnapshot } from "../data";
import { createOnboardingState } from "../onboarding";
import { localModelSetupSave, providerSecretSet, type TutorialRoutingPolicy } from "../native";
import type { AppSnapshot } from "../types";

describe("Alystria desktop shell", () => {
  beforeEach(() => {
    localStorage.setItem("alystria-studio-v2", JSON.stringify(exampleSnapshot));
    const onboarding = createOnboardingState({
      runtimeConfigured: true,
      privacyConfigured: true,
      hardwareInspected: true,
      existingProfile: { displayName: "Test Creator" },
    });
    onboarding.status = "completed";
    onboarding.configuration.goals = ["tutorial"];
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    localStorage.removeItem("alystria-provider-account-ids-v1");
  });

  it("starts a new user without unrequested projects or jobs", () => {
    expect(defaultSnapshot.projects).toEqual([]);
    expect(defaultSnapshot.jobs).toEqual([]);
    expect(defaultSnapshot.recentProjectId).toBeNull();
    expect(defaultSnapshot.version).toBe(0);
  });

  it("opens interactive onboarding on a truly clean first launch without seeding work", () => {
    localStorage.clear();
    render(<App />);

    expect(screen.getByRole("dialog", { name: /make ai video tutorial generator yours/i })).toBeInTheDocument();
    expect(screen.queryByText("Narration alignment")).not.toBeInTheDocument();
    expect(screen.queryByText("Karatsuba, visually")).not.toBeInTheDocument();
    expect(screen.getByText(/your workbench is ready/i)).toBeInTheDocument();
  });

  it("removes the exact legacy demo workspace from existing profiles", () => {
    const legacy = structuredClone(exampleSnapshot);
    const project = legacy.projects[0]!;
    legacy.projects = [
      project,
      { ...project, id: "binary-search", title: "Binary search without guessing" },
      { ...project, id: "french-revolution", title: "A revolution in six turning points" },
    ];
    legacy.recentProjectId = "karatsuba";
    legacy.version = 12;
    legacy.jobs = [
      { id: "job-1", title: "Narration alignment", detail: "Demo", status: "running", progress: 68 },
      { id: "job-2", title: "Citation support check", detail: "Demo", status: "queued", progress: 0 },
      { id: "job-3", title: "Storyboard snapshot", detail: "Demo", status: "complete", progress: 100 },
    ];

    expect(normalizeAppSnapshot(legacy)).toMatchObject({
      projects: [], recentProjectId: null, jobs: [], version: 0,
    });

    legacy.projects[0] = { ...legacy.projects[0]!, nativeProjectId: "real-project" };
    expect(normalizeAppSnapshot(legacy).projects).toHaveLength(3);
  });

  it("opens legacy generation-stage snapshots without discarding the project document", () => {
    const project = structuredClone(exampleSnapshot.projects[0]!);
    const hydrated = hydrateDurableProject(project, {
      projectId: "native-project",
      generationId: "generation-1",
      stage: "approval",
      payload: { approval: { approved: false } },
    }, {
      nativeProjectId: "native-project",
      nativeProjectDirectory: "C:/Alystria/native-project",
      nativeHeadRevisionId: "rev-stage",
      nativeRevisionNumber: 7,
    });

    expect(hydrated.title).toBe(project.title);
    expect(hydrated.scenes).toEqual(project.scenes);
    expect(hydrated.sources).toEqual(project.sources);
    expect(hydrated.nativeHeadRevisionId).toBe("rev-stage");
  });

  it("shows authored generation content and unreviewed source records instead of the scaffold", () => {
    const project = structuredClone(exampleSnapshot.projects[0]!);
    const hydrated = hydrateDurableProject(project, {
      projectId: "native-project", stage: "approval",
      payload: {
        storyboard: { scenes: [{ id: "new-scene", type: "whiteboard", title: "Understand binary search", narration: "Compare the middle value.", visualIntent: "Discard the half that cannot contain the target.", durationTicks: 7_200_000, claimIds: ["claim-1"], onScreenText: ["Keep the possible range"] }] },
        sources: [{ id: "source-1", title: "Search notes", locator: "Local notes", licenseId: "CC-BY-4.0" }],
      },
    }, { nativeProjectId: "native-project", nativeProjectDirectory: "C:/native-project", nativeHeadRevisionId: "revision-2", nativeRevisionNumber: 2 });
    expect(hydrated.scenes).toHaveLength(1);
    expect(hydrated.scenes[0]).toMatchObject({ title: "Understand binary search", duration: 30, kind: "whiteboard", narration: "Compare the middle value.", status: "draft", citations: 1, authored: { onScreenText: ["Keep the possible range"] } });
    expect(hydrated.sources).toEqual([expect.objectContaining({ title: "Search notes", license: "CC-BY-4.0", status: "review", evidence: 0 })]);
  });

  it("repairs portable profile references and recovers a durable generation identity", () => {
    const snapshot = structuredClone(exampleSnapshot);
    snapshot.projects[0] = {
      ...snapshot.projects[0]!,
      id: "current-project",
      nativeProjectId: "current-native-project",
      nativeProjectDirectory: "C:/current-project",
      generationId: "bf4ffa96-2a10-4aa2-80f1-96cf3a1c2478",
    } as typeof snapshot.projects[number];
    snapshot.recentProjectId = "removed-native-project";
    snapshot.jobs = [
      { id: "bf4ffa96-2a10-4aa2-80f1-96cf3a1c2478", title: "Generation", detail: "Recover me", status: "attention", progress: 50 },
      { id: "orphan", title: "Old preview", detail: "Missing", status: "attention", progress: 0, projectId: "removed-native-project", projectDirectory: "C:/removed" },
      { id: "local", title: "Local work", detail: "Kept", status: "queued", progress: 0 },
    ];

    const normalized = normalizeAppSnapshot(snapshot);

    expect(normalized.recentProjectId).toBe("current-project");
    expect(normalized.projects[0]?.nativeGenerationId).toBe("bf4ffa96-2a10-4aa2-80f1-96cf3a1c2478");
    expect(normalized.jobs[0]).toMatchObject({ projectId: "current-native-project", projectDirectory: "C:/current-project" });
    expect(normalized.jobs.map((job) => job.id)).toEqual(["bf4ffa96-2a10-4aa2-80f1-96cf3a1c2478", "orphan", "local"]);
  });

  it("does not poll generated transport-error receipts as durable jobs", () => {
    const project = { projectId: "native-project", projectDirectory: "C:/Alystria/native-project" };
    const failed = { id: "generated-error", title: "Scene preview", detail: "Unavailable", status: "attention" as const, progress: 0, result: { durable: false }, ...project };
    const durable = { id: "durable-job", title: "Generation", detail: "Running", status: "running" as const, progress: 20, result: { durable: true }, ...project };

    expect(isDurableNativeJob(failed)).toBe(false);
    expect(isDurableNativeJob(durable)).toBe(true);
  });

  it("keeps the full teaching brief separate from a native-safe project title", () => {
    const brief = "Create the canonical 12-minute Karatsuba multiplication tutorial: derive the three-multiplication method rigorously, work through 1234 × 5678, compare O(n^log2 3) with grade-school O(n²), and include retrieval practice plus a recap.";
    expect(projectTitleFromTopic(brief)).toBe("Create the canonical 12-minute Karatsuba multiplication tutorial");
    expect(projectTitleFromTopic("A".repeat(240))).toHaveLength(158);
    expect(canonicalFixtureIdFromTopic(brief)).toBe("fixture.karatsuba.undergraduate.en");
    expect(canonicalFixtureIdFromTopic("Explain why Karatsuba uses three products")).toBeUndefined();
    expect(canonicalFixtureIdFromTopic("Create a canonical binary-search tutorial")).toBeUndefined();
  });

  it("opens a project and switches between its five workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    const projectNav = within(screen.getByRole("navigation", { name: /project workspace/i }));
    expect(screen.getByRole("heading", { name: /shape the learning journey/i })).toBeInTheDocument();
    await user.click(projectNav.getByRole("button", { name: /storyboard/i }));
    expect(screen.getByRole("heading", { name: /see the teaching sequence/i })).toBeInTheDocument();
    await user.click(projectNav.getByRole("button", { name: /review/i }));
    expect(screen.getByRole("heading", { name: /review the whole argument/i })).toBeInTheDocument();
    await user.click(projectNav.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("heading", { name: /package the finished lesson/i })).toBeInTheDocument();
  });

  it("fails Review closed until an authoritative generated media artifact exists", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    await user.click(within(screen.getByRole("navigation", { name: /project workspace/i })).getByRole("button", { name: /review/i }));

    expect(screen.getByRole("heading", { name: /no authoritative media yet/i })).toBeInTheDocument();
    expect(screen.getByText(/browser ui contract does not create video/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare export/i })).toBeDisabled();
    expect(screen.queryByLabelText(/authoritative generated tutorial media/i)).not.toBeInTheDocument();
  });

  it("plays the latest promoted media receipt instead of static review artwork", async () => {
    const snapshot = structuredClone(exampleSnapshot);
    snapshot.projects[0] = { ...snapshot.projects[0]!, nativeProjectId: "native-review-project", nativeProjectDirectory: "C:/Alystria/native-review-project" };
    snapshot.jobs = [{
      id: "rendered-scene",
      title: "Promoted scene",
      detail: "Native scene render",
      status: "complete",
      progress: 100,
      projectId: "native-review-project",
      projectDirectory: "C:/Alystria/native-review-project",
      operation: "render_scene",
      result: { receiptState: "SUCCEEDED", path: "data:video/mp4;base64,AAAA", mediaType: "video/mp4" },
    }];
    localStorage.setItem("alystria-studio-v2", JSON.stringify(snapshot));

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    await user.click(within(screen.getByRole("navigation", { name: /project workspace/i })).getByRole("button", { name: /review/i }));

    const media = screen.getByLabelText(/authoritative generated tutorial media/i);
    expect(media).toHaveAttribute("src", "data:video/mp4;base64,AAAA");
    expect(screen.getByText(/promoted scene render/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare export/i })).toBeEnabled();
  });

  it("defaults to a clean master with YouTube-ready caption sidecars", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    const projectNav = within(screen.getByRole("navigation", { name: /project workspace/i }));
    await user.click(projectNav.getByRole("button", { name: /export/i }));

    const sidecarOption = screen.getByRole("radio", { name: /sidecar files/i });
    expect(sidecarOption).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/clean picture · no caption pixels/i)).toBeInTheDocument();
    expect(screen.getByText(/utf-8 youtube srt \+ webvtt/i)).toBeInTheDocument();
    expect(screen.getByText(/\.en-us\.srt/i)).toBeInTheDocument();
    expect(screen.getByText(/appearance stays with the viewer/i)).toBeInTheDocument();

    await user.click(sidecarOption);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /soft captions selectable track/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/clean picture · no caption pixels/i)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /always visible open captions/i }));
    expect(screen.getByRole("radio", { name: /always visible open captions/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/open captions in picture/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be hidden after export/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit open-caption style/i })).toBeInTheDocument();
  });

  it("binds frame rate and codec intent to the submitted UI-contract export", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    await user.click(within(screen.getByRole("navigation", { name: /project workspace/i })).getByRole("button", { name: /export/i }));

    await user.selectOptions(screen.getByLabelText("Frame rate"), "24");
    await user.selectOptions(screen.getByLabelText("Codec preference"), "av1");
    expect(screen.getByLabelText("Frame rate")).toHaveValue("24");
    expect(screen.getByLabelText("Codec preference")).toHaveValue("av1");
    expect(screen.getByText(/frame rate and codec are applied during native export/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /render 1440p master/i }));

    expect((await screen.findAllByText(/ui contract only: 24 fps av1 export simulated/i)).length).toBeGreaterThan(0);
    const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
    expect(persisted.jobs.find((job) => job.operation === "export_master")?.result).toMatchObject({
      requestedFps: 24,
      requestedCodec: "av1",
      codecForwarded: false,
    });
  });

  it("shows retry and cancel actions only for eligible receipt states", async () => {
    const snapshot = structuredClone(exampleSnapshot);
    const link = { projectId: "fault-project", projectDirectory: "C:/Alystria/fault-project" };
    snapshot.jobs = [
      { id: "retryable", title: "Retryable failure", detail: "Retry", status: "attention", progress: 0, retryable: true, result: { receiptState: "FAILED" }, ...link },
      { id: "cancelled", title: "Cancelled work", detail: "Done", status: "attention", progress: 0, retryable: false, result: { receiptState: "CANCELLED" }, ...link },
      { id: "blocked", title: "Approval wait", detail: "Waiting", status: "attention", progress: 0, retryable: true, result: { receiptState: "BLOCKED" }, ...link },
      { id: "running", title: "Active render", detail: "Rendering", status: "running", progress: 42, retryable: false, result: { receiptState: "RUNNING" }, ...link },
    ];
    localStorage.setItem("alystria-studio-v2", JSON.stringify(snapshot));

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^jobs/i }));

    expect(screen.getByRole("button", { name: /retry retryable failure/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel retryable failure/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry cancelled work/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel cancelled work/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry approval wait/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel approval wait/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel active render/i })).toBeInTheDocument();
  });

  it("creates and persists a tutorial with reviewed provider routing", async () => {
    const user = userEvent.setup();
    await configureCloudProfile();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /create a tutorial/i }));
    const prompt = screen.getByPlaceholderText(/explain why karatsuba/i);
    await user.type(prompt, "Teach recursion with a visual call tree");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^strict/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(await screen.findByRole("checkbox", { name: /approve this exact routing policy/i }));
    await user.click(screen.getByRole("button", { name: /create learning plan/i }));
    expect(screen.getAllByText("Teach recursion with a visual call tree").length).toBeGreaterThan(0);
    // Persistence is intentionally asynchronous and the user can sort or
    // retain prior projects. Assert the durable identity, not an incidental
    // array position from the starter fixture.
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
      expect(persisted.projects.some((project) => project.title === "Teach recursion with a visual call tree")).toBe(true);
    });
    const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
    const created = persisted.projects.find((project) => project.title === "Teach recursion with a visual call tree");
    expect(created?.nativeProjectDirectory).toContain("/browser-demo/alystria/projects/");
    expect(created?.nativeProjectId).toBeTruthy();
    expect(created?.providerRoutingPolicy).toMatchObject({ privacyMode: "cloud" });
    const creationJob = persisted.jobs.find((job) => job.projectId === created?.nativeProjectId);
    expect(creationJob?.projectDirectory).toBe(created?.nativeProjectDirectory);
  });

  it("restores a nonsecret Cloudflare Account ID and includes it in the approved project policy", async () => {
    const user = userEvent.setup();
    await configureCloudflareImageProfile();
    localStorage.setItem("alystria-provider-account-ids-v1", JSON.stringify({
      "cloudflare-workers-ai": "0123456789abcdef0123456789abcdef",
    }));

    render(<App />);
    await user.click(screen.getByRole("button", { name: /create a tutorial/i }));
    await user.type(screen.getByPlaceholderText(/explain why karatsuba/i), "Explain a simple workbench circuit");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(await screen.findByLabelText("Cloudflare Account ID")).toHaveValue("0123456789abcdef0123456789abcdef");
    expect(screen.getByText(/nonsecret account setting/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /approve this exact routing policy/i }));
    await user.click(screen.getByRole("button", { name: /create learning plan/i }));

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
      const created = persisted.projects.find((project) => project.title === "Explain a simple workbench circuit");
      const policy = created?.providerRoutingPolicy as TutorialRoutingPolicy | undefined;
      expect(policy?.approvals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          providerId: "cloudflare-workers-ai",
          accountId: "0123456789abcdef0123456789abcdef",
          credentialRef: "browser-demo://alystria/cloudflare-workers-ai/api_key",
        }),
      ]));
    });
  });

  it("accepts an exact user-entered tutorial duration", async () => {
    const user = userEvent.setup();
    await configureCloudProfile();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /create a tutorial/i }));
    await user.type(screen.getByPlaceholderText(/explain why karatsuba/i), "Create the canonical 12-minute Karatsuba multiplication tutorial");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByRole("option", { name: "About 1 minute (quick draft)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "About 3 minutes (inspection draft)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "About 12 minutes" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Target duration"), "custom");
    const exactDuration = screen.getByLabelText("Exact duration in minutes");
    await user.clear(exactDuration);
    await user.type(exactDuration, "3");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^creative/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByText("About 3 minutes")).toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: /approve this exact routing policy/i }));
    await user.click(screen.getByRole("button", { name: /create learning plan/i }));

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
      const created = persisted.projects.find((project) => project.title === "Create the canonical 12-minute Karatsuba multiplication tutorial");
      expect(created?.duration).toBe(3);
      expect(created?.canonicalFixtureId).toBeUndefined();
    });
  });

  it("carries an approved local starter presenter into the initial project snapshot", async () => {
    const user = userEvent.setup();
    await configureStarterPresenterProfile();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /create a tutorial/i }));
    await user.type(screen.getByPlaceholderText(/explain why karatsuba/i), "Teach a visual multiplication proof");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(screen.getByRole("button", { name: /^creative/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await user.click(await screen.findByRole("checkbox", { name: /approve this exact routing policy/i }));
    await user.click(screen.getByRole("button", { name: /create learning plan/i }));

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
      const created = persisted.projects.find((project) => project.title === "Teach a visual multiplication proof");
      expect(created?.customization?.presenter).toMatchObject({
        assetId: "presenter-portrait.mathematics-arjun-v1",
        placement: "picture-in-picture",
      });
    });
  });

  it("keeps accepted scenes safe when scoped regeneration starts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    await user.click(screen.getByRole("button", { name: /storyboard/i }));
    const regenerateButtons = screen.getAllByRole("button", { name: /^regenerate$/i });
    await user.click(regenerateButtons[0]!);
    expect(screen.getByRole("heading", { name: /create a new candidate/i })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/make the transition/i), "Try a stronger opening contrast");
    await user.click(screen.getByRole("button", { name: /generate candidate/i }));
    expect(screen.getByRole("heading", { name: /^jobs$/i })).toBeInTheDocument();
    expect(screen.getByText(/regenerating scene/i)).toBeInTheDocument();
  });

  it("keeps wizard file bytes ephemeral while showing selected source status", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /create a tutorial/i }));
    const input = document.querySelector(".source-drop input[type=file]") as HTMLInputElement;
    const raw = "private source bytes never enter localStorage";
    const file = new File([raw], "private-notes.txt", { type: "text/plain" });
    await user.upload(input, file);

    expect(screen.getByLabelText(/selected source files/i)).toHaveTextContent("private-notes.txt");
    expect(screen.getByText(/1 selected · imported privately before generation/i)).toBeInTheDocument();
    expect(localStorage.getItem("alystria-studio-v2") ?? "").not.toContain(raw);
  });

  it("offers one NVIDIA NIM preview connection without hiding its restrictions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /models & providers/i }));
    expect(screen.getByRole("heading", { name: /nvidia nim \(dev\/test\)/i })).toBeInTheDocument();
    expect(screen.getByText(/one key · public\/synthetic hosted previews/i)).toBeInTheDocument();
    expect(screen.getByText(/no silent fallback/i)).toBeInTheDocument();
  });

  it("keeps local lip-sync choices and switchable provider profiles explicit", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /models & providers/i }));
    expect(await screen.findByRole("heading", { name: /local models, without surprise downloads/i })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /musetalk 1.5/i }));
    expect(screen.getByRole("radio", { name: /musetalk 1.5/i })).toBeChecked();
    expect(await screen.findByText(/download-only pack/i)).toBeInTheDocument();
    expect(screen.getByText(/browser preview never fetches model bytes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start verified download/i })).toBeDisabled();
    expect(screen.getByText(/not installed, active, or ready for inference/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add profile/i }));
    await user.clear(screen.getByLabelText(/^name$/i));
    await user.type(screen.getByLabelText(/^name$/i), "Local presenter test");
    await user.selectOptions(screen.getByLabelText(/narration provider/i), "elevenlabs");
    await user.clear(screen.getByLabelText(/narration model/i));
    await user.type(screen.getByLabelText(/narration model/i), "eleven_multilingual_v2");
    await user.clear(screen.getByLabelText(/narration voice id/i));
    await user.type(screen.getByLabelText(/narration voice id/i), "21m00Tcm4TlvDq8ikWAM");
    await user.selectOptions(screen.getByLabelText(/lip-sync provider/i), "local-runtime");
    await user.clear(screen.getByLabelText(/^lip-sync model$/i));
    await user.type(screen.getByLabelText(/^lip-sync model$/i), "local/musetalk-1.5");
    await user.clear(screen.getByLabelText(/lip-sync presenter profile id/i));
    await user.type(screen.getByLabelText(/lip-sync presenter profile id/i), "presenter.arjun");
    await user.clear(screen.getByLabelText(/lip-sync model revision/i));
    await user.type(screen.getByLabelText(/lip-sync model revision/i), "musetalk-1.5-pinned");
    await user.clear(screen.getByLabelText(/lip-sync install fingerprint/i));
    await user.type(screen.getByLabelText(/lip-sync install fingerprint/i), "a".repeat(64));
    await user.click(screen.getByRole("button", { name: /save setup & active profile/i }));
    expect(await screen.findByText(/setup saved locally/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Local presenter test" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/narration voice id/i)).toHaveValue("21m00Tcm4TlvDq8ikWAM");
    expect(screen.getByLabelText(/lip-sync presenter profile id/i)).toHaveValue("presenter.arjun");
    expect(screen.getByLabelText(/lip-sync model revision/i)).toHaveValue("musetalk-1.5-pinned");
    expect(screen.getByLabelText(/lip-sync install fingerprint/i)).toHaveValue("a".repeat(64));
  }, 60_000);

  it("persists a project visual bible with real typography, caption, and presenter choices", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^open project$/i }));
    const projectNav = within(screen.getByRole("navigation", { name: /project workspace/i }));
    await user.click(projectNav.getByRole("button", { name: /studio/i }));
    await user.click(screen.getByRole("button", { name: "Design" }));

    expect(screen.queryByLabelText(/project type scale/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reading rhythm/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/material strength/i)).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /corner radius/i })).toHaveValue("14");
    expect(screen.getByRole("button", { name: /^color$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^image$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /technical notebook/i }));
    await user.click(screen.getByRole("button", { name: /academic evidence paper/i }));
    await user.click(screen.getByRole("tab", { name: /captions/i }));
    expect(screen.getByText(/controls affect only an explicit open-caption export/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /top/i }));
    await user.selectOptions(screen.getByLabelText(/maximum lines/i), "1");
    await user.click(screen.getByRole("tab", { name: /media/i }));
    await user.click(screen.getByRole("button", { name: /^licensed$/i }));
    expect(screen.getByLabelText(/^commercial use$/i)).toHaveValue("unknown");
    expect(screen.getByLabelText(/redistribution in exported video/i)).toHaveValue("unknown");
    expect(screen.getByLabelText(/ai \/ model input/i)).toHaveValue("unknown");
    await user.click(screen.getByRole("button", { name: /real person/i }));
    expect(screen.getByLabelText(/authorized distribution/i)).toHaveValue("privatePreview");
    await user.click(screen.getByRole("button", { name: /elena · news anchor/i }));
    await user.selectOptions(screen.getByLabelText(/presenter layout/i), "split");
    expect(screen.queryByText(/voice matched to the presenter persona/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/presenter scale/i)).not.toBeInTheDocument();

    expect(screen.getByTestId("presenter-preview")).toBeInTheDocument();
    expect(screen.getByTestId("caption-preview")).toHaveClass("position-top");
    expect(screen.getByTestId("caption-preview")).toHaveTextContent(/caption style sample/i);
    const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
    const customization = persisted.projects.find((project) => project.id === "karatsuba")?.customization;
    expect(customization?.fontPairId).toBe("technical");
    expect(customization?.backgroundAssetId).toBe("background.academic-evidence-paper-v1");
    expect(customization?.captions.position).toBe("top");
    expect(customization?.captions.maxLines).toBe(1);
    expect(customization?.presenter.assetId).toBe("presenter-portrait.broadcast-elena-v1");
    expect(customization?.presenter.placement).toBe("split");
    expect(customization?.assets.find((asset) => asset.id === "presenter-portrait.broadcast-elena-v1")?.rightsStatus).toBe("cleared");
  });
});

async function configureCloudProfile() {
  await localModelSetupSave({
    activeProfileId: "test-cloud",
    selectedModelIds: [],
    lipSyncModelId: null,
    existingModelDirectory: null,
    profiles: [{
      id: "test-cloud",
      name: "Test cloud",
      description: "Explicit browser-test routing",
      routes: {
        writing: { providerId: "openai", modelId: "gpt-5.4" },
        research: { providerId: "openai", modelId: "gpt-5.4" },
        images: { providerId: "openai", modelId: "gpt-image-2" },
        voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2" },
        transcription: { providerId: "openai", modelId: "whisper-1" },
        presenter: { providerId: "local-runtime", modelId: "off by default" },
        lipSync: { providerId: "local-runtime", modelId: "off by default" },
      },
    }],
  });
  await providerSecretSet({ providerId: "openai", credentialKind: "api_key", secret: "browser-test-openai" });
  await providerSecretSet({ providerId: "elevenlabs", credentialKind: "api_key", secret: "browser-test-elevenlabs" });
}

async function configureCloudflareImageProfile() {
  await localModelSetupSave({
    activeProfileId: "test-cloudflare",
    selectedModelIds: [],
    lipSyncModelId: null,
    existingModelDirectory: null,
    profiles: [{
      id: "test-cloudflare",
      name: "Cloudflare image test",
      description: "OpenAI writing, Cloudflare images, ElevenLabs voice",
      routes: {
        writing: { providerId: "openai", modelId: "gpt-5.4" },
        research: { providerId: "openai", modelId: "gpt-5.4" },
        images: { providerId: "cloudflare-workers-ai", modelId: "@cf/black-forest-labs/flux-1-schnell" },
        voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2" },
        presenter: { providerId: "local-runtime", modelId: "off by default" },
        lipSync: { providerId: "local-runtime", modelId: "off by default" },
      },
    }],
  });
  await providerSecretSet({ providerId: "openai", credentialKind: "api_key", secret: "browser-test-openai" });
  await providerSecretSet({ providerId: "cloudflare-workers-ai", credentialKind: "api_key", secret: "browser-test-cloudflare" });
  await providerSecretSet({ providerId: "elevenlabs", credentialKind: "api_key", secret: "browser-test-elevenlabs" });
}

async function configureStarterPresenterProfile() {
  const installFingerprint = "b".repeat(64);
  await localModelSetupSave({
    activeProfileId: "starter-presenter",
    selectedModelIds: ["local/musetalk-1.5"],
    lipSyncModelId: "local/musetalk-1.5",
    existingModelDirectory: null,
    profiles: [{
      id: "starter-presenter",
      name: "Starter presenter",
      description: "Cloud media with an exact local presenter runtime",
      routes: {
        writing: { providerId: "openai", modelId: "gpt-5.4" },
        research: { providerId: "openai", modelId: "off — creative mode" },
        images: { providerId: "openai", modelId: "gpt-image-2" },
        voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2" },
        presenter: { providerId: "local-runtime", modelId: "off — local lip-sync route" },
        lipSync: {
          providerId: "local-runtime",
          modelId: "local/musetalk-1.5",
          presenterProfileId: "presenter-portrait.mathematics-arjun-v1",
          modelRevision: "musetalk-1.5-pinned",
          installFingerprint,
        },
      },
    }],
  });
  await providerSecretSet({ providerId: "openai", credentialKind: "api_key", secret: "browser-test-openai" });
  await providerSecretSet({ providerId: "elevenlabs", credentialKind: "api_key", secret: "browser-test-elevenlabs" });
}
