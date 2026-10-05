from __future__ import annotations

import unittest
import uuid

from pydantic import ValidationError
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

from engine.distributed.agent_command_ledger import AgentCommandLedger
from engine.distributed.agent_runtime_config import AgentRuntimeConfig
from engine.distributed.coordinator_models import ClientRecord


class AgentRuntimeConfigTests(unittest.TestCase):
    def test_defaults_are_secret_free_and_timeout_relationships_are_valid(self):
        config = AgentRuntimeConfig.from_payload({})

        self.assertEqual(config.maxConcurrentInputs, 4)
        self.assertEqual(config.heartbeatIntervalSeconds, 10)
        self.assertEqual(config.clientOfflineAfterSeconds, 30)
        self.assertEqual(config.leaseSeconds, 60)
        self.assertNotIn("serverUrl", config.to_payload())

    def test_rejects_timeout_relationships_that_could_reap_live_agents_or_leases(self):
        with self.assertRaises(ValidationError):
            AgentRuntimeConfig.from_payload({
                "heartbeatIntervalSeconds": 20,
                "clientOfflineAfterSeconds": 30,
                "leaseSeconds": 60,
            })
        with self.assertRaises(ValidationError):
            AgentRuntimeConfig.from_payload({
                "heartbeatIntervalSeconds": 10,
                "clientOfflineAfterSeconds": 30,
                "leaseSeconds": 50,
            })

    def test_rejects_out_of_range_values_and_unknown_or_secret_fields(self):
        for payload in (
            {"maxConcurrentInputs": 0},
            {"limits": {"browserTabs": 13}},
            {"serverUrl": "https://example.test"},
            {"actionKey": "must-never-be-distributed"},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                AgentRuntimeConfig.from_payload(payload)


class PostgreSqlAgentRuntimeConfigTests(unittest.TestCase):
    external_engine = None

    def test_versioned_config_ack_is_durable_and_rejects_wrong_version(self):
        if self.external_engine is None:
            self.skipTest("PostgreSQL audit harness only")
        sessions = sessionmaker(self.external_engine, expire_on_commit=False)
        agent_id = "config-audit-" + uuid.uuid4().hex
        with sessions.begin() as session:
            session.add(ClientRecord(id=agent_id, display_name="Config audit"))
        ledger = AgentCommandLedger(sessions)
        first = ledger.submit_config(agent_id, uuid.uuid4().hex, 300,
                                     AgentRuntimeConfig.from_payload({"maxConcurrentInputs": 3}))
        for status in ("ACKED", "RUNNING", "SUCCESS"):
            update = {"commandId": first["commandId"], "sequence": 1, "status": status}
            if status == "SUCCESS":
                update["result"] = {"appliedConfigVersion": 1}
            ledger.update(agent_id, update)
        with sessions() as session:
            stored = session.get(ClientRecord, agent_id)
            self.assertEqual(stored.applied_config_version, 1)
            self.assertEqual(stored.applied_agent_config["maxConcurrentInputs"], 3)

        second = ledger.submit_config(agent_id, uuid.uuid4().hex, 300,
                                      AgentRuntimeConfig.from_payload({"maxConcurrentInputs": 5}))
        for status in ("ACKED", "RUNNING"):
            ledger.update(agent_id, {"commandId": second["commandId"], "sequence": 2, "status": status})
        with self.assertRaisesRegex(HTTPException, "acknowledgement does not match"):
            ledger.update(agent_id, {"commandId": second["commandId"], "sequence": 2, "status": "SUCCESS",
                                     "result": {"appliedConfigVersion": 1}})
        with sessions() as session:
            stored = session.get(ClientRecord, agent_id)
            self.assertEqual(stored.applied_config_version, 1)
            self.assertEqual(stored.applied_agent_config["maxConcurrentInputs"], 3)


if __name__ == "__main__":
    unittest.main()
