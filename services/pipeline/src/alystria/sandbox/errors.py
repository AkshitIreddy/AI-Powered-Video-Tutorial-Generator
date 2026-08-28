"""Errors raised at the untrusted-code execution boundary."""

from __future__ import annotations


class SandboxError(RuntimeError):
    """Base class for sandbox failures that are safe to surface to callers."""


class SandboxPolicyError(SandboxError):
    """A request or runtime plan violates a mandatory sandbox policy."""


class SandboxUnavailableError(SandboxError):
    """The selected runtime is not installed or cannot prove its safety features."""


class SandboxProtocolError(SandboxError):
    """A runtime worker returned malformed or excessive data."""
