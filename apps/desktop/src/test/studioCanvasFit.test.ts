import { describe, expect, it } from "vitest";
import { fitStudioCanvas } from "../studioCanvasFit";

describe("Studio canvas fitting", () => {
  it("uses the available width when the stage is wide enough", () => {
    expect(fitStudioCanvas({ width: 970, height: 650 }, { width: 72, height: 46 })).toEqual({
      width: 898,
      height: 505.125,
    });
  });

  it("uses the available height in a short stage instead of clipping below the controls", () => {
    expect(fitStudioCanvas({ width: 1400, height: 500 }, { width: 72, height: 46 })).toEqual({
      width: 807.1111111111111,
      height: 454,
    });
  });

  it("returns an empty fit until the stage has measurable space", () => {
    expect(fitStudioCanvas({ width: 40, height: 40 }, { width: 72, height: 46 })).toEqual({ width: 0, height: 0 });
  });
});
