"""Bounded inline-image review through the approved Gemini Flash route."""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
from dataclasses import replace
from typing import Any

from PIL import Image

from .base import GuardedAdapter
from .catalog import default_catalog
from .errors import FailureCode, ProviderFailure
from .llm import GeminiGenerateContentAdapter, TokenPrices
from .transport import HttpRequest, HttpTransport
from .types import (
    Capability,
    CostEstimate,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    TextOutput,
    TextRequest,
    VisionLanguageRequest,
)

GEMINI_VISION_MODEL = "gemini-3.7-flash"
# Standard paid prices after the introductory discount expires; free quota is
# account-dependent and must never be assumed by the hard-budget guard.
VISION_PRICES = TokenPrices("2026-09-08-gemini-3.7-standard-ceiling", 1_500_000, 7_500_000)


class GeminiVisionAdapter(GuardedAdapter):
    def __init__(self, transport: HttpTransport) -> None:
        self.transport = transport
        self.descriptor = replace(
            default_catalog().get("gemini"),
            capabilities=frozenset({Capability.VISION_LANGUAGE}),
        )

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        if not isinstance(request, VisionLanguageRequest):
            return CostEstimate(
                None, "USD", False, "Unsupported request", VISION_PRICES.catalog_version
            )
        self._parts(request)
        # 2048px bounded previews have at most 16 512px tiles. This deliberately
        # conservative allowance includes image tokenization and Unicode text.
        input_tokens = (len(request.prompt) + len(request.system or "")) * 4 + len(
            request.images
        ) * 8192
        micros = (
            input_tokens * VISION_PRICES.input_micros_per_million
            + request.max_output_tokens * VISION_PRICES.output_micros_per_million
            + 999_999
        ) // 1_000_000
        return CostEstimate(
            micros,
            "USD",
            True,
            "Bounded inline previews and maximum output; free quota not assumed",
            VISION_PRICES.catalog_version,
        )

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[TextOutput]:
        if not isinstance(request, VisionLanguageRequest):
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "Gemini visual review requires image-aware input",
                provider_id="gemini",
            )
        self._guard(request.capability, context)
        self._guard_budget(request, context)
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": self._parts(request)}],
            "generationConfig": {
                "maxOutputTokens": request.max_output_tokens,
                "responseMimeType": "application/json",
                "thinkingConfig": {"thinkingLevel": "low"},
            },
        }
        if request.system:
            body["systemInstruction"] = {"parts": [{"text": request.system}]}
        response = self._send(
            HttpRequest(
                "POST",
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_VISION_MODEL}:generateContent",
                headers={
                    "x-goog-api-key": context.credential or "",
                    "Content-Type": "application/json",
                },
                json_body=body,
            ),
            context,
        )
        # Share blocked-response and measured usage handling with text Gemini.
        parser = GeminiGenerateContentAdapter(self.transport, prices=VISION_PRICES)
        return parser.parse_response(
            TextRequest(request.prompt, request.model), self._json_response(response)
        )

    @staticmethod
    def _parts(request: VisionLanguageRequest) -> list[dict[str, Any]]:
        if request.model != GEMINI_VISION_MODEL:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                f"Gemini visual review requires {GEMINI_VISION_MODEL}",
                provider_id="gemini",
            )
        if not 1 <= len(request.images) <= 8 or not 1 <= request.max_output_tokens <= 8192:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Visual review supports 1-8 images and at most 8192 output tokens",
                provider_id="gemini",
            )
        if len(request.prompt) + len(request.system or "") > 32_000:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Visual review prompt exceeds its limit",
                provider_id="gemini",
            )
        parts: list[dict[str, Any]] = [{"text": request.prompt}]
        encoded_bytes = 0
        for asset in request.images:
            try:
                if (
                    asset.uri
                    or not asset.data_base64
                    or asset.media_type not in {"image/png", "image/jpeg"}
                ):
                    raise ValueError("only quarantined inline PNG/JPEG previews are accepted")
                if len(asset.data_base64) > 5_600_000:
                    raise ValueError("preview exceeds 4 MiB")
                decoded = base64.b64decode(asset.data_base64, validate=True)
                if not 0 < len(decoded) <= 4 * 1024 * 1024:
                    raise ValueError("preview exceeds 4 MiB")
                if asset.sha256 and hashlib.sha256(decoded).hexdigest() != asset.sha256:
                    raise ValueError("preview digest mismatch")
                with Image.open(io.BytesIO(decoded)) as image:
                    if image.format != ("PNG" if asset.media_type == "image/png" else "JPEG"):
                        raise ValueError("preview type mismatch")
                    if not 1 <= image.width <= 2048 or not 1 <= image.height <= 2048:
                        raise ValueError("preview exceeds 2048 pixels")
                    image.verify()
                encoded_bytes += len(asset.data_base64)
                if encoded_bytes > 16 * 1024 * 1024:
                    raise ValueError("combined inline previews exceed 16 MiB")
            except (ValueError, OSError, binascii.Error, Image.DecompressionBombError) as error:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    f"Invalid Gemini review preview: {error}",
                    provider_id="gemini",
                ) from error
            parts.append({"inlineData": {"mimeType": asset.media_type, "data": asset.data_base64}})
        return parts
