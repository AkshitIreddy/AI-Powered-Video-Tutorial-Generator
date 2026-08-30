"""Newline-delimited JSON IPC with stable success/error envelopes."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any, TextIO

from .project.errors import ProjectError
from .providers import ProviderFailure
from .security.secrets import SecretRedactor
from .service import PipelineService

_REDACTOR = SecretRedactor()


@dataclass(frozen=True, slots=True)
class IPCError:
    code: str
    message: str
    details: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            value["details"] = self.details
        return value


def handle_request(service: PipelineService, request: Any) -> dict[str, Any]:
    request_id: Any = None
    try:
        if not isinstance(request, dict):
            raise ValueError("Request must be a JSON object")
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})
        if not isinstance(method, str) or not method:
            raise ValueError("method must be a non-empty string")
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        result = service.dispatch(method, params)
        return {"id": request_id, "ok": True, "result": result}
    except ProjectError as error:
        message = _REDACTOR.redact_text(str(error))
        return {"id": request_id, "ok": False, "error": IPCError(error.code, message).to_dict()}
    except ProviderFailure as error:
        message = _REDACTOR.redact_text(error.message)
        provider_details = error.to_dict()
        provider_details.pop("code", None)
        provider_details.pop("message", None)
        return {
            "id": request_id,
            "ok": False,
            "error": IPCError(
                error.code.value,
                message,
                _REDACTOR.redact(provider_details),
            ).to_dict(),
        }
    except KeyError:
        return {"id": request_id, "ok": False, "error": IPCError("NOT_FOUND", "The requested record was not found.").to_dict()}
    except (TypeError, ValueError) as error:
        message = _REDACTOR.redact_text(str(error))
        return {"id": request_id, "ok": False, "error": IPCError("INVALID_ARGUMENT", message).to_dict()}
    except Exception:
        return {
            "id": request_id,
            "ok": False,
            "error": IPCError(
                "INTERNAL",
                "The pipeline could not complete the request. Review local redacted diagnostics.",
            ).to_dict(),
        }


def serve(
    service: PipelineService | None = None,
    *,
    input_stream: TextIO = sys.stdin,
    output_stream: TextIO = sys.stdout,
) -> int:
    service = service or PipelineService()
    for line in input_stream:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = {
                "id": None,
                "ok": False,
                "error": IPCError("INVALID_JSON", "The request was not valid JSON.").to_dict(),
            }
        else:
            response = handle_request(service, request)
        output_stream.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        output_stream.flush()
    return 0
