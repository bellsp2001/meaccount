"""
Seed script integrity tests.

Why this file exists: during the Phase 1-4 audit, 6 of 7 seed scripts were
found completely broken (NoReferencedTableError) because W35-36 added
`Account.company_id -> companies.id` but the older seed scripts hand-listed
only the models that existed when they were written. A fresh install
following DEPLOYMENT.md would have failed at the seeding step.

The main test suite never caught it because tests import models transitively
through main.py, which imports everything. These tests specifically exercise
the standalone-script path that real deployments actually use.
"""
import subprocess
import sys
import os
import glob
import pytest


SEED_SCRIPTS = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "scripts", "seed*.py")))


def test_seed_scripts_exist():
    assert len(SEED_SCRIPTS) >= 7, f"Expected at least 7 seed scripts, found {len(SEED_SCRIPTS)}"


@pytest.mark.parametrize("script_path", SEED_SCRIPTS, ids=lambda p: os.path.basename(p))
def test_seed_script_runs_without_error(script_path, tmp_path):
    """
    Runs each seed script as a real subprocess against a throwaway SQLite DB —
    the same way an operator would run it during deployment. Catches model
    registration / foreign key resolution problems that in-process tests miss.
    """
    db_file = tmp_path / f"{os.path.basename(script_path)}.db"
    env = dict(os.environ)
    env["DATABASE_URL_OVERRIDE"] = f"sqlite:///{db_file}"
    env["TESTING"] = "true"

    api_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    result = subprocess.run(
        [sys.executable, script_path],
        capture_output=True, text=True, env=env, cwd=api_dir, timeout=120,
    )

    combined = result.stdout + result.stderr
    assert result.returncode == 0, (
        f"{os.path.basename(script_path)} exited with code {result.returncode}:\n{combined[-1500:]}"
    )
    assert "Traceback" not in combined, (
        f"{os.path.basename(script_path)} raised an exception:\n{combined[-1500:]}"
    )


def test_model_registry_imports_every_model_module():
    """
    Guards the root cause: models/registry.py must cover every module in
    models/. If a future sprint adds a model file and forgets to register
    it here, seed scripts can silently break again.
    """
    import pkgutil
    models_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    on_disk = {
        m.name for m in pkgutil.iter_modules([models_dir])
        if m.name not in ("base", "registry")
    }

    registry_path = os.path.join(models_dir, "registry.py")
    with open(registry_path) as f:
        registry_source = f.read()

    missing = [name for name in on_disk if f"models.{name}" not in registry_source]
    assert not missing, (
        f"models/registry.py is missing these model modules: {sorted(missing)}. "
        "Add them, or standalone scripts will fail with NoReferencedTableError."
    )
