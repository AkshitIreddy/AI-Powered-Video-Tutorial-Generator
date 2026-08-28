#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GENERATOR_VERSION = 1;
const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const schemaDirectory = resolve(packageDirectory, "schema");

const outputPaths = {
  manifest: resolve(packageDirectory, "generated/schema-manifest.json"),
  typescript: resolve(packageDirectory, "src/generated/schemaRegistry.ts"),
  python: resolve(
    repositoryDirectory,
    "services/pipeline/src/alystria/contracts/generated_schema_registry.py",
  ),
  rust: resolve(
    repositoryDirectory,
    "apps/desktop/src-tauri/src/generated/schema_registry.rs",
  ),
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function collectRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value !== null && typeof value === "object") {
    if (typeof value.$ref === "string") refs.add(value.$ref);
    for (const nested of Object.values(value)) collectRefs(nested, refs);
  }
  return [...refs].sort();
}

function schemaTypes(value) {
  if (typeof value.type === "string") return [value.type];
  if (Array.isArray(value.type)) return [...value.type].sort();
  if ("$ref" in value) return ["reference"];
  if ("const" in value) return ["const"];
  if ("enum" in value) return ["enum"];
  if ("oneOf" in value || "anyOf" in value || "allOf" in value) return ["composition"];
  return ["unspecified"];
}

function definitionBinding(name, value) {
  return {
    name,
    types: schemaTypes(value),
    required: [...(value.required ?? [])].sort(),
    properties: Object.keys(value.properties ?? {}).sort(),
    refs: collectRefs(value),
  };
}

function decodePointerSegment(segment) {
  return decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveJsonPointer(document, fragment, sourceDescription) {
  if (fragment === "" || fragment === "#") return document;
  if (!fragment.startsWith("#/")) {
    throw new Error(`Unsupported JSON Schema reference fragment in ${sourceDescription}: ${fragment}`);
  }
  let current = document;
  for (const rawSegment of fragment.slice(2).split("/")) {
    const segment = decodePointerSegment(rawSegment);
    if (current === null || typeof current !== "object" || !(segment in current)) {
      throw new Error(`Unresolved JSON Schema reference in ${sourceDescription}: ${fragment}`);
    }
    current = current[segment];
  }
  return current;
}

function validateReferences(documents) {
  for (const [fileName, document] of documents) {
    for (const reference of collectRefs(document)) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(reference)) {
        throw new Error(`Remote references are not allowed in canonical contracts (${fileName}: ${reference})`);
      }
      const hashIndex = reference.indexOf("#");
      const referencedFile = hashIndex === -1 ? reference : reference.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? "" : reference.slice(hashIndex);
      const targetFile = referencedFile || fileName;
      const target = documents.get(targetFile);
      if (!target) throw new Error(`Unknown schema file referenced by ${fileName}: ${reference}`);
      resolveJsonPointer(target, fragment, `${fileName} -> ${reference}`);
    }
  }
}

async function buildManifest() {
  const fileNames = (await readdir(schemaDirectory))
    .filter((fileName) => fileName.endsWith(".schema.json"))
    .sort();
  if (fileNames.length === 0) throw new Error("No canonical JSON Schema files were found");

  const documents = new Map();
  for (const fileName of fileNames) {
    const document = JSON.parse(await readFile(resolve(schemaDirectory, fileName), "utf8"));
    if (document.$schema !== JSON_SCHEMA_DRAFT) {
      throw new Error(`${fileName} must declare JSON Schema 2020-12`);
    }
    if (typeof document.$id !== "string" || !document.$id.startsWith("https://")) {
      throw new Error(`${fileName} must declare an absolute HTTPS $id`);
    }
    documents.set(fileName, document);
  }
  validateReferences(documents);

  const ids = new Set();
  const schemas = [...documents].map(([fileName, document]) => {
    if (ids.has(document.$id)) throw new Error(`Duplicate canonical schema $id: ${document.$id}`);
    ids.add(document.$id);
    const key = fileName.replace(/\.schema\.json$/u, "");
    const definitions = Object.entries(document.$defs ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => definitionBinding(name, value));
    return {
      key,
      file: fileName,
      id: document.$id,
      title: typeof document.title === "string" ? document.title : key,
      sha256: sha256(canonicalJson(document)),
      root: definitionBinding("$root", document),
      definitions,
    };
  });
  const contractSetSha256 = sha256(schemas.map((schema) => `${schema.file}:${schema.sha256}`).join("\n"));
  return {
    generatorVersion: GENERATOR_VERSION,
    draft: JSON_SCHEMA_DRAFT,
    contractSetSha256,
    schemas,
  };
}

function quoted(value) {
  return JSON.stringify(value);
}

function tsArray(values) {
  return `[${values.map(quoted).join(", ")}]`;
}

function renderTypeScript(manifest) {
  const bindings = manifest.schemas.map((schema) => `  {
    key: ${quoted(schema.key)},
    file: ${quoted(schema.file)},
    id: ${quoted(schema.id)},
    title: ${quoted(schema.title)},
    sha256: ${quoted(schema.sha256)},
    root: { name: "$root", types: ${tsArray(schema.root.types)}, required: ${tsArray(schema.root.required)}, properties: ${tsArray(schema.root.properties)}, refs: ${tsArray(schema.root.refs)} },
    definitions: [
${schema.definitions.map((definition) => `      { name: ${quoted(definition.name)}, types: ${tsArray(definition.types)}, required: ${tsArray(definition.required)}, properties: ${tsArray(definition.properties)}, refs: ${tsArray(definition.refs)} },`).join("\n")}
    ],
  },`).join("\n");
  const ids = manifest.schemas.map((schema) => `  ${quoted(schema.key)}: ${quoted(schema.id)},`).join("\n");
  return `// @generated by packages/contracts/scripts/generate-bindings.mjs; do not edit.
// Canonical input: packages/contracts/schema/*.schema.json

export interface GeneratedDefinitionBinding {
  readonly name: string;
  readonly types: readonly string[];
  readonly required: readonly string[];
  readonly properties: readonly string[];
  readonly refs: readonly string[];
}

export interface GeneratedSchemaBinding {
  readonly key: string;
  readonly file: string;
  readonly id: string;
  readonly title: string;
  readonly sha256: string;
  readonly root: GeneratedDefinitionBinding;
  readonly definitions: readonly GeneratedDefinitionBinding[];
}

export const GENERATED_CONTRACT_VERSION = ${manifest.generatorVersion} as const;
export const JSON_SCHEMA_DRAFT = ${quoted(manifest.draft)} as const;
export const CONTRACT_SET_SHA256 = ${quoted(manifest.contractSetSha256)} as const;

export const SCHEMA_IDS = Object.freeze({
${ids}
} as const);

export const GENERATED_SCHEMAS = Object.freeze([
${bindings}
] as const satisfies readonly GeneratedSchemaBinding[]);

const schemasById = new Map<string, GeneratedSchemaBinding>(
  GENERATED_SCHEMAS.map((schema) => [schema.id, schema]),
);

export function generatedSchemaById(schemaId: string): GeneratedSchemaBinding | undefined {
  return schemasById.get(schemaId);
}

export function generatedDefinition(schemaId: string, definitionName: string): GeneratedDefinitionBinding | undefined {
  return generatedSchemaById(schemaId)?.definitions.find((definition) => definition.name === definitionName);
}
`;
}

function pyTuple(values) {
  if (values.length === 0) return "()";
  return `(${values.map(quoted).join(", ")}${values.length === 1 ? "," : ""})`;
}

function renderPython(manifest) {
  const schemas = manifest.schemas.map((schema) => `    SchemaBinding(
        key=${quoted(schema.key)},
        file=${quoted(schema.file)},
        id=${quoted(schema.id)},
        title=${quoted(schema.title)},
        sha256=${quoted(schema.sha256)},
        root=DefinitionBinding(name="$root", types=${pyTuple(schema.root.types)}, required=${pyTuple(schema.root.required)}, properties=${pyTuple(schema.root.properties)}, refs=${pyTuple(schema.root.refs)}),
        definitions=(
${schema.definitions.map((definition) => `            DefinitionBinding(name=${quoted(definition.name)}, types=${pyTuple(definition.types)}, required=${pyTuple(definition.required)}, properties=${pyTuple(definition.properties)}, refs=${pyTuple(definition.refs)}),`).join("\n")}
        ),
    ),`).join("\n");
  const ids = manifest.schemas.map((schema) => `    ${quoted(schema.key)}: ${quoted(schema.id)},`).join("\n");
  return `# @generated by packages/contracts/scripts/generate-bindings.mjs; do not edit.
# Canonical input: packages/contracts/schema/*.schema.json

from dataclasses import dataclass
from types import MappingProxyType
from typing import Final


@dataclass(frozen=True, slots=True)
class DefinitionBinding:
    name: str
    types: tuple[str, ...]
    required: tuple[str, ...]
    properties: tuple[str, ...]
    refs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SchemaBinding:
    key: str
    file: str
    id: str
    title: str
    sha256: str
    root: DefinitionBinding
    definitions: tuple[DefinitionBinding, ...]


GENERATED_CONTRACT_VERSION: Final = ${manifest.generatorVersion}
JSON_SCHEMA_DRAFT: Final = ${quoted(manifest.draft)}
CONTRACT_SET_SHA256: Final = ${quoted(manifest.contractSetSha256)}
SCHEMA_IDS: Final = MappingProxyType({
${ids}
})

SCHEMAS: Final = (
${schemas}
)
SCHEMAS_BY_ID: Final = MappingProxyType({schema.id: schema for schema in SCHEMAS})


def schema_by_id(schema_id: str) -> SchemaBinding | None:
    return SCHEMAS_BY_ID.get(schema_id)


def definition(schema_id: str, definition_name: str) -> DefinitionBinding | None:
    schema = schema_by_id(schema_id)
    if schema is None:
        return None
    return next((item for item in schema.definitions if item.name == definition_name), None)
`;
}

function rustString(value) {
  return JSON.stringify(value);
}

function rustSlice(values) {
  return `&[${values.map(rustString).join(", ")}]`;
}

function rustConstant(value) {
  return value.replaceAll(/[^a-z0-9]+/giu, "_").replaceAll(/^_|_$/gu, "").toUpperCase();
}

function renderRust(manifest) {
  const definitionConstants = [];
  const schemaEntries = [];
  for (const schema of manifest.schemas) {
    const constant = `${rustConstant(schema.key)}_DEFINITIONS`;
    definitionConstants.push(`#[rustfmt::skip]
const ${constant}: &[DefinitionBinding] = &[
${schema.definitions.map((definition) => `    DefinitionBinding { name: ${rustString(definition.name)}, types: ${rustSlice(definition.types)}, required: ${rustSlice(definition.required)}, properties: ${rustSlice(definition.properties)}, refs: ${rustSlice(definition.refs)} },`).join("\n")}
];`);
    schemaEntries.push(`    SchemaBinding {
        key: ${rustString(schema.key)},
        file: ${rustString(schema.file)},
        id: ${rustString(schema.id)},
        title: ${rustString(schema.title)},
        sha256: ${rustString(schema.sha256)},
        root: DefinitionBinding { name: "$root", types: ${rustSlice(schema.root.types)}, required: ${rustSlice(schema.root.required)}, properties: ${rustSlice(schema.root.properties)}, refs: ${rustSlice(schema.root.refs)} },
        definitions: ${constant},
    },`);
  }
  const idConstants = manifest.schemas.map((schema) => `pub const ${rustConstant(schema.key)}_SCHEMA_ID: &str = ${rustString(schema.id)};`).join("\n");
  return `// @generated by packages/contracts/scripts/generate-bindings.mjs; do not edit.
// Canonical input: packages/contracts/schema/*.schema.json

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefinitionBinding {
    pub name: &'static str,
    pub types: &'static [&'static str],
    pub required: &'static [&'static str],
    pub properties: &'static [&'static str],
    pub refs: &'static [&'static str],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchemaBinding {
    pub key: &'static str,
    pub file: &'static str,
    pub id: &'static str,
    pub title: &'static str,
    pub sha256: &'static str,
    pub root: DefinitionBinding,
    pub definitions: &'static [DefinitionBinding],
}

pub const GENERATED_CONTRACT_VERSION: u32 = ${manifest.generatorVersion};
pub const JSON_SCHEMA_DRAFT: &str = ${rustString(manifest.draft)};
#[rustfmt::skip]
pub const CONTRACT_SET_SHA256: &str = ${rustString(manifest.contractSetSha256)};
${idConstants}

${definitionConstants.join("\n\n")}

#[rustfmt::skip]
pub const SCHEMAS: &[SchemaBinding] = &[
${schemaEntries.join("\n")}
];

#[must_use]
pub fn schema_by_id(schema_id: &str) -> Option<&'static SchemaBinding> {
    SCHEMAS.iter().find(|schema| schema.id == schema_id)
}

#[must_use]
pub fn definition(schema_id: &str, definition_name: &str) -> Option<&'static DefinitionBinding> {
    schema_by_id(schema_id)?
        .definitions
        .iter()
        .find(|definition| definition.name == definition_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generated_registry_has_unique_ids_and_valid_hashes() {
        let ids = SCHEMAS
            .iter()
            .map(|schema| schema.id)
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), SCHEMAS.len());
        assert!(SCHEMAS.iter().all(|schema| schema.sha256.len() == 64));
        assert_eq!(CONTRACT_SET_SHA256.len(), 64);
    }

    #[test]
    fn generated_definition_lookup_is_usable() {
        assert_eq!(
            definition(PROJECT_SCHEMA_ID, "ProjectManifest").map(|item| item.name),
            Some("ProjectManifest")
        );
    }
}
`;
}

function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function expectedOutputs() {
  const manifest = await buildManifest();
  return new Map([
    [outputPaths.manifest, renderManifest(manifest)],
    [outputPaths.typescript, renderTypeScript(manifest)],
    [outputPaths.python, renderPython(manifest)],
    [outputPaths.rust, renderRust(manifest)],
  ]);
}

async function check(outputs) {
  const drift = [];
  for (const [path, expected] of outputs) {
    let actual;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      actual = undefined;
    }
    if (actual !== expected) drift.push(relative(repositoryDirectory, path));
  }
  if (drift.length > 0) {
    throw new Error(
      `Generated contract bindings are stale:\n${drift.map((path) => `  - ${path}`).join("\n")}\nRun: pnpm contracts:generate`,
    );
  }
  process.stdout.write(`Contract bindings are current (${outputs.size} generated files).\n`);
}

async function write(outputs) {
  const { mkdir } = await import("node:fs/promises");
  for (const [path, contents] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    process.stdout.write(`Generated ${relative(repositoryDirectory, path)}\n`);
  }
}

const mode = process.argv[2] ?? "--write";
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Usage: generate-bindings.mjs [--write|--check]");
}
const outputs = await expectedOutputs();
if (mode === "--check") await check(outputs);
else await write(outputs);
