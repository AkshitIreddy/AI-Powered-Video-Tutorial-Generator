import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";
import { localModelSetupSave, providerSecretSet } from "../native";
import type { AppSnapshot } from "../types";

describe("Alystria desktop shell", () => {
  it("opens a project and switches between its five workspaces", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /continue working/i }));
    const projectNav = within(screen.getByRole("navigation", { name: /project workspace/i }));
    expect(screen.getByRole("heading", { name: /shape the learning journey/i })).toBeInTheDocument();
    await user.click(projectNav.getByRole("button", { name: /storyboard/i }));
    expect(screen.getByRole("heading", { name: /see the teaching sequence/i })).toBeInTheDocument();
    await user.click(projectNav.getByRole("button", { name: /review/i }));
    expect(screen.getByRole("heading", { name: /review the whole argument/i })).toBeInTheDocument();
    await user.click(projectNav.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("heading", { name: /package the finished lesson/i })).toBeInTheDocument();
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
    const creationJob = persisted.jobs.find((job) => job.projectId === created?.nativeProjectId);
    expect(creationJob?.projectDirectory).toBe(created?.nativeProjectDirectory);
  });

  it("keeps accepted scenes safe when scoped regeneration starts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /continue working/i }));
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
    await user.click(screen.getByRole("button", { name: /save setup & active profile/i }));
    expect(await screen.findByText(/setup saved locally/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Local presenter test" })).toHaveAttribute("aria-selected", "true");
  });

  it("persists a project visual bible with real typography, caption, and presenter choices", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /continue working/i }));
    const projectNav = within(screen.getByRole("navigation", { name: /project workspace/i }));
    await user.click(projectNav.getByRole("button", { name: /studio/i }));
    await user.click(screen.getByRole("button", { name: "Design" }));

    await user.click(screen.getByRole("button", { name: /technical notebook/i }));
    await user.click(screen.getByRole("button", { name: /academic evidence paper/i }));
    await user.click(screen.getByRole("tab", { name: /captions/i }));
    await user.click(screen.getByRole("button", { name: /top/i }));
    await user.selectOptions(screen.getByLabelText(/maximum lines/i), "1");
    await user.click(screen.getByRole("tab", { name: /media/i }));
    await user.click(screen.getByRole("button", { name: /^licensed$/i }));
    expect(screen.getByLabelText(/^commercial use$/i)).toHaveValue("unknown");
    expect(screen.getByLabelText(/redistribution in exported video/i)).toHaveValue("unknown");
    expect(screen.getByLabelText(/ai \/ model input/i)).toHaveValue("unknown");
    await user.click(screen.getByRole("button", { name: /real person/i }));
    expect(screen.getByLabelText(/authorized distribution/i)).toHaveValue("privatePreview");
    await user.click(screen.getByRole("button", { name: /amara · academic/i }));
    await user.selectOptions(screen.getByLabelText(/presenter layout/i), "split");

    expect(screen.getByTestId("presenter-preview")).toBeInTheDocument();
    expect(screen.getByTestId("caption-preview")).toHaveClass("position-top");
    const persisted = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}") as AppSnapshot;
    const customization = persisted.projects.find((project) => project.id === "karatsuba")?.customization;
    expect(customization?.fontPairId).toBe("technical");
    expect(customization?.backgroundAssetId).toBe("background.academic-evidence-paper-v1");
    expect(customization?.captions.position).toBe("top");
    expect(customization?.captions.maxLines).toBe(1);
    expect(customization?.presenter.assetId).toBe("presenter-portrait.academic-amara-v1");
    expect(customization?.presenter.placement).toBe("split");
    expect(customization?.assets.find((asset) => asset.id === "presenter-portrait.academic-amara-v1")?.rightsStatus).toBe("cleared");
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
