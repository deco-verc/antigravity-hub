from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from extractor.cleaner import clean_markdown, deduplicate_repeated_blocks_across_pages
from extractor.exporter import build_extraction_report, build_knowledge_ready_file, write_json, write_page_file
from extractor.extractor import PageExtraction, apply_css_filters, extract_markdown_from_html
from extractor.history import append_history, latest_output_dir, load_history
from extractor.presets import load_presets, save_presets
from extractor.runner import ExtractionConfig, run_extraction
from extractor.utils import (
    create_run_directory,
    filename_from_url,
    parse_manual_urls,
    suggest_prefix_from_url,
    suggest_project_name_from_url,
    unique_filename,
    validate_start_url,
)


class CoreTests(unittest.TestCase):
    def test_filename_from_url_uses_path_slug(self) -> None:
        name = filename_from_url("https://example.com/docs/API Reference/?x=1", "pagina_1")
        self.assertEqual(name, "docs_api_reference.md")

    def test_unique_filename_adds_numeric_suffix(self) -> None:
        used = {"docs_api.md"}
        name = unique_filename("docs_api.md", used)
        self.assertEqual(name, "docs_api_002.md")
        self.assertIn(name, used)

    def test_create_run_directory_adds_suffix_when_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            outputs = Path(temp_dir)
            first = create_run_directory(outputs, "project")
            second = create_run_directory(outputs, "project")
            self.assertEqual(first.name, "project")
            self.assertEqual(second.name, "project_001")

    def test_validate_start_url(self) -> None:
        self.assertEqual(validate_start_url("https://example.com/"), "https://example.com/")
        with self.assertRaises(ValueError):
            validate_start_url("example.com")

    def test_parse_manual_urls_removes_empty_lines_and_invalid_urls(self) -> None:
        valid, invalid = parse_manual_urls(
            """
            https://example.com/docs

            not-a-url
            https://example.com/docs
            https://example.com/api
            """
        )
        self.assertEqual(valid, ["https://example.com/docs", "https://example.com/api"])
        self.assertEqual(invalid, ["not-a-url"])

    def test_suggest_project_name_from_url(self) -> None:
        self.assertEqual(
            suggest_project_name_from_url("https://app.theneo.io/pushinpay/pix/pix"),
            "app_theneo_io_pushinpay_docs",
        )
        self.assertEqual(
            suggest_project_name_from_url("https://devs.pagniv.com/docs/"),
            "devs_pagniv_com_docs",
        )
        self.assertEqual(
            suggest_project_name_from_url("https://appmax.readme.io/reference/"),
            "appmax_readme_io_reference_docs",
        )
        self.assertEqual(
            suggest_project_name_from_url("https://integre.cashinpaybr.com/"),
            "integre_cashinpaybr_com_docs",
        )

    def test_suggest_prefix_from_url(self) -> None:
        self.assertEqual(suggest_prefix_from_url("https://app.theneo.io/pushinpay/pix/pix"), "/pushinpay/")
        self.assertEqual(suggest_prefix_from_url("https://devs.pagniv.com/docs/"), "/docs/")
        self.assertEqual(suggest_prefix_from_url("https://appmax.readme.io/reference/"), "/reference/")
        self.assertEqual(suggest_prefix_from_url("https://integre.cashinpaybr.com/"), "")

    def test_write_index_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "index.json"
            write_json(path, [{"url": "https://example.com", "status": "ok"}])
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data[0]["status"], "ok")

    def test_cancelled_run_preserves_files_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cancel_event = Event()
            cancel_event.set()
            with patch("extractor.runner.discover_links", return_value=["https://example.com/docs"]):
                summary = run_extraction(
                    ExtractionConfig(
                        start_url="https://example.com/",
                        project_name="cancel_test",
                        max_pages=1,
                        delay=0,
                    ),
                    outputs_dir=Path(temp_dir),
                    cancel_event=cancel_event,
                )

            self.assertTrue(summary.cancelled)
            self.assertTrue(Path(summary.complete_file).exists())
            self.assertTrue(Path(summary.index_file).exists())
            self.assertTrue(Path(summary.log_file).exists())

    def test_history_appends_and_finds_latest_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            outputs = Path(temp_dir)
            append_history(outputs, {"output_dir": "C:\\saida\\um", "project_name": "one"})
            append_history(outputs, {"output_dir": "C:\\saida\\dois", "project_name": "two"})

            entries = load_history(outputs)
            self.assertEqual(len(entries), 2)
            self.assertEqual(latest_output_dir(outputs), "C:\\saida\\dois")

    def test_config_accepts_use_playwright_flag(self) -> None:
        config = ExtractionConfig(
            start_url="https://example.com/",
            project_name="docs",
            use_playwright=True,
        )
        self.assertTrue(config.use_playwright)

    def test_extract_markdown_from_html_fake_content(self) -> None:
        html = """
        <html>
          <body>
            <main>
              <h1>Example Documentation</h1>
              <p>This is a long documentation paragraph with enough useful words for extraction.</p>
              <p>It includes implementation notes, options, examples, and expected behavior details.</p>
            </main>
          </body>
        </html>
        """
        result = extract_markdown_from_html(html, "https://example.com/docs")
        self.assertEqual(result.status, "ok")
        self.assertIn("Example Documentation", result.content or "")

    def test_runner_accepts_playwright_flag_with_fake_browser(self) -> None:
        class FakeBrowser:
            def __init__(self, *args, **kwargs) -> None:
                self.closed = False

            def __enter__(self):
                return self

            def fetch_html(self, url: str) -> str:
                return """
                <html><body><main>
                <h1>Fake Browser Page</h1>
                <p>This fake browser HTML has enough words to be converted into markdown output.</p>
                <p>It avoids launching a real browser while checking the runner integration path.</p>
                </main></body></html>
                """

            def close(self) -> None:
                self.closed = True

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("extractor.runner.discover_links", return_value=["https://example.com/docs"]):
                with patch("extractor.runner.BrowserHtmlFetcher", FakeBrowser):
                    summary = run_extraction(
                        ExtractionConfig(
                            start_url="https://example.com/",
                            project_name="playwright_fake",
                            max_pages=1,
                            delay=0,
                            use_playwright=True,
                        ),
                        outputs_dir=Path(temp_dir),
                    )

            self.assertEqual(summary.success_count, 1)
            self.assertTrue(Path(summary.complete_file).exists())

    def test_cleaner_removes_repeated_lines_and_preserves_titles(self) -> None:
        dirty = "# API Reference\n\nLogin\nLogin\nImportant technical content.\nImportant technical content.\n"
        cleaned = clean_markdown(dirty)
        self.assertIn("# API Reference", cleaned)
        self.assertNotIn("Login", cleaned)
        self.assertEqual(cleaned.count("Important technical content."), 1)

    def test_global_dedup_keeps_first_occurrence_and_removes_later_repetitions(self) -> None:
        repeated = "Esse site e ruim e aparece em muitas paginas"
        pages = [f"# Page {index}\n\n{repeated}\n\nUnique {index}" for index in range(1, 5)]

        cleaned, stats = deduplicate_repeated_blocks_across_pages(pages, threshold=3)

        self.assertIn(repeated, cleaned[0])
        self.assertNotIn(repeated, cleaned[1])
        self.assertNotIn(repeated, cleaned[2])
        self.assertNotIn(repeated, cleaned[3])
        self.assertEqual(stats["duplicated_blocks"], 1)
        self.assertEqual(stats["removed_repetitions"], 3)

    def test_global_dedup_does_not_remove_code_or_endpoints(self) -> None:
        endpoint = "GET /v1/payments"
        code = "```json\n{\"status\": \"ok\"}\n```"
        pages = [f"# Page {index}\n\n{endpoint}\n\n{code}" for index in range(1, 5)]

        cleaned, stats = deduplicate_repeated_blocks_across_pages(pages, threshold=3)

        self.assertTrue(all(endpoint in page for page in cleaned))
        self.assertTrue(all("{\"status\": \"ok\"}" in page for page in cleaned))
        self.assertEqual(stats["duplicated_blocks"], 0)

    def test_knowledge_ready_includes_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir)
            pages_dir = run_dir / "pages"
            page = write_page_file(
                pages_dir,
                1,
                "https://example.com/docs",
                "kb_test",
                "# Docs\n\nUseful technical content with enough detail for a knowledge base.",
            )
            output = build_knowledge_ready_file(run_dir, "kb_test", [page])
            content = output.read_text(encoding="utf-8")
            self.assertIn("Source URL: https://example.com/docs", content)
            self.assertNotIn("---\nsource:", content)

    def test_extraction_report_basic(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir)
            report = build_extraction_report(
                run_dir,
                "report_test",
                2,
                [
                    {"url": "https://example.com/ok", "status": "ok", "chars": 1200, "error": None},
                    {"url": "https://example.com/fail", "status": "failed", "chars": 0, "error": "boom"},
                ],
            )
            content = report.read_text(encoding="utf-8")
            self.assertIn("Total de URLs encontradas: 2", content)
            self.assertIn("https://example.com/fail", content)

    def test_required_term_filter_ignores_non_matching_page(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("extractor.runner.discover_links", return_value=["https://example.com/docs"]):
                with patch(
                    "extractor.runner.extract_markdown",
                    return_value=PageExtraction("https://example.com/docs", "ok", "content about billing only"),
                ):
                    summary = run_extraction(
                        ExtractionConfig(
                            start_url="https://example.com/",
                            project_name="required_filter",
                            max_pages=1,
                            delay=0,
                            required_terms=["pix"],
                        ),
                        outputs_dir=Path(temp_dir),
                    )
            index_data = json.loads(Path(summary.index_file).read_text(encoding="utf-8"))
            self.assertEqual(index_data[0]["status"], "ignored")
            self.assertIn("termos obrigatorios", index_data[0]["error"])

    def test_blocked_term_filter_ignores_matching_page(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("extractor.runner.discover_links", return_value=["https://example.com/docs"]):
                with patch(
                    "extractor.runner.extract_markdown",
                    return_value=PageExtraction("https://example.com/docs", "ok", "content with forbidden checkout term"),
                ):
                    summary = run_extraction(
                        ExtractionConfig(
                            start_url="https://example.com/",
                            project_name="blocked_filter",
                            max_pages=1,
                            delay=0,
                            blocked_terms=["checkout"],
                        ),
                        outputs_dir=Path(temp_dir),
                    )
            index_data = json.loads(Path(summary.index_file).read_text(encoding="utf-8"))
            self.assertEqual(index_data[0]["status"], "ignored")
            self.assertIn("termo bloqueado", index_data[0]["error"])

    def test_runner_manual_urls_skip_crawler_and_record_ignored_urls(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch("extractor.runner.discover_links") as discover_mock:
                with patch(
                    "extractor.runner.extract_markdown",
                    return_value=PageExtraction(
                        "https://example.com/docs",
                        "ok",
                        "# Docs\n\nUseful manual URL content with enough words for extraction.",
                    ),
                ):
                    summary = run_extraction(
                        ExtractionConfig(
                            start_url="https://example.com/",
                            project_name="manual_urls",
                            max_pages=10,
                            delay=0,
                            manual_urls=[
                                "https://example.com/docs",
                                "not-a-url",
                                "https://other.example.com/docs",
                            ],
                        ),
                        outputs_dir=Path(temp_dir),
                    )

            discover_mock.assert_not_called()
            self.assertEqual(summary.success_count, 1)
            self.assertEqual(summary.manual_url_count, 3)
            self.assertEqual(summary.manual_ignored_count, 2)

            index_data = json.loads(Path(summary.index_file).read_text(encoding="utf-8"))
            self.assertEqual(len(index_data), 3)
            self.assertEqual(len([entry for entry in index_data if entry["status"] == "ignored"]), 2)

            report_content = Path(summary.report_file).read_text(encoding="utf-8")
            self.assertIn("Modo URLs manuais: sim", report_content)
            self.assertIn("URLs manuais ignoradas", report_content)

    def test_presets_json_loads(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "presets.json"
            save_presets(
                path,
                {
                    "Docs": {
                        "url": "https://example.com/",
                        "project": "docs",
                        "prefix": "/docs/",
                        "mode": "Documentacao padrao",
                        "use_playwright": True,
                        "clean_markdown": False,
                    }
                },
            )
            presets = load_presets(path)
            self.assertTrue(presets["Docs"]["use_playwright"])
            self.assertEqual(presets["Docs"]["project"], "docs")

    def test_invalid_presets_json_returns_defaults_with_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "presets.json"
            path.write_text("{invalid", encoding="utf-8")
            warnings: list[str] = []

            presets = load_presets(path, warnings)

            self.assertIn("Custom", presets)
            self.assertTrue(warnings)
            self.assertIn("presets.json inválido", warnings[0])

    def test_css_remove_with_fake_html(self) -> None:
        html = "<html><body><nav>Menu</nav><main><h1>Docs</h1><p>Useful content here.</p></main></body></html>"
        filtered = apply_css_filters(html, css_remove="nav")
        self.assertNotIn("Menu", filtered)
        self.assertIn("Useful content here.", filtered)


if __name__ == "__main__":
    unittest.main()
