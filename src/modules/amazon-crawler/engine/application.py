"""Public ASGI application factory for the deployment composition root."""
from .distributed.coordinator_server import create_coordinator_app

__all__ = ["create_coordinator_app"]
