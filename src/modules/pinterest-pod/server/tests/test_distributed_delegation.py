from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import pinterest_pod_bridge as bridge


class PinterestDistributedDelegationTests(unittest.TestCase):
    def test_create_job_enqueues_coordinator_without_starting_local_worker(self) -> None:
        queued = {
            "ok": True,
            "id": "distributed-job-1",
            "jobId": "distributed-job-1",
            "status": "queued",
            "settings": {"channel": "pinterest"},
        }
        with (
            patch.object(bridge, "submit_distributed_pinterest_job", return_value=queued) as submit,
            patch.object(bridge.threading, "Thread") as local_thread,
        ):
            response = bridge.create_pod_job(
                {"niche": "leather bag", "product": "bag", "workflow_stage": "crawl_and_review"},
                "https://ffp.example",
            )

        self.assertEqual(response["status"], "queued")
        submitted = submit.call_args.args[0]
        self.assertEqual(submitted["stage"], "crawl_and_review")
        self.assertEqual(submitted["action"], "crawl_and_review")
        local_thread.assert_not_called()

    def test_production_job_enqueues_coordinator_without_starting_local_worker(self) -> None:
        source = {
            "ok": True,
            "jobId": "source-job",
            "status": "ready_for_review",
            "settings": {"channel": "pinterest"},
            "niche": "leather bag",
            "product": "bag",
            "candidates": [{"image_id": "pin-1", "image_url": "https://i.pinimg.com/pin-1.jpg"}],
        }
        queued = {
            "ok": True,
            "jobId": "production-job",
            "status": "queued",
            "settings": {"channel": "pinterest"},
        }
        with (
            patch.object(bridge, "load_distributed_pinterest_job", return_value=source),
            patch.object(bridge, "submit_distributed_pinterest_job", return_value=queued) as submit,
            patch.object(bridge.threading, "Thread") as local_thread,
        ):
            response = bridge.produce_pod_job(
                {"jobId": "source-job", "selected_candidates": ["pin-1"]},
                "https://ffp.example",
            )

        self.assertEqual(response["status"], "queued")
        submitted = submit.call_args.args[0]
        self.assertEqual(submitted["stage"], "produce")
        self.assertEqual(submitted["selected_candidates"][0]["image_id"], "pin-1")
        local_thread.assert_not_called()

    def test_status_and_cancel_delegate_to_coordinator(self) -> None:
        snapshot = {
            "ok": True,
            "jobId": "distributed-job-1",
            "status": "queued",
            "settings": {"channel": "pinterest"},
        }
        with patch.object(bridge, "load_distributed_pinterest_job", return_value=snapshot):
            self.assertEqual(
                bridge.get_pod_job_status("distributed-job-1", "https://ffp.example"),
                snapshot,
            )

        with patch.object(bridge, "http_post_json", return_value=(200, {**snapshot, "status": "cancelled"})) as post:
            response = bridge.cancel_pod_job("distributed-job-1")

        self.assertEqual(response["status"], "cancelled")
        self.assertIn("/api/v1/crawl-jobs/distributed-job-1/cancel", post.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
