from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Event
from urllib.parse import urlparse

from .browser_extractor import BrowserHtmlFetcher
from .crawler import discover_links
from .exporter import (
    build_complete_file,
    build_extraction_report,
    build_knowledge_ready_file,
    write_json,
    write_log,
    write_page_file,
)
from .extractor import PageExtraction, extract_markdown, extract_markdown_from_html
from .utils import (
    DEFAULT_BLOCKED_PATHS,
    create_run_directory,
    normalize_prefix,
    normalize_url,
    parse_blocked_paths,
    parse_manual_urls,
    parse_terms,
    contains_any_term,
    is_url_allowed,
    slugify_project_name,
    suggest_prefix_from_url,
    suggest_project_name_from_url,
    validate_start_url,
)


LogFn = Callable[[str], None]
ProgressFn = Callable[[int, int], None]
StatusFn = Callable[[dict[str, object]], None]


@dataclass
class ExtractionConfig:
    start_url: str
    project_name: str
    allowed_prefix: str | None = None
    max_pages: int = 50
    delay: float = 1.0
    extra_blocked_paths: list[str] | None = None
    include_links: bool = True
    include_tables: bool = True
    use_playwright: bool = False
    clean_markdown: bool = True
    required_terms: list[str] | None = None
    blocked_terms: list[str] | None = None
    css_include: str | None = None
    css_remove: str | None = None
    manual_urls: list[str] | str | None = None
    skip_crawl: bool = False
    ignore_prefix_for_manual: bool = False
    deduplicate_global_repeated_text: bool = True


@dataclass
class ExtractionSummary:
    total_urls: int
    success_count: int
    fail_count: int
    run_dir: str
    complete_file: str
    index_file: str
    log_file: str
    knowledge_ready_file: str = ""
    report_file: str = ""
    cancelled: bool = False
    manual_url_count: int = 0
    manual_ignored_count: int = 0
    duplicated_blocks: int = 0
    dedup_removed_repetitions: int = 0
    dedup_affected_pages: int = 0


def run_extraction(
    config: ExtractionConfig,
    outputs_dir: Path,
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
    status: StatusFn | None = None,
    cancel_event: Event | None = None,
) -> ExtractionSummary:
    log_lines: list[str] = []

    def emit(message: str) -> None:
        stamped = f"{time.strftime('%H:%M:%S')} {message}"
        log_lines.append(stamped)
        if log:
            log(stamped)

    def is_cancelled() -> bool:
        return bool(cancel_event and cancel_event.is_set())

    def emit_status(
        current_url: str = "",
        total_urls: int = 0,
        processed: int = 0,
        successes: int = 0,
        failures: int = 0,
    ) -> None:
        if status:
            status(
                {
                    "current_url": current_url,
                    "total_urls": total_urls,
                    "processed": processed,
                    "successes": successes,
                    "failures": failures,
                }
            )

    start_url = normalize_url(validate_start_url(config.start_url))
    suggested_project_name = suggest_project_name_from_url(start_url)
    suggested_prefix = suggest_prefix_from_url(start_url)

    project_name = slugify_project_name(config.project_name)
    allowed_prefix = normalize_prefix(config.allowed_prefix)
    extra_blocked = parse_blocked_paths(config.extra_blocked_paths)
    blocked_paths = DEFAULT_BLOCKED_PATHS + extra_blocked
    max_pages = max(1, int(config.max_pages))
    delay = max(0.0, float(config.delay))
    manual_urls, invalid_manual_urls = parse_manual_urls(config.manual_urls)
    skip_crawl = bool(config.skip_crawl or manual_urls or invalid_manual_urls)

    run_dir = create_run_directory(outputs_dir, project_name)
    pages_dir = run_dir / "pages"
    pages_dir.mkdir()

    normalized_config = ExtractionConfig(
        start_url=start_url,
        project_name=project_name,
        allowed_prefix=allowed_prefix,
        max_pages=max_pages,
        delay=delay,
        extra_blocked_paths=extra_blocked,
        include_links=bool(config.include_links),
        include_tables=bool(config.include_tables),
        use_playwright=bool(config.use_playwright),
        clean_markdown=bool(config.clean_markdown),
        required_terms=parse_terms(config.required_terms),
        blocked_terms=parse_terms(config.blocked_terms),
        css_include=(config.css_include or "").strip() or None,
        css_remove=(config.css_remove or "").strip() or None,
        manual_urls=manual_urls,
        skip_crawl=skip_crawl,
        ignore_prefix_for_manual=bool(config.ignore_prefix_for_manual),
        deduplicate_global_repeated_text=bool(config.deduplicate_global_repeated_text),
    )

    write_json(
        run_dir / "run_config.json",
        asdict(normalized_config)
        | {
            "blocked_paths": blocked_paths,
            "invalid_manual_urls": invalid_manual_urls,
        },
    )

    emit("==============================")
    emit("Site Docs Extractor")
    emit(f"URL inicial: {start_url}")
    emit(f"Projeto: {project_name}")
    emit(f"Projeto sugerido: {suggested_project_name}")
    emit(f"Prefixo sugerido: {suggested_prefix or '-'}")
    emit(f"Pasta: {run_dir.resolve()}")
    emit("==============================")
    if normalized_config.use_playwright:
        emit("[PLAYWRIGHT] Modo Playwright ativado para extracao de conteudo.")

    manual_ignored_entries: list[dict[str, object]] = []
    if skip_crawl:
        emit("[MANUAL] Modo URLs manuais ativado. Descoberta automática ignorada.")
        emit(f"[MANUAL] URLs manuais informadas: {len(manual_urls) + len(invalid_manual_urls)}")
        for invalid_url in invalid_manual_urls:
            emit(f"[MANUAL] URL ignorada por validação: {invalid_url}")
            manual_ignored_entries.append(
                {
                    "url": invalid_url,
                    "status": "ignored",
                    "file": None,
                    "chars": 0,
                    "error": "URL manual ignorada: URL invalida.",
                    "reason": "manual_validation",
                }
            )

        links = []
        manual_prefix = None if normalized_config.ignore_prefix_for_manual else allowed_prefix
        allowed_domain = urlparse(start_url).netloc
        for url in manual_urls[:max_pages]:
            if is_url_allowed(url, allowed_domain=allowed_domain, allowed_prefix=manual_prefix, blocked_paths=blocked_paths):
                links.append(url)
            else:
                emit(f"[MANUAL] URL ignorada por domínio, prefixo, path bloqueado ou arquivo estático: {url}")
                manual_ignored_entries.append(
                    {
                        "url": url,
                        "status": "ignored",
                        "file": None,
                        "chars": 0,
                        "error": "URL manual ignorada por dominio, prefixo, path bloqueado ou arquivo estatico.",
                        "reason": "manual_filter",
                    }
                )
    else:
        links = discover_links(
            start_url=start_url,
            allowed_prefix=allowed_prefix,
            max_pages=max_pages,
            delay=delay,
            blocked_paths=blocked_paths,
            log=emit,
            progress=lambda current, total: progress(current, total * 2) if progress else None,
            should_cancel=is_cancelled,
        )

    emit(f"[INFO] Total de URLs encontradas: {len(links)}")
    emit_status(total_urls=len(links))

    index_entries: list[dict[str, object]] = list(manual_ignored_entries)
    page_files: list[Path] = []
    used_page_names: set[str] = set()
    success_count = 0
    fail_count = 0

    browser_fetcher = BrowserHtmlFetcher(log=emit) if normalized_config.use_playwright else None

    def extract_current_url(url: str) -> PageExtraction:
        if browser_fetcher is None:
            return extract_markdown(
                url=url,
                include_links=normalized_config.include_links,
                include_tables=normalized_config.include_tables,
                log=emit,
                css_include=normalized_config.css_include,
                css_remove=normalized_config.css_remove,
            )

        try:
            html = browser_fetcher.fetch_html(url)
            return extract_markdown_from_html(
                html=html,
                url=url,
                include_links=normalized_config.include_links,
                include_tables=normalized_config.include_tables,
                css_include=normalized_config.css_include,
                css_remove=normalized_config.css_remove,
            )
        except Exception as exc:
            return PageExtraction(url=url, status="failed", error=str(exc))

    try:
        if browser_fetcher is not None:
            browser_fetcher.__enter__()

        for position, url in enumerate(links, start=1):
            if is_cancelled():
                emit("[CANCELADO] Extracao interrompida pelo usuario.")
                break

            emit(f"[{position}/{len(links)}] Extraindo: {url}")
            emit_status(url, len(links), position - 1, success_count, fail_count)
            result = extract_current_url(url)

            if result.status == "ok" and result.content:
                if normalized_config.required_terms and not contains_any_term(result.content, normalized_config.required_terms):
                    result = PageExtraction(
                        url=url,
                        status="ignored",
                        error="Ignorada: nao contem termos obrigatorios.",
                        content=result.content,
                    )
                elif normalized_config.blocked_terms and contains_any_term(result.content, normalized_config.blocked_terms):
                    result = PageExtraction(
                        url=url,
                        status="ignored",
                        error="Ignorada: contem termo bloqueado.",
                        content=result.content,
                    )

            if result.status != "ok" or not result.content:
                if result.status == "ignored":
                    emit(f"[IGNORADA] {url}: {result.error}")
                else:
                    emit(f"[FALHA] {url}: {result.error}")
                index_entries.append(
                    {
                        "url": url,
                        "status": result.status,
                        "file": None,
                        "chars": len(result.content or ""),
                        "error": result.error,
                    }
                )
                if result.status == "failed":
                    fail_count += 1
            else:
                file_path = write_page_file(
                    pages_dir,
                    len(page_files) + 1,
                    url,
                    project_name,
                    result.content,
                    used_names=used_page_names,
                    clean_content=normalized_config.clean_markdown,
                )
                page_files.append(file_path)
                emit(f"[OK] Pagina salva: {file_path.name}")
                index_entries.append(
                    {
                        "url": url,
                        "status": "ok",
                        "file": str(file_path.relative_to(run_dir)),
                        "chars": len(result.content),
                        "error": None,
                    }
                )
                success_count += 1

            if progress:
                progress(len(links) + position, max(len(links) * 2, 1))
            emit_status(url, len(links), position, success_count, fail_count)
            if delay > 0 and position < len(links):
                time.sleep(delay)
    finally:
        if browser_fetcher is not None:
            browser_fetcher.close()

    complete_file = build_complete_file(run_dir, project_name, page_files, clean_content=normalized_config.clean_markdown)
    dedup_stats: dict[str, object] = {}
    knowledge_ready_file = build_knowledge_ready_file(
        run_dir,
        project_name,
        page_files,
        deduplicate_global=normalized_config.deduplicate_global_repeated_text,
        dedup_stats=dedup_stats,
    )
    report_file = build_extraction_report(
        run_dir,
        project_name,
        len(links),
        index_entries,
        allowed_prefix=normalized_config.allowed_prefix,
        required_terms=normalized_config.required_terms or [],
        blocked_terms=normalized_config.blocked_terms or [],
        css_include=normalized_config.css_include,
        css_remove=normalized_config.css_remove,
        manual_mode=skip_crawl,
        manual_url_count=len(manual_urls) + len(invalid_manual_urls),
        manual_ignored_count=len(manual_ignored_entries),
        suggested_project_name=suggested_project_name,
        suggested_prefix=suggested_prefix,
        deduplicate_global=normalized_config.deduplicate_global_repeated_text,
        dedup_stats=dedup_stats,
    )
    index_file = write_json(run_dir / f"{project_name}_index.json", index_entries)
    log_file = run_dir / "extraction_log.txt"

    cancelled = is_cancelled()

    emit("==============================")
    emit("CANCELADO" if cancelled else "FINALIZADO")
    emit(f"URLs encontradas: {len(links)}")
    if skip_crawl:
        emit(f"URLs manuais informadas: {len(manual_urls) + len(invalid_manual_urls)}")
        emit(f"URLs manuais ignoradas: {len(manual_ignored_entries)}")
    emit(f"Paginas extraidas: {success_count}")
    emit(f"Falhas: {fail_count}")
    if cancelled:
        emit("Execucao cancelada pelo usuario. Arquivos parciais foram preservados.")
    emit(f"Pasta criada: {run_dir.resolve()}")
    emit(f"Arquivo completo: {complete_file.resolve()}")
    emit(f"Knowledge ready: {knowledge_ready_file.resolve()}")
    emit(f"Relatorio: {report_file.resolve()}")
    emit(
        "Deduplicacao global: "
        f"{'ligada' if normalized_config.deduplicate_global_repeated_text else 'desligada'} | "
        f"blocos={dedup_stats.get('duplicated_blocks', 0)} | "
        f"removidas={dedup_stats.get('removed_repetitions', 0)}"
    )

    write_log(log_file, log_lines)

    return ExtractionSummary(
        total_urls=len(links),
        success_count=success_count,
        fail_count=fail_count,
        run_dir=str(run_dir.resolve()),
        complete_file=str(complete_file.resolve()),
        index_file=str(index_file.resolve()),
        log_file=str(log_file.resolve()),
        knowledge_ready_file=str(knowledge_ready_file.resolve()),
        report_file=str(report_file.resolve()),
        cancelled=cancelled,
        manual_url_count=len(manual_urls) + len(invalid_manual_urls),
        manual_ignored_count=len(manual_ignored_entries),
        duplicated_blocks=int(dedup_stats.get("duplicated_blocks", 0)),
        dedup_removed_repetitions=int(dedup_stats.get("removed_repetitions", 0)),
        dedup_affected_pages=int(dedup_stats.get("affected_pages", 0)),
    )
