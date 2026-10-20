from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


HISTORY_FILE_NAME = "extraction_history.json"


def history_path(outputs_dir: Path) -> Path:
    return outputs_dir / HISTORY_FILE_NAME


def load_history(outputs_dir: Path) -> list[dict[str, Any]]:
    path = history_path(outputs_dir)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def append_history(outputs_dir: Path, entry: dict[str, Any]) -> Path:
    outputs_dir.mkdir(parents=True, exist_ok=True)
    entries = load_history(outputs_dir)
    entry = {"datetime": datetime.now().isoformat(timespec="seconds"), **entry}
    entries.append(entry)
    path = history_path(outputs_dir)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def latest_output_dir(outputs_dir: Path) -> str | None:
    entries = load_history(outputs_dir)
    for entry in reversed(entries):
        output_dir = entry.get("output_dir")
        if output_dir:
            return str(output_dir)
    return None
