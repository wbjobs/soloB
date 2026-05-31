FROM rust:1.74 as rust-builder

WORKDIR /app

RUN cargo install wasm-pack

COPY Cargo.toml .
COPY src/ ./src/

RUN wasm-pack build --target web --out-dir pkg

FROM python:3.11-slim

WORKDIR /app

COPY --from=rust-builder /app/pkg ./pkg

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

ENV DATABASE_URL=sqlite:///./pdf_scanner.db
ENV API_HOST=0.0.0.0
ENV API_PORT=8000
ENV WASM_MODULE_PATH=./pkg/pdf_security_scanner_bg.wasm

EXPOSE 8000

CMD ["python", "main.py"]
