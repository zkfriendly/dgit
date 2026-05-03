FROM golang:1.25-alpine AS axl-builder

RUN apk add --no-cache git make

WORKDIR /src/axl
COPY axl/go.mod axl/go.sum axl/Makefile ./
RUN go mod download
COPY axl/ ./
RUN make build && mkdir -p /out && cp node /out/axl-node


FROM debian:bookworm-slim AS haxy-builder

ARG ZIG_VERSION=0.16.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) zig_arch="x86_64-linux" ;; \
      arm64) zig_arch="aarch64-linux" ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSLo /tmp/zig.tar.xz "https://ziglang.org/download/${ZIG_VERSION}/zig-${zig_arch}-${ZIG_VERSION}.tar.xz" \
    && mkdir -p /opt/zig \
    && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
    && ln -s /opt/zig/zig /usr/local/bin/zig \
    && rm /tmp/zig.tar.xz

WORKDIR /src/node
COPY node/build.zig node/build.zig.zon ./
COPY node/src ./src
RUN zig build -Doptimize=ReleaseSafe


FROM python:3.12-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git openssl tini \
    && curl -fsSL https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup \
    && cp /root/.foundry/bin/cast /usr/local/bin/cast \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=axl-builder /out/axl-node /usr/local/bin/axl-node
COPY --from=haxy-builder /src/node/zig-out/bin/haxy /usr/local/bin/haxy
COPY scripts/dgit_axl_bridge.py /usr/local/bin/dgit_axl_bridge.py
COPY docker/entrypoint.sh /usr/local/bin/dgit-entrypoint
COPY contracts/broadcast/DeployGitSubnameRegistrar.s.sol/11155111/run-latest.json /app/contracts/broadcast/DeployGitSubnameRegistrar.s.sol/11155111/run-latest.json

RUN chmod +x /usr/local/bin/axl-node /usr/local/bin/haxy /usr/local/bin/dgit_axl_bridge.py /usr/local/bin/dgit-entrypoint

ENV DATA_DIR=/data \
    AXL_DIR=/data/axl \
    HAXY_DATA_DIR=/data/haxy \
    HAXY_ENDPOINT=127.0.0.1:8080 \
    AXL_ENDPOINT=127.0.0.1:9002 \
    DGIT_PUBLIC_ENDPOINT=127.0.0.1:8090 \
    DGIT_REGISTRAR_ADDRESS=0xEC246e46af036FD12bdA86F96aCce83fF9c62788 \
    SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
    CAST_BIN=/usr/local/bin/cast

VOLUME ["/data"]
EXPOSE 8090 8080 9002

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dgit-entrypoint"]
