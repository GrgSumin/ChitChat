FROM python:3.12-slim

WORKDIR /service

# libgomp1 is the GNU OpenMP runtime. The `implicit` wheels are compiled
# against it and fail at import with "libgomp.so.1: cannot open shared object
# file" without it -- python:*-slim does not include it. macOS wheels bundle
# their own OpenMP, so this only bites inside the container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install deps first so Docker caches this layer across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# models/ is a volume in compose so a trained model survives restarts.
RUN mkdir -p models

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
