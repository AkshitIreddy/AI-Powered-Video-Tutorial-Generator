"""Per-generation provider runtime and ephemeral credential grant boundary."""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import secrets
import socket
import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager, nullcontext
from dataclasses import dataclass, replace
from threading import RLock
from typing import Any, Protocol, cast

from alystria.audio.wav import WavFixtureSpec, generate_sine_wav

from .base import ProviderAdapter
from .cloudflare_workers_ai import CloudflareWorkersAIAdapter
from .errors import FailureCode, ProviderFailure
from .llm import (
    AnthropicMessagesAdapter,
    GeminiInteractionsAdapter,
    OpenAICompatibleLocalAdapter,
    OpenAIResponsesAdapter,
)
from .media import launch_media_adapter, launch_media_provider_ids, launch_route_unit_prices
from .nvidia_nim import (
    NvidiaNimAdapter,
    configured_nvidia_tts_models,
    configured_nvidia_visual_models,
)
from .openai_compatible_structured import launch_structured_cloud_adapter
from .policy import ProviderApproval, TutorialRoutingPolicy
from .router import ProviderRouter, RoutingPolicy
from .transport import HttpTransport
from .types import (
    Capability,
    CostEstimate,
    ImageRequest,
    MediaAsset,
    MediaOutput,
    ProviderDescriptor,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    SpeechRequest,
    TextOutput,
    TextRequest,
    Usage,
)

CREDENTIAL_BROKER_TIMEOUT_SECONDS = 15.0


# The explicit class body keeps dataclass repr from ever exposing a bearer token.
@dataclass(frozen=True, slots=True, repr=False)
class CredentialGrant:
    token: str

    def __repr__(self) -> str:
        return "CredentialGrant(token='<opaque>')"


class CredentialGrantResolver(Protocol):
    def lease(
        self,
        grant: CredentialGrant,
        *,
        provider_id: str,
        credential_ref: str,
    ) -> AbstractContextManager[str]: ...


class EphemeralCredentialBroker:
    """In-memory stand-in for the authenticated Rust keyring callback.

    Production issues the opaque grant over the already-authenticated sidecar
    channel. The key itself is never an argument, environment variable,
    project field, job parameter, or log value. Grants are revoked after a
    generation attempt; each revealed byte buffer is zeroed after one call.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._grants: dict[str, tuple[str, str, bytearray]] = {}

    def issue(self, provider_id: str, credential_ref: str, secret_value: str) -> CredentialGrant:
        if not secret_value:
            raise ValueError("credential value must not be empty")
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._grants[token] = (
                provider_id,
                credential_ref,
                bytearray(secret_value.encode("utf-8")),
            )
        return CredentialGrant(token)

    @contextmanager
    def lease(
        self,
        grant: CredentialGrant,
        *,
        provider_id: str,
        credential_ref: str,
    ) -> Iterator[str]:
        with self._lock:
            stored = self._grants.get(grant.token)
            if stored is None:
                raise ProviderFailure(
                    FailureCode.AUTHENTICATION,
                    "Credential grant is missing, expired, or revoked",
                    provider_id=provider_id,
                )
            stored_provider, stored_ref, secret = stored
            if stored_provider != provider_id or stored_ref != credential_ref:
                raise ProviderFailure(
                    FailureCode.AUTHENTICATION,
                    "Credential grant does not match the approved reference",
                    provider_id=provider_id,
                )
            invocation_copy = bytearray(secret)
        try:
            yield invocation_copy.decode("utf-8")
        finally:
            invocation_copy[:] = b"\x00" * len(invocation_copy)

    def revoke(self, grant: CredentialGrant) -> None:
        with self._lock:
            stored = self._grants.pop(grant.token, None)
        if stored is not None:
            stored[2][:] = b"\x00" * len(stored[2])

    def close(self) -> None:
        with self._lock:
            grants = list(self._grants.values())
            self._grants.clear()
        for _, _, secret in grants:
            secret[:] = b"\x00" * len(secret)


class DesktopCredentialBrokerResolver:
    """Redeem one-call keyring leases from the Rust loopback broker."""

    def __init__(self, endpoint: str, authentication_token: str) -> None:
        host, separator, port_value = endpoint.rpartition(":")
        if not separator or not host or not port_value:
            raise ValueError("credential broker endpoint is invalid")
        host = host.strip("[]")
        addresses = socket.getaddrinfo(host, int(port_value), type=socket.SOCK_STREAM)
        if not addresses or any(
            not ipaddress.ip_address(address[4][0]).is_loopback for address in addresses
        ):
            raise ValueError("credential broker must be loopback-only")
        if not 32 <= len(authentication_token) <= 512:
            raise ValueError("credential broker authentication token is invalid")
        self._endpoint = (host, int(port_value))
        self._authentication_token = authentication_token

    @contextmanager
    def lease(
        self,
        grant: CredentialGrant,
        *,
        provider_id: str,
        credential_ref: str,
    ) -> Iterator[str]:
        request_id = str(uuid.uuid4())
        # A fresh nonce makes every redemption one-shot even when a generation
        # invokes the same approved provider for multiple scenes.
        nonce = f"{grant.token}.{secrets.token_urlsafe(24)}"
        request = {
            "protocolVersion": 1,
            "requestId": request_id,
            "authenticationToken": self._authentication_token,
            "nonce": nonce,
            "providerId": provider_id,
            "credentialRef": credential_ref,
        }
        encoded = bytearray(
            (json.dumps(request, separators=(",", ":")) + "\n").encode("utf-8")
        )
        response_bytes = bytearray()
        broker_phase = "connect"
        try:
            with socket.create_connection(
                self._endpoint, timeout=CREDENTIAL_BROKER_TIMEOUT_SECONDS
            ) as stream:
                stream.settimeout(CREDENTIAL_BROKER_TIMEOUT_SECONDS)
                broker_phase = "send"
                stream.sendall(encoded)
                # The request is newline-framed, so the broker does not need a
                # client half-close to know when it is complete. On Windows a
                # fast broker response can race that shutdown and surface as
                # WSAECONNABORTED even though the request was accepted.
                broker_phase = "receive"
                while len(response_bytes) <= 64 * 1024:
                    block = stream.recv(8192)
                    if not block:
                        break
                    response_bytes.extend(block)
                    # The broker protocol is one newline-delimited response.
                    # Do not wait for a peer close after the complete frame:
                    # Windows may surface that close as WSAECONNABORTED even
                    # though the authenticated JSON response arrived intact.
                    if b"\n" in response_bytes:
                        break
            if len(response_bytes) > 64 * 1024:
                raise ProviderFailure(
                    FailureCode.AUTHENTICATION,
                    "Credential broker response exceeded its safety limit",
                    provider_id=provider_id,
                )
            response = json.loads(response_bytes)
            if (
                not isinstance(response, dict)
                or response.get("protocolVersion") != 1
                or response.get("requestId") != request_id
                or response.get("ok") is not True
                or not isinstance(response.get("credential"), str)
            ):
                raise ProviderFailure(
                    FailureCode.AUTHENTICATION,
                    "Approved credential is unavailable from the OS keyring broker",
                    provider_id=provider_id,
                )
            credential = response.pop("credential")
            response.clear()
            try:
                yield credential
            finally:
                credential = ""
        except json.JSONDecodeError as error:
            diagnostic = (
                "broker-empty-response"
                if not response_bytes
                else "broker-malformed-response"
            )
            raise ProviderFailure(
                FailureCode.AUTHENTICATION,
                f"The authenticated OS keyring broker is unavailable ({diagnostic})",
                provider_id=provider_id,
            ) from error
        except UnicodeDecodeError as error:
            raise ProviderFailure(
                FailureCode.AUTHENTICATION,
                "The authenticated OS keyring broker is unavailable (broker-invalid-encoding)",
                provider_id=provider_id,
            ) from error
        except OSError as error:
            error_number = error.errno
            diagnostic = (
                f"broker-{broker_phase}-error"
                if error_number is None
                else f"broker-{broker_phase}-error-{error_number}"
            )
            raise ProviderFailure(
                FailureCode.AUTHENTICATION,
                f"The authenticated OS keyring broker is unavailable ({diagnostic})",
                provider_id=provider_id,
            ) from error
        finally:
            encoded[:] = b"\x00" * len(encoded)
            response_bytes[:] = b"\x00" * len(response_bytes)


class MockProviderAdapter:
    """Network-free adapter used for deterministic provider-runtime tests."""

    descriptor: ProviderDescriptor
    requires_credential = False

    def __init__(self) -> None:
        from .catalog import default_catalog

        self.descriptor = default_catalog().get("mock")
        self.descriptor = replace(
            self.descriptor,
            capabilities=frozenset(
                {
                    Capability.LLM_TEXT,
                    Capability.LLM_STRUCTURED,
                    Capability.IMAGE_GENERATION,
                    Capability.TTS,
                }
            ),
        )

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        return CostEstimate(0, "USD", True, "deterministic mock", self.descriptor.catalog_version)

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[Any]:
        if context.approved_provider_id != "mock":
            raise ProviderFailure(
                FailureCode.ROUTING_CONSENT_REQUIRED,
                "Mock provider was not approved",
                provider_id="mock",
            )
        model = getattr(request, "model", "mock-v1")
        usage = Usage("mock", model, {"requests": 1.0}, 0)
        if isinstance(request, TextRequest):
            value: Any = TextOutput(
                text=f"Mock response: {request.prompt}",
                parsed={"mock": True} if request.json_schema is not None else None,
            )
        elif isinstance(request, ImageRequest):
            digest = hashlib.sha256(f"{request.prompt}:{request.seed}".encode()).hexdigest()[:6]
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">'
                f'<rect width="1920" height="1080" fill="#{digest}"/>'
                "</svg>"
            ).encode()
            value = MediaOutput(
                (
                    MediaAsset(
                        data_base64=base64.b64encode(svg).decode(),
                        media_type="image/svg+xml",
                        license="MIT",
                    ),
                )
            )
        elif isinstance(request, SpeechRequest):
            wav = generate_sine_wav(WavFixtureSpec(duration_ms=900, amplitude=0.12))
            tokens = request.text.split()
            word_timings = [
                {
                    "word": token,
                    "startMs": round(index * 900 / len(tokens)),
                    "endMs": round((index + 1) * 900 / len(tokens)),
                }
                for index, token in enumerate(tokens)
            ]
            value = MediaOutput(
                (
                    MediaAsset(
                        data_base64=base64.b64encode(wav).decode(),
                        media_type="audio/wav",
                        license="MIT",
                    ),
                ),
                {
                    "wordTimings": word_timings,
                    "alignmentSource": "provider-native",
                    "alignmentEngine": "deterministic-mock-clock-v1",
                },
            )
        else:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "Mock runtime does not implement this request type",
                provider_id="mock",
            )
        return ProviderResult("mock", model, value, usage, f"mock-{context.idempotency_key}")


TransportFactory = Callable[[str], HttpTransport]


@dataclass(slots=True)
class ProviderRuntime:
    policy: TutorialRoutingPolicy
    router: ProviderRouter
    credential_resolver: CredentialGrantResolver | None
    credential_grants: Mapping[str, CredentialGrant]

    def invoke(self, request: ProviderRequest, *, idempotency_key: str) -> ProviderResult[Any]:
        route = self.policy.route_for(request.capability)
        provider_id = route.provider_ids[0]
        approval = self.policy.approval_for(provider_id)
        routing = RoutingPolicy(
            route.provider_ids,
            required_boundary=approval.boundary,
            required_retention=approval.retention,
            required_region=approval.regions[0] if approval.regions else None,
        )
        if approval.credential_ref is None:
            credential_scope: Any = nullcontext(None)
        else:
            grant = self.credential_grants.get(provider_id)
            if grant is None or self.credential_resolver is None:
                raise ProviderFailure(
                    FailureCode.AUTHENTICATION,
                    "No invocation-scoped credential grant is available",
                    provider_id=provider_id,
                )
            credential_scope = self.credential_resolver.lease(
                grant,
                provider_id=provider_id,
                credential_ref=approval.credential_ref,
            )
        with credential_scope as credential:
            context = RequestContext(
                idempotency_key=idempotency_key,
                approved_provider_id=provider_id,
                credential=credential,
                hard_budget_micros=self.policy.budget.hard_limit_micros,
                approved_boundary=approval.boundary,
                approved_region=approval.regions[0] if approval.regions else None,
                approved_retention=approval.retention,
                privacy_mode=self.policy.privacy_mode,
                data_classification=self.policy.data_classification,
                contains_project_content=True,
                metadata={
                    "credentialRef": approval.credential_ref or "none",
                    "termsApproved": "true" if approval.terms_approved else "false",
                    "modelAccessCheckedAt": approval.model_access_checked_at or "",
                    "accountId": approval.account_id or "",
                },
            )
            return self.router.invoke(
                request,
                context,
                routing,
                explicit_provider_id=provider_id,
            )


class ProviderTextClient:
    def __init__(self, runtime: ProviderRuntime) -> None:
        self.runtime = runtime

    def generate(self, request: TextRequest, *, idempotency_key: str) -> ProviderResult[TextOutput]:
        result = self.runtime.invoke(request, idempotency_key=idempotency_key)
        if not isinstance(result.value, TextOutput):
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Text provider returned a non-text result",
                provider_id=result.provider_id,
            )
        return ProviderResult(
            result.provider_id,
            result.model,
            result.value,
            result.usage,
            result.raw_id,
        )


class ProviderMediaClient:
    def __init__(self, runtime: ProviderRuntime) -> None:
        self.runtime = runtime

    def generate(
        self, request: ImageRequest | SpeechRequest, *, idempotency_key: str
    ) -> ProviderResult[MediaOutput]:
        result = self.runtime.invoke(request, idempotency_key=idempotency_key)
        if not isinstance(result.value, MediaOutput):
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Media provider returned a non-media result",
                provider_id=result.provider_id,
            )
        return ProviderResult(
            result.provider_id,
            result.model,
            result.value,
            result.usage,
            result.raw_id,
        )


class ProviderRuntimeFactory:
    """Build only adapters named by an already-validated project policy."""

    def __init__(
        self,
        *,
        transport_factory: TransportFactory,
        credential_resolver: CredentialGrantResolver | None = None,
        credential_grants: Mapping[str, CredentialGrant] | None = None,
    ) -> None:
        self.transport_factory = transport_factory
        self.credential_resolver = credential_resolver
        self.credential_grants = dict(credential_grants or {})

    def build(self, policy: TutorialRoutingPolicy) -> ProviderRuntime:
        adapters: list[ProviderAdapter] = []
        for approval in policy.approvals:
            adapters.extend(self._adapters_for(approval, policy))
        grants = dict(self.credential_grants)
        for approval in policy.approvals:
            if approval.credential_ref is not None and approval.provider_id not in grants:
                grants[approval.provider_id] = CredentialGrant(secrets.token_urlsafe(24))
        runtime = ProviderRuntime(
            policy,
            ProviderRouter(tuple(adapters)),
            self.credential_resolver,
            grants,
        )
        # Credential availability is checked before workflow enqueue. This
        # transfers no project content and leaves no value in a project/job.
        for approval in policy.approvals:
            if approval.credential_ref is None:
                continue
            grant = grants[approval.provider_id]
            if self.credential_resolver is None:
                raise ProviderFailure(
                    FailureCode.AUTHENTICATION,
                    "The desktop keyring broker is unavailable",
                    provider_id=approval.provider_id,
                )
            with self.credential_resolver.lease(
                grant,
                provider_id=approval.provider_id,
                credential_ref=approval.credential_ref,
            ):
                pass
        return runtime

    def _adapters_for(
        self, approval: ProviderApproval, policy: TutorialRoutingPolicy
    ) -> list[ProviderAdapter]:
        provider_id = approval.provider_id
        if provider_id == "mock":
            return [MockProviderAdapter()]
        # The local runtime is resolved by the capability-specific generation
        # boundary.  It must never acquire a transport or be treated as a
        # cloud/provider fallback by this router.
        if provider_id == "local-runtime":
            return []
        transport = self.transport_factory(provider_id)
        adapters: list[ProviderAdapter] = []
        if provider_id == "openai":
            adapters.append(OpenAIResponsesAdapter(transport))
        elif provider_id == "anthropic":
            adapters.append(AnthropicMessagesAdapter(transport))
        elif provider_id == "gemini":
            adapters.append(GeminiInteractionsAdapter(transport))
        elif provider_id in {"groq", "mistral", "openrouter"}:
            adapters.append(launch_structured_cloud_adapter(provider_id, transport))
        elif provider_id == "openai-compatible-local":
            adapters.append(OpenAICompatibleLocalAdapter(transport))
        elif provider_id == "nvidia-nim":
            route_models = tuple(
                route.model
                for route in policy.routes
                if provider_id in route.provider_ids
            )
            adapters.append(
                NvidiaNimAdapter(
                    transport,
                    configured_visual_models=configured_nvidia_visual_models(route_models),
                    configured_tts_models=configured_nvidia_tts_models(route_models),
                )
            )
        elif provider_id == "cloudflare-workers-ai":
            adapters.append(CloudflareWorkersAIAdapter(transport))
        for adapter in adapters:
            if isinstance(
                adapter,
                (
                    OpenAIResponsesAdapter,
                    AnthropicMessagesAdapter,
                    GeminiInteractionsAdapter,
                    OpenAICompatibleLocalAdapter,
                ),
            ):
                cast(Any, adapter).descriptor = replace(
                    adapter.descriptor,
                    capabilities=frozenset(
                        value
                        for value in adapter.descriptor.capabilities
                        if value
                        in {
                            Capability.LLM_TEXT,
                            Capability.LLM_STRUCTURED,
                            Capability.RESEARCH,
                        }
                    ),
                )
        if provider_id in launch_media_provider_ids():
            media_route_models = {
                route.capability: route.model
                for route in policy.routes
                if provider_id in route.provider_ids
            }
            adapters.append(
                launch_media_adapter(
                    provider_id,
                    transport,
                    prices=launch_route_unit_prices(provider_id, media_route_models),
                )
            )
        if not adapters:
            raise ValueError(f"provider {provider_id!r} has no launch runtime adapter")

        # Region values are catalog-approved disclosure choices. Preserve them
        # on the generation-scoped descriptor so Router and GuardedAdapter both
        # enforce exactly the approved endpoint region.
        for adapter in adapters:
            cast(Any, adapter).descriptor = replace(
                adapter.descriptor,
                data_policy=replace(adapter.descriptor.data_policy, regions=approval.regions),
            )
        return adapters
