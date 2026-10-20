from __future__ import annotations

import time
from collections.abc import Callable
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from .utils import HEADERS, is_url_allowed, normalize_prefix, normalize_url


LogFn = Callable[[str], None]
ProgressFn = Callable[[int, int], None]
CancelFn = Callable[[], bool]
REQUEST_RETRIES = 2
RETRY_DELAY_SECONDS = 1.0


def fetch_html(url: str, session: requests.Session, timeout: int = 30) -> str:
    response = session.get(url, headers=HEADERS, timeout=timeout)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type and "application/xhtml" not in content_type and content_type:
        raise ValueError(f"Conteudo nao HTML: {content_type}")
    return response.text


def fetch_html_with_retry(url: str, session: requests.Session, log: LogFn | None = None) -> str:
    last_error: Exception | None = None
    for attempt in range(REQUEST_RETRIES + 1):
        try:
            return fetch_html(url, session)
        except requests.RequestException as exc:
            last_error = exc
            if attempt < REQUEST_RETRIES:
                if log:
                    log(f"[RETRY] Links {url} tentativa {attempt + 2}/{REQUEST_RETRIES + 1}")
                time.sleep(RETRY_DELAY_SECONDS)
        except Exception:
            raise
    if last_error:
        raise last_error
    raise RuntimeError("Falha inesperada ao baixar HTML.")


def discover_links(
    start_url: str,
    allowed_prefix: str | None,
    max_pages: int,
    delay: float,
    blocked_paths: list[str],
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
    should_cancel: CancelFn | None = None,
) -> list[str]:
    start_url = normalize_url(start_url)
    allowed_prefix = normalize_prefix(allowed_prefix)
    allowed_domain = urlparse(start_url).netloc

    queue = [start_url]
    visited: set[str] = set()
    found: list[str] = []
    found_set: set[str] = set()

    with requests.Session() as session:
        while queue and len(found) < max_pages:
            if should_cancel and should_cancel():
                if log:
                    log("[CANCELADO] Descoberta de links interrompida pelo usuario.")
                break

            current_url = queue.pop(0)
            if current_url in visited:
                continue
            visited.add(current_url)

            if not is_url_allowed(current_url, allowed_domain, allowed_prefix, blocked_paths):
                continue

            if log:
                log(f"[LINKS] Lendo: {current_url}")

            try:
                html = fetch_html_with_retry(current_url, session, log)
            except Exception as exc:
                if log:
                    log(f"[AVISO] Falha ao ler links em {current_url}: {exc}")
                continue

            found.append(current_url)
            found_set.add(current_url)

            soup = BeautifulSoup(html, "html.parser")
            for anchor in soup.select("a[href]"):
                href = normalize_url(anchor.get("href", ""), current_url)
                if not href or href in visited or href in queue or href in found_set:
                    continue
                if is_url_allowed(href, allowed_domain, allowed_prefix, blocked_paths):
                    queue.append(href)

            if progress:
                progress(len(found), max_pages)
            if delay > 0 and queue and len(found) < max_pages:
                time.sleep(delay)

    return found
