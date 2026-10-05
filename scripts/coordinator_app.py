"""Compose crawler and Review Studio in the existing Coordinator process."""
from contextlib import asynccontextmanager
import asyncio
import importlib
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from starlette.responses import JSONResponse

crawler = importlib.import_module("src.modules.amazon-crawler.engine.application")
operator_authorization = importlib.import_module("src.modules.amazon-crawler.engine.distributed.operator_authorization")
review = importlib.import_module("src.modules.review-image.server")


def operator_credentials_from_environment(environ=os.environ):
    username = environ.get("FFP_OPERATOR_USERNAME", "")
    password = environ.get("FFP_OPERATOR_PASSWORD", "")
    if bool(username) != bool(password):
        raise ValueError("Configure both FFP_OPERATOR_USERNAME and FFP_OPERATOR_PASSWORD")
    if not username:
        return None
    return operator_authorization.OperatorCredentials(username, password)


def operator_auth_enabled_from_environment(environ=os.environ):
    value = environ.get("FFP_CRAWLER_OPERATOR_AUTH_ENABLED", "true").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError("FFP_CRAWLER_OPERATOR_AUTH_ENABLED must be true or false")


def create_app(*, operator_credentials=None):
    database_url = os.environ.get("AMAZON_COORDINATOR_DATABASE_URL", "")
    if not database_url or make_url(database_url).get_backend_name() != "postgresql":
        raise ValueError("Unified Coordinator requires the shared PostgreSQL database")
    internal = os.environ.get("REVIEW_IMAGE_BRIDGE_TOKEN", "")
    extension = os.environ.get("REVIEW_IMAGE_EXTENSION_TOKEN", "")
    pipeline = os.environ.get("SHOPIFY_PIPELINE_TOKEN", "")
    if any(len(value) < 24 or value == "change-this-token" for value in (internal, extension, pipeline)):
        raise ValueError("Configure strong Review Studio internal/extension and pipeline tokens before startup")
    operator_auth_enabled = operator_auth_enabled_from_environment()
    if not operator_auth_enabled:
        operator_credentials = None
    elif operator_credentials is None:
        operator_credentials = operator_credentials_from_environment()
    app = crawler.create_coordinator_app(database_url=database_url, operator_credentials=operator_credentials,
        operator_auth_disabled=not operator_auth_enabled)
    review_app = review.create_review_app(
        engine=create_engine(database_url, pool_pre_ping=True),
        runtime_root=Path(os.environ.get("REVIEW_IMAGE_RUNTIME_ROOT", "/app/.runtime/review-image")),
        internal_token=internal, extension_token=extension, pipeline_token=pipeline,
    )
    crawler_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(parent):
        async with crawler_lifespan(parent), review_app.router.lifespan_context(review_app):
            yield

    app.router.lifespan_context = lifespan

    @app.middleware("http")
    async def aggregate_readiness(request, call_next):
        if request.url.path == "/api/v1/ready":
            try:
                await asyncio.to_thread(review_app.state.repository.ready)
            except Exception:
                return JSONResponse(status_code=503, content={"detail": "Review Studio persistence unavailable"})
        return await call_next(request)

    app.state.review_image_authorization = review_app.state.authorizes_operator_request
    app.mount("/", review_app)
    return app
