from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_PRESETS: dict[str, dict[str, Any]] = {
    "Custom": {
        "url": "",
        "project": "",
        "prefix": "",
        "mode": "Documentacao padrao",
        "use_playwright": False,
        "clean_markdown": True,
    },
    "Pushinpay": {
        "url": "https://app.theneo.io/pushinpay/pix/pix",
        "project": "pushinpay_docs",
        "prefix": "/pushinpay/",
        "mode": "Documentacao padrao",
        "use_playwright": False,
        "clean_markdown": True,
    },
    "PagNiv": {
        "url": "https://devs.pagniv.com/docs/",
        "project": "pagniv_docs",
        "prefix": "/docs/",
        "mode": "Documentacao padrao",
        "use_playwright": False,
        "clean_markdown": True,
    },
    "CashinpayBR": {
        "url": "https://integre.cashinpaybr.com/",
        "project": "cashinpaybr_docs",
        "prefix": "",
        "mode": "Documentacao padrao",
        "use_playwright": False,
        "clean_markdown": True,
    },
    "Appmax": {
        "url": "https://appmax.readme.io/reference/",
        "project": "appmax_docs",
        "prefix": "/reference/",
        "mode": "Documentacao padrao",
        "use_playwright": False,
        "clean_markdown": True,
    },
}


def normalize_preset(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": str(data.get("url", "")),
        "project": str(data.get("project", "")),
        "prefix": str(data.get("prefix", "")),
        "mode": str(data.get("mode", "Documentacao padrao")),
        "use_playwright": bool(data.get("use_playwright", False)),
        "clean_markdown": bool(data.get("clean_markdown", True)),
    }


def load_presets(path: Path, warnings: list[str] | None = None) -> dict[str, dict[str, Any]]:
    if not path.exists():
        save_presets(path, DEFAULT_PRESETS)
        return dict(DEFAULT_PRESETS)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        if warnings is not None:
            warnings.append(f"presets.json inválido em {path}: {exc}. Usando presets padrão.")
        data = {}
    if not isinstance(data, dict):
        if warnings is not None:
            warnings.append(f"presets.json inválido em {path}: esperava um objeto JSON. Usando presets padrão.")
        data = {}
    presets = {name: normalize_preset(value) for name, value in data.items() if isinstance(value, dict)}
    for name, value in DEFAULT_PRESETS.items():
        presets.setdefault(name, value)
    return presets


def save_presets(path: Path, presets: dict[str, dict[str, Any]]) -> Path:
    path.write_text(json.dumps(presets, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
