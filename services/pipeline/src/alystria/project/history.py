"""Durable undo/redo navigation over immutable project revisions.

Restore never rewrites an existing revision.  Navigation creates a new restore
revision and persists the logical undo/redo stacks separately so redo survives
an application restart and remains meaningful even though restore revisions
have ordinary append-only parent links.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from .database import transaction
from .models import Revision, utc_now
from .store import ProjectStore


@dataclass(frozen=True, slots=True)
class HistoryState:
    head_revision_id: str
    undo_revision_ids: tuple[str, ...]
    redo_revision_ids: tuple[str, ...]

    @property
    def can_undo(self) -> bool:
        return bool(self.undo_revision_ids)

    @property
    def can_redo(self) -> bool:
        return bool(self.redo_revision_ids)

    def to_dict(self) -> dict[str, Any]:
        return {
            "headRevisionId": self.head_revision_id,
            "canUndo": self.can_undo,
            "canRedo": self.can_redo,
            "undoDepth": len(self.undo_revision_ids),
            "redoDepth": len(self.redo_revision_ids),
        }


class ProjectHistory:
    def __init__(self, store: ProjectStore) -> None:
        self.store = store

    def state(self) -> HistoryState:
        head = self.store.head_revision()
        if head is None:
            raise ValueError("Project has no revision history")
        row = self.store.connection.execute(
            "SELECT * FROM revision_navigation WHERE singleton=1"
        ).fetchone()
        if row is None or row["head_revision_id"] != head.revision_id:
            state = self._state_from_ancestry(head)
            self._persist(state)
            return state
        return HistoryState(
            head.revision_id,
            self._decode_stack(row["undo_stack_json"]),
            self._decode_stack(row["redo_stack_json"]),
        )

    def record_new_revision(self, previous_head_id: str, revision: Revision) -> HistoryState:
        """Record an edit/import made through the desktop project service.

        A new edit after undo deliberately clears redo, matching familiar
        editor semantics while preserving every immutable revision.
        """

        row = self.store.connection.execute(
            "SELECT * FROM revision_navigation WHERE singleton=1"
        ).fetchone()
        if row is not None and row["head_revision_id"] == previous_head_id:
            undo = [*self._decode_stack(row["undo_stack_json"]), previous_head_id]
        else:
            previous = self.store.get_revision(previous_head_id)
            undo = [*self._state_from_ancestry(previous).undo_revision_ids, previous_head_id]
        state = HistoryState(revision.revision_id, tuple(undo), ())
        self._persist(state)
        return state

    def move(
        self,
        direction: Literal["undo", "redo"],
        *,
        expected_head: str,
    ) -> tuple[Revision, HistoryState]:
        state = self.state()
        if state.head_revision_id != expected_head:
            raise ValueError(
                f"Expected head {expected_head}, but current head is {state.head_revision_id}"
            )
        undo = list(state.undo_revision_ids)
        redo = list(state.redo_revision_ids)
        if direction == "undo":
            if not undo:
                raise ValueError("No earlier project revision is available to undo")
            target = undo.pop()
            redo.append(state.head_revision_id)
        else:
            if not redo:
                raise ValueError("No restored project revision is available to redo")
            target = redo.pop()
            undo.append(state.head_revision_id)
        revision = self.store.restore(
            target,
            message=f"{direction.title()} to {target}",
        )
        next_state = HistoryState(revision.revision_id, tuple(undo), tuple(redo))
        self._persist(next_state)
        return revision, next_state

    def _state_from_ancestry(self, head: Revision) -> HistoryState:
        ancestry: list[str] = []
        seen = {head.revision_id}
        cursor = head
        while cursor.parent_revision_id is not None:
            if cursor.parent_revision_id in seen:
                raise ValueError("Project revision history contains a cycle")
            seen.add(cursor.parent_revision_id)
            ancestry.append(cursor.parent_revision_id)
            cursor = self.store.get_revision(cursor.parent_revision_id)
        ancestry.reverse()
        return HistoryState(head.revision_id, tuple(ancestry), ())

    def _persist(self, state: HistoryState) -> None:
        with transaction(self.store.connection):
            self.store.connection.execute(
                """INSERT INTO revision_navigation(
                    singleton,head_revision_id,undo_stack_json,redo_stack_json,updated_at
                ) VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET
                    head_revision_id=excluded.head_revision_id,
                    undo_stack_json=excluded.undo_stack_json,
                    redo_stack_json=excluded.redo_stack_json,
                    updated_at=excluded.updated_at""",
                (
                    state.head_revision_id,
                    json.dumps(list(state.undo_revision_ids), separators=(",", ":")),
                    json.dumps(list(state.redo_revision_ids), separators=(",", ":")),
                    utc_now(),
                ),
            )

    @staticmethod
    def _decode_stack(value: str) -> tuple[str, ...]:
        decoded = json.loads(value)
        if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
            raise ValueError("Invalid durable revision navigation state")
        return tuple(decoded)
