# @alystria/scenes

Declarative, deterministic scene rendering for Alystria Studio. The package owns:

- the complete built-in scene catalog and runtime registry;
- responsive landscape, portrait, square, and custom-target compilation;
- semantic regions, caption avoid zones, accessibility descriptions, and reduced-motion behavior;
- explicit tick-driven choreography on a 240,000 tick timebase;
- local-only asset resolution and seeded visual variation;
- scene preflight, linting, plugin namespace validation, and specimen fixtures.

Scene data never contains executable React code. Persisted data selects a registered kind; the trusted runtime registry supplies the renderer. Renderers emit SVG and accept only explicit frame ticks, theme data, and trusted local asset handles.

```tsx
const compiled = compileScene(spec, { width: 1920, height: 1080, fps: 30 });
const result = preflightScene(spec, { width: 1920, height: 1080, fps: 30 });

if (result.ok) {
  root.render(<SceneView scene={compiled} frame={{ tick: 480_000, reducedMotion: false }} />);
}
```

`SPECIMEN_SCENES` contains one self-contained fixture for every built-in family. They intentionally use no remote media.
