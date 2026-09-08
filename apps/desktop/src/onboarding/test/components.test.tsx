import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  GuidedTour,
  OnboardingDialog,
  OnboardingReplayButton,
  ProfileGallery,
  createOnboardingState,
  useOnboardingController,
} from "..";
import type { OnboardingCatalog, OnboardingSetupState, PersistedOnboardingState } from "..";

const catalog: OnboardingCatalog = {
  goals: [
    { id: "tutorials", label: "Tutorials", description: "Build structured educational videos." },
    { id: "social", label: "Social clips", description: "Create concise visual explainers." },
  ],
  runtimes: [
    { id: "local", label: "Local", description: "Run supported work on this computer." },
    { id: "hybrid", label: "Hybrid", description: "Choose local or cloud per route.", recommended: true },
    { id: "cloud", label: "Cloud", description: "Prefer connected providers." },
  ],
  providers: [{ id: "nvidia", name: "NVIDIA", description: "Cloud and local acceleration.", connected: true }],
  models: [{ id: "narrator", name: "Studio Narrator", providerId: "nvidia", medium: "speech", installed: true }],
  portraits: [
    { id: "portrait-a", src: "/portrait-a.png", alt: "Illustrated portrait with blue background", label: "Blue studio", style: "Illustrated" },
    { id: "portrait-b", src: "/portrait-b.png", alt: "Photographic portrait with warm background", label: "Warm studio", style: "Photographic" },
  ],
};

function OnboardingHarness({
  persistedState,
  setupState,
  onboardingCatalog = catalog,
  onPersist = vi.fn(),
  onExit = vi.fn(),
  onComplete = vi.fn(),
}: {
  persistedState?: PersistedOnboardingState;
  setupState?: OnboardingSetupState;
  onboardingCatalog?: OnboardingCatalog;
  onPersist?: (state: PersistedOnboardingState) => void | Promise<void>;
  onExit?: (state: PersistedOnboardingState) => void;
  onComplete?: (state: PersistedOnboardingState) => void;
}) {
  const controller = useOnboardingController({ persistedState, setupState, onPersist, onExit, onComplete });
  return (
    <>
      <OnboardingReplayButton controller={controller} />
      <OnboardingDialog controller={controller} setupState={setupState} catalog={onboardingCatalog} />
    </>
  );
}

function ProfileHarness({
  onChange,
  onAcceptAsset,
}: {
  onChange: ReturnType<typeof vi.fn>;
  onAcceptAsset: ReturnType<typeof vi.fn>;
}) {
  const [profile, setProfile] = useState({ displayName: "", portraitAssetId: null as string | null });
  return (
    <ProfileGallery
      assets={catalog.portraits}
      profile={profile}
      onChange={(next) => {
        setProfile(next);
        onChange(next);
      }}
      onAcceptAsset={onAcceptAsset}
    />
  );
}

describe("OnboardingDialog", () => {
  it("keeps saved model choices separate from installed models and download estimates", async () => {
    const user = userEvent.setup();
    render(<OnboardingHarness setupState={{ connectedProviderIds: ["nvidia"], selectedModelIds: ["chosen", "unknown", "installed"] }} onboardingCatalog={{
      ...catalog,
      models: [
        { id: "chosen", name: "Chosen model", providerId: "local", medium: "speech", downloadBytes: 1024 ** 3 },
        { id: "unknown", name: "Unpriced model", providerId: "local", medium: "speech" },
        { id: "installed", name: "Available model", providerId: "local", medium: "speech", installed: true, downloadBytes: 3 * 1024 ** 3 },
      ],
    }} />);
    expect(screen.getByText(/3 model selections/)).toBeVisible();
    expect(screen.queryByText(/3 models attached/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Chapter 6 Review your model toolkit/i }));
    expect(screen.getByRole("checkbox", { name: /Chosen model/ })).toBeChecked();
    expect(screen.getByText("1.0 GB selected download")).toBeVisible();
    expect(screen.getByText(/1 selected download size is not published/)).toBeVisible();
    expect(screen.getAllByText("Selected · install not verified")).toHaveLength(2);
    expect(screen.getByText("Installed", { exact: true })).toBeVisible();
    expect(screen.queryByText("No additional download required")).not.toBeInTheDocument();
  });

  it("exits a completed setup replay without reapplying setup or reopening on remount", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onPersist = vi.fn();
    const state = { ...createOnboardingState(), status: "completed" as const };
    const view = render(<OnboardingHarness persistedState={state} onPersist={onPersist} onComplete={onComplete} />);
    await user.click(screen.getByRole("button", { name: "Replay onboarding" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox", { name: /Tutorials/ }));
    await user.click(screen.getByRole("button", { name: "Exit onboarding" }));
    await waitFor(() => expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "completed" })));
    expect(onComplete).not.toHaveBeenCalled();
    const saved = onPersist.mock.lastCall?.[0] as PersistedOnboardingState;
    expect(saved.configuration.goals).toEqual(["tutorials"]);
    view.unmount();
    render(<OnboardingHarness persistedState={saved} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses modal semantics, focuses each chapter heading, and gates required chapters", async () => {
    const user = userEvent.setup();
    render(<OnboardingHarness />);

    expect(screen.getByRole("dialog", { name: "Make AI Video Tutorial Generator yours" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Make AI Video Tutorial Generator yours" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "What will you create?" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Tutorials/ }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(screen.getByRole("heading", { name: "Choose where work runs" })).toHaveFocus();
  });

  it("exits with Escape and can replay without replacing configured values", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const state = createOnboardingState({}, () => "2026-09-02T08:00:00.000Z");
    state.configuration.goals = ["tutorials"];
    state.configuration.profile = { displayName: "Akshit", portraitAssetId: "portrait-b" };
    render(<OnboardingHarness persistedState={state} onExit={onExit} />);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ configuration: expect.objectContaining({ goals: ["tutorials"] }) }));

    await user.click(screen.getByRole("button", { name: "Replay onboarding" }));
    expect(screen.getByRole("dialog", { name: "Make AI Video Tutorial Generator yours" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Chapter 1 What will you create/ }));
    expect(screen.getByRole("checkbox", { name: /Tutorials/ })).toBeChecked();
  });

  it("restores completed status when replay is exited but keeps an initial setup resumable", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn();
    const onExit = vi.fn();
    const completed = createOnboardingState({}, () => "2026-09-02T08:00:00.000Z");
    completed.status = "completed";
    completed.activeChapterId = "ready";
    const replay = render(<OnboardingHarness persistedState={completed} onPersist={onPersist} onExit={onExit} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replay onboarding" }));
    expect(screen.getByRole("dialog", { name: "Make AI Video Tutorial Generator yours" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit onboarding" }));

    expect(onExit).toHaveBeenLastCalledWith(expect.objectContaining({ status: "completed" }));
    await waitFor(() => expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "completed" })));
    replay.unmount();

    onExit.mockClear();
    const inProgress = createOnboardingState({}, () => "2026-09-02T08:00:00.000Z");
    inProgress.status = "in-progress";
    inProgress.activeChapterId = "privacy";
    render(<OnboardingHarness persistedState={inProgress} onExit={onExit} />);
    await user.click(screen.getByRole("button", { name: "Exit onboarding" }));
    expect(onExit).toHaveBeenLastCalledWith(expect.objectContaining({ status: "in-progress", activeChapterId: "privacy" }));
  });

  it("persists state through the injected callback", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn();
    render(<OnboardingHarness onPersist={onPersist} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox", { name: /Tutorials/ }));

    await waitFor(() => expect(onPersist).toHaveBeenCalled());
    expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({
      configuration: expect.objectContaining({ goals: ["tutorials"] }),
    }));
    expect(localStorage).toHaveLength(0);
  });
});

describe("ProfileGallery", () => {
  it("edits display name, selects supplied assets, and accepts imported assets through props", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onAcceptAsset = vi.fn().mockResolvedValue({
      id: "imported",
      src: "asset://imported",
      alt: "Imported account portrait",
      label: "My portrait",
    });
    render(<ProfileHarness onChange={onChange} onAcceptAsset={onAcceptAsset} />);

    await user.click(screen.getByRole("radio", { name: /Warm studio/ }));
    expect(onChange).toHaveBeenCalledWith({ displayName: "", portraitAssetId: "portrait-b" });

    await user.type(screen.getByRole("textbox", { name: "Display name" }), "Aly Owner");
    expect(onChange).toHaveBeenCalledWith({ displayName: "Aly Owner", portraitAssetId: "portrait-b" });

    const file = new File(["portrait"], "portrait.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Import a profile portrait"), file);
    await waitFor(() => expect(onAcceptAsset).toHaveBeenCalledWith(file));
    expect(onChange).toHaveBeenCalledWith({ displayName: "Aly Owner", portraitAssetId: "imported" });
    expect(screen.getByRole("radio", { name: /My portrait/ })).toBeChecked();
  });
});

describe("GuidedTour", () => {
  it("is reduced-motion safe and supports arrow and Escape keyboard controls", async () => {
    const user = userEvent.setup();
    const onActiveIndexChange = vi.fn();
    const onExit = vi.fn();
    const onComplete = vi.fn();
    const steps = [
      { id: "one", target: "#missing", title: "Open a project", description: "Choose a project from the library." },
      { id: "two", target: null, title: "Review the result", description: "Inspect and export the finished tutorial." },
    ];
    const { container, rerender } = render(
      <GuidedTour open steps={steps} activeIndex={0} reducedMotion onActiveIndexChange={onActiveIndexChange} onExit={onExit} onComplete={onComplete} />,
    );

    expect(container.querySelector(".aly-onboarding-tour")).toHaveAttribute("data-reduced-motion", "true");
    expect(container.querySelector(".aly-onboarding-tour")).toHaveAttribute("data-target-missing", "true");
    expect(screen.getByRole("dialog", { name: "Open a project" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);

    rerender(<GuidedTour open steps={steps} activeIndex={1} reducedMotion onActiveIndexChange={onActiveIndexChange} onExit={onExit} onComplete={onComplete} />);
    await user.keyboard("{ArrowRight}");
    expect(onComplete).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("waits for the taught action instead of advancing from Next or ArrowRight", async () => {
    const user = userEvent.setup();
    const onActiveIndexChange = vi.fn();
    const onStepComplete = vi.fn();
    render(
      <>
        <button id="create-tutorial">New tutorial</button>
        <GuidedTour
          open
          steps={[{
            id: "create",
            target: "#create-tutorial",
            title: "Create a tutorial",
            description: "Open the real creation flow.",
            completion: { type: "target-event", event: "click", label: "Select New tutorial" },
          }, {
            id: "review",
            target: null,
            title: "Review",
            description: "Review the result.",
          }]}
          activeIndex={0}
          onActiveIndexChange={onActiveIndexChange}
          onExit={vi.fn()}
          onComplete={vi.fn()}
          onStepComplete={onStepComplete}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.keyboard("{ArrowRight}");
    expect(onActiveIndexChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "New tutorial" }));
    expect(onStepComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "create" }), 0);
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);
  });

  it("re-resolves a target added after the step mounts and keeps its description attached", async () => {
    const steps = [{
      id: "late",
      target: "#late-target",
      title: "A control that loads later",
      description: "Wait for the route to render.",
      completion: { type: "target-event" as const, event: "click" as const, label: "Open the control" },
    }];
    const { container } = render(
      <GuidedTour open steps={steps} activeIndex={0} onActiveIndexChange={vi.fn()} onExit={vi.fn()} onComplete={vi.fn()} />,
    );
    expect(container.querySelector(".aly-onboarding-tour")).toHaveAttribute("data-target-missing", "true");

    const target = document.createElement("button");
    target.id = "late-target";
    target.textContent = "Late control";
    await act(async () => { document.body.append(target); });

    await waitFor(() => expect(container.querySelector(".aly-onboarding-tour")).toHaveAttribute("data-target-missing", "false"));
    expect(target).toHaveClass("aly-onboarding-tour-target");
    expect(target.getAttribute("aria-describedby")).toContain(screen.getByText("Wait for the route to render.").id);
    target.remove();
  });

  it("uses the rendered panel size and scrolls off-screen targets without motion when reduced", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList.contains("aly-onboarding-tour__panel")) {
        return { top: 0, left: 0, width: 500, height: 300, right: 500, bottom: 300, x: 0, y: 0, toJSON: () => ({}) };
      }
      if (this.id === "tracked-target") {
        return { top: 900, left: 400, width: 100, height: 50, right: 500, bottom: 950, x: 400, y: 900, toJSON: () => ({}) };
      }
      return originalRect.call(this);
    };

    try {
      render(
        <>
          <button id="tracked-target">Tracked control</button>
          <GuidedTour
            open
            reducedMotion
            steps={[{ id: "tracked", target: "#tracked-target", title: "Tracked", description: "Keep this visible.", placement: "center" }]}
            activeIndex={0}
            onActiveIndexChange={vi.fn()}
            onExit={vi.fn()}
            onComplete={vi.fn()}
          />
        </>,
      );
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto", block: "center" })));
      const panel = screen.getByRole("dialog", { name: "Tracked" });
      expect(Number.parseFloat(panel.style.left)).toBeCloseTo((window.innerWidth - 500) / 2);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  it("focuses the highlighted control on request and restores its original attributes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <button id="focus-target" aria-describedby="existing-help">Target action</button>
        <GuidedTour
          open
          steps={[{ id: "focus", target: "#focus-target", title: "Use the target", description: "Activate it.", completion: { type: "target-event", label: "Activate Target action" } }]}
          activeIndex={0}
          onActiveIndexChange={vi.fn()}
          onExit={vi.fn()}
          onComplete={vi.fn()}
        />
      </>,
    );
    const target = screen.getByRole("button", { name: "Target action" });
    await user.click(screen.getByRole("button", { name: "Focus highlighted control" }));
    expect(target).toHaveFocus();
    expect(target.getAttribute("aria-describedby")).toContain("existing-help");

    rerender(<button id="focus-target" aria-describedby="existing-help">Target action</button>);
    expect(target).not.toHaveClass("aly-onboarding-tour-target");
    expect(target).toHaveAttribute("aria-describedby", "existing-help");
  });

  it("accepts durable completion keys and observes real element state", async () => {
    const user = userEvent.setup();
    const steps = [{
      id: "provider",
      target: "#provider-route",
      title: "Choose a provider",
      description: "Save an explicit route.",
      completion: { type: "external" as const, key: "provider-saved", label: "Save a provider route" },
    }];
    const props = {
      open: true,
      steps,
      activeIndex: 0,
      onActiveIndexChange: vi.fn(),
      onExit: vi.fn(),
      onComplete: vi.fn(),
    };
    const { rerender } = render(
      <>
        <button id="provider-route">Provider route</button>
        <GuidedTour {...props} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Finish tour" })).toBeDisabled();
    rerender(
      <>
        <button id="provider-route">Provider route</button>
        <GuidedTour {...props} completedStepIds={["provider-saved"]} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Finish tour" })).toBeEnabled();

    const elementSteps = [{
      id: "drawer",
      target: "#drawer-trigger",
      title: "Open jobs",
      description: "Inspect active work.",
      allowTargetInteraction: true,
      completion: { type: "element-state" as const, selector: "#jobs-drawer", label: "Open the Jobs drawer" },
    }];
    rerender(
      <>
        <button id="drawer-trigger">Jobs</button>
        <GuidedTour {...props} steps={elementSteps} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Finish tour" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Jobs" }));
    const drawer = document.createElement("aside");
    drawer.id = "jobs-drawer";
    await act(async () => { document.body.append(drawer); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish tour" })).toBeEnabled());
    drawer.remove();
  });
});
