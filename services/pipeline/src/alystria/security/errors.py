"""Exceptions raised at Alystria trust boundaries."""


class SecurityViolation(ValueError):
    """Input is unsafe and must not cross the boundary."""


class ValidationError(SecurityViolation):
    """Input is malformed or inconsistent with its declared form."""


class PolicyViolation(SecurityViolation):
    """Input is well-formed but forbidden by the active product policy."""
