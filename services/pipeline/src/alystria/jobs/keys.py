"""Canonical action keys and transitive invalidation graph."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from alystria.project.database import transaction
from alystria.project.models import utc_now


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


@dataclass(frozen=True, slots=True)
class ActionKey:
    kind: str
    implementation_version: str
    parameters: dict[str, Any]
    input_hashes: tuple[str, ...] = ()
    provider: str = "local"
    model_revision: str = "none"
    prompt_version: str = "none"
    schema_version: str = "1"
    toolchain_version: str = "1"
    seed: int = 0

    def payload(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "implementationVersion": self.implementation_version,
            "parameters": self.parameters,
            "inputHashes": list(self.input_hashes),
            "provider": self.provider,
            "modelRevision": self.model_revision,
            "promptVersion": self.prompt_version,
            "schemaVersion": self.schema_version,
            "toolchainVersion": self.toolchain_version,
            "seed": self.seed,
        }

    @property
    def digest(self) -> str:
        return hashlib.sha256(canonical_json(self.payload()).encode()).hexdigest()


class DependencyGraph:
    def __init__(self, connection: Any, project_id: str) -> None:
        self.connection = connection
        self.project_id = project_id

    def record_node(
        self,
        logical_key: str,
        fingerprint: str,
        *,
        artifact_hash: str | None = None,
        upstream_keys: list[str] | None = None,
    ) -> None:
        if not logical_key or not fingerprint:
            raise ValueError("Dependency nodes require a logical key and fingerprint")
        with transaction(self.connection):
            self.connection.execute(
                """INSERT INTO dependency_nodes(project_id,logical_key,fingerprint,state,artifact_hash,updated_at)
                VALUES(?,?,?,'CURRENT',?,?)
                ON CONFLICT(project_id,logical_key) DO UPDATE SET
                    fingerprint=excluded.fingerprint,state='CURRENT',
                    artifact_hash=excluded.artifact_hash,updated_at=excluded.updated_at""",
                (self.project_id, logical_key, fingerprint, artifact_hash, utc_now()),
            )
            self.connection.execute(
                "DELETE FROM dependency_edges WHERE project_id=? AND downstream_key=?",
                (self.project_id, logical_key),
            )
            for upstream in upstream_keys or []:
                if upstream == logical_key:
                    raise ValueError("A dependency node cannot depend on itself")
                self.connection.execute(
                    "INSERT INTO dependency_edges(project_id,upstream_key,downstream_key) VALUES(?,?,?)",
                    (self.project_id, upstream, logical_key),
                )

    def invalidate_from(self, logical_keys: list[str]) -> list[str]:
        if not logical_keys:
            return []
        placeholders = ",".join("?" for _ in logical_keys)
        parameters: list[Any] = [self.project_id, *logical_keys, self.project_id]
        query = f"""WITH RECURSIVE affected(key) AS (
            SELECT logical_key FROM dependency_nodes
             WHERE project_id=? AND logical_key IN ({placeholders})
            UNION
            SELECT edge.downstream_key FROM dependency_edges edge
              JOIN affected ON edge.upstream_key=affected.key
             WHERE edge.project_id=?
        ) SELECT DISTINCT key FROM affected ORDER BY key"""
        affected = [row["key"] for row in self.connection.execute(query, parameters)]
        if affected:
            with transaction(self.connection):
                self.connection.executemany(
                    "UPDATE dependency_nodes SET state='STALE',updated_at=? WHERE project_id=? AND logical_key=?",
                    [(utc_now(), self.project_id, key) for key in affected],
                )
        return affected

    def stale_nodes(self) -> list[str]:
        return [
            row["logical_key"]
            for row in self.connection.execute(
                "SELECT logical_key FROM dependency_nodes WHERE project_id=? AND state='STALE' ORDER BY logical_key",
                (self.project_id,),
            )
        ]
