from __future__ import annotations

import json
import re
import string
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Event

import requests
from bs4 import BeautifulSoup

from .utils import HEADERS


BASE_DREAMS_URL = "https://www.ojogodobicho.com/sonhos-letra-{letter}.htm"
LogFn = Callable[[str], None]
ProgressFn = Callable[[int, int], None]
StatusFn = Callable[[dict[str, object]], None]
REQUEST_RETRIES = 2
RETRY_DELAY_SECONDS = 1.0


@dataclass
class SpecialExtractionSummary:
    total_urls: int
    success_count: int
    fail_count: int
    run_dir: str
    complete_file: str
    index_file: str
    log_file: str
    cancelled: bool = False


def clean_text(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def extract_dreams_content(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript", "iframe", "svg", "form"]):
        tag.decompose()

    for selector in [
        "nav",
        "header",
        "footer",
        "aside",
        ".menu",
        ".navbar",
        ".sidebar",
        ".rodape",
        ".footer",
        ".ads",
        ".advertisement",
        "#menu",
        "#footer",
        "#rodape",
    ]:
        for tag in soup.select(selector):
            tag.decompose()

    lines = [line.strip() for line in clean_text(soup.get_text("\n")).splitlines() if line.strip()]
    junk = [
        "home",
        "inicio",
        "início",
        "jogo do bicho",
        "palpites",
        "resultado",
        "resultados",
        "contato",
        "privacidade",
        "termos",
        "menu",
        "publicidade",
        "anuncie",
        "copyright",
        "todos os direitos",
    ]

    filtered: list[str] = []
    for line in lines:
        lowered = line.lower()
        if any(item in lowered for item in junk) and len(line) < 80:
            continue
        if len(line) <= 2:
            continue
        filtered.append(line)

    text = "\n".join(filtered)
    text_lower = text.lower()
    starts = []
    for pattern in [r"sonhos\s+com\s+a\s+letra", r"sonhos\s+letra", r"livro\s+dos\s+sonhos"]:
        match = re.search(pattern, text_lower)
        if match:
            starts.append(match.start())
    if starts:
        text = text[min(starts) :]

    return clean_text(text)


def write_letter_file(pages_dir: Path, letter: str, url: str, content: str) -> Path:
    pages_dir.mkdir(parents=True, exist_ok=True)
    file_path = pages_dir / f"sonhos_letra_{letter}.md"
    markdown = (
        "---\n"
        f'source: "{url}"\n'
        'site: "O Jogo do Bicho - Livro dos Sonhos"\n'
        f'letter: "{letter.upper()}"\n'
        f'captured_at: "{datetime.now().isoformat(timespec="seconds")}"\n'
        "---\n\n"
        f"# Livro dos Sonhos - Letra {letter.upper()}\n\n"
        f"{content}\n"
    )
    file_path.write_text(markdown, encoding="utf-8")
    return file_path


def build_dreams_complete_file(run_dir: Path, page_files: list[Path]) -> Path:
    complete_file = run_dir / "livro_dos_sonhos_completo.md"
    with complete_file.open("w", encoding="utf-8") as file:
        file.write("# Livro dos Sonhos - A-Z\n\n")
        file.write(f"Gerado em: {datetime.now().isoformat(timespec='seconds')}\n\n")
        file.write(f"Total de letras extraidas: {len(page_files)}\n")
        for page_file in page_files:
            file.write("\n\n---\n\n")
            file.write(f"<!-- arquivo: pages/{page_file.name} -->\n\n")
            file.write(page_file.read_text(encoding="utf-8"))
    return complete_file


def run_livro_dos_sonhos(
    outputs_dir: Path,
    letters: Iterable[str] | None = None,
    delay: float = 1.0,
    log: LogFn | None = None,
    progress: ProgressFn | None = None,
    status: StatusFn | None = None,
    cancel_event: Event | None = None,
) -> SpecialExtractionSummary:
    log_lines: list[str] = []
    selected_letters = [letter.lower() for letter in (letters or string.ascii_lowercase) if letter.strip()]
    run_dir = outputs_dir / "livro_dos_sonhos"
    pages_dir = run_dir / "pages"
    run_dir.mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)

    def emit(message: str) -> None:
        stamped = f"{time.strftime('%H:%M:%S')} {message}"
        log_lines.append(stamped)
        if log:
            log(stamped)

    def is_cancelled() -> bool:
        return bool(cancel_event and cancel_event.is_set())

    def emit_status(current_url: str, processed: int, successes: int, failures: int) -> None:
        if status:
            status(
                {
                    "current_url": current_url,
                    "total_urls": len(selected_letters),
                    "processed": processed,
                    "successes": successes,
                    "failures": failures,
                }
            )

    config = {
        "mode": "Livro dos Sonhos A-Z",
        "base_url": BASE_DREAMS_URL,
        "letters": selected_letters,
        "delay": delay,
    }
    (run_dir / "run_config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    emit("==============================")
    emit("Livro dos Sonhos A-Z")
    emit(f"Pasta: {run_dir.resolve()}")
    emit("==============================")

    index: list[dict[str, object]] = []
    page_files: list[Path] = []
    successes = 0
    failures = 0

    with requests.Session() as session:
        for position, letter in enumerate(selected_letters, start=1):
            if is_cancelled():
                emit("[CANCELADO] Extracao interrompida pelo usuario.")
                break

            url = BASE_DREAMS_URL.format(letter=letter)
            emit(f"[{letter.upper()}] Extraindo: {url}")
            emit_status(url, position - 1, successes, failures)

            try:
                response = None
                for attempt in range(REQUEST_RETRIES + 1):
                    try:
                        response = session.get(url, headers=HEADERS, timeout=30)
                        response.raise_for_status()
                        break
                    except requests.RequestException as exc:
                        if attempt < REQUEST_RETRIES:
                            emit(f"[RETRY] Letra {letter.upper()} tentativa {attempt + 2}/{REQUEST_RETRIES + 1}: {exc}")
                            time.sleep(RETRY_DELAY_SECONDS)
                        else:
                            raise
                if response is None:
                    raise RuntimeError("Nao foi possivel baixar a pagina.")
                content = extract_dreams_content(response.text)
                if len(content) < 100:
                    raise ValueError("Conteudo util insuficiente.")
                file_path = write_letter_file(pages_dir, letter, url, content)
                page_files.append(file_path)
                successes += 1
                emit(f"[OK] Letra {letter.upper()} salva.")
                index.append(
                    {
                        "letter": letter.upper(),
                        "url": url,
                        "status": "ok",
                        "file": str(file_path.relative_to(run_dir)),
                        "chars": len(content),
                        "error": None,
                    }
                )
            except Exception as exc:
                failures += 1
                emit(f"[FALHA] Letra {letter.upper()}: {exc}")
                index.append(
                    {
                        "letter": letter.upper(),
                        "url": url,
                        "status": "failed",
                        "file": None,
                        "chars": 0,
                        "error": str(exc),
                    }
                )

            if progress:
                progress(position, len(selected_letters))
            emit_status(url, position, successes, failures)
            if delay > 0 and position < len(selected_letters):
                time.sleep(delay)

    complete_file = build_dreams_complete_file(run_dir, page_files)
    index_file = run_dir / "livro_dos_sonhos_index.json"
    index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    cancelled = is_cancelled()
    emit("==============================")
    emit("CANCELADO" if cancelled else "FINALIZADO")
    emit(f"URLs encontradas: {len(selected_letters)}")
    emit(f"Paginas extraidas: {successes}")
    emit(f"Falhas: {failures}")
    if cancelled:
        emit("Execucao cancelada pelo usuario. Arquivos parciais foram preservados.")
    emit(f"Pasta criada: {run_dir.resolve()}")
    emit(f"Arquivo completo: {complete_file.resolve()}")

    log_file = run_dir / "extraction_log.txt"
    log_file.write_text("\n".join(log_lines) + "\n", encoding="utf-8")

    return SpecialExtractionSummary(
        total_urls=len(selected_letters),
        success_count=successes,
        fail_count=failures,
        run_dir=str(run_dir.resolve()),
        complete_file=str(complete_file.resolve()),
        index_file=str(index_file.resolve()),
        log_file=str(log_file.resolve()),
        cancelled=cancelled,
    )
