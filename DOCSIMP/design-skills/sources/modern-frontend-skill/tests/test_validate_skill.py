#!/usr/bin/env python3
"""
Tests for validate_skill.py
Run: python -m pytest tests/ -v
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from validate_skill import validate_skill


VALID_SKILL = """---
name: test-skill
description: >
  A test skill that does many things. Use this skill whenever the user asks about
  testing, validation, or quality assurance of frontend components and designs.
---

# Test Skill

This is a valid skill with proper structure.

## Section One

Instructions here.

## Section Two

More instructions here.
"""

MISSING_NAME = """---
description: A skill without a name field
---

# No Name Skill

Content here.
"""

MISSING_DESCRIPTION = """---
name: no-desc
---

# No Description

Content here.
"""

NO_FRONTMATTER = """# Just a Heading

No frontmatter at all.
"""

SHORT_DESCRIPTION = """---
name: short-desc
description: Too short
---

# Short Description Skill

Content here.

## Section One

Instructions.
"""


def write_temp(content: str) -> str:
    """Write content to a temp file and return its path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8")
    f.write(content)
    f.close()
    return f.name


def test_valid_skill():
    path = write_temp(VALID_SKILL)
    issues = validate_skill(path)
    assert len(issues) == 0, f"Expected no issues, got: {issues}"


def test_missing_name():
    path = write_temp(MISSING_NAME)
    issues = validate_skill(path)
    assert any("name" in i.lower() for i in issues), f"Expected 'name' issue, got: {issues}"


def test_missing_description():
    path = write_temp(MISSING_DESCRIPTION)
    issues = validate_skill(path)
    assert any("description" in i.lower() for i in issues), f"Expected 'description' issue, got: {issues}"


def test_no_frontmatter():
    path = write_temp(NO_FRONTMATTER)
    issues = validate_skill(path)
    assert any("frontmatter" in i.lower() for i in issues), f"Expected 'frontmatter' issue, got: {issues}"


def test_short_description():
    path = write_temp(SHORT_DESCRIPTION)
    issues = validate_skill(path)
    assert any("short" in i.lower() for i in issues), f"Expected 'short' issue, got: {issues}"


def test_file_not_found():
    issues = validate_skill("/nonexistent/path/SKILL.md")
    assert any("not found" in i.lower() for i in issues)


if __name__ == "__main__":
    tests = [
        test_valid_skill,
        test_missing_name,
        test_missing_description,
        test_no_frontmatter,
        test_short_description,
        test_file_not_found,
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
