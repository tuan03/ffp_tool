import importlib

import pytest
from sqlalchemy import create_engine


def repository():
    module = importlib.import_module("src.modules.review-image.server.persistence")
    return module.ReviewRepository(create_engine("sqlite:///:memory:"))


def test_restart_preserves_approval_and_fails_interrupted_jobs():
    store = repository()
    store.initialize()
    store.put("job", "done", {"job_id": "done", "status": "completed", "approved": True})
    store.put("job", "pending", {"job_id": "pending", "status": "running", "approved": False})
    store.recover()
    assert store.get("job", "done")["approved"] is True
    assert store.get("job", "pending")["status"] == "failed"
    assert "restart" in store.get("job", "pending")["error"].lower()


def test_upload_claim_is_fenced_and_never_replayed_after_restart():
    store = repository()
    store.initialize()
    store.enqueue_upload("job1", "capozen", "job1.png")
    first = store.claim_upload()
    assert first["jobId"] == "job1"
    assert store.claim_upload() is None
    store.enqueue_upload("job1", "capozen", "job1.png")
    assert store.claim_upload() is None
    with pytest.raises(ValueError):
        store.finish_upload("job1", "wrong-attempt", {"fileId": "x"})
    store.finish_upload("job1", first["attemptId"], {"fileId": "x"})
    store.recover()
    assert store.get("upload", "job1")["result"]["fileId"] == "x"
    with pytest.raises(ValueError):
        store.enqueue_upload("job1", "jeminise", "job1.png")


def test_expired_worker_attempt_is_uncertain_not_requeued():
    store = repository()
    store.initialize()
    store.enqueue_upload("expired", "capozen", "expired.png")
    attempt = store.claim_upload()
    attempt["claimedAt"] = 0
    store.put("upload", "expired", attempt)
    assert store.claim_upload() is None
    assert store.get("upload", "expired")["status"] == "uncertain"
    store.finish_upload("expired", attempt["attemptId"], {"fileId": "late-result"})
    assert store.get("upload", "expired")["status"] == "completed"
