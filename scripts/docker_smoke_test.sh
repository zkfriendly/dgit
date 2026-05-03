#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-dgit:local}"
PORT="${PORT:-$(python3 - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)}"
REPO_LABEL="${REPO_LABEL:-docker-smoke-$(date +%s)}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
CONTAINER_NAME="${CONTAINER_NAME:-dgit-smoke-$$}"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "PRIVATE_KEY must be set for the Docker smoke test because it claims ${REPO_LABEL}.git.eth" >&2
  exit 1
fi

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[smoke] building image $IMAGE"
docker build -t "$IMAGE" .

echo "[smoke] starting container $CONTAINER_NAME on host port $PORT"
docker run -d --name "$CONTAINER_NAME" \
  -p "$PORT:8090" \
  -e PRIVATE_KEY="$PRIVATE_KEY" \
  -e DGIT_PUBLIC_ENDPOINT="127.0.0.1:$PORT" \
  "$IMAGE" >/dev/null

echo "[smoke] waiting for bridge"
for _ in $(seq 1 90); do
  if git ls-remote "http://127.0.0.1:$PORT/not-yet-claimed@git.eth" >/dev/null 2>&1; then
    break
  fi
  if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "starting dgit bridge"; then
    break
  fi
  sleep 1
done

mkdir -p "$WORK_DIR/push" "$WORK_DIR/clone"
git -C "$WORK_DIR/push" init
git -C "$WORK_DIR/push" config user.email "smoke@example.com"
git -C "$WORK_DIR/push" config user.name "dgit smoke"
printf "hello from dockerized dgit: %s\n" "$REPO_LABEL" > "$WORK_DIR/push/hello.txt"
git -C "$WORK_DIR/push" add hello.txt
git -C "$WORK_DIR/push" commit -m "docker smoke test"
git -C "$WORK_DIR/push" remote add origin "http://127.0.0.1:$PORT/$REPO_LABEL@git.eth"

echo "[smoke] pushing $REPO_LABEL.git.eth"
git -C "$WORK_DIR/push" push origin HEAD:master

echo "[smoke] cloning $REPO_LABEL.git.eth"
git clone "http://127.0.0.1:$PORT/$REPO_LABEL@git.eth" "$WORK_DIR/clone/$REPO_LABEL"
git -C "$WORK_DIR/clone/$REPO_LABEL" log --oneline -1

echo "[smoke] ok: http://127.0.0.1:$PORT/$REPO_LABEL@git.eth"
