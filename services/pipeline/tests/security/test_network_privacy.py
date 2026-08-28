from __future__ import annotations

import unittest

from alystria.security.errors import PolicyViolation, ValidationError
from alystria.security.network import (
    UrlPolicy,
    assert_connected_peer,
    validate_redirect_chain,
    validate_url,
)
from alystria.security.privacy import (
    DataClassification,
    NetworkContext,
    PrivacyMode,
    ProviderBoundary,
    ProviderPrivacy,
    RouteRequest,
    decide_provider_route,
    enforce_network_access,
    network_scope,
)


def public_resolver(_host: str, _port: int) -> tuple[str, ...]:
    return ("93.184.216.34",)


def private_resolver(_host: str, _port: int) -> tuple[str, ...]:
    return ("127.0.0.1",)


def mixed_resolver(_host: str, _port: int) -> tuple[str, ...]:
    return ("93.184.216.34", "169.254.169.254")


class UrlPolicyTests(unittest.TestCase):
    def test_normalizes_and_pins_public_https(self) -> None:
        result = validate_url("https://EXAMPLE.com/path?q=1", resolver=public_resolver)
        self.assertEqual(result.normalized_url, "https://example.com/path?q=1")
        self.assertEqual(result.pinned_addresses, ("93.184.216.34",))
        assert_connected_peer(result, "93.184.216.34")

    def test_blocks_ssrf_targets_and_mixed_dns(self) -> None:
        for url, resolver in (
            ("https://localhost/x", public_resolver),
            ("https://127.0.0.1/x", public_resolver),
            ("https://metadata.google.internal/x", public_resolver),
            ("https://example.com/x", private_resolver),
            ("https://example.com/x", mixed_resolver),
            ("file:///etc/passwd", public_resolver),
        ):
            with self.subTest(url=url), self.assertRaises((PolicyViolation, ValidationError)):
                validate_url(url, resolver=resolver)

    def test_blocks_userinfo_ports_fragments_and_peer_rebinding(self) -> None:
        for url in (
            "https://user:pass@example.com/",
            "https://example.com:8443/",
            "https://example.com/#secret",
        ):
            with self.subTest(url=url), self.assertRaises((PolicyViolation, ValidationError)):
                validate_url(url, resolver=public_resolver)
        result = validate_url("https://example.com", resolver=public_resolver)
        with self.assertRaises(PolicyViolation):
            assert_connected_peer(result, "8.8.8.8")

    def test_redirects_are_revalidated_and_capped(self) -> None:
        chain = validate_redirect_chain(
            ["https://a.example/", "https://b.example/final"], resolver=public_resolver
        )
        self.assertEqual(len(chain), 2)
        with self.assertRaises(PolicyViolation):
            validate_redirect_chain(
                ["https://a.example/", "https://localhost/final"],
                resolver=public_resolver,
            )
        with self.assertRaises(PolicyViolation):
            validate_redirect_chain(
                ["https://a.example/", "https://b.example/", "https://c.example/"],
                policy=UrlPolicy(max_redirects=1),
                resolver=public_resolver,
            )


class PrivacyTests(unittest.TestCase):
    def test_local_mode_rejects_cloud_route(self) -> None:
        provider = ProviderPrivacy(
            "cloud",
            ProviderBoundary.CLOUD,
            frozenset({DataClassification.PROJECT}),
            "30 days",
            "us",
            True,
            True,
        )
        decision = decide_provider_route(
            RouteRequest(PrivacyMode.LOCAL, DataClassification.PROJECT), provider
        )
        self.assertFalse(decision.allowed)

    def test_cloud_requires_configuration_approval_class_and_region(self) -> None:
        provider = ProviderPrivacy(
            "cloud",
            ProviderBoundary.CLOUD,
            frozenset({DataClassification.PUBLIC}),
            "none",
            "eu",
            True,
            True,
        )
        allowed = decide_provider_route(
            RouteRequest(PrivacyMode.CLOUD, DataClassification.PUBLIC, requested_region="eu"),
            provider,
        )
        self.assertTrue(allowed.allowed)
        blocked = decide_provider_route(
            RouteRequest(PrivacyMode.CLOUD, DataClassification.PRIVATE, requested_region="us"),
            provider,
        )
        self.assertFalse(blocked.allowed)
        self.assertEqual(len(blocked.reasons), 2)

    def test_network_guard_requires_scope_and_blocks_local_content_egress(self) -> None:
        destination = validate_url("https://example.com", resolver=public_resolver)
        with self.assertRaises(PolicyViolation):
            enforce_network_access(destination)
        context = NetworkContext(
            PrivacyMode.LOCAL, DataClassification.PROJECT, True, ProviderBoundary.CLOUD
        )
        with network_scope(context), self.assertRaises(PolicyViolation):
            enforce_network_access(destination)

    def test_local_process_uses_non_network_ipc(self) -> None:
        context = NetworkContext(
            PrivacyMode.LOCAL, DataClassification.PRIVATE, True, ProviderBoundary.LOCAL_PROCESS
        )
        with network_scope(context):
            enforce_network_access(None)
        self.assertIsNone(
            __import__(
                "alystria.security.privacy", fromlist=["current_network_context"]
            ).current_network_context()
        )


if __name__ == "__main__":
    unittest.main()
