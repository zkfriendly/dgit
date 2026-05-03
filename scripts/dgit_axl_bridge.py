#!/usr/bin/env python3
"""HTTP git bridge for repo.git.eth names over ENS and AXL.

The bridge accepts git smart HTTP requests at paths like
`/repo@git.eth/info/refs?service=git-upload-pack`.

On push, it claims `repo.git.eth` through the deployed registrar when the name
is still unowned, setting text records that advertise this node's AXL public key.
On pull, it resolves those text records and either proxies to the local Haxy
server or forwards the git HTTP request to the resolved AXL peer.
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
SEPOLIA_CHAIN_ID = "11155111"
SEPOLIA_TX_URL = "https://sepolia.etherscan.io/tx/"
AXL_PUBLIC_KEY_TEXT = "dgit.axl.public_key"
AXL_ENDPOINT_TEXT = "dgit.axl.endpoint"
URL_TEXT = "url"
PROTOCOL_VERSION = 1


@dataclass
class BridgeConfig:
    listen_host: str
    listen_port: int
    public_endpoint: str
    haxy_url: str
    axl_url: str
    env_file: Path
    registrar: Optional[str]
    rpc_url: Optional[str]
    private_key: Optional[str]
    claim_on_push: bool
    request_timeout: float
    recv_poll_interval: float
    cast_bin: str


@dataclass
class GitRequest:
    method: str
    path: str
    query: str
    headers: Dict[str, str]
    body: bytes


@dataclass
class GitResponse:
    status: int
    reason: str
    headers: Dict[str, str]
    body: bytes


class EnsClient:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config

    def enabled(self) -> bool:
        return bool(self.config.rpc_url)

    def text(self, name: str, key: str) -> str:
        if not self.enabled():
            return ""

        node = self.namehash(name)
        resolver = self._cast_call(ENS_REGISTRY, "resolver(bytes32)(address)", [node]).strip()
        if _is_zero_address(resolver):
            return ""
        return _clean_cast_string(self._cast_call(resolver, "text(bytes32,string)(string)", [node, key]))

    def owner(self, name: str) -> str:
        if not self.enabled():
            return ZERO_ADDRESS
        node = self.namehash(name)
        return self._cast_call(ENS_REGISTRY, "owner(bytes32)(address)", [node]).strip()

    def namehash(self, name: str) -> str:
        return self._run_cast(["namehash", name]).strip()

    def ensure_claimed(self, label: str, public_key: str) -> None:
        if not self.config.claim_on_push:
            return
        if not self.enabled():
            print("[bridge] ENS RPC is not configured; skipping claim", file=sys.stderr)
            return
        if not self.config.private_key:
            raise RuntimeError("PRIVATE_KEY is required to claim ENS names")
        if not self.config.registrar:
            raise RuntimeError("DGIT_REGISTRAR_ADDRESS is required to claim ENS names")

        name = f"{label}.git.eth"
        owner = self.owner(name)
        if not _is_zero_address(owner):
            existing_key = self.text(name, AXL_PUBLIC_KEY_TEXT)
            if existing_key and existing_key.lower() != public_key.lower():
                raise RuntimeError(f"{name} is already claimed by another AXL public key")
            return

        records = [
            (AXL_PUBLIC_KEY_TEXT, public_key),
            (AXL_ENDPOINT_TEXT, self.config.axl_url),
            (URL_TEXT, f"http://{self.config.public_endpoint}/{label}@git.eth"),
        ]
        tuple_array = "[" + ",".join(f'("{k}","{v}")' for k, v in records) + "]"
        print(f"[bridge] claiming {name}: submitting transaction", file=sys.stderr, flush=True)
        tx_hash = self._send_claim_transaction(label, tuple_array)
        explorer_url = f"{SEPOLIA_TX_URL}{tx_hash}"
        print(f"[bridge] claim tx submitted: {tx_hash}", file=sys.stderr, flush=True)
        print(f"[bridge] claim tx explorer: {explorer_url}", file=sys.stderr, flush=True)
        print("[bridge] waiting for claim confirmation before serving push", file=sys.stderr, flush=True)
        self._wait_for_receipt(tx_hash)
        print(f"[bridge] claim confirmed: {explorer_url}", file=sys.stderr, flush=True)

    def _cast_call(self, target: str, signature: str, args: Iterable[str]) -> str:
        return self._run_cast(["call", target, signature, *args, "--rpc-url", self.config.rpc_url or ""])

    def _send_claim_transaction(self, label: str, tuple_array: str) -> str:
        output = self._run_cast(
            [
                "send",
                self.config.registrar or "",
                "claim(string,(string,string)[])",
                label,
                tuple_array,
                "--rpc-url",
                self.config.rpc_url or "",
                "--private-key",
                self.config.private_key or "",
                "--async",
            ]
        )
        return _extract_tx_hash(output)

    def _wait_for_receipt(self, tx_hash: str) -> None:
        deadline = time.monotonic() + self.config.request_timeout
        last_status = ""
        while time.monotonic() < deadline:
            proc = subprocess.run(
                [
                    self.config.cast_bin,
                    "receipt",
                    tx_hash,
                    "--rpc-url",
                    self.config.rpc_url or "",
                    "--json",
                ],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if proc.returncode == 0:
                receipt = json.loads(proc.stdout)
                status = str(receipt.get("status", ""))
                if status in {"0x1", "1"}:
                    return
                if status in {"0x0", "0"}:
                    raise RuntimeError(f"claim transaction reverted: {SEPOLIA_TX_URL}{tx_hash}")
            else:
                last_status = proc.stderr.strip() or proc.stdout.strip()
            time.sleep(2)
        raise TimeoutError(f"timed out waiting for claim transaction: {SEPOLIA_TX_URL}{tx_hash} ({last_status})")

    def _run_cast(self, args: Iterable[str]) -> str:
        proc = subprocess.run(
            [self.config.cast_bin, *args],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "cast failed")
        return proc.stdout


class AxlBridge:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.public_key = self._load_public_key()
        self.pending: Dict[str, "queue.Queue[GitResponse]"] = {}
        self.pending_lock = threading.Lock()
        self.stop_event = threading.Event()

    def start(self) -> None:
        threading.Thread(target=self._recv_loop, name="axl-recv", daemon=True).start()

    def request(self, peer_id: str, req: GitRequest) -> GitResponse:
        request_id = uuid.uuid4().hex
        response_queue: "queue.Queue[GitResponse]" = queue.Queue(maxsize=1)
        with self.pending_lock:
            self.pending[request_id] = response_queue
        try:
            self._send(
                peer_id,
                {
                    "dgit_axl": PROTOCOL_VERSION,
                    "kind": "request",
                    "id": request_id,
                    "method": req.method,
                    "path": req.path,
                    "query": req.query,
                    "headers": req.headers,
                    "body_b64": base64.b64encode(req.body).decode("ascii"),
                },
            )
            return response_queue.get(timeout=self.config.request_timeout)
        except queue.Empty as exc:
            raise TimeoutError(f"timed out waiting for AXL response from {peer_id}") from exc
        finally:
            with self.pending_lock:
                self.pending.pop(request_id, None)

    def _recv_loop(self) -> None:
        while not self.stop_event.is_set():
            request = Request(f"{self.config.axl_url}/recv", method="GET")
            try:
                with urlopen(request, timeout=max(1.0, self.config.recv_poll_interval + 1.0)) as response:
                    if response.status == 204:
                        time.sleep(self.config.recv_poll_interval)
                        continue
                    from_peer = response.headers.get("X-From-Peer-Id", "")
                    data = response.read()
            except HTTPError as exc:
                if exc.code != 204:
                    print(f"[bridge] AXL recv HTTP error: {exc}", file=sys.stderr)
                time.sleep(self.config.recv_poll_interval)
                continue
            except URLError as exc:
                print(f"[bridge] AXL recv error: {exc}", file=sys.stderr)
                time.sleep(self.config.recv_poll_interval)
                continue
            except TimeoutError:
                continue

            try:
                message = json.loads(data.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if message.get("dgit_axl") != PROTOCOL_VERSION:
                continue

            if message.get("kind") == "response":
                self._complete_pending(message)
            elif message.get("kind") == "request":
                self._handle_remote_request(from_peer, message)

    def _complete_pending(self, message: Dict[str, object]) -> None:
        request_id = str(message.get("id", ""))
        response = GitResponse(
            status=int(message.get("status", 502)),
            reason=str(message.get("reason", "Bad Gateway")),
            headers=_string_dict(message.get("headers", {})),
            body=base64.b64decode(str(message.get("body_b64", ""))),
        )
        with self.pending_lock:
            response_queue = self.pending.get(request_id)
        if response_queue is not None:
            response_queue.put(response)

    def _handle_remote_request(self, from_peer: str, message: Dict[str, object]) -> None:
        try:
            req = GitRequest(
                method=str(message["method"]),
                path=str(message["path"]),
                query=str(message.get("query", "")),
                headers=_string_dict(message.get("headers", {})),
                body=base64.b64decode(str(message.get("body_b64", ""))),
            )
            response = proxy_to_haxy(self.config, req)
            payload = {
                "dgit_axl": PROTOCOL_VERSION,
                "kind": "response",
                "id": str(message["id"]),
                "status": response.status,
                "reason": response.reason,
                "headers": response.headers,
                "body_b64": base64.b64encode(response.body).decode("ascii"),
            }
        except Exception as exc:  # noqa: BLE001 - response must cross process boundary
            payload = {
                "dgit_axl": PROTOCOL_VERSION,
                "kind": "response",
                "id": str(message.get("id", "")),
                "status": 502,
                "reason": "Bad Gateway",
                "headers": {"content-type": "text/plain"},
                "body_b64": base64.b64encode(str(exc).encode()).decode("ascii"),
            }
        self._send(from_peer, payload)

    def _send(self, peer_id: str, payload: Dict[str, object]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(f"{self.config.axl_url}/send", data=body, method="POST")
        request.add_header("X-Destination-Peer-Id", peer_id)
        request.add_header("Content-Type", "application/json")
        try:
            with urlopen(request, timeout=self.config.request_timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"AXL send failed with status {response.status}")
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"AXL send failed with status {exc.code}: {details}") from exc

    def _load_public_key(self) -> str:
        request = Request(f"{self.config.axl_url}/topology", method="GET")
        with urlopen(request, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
        public_key = str(data.get("our_public_key", ""))
        if len(public_key) != 64:
            raise RuntimeError("AXL topology did not include a 64-character public key")
        return public_key


class GitEnsHandler(BaseHTTPRequestHandler):
    server: "DgitHttpServer"

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[bridge] {self.address_string()} - {fmt % args}", file=sys.stderr)

    def _handle(self) -> None:
        try:
            label, git_path, query = parse_git_eth_target(self.path)
            body = self._read_body()
            request = GitRequest(
                method=self.command,
                path=f"/{quote(label)}/{git_path}",
                query=query,
                headers=self._forward_headers(),
                body=body,
            )
            response = self.server.bridge_app.handle_git_request(label, request)
            self._write_response(response)
        except ValueError as exc:
            self._write_response(GitResponse(400, "Bad Request", {"content-type": "text/plain"}, str(exc).encode()))
        except Exception as exc:  # noqa: BLE001 - HTTP boundary
            self._write_response(GitResponse(502, "Bad Gateway", {"content-type": "text/plain"}, str(exc).encode()))

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or "0")
        return self.rfile.read(length) if length else b""

    def _forward_headers(self) -> Dict[str, str]:
        keep = {
            "accept",
            "authorization",
            "content-type",
            "git-protocol",
            "user-agent",
        }
        return {key: value for key, value in self.headers.items() if key.lower() in keep}

    def _write_response(self, response: GitResponse) -> None:
        self.send_response(response.status, response.reason)
        for key, value in response.headers.items():
            if key.lower() in {"connection", "content-length", "transfer-encoding"}:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(response.body)))
        self.end_headers()
        self.wfile.write(response.body)


class DgitHttpServer(ThreadingHTTPServer):
    def __init__(self, address: Tuple[str, int], bridge_app: "BridgeApp") -> None:
        super().__init__(address, GitEnsHandler)
        self.bridge_app = bridge_app


class BridgeApp:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.ens = EnsClient(config)
        self.axl = AxlBridge(config)

    def start(self) -> None:
        self.axl.start()

    def handle_git_request(self, label: str, request: GitRequest) -> GitResponse:
        if is_receive_pack(request):
            self.ens.ensure_claimed(label, self.axl.public_key)

        peer_id = self.ens.text(f"{label}.git.eth", AXL_PUBLIC_KEY_TEXT)
        if not peer_id:
            if is_receive_pack(request) or not self.ens.enabled():
                peer_id = self.axl.public_key
            else:
                raise RuntimeError(f"{label}.git.eth does not publish {AXL_PUBLIC_KEY_TEXT}")

        if peer_id.lower() == self.axl.public_key.lower():
            return proxy_to_haxy(self.config, request)
        return self.axl.request(peer_id, request)


def proxy_to_haxy(config: BridgeConfig, request: GitRequest) -> GitResponse:
    parsed = urlparse(config.haxy_url)
    scheme = parsed.scheme or "http"
    if scheme != "http":
        raise RuntimeError("only http:// Haxy URLs are supported")
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 80
    prefix = parsed.path.rstrip("/")
    target = f"{prefix}{request.path}"
    if request.query:
        target = f"{target}?{request.query}"

    conn = http.client.HTTPConnection(host, port, timeout=config.request_timeout)
    conn.request(request.method, target, body=request.body, headers=request.headers)
    response = conn.getresponse()
    body = response.read()
    headers = {key: value for key, value in response.getheaders()}
    conn.close()
    return GitResponse(response.status, response.reason, headers, body)


def parse_git_eth_target(target: str) -> Tuple[str, str, str]:
    parsed = urlparse(target)
    parts = parsed.path.lstrip("/").split("/", 1)
    if not parts or not parts[0].endswith("@git.eth"):
        raise ValueError("expected path like /repo@git.eth/...")
    label = parts[0][: -len("@git.eth")]
    if not label or "." in label or "/" in label:
        raise ValueError("invalid repo label")
    git_path = parts[1] if len(parts) == 2 else ""
    if not git_path:
        raise ValueError("missing git service path")
    return label, git_path, parsed.query


def is_receive_pack(request: GitRequest) -> bool:
    if request.path.endswith("/git-receive-pack"):
        return True
    if request.path.endswith("/info/refs"):
        return parse_qs(request.query).get("service") == ["git-receive-pack"]
    return False


def load_env_file(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.split(" #", 1)[0].strip().strip('"').strip("'")
    return values


def find_registrar(repo_root: Path, env: Dict[str, str]) -> Optional[str]:
    if env.get("DGIT_REGISTRAR_ADDRESS"):
        return env["DGIT_REGISTRAR_ADDRESS"]
    latest = repo_root / "contracts" / "broadcast" / "DeployGitSubnameRegistrar.s.sol" / "11155111" / "run-latest.json"
    if not latest.exists():
        return None
    data = json.loads(latest.read_text())
    value = data.get("returns", {}).get("registrar", {}).get("value")
    return str(value) if value else None


def resolve_cast_bin(value: Optional[str]) -> str:
    if value:
        return value
    discovered = shutil.which("cast")
    if discovered:
        return discovered
    foundry_cast = Path.home() / ".foundry" / "bin" / "cast"
    if foundry_cast.exists():
        return str(foundry_cast)
    return "cast"


def parse_listen(value: str) -> Tuple[str, int]:
    host, sep, port_text = value.rpartition(":")
    if not sep or not host:
        raise ValueError("listen address must be host:port")
    return host, int(port_text)


def _clean_cast_string(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return value[1:-1]
    return value


def _is_zero_address(value: str) -> bool:
    return value.lower() == ZERO_ADDRESS.lower() or value == "0x"


def _string_dict(value: object) -> Dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item) for key, item in value.items()}


def _extract_tx_hash(output: str) -> str:
    stripped = output.strip()
    if not stripped:
        raise RuntimeError("cast did not return a transaction hash")
    try:
        parsed = json.loads(stripped)
        for key in ("transactionHash", "hash"):
            value = parsed.get(key)
            if isinstance(value, str) and value.startswith("0x"):
                return value
    except json.JSONDecodeError:
        pass
    for token in stripped.replace("\n", " ").split():
        if token.startswith("0x") and len(token) == 66:
            return token
    raise RuntimeError(f"could not parse transaction hash from cast output: {stripped}")


def build_config() -> BridgeConfig:
    parser = argparse.ArgumentParser(description="Bridge git smart HTTP over ENS + AXL")
    parser.add_argument("--listen", default="127.0.0.1:8090", help="bridge listen address")
    parser.add_argument("--haxy", default=None, help="local Haxy URL, e.g. http://127.0.0.1:8080")
    parser.add_argument("--axl", default=None, help="local AXL API URL, e.g. http://127.0.0.1:9002")
    parser.add_argument("--env", default=".env", help="env file with PRIVATE_KEY and SEPOLIA_RPC_URL")
    parser.add_argument("--public-endpoint", default=None, help="endpoint written to ENS url text record")
    parser.add_argument("--no-claim", action="store_true", help="skip ENS claims on push")
    parser.add_argument("--timeout", type=float, default=30.0, help="request timeout in seconds")
    parser.add_argument("--cast-bin", default=None, help="cast binary path")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    env_file = (repo_root / args.env).resolve() if not Path(args.env).is_absolute() else Path(args.env)
    file_env = load_env_file(env_file)
    env = {**file_env, **os.environ}
    listen_host, listen_port = parse_listen(args.listen)

    haxy_endpoint = args.haxy or env.get("HAXY_ENDPOINT", "127.0.0.1:8080")
    if not haxy_endpoint.startswith("http://"):
        haxy_endpoint = f"http://{haxy_endpoint}"
    axl_endpoint = args.axl or env.get("AXL_ENDPOINT", "127.0.0.1:9002")
    if not axl_endpoint.startswith("http://"):
        axl_endpoint = f"http://{axl_endpoint}"

    return BridgeConfig(
        listen_host=listen_host,
        listen_port=listen_port,
        public_endpoint=args.public_endpoint or env.get("DGIT_PUBLIC_ENDPOINT", args.listen),
        haxy_url=haxy_endpoint.rstrip("/"),
        axl_url=axl_endpoint.rstrip("/"),
        env_file=env_file,
        registrar=find_registrar(repo_root, env),
        rpc_url=env.get("SEPOLIA_RPC_URL") or None,
        private_key=env.get("PRIVATE_KEY") or None,
        claim_on_push=not args.no_claim,
        request_timeout=args.timeout,
        recv_poll_interval=0.2,
        cast_bin=resolve_cast_bin(args.cast_bin or env.get("CAST_BIN")),
    )


def main() -> int:
    config = build_config()
    app = BridgeApp(config)
    app.start()
    server = DgitHttpServer((config.listen_host, config.listen_port), app)
    print(
        f"[bridge] listening on http://{config.listen_host}:{config.listen_port}; "
        f"haxy={config.haxy_url}; axl={config.axl_url}; axl_public_key={app.axl.public_key}",
        file=sys.stderr,
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
