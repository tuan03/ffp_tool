FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY deploy/amazon-crawler-coordinator/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY src/modules/amazon-crawler /app/amazon-crawler

EXPOSE 8766
CMD ["python", "-m", "uvicorn", "engine.distributed.coordinator_server:app", "--app-dir", "/app/amazon-crawler", "--host", "0.0.0.0", "--port", "8766"]
