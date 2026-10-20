#!/usr/bin/env python3
"""
CLI Wrapper for site_docs_extractor.
Outputs strictly JSON to stdout upon completion or failure.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add current directory to sys.path so extractor modules can be imported
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

try:
    from extractor.runner import ExtractionConfig, run_extraction
    from extractor.utils import suggest_project_name_from_url
except ImportError as e:
    sys.stdout.write(json.dumps({"success": False, "error": f"Import error: {e}"}))
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="CLI Extractor for site documentation")
    parser.add_argument("--url", required=True, help="Target documentation base URL")
    parser.add_argument("--project-name", default="", help="Project name / slug identifier")
    parser.add_argument("--max-pages", type=int, default=15, help="Maximum number of pages to crawl")
    parser.add_argument("--output-dir", default="", help="Output base directory")
    parser.add_argument("--use-playwright", action="store_true", help="Use Playwright for JS rendering")

    args = parser.parse_args()

    project_name = args.project_name.strip()
    if not project_name:
        project_name = suggest_project_name_from_url(args.url)
        if not project_name:
            project_name = "site_docs"

    if args.output_dir.strip():
        outputs_dir = Path(args.output_dir.strip()).resolve()
    else:
        outputs_dir = (CURRENT_DIR / "outputs").resolve()

    outputs_dir.mkdir(parents=True, exist_ok=True)

    config = ExtractionConfig(
        start_url=args.url.strip(),
        project_name=project_name,
        max_pages=max(1, args.max_pages),
        use_playwright=args.use_playwright,
    )

    try:
        # Pass log to stderr to keep stdout strictly for JSON
        summary = run_extraction(
            config=config,
            outputs_dir=outputs_dir,
            log=lambda msg: sys.stderr.write(f"{msg}\n"),
        )

        doc_path = summary.knowledge_ready_file or summary.complete_file
        doc_abs_path = str(Path(doc_path).resolve()) if doc_path else ""

        result = {
            "success": True,
            "project_name": project_name,
            "doc_path": doc_abs_path,
            "pages_extracted": summary.success_count,
            "total_urls": summary.total_urls,
            "fail_count": summary.fail_count,
        }
        sys.stdout.write(json.dumps(result))
        sys.exit(0)
    except Exception as exc:
        err_result = {
            "success": False,
            "project_name": project_name,
            "error": str(exc),
        }
        sys.stdout.write(json.dumps(err_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
