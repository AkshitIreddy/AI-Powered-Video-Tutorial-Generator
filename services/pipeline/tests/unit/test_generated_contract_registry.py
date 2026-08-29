from alystria.contracts import (
    CONTRACT_SET_SHA256,
    JSON_SCHEMA_DRAFT,
    SCHEMA_IDS,
    SCHEMAS,
    definition,
    schema_by_id,
)


def test_generated_registry_exposes_canonical_contract_set() -> None:
    assert JSON_SCHEMA_DRAFT == "https://json-schema.org/draft/2020-12/schema"
    assert len(CONTRACT_SET_SHA256) == 64
    assert [schema.key for schema in SCHEMAS] == [
        "common",
        "execution",
        "media",
        "project",
        "research",
        "starter-kit",
        "storyboard",
    ]
    assert len({schema.id for schema in SCHEMAS}) == len(SCHEMAS)


def test_generated_registry_supports_structural_lookup() -> None:
    project = schema_by_id(SCHEMA_IDS["project"])
    assert project is not None
    assert project.file == "project.schema.json"

    manifest = definition(project.id, "ProjectManifest")
    assert manifest is not None
    assert manifest.types == ("object",)
    assert "projectId" in manifest.properties
    assert definition(project.id, "MissingDefinition") is None
