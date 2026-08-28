import { createElement, type ComponentType } from "react";
import { builtinSceneRegistry } from "./registry.js";
import type { SceneRegistry, SceneRendererProps } from "./types.js";

export interface SceneViewProps extends SceneRendererProps {
  readonly registry?: SceneRegistry;
}

export function SceneView({ registry = builtinSceneRegistry, ...props }: SceneViewProps) {
  const definition = registry.get(props.scene.spec.content.kind);
  if (!definition) throw new Error(`No renderer registered for scene kind ${props.scene.spec.content.kind}.`);
  const Renderer = definition.renderer as ComponentType<SceneRendererProps>;
  return createElement(Renderer, props);
}
