FROM debian:bookworm-slim

# Base runtime: bun + python3 + curl + git + ca-certs.
# Total image size ~150MB.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      python3 \
      python3-pip \
      unzip \
 && rm -rf /var/lib/apt/lists/*

# Install bun (latest). Bun's installer drops the binary in /root/.bun/bin.
RUN curl -fsSL https://bun.sh/install | bash \
 && cp /root/.bun/bin/bun /usr/local/bin/bun \
 && bun --version

WORKDIR /work

# Default command keeps the container alive long enough for `docker exec`.
CMD ["sleep", "infinity"]
