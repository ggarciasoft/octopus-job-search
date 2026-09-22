"""Record what a real browser sees on the synthetic Greenhouse page.

    cd services/worker && uv run python ../../fixtures/fill-planner/generate-page.py

The parity vectors beside this script pin the two *planners* to each other.
They cannot pin the two *readers*: the Python runner reads the DOM through
Chromium and the extension reads it through its own content script, and a
disagreement between those two produces two different fingerprints for one
page — which silently invalidates every approval made through the other
client.

So this records the ground truth from Chromium, and both sides assert against
it: `services/worker/tests/test_planner_parity.py` re-reads the page in
Chromium and compares, and `apps/extension/tests/parity.test.ts` reads the same
file in jsdom and compares. The recorded fingerprint is the contract between
two DOM engines.

Requires Playwright's Chromium, which is the same requirement the rest of the
browser suite has.
"""

from __future__ import annotations

import asyncio
import contextlib
import http.server
import json
import pathlib
import sys
import tempfile
import threading
from collections.abc import Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "services/worker/src"))

from job_getter_worker.runner.adapters import GreenhouseAdapter  # noqa: E402
from job_getter_worker.runner.browser import BrowserOptions, RunnerBrowser  # noqa: E402

PAGES = pathlib.Path(__file__).resolve().parents[1] / "ats-pages"
OUT = pathlib.Path(__file__).resolve().parent / "greenhouse-page.json"
NAMES = ("greenhouse-application.html", "greenhouse-application-changed.html")


async def read(name: str, server: str) -> dict[str, object]:
    adapter = GreenhouseAdapter()
    url = f"{server}/{name}"
    with tempfile.TemporaryDirectory() as profile:
        runner = RunnerBrowser(
            BrowserOptions(profile_dir=pathlib.Path(profile) / "profile", headless=True)
        )
        await runner.start()
        try:
            page = await runner.open(url, (server,))
            rows = await page.evaluate(adapter.inspect_script)
            identity = await page.evaluate(adapter.identity_script)
        finally:
            await runner.aclose()
    schema = adapter.parse_inspection(rows)
    return {
        "page": name,
        "rows": rows,
        "identity": identity,
        "fingerprint": schema.fingerprint,
        "keys": [field.key for field in schema.fields],
    }


@contextlib.contextmanager
def serve() -> "Iterator[str]":
    """The pages are served over http, not file://, as the runner sees them."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=str(PAGES), **kwargs)  # type: ignore[arg-type]

        def log_message(self, *args: object) -> None:
            return

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


async def main() -> int:
    with serve() as server:
        recorded = [await read(name, server) for name in NAMES]
    OUT.write_text(json.dumps(recorded, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for entry in recorded:
        print(f"{entry['page']}: {entry['fingerprint']} ({len(entry['keys'])} fields)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
