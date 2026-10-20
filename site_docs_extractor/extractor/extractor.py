from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import time

from bs4 import BeautifulSoup
import trafilatura

LogFn = Callable[[str], None]
REQUEST_RETRIES = 2
RETRY_DELAY_SECONDS = 1.0


@dataclass
class PageExtraction:
    url: str
    status: str
    content: str | None = None
    error: str | None = None


def extract_markdown(
    url: str,
    include_links: bool = True,
    include_tables: bool = True,
    log: LogFn | None = None,
    css_include: str | None = None,
    css_remove: str | None = None,
) -> PageExtraction:
    try:
        html = None
        last_error: Exception | None = None
        for attempt in range(REQUEST_RETRIES + 1):
            try:
                html = trafilatura.fetch_url(url)
                if html:
                    break
                if attempt < REQUEST_RETRIES:
                    if log:
                        log(f"[RETRY] Extracao {url} tentativa {attempt + 2}/{REQUEST_RETRIES + 1}")
                    time.sleep(RETRY_DELAY_SECONDS)
            except Exception as exc:
                last_error = exc
                if attempt < REQUEST_RETRIES:
                    if log:
                        log(f"[RETRY] Extracao {url} tentativa {attempt + 2}/{REQUEST_RETRIES + 1}: {exc}")
                    time.sleep(RETRY_DELAY_SECONDS)
                else:
                    raise

        if not html:
            if last_error:
                return PageExtraction(url=url, status="failed", error=str(last_error))
            return PageExtraction(url=url, status="failed", error="Nao foi possivel baixar HTML.")

        return extract_markdown_from_html(html, url, include_links, include_tables, css_include, css_remove)
    except Exception as exc:
        return PageExtraction(url=url, status="failed", error=str(exc))


def extract_markdown_from_html(
    html: str,
    url: str,
    include_links: bool = True,
    include_tables: bool = True,
    css_include: str | None = None,
    css_remove: str | None = None,
) -> PageExtraction:
    try:
        html = apply_css_filters(html, css_include=css_include, css_remove=css_remove)
        content = trafilatura.extract(
            html,
            url=url,
            output_format="markdown",
            include_links=include_links,
            include_images=False,
            include_tables=include_tables,
        )

        if not content or len(content.strip()) < 50:
            return PageExtraction(url=url, status="failed", error="Conteudo util insuficiente.")

        return PageExtraction(url=url, status="ok", content=content.strip())
    except Exception as exc:
        return PageExtraction(url=url, status="failed", error=str(exc))


def split_css_selectors(value: str | None) -> list[str]:
    if not value:
        return []
    return [selector.strip() for selector in value.split(",") if selector.strip()]


def apply_css_filters(html: str, css_include: str | None = None, css_remove: str | None = None) -> str:
    include_selectors = split_css_selectors(css_include)
    remove_selectors = split_css_selectors(css_remove)
    if not include_selectors and not remove_selectors:
        return html

    soup = BeautifulSoup(html, "html.parser")

    for selector in remove_selectors:
        try:
            for tag in soup.select(selector):
                tag.decompose()
        except Exception:
            continue

    if include_selectors:
        selected = []
        for selector in include_selectors:
            try:
                selected.extend(soup.select(selector))
            except Exception:
                continue
        if selected:
            body = BeautifulSoup("<html><body></body></html>", "html.parser")
            body_tag = body.body
            if body_tag is not None:
                for tag in selected:
                    body_tag.append(BeautifulSoup(str(tag), "html.parser"))
                return str(body)

    return str(soup)
