import { describe, expect, it } from "vitest";
import {
  CONTRACT_SET_SHA256,
  GENERATED_SCHEMAS,
  JSON_SCHEMA_DRAFT,
  SCHEMA_IDS,
  generatedDefinition,
  generatedSchemaById,
} from "../src/generated/schemaRegistry.js";

describe("generated cross-language schema registry", () => {
  it("exposes the canonical JSON Schema 2020-12 set", () => {
    expect(JSON_SCHEMA_DRAFT).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(CONTRACT_SET_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(GENERATED_SCHEMAS.map((schema) => schema.key)).toEqual([
      "common",
      "execution",
      "media",
      "project",
      "research",
      "storyboard",
    ]);
    expect(new Set(GENERATED_SCHEMAS.map((schema) => schema.id)).size).toBe(
      GENERATED_SCHEMAS.length,
    );
  });

  it("supports schema and structural definition lookup", () => {
    expect(generatedSchemaById(SCHEMA_IDS.project)?.file).toBe("project.schema.json");
    expect(generatedDefinition(SCHEMA_IDS.project, "ProjectManifest")).toEqual(
      expect.objectContaining({
        name: "ProjectManifest",
        types: ["object"],
        properties: expect.arrayContaining(["format", "projectId", "schemaVersion"]),
      }),
    );
    expect(generatedDefinition(SCHEMA_IDS.project, "MissingDefinition")).toBeUndefined();
  });
});
