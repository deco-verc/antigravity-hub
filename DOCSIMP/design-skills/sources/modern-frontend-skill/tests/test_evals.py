#!/usr/bin/env python3
"""
Tests for evals.json structure validation.
Run: python -m pytest tests/ -v
"""

import json
from pathlib import Path

EVALS_PATH = Path(__file__).parent.parent / "skills" / "modern-frontend-design" / "evals" / "evals.json"


def load_evals():
    assert EVALS_PATH.exists(), f"evals.json not found at {EVALS_PATH}"
    with open(EVALS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_evals_file_exists():
    assert EVALS_PATH.exists()


def test_has_skill_name():
    data = load_evals()
    assert "skill_name" in data
    assert data["skill_name"] == "modern-frontend-design"


def test_has_evals_array():
    data = load_evals()
    assert "evals" in data
    assert isinstance(data["evals"], list)
    assert len(data["evals"]) >= 1


def test_eval_structure():
    data = load_evals()
    for ev in data["evals"]:
        assert "id" in ev, "Eval missing 'id'"
        assert "prompt" in ev, "Eval missing 'prompt'"
        assert "expected_output" in ev, "Eval missing 'expected_output'"
        assert len(ev["prompt"]) > 20, f"Eval #{ev['id']} prompt too short"


def test_eval_ids_unique():
    data = load_evals()
    ids = [ev["id"] for ev in data["evals"]]
    assert len(ids) == len(set(ids)), "Eval IDs are not unique"


def test_expectations_present():
    data = load_evals()
    for ev in data["evals"]:
        assert "expectations" in ev, f"Eval #{ev['id']} missing expectations"
        assert len(ev["expectations"]) >= 3, f"Eval #{ev['id']} has too few expectations"


def test_total_assertion_count():
    data = load_evals()
    total = sum(len(ev.get("expectations", [])) for ev in data["evals"])
    assert total >= 20, f"Only {total} total assertions — aim for 20+"


if __name__ == "__main__":
    tests = [
        test_evals_file_exists,
        test_has_skill_name,
        test_has_evals_array,
        test_eval_structure,
        test_eval_ids_unique,
        test_expectations_present,
        test_total_assertion_count,
    ]
    passed = 0
    for test in tests:
        try:
            test()
            print(f"  PASS  {test.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {test.__name__}: {e}")

    print(f"\n{passed}/{len(tests)} tests passed")
