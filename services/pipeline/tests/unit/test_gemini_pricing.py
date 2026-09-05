from __future__ import annotations

import pytest

from alystria.providers import (
    GEMINI_2_5_FLASH_MODEL,
    GeminiInteractionsAdapter,
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
    adapter = GeminiInteractionsAdapter(
        NoNetworkTransport(),
        prices=reviewed_gemini_prices((GEMINI_2_5_FLASH_MODEL,)),
    )

    estimate = adapter.estimate(
        TextRequest(
            "x" * 4_000,
            GEMINI_2_5_FLASH_MODEL,
            max_output_tokens=8_192,
        )
    )

    assert estimate.bounded
    assert estimate.micros == 20_780
    estimate.require_within(1_000_000)
    with pytest.raises(ValueError, match="must pin"):
        reviewed_gemini_prices(("gemini-unreviewed",))
