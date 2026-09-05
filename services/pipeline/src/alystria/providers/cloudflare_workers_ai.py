"""Cloudflare Workers AI adapter for the reviewed FLUX.1 Schnell REST route.

The account identifier is non-secret project configuration. The API token is
still resolved from the operating-system vault for one invocation only. Model
names never participate in URL construction: this adapter has one exact model
and one fixed Cloudflare host.
"""

from __future__ import annotations

import base64
import re
from typing import Any

from .base import GuardedAdapter
from .catalog import default_catalog
from .errors import FailureCode, ProviderFailure
from .transport import HttpRequest, HttpResponse, HttpTransport
from .types import (
    CostEstimate,
    ImageRequest,
    MediaAsset,
    MediaOutput,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    Usage,
)

CLOUDFLARE_WORKERS_AI_PROVIDER_ID = "cloudflare-workers-ai"
CLOUDFLARE_FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell"
CLOUDFLARE_FLUX_STEPS = 4
CLOUDFLARE_FLUX_OUTPUT_TILES = 4
CLOUDFLARE_PRICING_CATALOG_VERSION = "cloudflare-workers-ai-pricing-2026-08-28"

# Cloudflare's own AI SDK example requests 1024x1024 output for this model.
# Pricing is $0.0000528 per 512x512 tile plus $0.0001056 per step. Four tiles
# and four steps therefore bound this exact request at $0.0006336.
CLOUDFLARE_FLUX_ESTIMATED_MICROS = 634

_ACCOUNT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
_JPEG_MAGIC = b"\xff\xd8\xff"


class CloudflareWorkersAIAdapter(GuardedAdapter):
    """Synchronous text-to-image adapter for one reviewed Workers AI model."""

    def __init__(self, transport: HttpTransport) -> None:
        self.transport = transport
        self.descriptor = default_catalog().get(CLOUDFLARE_WORKERS_AI_PROVIDER_ID)

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        if not isinstance(request, ImageRequest) or request.model != CLOUDFLARE_FLUX_MODEL:
            return CostEstimate(
                None,
                "USD",
                False,
                "No reviewed Cloudflare price for this request",
                self.descriptor.catalog_version,
            )
        return CostEstimate(
            CLOUDFLARE_FLUX_ESTIMATED_MICROS,
            "USD",
            True,
            "One 1024x1024 output (four 512x512 tiles) at four diffusion steps",
            CLOUDFLARE_PRICING_CATALOG_VERSION,
        )

    def build_request(self, request: ProviderRequest, context: RequestContext) -> HttpRequest:
        self._guard(request.capability, context)
        if not isinstance(request, ImageRequest):
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "Cloudflare Workers AI launch support is limited to text-to-image generation",
                provider_id=self.descriptor.provider_id,
            )
        if request.model != CLOUDFLARE_FLUX_MODEL:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Cloudflare Workers AI model is not in the reviewed endpoint allowlist",
                provider_id=self.descriptor.provider_id,
            )
        if request.reference_images:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "The reviewed Cloudflare FLUX.1 Schnell route does not support reference images",
                provider_id=self.descriptor.provider_id,
            )
        prompt = request.prompt.strip()
        if not 1 <= len(prompt) <= 2048:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Cloudflare FLUX.1 Schnell prompts must contain 1 to 2048 characters",
                provider_id=self.descriptor.provider_id,
            )
        if request.seed is not None and request.seed < 0:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Cloudflare FLUX.1 Schnell seed must be a non-negative integer",
                provider_id=self.descriptor.provider_id,
            )
        account_id = context.metadata.get("accountId", "")
        if _ACCOUNT_ID.fullmatch(account_id) is None:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Cloudflare Account ID is missing or invalid",
                provider_id=self.descriptor.provider_id,
            )
        self._guard_budget(request, context)
        body: dict[str, Any] = {"prompt": prompt, "steps": CLOUDFLARE_FLUX_STEPS}
        if request.seed is not None:
            body["seed"] = request.seed
        return HttpRequest(
            "POST",
            (
                "https://api.cloudflare.com/client/v4/accounts/"
                f"{account_id}/ai/run/{CLOUDFLARE_FLUX_MODEL}"
            ),
            headers={
                "Authorization": f"Bearer {context.credential}",
                "Content-Type": "application/json",
            },
            json_body=body,
        )

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[MediaOutput]:
        if not isinstance(request, ImageRequest):
            # build_request owns the stable public error shape.
            self.build_request(request, context)
            raise AssertionError("unreachable")
        response = self._send(self.build_request(request, context), context)
        return self._parse_image(request, response)

    def _parse_image(
        self, request: ImageRequest, response: HttpResponse
    ) -> ProviderResult[MediaOutput]:
        payload = self._json_response(response)
        request_id = _request_id(response)
        if payload.get("success") is not True:
            raise ProviderFailure(
                FailureCode.PROVIDER_ERROR,
                "Cloudflare Workers AI reported an unsuccessful result",
                provider_id=self.descriptor.provider_id,
                request_id=request_id,
            )
        result = payload.get("result")
        encoded = result.get("image") if isinstance(result, dict) else None
        if not isinstance(encoded, str) or not encoded:
            raise _malformed("Cloudflare Workers AI returned no image", request_id)
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (TypeError, ValueError) as error:
            raise _malformed(
                "Cloudflare Workers AI returned invalid base64 image data", request_id
            ) from error
        if not decoded.startswith(_JPEG_MAGIC):
            raise _malformed(
                "Cloudflare Workers AI returned an unexpected image format", request_id
            )
        output = MediaOutput(
            (
                MediaAsset(
                    data_base64=encoded,
                    media_type="image/jpeg",
                    license="Apache-2.0",
                    source_url=(
                        "https://developers.cloudflare.com/workers-ai/models/"
                        "flux-1-schnell/"
                    ),
                ),
            ),
            {
                "requestedAspectRatio": request.aspect_ratio,
                "requestedOutputFormat": request.output_format,
                "providerOutputFormat": "jpeg",
                "diffusionSteps": CLOUDFLARE_FLUX_STEPS,
                "estimatedCostMicros": CLOUDFLARE_FLUX_ESTIMATED_MICROS,
            },
        )
        usage = Usage(
            self.descriptor.provider_id,
            request.model,
            {
                "outputs": 1.0,
                "steps": float(CLOUDFLARE_FLUX_STEPS),
                "512x512_tiles": float(CLOUDFLARE_FLUX_OUTPUT_TILES),
            },
            None,
            request_id=request_id,
        )
        return ProviderResult(
            self.descriptor.provider_id,
            request.model,
            output,
            usage,
            request_id,
        )


def _request_id(response: HttpResponse) -> str | None:
    return next(
        (
            value
            for key, value in response.headers.items()
            if key.casefold() in {"cf-ray", "x-request-id"}
        ),
        None,
    )


def _malformed(message: str, request_id: str | None) -> ProviderFailure:
    return ProviderFailure(
        FailureCode.MALFORMED_RESPONSE,
        message,
        provider_id=CLOUDFLARE_WORKERS_AI_PROVIDER_ID,
        request_id=request_id,
    )
