import { render, screen, waitFor } from "@testing-library/react";
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
  onPersist = vi.fn(),
  onExit = vi.fn(),
}: {
  persistedState?: PersistedOnboardingState;
  setupState?: OnboardingSetupState;
  onPersist?: (state: PersistedOnboardingState) => void | Promise<void>;
  onExit?: (state: PersistedOnboardingState) => void;
}) {
  const controller = useOnboardingController({ persistedState, setupState, onPersist, onExit });
  return (
    <>
      <OnboardingReplayButton controller={controller} />
      <OnboardingDialog controller={controller} setupState={setupState} catalog={catalog} />
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
  it("uses modal semantics, focuses each chapter heading, and gates required chapters", async () => {
    const user = userEvent.setup();
    render(<OnboardingHarness />);

    expect(screen.getByRole("dialog", { name: "Make Alystria yours" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Make Alystria yours" })).toHaveFocus();
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
    expect(screen.getByRole("dialog", { name: "Make Alystria yours" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Chapter 1 What will you create/ }));
    expect(screen.getByRole("checkbox", { name: /Tutorials/ })).toBeChecked();
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
});
