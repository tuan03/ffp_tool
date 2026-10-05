"""Helpers that initialize current Coordinator persistence for isolated tests."""
from sqlalchemy import select

from engine.distributed.coordinator_models import Base
from engine.distributed.global_admission_gate import GlobalAdmissionGate, GLOBAL_ADMISSION_GATE_ID


def create_coordinator_test_schema(engine) -> None:
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        existing = connection.scalar(select(GlobalAdmissionGate.id).where(
            GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID,
        ))
        if existing is None:
            connection.execute(GlobalAdmissionGate.__table__.insert().values(
                id=GLOBAL_ADMISSION_GATE_ID, state="OPEN", scope="crawler", revision=0,
            ))
