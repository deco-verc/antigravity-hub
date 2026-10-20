from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse


DEFAULT_BLOCKED_PATHS = [
    "/login",
    "/signup",
    "/register",
    "/account",
    "/billing",
    "/checkout",
    "/admin",
]

STATIC_EXTENSIONS = {
    ".7z",
    ".avi",
    ".css",
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".rar",
    ".svg",
    ".webp",
    ".xls",
    ".xlsx",
    ".xml",
    ".zip",
}

HEADERS = {"User-Agent": "Mozilla/5.0 SiteDocsExtractor/1.0"}


def normalize_url(url: str, base_url: str | None = None) -> str:
    absolute = urljoin(base_url, url) if base_url else url
    clean_url, _fragment = urldefrag(absolute.strip())
    return clean_url


def normalize_prefix(prefix: str | None) -> str | None:
    if not prefix:
        return None
    prefix = prefix.strip()
    if not prefix:
        return None
    if not prefix.startswith("/"):
        prefix = f"/{prefix}"
    return prefix


def parse_blocked_paths(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_paths = value
    else:
        raw_paths = value.split(",")
    return [path.strip() for path in raw_paths if path.strip()]


def parse_terms(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    raw_terms = value if isinstance(value, list) else value.split(",")
    return [term.strip().lower() for term in raw_terms if term.strip()]


def contains_any_term(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def slugify_project_name(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug or "site_docs"


def slugify_text(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug.lower()


def suggest_project_name_from_url(url: str) -> str:
    parsed = urlparse(validate_start_url(url))
    domain = slugify_text(parsed.netloc.replace(".", "_"))
    parts = [part for part in parsed.path.split("/") if part]
    relevant_parts: list[str] = []
    if parts:
        if "docs" in parts:
            relevant_parts = ["docs"]
        elif "reference" in parts:
            relevant_parts = ["reference"]
        elif "pushinpay" in parts:
            relevant_parts = ["pushinpay"]
        else:
            relevant_parts = [parts[0]]

    stem = "_".join([domain, *[slugify_text(part) for part in relevant_parts if part]])
    if not stem:
        return "site_docs"
    return stem if stem.endswith("_docs") else f"{stem}_docs"


def suggest_prefix_from_url(url: str) -> str:
    parsed = urlparse(validate_start_url(url))
    parts = [part for part in parsed.path.split("/") if part]
    if not parts:
        return ""
    for preferred in ("docs", "reference", "pushinpay"):
        if preferred in parts:
            return f"/{preferred}/"
    if len(parts) >= 2:
        return f"/{parts[0].strip('/')}/"
    return f"/{parts[0].strip('/')}/"


def filename_from_url(url: str, fallback: str) -> str:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    if parts:
        stem = slugify_text("_".join(parts))
    else:
        stem = slugify_text(fallback)
    return f"{stem or fallback}.md"


def unique_filename(base_name: str, used_names: set[str], existing_dir: Path | None = None) -> str:
    candidate = base_name
    stem = Path(base_name).stem
    suffix = Path(base_name).suffix or ".md"
    counter = 2
    while candidate in used_names or (existing_dir is not None and (existing_dir / candidate).exists()):
        candidate = f"{stem}_{counter:03d}{suffix}"
        counter += 1
    used_names.add(candidate)
    return candidate


def validate_start_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL inicial deve ser valida e comecar com http:// ou https://.")
    return url.strip()


def parse_manual_urls(value: str | list[str] | None) -> tuple[list[str], list[str]]:
    if value is None:
        return [], []
    raw_urls = value if isinstance(value, list) else value.splitlines()
    valid_urls: list[str] = []
    invalid_urls: list[str] = []
    seen: set[str] = set()
    for raw_url in raw_urls:
        url = str(raw_url).strip()
        if not url:
            continue
        try:
            normalized = normalize_url(validate_start_url(url))
        except ValueError:
            invalid_urls.append(url)
            continue
        if normalized not in seen:
            seen.add(normalized)
            valid_urls.append(normalized)
    return valid_urls, invalid_urls


def is_static_asset(url: str) -> bool:
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix in STATIC_EXTENSIONS


def is_url_allowed(
    url: str,
    allowed_domain: str,
    allowed_prefix: str | None,
    blocked_paths: list[str],
) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    if parsed.netloc != allowed_domain:
        return False
    if is_static_asset(url):
        return False
    if allowed_prefix and not parsed.path.startswith(allowed_prefix):
        return False
    return not any(parsed.path.startswith(path) for path in blocked_paths if path)


def create_run_directory(outputs_dir: Path, project_name: str) -> Path:
    outputs_dir.mkdir(parents=True, exist_ok=True)
    safe_name = slugify_project_name(project_name)
    candidate = outputs_dir / safe_name
    if not candidate.exists():
        candidate.mkdir()
        return candidate

    counter = 1
    while True:
        candidate = outputs_dir / f"{safe_name}_{counter:03d}"
        if not candidate.exists():
            candidate.mkdir()
            return candidate
        counter += 1
