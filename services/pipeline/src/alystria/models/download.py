"""Resumable, staged model download contracts and a conservative HTTP adapter."""

from __future__ import annotations

import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .errors import DownloadError
from .policy import NetworkPolicy, NetworkPurpose

ProgressCallback = Callable[[int, int], None]
_CONTENT_RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")


@dataclass(frozen=True, slots=True)
class DownloadRequest:
    urls: tuple[str, ...]
    destination: Path
    expected_size: int
    network_policy: NetworkPolicy


@dataclass(frozen=True, slots=True)
class DownloadResult:
    destination: Path
    bytes_written: int
    resumed_from: int
    source_url: str


class Downloader(Protocol):
    def download(
        self,
        request: DownloadRequest,
        progress: ProgressCallback | None = None,
    ) -> DownloadResult: ...


class HttpRangeDownloader:
    """Download to a caller-owned `.part` file with strict HTTP range handling."""

    def __init__(self, *, chunk_size: int = 1024 * 1024, timeout_seconds: float = 60.0) -> None:
        if chunk_size < 64 * 1024:
            raise ValueError("chunk_size is too small")
        self._chunk_size = chunk_size
        self._timeout_seconds = timeout_seconds

    def download(
        self,
        request: DownloadRequest,
        progress: ProgressCallback | None = None,
    ) -> DownloadResult:
        request.destination.parent.mkdir(parents=True, exist_ok=True)
        existing = request.destination.stat().st_size if request.destination.exists() else 0
        if existing > request.expected_size:
            raise DownloadError("staged download is larger than the signed manifest size")
        if existing == request.expected_size:
            return DownloadResult(request.destination, existing, existing, "staged-cache")

        failures: list[str] = []
        for url in request.urls:
            try:
                request.network_policy.assert_url(url, NetworkPurpose.MODEL_DOWNLOAD)
                return self._download_one(request, url, existing, progress)
            except (DownloadError, OSError, urllib.error.URLError) as exc:
                failures.append(f"{url}: {exc}")
        raise DownloadError("all immutable model sources failed: " + "; ".join(failures))

    def _download_one(
        self,
        request: DownloadRequest,
        url: str,
        existing: int,
        progress: ProgressCallback | None,
    ) -> DownloadResult:
        headers = {
            "Accept-Encoding": "identity",
            "User-Agent": "Alystria-Studio/2 model-runtime",
        }
        if existing:
            headers["Range"] = f"bytes={existing}-"
        http_request = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(http_request, timeout=self._timeout_seconds) as response:
            status = getattr(response, "status", response.getcode())
            if existing:
                content_range = response.headers.get("Content-Range", "")
                match = _CONTENT_RANGE.fullmatch(content_range)
                if status != 206 or match is None or int(match.group(1)) != existing:
                    raise DownloadError("server did not honor the exact resume range")
                if int(match.group(3)) != request.expected_size:
                    raise DownloadError("server size differs from the signed manifest")
            elif status != 200:
                raise DownloadError(f"unexpected HTTP status {status}")

            mode = "ab" if existing else "wb"
            written = existing
            with request.destination.open(mode) as output:
                while True:
                    chunk = response.read(self._chunk_size)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > request.expected_size:
                        raise DownloadError("download exceeded the signed manifest size")
                    output.write(chunk)
                    if progress:
                        progress(written, request.expected_size)
                output.flush()
                os.fsync(output.fileno())
        if written != request.expected_size:
            raise DownloadError(f"incomplete download: {written}/{request.expected_size} bytes")
        return DownloadResult(request.destination, written, existing, url)
