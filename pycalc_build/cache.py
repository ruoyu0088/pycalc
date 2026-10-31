"""Download helpers with a persistent cache and atomic writes."""

from __future__ import annotations

import hashlib
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from .config import USER_AGENT


class DownloadError(RuntimeError):
    """A resource could not be downloaded."""


class OfflineMissing(DownloadError):
    """The resource is not cached and --offline was requested."""


class NotFound(DownloadError):
    """The server answered 404/410 for the resource."""


def human_size(num: int | float) -> str:
    value = float(num)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024.0 or unit == "GiB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.2f} {unit}"
        value /= 1024.0
    return f"{value:.2f} GiB"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_sha256(path: Path, expected: str, log: Callable[[str], None] | None = None) -> None:
    actual = sha256_file(path)
    if actual.lower() != expected.lower():
        if log:
            log(f"[校验失败] {path.name}: {actual[:16]}… != {expected[:16]}…")
        raise DownloadError(
            f"校验失败：{path} 的 SHA256 与 lock 文件不一致（{actual} != {expected}）"
        )


def download(
    url: str,
    dest: Path,
    *,
    offline: bool = False,
    refresh: bool = False,
    timeout: float = 60.0,
    retries: int = 3,
    log: Callable[[str], None] | None = None,
) -> Path:
    """Download *url* to *dest* unless it is already cached.

    The file is written to a temporary sibling and renamed, so an interrupted
    build never leaves a truncated file that is mistaken for a valid cache hit.
    """

    dest = Path(dest)
    if dest.exists() and not refresh:
        return dest
    if offline:
        raise OfflineMissing(
            f"离线模式下缺少缓存文件：{dest}\n"
            f"请先在联网状态运行一次构建，或去掉 --offline。"
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            if log:
                log(f"下载 {url} …")
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "*/*",
                    "Accept-Encoding": "identity",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                total = response.headers.get("Content-Length")
                expected = int(total) if total and total.isdigit() else None
                received = 0
                with tmp.open("wb") as out:
                    while True:
                        chunk = response.read(1024 * 256)
                        if not chunk:
                            break
                        out.write(chunk)
                        received += len(chunk)
                if expected is not None and received != expected:
                    raise DownloadError(
                        f"下载不完整：{url}（收到 {received} / {expected} 字节）"
                    )
            os.replace(tmp, dest)
            if log:
                log(f"  -> {dest.name} ({human_size(dest.stat().st_size)})")
            return dest
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in (404, 410):
                raise NotFound(f"资源不存在（HTTP {exc.code}）：{url}") from exc
            if exc.code < 500 or attempt == retries:
                break
        except (urllib.error.URLError, TimeoutError, DownloadError, OSError) as exc:
            last_error = exc
            if attempt == retries:
                break
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass
        time.sleep(min(2.0 * attempt, 6.0))

    raise DownloadError(f"下载失败：{url}\n原因：{last_error}")
