from __future__ import annotations

import json
import os
import queue
import sys
import threading
import tkinter.messagebox as messagebox
from pathlib import Path
from threading import Event

import customtkinter as ctk

from extractor.exporter import rebuild_run_outputs
from extractor.runner import ExtractionConfig, ExtractionSummary, run_extraction
from extractor.history import append_history, latest_output_dir, load_history
from extractor.presets import load_presets, save_presets
from extractor.special_extractors import SpecialExtractionSummary, run_livro_dos_sonhos
from extractor.utils import parse_blocked_paths, suggest_prefix_from_url, suggest_project_name_from_url, validate_start_url


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
OUTPUTS_DIR = APP_DIR / "outputs"
CONFIG_FILE = APP_DIR / "config.json"
PRESETS_FILE = APP_DIR / "presets.json"


class SiteDocsExtractorApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Site Docs Extractor")
        self.geometry("1080x760")
        self.minsize(920, 680)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker: threading.Thread | None = None
        self.cancel_event: Event | None = None
        self.last_output_dir: str | None = None
        self.pending_history_meta: dict[str, object] = {}
        self.startup_warnings: list[str] = []
        self.project_name_was_edited = False
        self.prefix_was_edited = False
        self.suppress_auto_flags = False

        self.defaults = self.load_defaults()
        self.presets = load_presets(PRESETS_FILE, self.startup_warnings)
        self.build_ui()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.after(120, self.process_events)
        if self.startup_warnings:
            self.after(450, self.show_startup_warnings)

    def load_defaults(self) -> dict[str, object]:
        if CONFIG_FILE.exists():
            try:
                return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                self.startup_warnings.append(f"config.json inválido em {CONFIG_FILE}: {exc}. Usando configuração padrão.")
            except OSError as exc:
                self.startup_warnings.append(f"Não foi possível ler config.json em {CONFIG_FILE}: {exc}.")
        return {
            "max_pages": 50,
            "delay": 1.0,
            "include_links": True,
            "include_tables": True,
            "use_playwright": False,
            "clean_markdown": True,
            "deduplicate_global_repeated_text": True,
            "blocked_paths": "",
            "last_url": "",
            "last_project_name": "pushinpay_docs",
            "last_prefix": "",
            "selected_preset": "Custom",
            "extraction_mode": "Documentacao padrao",
            "required_terms": "",
            "blocked_terms_filter": "",
            "css_include": "",
            "css_remove": "",
            "manual_urls": "",
            "ignore_prefix_for_manual": False,
        }

    def build_ui(self) -> None:
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, corner_radius=0)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)

        title = ctk.CTkLabel(header, text="Site Docs Extractor", font=ctk.CTkFont(size=24, weight="bold"))
        title.grid(row=0, column=0, padx=24, pady=(18, 4), sticky="w")

        subtitle = ctk.CTkLabel(header, text="Extraia documentações públicas para Markdown local.", text_color="#b8c0cc")
        subtitle.grid(row=1, column=0, padx=24, pady=(0, 18), sticky="w")

        body = ctk.CTkFrame(self, corner_radius=0)
        body.grid(row=1, column=0, sticky="nsew", padx=18, pady=18)
        body.grid_columnconfigure(0, weight=0)
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(0, weight=1)

        form = ctk.CTkScrollableFrame(body, width=350)
        form.grid(row=0, column=0, sticky="ns", padx=(0, 14))
        form.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(form, text="Preset").grid(row=0, column=0, padx=16, pady=(14, 4), sticky="w")
        self.preset_menu = ctk.CTkOptionMenu(form, values=list(self.presets.keys()), command=self.apply_preset)
        self.preset_menu.set(str(self.defaults.get("selected_preset", "Custom")))
        self.preset_menu.grid(row=1, column=0, padx=16, sticky="ew")

        ctk.CTkLabel(form, text="Modo de extração").grid(row=2, column=0, padx=16, pady=(14, 4), sticky="w")
        self.mode_menu = ctk.CTkOptionMenu(
            form,
            values=["Documentacao padrao", "Livro dos Sonhos A-Z"],
            command=self.on_mode_change,
        )
        self.mode_menu.set(str(self.defaults.get("extraction_mode", "Documentacao padrao")))
        self.mode_menu.grid(row=3, column=0, padx=16, sticky="ew")

        self.url_entry = self.add_entry(form, "URL inicial", 2, str(self.defaults.get("last_url", "")))
        self.project_entry = self.add_entry(form, "Nome do projeto", 3, str(self.defaults.get("last_project_name", "pushinpay_docs")))
        self.prefix_entry = self.add_entry(form, "Prefixo permitido (opcional)", 4, str(self.defaults.get("last_prefix", "")))
        self.max_pages_entry = self.add_entry(form, "Máximo de páginas", 5, str(self.defaults.get("max_pages", 50)))
        self.delay_entry = self.add_entry(form, "Delay entre páginas", 6, str(self.defaults.get("delay", 1.0)))
        ctk.CTkLabel(form, text="Opcoes avancadas: delay, paths, termos, CSS e URLs manuais").grid(
            row=40, column=0, padx=16, pady=(18, 16), sticky="w"
        )
        self.blocked_entry = self.add_entry(form, "Paths bloqueados extras", 7, str(self.defaults.get("blocked_paths", "")))
        self.required_terms_entry = self.add_entry(form, "Termos obrigatórios", 8, str(self.defaults.get("required_terms", "")))
        self.blocked_terms_entry = self.add_entry(form, "Termos bloqueados", 9, str(self.defaults.get("blocked_terms_filter", "")))
        self.css_include_entry = self.add_entry(form, "CSS para incluir", 10, str(self.defaults.get("css_include", "")))
        self.css_remove_entry = self.add_entry(form, "CSS para remover", 11, str(self.defaults.get("css_remove", "")))

        ctk.CTkLabel(form, text="URLs manuais").grid(row=24, column=0, padx=16, pady=(14, 4), sticky="w")
        self.manual_urls_text = ctk.CTkTextbox(form, height=96, wrap="word")
        self.manual_urls_text.insert("1.0", str(self.defaults.get("manual_urls", "")))
        self.manual_urls_text.grid(row=25, column=0, padx=16, sticky="ew")

        self.include_links_var = ctk.BooleanVar(value=bool(self.defaults.get("include_links", True)))
        self.include_tables_var = ctk.BooleanVar(value=bool(self.defaults.get("include_tables", True)))
        self.use_playwright_var = ctk.BooleanVar(value=bool(self.defaults.get("use_playwright", False)))
        self.clean_markdown_var = ctk.BooleanVar(value=bool(self.defaults.get("clean_markdown", True)))
        self.deduplicate_global_var = ctk.BooleanVar(value=bool(self.defaults.get("deduplicate_global_repeated_text", True)))
        self.ignore_prefix_for_manual_var = ctk.BooleanVar(value=bool(self.defaults.get("ignore_prefix_for_manual", False)))

        ignore_prefix_check = ctk.CTkCheckBox(
            form,
            text="Ignorar prefixo para URLs manuais",
            variable=self.ignore_prefix_for_manual_var,
        )
        ignore_prefix_check.grid(row=26, column=0, padx=16, pady=(12, 8), sticky="w")

        links_check = ctk.CTkCheckBox(form, text="Incluir links no Markdown", variable=self.include_links_var)
        links_check.grid(row=27, column=0, padx=16, pady=(0, 8), sticky="w")

        tables_check = ctk.CTkCheckBox(form, text="Incluir tabelas", variable=self.include_tables_var)
        tables_check.grid(row=28, column=0, padx=16, pady=(0, 18), sticky="w")

        playwright_check = ctk.CTkCheckBox(form, text="Usar navegador Playwright", variable=self.use_playwright_var)
        playwright_check.grid(row=29, column=0, padx=16, pady=(0, 18), sticky="w")

        clean_check = ctk.CTkCheckBox(form, text="Limpar ruído do Markdown", variable=self.clean_markdown_var)
        clean_check.grid(row=30, column=0, padx=16, pady=(0, 18), sticky="w")

        dedup_check = ctk.CTkCheckBox(
            form,
            text="Remover textos repetidos entre paginas",
            variable=self.deduplicate_global_var,
        )
        dedup_check.grid(row=31, column=0, padx=16, pady=(0, 18), sticky="w")

        self.extract_button = ctk.CTkButton(form, text="Extrair", height=42, command=self.start_extraction)
        self.extract_button.grid(row=32, column=0, padx=16, pady=(4, 10), sticky="ew")

        self.cancel_button = ctk.CTkButton(
            form,
            text="Cancelar extração",
            height=38,
            command=self.cancel_extraction,
            state="disabled",
            fg_color="#8a2f2f",
            hover_color="#743030",
        )
        self.cancel_button.grid(row=33, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.open_button = ctk.CTkButton(form, text="Abrir pasta de saída", height=36, command=self.open_output_folder)
        self.open_button.grid(row=34, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.open_last_button = ctk.CTkButton(form, text="Abrir última saída", height=36, command=self.open_last_output)
        self.open_last_button.grid(row=35, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.preview_button = ctk.CTkButton(form, text="Preview", height=36, command=self.preview_last_output)
        self.preview_button.grid(row=36, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.reprocess_button = ctk.CTkButton(form, text="Reprocessar", height=36, command=self.reprocess_last_output)
        self.reprocess_button.grid(row=37, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.history_button = ctk.CTkButton(form, text="Histórico", height=36, command=self.show_history)
        self.history_button.grid(row=38, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.edit_presets_button = ctk.CTkButton(form, text="Editar presets", height=36, command=self.show_preset_editor)
        self.edit_presets_button.grid(row=39, column=0, padx=16, pady=(0, 16), sticky="ew")

        log_panel = ctk.CTkFrame(body)
        log_panel.grid(row=0, column=1, sticky="nsew")
        log_panel.grid_columnconfigure(0, weight=1)
        log_panel.grid_rowconfigure(3, weight=1)

        self.progress = ctk.CTkProgressBar(log_panel)
        self.progress.grid(row=0, column=0, padx=16, pady=(16, 10), sticky="ew")
        self.progress.set(0)

        self.status_label = ctk.CTkLabel(
            log_panel,
            text="URLs encontradas: 0 | Processadas: 0 | Sucessos: 0 | Falhas: 0",
            anchor="w",
        )
        self.status_label.grid(row=1, column=0, padx=16, pady=(0, 8), sticky="ew")

        self.current_url_label = ctk.CTkLabel(log_panel, text="URL atual: -", anchor="w", text_color="#b8c0cc")
        self.current_url_label.grid(row=2, column=0, padx=16, pady=(0, 10), sticky="ew")

        self.log_text = ctk.CTkTextbox(log_panel, wrap="word")
        self.log_text.grid(row=3, column=0, padx=16, pady=(0, 16), sticky="nsew")
        self.log("[PRONTO] Informe uma URL e clique em Extrair.")
        for warning in self.startup_warnings:
            self.log(f"[AVISO] {warning}")
        self.bind_auto_suggestions()

    def add_entry(self, parent: ctk.CTkFrame, label: str, row: int, value: str) -> ctk.CTkEntry:
        label_widget = ctk.CTkLabel(parent, text=label)
        label_widget.grid(row=row * 2, column=0, padx=16, pady=(14, 4), sticky="w")

        entry = ctk.CTkEntry(parent, height=36)
        entry.insert(0, value)
        entry.grid(row=row * 2 + 1, column=0, padx=16, sticky="ew")
        return entry

    def show_startup_warnings(self) -> None:
        if self.startup_warnings:
            messagebox.showwarning("Aviso de configuração", "\n\n".join(self.startup_warnings))

    def bind_auto_suggestions(self) -> None:
        self.url_entry.bind("<KeyRelease>", self.on_url_changed)
        self.url_entry.bind("<FocusOut>", self.on_url_changed)
        self.project_entry.bind("<KeyRelease>", self.mark_project_name_edited)
        self.prefix_entry.bind("<KeyRelease>", self.mark_prefix_edited)

    def mark_project_name_edited(self, _event: object | None = None) -> None:
        if not self.suppress_auto_flags:
            self.project_name_was_edited = True

    def mark_prefix_edited(self, _event: object | None = None) -> None:
        if not self.suppress_auto_flags:
            self.prefix_was_edited = True

    def on_url_changed(self, _event: object | None = None) -> None:
        url = self.url_entry.get().strip()
        if not url:
            return
        try:
            suggested_project = suggest_project_name_from_url(url)
            suggested_prefix = suggest_prefix_from_url(url)
        except ValueError:
            return

        self.suppress_auto_flags = True
        try:
            if not self.project_name_was_edited:
                self.set_entry(self.project_entry, suggested_project)
            if not self.prefix_was_edited:
                self.set_entry(self.prefix_entry, suggested_prefix)
        finally:
            self.suppress_auto_flags = False

    def apply_preset(self, preset_name: str) -> None:
        preset = self.presets.get(preset_name)
        if not preset:
            return
        self.suppress_auto_flags = True
        self.set_entry(self.url_entry, preset["url"])
        self.set_entry(self.project_entry, preset["project"])
        self.set_entry(self.prefix_entry, preset["prefix"])
        self.suppress_auto_flags = False
        self.project_name_was_edited = False
        self.prefix_was_edited = False
        self.mode_menu.set(str(preset.get("mode", "Documentacao padrao")))
        self.use_playwright_var.set(bool(preset.get("use_playwright", False)))
        self.clean_markdown_var.set(bool(preset.get("clean_markdown", True)))

    def on_mode_change(self, mode: str) -> None:
        if mode == "Livro dos Sonhos A-Z":
            self.preset_menu.set("Custom")
            self.set_entry(self.url_entry, "https://www.ojogodobicho.com/sonhos-letra-b.htm")
            self.set_entry(self.project_entry, "livro_dos_sonhos")
            self.set_entry(self.prefix_entry, "")

    def set_entry(self, entry: ctk.CTkEntry, value: str) -> None:
        entry.delete(0, "end")
        entry.insert(0, value)

    def show_preset_editor(self) -> None:
        window = ctk.CTkToplevel(self)
        window.title("Editar Preset")
        window.geometry("520x560")
        window.grid_columnconfigure(0, weight=1)

        name_entry = self.add_entry(window, "Nome", 0, self.preset_menu.get())
        url_entry = self.add_entry(window, "URL", 1, self.url_entry.get())
        project_entry = self.add_entry(window, "Projeto", 2, self.project_entry.get())
        prefix_entry = self.add_entry(window, "Prefixo", 3, self.prefix_entry.get())

        ctk.CTkLabel(window, text="Modo").grid(row=8, column=0, padx=16, pady=(14, 4), sticky="w")
        mode_menu = ctk.CTkOptionMenu(window, values=["Documentacao padrao", "Livro dos Sonhos A-Z"])
        mode_menu.set(self.mode_menu.get())
        mode_menu.grid(row=9, column=0, padx=16, sticky="ew")

        use_playwright_var = ctk.BooleanVar(value=self.use_playwright_var.get())
        clean_markdown_var = ctk.BooleanVar(value=self.clean_markdown_var.get())
        ctk.CTkCheckBox(window, text="Usar navegador Playwright", variable=use_playwright_var).grid(
            row=10, column=0, padx=16, pady=(16, 8), sticky="w"
        )
        ctk.CTkCheckBox(window, text="Limpar ruído do Markdown", variable=clean_markdown_var).grid(
            row=11, column=0, padx=16, pady=(0, 16), sticky="w"
        )

        def save_current_preset() -> None:
            name = name_entry.get().strip()
            if not name:
                messagebox.showerror("Preset inválido", "Informe um nome para o preset.")
                return
            self.presets[name] = {
                "url": url_entry.get().strip(),
                "project": project_entry.get().strip(),
                "prefix": prefix_entry.get().strip(),
                "mode": mode_menu.get(),
                "use_playwright": use_playwright_var.get(),
                "clean_markdown": clean_markdown_var.get(),
            }
            save_presets(PRESETS_FILE, self.presets)
            self.preset_menu.configure(values=list(self.presets.keys()))
            self.preset_menu.set(name)
            self.apply_preset(name)
            messagebox.showinfo("Preset salvo", f"Preset salvo em:\n{PRESETS_FILE}")
            window.destroy()

        ctk.CTkButton(window, text="Salvar preset", command=save_current_preset, height=38).grid(
            row=12, column=0, padx=16, pady=(4, 16), sticky="ew"
        )

    def log(self, message: str) -> None:
        self.log_text.insert("end", f"{message}\n")
        self.log_text.see("end")

    def start_extraction(self) -> None:
        if self.worker and self.worker.is_alive():
            return

        mode = self.mode_menu.get()
        try:
            delay = self.parse_delay()
            config = None if mode == "Livro dos Sonhos A-Z" else self.build_standard_config(delay)
        except ValueError as exc:
            messagebox.showerror("Configuração inválida", str(exc))
            return

        self.save_current_config()
        self.pending_history_meta = self.build_history_meta(mode)

        self.log_text.delete("1.0", "end")
        self.progress.set(0)
        self.update_status({})
        self.extract_button.configure(state="disabled", text="Extraindo...")
        self.cancel_button.configure(state="normal", text="Cancelar extração")
        self.cancel_event = Event()

        self.worker = threading.Thread(target=self.run_worker, args=(mode, config, delay), daemon=True)
        self.worker.start()

    def parse_delay(self) -> float:
        raw_delay = self.delay_entry.get().strip().replace(",", ".")
        try:
            delay = float(raw_delay)
        except ValueError as exc:
            raise ValueError("Delay deve ser um numero maior ou igual a 0.") from exc
        if delay < 0:
            raise ValueError("Delay deve ser maior ou igual a 0.")
        return delay

    def build_standard_config(self, delay: float) -> ExtractionConfig:
        start_url = self.url_entry.get().strip()
        project_name = self.project_entry.get().strip()
        prefix = self.prefix_entry.get().strip()

        if not start_url:
            raise ValueError("URL inicial é obrigatória.")
        start_url = validate_start_url(start_url)
        if not project_name:
            raise ValueError("Nome do projeto é obrigatório.")
        if prefix and not prefix.startswith("/"):
            raise ValueError('Prefixo permitido deve começar com "/".')

        try:
            max_pages = int(self.max_pages_entry.get().strip())
        except ValueError as exc:
            raise ValueError("Máximo de páginas deve ser um número inteiro maior que 0.") from exc
        if max_pages <= 0:
            raise ValueError("Máximo de páginas deve ser maior que 0.")

        return ExtractionConfig(
            start_url=start_url,
            project_name=project_name,
            allowed_prefix=prefix or None,
            max_pages=max_pages,
            delay=delay,
            extra_blocked_paths=parse_blocked_paths(self.blocked_entry.get()),
            include_links=self.include_links_var.get(),
            include_tables=self.include_tables_var.get(),
            use_playwright=self.use_playwright_var.get(),
            clean_markdown=self.clean_markdown_var.get(),
            required_terms=self.required_terms_entry.get(),
            blocked_terms=self.blocked_terms_entry.get(),
            css_include=self.css_include_entry.get().strip() or None,
            css_remove=self.css_remove_entry.get().strip() or None,
            manual_urls=self.manual_urls_text.get("1.0", "end").strip(),
            skip_crawl=bool(self.manual_urls_text.get("1.0", "end").strip()),
            ignore_prefix_for_manual=self.ignore_prefix_for_manual_var.get(),
            deduplicate_global_repeated_text=self.deduplicate_global_var.get(),
        )

    def run_worker(self, mode: str, config: ExtractionConfig | None, delay: float) -> None:
        try:
            if mode == "Livro dos Sonhos A-Z":
                summary = run_livro_dos_sonhos(
                    outputs_dir=OUTPUTS_DIR,
                    delay=delay,
                    log=lambda message: self.events.put(("log", message)),
                    progress=lambda current, total: self.events.put(("progress", (current, total))),
                    status=lambda data: self.events.put(("status", data)),
                    cancel_event=self.cancel_event,
                )
            else:
                if config is None:
                    raise ValueError("Configuração padrão ausente.")
                summary = run_extraction(
                    config=config,
                    outputs_dir=OUTPUTS_DIR,
                    log=lambda message: self.events.put(("log", message)),
                    progress=lambda current, total: self.events.put(("progress", (current, total))),
                    status=lambda data: self.events.put(("status", data)),
                    cancel_event=self.cancel_event,
                )
            self.events.put(("done", summary))
        except Exception as exc:
            self.events.put(("error", str(exc)))

    def cancel_extraction(self) -> None:
        if self.cancel_event:
            self.cancel_event.set()
            self.cancel_button.configure(state="disabled", text="Cancelando...")
            self.log("[CANCELAR] Pedido de cancelamento enviado. A pagina atual sera finalizada antes de parar.")

    def get_current_config(self) -> dict[str, object]:
        max_pages: object = self.max_pages_entry.get().strip()
        delay: object = self.delay_entry.get().strip()
        try:
            max_pages = int(str(max_pages))
        except ValueError:
            pass
        try:
            delay = float(str(delay).replace(",", "."))
        except ValueError:
            pass
        return {
            "last_url": self.url_entry.get().strip(),
            "last_project_name": self.project_entry.get().strip(),
            "last_prefix": self.prefix_entry.get().strip(),
            "max_pages": max_pages,
            "delay": delay,
            "blocked_paths": self.blocked_entry.get().strip(),
            "selected_preset": self.preset_menu.get(),
            "extraction_mode": self.mode_menu.get(),
            "include_links": self.include_links_var.get(),
            "include_tables": self.include_tables_var.get(),
            "use_playwright": self.use_playwright_var.get(),
            "clean_markdown": self.clean_markdown_var.get(),
            "deduplicate_global_repeated_text": self.deduplicate_global_var.get(),
            "required_terms": self.required_terms_entry.get().strip(),
            "blocked_terms_filter": self.blocked_terms_entry.get().strip(),
            "css_include": self.css_include_entry.get().strip(),
            "css_remove": self.css_remove_entry.get().strip(),
            "manual_urls": self.manual_urls_text.get("1.0", "end").strip(),
            "ignore_prefix_for_manual": self.ignore_prefix_for_manual_var.get(),
        }

    def save_current_config(self) -> None:
        try:
            CONFIG_FILE.write_text(json.dumps(self.get_current_config(), ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as exc:
            self.log(f"[AVISO] Não foi possível salvar config.json: {exc}")

    def on_close(self) -> None:
        if self.worker and self.worker.is_alive():
            should_cancel = messagebox.askyesno(
                "Extração em andamento",
                "Existe uma extração em andamento. Deseja pedir cancelamento e manter o app aberto?",
            )
            if should_cancel:
                self.cancel_extraction()
            return
        self.save_current_config()
        self.destroy()

    def build_history_meta(self, mode: str) -> dict[str, object]:
        manual_urls = self.manual_urls_text.get("1.0", "end").strip()
        manual_url_count = len([line for line in manual_urls.splitlines() if line.strip()])
        return {
            "mode": f"{mode} + URLs manuais" if mode != "Livro dos Sonhos A-Z" and manual_urls else mode,
            "project_name": self.project_entry.get().strip() or "livro_dos_sonhos",
            "start_url": self.url_entry.get().strip(),
            "manual_url_count": manual_url_count,
        }

    def process_events(self) -> None:
        while True:
            try:
                event, payload = self.events.get_nowait()
            except queue.Empty:
                break

            if event == "log":
                self.log(str(payload))
            elif event == "progress":
                current, total = payload  # type: ignore[misc]
                self.progress.set(min(1, current / max(total, 1)))
            elif event == "status":
                if isinstance(payload, dict):
                    self.update_status(payload)
            elif event == "done":
                summary = payload
                if isinstance(summary, ExtractionSummary | SpecialExtractionSummary):
                    self.finish_success(summary)
            elif event == "error":
                self.finish_error(str(payload))

        self.after(120, self.process_events)

    def update_status(self, data: dict[str, object]) -> None:
        current_url = str(data.get("current_url") or "-")
        total_urls = int(data.get("total_urls") or 0)
        processed = int(data.get("processed") or 0)
        successes = int(data.get("successes") or 0)
        failures = int(data.get("failures") or 0)
        self.status_label.configure(
            text=(
                f"URLs encontradas: {total_urls} | Processadas: {processed} | "
                f"Sucessos: {successes} | Falhas: {failures}"
            )
        )
        self.current_url_label.configure(text=f"URL atual: {current_url}")

    def finish_success(self, summary: ExtractionSummary | SpecialExtractionSummary) -> None:
        self.progress.set(1)
        self.extract_button.configure(state="normal", text="Extrair")
        self.cancel_button.configure(state="disabled", text="Cancelar extração")
        self.last_output_dir = summary.run_dir
        self.record_history(summary)
        title = "Cancelado" if summary.cancelled else "Finalizado"
        knowledge_ready_file = getattr(summary, "knowledge_ready_file", "")
        report_file = getattr(summary, "report_file", "")
        final_message = (
            f"Extração {'cancelada' if summary.cancelled else 'finalizada'}.\n\n"
            f"Total de URLs encontradas: {summary.total_urls}\n"
            f"Páginas extraídas com sucesso: {summary.success_count}\n"
            f"Falhas: {summary.fail_count}\n"
            f"Pasta criada: {summary.run_dir}\n"
            f"Arquivo completo: {summary.complete_file}\n"
            f"Knowledge ready: {knowledge_ready_file or '-'}\n"
            f"Relatório: {report_file or '-'}"
        )
        self.log(final_message)
        messagebox.showinfo(title, final_message)

    def record_history(self, summary: ExtractionSummary | SpecialExtractionSummary) -> None:
        try:
            append_history(
                OUTPUTS_DIR,
                {
                    **self.pending_history_meta,
                    "output_dir": summary.run_dir,
                    "total_found": summary.total_urls,
                    "successes": summary.success_count,
                    "failures": summary.fail_count,
                    "cancelled": summary.cancelled,
                    "manual_url_count": getattr(summary, "manual_url_count", 0),
                    "manual_ignored_count": getattr(summary, "manual_ignored_count", 0),
                },
            )
        except OSError as exc:
            self.log(f"[AVISO] Não foi possível registrar histórico: {exc}")

    def finish_error(self, error: str) -> None:
        self.extract_button.configure(state="normal", text="Extrair")
        self.cancel_button.configure(state="disabled", text="Cancelar extração")
        self.log(f"[ERRO] {error}")
        messagebox.showerror("Erro", error)

    def open_output_folder(self) -> None:
        target = self.last_output_dir or str(OUTPUTS_DIR.resolve())
        Path(target).mkdir(parents=True, exist_ok=True)
        os.startfile(target)

    def open_last_output(self) -> None:
        target = self.get_last_output_dir()
        if not target:
            messagebox.showinfo("Última saída", "Nenhuma execução registrada ainda.")
            return
        path = Path(target)
        if not path.exists():
            messagebox.showwarning("Última saída", f"A pasta não existe mais:\n{target}")
            return
        os.startfile(path)

    def get_last_output_dir(self) -> str | None:
        return self.last_output_dir or latest_output_dir(OUTPUTS_DIR)

    def preview_last_output(self) -> None:
        target = self.get_last_output_dir()
        if not target:
            messagebox.showinfo("Preview", "Nenhuma execução registrada ainda.")
            return

        run_dir = Path(target)
        if not run_dir.exists():
            messagebox.showwarning("Preview", f"A pasta não existe mais:\n{target}")
            return

        candidates = sorted(run_dir.glob("*_knowledge_ready.md")) or sorted(run_dir.glob("*_completo.md"))
        if not candidates:
            messagebox.showwarning("Preview", "Não encontrei arquivo knowledge_ready ou completo nessa saída.")
            return

        content = candidates[0].read_text(encoding="utf-8")[:12000]
        window = ctk.CTkToplevel(self)
        window.title(f"Preview - {candidates[0].name}")
        window.geometry("900x560")
        window.grid_columnconfigure(0, weight=1)
        window.grid_rowconfigure(0, weight=1)
        text = ctk.CTkTextbox(window, wrap="word")
        text.grid(row=0, column=0, sticky="nsew", padx=14, pady=14)
        text.insert("end", content)

    def reprocess_last_output(self) -> None:
        target = self.get_last_output_dir()
        if not target:
            messagebox.showinfo("Reprocessar", "Nenhuma execução registrada ainda.")
            return

        run_dir = Path(target)
        try:
            run_config_path = run_dir / "run_config.json"
            project_name = run_dir.name
            clean_content = self.clean_markdown_var.get()
            deduplicate_global = self.deduplicate_global_var.get()
            if run_config_path.exists():
                run_config = json.loads(run_config_path.read_text(encoding="utf-8"))
                project_name = str(run_config.get("project_name") or project_name)
                clean_content = bool(run_config.get("clean_markdown", clean_content))
                deduplicate_global = bool(run_config.get("deduplicate_global_repeated_text", deduplicate_global))

            outputs = rebuild_run_outputs(
                run_dir,
                project_name=project_name,
                clean_content=clean_content,
                deduplicate_global=deduplicate_global,
            )
        except Exception as exc:
            messagebox.showerror("Reprocessamento falhou", str(exc))
            self.log(f"[ERRO] Reprocessamento falhou: {exc}")
            return

        self.log(f"[OK] Última saída reprocessada: {run_dir}")
        messagebox.showinfo(
            "Reprocessamento concluído",
            "Arquivos recriados:\n"
            f"{outputs['complete_file']}\n"
            f"{outputs['knowledge_ready_file']}\n"
            f"{outputs['report_file']}",
        )

    def show_history(self) -> None:
        entries = load_history(OUTPUTS_DIR)[-30:]
        window = ctk.CTkToplevel(self)
        window.title("Histórico de Extrações")
        window.geometry("860x460")
        window.grid_columnconfigure(0, weight=1)
        window.grid_rowconfigure(0, weight=1)

        text = ctk.CTkTextbox(window, wrap="word")
        text.grid(row=0, column=0, sticky="nsew", padx=14, pady=14)

        if not entries:
            text.insert("end", "Nenhuma execução registrada ainda.\n")
            return

        for entry in reversed(entries):
            cancelled = "sim" if entry.get("cancelled") else "nao"
            manual_info = ""
            if entry.get("manual_url_count") or entry.get("manual_ignored_count"):
                manual_info = (
                    f"URLs manuais: {entry.get('manual_url_count', 0)} | "
                    f"Ignoradas: {entry.get('manual_ignored_count', 0)}\n"
                )
            text.insert(
                "end",
                (
                    f"{entry.get('datetime', '-')}\n"
                    f"Modo: {entry.get('mode', '-')}\n"
                    f"Projeto: {entry.get('project_name', '-')}\n"
                    f"URL: {entry.get('start_url', '-')}\n"
                    f"Saida: {entry.get('output_dir', '-')}\n"
                    f"Encontradas: {entry.get('total_found', 0)} | "
                    f"Sucessos: {entry.get('successes', 0)} | "
                    f"Falhas: {entry.get('failures', 0)} | "
                    f"Cancelado: {cancelled}\n"
                    f"{manual_info}"
                    "------------------------------\n"
                ),
            )


def main() -> None:
    app = SiteDocsExtractorApp()
    app.mainloop()


if __name__ == "__main__":
    main()
