import { describe, expect, it } from "vitest";
import { compileArithmeticAssignmentProgram } from "../src/arithmetic-program.js";

describe("approved arithmetic assignment traces", () => {
  it("turns the actual worked multiplication equalities into valid computed assignments", () => {
    const program = compileArithmeticAssignmentProgram([
      "ac = 1*3 = 3",
      "bd = 2*4 = 8",
      "cross = (1+2)*(3+4) - 3 - 8 = 10",
      "result = 3*100 + 10*10 + 8 = 408",
    ]);
    expect(program?.language).toBe("python");
    expect(program?.lines).toEqual([
      { text: "ac = 1*3", annotation: "ac = 3" },
      { text: "bd = 2*4", annotation: "bd = 8" },
      { text: "cross = (1+2)*(3+4) - 3 - 8", annotation: "cross = 10" },
      { text: "result = 3*100 + 10*10 + 8", annotation: "result = 408" },
    ]);
  });

  it("evaluates prior variables, operator precedence, parentheses, and unary signs", () => {
    expect(compileArithmeticAssignmentProgram([
      "width = 12", "height = 3", "area = width × height = 36",
      "adjusted = -(area - 6) / 3 + 2 = -8",
    ])?.lines.at(-1)?.annotation).toBe("adjusted = -8");
  });

  it("rejects a claimed answer that disagrees with the arithmetic", () => {
    expect(compileArithmeticAssignmentProgram(["answer = 12 * 34 = 409"])).toBeUndefined();
  });

  it.each([
    ["12 × 34 = 408"],
    ["value = missing + 1"],
    ["value = process.exit()"],
    ["value = __import__('os')"],
    ["value = x[0]"],
    ["value = 1; print(1)"],
    ["value = 1 / 0"],
    ["value = 99999999999999999999999"],
    ["value = (1 + 2"],
    ["value = 2 ** 3"],
    ["value = 012"],
    ["class = 3"],
    ["value = 2\nprint(value)"],
  ])("does not turn unsupported content into an execution claim: %s", (line) => {
    expect(compileArithmeticAssignmentProgram([line])).toBeUndefined();
  });

  it("bounds nested and overlong work", () => {
    expect(compileArithmeticAssignmentProgram([`x = ${"(".repeat(18)}1${")".repeat(18)}`])).toBeUndefined();
    expect(compileArithmeticAssignmentProgram(Array.from({ length: 25 }, () => "x = 1"))).toBeUndefined();
  });
});
