import type { BuiltinSceneKind, SceneSpec } from "./types.js";
import { TIMEBASE_TICKS_PER_SECOND } from "./types.js";

const durationTicks = TIMEBASE_TICKS_PER_SECOND * 8;
const base = (id: string, content: SceneSpec["content"], seed = 2048): SceneSpec => ({ id: `specimen.${id}`, content, durationTicks, seed });
const items = [
  { id: "point.a", text: "Split the problem into smaller, meaningful pieces", emphasis: "primary" as const },
  { id: "point.b", text: "Reuse the three recursive products", supportingText: "This is the step that changes the growth rate." },
  { id: "point.c", text: "Combine the pieces into the final result", emphasis: "secondary" as const },
];
const lines = [
  { id: "line.1", text: "def karatsuba(x, y):", tokenClass: "keyword" as const },
  { id: "line.2", text: "    if x < 10 or y < 10:", tokenClass: "plain" as const },
  { id: "line.3", text: "        return x * y", tokenClass: "keyword" as const, highlight: true },
  { id: "line.4", text: "    m = max(len(str(x)), len(str(y))) // 2", tokenClass: "function" as const },
  { id: "line.5", text: "    high_x, low_x = divmod(x, 10 ** m)", tokenClass: "plain" as const },
  { id: "line.6", text: "    z1 = karatsuba(low_x + high_x, low_y + high_y)", tokenClass: "function" as const },
];
const series = [
  { id: "series.classic", label: "Classic", values: [{ x: 1, y: 1, label: "n=1" }, { x: 2, y: 4, label: "n=2" }, { x: 3, y: 9, label: "n=3" }, { x: 4, y: 16, label: "n=4" }] },
  { id: "series.fast", label: "Karatsuba", values: [{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 6 }, { x: 4, y: 10 }] },
];
const asset = { id: "asset.local.diagram", sha256: "a".repeat(64), alt: "A local educational diagram showing the multiplication split", fit: "cover" as const };

export const SPECIMEN_SCENES: readonly SceneSpec[] = [
  base("title", { kind: "title", title: "Karatsuba Multiplication", eyebrow: "Algorithms, visually", subtitle: "How three smaller products beat four", author: "Alystria Studio", module: "Divide & Conquer" }),
  base("section", { kind: "section-intro", title: "The three-product insight", sectionNumber: "03", objectives: ["Recognize the algebraic substitution", "Trace one recursive call", "Compare the asymptotic cost"] }),
  base("definition", { kind: "definition", title: "Name the idea", term: "Divide and conquer", definition: "Break a problem into similar subproblems, solve them recursively, then combine their answers.", example: "Karatsuba splits each integer into high and low halves." }),
  base("bullets", { kind: "bullets", title: "The strategy at a glance", items }),
  base("comparison", { kind: "comparison", title: "Four products become three", left: { label: "Schoolbook", items: ["ac", "ad", "bc", "bd"] }, right: { label: "Karatsuba", items: ["ac", "bd", "(a+b)(c+d)"] }, verdict: "One recursive multiplication saved" }),
  base("diagram", { kind: "diagram", title: "Follow the concept thread", nodes: [{ id: "node.input", label: "1234 × 5678", tone: "primary" }, { id: "node.split", label: "Split", detail: "12·100 + 34" }, { id: "node.products", label: "3 products", tone: "secondary" }, { id: "node.answer", label: "7,006,652", tone: "warning" }], edges: [{ id: "edge.1", from: "node.input", to: "node.split" }, { id: "edge.2", from: "node.split", to: "node.products", style: "emphasis" }, { id: "edge.3", from: "node.products", to: "node.answer" }], direction: "left-to-right" }),
  base("timeline", { kind: "timeline", title: "A short history of fast multiplication", events: [{ id: "time.1", date: "1952", label: "Kolmogorov conjectures a quadratic lower bound" }, { id: "time.2", date: "1960", label: "Karatsuba finds the counterexample" }, { id: "time.3", date: "1962", label: "The method is published" }, { id: "time.4", date: "Today", label: "A foundation for faster arithmetic" }] }),
  base("formula", { kind: "formula", title: "Recombine the halves", expression: "xy = z₂·10²ᵐ + (z₁−z₂−z₀)·10ᵐ + z₀", result: "7,006,652" }),
  base("derivation", { kind: "derivation", title: "Derive the middle term", expression: "z₁ = (a+b)(c+d)", steps: [{ id: "derive.1", expression: "z₁ = ac + ad + bc + bd", reason: "expand" }, { id: "derive.2", expression: "z₁ − ac − bd = ad + bc", reason: "subtract known products" }], result: "middle = z₁ − z₂ − z₀" }),
  base("graph", { kind: "graph", title: "Growth rates separate", xLabel: "Input digits", yLabel: "Relative work", series, domain: { x: [1, 4], y: [0, 18] } }),
  base("whiteboard", { kind: "whiteboard", title: "Watch the split take shape", boardStyle: "whiteboard", finalBoardDescription: "A hand-drawn place-value split showing 1234 becoming 12 times 100 plus 34.", strokes: [
    { id: "stroke.number", points: [{ x: 0.12, y: 0.34 }, { x: 0.2, y: 0.34 }, { x: 0.28, y: 0.34 }], startTick: TIMEBASE_TICKS_PER_SECOND, endTick: TIMEBASE_TICKS_PER_SECOND * 2, tool: "marker", color: "primary" },
    { id: "stroke.branch-a", points: [{ x: 0.29, y: 0.36 }, { x: 0.42, y: 0.55 }, { x: 0.54, y: 0.55 }], startTick: TIMEBASE_TICKS_PER_SECOND * 2, endTick: TIMEBASE_TICKS_PER_SECOND * 3, tool: "pencil" },
    { id: "stroke.branch-b", points: [{ x: 0.29, y: 0.36 }, { x: 0.42, y: 0.22 }, { x: 0.54, y: 0.22 }], startTick: TIMEBASE_TICKS_PER_SECOND * 3, endTick: TIMEBASE_TICKS_PER_SECOND * 4, tool: "pencil" },
    { id: "stroke.underline", points: [{ x: 0.1, y: 0.72 }, { x: 0.28, y: 0.74 }, { x: 0.48, y: 0.71 }, { x: 0.7, y: 0.73 }], startTick: TIMEBASE_TICKS_PER_SECOND * 5, endTick: TIMEBASE_TICKS_PER_SECOND * 6, tool: "marker", color: "secondary" },
  ], labels: [
    { id: "label.input", text: "1234", x: 0.12, y: 0.31, startTick: TIMEBASE_TICKS_PER_SECOND, color: "primary" },
    { id: "label.high", text: "12 × 100", x: 0.57, y: 0.24, startTick: TIMEBASE_TICKS_PER_SECOND * 4 },
    { id: "label.low", text: "+ 34", x: 0.57, y: 0.57, startTick: TIMEBASE_TICKS_PER_SECOND * 5 },
  ] }),
  base("code", { kind: "code", title: "A recursive implementation", filename: "karatsuba.py", language: "python", lines }),
  base("live-code", { kind: "live-code", title: "Build the base case with the narration", filename: "karatsuba.py", language: "python", lines: lines.slice(0, 3), actions: [
    { id: "type.1", type: "type", lineId: "line.1", startTick: TIMEBASE_TICKS_PER_SECOND, endTick: TIMEBASE_TICKS_PER_SECOND * 2, narrationAnchor: "Define the function" },
    { id: "type.2", type: "type", lineId: "line.2", startTick: TIMEBASE_TICKS_PER_SECOND * 2, endTick: TIMEBASE_TICKS_PER_SECOND * 4, narrationAnchor: "Check the base case" },
    { id: "type.3", type: "type", lineId: "line.3", startTick: TIMEBASE_TICKS_PER_SECOND * 4, endTick: TIMEBASE_TICKS_PER_SECOND * 5, narrationAnchor: "Return the direct product" },
    { id: "highlight.3", type: "highlight", lineId: "line.3", startTick: TIMEBASE_TICKS_PER_SECOND * 5, endTick: TIMEBASE_TICKS_PER_SECOND * 7 },
    { id: "run.1", type: "run", startTick: TIMEBASE_TICKS_PER_SECOND * 6, endTick: TIMEBASE_TICKS_PER_SECOND * 7, output: "PASS · 8 × 7 = 56" },
  ] }),
  base("walkthrough", { kind: "walkthrough", title: "Walk through the base case", filename: "karatsuba.py", language: "python", lines, step: 2, totalSteps: 5 }),
  base("diff", { kind: "diff", title: "Replace four recursive calls", filename: "multiply.diff", lines: [{ id: "diff.1", text: "- z2, z3 = multiply(a,c), multiply(a,d)" }, { id: "diff.2", text: "- z4, z0 = multiply(b,c), multiply(b,d)" }, { id: "diff.3", text: "+ z2 = karatsuba(a, c)" }, { id: "diff.4", text: "+ z0 = karatsuba(b, d)" }, { id: "diff.5", text: "+ z1 = karatsuba(a+b, c+d)" }] }),
  base("tree", { kind: "file-tree", title: "The tutorial project", entries: [{ id: "tree.1", path: "karatsuba", type: "folder" }, { id: "tree.2", path: "karatsuba/algorithm.py", type: "file", emphasis: true }, { id: "tree.3", path: "karatsuba/tests", type: "folder" }, { id: "tree.4", path: "karatsuba/tests/test_algorithm.py", type: "file" }, { id: "tree.5", path: "karatsuba/README.md", type: "file" }] }),
  base("terminal", { kind: "terminal", title: "Verify the result", filename: "PowerShell", lines: [{ id: "term.1", text: "> python algorithm.py 1234 5678" }, { id: "term.2", text: "split: 12 | 34 and 56 | 78" }, { id: "term.3", text: "products: 672, 2652, 6164" }, { id: "term.4", text: "result: 7006652", highlight: true }] }),
  base("trace", { kind: "execution-trace", title: "Watch the stack evolve", activeFrame: 2, frames: [{ id: "frame.1", label: "karatsuba(1234, 5678)", line: 1, variables: { x: "1234", y: "5678" } }, { id: "frame.2", label: "split at m = 2", line: 4, variables: { a: "12", b: "34", c: "56", d: "78" } }, { id: "frame.3", label: "compute z₂", line: 7, variables: { z2: "672" } }] }),
  base("vars", { kind: "variable-state", title: "One operation, visible state", before: { a: "12", b: "34", c: "56", d: "78" }, after: { z2: "672", z0: "2652", z1: "6164" }, operation: "recurse ×3" }),
  base("chart", { kind: "chart", title: "Count the recursive products", chartType: "bar", series, xLabel: "level", yLabel: "calls" }),
  base("table", { kind: "table", title: "Compare the algorithms", columns: [{ id: "col.method", label: "Method" }, { id: "col.calls", label: "Subproducts", align: "center" }, { id: "col.complexity", label: "Complexity", align: "right" }], rows: [{ id: "row.school", cells: ["Schoolbook", "4", "O(n²)"] }, { id: "row.k", cells: ["Karatsuba", "3", "O(n^1.585)"], emphasis: true }] }),
  base("map", { kind: "map", title: "From discovery to publication", points: [{ id: "map.moscow", label: "Moscow", x: 0.62, y: 0.32 }, { id: "map.reach", label: "Global adoption", x: 0.35, y: 0.53 }] }),
  base("image", { kind: "image-focus", title: "Inspect the split", asset, callouts: [{ id: "call.a", label: "high half", x: 0.3, y: 0.42 }, { id: "call.b", label: "low half", x: 0.69, y: 0.63 }], citation: "Local deterministic specimen · CC0" }),
  base("image-compare", { kind: "image-comparison", title: "Before and after decomposition", left: { ...asset, id: "asset.left", alt: "Unsplit multiplication expression" }, right: { ...asset, id: "asset.right", alt: "Split multiplication expression" }, leftLabel: "original", rightLabel: "decomposed" }),
  base("document", { kind: "document-focus", title: "Read the primary source", asset: { ...asset, id: "asset.paper", alt: "Highlighted page from the local paper" }, callouts: [{ id: "paper.call", label: "three multiplications", x: 0.54, y: 0.4 }], citation: "Karatsuba & Ofman, 1962 · local evidence copy" }),
  base("ui", { kind: "ui-demo", title: "Try it in the studio", windowTitle: "Alystria Studio", activeStep: 1, mockup: "desktop", steps: items }),
  base("recording", { kind: "screen-recording", title: "Observe a complete run", asset: { ...asset, id: "asset.recording", alt: "Local screen recording of the algorithm running" }, callouts: [{ id: "record.call", label: "result", x: 0.7, y: 0.78 }] }),
  base("simulation", { kind: "simulation", title: "Change the input size", variables: [{ id: "var.n", label: "Digits", value: 64, min: 2, max: 256 }, { id: "var.base", label: "Base case", value: 8, min: 1, max: 32 }], observation: "Three branches grow more slowly than four", series }),
  base("presenter", { kind: "presenter", title: "Why this trick matters", presenterName: "Alystria Guide", talkingPoint: "A single algebraic identity changes the shape of the recursion tree.", disclosure: "Synthetic presenter" }),
  base("presenter-slide", { kind: "presenter-slide", title: "Keep the insight visible", presenterName: "Alystria Guide", talkingPoint: "Remember the three products.", slideItems: items, disclosure: "Synthetic presenter" }),
  base("quote", { kind: "quote", title: "The moment of discovery", quote: "The first example of a divide-and-conquer algorithm that beats the obvious method.", attribution: "Teaching summary", source: "Alystria specimen narrative" }),
  base("question", { kind: "question", title: "Pause and predict", question: "Which product can we recover without a fourth recursive multiplication?", prompt: "Use the expansion of (a+b)(c+d).", thinkingTimeSeconds: 8 }),
  base("example", { kind: "worked-example", title: "Multiply 1234 × 5678", problem: "Split each integer after two digits.", steps: items, answer: "1234 × 5678 = 7,006,652" }),
  base("quiz", { kind: "quiz", title: "Check your understanding", question: "How many recursive products does Karatsuba compute at each split?", options: [{ id: "quiz.a", label: "Two" }, { id: "quiz.b", label: "Three", correct: true }, { id: "quiz.c", label: "Four" }, { id: "quiz.d", label: "Eight" }], revealAnswer: true, explanation: "The middle cross-term is reconstructed from the other three products." }),
  base("recap", { kind: "recap", title: "The insight, reinforced", items }),
  base("summary", { kind: "summary", title: "What you can now explain", items }),
  base("sources", { kind: "sources", title: "Sources and credits", sources: [{ id: "source.1", title: "Multiplication of Multidigit Numbers on Automata", creator: "A. Karatsuba and Yu. Ofman", license: "Citation", locator: "Doklady Akademii Nauk SSSR (1962)" }, { id: "source.2", title: "Alystria deterministic visual specimen", creator: "Alystria Studio", license: "CC0", locator: "local asset" }] }),
  base("outro", { kind: "outro", title: "You found the faster path", nextSteps: ["Trace a call", "Prove the identity", "Benchmark it"], callToAction: "Continue to the practice set" }),
];

export const SPECIMENS_BY_KIND: ReadonlyMap<BuiltinSceneKind, SceneSpec> = new Map(SPECIMEN_SCENES.map((scene) => [scene.content.kind as BuiltinSceneKind, scene]));

export function specimenFor(kind: BuiltinSceneKind): SceneSpec {
  const specimen = SPECIMENS_BY_KIND.get(kind);
  if (!specimen) throw new Error(`Missing built-in specimen for ${kind}.`);
  return specimen;
}
