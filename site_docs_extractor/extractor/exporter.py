from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .cleaner import clean_markdown, deduplicate_repeated_blocks_across_pages, strip_frontmatter
from .utils import filename_from_url, unique_filename


def write_page_file(
    pages_dir: Path,
    index: int,
    url: str,
    project_name: str,
    content: str,
    used_names: set[str] | None = None,
    clean_content: bool = True,
) -> Path:
    pages_dir.mkdir(parents=True, exist_ok=True)
    used_names = used_names if used_names is not None else set()
    base_name = filename_from_url(url, fallback=f"pagina_{index}")
    file_name = unique_filename(base_name, used_names, pages_dir)
    file_path = pages_dir / file_name
    captured_at = datetime.now().isoformat(timespec="seconds")
    page_content = clean_markdown(content).strip() if clean_content else content.strip()
    final_content = (
        "---\n"
        f'source: "{url}"\n'
        f'project: "{project_name}"\n'
        f'captured_at: "{captured_at}"\n'
        "---\n\n"
        f"{page_content}\n"
    )
    file_path.write_text(final_content, encoding="utf-8")
    return file_path


def write_json(path: Path, data: Any) -> Path:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def build_complete_file(run_dir: Path, project_name: str, page_files: list[Path], clean_content: bool = True) -> Path:
    output_file = run_dir / f"{project_name}_completo.md"
    with output_file.open("w", encoding="utf-8") as file:
        file.write(f"# {project_name} - Conteudo Completo\n\n")
        file.write(f"Gerado em: {datetime.now().isoformat(timespec='seconds')}\n\n")
        file.write(f"Total de paginas extraidas: {len(page_files)}\n")

        for page_file in page_files:
            file.write("\n\n---\n\n")
            file.write(f"<!-- arquivo: pages/{page_file.name} -->\n\n")
            content = page_file.read_text(encoding="utf-8")
            file.write(clean_markdown(content) if clean_content else content)
    return output_file


def write_log(path: Path, log_lines: list[str]) -> Path:
    path.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
    return path


def extract_frontmatter_value(text: str, key: str) -> str:
    match = re.search(rf'^{re.escape(key)}:\s*"([^"]*)"', text, re.MULTILINE)
    return match.group(1) if match else ""


def build_knowledge_ready_file(
    run_dir: Path,
    project_name: str,
    page_files: list[Path],
    deduplicate_global: bool = True,
    dedup_stats: dict[str, object] | None = None,
) -> Path:
    output_file = run_dir / f"{project_name}_knowledge_ready.md"
    page_sections: list[dict[str, str]] = []
    for page_file in page_files:
        raw = page_file.read_text(encoding="utf-8")
        page_sections.append(
            {
                "title": page_file.stem.replace("_", " ").title(),
                "source": extract_frontmatter_value(raw, "source"),
                "content": clean_markdown(strip_frontmatter(raw)).strip(),
            }
        )

    if deduplicate_global:
        deduped_contents, stats = deduplicate_repeated_blocks_across_pages(
            [section["content"] for section in page_sections],
            threshold=3,
        )
        for section, content in zip(page_sections, deduped_contents, strict=False):
            section["content"] = content.strip()
    else:
        stats = {"threshold": 3, "duplicated_blocks": 0, "removed_repetitions": 0, "affected_pages": 0}
    if dedup_stats is not None:
        dedup_stats.update(stats)

    with output_file.open("w", encoding="utf-8") as file:
        file.write(f"# {project_name} - Knowledge Ready\n\n")
        file.write("Arquivo preparado para uso em GPT, Claude Project, Codex ou base de conhecimento.\n\n")
        file.write("## Indice\n\n")
        for index, section in enumerate(page_sections, start=1):
            title = section["title"]
            file.write(f"{index}. [{title}](#{title.lower().replace(' ', '-')})\n")

        for section in page_sections:
            title = section["title"]
            file.write("\n\n---\n\n")
            file.write(f"## {title}\n\n")
            file.write(f"Source URL: {section['source'] or 'desconhecida'}\n\n")
            file.write(f"{section['content']}\n")
    return output_file


def build_extraction_report(
    run_dir: Path,
    project_name: str,
    total_urls: int,
    index_entries: list[dict[str, object]],
    allowed_prefix: str | None = None,
    required_terms: list[str] | None = None,
    blocked_terms: list[str] | None = None,
    css_include: str | None = None,
    css_remove: str | None = None,
    manual_mode: bool = False,
    manual_url_count: int = 0,
    manual_ignored_count: int = 0,
    suggested_project_name: str | None = None,
    suggested_prefix: str | None = None,
    deduplicate_global: bool = True,
    dedup_stats: dict[str, object] | None = None,
    short_threshold: int = 500,
    long_threshold: int = 30000,
) -> Path:
    output_file = run_dir / "extraction_report.md"
    ok_entries = [entry for entry in index_entries if entry.get("status") == "ok"]
    ignored_entries = [entry for entry in index_entries if entry.get("status") == "ignored"]
    failed_entries = [entry for entry in index_entries if entry.get("status") == "failed"]
    short_entries = [entry for entry in ok_entries if int(entry.get("chars") or 0) < short_threshold]
    long_entries = [entry for entry in ok_entries if int(entry.get("chars") or 0) > long_threshold]
    playwright_candidates = failed_entries + short_entries
    top_entries = sorted(ok_entries, key=lambda entry: int(entry.get("chars") or 0), reverse=True)[:10]
    dedup_stats = dedup_stats or {"threshold": 3, "duplicated_blocks": 0, "removed_repetitions": 0, "affected_pages": 0}

    if ok_entries and not failed_entries and len(short_entries) <= max(1, len(ok_entries) // 5):
        recommendation = "extracao boa"
    elif failed_entries and len(ok_entries) == 0:
        recommendation = "talvez usar Playwright"
    elif failed_entries or len(short_entries) > len(ok_entries) // 3:
        recommendation = "extracao parcial"
    else:
        recommendation = "talvez ajustar prefixo"

    with output_file.open("w", encoding="utf-8") as file:
        file.write(f"# Relatorio de Extracao - {project_name}\n\n")
        file.write(f"- Total de URLs encontradas: {total_urls}\n")
        file.write(f"- Paginas extraidas: {len(ok_entries)}\n")
        file.write(f"- Falhas: {len(failed_entries)}\n")
        file.write(f"- Paginas ignoradas por termo: {len(ignored_entries)}\n")
        file.write(f"- Paginas com conteudo muito curto: {len(short_entries)}\n")
        file.write(f"- Paginas com conteudo muito longo: {len(long_entries)}\n")
        file.write(f"- Paginas candidatas a Playwright: {len(playwright_candidates)}\n")
        file.write(f"- Prefixo usado: {allowed_prefix or '-'}\n")
        file.write(f"- Termos obrigatorios: {', '.join(required_terms or []) or '-'}\n")
        file.write(f"- Termos bloqueados: {', '.join(blocked_terms or []) or '-'}\n")
        file.write(f"- CSS para incluir: {css_include or '-'}\n")
        file.write(f"- CSS para remover: {css_remove or '-'}\n")
        file.write(f"- Modo URLs manuais: {'sim' if manual_mode else 'nao'}\n")
        file.write(f"- URLs manuais informadas: {manual_url_count}\n")
        file.write(f"- URLs manuais ignoradas por validacao/filtro: {manual_ignored_count}\n")
        file.write(f"- Projeto sugerido automaticamente: {suggested_project_name or '-'}\n")
        file.write(f"- Prefixo sugerido automaticamente: {suggested_prefix or '-'}\n")
        file.write(f"- Deduplicacao global ligada: {'sim' if deduplicate_global else 'nao'}\n")
        file.write(f"- Blocos duplicados encontrados: {dedup_stats.get('duplicated_blocks', 0)}\n")
        file.write(f"- Repeticoes removidas: {dedup_stats.get('removed_repetitions', 0)}\n")
        file.write(f"- Paginas afetadas pela deduplicacao: {dedup_stats.get('affected_pages', 0)}\n")
        file.write(f"- Threshold de deduplicacao: {dedup_stats.get('threshold', 3)}\n")
        file.write(f"- Recomendacao: {recommendation}\n\n")

        file.write("## Top 10 Paginas Por Tamanho\n\n")
        for entry in top_entries:
            file.write(f"- {entry.get('chars', 0)} chars - {entry.get('url', '')}\n")
        if not top_entries:
            file.write("- Nenhuma pagina extraida com sucesso.\n")

        file.write("\n## Paginas Ignoradas Por Termo\n\n")
        for entry in ignored_entries:
            file.write(f"- {entry.get('url', '')}: {entry.get('error') or 'ignorada'}\n")
        if not ignored_entries:
            file.write("- Nenhuma pagina ignorada por termo.\n")

        file.write("\n## Paginas Candidatas A Playwright\n\n")
        for entry in playwright_candidates[:20]:
            file.write(f"- {entry.get('chars', 0)} chars - {entry.get('url', '')}\n")
        if not playwright_candidates:
            file.write("- Nenhuma candidata evidente.\n")

        file.write("\n## URLs Que Falharam\n\n")
        for entry in failed_entries:
            file.write(f"- {entry.get('url', '')}: {entry.get('error') or 'erro nao informado'}\n")
        if not failed_entries:
            file.write("- Nenhuma falha registrada.\n")
    return output_file


def rebuild_run_outputs(
    run_dir: Path,
    project_name: str | None = None,
    clean_content: bool = True,
    deduplicate_global: bool = True,
) -> dict[str, Path]:
    if not run_dir.exists():
        raise FileNotFoundError(f"Pasta de saída não encontrada: {run_dir}")
    pages_dir = run_dir / "pages"
    if not pages_dir.exists():
        raise FileNotFoundError(f"Reprocessamento sem pages/: a pasta não existe em {pages_dir}")

    project_name = project_name or run_dir.name
    page_files = sorted(pages_dir.glob("*.md"))
    index_files = sorted(run_dir.glob("*_index.json"))
    index_entries: list[dict[str, object]] = []
    total_urls = len(page_files)
    if index_files:
        try:
            index_entries = json.loads(index_files[0].read_text(encoding="utf-8"))
            total_urls = len(index_entries)
        except json.JSONDecodeError:
            index_entries = []

    if not index_entries:
        index_entries = [
            {
                "url": extract_frontmatter_value(path.read_text(encoding="utf-8"), "source"),
                "status": "ok",
                "file": str(path.relative_to(run_dir)),
                "chars": len(strip_frontmatter(path.read_text(encoding="utf-8"))),
                "error": None,
            }
            for path in page_files
        ]

    complete_file = build_complete_file(run_dir, project_name, page_files, clean_content=clean_content)
    dedup_stats: dict[str, object] = {}
    knowledge_file = build_knowledge_ready_file(
        run_dir,
        project_name,
        page_files,
        deduplicate_global=deduplicate_global,
        dedup_stats=dedup_stats,
    )
    report_file = build_extraction_report(
        run_dir,
        project_name,
        total_urls,
        index_entries,
        deduplicate_global=deduplicate_global,
        dedup_stats=dedup_stats,
    )
    return {
        "complete_file": complete_file,
        "knowledge_ready_file": knowledge_file,
        "report_file": report_file,
    }
