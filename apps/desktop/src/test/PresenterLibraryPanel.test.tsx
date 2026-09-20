import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PresenterLibraryPanel } from "../PresenterLibraryPanel";
import type { PresenterLibraryController } from "../customPresenterLibrary";

function controller(): PresenterLibraryController {
  return {
    entries: [],
    choices: [],
    loading: false,
    busy: false,
    error: null,
    refresh: vi.fn(),
    importPortrait: vi.fn(),
    promoteGeneratedPortrait: vi.fn(),
  };
}

describe("PresenterLibraryPanel", () => {
  it("routes a named prompt through the selected project image model callback", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<PresenterLibraryPanel library={controller()} canGenerate onGenerate={onGenerate} />);

    await user.click(screen.getByRole("button", { name: /create.*image model/i }));
    await user.type(screen.getByLabelText("Presenter name"), "Nova");
    await user.type(screen.getByLabelText("Appearance"), "A friendly anime physics teacher in a home studio");
    await user.click(screen.getByRole("button", { name: /create review candidate/i }));

    expect(onGenerate).toHaveBeenCalledWith({
      displayName: "Nova",
      prompt: "A friendly anime physics teacher in a home studio",
    });
    expect(screen.getByText(/nothing enters the cast until you inspect and accept it/i)).toBeInTheDocument();
  });

  it("keeps image-model creation unavailable before a desktop tutorial exists", async () => {
    const user = userEvent.setup();
    render(<PresenterLibraryPanel library={controller()} />);
    await user.click(screen.getByRole("button", { name: /create.*image model/i }));
    expect(screen.getByRole("button", { name: /open a tutorial to create/i })).toBeDisabled();
    expect(screen.getByText(/still image ready after save/i)).toBeInTheDocument();
  });

  it("shows and decodes the selected portrait before saving", async () => {
    const user = userEvent.setup();
    const library = controller();
    const objectUrl = vi.fn().mockReturnValue("blob:portrait-preview");
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: objectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
    const portrait = new File([new Uint8Array([1, 2, 3])], "nova.png", { type: "image/png" });
    Object.defineProperty(portrait, "arrayBuffer", { value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer) });

    const { unmount } = render(<PresenterLibraryPanel library={library} />);
    await user.click(screen.getByRole("button", { name: /upload from your device/i }));
    await user.upload(screen.getByLabelText("Portrait file"), portrait);
    await user.type(screen.getByLabelText("Presenter name"), "Nova");
    await user.click(screen.getByText(/fictional or generated character/i));

    const save = screen.getByRole("button", { name: /save to my presenters/i });
    expect(save).toBeDisabled();
    fireEvent.load(screen.getByRole("img", { name: /preview of nova.png/i }));
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(library.importPortrait).toHaveBeenCalledTimes(1));
    expect(library.importPortrait).toHaveBeenCalledWith(expect.objectContaining({
      filename: "nova.png",
      mimeType: "image/png",
      presenter: expect.objectContaining({ displayName: "Nova", syntheticOriginAttested: true }),
    }));
    unmount();
    expect(objectUrl).toHaveBeenCalledWith(portrait);
    expect(revokeUrl).toHaveBeenCalledWith("blob:portrait-preview");
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });
});
