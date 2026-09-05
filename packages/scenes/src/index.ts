export { SceneView, type SceneViewProps } from "./SceneView.js";
export {
  compileVisualBeatSequence,
  authoredSemanticScene,
  resolveBuiltinSceneSpec,
  roleMatches,
  targetAwareInformationLabel,
  unitText,
  type AuthoredNarrationTiming,
  type AuthoredResolvedScene,
  type AuthoredSceneVisualAssetReference,
  type AuthoredSemanticScene,
  type AuthoredVisualInformationUnit,
  type VisualBeat,
  type VisualBeatAvoidRegion,
} from "./authoring.js";
export { animationStyle, standardChoreography, staggeredReveal, trackValue } from "./choreography.js";
export { compileScene, lintScene, preflightScene } from "./compiler.js";
export { createLayoutMetrics, targetProfile } from "./layout.js";
export { commonSceneBodyRect, createSceneLayoutManifest, layoutSlot, SCENE_LAYOUT_COMPILER_VERSION } from "./layout-manifest.js";
export { createPresenterLayout, presenterLayoutFromBody, type PresenterLayout, type PresenterPlacement } from "./presenter-layout.js";
export { createSceneRegistry, validateScenePlugin } from "./plugins.js";
export { PRECISION_THEME } from "./primitives.js";
export { SeededRandom, stableHash, stableHashNumber } from "./random.js";
export { builtinSceneDefinitions, builtinSceneRegistry } from "./registry.js";
export { SPECIMEN_SCENES, SPECIMENS_BY_KIND, specimenFor } from "./specimens.js";
export { sceneSpecFromStoryboard, type AuthoredStoryboardScene, type StoryboardSceneSpecOptions } from "./storyboard.js";
export * from "./types.js";
