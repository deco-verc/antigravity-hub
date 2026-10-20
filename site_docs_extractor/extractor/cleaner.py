from __future__ import annotations

import re


COMMON_MENU_LINES = {
    "home",
    "inicio",
    "início",
    "menu",
    "login",
    "log in",
    "sign in",
    "signup",
    "sign up",
    "register",
    "cadastro",
    "contato",
    "contact",
    "privacy",
    "privacidade",
    "terms",
    "termos",
    "voltar",
    "next",
    "previous",
    "was this section helpful",
    "on this page",
    "table of contents",
    "edit this page",
    "copy",
    "copied",
    "api reference",
    "introduction",
    "anterior",
    "próximo",
    "proximo",
}


def normalize_spaces(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def is_structured_line(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith(("#", "-", "*", "+", ">", "|", "```")) or bool(re.match(r"^\d+\.", stripped))


def is_common_menu_line(line: str) -> bool:
    normalized = re.sub(r"[^a-zA-ZÀ-ÿ0-9 ]+", "", line).strip().lower()
    if len(normalized) > 35:
        return False
    return normalized in COMMON_MENU_LINES


def is_technical_line(line: str) -> bool:
    stripped = line.strip()
    lowered = stripped.lower()
    if not stripped:
        return False
    if is_structured_line(stripped):
        return True
    if "http://" in lowered or "https://" in lowered:
        return True
    if re.match(r"^(get|post|put|patch|delete|head|options)\s+/", stripped, re.IGNORECASE):
        return True
    if re.match(r"^/?[a-z0-9_./{}:-]+$", stripped, re.IGNORECASE) and "/" in stripped:
        return True
    if re.search(r"\b(status|authorization|content-type|bearer|api[-_ ]?key)\b", lowered):
        return True
    if re.search(r"\b[1-5][0-9]{2}\b", stripped):
        return True
    if any(char in stripped for char in "{}[]"):
        return True
    if re.match(r"^[\"']?[a-zA-Z0-9_-]+[\"']?\s*:", stripped):
        return True
    return False


def normalize_dedup_key(line: str) -> str:
    return re.sub(r"\s+", " ", line.strip().lower())


def is_global_dedup_candidate(line: str, in_code_block: bool) -> bool:
    stripped = line.strip()
    if in_code_block or not stripped:
        return False
    if is_common_menu_line(stripped):
        return True
    if is_technical_line(stripped):
        return False
    key = normalize_dedup_key(stripped)
    return len(key) >= 15 and len(key.split()) >= 3


def deduplicate_repeated_blocks_across_pages(
    pages: list[str],
    threshold: int = 3,
) -> tuple[list[str], dict[str, object]]:
    key_to_pages: dict[str, set[int]] = {}

    for page_index, text in enumerate(pages):
        in_code_block = False
        for line in text.splitlines():
            if line.strip().startswith("```"):
                in_code_block = not in_code_block
                continue
            if not is_global_dedup_candidate(line, in_code_block):
                continue
            key = normalize_dedup_key(line)
            key_to_pages.setdefault(key, set()).add(page_index)

    duplicate_keys = {key for key, indexes in key_to_pages.items() if len(indexes) > threshold}
    first_page_by_key = {key: min(key_to_pages[key]) for key in duplicate_keys}
    affected_pages: set[int] = set()
    removed_repetitions = 0
    cleaned_pages: list[str] = []

    for page_index, text in enumerate(pages):
        in_code_block = False
        output_lines: list[str] = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                output_lines.append(line)
                continue
            key = normalize_dedup_key(line)
            if (
                key in duplicate_keys
                and page_index != first_page_by_key[key]
                and is_global_dedup_candidate(line, in_code_block)
            ):
                removed_repetitions += 1
                affected_pages.add(page_index)
                continue
            output_lines.append(line)
        cleaned_pages.append(remove_excess_blank_lines("\n".join(output_lines)))

    stats = {
        "threshold": threshold,
        "duplicated_blocks": len(duplicate_keys),
        "removed_repetitions": removed_repetitions,
        "affected_pages": len(affected_pages),
    }
    return cleaned_pages, stats


def remove_repeated_lines(text: str) -> str:
    seen_counts: dict[str, int] = {}
    output: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        key = stripped.lower()
        if not stripped:
            output.append("")
            continue
        if is_structured_line(stripped):
            output.append(line)
            continue

        seen_counts[key] = seen_counts.get(key, 0) + 1
        if seen_counts[key] <= 1:
            output.append(line)

    return "\n".join(output)


def remove_repetitive_short_blocks(text: str) -> str:
    paragraphs = re.split(r"\n{2,}", text)
    seen_short: set[str] = set()
    kept: list[str] = []

    for paragraph in paragraphs:
        cleaned = paragraph.strip()
        key = re.sub(r"\s+", " ", cleaned.lower())
        if not cleaned:
            continue
        if len(key) < 80 and not any(is_structured_line(line) for line in cleaned.splitlines()):
            if key in seen_short:
                continue
            seen_short.add(key)
        kept.append(cleaned)

    return "\n\n".join(kept)


def remove_common_menus(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not is_structured_line(stripped) and is_common_menu_line(stripped):
            continue
        lines.append(line)
    return "\n".join(lines)


def remove_excess_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def clean_markdown(text: str) -> str:
    cleaned = normalize_spaces(text)
    cleaned = remove_common_menus(cleaned)
    cleaned = remove_repeated_lines(cleaned)
    cleaned = remove_repetitive_short_blocks(cleaned)
    cleaned = remove_excess_blank_lines(cleaned)
    return cleaned.strip() + "\n" if cleaned else ""


def strip_frontmatter(text: str) -> str:
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            return text[end + 5 :].lstrip()
    return text
