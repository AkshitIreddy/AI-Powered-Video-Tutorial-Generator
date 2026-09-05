from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast

import pytest

from alystria.providers import Capability, ProviderRuntime, parse_routing_policy
from alystria.service import _licensed_media_selector


def _anonymous_stock_policy(provider_id: str) -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "hybrid",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 1_000_000,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": provider_id,
                "capabilities": ["media.licensed.search"],
                "credentialRef": None,
                "boundary": "cloud",
                "retention": "provider_default",
                "regions": ["provider-managed"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "media.licensed.search",
                "providerIds": [provider_id],
                "model": "licensed-media",
                "voice": None,
            }
        ],
    }


def test_only_openverse_may_use_an_anonymous_cloud_search_route() -> None:
    policy = parse_routing_policy(_anonymous_stock_policy("openverse"))

    assert policy.approvals[0].credential_ref is None
    with pytest.raises(ValueError, match="requires a credentialRef"):
        parse_routing_policy(_anonymous_stock_policy("pexels"))


def test_nvidia_visual_review_route_selects_its_inline_byte_limit() -> None:
    policy = SimpleNamespace(
        routes=(
            SimpleNamespace(
                capability=Capability.LICENSED_MEDIA,
                provider_ids=("openverse",),
                model="licensed-media",
            ),
            SimpleNamespace(
                capability=Capability.VISION_LANGUAGE,
                provider_ids=("nvidia-nim",),
                model="nvidia/nemotron-nano-12b-v2-vl",
            ),
        )
    )
    runtime = cast(ProviderRuntime, SimpleNamespace(policy=policy))

    selector = _licensed_media_selector(runtime)

    assert selector is not None
    assert selector.model == "nvidia/nemotron-nano-12b-v2-vl"
    assert selector.max_preview_bytes == 180 * 1024
