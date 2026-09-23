"""Record what the runner's confirmation reader sees, in a real browser.

    cd services/worker && uv run python ../../fixtures/fill-planner/generate-confirmation.py

Both clients can now turn an employer's page into `submitted` evidence: the
runner by watching it, the extension by looking once on the person's click.
If their two readers disagreed about the same page, one client would record a
submission from a page the other says confirms nothing, or store different
words as the evidence. So, as `generate-page.py` does for the form reader, this
records Chromium's answer from the runner's own `confirmation_script`, and both
sides assert against it: `services/worker/tests/test_planner_parity.py`
re-reads in Chromium, and `apps/extension/tests/parity.test.ts` reads the same
pages in jsdom through `readConfirmation`.

The URL is recorded as a path, because the pages are served from a loopback
port that differs on every run.
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
OUT = pathlib.Path(__file__).resolve().parent / "greenhouse-confirmation.json"
#: One confirmation, with a decoy "thank you" in its footer, and two form pages
#: that must read as no confirmation at all.
NAMES = (
    "greenhouse-confirmation.html",
    "greenhouse-application.html",
    "greenhouse-application-changed.html",
)


def as_path(raw: object, server: str) -> object:
    if isinstance(raw, dict) and isinstance(raw.get("url"), str):
        return {**raw, "url": raw["url"].removeprefix(server)}
    return raw


async def read(name: str, server: str) -> dict[str, object]:
    adapter = GreenhouseAdapter()
    with tempfile.TemporaryDirectory() as profile:
        runner = RunnerBrowser(
            BrowserOptions(profile_dir=pathlib.Path(profile) / "profile", headless=True)
        )
        await runner.start()
        try:
            page = await runner.open(f"{server}/{name}", (server,))
            raw = await page.evaluate(adapter.confirmation_script)
        finally:
            await runner.aclose()
    return {"page": name, "confirmation": as_path(raw, server)}


@contextlib.contextmanager
def serve() -> Iterator[str]:
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
        found = entry["confirmation"]
        print(f"{entry['page']}: {'confirmation' if found else 'nothing'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
