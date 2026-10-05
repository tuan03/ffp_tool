"""Cross-module auth integration; private temporary databases, no external actions."""
import base64
from contextlib import asynccontextmanager
import importlib
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

auth = importlib.import_module("src.modules.amazon-crawler.engine.distributed.operator_authorization")
review = importlib.import_module("src.modules.review-image.server")
INTERNAL = "internal-fixture-credential-123456"
EXTENSION = "extension-fixture-credential-12345"
PIPELINE = "pipeline-fixture-credential-123456"


class ReviewOperatorBoundaryTests(unittest.TestCase):
    def test_coordinator_composition_reads_server_operator_credentials_without_fallback(self):
        composition = importlib.import_module("scripts.coordinator_app")
        self.assertIsNone(composition.operator_credentials_from_environment({}))
        with self.assertRaises(ValueError):
            composition.operator_credentials_from_environment({"FFP_OPERATOR_USERNAME": "operator"})
        credentials = composition.operator_credentials_from_environment({
            "FFP_OPERATOR_USERNAME": "operator", "FFP_OPERATOR_PASSWORD": "fixture-password",
        })
        self.assertTrue(credentials.accepts("Basic " + base64.b64encode(b"operator:fixture-password").decode()))
        self.assertNotIn("fixture-password", repr(credentials))

    def test_bridge_is_scoped_audited_and_does_not_replace_operator_or_pipeline(self):
        with tempfile.TemporaryDirectory() as temporary:
            engine = create_engine("sqlite:///" + str(Path(temporary) / "test.sqlite3"), connect_args={"check_same_thread": False})
            auth.OperatorAudit.__table__.create(engine)
            sessions = sessionmaker(engine)
            child = review.create_review_app(engine=engine, runtime_root=Path(temporary) / "assets",
                internal_token=INTERNAL, extension_token=EXTENSION, pipeline_token=PIPELINE)
            @asynccontextmanager
            async def lifespan(parent):
                async with child.router.lifespan_context(child):
                    yield
            parent = FastAPI(lifespan=lifespan)
            auth.install_operator_authorization(parent, sessions, auth.OperatorCredentials("fixture", "password"))
            @parent.get("/api/v1/clients")
            def clients():
                return []
            parent.state.review_image_authorization = getattr(child.state, "authorizes_operator_request", None)
            parent.mount("/", child)
            bridge = {"X-Bridge-Token": INTERNAL}
            operator = {"Authorization": "Basic " + base64.b64encode(b"fixture:password").decode()}
            with TestClient(parent) as client:
                for headers in ({}, {"X-Bridge-Token": EXTENSION}, {"X-Bridge-Token": "wrong"}, operator):
                    self.assertEqual(client.get("/api/review-images/health", headers=headers).status_code, 401)
                self.assertEqual(client.get("/api/review-images/health", headers=bridge).status_code, 200)
                self.assertEqual(client.get("/api/review-images/templates?storeId=fixture", headers=bridge).status_code, 200)
                from io import BytesIO
                from PIL import Image
                image = BytesIO()
                Image.new("RGB", (8, 8), "white").save(image, format="PNG")
                uploaded = client.post("/api/review-images/templates", headers=bridge, json={
                    "storeId": "fixture", "fileName": "fixture.png",
                    "imageDataUrl": "data:image/png;base64," + base64.b64encode(image.getvalue()).decode(),
                })
                self.assertEqual(uploaded.status_code, 201)
                self.assertEqual(client.get("/api/v1/clients", headers=bridge).status_code, 401)
                self.assertEqual(client.get("/api/v1/clients", headers=operator).status_code, 200)
                self.assertEqual(client.get("/api/review-images/not-registered", headers=bridge).status_code, 401)
                self.assertEqual(client.post("/api/review-images/templates", headers={**bridge, "Origin": "https://evil.invalid"}, json={}).status_code, 403)
                claim = "/api/v1/internal/review-images/uploads/claim"
                self.assertEqual(client.post(claim, headers=bridge).status_code, 401)
                self.assertEqual(client.post(claim, headers={"X-Pipeline-Key": PIPELINE}).status_code, 200)
                with sessions() as session:
                    records = session.scalars(select(auth.OperatorAudit).where(auth.OperatorAudit.actor == "review-image-bridge")).all()
                    self.assertTrue(any(record.status_code == 200 for record in records))
                for token in ("wrong", EXTENSION, EXTENSION):
                    with client.websocket_connect("/api/review-images/extension", headers={"origin": "chrome-extension://fixture"}) as socket:
                        socket.send_json({"type": "authenticate", "token": token})
                        if token == "wrong":
                            with self.assertRaises(WebSocketDisconnect) as caught:
                                socket.receive_json()
                            self.assertEqual(caught.exception.code, 4401)
                        else:
                            self.assertEqual(socket.receive_json()["type"], "hello")
                            socket.send_json({"type": "ping"})
                            self.assertEqual(socket.receive_json()["type"], "pong")
            engine.dispose()


@unittest.skipUnless(os.getenv("FFP_REVIEW_AUDIT_POSTGRES") == "1", "Explicit isolated PostgreSQL audit only")
class ComposedReviewPostgresTests(unittest.TestCase):
    def test_real_composition_retains_bridge_and_operator_boundaries(self):
        from scripts.audits.audit_lease_baseline import local_test_url
        composition = importlib.import_module("scripts.coordinator_app")
        coordinator = importlib.import_module("src.modules.amazon-crawler.engine.distributed.coordinator_server")
        schema = "ffp_review_audit_" + uuid.uuid4().hex
        admin = create_engine(local_test_url(), hide_parameters=True)
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = local_test_url().update_query_dict({"options": "-csearch_path=" + schema}).render_as_string(hide_password=False)
        try:
            with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {
                "AMAZON_COORDINATOR_DATABASE_URL": url,
                "REVIEW_IMAGE_BRIDGE_TOKEN": INTERNAL, "REVIEW_IMAGE_EXTENSION_TOKEN": EXTENSION,
                "SHOPIFY_PIPELINE_TOKEN": PIPELINE, "REVIEW_IMAGE_RUNTIME_ROOT": temporary + "/review",
                "IMAGE_PROCESSING_CACHE_DIR": temporary + "/images", "PINTEREST_RUNTIME_ROOT": temporary + "/pinterest",
            }), patch.object(coordinator, "find_project_root", return_value=Path(temporary)):
                app = composition.create_app(operator_credentials=auth.OperatorCredentials("fixture", "password"))
                with TestClient(app) as client:
                    headers = {"X-Bridge-Token": INTERNAL}
                    self.assertEqual(client.get("/api/review-images/health", headers=headers).status_code, 200)
                    self.assertEqual(client.get("/api/review-images/templates?storeId=fixture", headers=headers).status_code, 200)
                    self.assertEqual(client.get("/api/review-images/health").status_code, 401)
                    self.assertEqual(client.get("/api/v1/clients", headers=headers).status_code, 401)
                    with client.websocket_connect("/api/review-images/extension", headers={"origin": "chrome-extension://fixture"}) as socket:
                        socket.send_json({"type": "authenticate", "token": EXTENSION})
                        self.assertEqual(socket.receive_json()["type"], "hello")
                    self.assertEqual(client.get("/api/v1/ready").status_code, 200)
        finally:
            # Only the random schema created by this invocation, never public/application data.
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
                self.assertIsNone(connection.scalar(text("SELECT schema_name FROM information_schema.schemata WHERE schema_name=:name"), {"name": schema}))
            admin.dispose()


if __name__ == "__main__":
    unittest.main()
