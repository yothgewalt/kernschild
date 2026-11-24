FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/
ENV UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1 PYTHONPATH=/app/gen
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY main.py ./
COPY gen ./gen
RUN useradd -r -u 10001 app
USER app
EXPOSE 50053
CMD ["/app/.venv/bin/python", "main.py"]
