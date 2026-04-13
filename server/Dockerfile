# ── Build stage ──────────────────────────────────────────────────
FROM rust:1.85-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cache dependency build: copy manifests first, create dummy src
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

# Now copy real source + migrations and build for real
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

# ── Runtime stage ────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/nairobi-transit /usr/local/bin/
COPY --from=builder /app/migrations /migrations

EXPOSE 8080

# Non-root user for security
RUN groupadd -r transit && useradd -r -g transit transit
USER transit

CMD ["nairobi-transit"]
