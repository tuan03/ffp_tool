"""Offline smoke test of a real packaged Agent against an isolated temporary DB."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/modules/amazon-crawler"))
from engine.distributed import AGENT_VERSION
from engine.distributed.client_config import AgentConfig
from engine.distributed.client_store import ClientStore


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    args = parser.parse_args()
    executable = args.executable.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="ffp-zip-smoke-") as temporary:
        root = Path(temporary)
        config = root / "agent.json"
        config.write_text(json.dumps({"serverUrl": "http://127.0.0.1:9", "displayName": "Isolated update probe",
            "dataDirectory": str(root / "data"), "maxConcurrentInputs": 1}), encoding="utf-8")
        resolved = AgentConfig.load(config)
        store = ClientStore(resolved.data_directory / "agent.sqlite3")
        store.set_paused(True)
        identity = store.client_id()
        receipt = root / "probe.json"
        completed = subprocess.run([str(executable), "--config", str(config), "--zip-update-probe", str(receipt)],
            cwd=executable.parent, timeout=90, creationflags=0x08000000, capture_output=True)
        if completed.returncode != 0 or not receipt.is_file():
            raise RuntimeError("Packaged Agent failed offline startup probe.")
        report = json.loads(receipt.read_text(encoding="utf-8"))
        if report != {"status": "PASS", "version": AGENT_VERSION, "clientId": identity}:
            raise RuntimeError("Packaged Agent reported unexpected version, database or identity.")
        print(f"PASS: packaged Agent {AGENT_VERSION}, offline startup, paused database, stable identity.")


if __name__ == "__main__":
    main()
