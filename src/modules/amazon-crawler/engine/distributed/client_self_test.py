"""Non-mutating, bounded readiness report for a remote crawler agent."""
from __future__ import annotations

import json
from typing import Any


def build_self_test_report(*, session_authenticated: bool, storage: dict[str, Any],
                           database_integrity: bool, worker_health: dict[str, Any]) -> dict[str, Any]:
    checks: dict[str, dict[str, Any]] = {
        "authentication": {
            "status": "PASS" if session_authenticated else "FAIL",
            "detail": "Authenticated coordinator session is active." if session_authenticated
            else "No authenticated coordinator session is active.",
        },
        "disk": {
            "status": "FAIL" if storage.get("blocked") or not database_integrity
            else "DEGRADED" if storage.get("warnings") else "PASS",
            "detail": {
                "databaseIntegrity": "ok" if database_integrity else "failed",
                "freeBytes": storage.get("freeBytes") if type(storage.get("freeBytes")) is int else None,
                "blocked": storage.get("blocked") is True,
                "reasons": [str(reason)[:64] for reason in storage.get("reasons", [])[:8]
                            if isinstance(reason, str)],
                "warnings": [str(warning)[:64] for warning in storage.get("warnings", [])[:8]
                             if isinstance(warning, str)],
            },
        },
        "worker": {
            "status": "DEGRADED" if worker_health.get("state") == "degraded" else "PASS",
            "detail": {
                "state": worker_health.get("state") if worker_health.get("state") in {"healthy", "degraded"}
                else "unknown",
                "failuresInWindow": _bounded_int(worker_health.get("failuresInWindow")),
                "effectiveConcurrency": _bounded_int(worker_health.get("effectiveConcurrency")),
            },
        },
    }
    overall = _overall_status(checks)
    report: dict[str, Any] = {"status": overall, "checks": checks}
    try:
        serialized = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > 4096 or json.loads(serialized) != report:
            raise ValueError("Self-test report serialization exceeded its safe bound.")
        checks["serialization"] = {"status": "PASS", "detail": {"bytes": len(serialized.encode("utf-8"))}}
    except (TypeError, ValueError, UnicodeError):
        checks["serialization"] = {"status": "FAIL", "detail": "Report could not be safely serialized."}
    report["status"] = _overall_status(checks)
    return report


def _overall_status(checks: dict[str, dict[str, Any]]) -> str:
    statuses = [check["status"] for check in checks.values()]
    return "FAIL" if "FAIL" in statuses else "DEGRADED" if "DEGRADED" in statuses else "PASS"


def _bounded_int(value: Any) -> int:
    return max(0, min(2**53 - 1, value)) if type(value) is int else 0
