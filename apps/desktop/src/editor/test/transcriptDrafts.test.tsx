import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { AdvancedVideoEditor } from "..";
import { makeSampleProject } from "./fixtures";

beforeEach(() => localStorage.clear());

it("restores unfinished cue text after closing and reopening without applying it to imported wording", async () => {
  const user = userEvent.setup();
  const original = makeSampleProject();
  let mounted = render(<AdvancedVideoEditor project={original} />);
  await user.click(screen.getByRole("button", { name: "Transcript" }));
  const cue = screen.getByDisplayValue("Start with the question.");
  await user.clear(cue);
  await user.type(cue, "An unfinished explanation.");
  mounted.unmount();
  mounted = render(<AdvancedVideoEditor project={original} />);
  await user.click(screen.getByRole("button", { name: "Transcript" }));
  expect(screen.getByDisplayValue("An unfinished explanation.")).toBeInTheDocument();
  mounted.unmount();
  const imported = structuredClone(original);
  imported.tracks.find((track) => track.kind === "captions")!.clips[0]!.text = "Different imported source.";
  mounted = render(<AdvancedVideoEditor project={imported} />);
  await user.click(screen.getByRole("button", { name: "Transcript" }));
  expect(screen.getByDisplayValue("Different imported source.")).toBeInTheDocument();
  expect(screen.queryByDisplayValue("An unfinished explanation.")).not.toBeInTheDocument();
  mounted.unmount();
});

it("reverts a recovered draft and removes it without changing the saved cue", async () => {
  const user = userEvent.setup();
  const project = makeSampleProject();
  const mounted = render(<AdvancedVideoEditor project={project} />);
  await user.click(screen.getByRole("button", { name: "Transcript" }));
  const input = screen.getByDisplayValue("Start with the question.");
  await user.type(input, " A draft.");
  await user.click(within(input.closest("li")!).getByRole("button", { name: "Revert" }));
  expect(input).toHaveValue("Start with the question.");
  mounted.unmount();
  render(<AdvancedVideoEditor project={project} />);
  await user.click(screen.getByRole("button", { name: "Transcript" }));
  expect(screen.getByDisplayValue("Start with the question.")).toBeInTheDocument();
});
