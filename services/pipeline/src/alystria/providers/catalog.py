"""Versioned provider capability and policy catalog.

The catalog is intentionally conservative.  Empty regions and unknown policy
fields mean "ask/show the provider's current policy", not global availability.
Pricing is a snapshot input rather than guessed live data; requests under a hard
budget are blocked when their price cannot be bounded.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .types import (
    Capability,
    DataBoundary,
    DataPolicy,
    Price,
    ProviderDescriptor,
    RetentionMode,
)

CATALOG_VERSION = "2026.09.05.2"
VERIFIED_AT = "2026-09-05"
CANONICAL_PROVIDER_ALIASES = {
    "azure": "azure-speech",
    "google": "gemini",
}


def _cloud(retention: RetentionMode = RetentionMode.PROVIDER_DEFAULT) -> DataPolicy:
    return DataPolicy(
        boundary=DataBoundary.CLOUD,
        retention=retention,
        regions=("provider-managed",),
        stores_by_default=None,
        training_use=None,
        notes="Show current provider terms and request-specific controls before approval.",
    )


LOCAL_POLICY = DataPolicy(
    boundary=DataBoundary.LOCAL,
    retention=RetentionMode.LOCAL_ONLY,
    regions=("local",),
    stores_by_default=False,
    training_use=False,
)

NVIDIA_HOSTED_PREVIEW_POLICY = DataPolicy(
    boundary=DataBoundary.CLOUD,
    retention=RetentionMode.PROVIDER_DEFAULT,
    regions=("provider-managed",),
    stores_by_default=None,
    # Trial Terms section 3.3 permits de-identified content collection for
    # product/AI improvement. This deliberately fails closed instead of using
    # product-page shorthand about model training.
    training_use=True,
    notes=(
        "Hosted NVIDIA API Catalog preview only; public or synthetic content. "
        "Not production. Trial limits vary. Session content handling and security/abuse "
        "logging follow current Trial Terms; content may be used for product/AI improvement. "
        "Self-hosted NIM requires a separate NVIDIA AI Enterprise entitlement and boundary."
    ),
)

CLOUDFLARE_WORKERS_AI_POLICY = DataPolicy(
    boundary=DataBoundary.CLOUD,
    retention=RetentionMode.CONFIGURABLE,
    regions=("provider-managed",),
    stores_by_default=False,
    training_use=False,
    notes=(
        "Cloudflare says Workers AI customer content is not used to train models or improve "
        "services without explicit consent, and is stored only when a separate storage "
        "service is intentionally used. Review the current subscription and model terms."
    ),
)


@dataclass(frozen=True, slots=True)
class ProviderCatalog:
    version: str
    entries: dict[str, ProviderDescriptor]
    aliases: dict[str, str]

    def get(self, provider_id: str) -> ProviderDescriptor:
        provider_id = self.canonical_id(provider_id)
        try:
            return self.entries[provider_id]
        except KeyError as exc:
            raise KeyError(f"Provider {provider_id!r} is not in catalog {self.version}") from exc

    def with_prices(self, provider_id: str, prices: tuple[Price, ...]) -> ProviderCatalog:
        from dataclasses import replace

        updated = dict(self.entries)
        updated[provider_id] = replace(self.get(provider_id), prices=prices)
        return ProviderCatalog(self.version, updated, dict(self.aliases))

    def canonical_id(self, provider_id: str) -> str:
        """Resolve a legacy import alias to one canonical persisted ID.

        Alias chains and aliases that shadow canonical entries are rejected by
        the catalog drift checks. New routing policy serialization always emits
        the returned canonical value.
        """

        return self.aliases.get(provider_id, provider_id)


def canonical_provider_id(provider_id: str) -> str:
    return default_catalog().canonical_id(provider_id)


def validate_root_catalog(document: dict[str, Any]) -> tuple[str, ...]:
    """Return root JSON/Python catalog drift diagnostics.

    The root JSON is consumed by TypeScript/tooling and is the distribution
    catalog. Python retains typed descriptors for packaged operation. This
    validation makes any ID or migration-alias divergence a blocking test.
    """

    errors: list[str] = []
    providers = document.get("providers")
    if not isinstance(providers, list):
        return ("providers must be an array",)
    root_ids = {
        str(value.get("id"))
        for value in providers
        if isinstance(value, dict) and isinstance(value.get("id"), str)
    }
    python_ids = set(default_catalog().entries)
    if root_ids != python_ids:
        errors.append(
            "canonical provider IDs differ: "
            f"root-only={sorted(root_ids - python_ids)}, python-only={sorted(python_ids - root_ids)}"
        )
    aliases = document.get("aliases")
    if aliases != CANONICAL_PROVIDER_ALIASES:
        errors.append("provider migration aliases differ from the Python catalog")
    if document.get("catalogVersion") != CATALOG_VERSION:
        errors.append("catalogVersion differs from the Python catalog")
    return tuple(errors)


def load_and_validate_root_catalog(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("provider catalog must be a JSON object")
    errors = validate_root_catalog(value)
    if errors:
        raise ValueError("; ".join(errors))
    return value


def _entry(
    provider_id: str,
    display_name: str,
    capabilities: set[Capability],
    docs_url: str,
    *,
    policy: DataPolicy | None = None,
    models: tuple[str, ...] = (),
    idempotency: bool = False,
    cancellation: bool = False,
) -> ProviderDescriptor:
    return ProviderDescriptor(
        provider_id=provider_id,
        display_name=display_name,
        capabilities=frozenset(capabilities),
        data_policy=policy or _cloud(),
        catalog_version=CATALOG_VERSION,
        last_verified_at=VERIFIED_AT,
        docs_url=docs_url,
        models=models,
        supports_idempotency=idempotency,
        supports_cancellation=cancellation,
    )


def default_catalog() -> ProviderCatalog:
    """Return launch adapters and the official source used for each contract."""

    items = [
        _entry(
            "mock",
            "Deterministic Mock",
            {
                Capability.LLM_TEXT,
                Capability.LLM_STRUCTURED,
                Capability.IMAGE_GENERATION,
                Capability.TTS,
                Capability.ALIGNMENT,
                Capability.PRESENTER,
            },
            "https://alystria.invalid/providers/mock",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "local-runtime",
            "Alystria Local Runtime",
            {
                Capability.LLM_TEXT,
                Capability.LLM_STRUCTURED,
                Capability.IMAGE_GENERATION,
                Capability.IMAGE_EDITING,
                Capability.TTS,
                Capability.TRANSCRIPTION,
                Capability.ALIGNMENT,
                Capability.PRESENTER,
                Capability.PORTRAIT_ANIMATION,
                Capability.LIP_SYNC,
            },
            "https://alystria.invalid/providers/local-runtime",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "openai",
            "OpenAI",
            {
                Capability.LLM_TEXT,
                Capability.LLM_STRUCTURED,
                Capability.RESEARCH,
                Capability.IMAGE_GENERATION,
                Capability.IMAGE_EDITING,
                Capability.TTS,
                Capability.TRANSCRIPTION,
            },
            "https://developers.openai.com/api/reference/resources/responses/methods/create",
            policy=_cloud(RetentionMode.CONFIGURABLE),
            idempotency=True,
        ),
        _entry(
            "anthropic",
            "Anthropic",
            {Capability.LLM_TEXT, Capability.LLM_STRUCTURED, Capability.RESEARCH},
            "https://platform.claude.com/docs/en/api/messages/create",
            policy=_cloud(RetentionMode.CONFIGURABLE),
        ),
        _entry(
            "gemini",
            "Google Gemini",
            {
                Capability.LLM_TEXT,
                Capability.LLM_STRUCTURED,
                Capability.RESEARCH,
                Capability.IMAGE_GENERATION,
                Capability.IMAGE_EDITING,
                Capability.MOTION,
                Capability.TTS,
                Capability.TRANSCRIPTION,
            },
            "https://ai.google.dev/api/interactions-api-v1",
            policy=_cloud(RetentionMode.CONFIGURABLE),
            models=("gemini-2.5-flash",),
            cancellation=True,
        ),
        _entry(
            "groq",
            "Groq",
            {Capability.LLM_TEXT, Capability.LLM_STRUCTURED},
            "https://console.groq.com/docs/structured-outputs",
            models=("openai/gpt-oss-20b",),
        ),
        _entry(
            "mistral",
            "Mistral AI",
            {Capability.LLM_TEXT, Capability.LLM_STRUCTURED},
            "https://docs.mistral.ai/api/endpoint/chat",
            models=("mistral-small-2603",),
        ),
        _entry(
            "openrouter",
            "OpenRouter",
            {Capability.LLM_TEXT, Capability.LLM_STRUCTURED},
            "https://openrouter.ai/docs/guides/features/structured-outputs",
            models=("z-ai/glm-5.2:free",),
        ),
        _entry(
            "cohere",
            "Cohere",
            {
                Capability.LLM_TEXT,
                Capability.LLM_STRUCTURED,
                Capability.EMBEDDING,
                Capability.RERANKING,
            },
            "https://docs.cohere.com/reference/list-models",
            policy=_cloud(RetentionMode.CONFIGURABLE),
        ),
        _entry(
            "nvidia-nim",
            "NVIDIA NIM Hosted Preview",
            {
                Capability.LLM_TEXT,
                Capability.LLM_STRUCTURED,
                Capability.VISION_LANGUAGE,
                Capability.EMBEDDING,
                Capability.IMAGE_GENERATION,
                Capability.TTS,
            },
            "https://docs.api.nvidia.com/nim/docs/api-quickstart",
            policy=NVIDIA_HOSTED_PREVIEW_POLICY,
        ),
        _entry(
            "cloudflare-workers-ai",
            "Cloudflare Workers AI",
            {Capability.IMAGE_GENERATION},
            "https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/",
            policy=CLOUDFLARE_WORKERS_AI_POLICY,
            models=("@cf/black-forest-labs/flux-1-schnell",),
        ),
        _entry(
            "openai-compatible-local",
            "OpenAI-compatible local endpoint",
            {Capability.LLM_TEXT, Capability.LLM_STRUCTURED},
            "https://platform.openai.com/docs/api-reference/chat/create",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "black-forest-labs",
            "Black Forest Labs",
            {Capability.IMAGE_GENERATION, Capability.IMAGE_EDITING},
            "https://docs.bfl.ai/api-reference/tasks/generate-or-edit-an-image",
            cancellation=True,
        ),
        _entry(
            "recraft",
            "Recraft",
            {Capability.IMAGE_GENERATION, Capability.IMAGE_EDITING},
            "https://www.recraft.ai/docs/api-reference/endpoints",
        ),
        _entry(
            "openverse",
            "Openverse",
            {Capability.LICENSED_MEDIA},
            "https://api.openverse.org/v1/",
        ),
        _entry(
            "pexels",
            "Pexels",
            {Capability.LICENSED_MEDIA},
            "https://www.pexels.com/api/documentation/",
        ),
        _entry(
            "runway",
            "Runway",
            {Capability.MOTION},
            "https://docs.dev.runwayml.com/api/",
            cancellation=True,
        ),
        _entry(
            "elevenlabs",
            "ElevenLabs",
            {Capability.TTS, Capability.TRANSCRIPTION},
            "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
        ),
        _entry(
            "azure-speech",
            "Azure AI Speech",
            {Capability.TTS, Capability.TRANSCRIPTION},
            "https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech",
            policy=_cloud(RetentionMode.CONFIGURABLE),
        ),
        _entry(
            "google-cloud-speech",
            "Google Cloud Speech",
            {Capability.TTS, Capability.TRANSCRIPTION},
            "https://cloud.google.com/speech-to-text/v2/docs/reference/rest",
            policy=_cloud(RetentionMode.CONFIGURABLE),
            cancellation=True,
        ),
        _entry(
            "heygen",
            "HeyGen",
            {Capability.PRESENTER},
            "https://docs.heygen.com/reference/create-an-avatar-video-v2",
            cancellation=True,
        ),
        _entry(
            "tavus",
            "Tavus",
            {Capability.PRESENTER},
            "https://docs.tavus.io/api-reference/video-generation/create-video",
            cancellation=True,
        ),
        _entry(
            "qwen3-tts-local",
            "Qwen3-TTS local",
            {Capability.TTS},
            "https://github.com/QwenLM/Qwen3-TTS",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "kokoro-local",
            "Kokoro local",
            {Capability.TTS},
            "https://github.com/hexgrad/kokoro",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "whisperx-local",
            "WhisperX local",
            {Capability.TRANSCRIPTION, Capability.ALIGNMENT},
            "https://github.com/m-bain/whisperX",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "mfa-local",
            "Montreal Forced Aligner local",
            {Capability.ALIGNMENT},
            "https://montreal-forced-aligner.readthedocs.io/",
            policy=LOCAL_POLICY,
        ),
        _entry(
            "presenter-local",
            "LivePortrait / MuseTalk local",
            {
                Capability.PRESENTER,
                Capability.PORTRAIT_ANIMATION,
                Capability.LIP_SYNC,
            },
            "https://github.com/TMElyralab/MuseTalk",
            policy=LOCAL_POLICY,
            cancellation=True,
        ),
    ]
    return ProviderCatalog(
        CATALOG_VERSION,
        {entry.provider_id: entry for entry in items},
        dict(CANONICAL_PROVIDER_ALIASES),
    )
