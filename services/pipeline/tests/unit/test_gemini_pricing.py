from __future__ import annotations

import pytest

from alystria.providers import (
    GEMINI_2_5_FLASH_MODEL,
    GEMINI_2_5_FLASH_PRICES,
    GEMINI_3_7_FLASH_MODEL,
    GEMINI_3_8_FLASH_MODEL,
    GEMINI_3_FLASH_PRICES,
    GeminiGenerateContentAdapter,
    HttpRequest,
    HttpResponse,
    TextRequest,
    reviewed_gemini_prices,
)


class NoNetworkTransport:
    def send(self, request: HttpRequest) -> HttpResponse:
        del request
        raise AssertionError("pricing estimation must not use the network")


def test_gemini_flash_price_snapshot_bounds_the_maximum_requested_output() -> None:
    adapter = GeminiGenerateContentAdapter(
        NoNetworkTransport(),
        prices=reviewed_gemini_prices((GEMINI_3_8_FLASH_MODEL,)),
    )

    estimate = adapter.estimate(
        TextRequest(
            "x" * 4_000,
            GEMINI_3_8_FLASH_MODEL,
            max_output_tokens=8_192,
        )
    )

    assert estimate.bounded
    assert estimate.micros == 31_470


def test_gemini_current_models_share_one_reviewed_price_snapshot() -> None:
    assert reviewed_gemini_prices(
        (GEMINI_3_8_FLASH_MODEL, GEMINI_3_7_FLASH_MODEL, GEMINI_3_8_FLASH_MODEL)
    ) is GEMINI_3_FLASH_PRICES


def test_gemini_search_estimate_includes_bounded_paid_rate_ceiling() -> None:
    adapter = GeminiGenerateContentAdapter(
        NoNetworkTransport(),
        prices=reviewed_gemini_prices((GEMINI_3_8_FLASH_MODEL,)),
    )

    estimate = adapter.estimate(
        TextRequest(
            "x" * 4_000,
            GEMINI_3_8_FLASH_MODEL,
            max_output_tokens=8_192,
            research=True,
        )
    )

    assert estimate.micros == 73_470


def test_gemini_legacy_price_is_retained_but_cannot_mix_with_current_models() -> None:
    assert reviewed_gemini_prices((GEMINI_2_5_FLASH_MODEL,)) is GEMINI_2_5_FLASH_PRICES
    with pytest.raises(ValueError, match="different billing units"):
        reviewed_gemini_prices((GEMINI_2_5_FLASH_MODEL, GEMINI_3_8_FLASH_MODEL))
    with pytest.raises(ValueError, match="reviewed models"):
        reviewed_gemini_prices(("gemini-unreviewed",))
