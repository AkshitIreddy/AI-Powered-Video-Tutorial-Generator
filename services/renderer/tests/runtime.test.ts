import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_SCENE_KINDS } from "@alystria/scenes";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { FrameRenderer, compileVisualBeatSequence, resolveBuiltinSceneSpec, totalFrames } from "../src/runtime.js";
import { ResponsiveLayoutCompiler } from "../src/layout.js";

test("frame renderer prepares immutable scene compilation once across frames", () => {
  const manifest = fixtureManifest();
  let layoutCompiles = 0;
  let specResolutions = 0;
  const layoutCompiler = new ResponsiveLayoutCompiler({
    "*": (_context, base) => {
      layoutCompiles += 1;
      return base;
    },
  });
  const renderer = new FrameRenderer({
    layoutCompiler,
    sceneSpecResolver(scene) {
      specResolutions += 1;
      return resolveBuiltinSceneSpec(scene);
    },
  });

  const first = renderer.render(manifest, 1);
  const repeated = renderer.render(manifest, 1);
  renderer.render(manifest, 2);
  assert.equal(layoutCompiles, manifest.scenes.length, "layout should compile once per prepared scene");
  assert.equal(specResolutions, manifest.scenes.length, "SceneSpec should resolve once per prepared scene");
  assert.equal(first.html, repeated.html);
  assert.equal(first.contentHash, repeated.contentHash);
});

test("production defaults resolve every built-in kind through SceneView", () => {
  const base = fixtureManifest();
  const renderer = new FrameRenderer({ verifyRepeatability: true });
  for (const kind of BUILTIN_SCENE_KINDS) {
    const manifest = {
      ...base,
      scenes: [{
        ...base.scenes[0]!,
        id: `production-${kind}`,
        kind,
        content: {
          title: `Production ${kind}`,
          body: "A manifest-derived explanation, kept inert and deterministic.",
          items: ["First teaching point", "Second teaching point", "Third teaching point"],
        },
      }],
    };
    const rendered = renderer.render(manifest, 15);
    assert.match(rendered.svg, new RegExp(`data-scene-kind="${kind}"`), kind);
    assert.doesNotMatch(rendered.svg, /<foreignObject/, kind);
  }
});

test("default presenter mapping is semantic and never consumes path-like metadata", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    id: "guide-scene",
    kind: "presenter-slide",
    content: {
      title: "Meet the three-product insight",
      body: "One algebraic identity changes the recursion tree.",
      items: ["Split the inputs", "Compute three products", "Recombine"],
    },
    metadata: {
      presenterName: "Alystria Guide",
      presenterDisclosure: "Synthetic presenter",
      portraitPath: "C:\\untrusted\\portrait.png",
      portraitUrl: "https://tracker.invalid/portrait.png",
    },
  };
  const spec = resolveBuiltinSceneSpec(scene);
  assert.equal(spec?.content.kind, "presenter-slide");
  const rendered = new FrameRenderer().render({ ...base, scenes: [scene] }, 15);
  assert.match(rendered.svg, /data-scene-kind="presenter-slide"/);
  assert.match(rendered.svg, /Meet the three-product insight/);
  assert.doesNotMatch(rendered.svg, /C:\\untrusted/);
  assert.doesNotMatch(rendered.svg, /https:\/\/tracker\.invalid/);
});

test("worked examples carry labels and relations instead of narration paragraphs", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    id: "worked-caption-safe",
    kind: "worked-example",
    content: {
      title: "Trace the target",
      body: "Follow low, middle, and high without losing the invariant.",
      items: [
        "Find forty-four in a sorted list of three, eight, twelve, seventeen, twenty-three, thirty-one, forty-four, fifty-eight, and seventy-two.",
        "The middle value is twenty-three, so move the lower boundary past it.",
        "The next middle value is forty-four, which completes the search.",
        "State why the target remains inside the retained interval at every step.",
        "A fifth long narration sentence must remain in audio rather than overcrowding the card.",
      ],
    },
  };
  const spec = resolveBuiltinSceneSpec(scene);
  assert.equal(spec?.content.kind, "worked-example");
  if (spec?.content.kind !== "worked-example") throw new Error("Expected worked example content");
  assert.equal(spec.content.steps.length, 4);
  assert.ok(spec.content.steps.every((step) => step.text.length <= 46));
  assert.equal(spec.content.steps[0]?.text, "target = forty-four · sorted input");
  assert.deepEqual(spec.tags?.filter((tag) => tag.startsWith("visual:")), [
    "visual:intent=demonstrate",
    "visual:composition=worked_example",
    "visual:anchor=trace-the-target",
    "visual:continuity=lesson-trace-the-target",
    "visual:motion=trace-relationship",
    "visual:density=dense",
    "visual:narration-on-screen=false",
  ]);
  const rendered = new FrameRenderer().render({ ...base, scenes: [scene] }, 24);
  assert.match(rendered.svg, /RESOLVED STATE/);
  assert.match(rendered.svg, /data-scene-kind="worked-example"/);
  assert.match(rendered.svg, /mid = twenty-three/);
  assert.match(rendered.svg, /new mid = forty-four · target found/);
  assert.doesNotMatch(rendered.svg, /fifty-eight, and seventy-two/);
  assert.doesNotMatch(rendered.svg, /which completes the search/);
});

test("canonical Karatsuba semantic beats render exact place-value and recombination state", () => {
  const base = fixtureManifest();
  const placeValue = {
    ...base.scenes[0]!,
    id: "scene.karatsuba.place-value",
    kind: "definition",
    content: {
      title: "Name the place-value split",
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "define",
        compositionFamily: "diagram",
        focalAnchor: "base-b-split-axis",
        continuityKey: "karatsuba.product-thread",
        informationUnits: [
          { id: "symbolic-split", role: "ordered-sequence", values: ["x = aB + b", "y = cB + d"] },
          { id: "concrete-split", role: "comparison", values: ["1234 = 12|34", "5678 = 56|78"] },
          { id: "base-rule", role: "principle", text: "B = 100 · exact rewriting" },
        ],
        attentionCue: "align-symbolic-and-concrete-splits",
        motionIntent: ["reveal-primary", "trace-relationship", "match-transition"],
        textRoles: { eyebrow: "PLACE VALUE", label: "Separate high | low", focus: "B = 100" },
        avoidRegions: ["caption-safe-lower-third", "equation-stage"],
      },
    },
  } as const;
  const recombine = {
    ...base.scenes[0]!,
    id: "scene.karatsuba.recombine",
    kind: "worked-example",
    content: {
      title: "Recombine by place value",
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "resolve",
        compositionFamily: "worked_example",
        focalAnchor: "place-value-sum",
        continuityKey: "karatsuba.numeric-thread",
        informationUnits: [
          { id: "recombine-formula", role: "ordered-sequence", values: ["z2B²", "z1B", "z0"] },
          { id: "shift-high", role: "state", text: "672 × 10,000 = 6,720,000" },
          { id: "shift-middle", role: "state", text: "2840 × 100 = 284,000" },
          { id: "shift-low", role: "state", text: "2652 × 1 = 2,652" },
          { id: "final-product", role: "answer", text: "1234 × 5678 = 7,006,652" },
        ],
        attentionCue: "trace-each-coefficient-to-shifted-row",
        motionIntent: ["match-transition", "trace-relationship", "resolve-hold"],
        textRoles: { eyebrow: "RECOMBINE", result: "7,006,652" },
        avoidRegions: ["caption-safe-lower-third", "place-value-grid"],
      },
    },
  } as const;

  const definition = resolveBuiltinSceneSpec(placeValue);
  assert.equal(definition?.content.kind, "definition");
  if (definition?.content.kind !== "definition") throw new Error("expected semantic definition");
  assert.equal(definition.content.term, "Separate high | low");
  assert.match(definition.content.definition, /x = aB \+ b · y = cB \+ d/u);
  assert.equal(definition.content.example, "1234 = 12|34 · 5678 = 56|78 · B = 100 · exact rewriting");
  assert.deepEqual(definition.content.placeValueRelationship, {
    symbolic: ["x = aB + b", "y = cB + d"],
    concrete: ["1234 = 12|34", "5678 = 56|78"],
    rule: "B = 100 · exact rewriting",
  });

  const worked = resolveBuiltinSceneSpec(recombine);
  assert.equal(worked?.content.kind, "worked-example");
  if (worked?.content.kind !== "worked-example") throw new Error("expected semantic worked example");
  assert.equal(worked.content.problem, "z2B² · z1B · z0");
  assert.deepEqual(worked.content.steps.map((step) => step.text), [
    "672 × 10,000 = 6,720,000",
    "2840 × 100 = 284,000",
    "2652 × 1 = 2,652",
  ]);
  assert.equal(worked.content.answer, "1234 × 5678 = 7,006,652");

  const renderedDefinition = new FrameRenderer().render({ ...base, scenes: [placeValue] }, 24).svg;
  for (const value of ["x = aB + b", "y = cB + d", "1234", "12", "34", "5678", "56", "78", "B = 100 · exact rewriting"]) {
    assert.match(renderedDefinition, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), value);
  }
  assert.match(renderedDefinition, /data-visual-grammar="place-value-ruler"/u);
  assert.match(renderedDefinition, /data-place-value-block="high"/u);
  assert.match(renderedDefinition, /data-place-value-block="low"/u);
  assert.doesNotMatch(renderedDefinition, />Break<|>Solve similar parts<|>Combine</u);
  const renderedRecombine = new FrameRenderer().render({ ...base, scenes: [recombine] }, 24).svg;
  assert.match(renderedRecombine, /1234 × 5678 = 7,006,652/u);
  assert.doesNotMatch(renderedRecombine, /narration|placeholder/iu);
});

test("visual director maps semantic intent, focal geometry, and attention motion", () => {
  const base = fixtureManifest();
  const scenes = [
    {
      ...base.scenes[0]!,
      id: "define-invariant",
      kind: "definition",
      content: {
        title: "The search invariant",
        body: "Show the target remaining inside the retained interval.",
        items: ["The target always remains inside the interval we keep."],
      },
      metadata: { term: "Search invariant", focalAnchor: "retained interval", continuityKey: "binary search range" },
    },
    {
      ...base.scenes[0]!,
      id: "compare-cost",
      kind: "comparison",
      content: {
        title: "Compare the work",
        body: "Compare aligned counts on one scale.",
        items: ["Linear scan: up to 1,024 checks", "Binary search: about 10 checks"],
      },
    },
    {
      ...base.scenes[0]!,
      id: "halving-scale",
      kind: "chart",
      content: {
        title: "Halving scales",
        items: ["With one thousand twenty-four sorted items, ten halvings reduce the possibilities to one."],
      },
    },
  ];
  const beats = compileVisualBeatSequence(scenes);
  const definition = beats.get("define-invariant");
  const comparison = beats.get("compare-cost");
  assert.deepEqual(
    definition && [definition.semanticIntent, definition.compositionFamily, definition.focalAnchor, definition.motionIntent],
    ["define", "object_stage", "retained interval", "reveal-primary"],
  );
  assert.equal(definition?.textRoles.narrationOnScreen, false);
  assert.equal(definition?.avoidRegions.some((region) => region.role === "essential-visual" && region.priority === "required"), true);
  assert.deepEqual(
    comparison && [comparison.semanticIntent, comparison.compositionFamily, comparison.motionIntent],
    ["compare", "split_evidence", "compare-shift"],
  );
  assert.deepEqual(beats.get("halving-scale")?.informationUnits, ["one thousand twenty-four items → ten halvings → one choice"]);
});

test("visual director deterministically breaks a third repeated composition", () => {
  const base = fixtureManifest();
  const scenes = Array.from({ length: 5 }, (_, index) => ({
    ...base.scenes[0]!,
    id: `recap-${index + 1}`,
    kind: "recap",
    seed: `recap-seed-${index + 1}`,
    content: {
      title: `Checkpoint ${index + 1}`,
      items: ["low ≤ target ≤ high", "discard one half", "repeat"],
    },
  }));
  const first = [...compileVisualBeatSequence(scenes).values()].map((beat) => beat.compositionFamily);
  const repeated = [...compileVisualBeatSequence(scenes).values()].map((beat) => beat.compositionFamily);
  assert.deepEqual(first, repeated);
  for (let index = 2; index < first.length; index += 1) {
    assert.equal(first[index] === first[index - 1] && first[index] === first[index - 2], false);
  }
  assert.deepEqual(first.slice(0, 2), ["editorial_type", "editorial_type"]);
  assert.notEqual(first[2], "editorial_type");
});

test("visual director rejects path-like metadata as art direction", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    metadata: {
      focalAnchor: "https://tracker.invalid/focus",
      continuityKey: "C:\\untrusted\\lesson.json",
    },
  };
  const beat = compileVisualBeatSequence([scene]).get(scene.id);
  assert.equal(beat?.focalAnchor, scene.content.title);
  assert.equal(beat?.continuityKey, "lesson-three-multiplications-beat-four");
  assert.doesNotMatch(JSON.stringify(beat), /tracker\.invalid|untrusted/);
});

test("full premium harness visual families and motion sequences survive and reach scene rendering", () => {
  const base = fixtureManifest();
  const harnessDirections = [
    ["scene.binary-search.hook", "presenter-slide", "establish", "presenter", ["reveal-primary", "trace-relationship", "match-transition"]],
    ["scene.binary-search.sorted-contract", "definition", "define", "object_stage", ["reveal-primary", "trace-relationship", "transform-object"]],
    ["scene.binary-search.worked-trace", "worked-example", "demonstrate", "worked_example", ["trace-relationship", "transform-object", "emphasize-result"]],
    ["scene.binary-search.invariant", "execution-trace", "transform", "data_canvas", ["match-transition", "transform-object", "emphasize-result"]],
    ["scene.binary-search.pseudocode", "code", "prove", "document_focus", ["reveal-primary", "trace-relationship", "transform-object"]],
    ["scene.binary-search.absent-case", "diagram", "resolve", "diagram", ["trace-relationship", "transform-object", "resolve-answer"]],
    ["scene.binary-search.scale", "comparison", "compare", "split_evidence", ["compare-shift", "transform-object", "emphasize-result"]],
    ["scene.binary-search.retrieval-check", "quiz", "question", "editorial_type", ["reveal-primary", "question-hold", "resolve-answer"]],
  ] as const;
  const scenes = harnessDirections.map(([id, kind, semanticIntent, compositionFamily, motionIntent], index) => ({
    ...base.scenes[0]!,
    id,
    kind,
    seed: `premium-harness-${index}`,
    content: {
      title: `Premium beat ${index + 1}`,
      items: [`beat ${index + 1}`, `state ${index + 1}`],
      visualBeat: {
        schemaVersion: 1,
        semanticIntent,
        compositionFamily,
        focalAnchor: `focus-${index + 1}`,
        continuityKey: "binary-search.interval",
        informationUnits: [{ id: `state-${index + 1}`, role: "state", text: `state ${index + 1}` }],
        attentionCue: `attention-${index + 1}`,
        motionIntent: [...motionIntent],
        textRoles: { eyebrow: `BEAT ${index + 1}`, focus: `state ${index + 1}` },
        avoidRegions: [`focus-region-${index + 1}`, "caption-safe-bottom"],
      },
    },
  }));

  const beats = compileVisualBeatSequence(scenes);
  assert.deepEqual([...beats.values()].map((beat) => beat.compositionFamily), harnessDirections.map((entry) => entry[3]));
  assert.deepEqual([...beats.values()].map((beat) => beat.motionSequence), harnessDirections.map((entry) => entry[4]));
  assert.deepEqual([...beats.values()].map((beat) => beat.semanticIntent), harnessDirections.map((entry) => entry[2]));

  for (const [index, scene] of scenes.entries()) {
    const beat = beats.get(scene.id)!;
    const spec = resolveBuiltinSceneSpec(scene, beat);
    assert.ok(spec, scene.id);
    assert.ok(spec.tags?.includes(`visual:composition=${harnessDirections[index]![3]}`), scene.id);
    assert.ok(spec.tags?.includes(`visual:motion=${harnessDirections[index]![4][0]}`), scene.id);
    assert.ok(spec.tags?.includes(`visual:motion-sequence=${harnessDirections[index]![4].join(",")}`), scene.id);
    const rendered = new FrameRenderer().render({ ...base, scenes: [scene] }, 8);
    assert.match(rendered.svg, new RegExp(`data-composition-family="${harnessDirections[index]![3].replaceAll("_", "-")}"`), scene.id);
    assert.match(rendered.svg, new RegExp(`data-visual-motion="${harnessDirections[index]![4][0]}"`), scene.id);
  }
});

test("authored visual beats preserve typed labels and geometric avoid regions", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    id: "authored-worked-trace",
    kind: "worked-example",
    content: {
      title: "Watch the interval shrink",
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "demonstrate",
        compositionFamily: "worked_example",
        focalAnchor: "active-interval",
        continuityKey: "binary-search.interval",
        informationUnits: [
          { id: "values", role: "ordered-sequence", values: [3, 8, 12, 17, 23, 31, 44, 58, 72] },
          { id: "target", role: "target", value: 44 },
          { id: "step-one", role: "state", low: 0, middle: 4, high: 8, value: 23 },
        ],
        visualMetaphor: "one retained interval transformed one justified step at a time",
        attentionCue: "move-markers-before-removing-region",
        motionIntent: ["trace-relationship", "transform-object", "emphasize-result"],
        textRoles: { eyebrow: "FIND 44", markers: "low · mid · high" },
        avoidRegions: [
          "index-markers",
          { id: "visual-focus", role: "essential-visual", x: 0.06, y: 0.25, width: 0.88, height: 0.66, priority: "required" },
        ],
      },
    },
  } as const;
  const beat = compileVisualBeatSequence([scene]).get(scene.id)!;
  assert.equal(beat.source, "authored");
  assert.equal(beat.semanticIntent, "demonstrate");
  assert.equal(beat.compositionFamily, "worked_example");
  assert.deepEqual(beat.motionSequence, ["trace-relationship", "transform-object", "emphasize-result"]);
  assert.deepEqual(beat.informationUnits, [
    "3 · 8 · 12 · 17 · 23 · 31 · 44 · 58 · 72",
    "target = 44",
    "low 0 · mid 4 = 23 · high 8",
  ]);
  assert.equal(beat.textRoles.primary, "FIND 44");
  assert.deepEqual(beat.textRoles.authored, { eyebrow: "FIND 44", markers: "low · mid · high" });
  assert.deepEqual(beat.namedAvoidRegions, ["index-markers"]);
  assert.deepEqual(beat.avoidRegions.find((region) => region.id === "visual-focus"), {
    id: "visual-focus", role: "essential-visual", x: 0.06, y: 0.25, width: 0.88, height: 0.66, priority: "required",
  });
  const spec = resolveBuiltinSceneSpec(scene, beat);
  assert.equal(spec?.content.kind, "worked-example");
  if (spec?.content.kind !== "worked-example") throw new Error("Expected authored worked-example content");
  assert.equal(spec.content.title, "Watch the interval shrink");
  assert.equal(spec.content.eyebrow, "FIND 44");
  assert.ok(spec?.captionAvoidZones?.some((zone) => zone.id === "visual-focus" && zone.reason === "essential-visual"));
});

test("exact premium binary-search fixture compiles authored values, state, relations, code, and retrieval answer into visible SVG", () => {
  const base = fixtureManifest();
  const values = [3, 8, 12, 17, 23, 31, 44, 58, 72] as const;
  const beat = (
    semanticIntent: string,
    compositionFamily: string,
    informationUnits: readonly Record<string, unknown>[],
    textRoles: Readonly<Record<string, string>>,
  ) => ({
    schemaVersion: 1,
    semanticIntent,
    compositionFamily,
    focalAnchor: "instructional-focus",
    continuityKey: "binary-search.interval",
    informationUnits,
    attentionCue: "follow-authored-state",
    motionIntent: ["trace-relationship", "transform-object"],
    textRoles,
    avoidRegions: [],
  });
  const scenes = [
    {
      ...base.scenes[0]!, id: "premium-hook", kind: "presenter-slide", content: {
        title: "Find 44 without checking every value",
        visualBeat: beat("establish", "presenter", [
          { id: "target", role: "hero-value", text: "44" },
          { id: "count", role: "measure", text: "9 candidates" },
          { id: "sequence", role: "ordered-sequence", values },
        ], { eyebrow: "TARGET", hero: "44", support: "9 candidates" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-contract", kind: "definition", content: {
        title: "Sorting turns one comparison into evidence",
        visualBeat: beat("define", "object_stage", [
          { id: "ordered", role: "ordered-sequence", values },
          { id: "middle", role: "comparison", text: "middle = 23" },
          { id: "rule", role: "causal-label", text: "left side < 23" },
        ], { eyebrow: "THE CONTRACT", label: "sorted input" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-worked", kind: "worked-example", content: {
        title: "Watch the interval shrink",
        visualBeat: beat("demonstrate", "worked_example", [
          { id: "values", role: "ordered-sequence", values },
          { id: "target", role: "target", value: 44 },
          { id: "step-one", role: "state", low: 0, middle: 4, high: 8, value: 23 },
          { id: "step-two", role: "state", low: 5, middle: 6, high: 8, value: 44 },
        ], { eyebrow: "FIND 44", markers: "low · mid · high" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-invariant", kind: "execution-trace", content: {
        title: "The invariant survives every cut",
        visualBeat: beat("transform", "data_canvas", [
          { id: "principle", role: "principle", text: "target stays inside" },
          { id: "state-zero", role: "interval", low: 0, high: 8 },
          { id: "state-one", role: "interval", low: 5, high: 8 },
          { id: "state-two", role: "interval", low: 6, high: 6 },
        ], { eyebrow: "INVARIANT", principle: "target stays inside" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-code", kind: "code", content: {
        title: "Three updates are the whole algorithm",
        visualBeat: beat("prove", "document_focus", [
          { id: "loop", role: "code", text: "while low ≤ high" },
          { id: "middle", role: "code", text: "mid = low + (high − low) ÷ 2" },
          { id: "match", role: "code", text: "return mid" },
          { id: "move-low", role: "code", text: "low = mid + 1" },
          { id: "move-high", role: "code", text: "high = mid − 1" },
        ], { eyebrow: "PSEUDOCODE", focus: "low · mid · high" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-absent", kind: "diagram", content: {
        title: "An empty interval proves absence",
        visualBeat: beat("resolve", "diagram", [
          { id: "target", role: "target", value: 50 },
          { id: "first", role: "comparison", middle: 23, relation: "less-than" },
          { id: "second", role: "comparison", middle: 44, relation: "less-than" },
          { id: "third", role: "comparison", middle: 58, relation: "greater-than" },
          { id: "proof", role: "proof-state", low: 7, high: 6, text: "not found" },
        ], { eyebrow: "SEARCH 50", proof: "low 7 > high 6", result: "not found" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-scale", kind: "comparison", content: {
        title: "Halving changes the scale",
        visualBeat: beat("compare", "split_evidence", [
          { id: "population", role: "population", value: 1024 },
          { id: "linear", role: "comparison-value", label: "linear", value: 1024 },
          { id: "binary", role: "comparison-value", label: "binary", value: 10 },
          { id: "formula", role: "formula", text: "O(log n)" },
          { id: "tradeoff", role: "constraint", text: "sort first" },
        ], { hero: "10", counterpoint: "1,024", formula: "O(log n)" }),
      },
    },
    {
      ...base.scenes[0]!, id: "premium-quiz", kind: "quiz", content: {
        title: "Would binary search work here?",
        visualBeat: beat("question", "editorial_type", [
          { id: "question", role: "prompt", text: "binary search?" },
          { id: "unsorted", role: "sequence", values: [8, 3, 17, 12, 44] },
          { id: "answer", role: "answer", text: "NO" },
          { id: "transfer", role: "principle", text: "sort first" },
        ], { eyebrow: "YOUR TURN", answer: "NO", principle: "sort first" }),
      },
    },
  ] as const;

  const specs = new Map(scenes.map((scene) => [scene.id, resolveBuiltinSceneSpec(scene)]));
  const contract = specs.get("premium-contract");
  assert.equal(contract?.content.kind, "definition");
  if (contract?.content.kind !== "definition") throw new Error("expected semantic definition");
  assert.match(contract.content.definition, /3 · 8 · 12 · 17 · 23 · 31 · 44 · 58 · 72/u);
  assert.equal(contract.content.example, "middle = 23 · left side < 23");

  const worked = specs.get("premium-worked");
  assert.equal(worked?.content.kind, "worked-example");
  if (worked?.content.kind !== "worked-example") throw new Error("expected semantic worked example");
  assert.equal(worked.content.problem, "Find 44 · 3 · 8 · 12 · 17 · 23 · 31 · 44 · 58 · 72");
  assert.deepEqual(worked.content.steps.map((step) => step.text), [
    "low 0 · mid 4 = 23 · high 8",
    "low 5 · mid 6 = 44 · high 8",
  ]);
  assert.equal(worked.content.answer, "found 44 at index 6");

  const invariant = specs.get("premium-invariant");
  assert.equal(invariant?.content.kind, "execution-trace");
  if (invariant?.content.kind !== "execution-trace") throw new Error("expected semantic execution trace");
  assert.deepEqual(invariant.content.frames.map((frame) => frame.label), ["[0, 8]", "[5, 8]", "[6, 6]"]);
  assert.deepEqual(invariant.content.frames[2]?.variables, { low: "6", high: "6" });

  const code = specs.get("premium-code");
  assert.equal(code?.content.kind, "code");
  if (code?.content.kind !== "code") throw new Error("expected semantic code");
  assert.deepEqual(code.content.lines.map((line) => line.text), [
    "while low ≤ high", "mid = low + (high − low) ÷ 2", "return mid", "low = mid + 1", "high = mid − 1",
  ]);

  const absent = specs.get("premium-absent");
  assert.equal(absent?.content.kind, "diagram");
  if (absent?.content.kind !== "diagram") throw new Error("expected semantic diagram");
  assert.deepEqual(absent.content.nodes.map((node) => node.label), ["target = 50", "23 < 50", "44 < 50", "58 > 50", "low 7 > high 6 · not found"]);

  const scale = specs.get("premium-scale");
  assert.equal(scale?.content.kind, "comparison");
  if (scale?.content.kind !== "comparison") throw new Error("expected semantic comparison");
  assert.equal(scale.content.left.items.length, 1024);
  assert.equal(scale.content.right.items.length, 10);
  assert.equal(scale.content.left.label, "linear ≤ 1,024");
  assert.equal(scale.content.right.label, "binary ≤ 10");
  assert.equal(scale.content.verdict, "O(log n) · sort first");

  const quiz = specs.get("premium-quiz");
  assert.equal(quiz?.content.kind, "quiz");
  if (quiz?.content.kind !== "quiz") throw new Error("expected semantic quiz");
  assert.equal(quiz.content.question, "8 · 3 · 17 · 12 · 44 · binary search?");
  assert.equal(quiz.content.options[0]?.label, "NO");
  assert.equal(quiz.content.options[0]?.correct, true);
  assert.equal(quiz.content.revealAnswer, true);
  assert.equal(quiz.content.explanation, "sort first");

  const rendered = new Map(scenes.map((scene) => [scene.id, new FrameRenderer().render({ ...base, scenes: [scene] }, 15).svg]));
  for (const value of ["44", "1,024", "10", "8 · 3 · 17 · 12 · 44", "NO", "sort first"]) {
    assert.match([...rendered.values()].join("\n"), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), value);
  }
  assert.match(rendered.get("premium-scale")!, />1024<|>1,024</u);
  assert.match(rendered.get("premium-scale")!, />10</u);
  assert.match(rendered.get("premium-scale")!, /Halving changes the scale/u);
  assert.doesNotMatch(rendered.get("premium-scale")!, />products</u);
  assert.doesNotMatch(rendered.get("premium-scale")!, />operation<|>checks</u);
  assert.doesNotMatch(rendered.get("premium-scale")!, />linear<|>binary</u);
  assert.match(rendered.get("premium-contract")!, />sorted input</u);
  assert.match(rendered.get("premium-contract")!, />middle = 23</u);
  assert.match(rendered.get("premium-contract")!, />left side &lt; 23</u);
  assert.doesNotMatch(rendered.get("premium-contract")!, />Break<|>Solve similar parts<|>Combine</u);
  assert.match(rendered.get("premium-code")!, /mid = low \+ \(high − low\) ÷ 2/u);
  assert.match(rendered.get("premium-absent")!, /low 7 &gt;/u);
  assert.doesNotMatch(rendered.get("premium-quiz")!, /data-answer-state="correct"/u, "the question hold must not reveal the answer");
  const revealedQuiz = new FrameRenderer().render({ ...base, scenes: [scenes.find((scene) => scene.id === "premium-quiz")!] }, 90).svg;
  assert.match(revealedQuiz, /data-answer-state="correct"/u, "the answer is revealed only after the authored question hold");
});

test("authored third-repeat policy permits progressing continuity but breaks stale or incompatible state", () => {
  const base = fixtureManifest();
  const authoredScene = (index: number, continuityKey: string, state: string) => ({
    ...base.scenes[0]!,
    id: `authored-sequence-${index}`,
    kind: "diagram",
    seed: `authored-seed-${index}`,
    content: {
      title: `State ${index}`,
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "transform",
        compositionFamily: "diagram",
        focalAnchor: "active-interval",
        continuityKey,
        informationUnits: [{ id: `state-${index}`, role: "state", text: state }],
        attentionCue: "carry-state-forward",
        motionIntent: ["match-transition", "transform-object"],
        textRoles: { focus: state },
        avoidRegions: [],
      },
    },
  } as const);
  const progressing = [
    authoredScene(1, "binary-search.interval", "[0, 8]"),
    authoredScene(2, "binary-search.interval", "[5, 8]"),
    authoredScene(3, "binary-search.interval", "[6, 6]"),
  ];
  assert.deepEqual([...compileVisualBeatSequence(progressing).values()].map((beat) => beat.compositionFamily), ["diagram", "diagram", "diagram"]);

  const stale = [
    authoredScene(1, "binary-search.interval", "[0, 8]"),
    authoredScene(2, "binary-search.interval", "[0, 8]"),
    authoredScene(3, "binary-search.interval", "[0, 8]"),
  ];
  const staleFamilies = [...compileVisualBeatSequence(stale).values()].map((beat) => beat.compositionFamily);
  assert.deepEqual(staleFamilies.slice(0, 2), ["diagram", "diagram"]);
  assert.notEqual(staleFamilies[2], "diagram");

  const incompatible = [...progressing.slice(0, 2), authoredScene(3, "different.sequence", "[6, 6]")];
  assert.notEqual([...compileVisualBeatSequence(incompatible).values()][2]?.compositionFamily, "diagram");
});

test("renderer fails closed on hostile or malformed authored visual beats", () => {
  const base = fixtureManifest();
  const validBeat = () => ({
    schemaVersion: 1,
    semanticIntent: "demonstrate",
    compositionFamily: "worked_example",
    focalAnchor: "active-interval",
    continuityKey: "binary-search.interval",
    informationUnits: [{ id: "state", role: "state", text: "low 0 · mid 4 · high 8" }],
    attentionCue: "move-markers",
    motionIntent: ["trace-relationship", "transform-object"],
    textRoles: { markers: "low · mid · high" },
    avoidRegions: [{ id: "focus", role: "essential-visual", x: 0.1, y: 0.2, width: 0.8, height: 0.6, priority: "required" }],
  });
  const attacks: readonly ((beat: ReturnType<typeof validBeat>) => void)[] = [
    (beat) => Object.assign(beat, { path: "C:\\Users\\viewer\\scene.json" }),
    (beat) => { beat.informationUnits[0]!.text = "https://tracker.invalid/pixel"; },
    (beat) => { beat.informationUnits[0]!.text = "../private/scene.json"; },
    (beat) => { beat.informationUnits[0]!.text = "C:\\Users\\viewer\\scene.json"; },
    (beat) => { beat.textRoles.markers = "<img src=x onerror=alert(1)>"; },
    (beat) => { beat.motionIntent = ["Date.now"] as typeof beat.motionIntent; },
    (beat) => { beat.avoidRegions[0]!.width = Number.NaN; },
  ];
  for (const [index, attack] of attacks.entries()) {
    const visualBeat = validBeat();
    attack(visualBeat);
    const scene = { ...base.scenes[0]!, id: `hostile-authored-${index}`, content: { title: "Hostile authored beat", visualBeat } };
    assert.throws(() => compileVisualBeatSequence([scene]), /visualBeat|paths|URLs|HTML|bounded finite number/u, `attack ${index}`);
  }
  const recurrenceBeat = validBeat();
  recurrenceBeat.informationUnits[0]!.text = "T(n)=3T(n/2)+O(n)";
  const recurrence = {
    ...base.scenes[0]!,
    id: "legitimate-authored-recurrence",
    kind: "formula",
    content: { title: "Karatsuba recurrence", visualBeat: recurrenceBeat },
  };
  assert.doesNotThrow(() => compileVisualBeatSequence([recurrence]));
  assert.match(new FrameRenderer().render({ ...base, scenes: [recurrence] }, 15).svg, /T\(n\)=3T\(n\/2\)\+O\(n\)/u);
  const conflictingBeat = validBeat();
  const conflicting = {
    ...base.scenes[0]!,
    id: "conflicting-authored-metadata",
    content: { title: "Conflicting authored beat", visualBeat: conflictingBeat },
    metadata: { compositionFamily: "presenter" },
  };
  assert.throws(
    () => compileVisualBeatSequence([conflicting]),
    /does not match lifted compositionFamily metadata/u,
  );
});

test("top caption customization reserves a stable scene band instead of covering content", () => {
  const base = fixtureManifest();
  const manifest = {
    ...base,
    captionDeliveryMode: "burned" as const,
    captionStyle: {
      position: "top" as const,
      style: "solid-panel" as const,
      sizePercent: 110,
      safeInsetPercent: 6,
      maxLines: 2 as const,
      textColor: "#FFF4D6",
      panelColor: "#102033",
      fontFamily: "Atkinson Hyperlegible Next",
      fallbackFamilies: ["Arial", "sans-serif"],
    },
    scenes: [{
      ...base.scenes[0]!,
      captions: [{ id: "safe-top", startTick: 0, endTick: base.scenes[0]!.durationTicks, text: "A caption with its own reserved band." }],
    }],
  };
  const rendered = new FrameRenderer().render(manifest, 15);
  assert.match(rendered.svg, /data-caption-reserved-scene="top"/);
  assert.match(rendered.svg, /data-caption-id="safe-top"/);
  assert.match(rendered.svg, /fill="#102033"/);
  assert.ok(rendered.svg.indexOf("data-caption-reserved-scene") < rendered.svg.indexOf("data-caption-id"));
});

test("sidecar and embedded delivery keep authoritative frames caption-free by default", () => {
  const base = fixtureManifest();
  const renderer = new FrameRenderer();
  for (const mode of [undefined, "sidecar", "embedded"] as const) {
    const manifest = {
      ...base,
      ...(mode ? { captionDeliveryMode: mode } : {}),
      captionStyle: {
        position: "top" as const,
        style: "solid-panel" as const,
        sizePercent: 100,
        safeInsetPercent: 5,
        maxLines: 2 as const,
        textColor: "#ffffff",
        panelColor: "#151827",
        fontFamily: "Atkinson Hyperlegible Next",
        fallbackFamilies: ["Arial", "sans-serif"],
      },
    };
    const rendered = renderer.render(manifest, 15);
    assert.doesNotMatch(rendered.svg, /data-caption-id=/, String(mode ?? "missing"));
    assert.doesNotMatch(rendered.svg, /data-caption-reserved-scene=/, String(mode ?? "missing"));
    assert.doesNotMatch(rendered.svg, /What if one multiplication could simply disappear/, String(mode ?? "missing"));
  }
});

test("unknown kinds and unsupported preview frame rates retain the inert fixture fallback", () => {
  const base = fixtureManifest(fixtureTarget({ frameRate: { numerator: 2, denominator: 1 } }));
  const unknownScene = { ...base.scenes[0]!, kind: "plugin:unknown/card" };
  assert.equal(resolveBuiltinSceneSpec(unknownScene), undefined);
  const rendered = new FrameRenderer().render({ ...base, scenes: [unknownScene] }, 1);
  assert.doesNotMatch(rendered.svg, /data-scene-kind=/);
  assert.match(rendered.svg, /ALYSTRIA \/ SCENE-TITLE/);
});

test("same frame is byte deterministic and adjacent frames evolve", () => {
  const manifest = fixtureManifest();
  const renderer = new FrameRenderer({ verifyRepeatability: true });
  const first = renderer.render(manifest, 45);
  const repeated = renderer.render(manifest, 45);
  const adjacent = renderer.render(manifest, 46);
  assert.equal(first.svg, repeated.svg);
  assert.equal(first.contentHash, repeated.contentHash);
  assert.notEqual(first.contentHash, adjacent.contentHash);
  assert.match(first.html, /data-render-ready="true"/);
});

test("preview and final use the same component path", () => {
  assert.match(new FrameRenderer().verifyPreviewFinalParity(fixtureManifest(), 60), /^[0-9a-f]{64}$/);
});

test("responsive compilation changes composition instead of cropping", () => {
  const renderer = new FrameRenderer();
  const wide = renderer.render(fixtureManifest(fixtureTarget()), 30);
  const tall = renderer.render(fixtureManifest(fixtureTarget({ name: "portrait", width: 720, height: 1280 })), 30);
  assert.match(wide.svg, /width="1280" height="720"/);
  assert.match(tall.svg, /width="720" height="1280"/);
  assert.notEqual(wide.contentHash, tall.contentHash);
});

test("small preview targets keep readable type and anchor the footer inside the safe area", () => {
  const target = fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 2, denominator: 1 } });
  const rendered = new FrameRenderer().render(fixtureManifest(target), 1);
  assert.match(rendered.svg, /font-size:24px/);
  assert.match(rendered.svg, /font-size="14"/);
  assert.match(rendered.svg, /<text x="304" y="171" text-anchor="end"[^>]*>ALYSTRIA \/ SCENE-TITLE<\/text>/);
  assert.doesNotMatch(rendered.svg, /translate\([^)]*-168/);
});

test("renderer rejects wall clock/random access from scene code", () => {
  const renderer = new FrameRenderer({ sceneRenderers: { forbidden: () => `<text>${Math.random()}</text>` } });
  const manifest = fixtureManifest();
  const forbidden = { ...manifest, scenes: [{ ...(manifest.scenes[0] as NonNullable<(typeof manifest.scenes)[0]>), kind: "forbidden" }] };
  assert.throws(() => renderer.render(forbidden, 0), /Math.random/);
});

test("renderer rejects executable or remote fragments from scene code", () => {
  const manifest = fixtureManifest();
  const unsafe = { ...manifest, scenes: [{ ...(manifest.scenes[0] as NonNullable<(typeof manifest.scenes)[0]>), kind: "unsafe" }] };
  assert.throws(() => new FrameRenderer({ sceneRenderers: { unsafe: () => "<script>alert(1)</script>" } }).render(unsafe, 0), /executable or remote/);
  assert.throws(() => new FrameRenderer({ sceneRenderers: { unsafe: () => '<image href="https://tracker.example/image.png"/>' } }).render(unsafe, 0), /executable or remote/);
});

test("out-of-range frames fail clearly", () => {
  const manifest = fixtureManifest();
  assert.equal(totalFrames(manifest), 150);
  assert.throws(() => new FrameRenderer().render(manifest, 150), /outside manifest duration/);
});
