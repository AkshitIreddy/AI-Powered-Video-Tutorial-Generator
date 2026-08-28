import type { Diagnostic, SceneDefinition, SceneKind, ScenePlugin, SceneRegistry } from "./types.js";
import { builtinSceneDefinitions } from "./registry.js";

const PLUGIN_ID = /^[a-z][a-z0-9-]{2,62}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateScenePlugin(plugin: ScenePlugin): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!PLUGIN_ID.test(plugin.manifest.id)) diagnostics.push({ code: "scene.plugin.id", severity: "error", message: "Plugin ID must be a lowercase slug between 3 and 63 characters.", path: "manifest.id" });
  if (!VERSION.test(plugin.manifest.version)) diagnostics.push({ code: "scene.plugin.version", severity: "error", message: "Plugin version must be valid SemVer.", path: "manifest.version" });
  if (plugin.manifest.apiVersion !== "2") diagnostics.push({ code: "scene.plugin.api-version", severity: "error", message: "Only scene plugin API version 2 is supported.", path: "manifest.apiVersion" });
  if (!plugin.manifest.license.trim()) diagnostics.push({ code: "scene.plugin.license", severity: "error", message: "Plugins must declare a license.", path: "manifest.license" });
  if (plugin.manifest.capabilities.some((capability) => capability !== "render-svg" && capability !== "asset-read")) diagnostics.push({ code: "scene.plugin.capability", severity: "error", message: "Plugin declares an unsupported capability.", path: "manifest.capabilities" });
  const expectedPrefix = `plugin:${plugin.manifest.id}/`;
  const seen = new Set<string>();
  for (const definition of plugin.definitions) {
    if (!definition.kind.startsWith(expectedPrefix)) diagnostics.push({ code: "scene.plugin.kind.namespace", severity: "error", message: `Scene kind ${definition.kind} must begin with ${expectedPrefix}.`, path: "definitions" });
    if (seen.has(definition.kind)) diagnostics.push({ code: "scene.plugin.kind.duplicate", severity: "error", message: `Scene kind ${definition.kind} is duplicated.`, path: "definitions" });
    seen.add(definition.kind);
  }
  return diagnostics;
}

export function createSceneRegistry(plugins: readonly ScenePlugin[] = []): { readonly registry: SceneRegistry; readonly diagnostics: readonly Diagnostic[] } {
  const definitions = new Map<SceneKind, SceneDefinition<any>>(builtinSceneDefinitions.map((definition) => [definition.kind, definition]));
  const diagnostics: Diagnostic[] = [];
  for (const plugin of plugins) {
    const pluginDiagnostics = validateScenePlugin(plugin);
    diagnostics.push(...pluginDiagnostics);
    if (pluginDiagnostics.some((diagnostic) => diagnostic.severity === "error")) continue;
    for (const definition of plugin.definitions) {
      if (definitions.has(definition.kind)) diagnostics.push({ code: "scene.plugin.kind.collision", severity: "error", message: `Scene kind ${definition.kind} is already registered.`, path: "definitions" });
      else definitions.set(definition.kind, definition);
    }
  }
  const registry: SceneRegistry = {
    definitions,
    get: (kind) => definitions.get(kind),
    has: (kind) => definitions.has(kind),
    list: () => [...definitions.values()],
  };
  return { registry, diagnostics };
}
