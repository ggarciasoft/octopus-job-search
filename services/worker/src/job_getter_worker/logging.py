"""Structured JSON logging with mandatory redaction.

``docs/spec/09_SECURITY_PRIVACY.md`` -> "Retention defaults" ends with a flat
prohibition: *"Do not log CV text, answers, tokens or raw prompts."*

This module therefore makes the safe thing the easy thing. Call sites are
expected to use :func:`log_shape`, which accepts *counts and shapes only*, and
the processor chain scrubs any key that is known to carry content or a secret
even if someone adds a raw value by accident. Redaction here is a backstop, not
a licence to pass content: the test suite asserts that CV text never reaches the
log stream.
"""

from __future__ import annotations

import logging
import sys
from typing import Any, Final

import structlog
from structlog.typing import EventDict, WrappedLogger

#: Keys whose values are user content, model input/output or credentials.
#: Anything landing under one of these names is replaced before rendering.
REDACTED_KEYS: Final[frozenset[str]] = frozenset(
    {
        "answer",
        "answers",
        "api_key",
        "auth_token",
        "authorization",
        "bullet",
        "bullets",
        "completion",
        "cv_text",
        "document_text",
        "draft_fact",
        "draft_facts",
        "excerpt",
        "extracted_text",
        "fact_value",
        "inline_text",
        "input_text",
        "lease_token",
        "message_body",
        "password",
        "prompt",
        "prompts",
        "provider_key",
        "raw",
        "raw_output",
        "response_text",
        "result",
        "secret",
        "source_excerpt",
        "text",
        "token",
        "value",
    }
)

REDACTED_PLACEHOLDER: Final = "[redacted]"

_configured = False


def _redact_sensitive(
    _logger: WrappedLogger, _method_name: str, event_dict: EventDict
) -> EventDict:
    """Replace any known-sensitive value with a placeholder.

    The replacement keeps the key, so an operator can still see *that* a field
    was present while never seeing what it contained.
    """
    for key in list(event_dict):
        if key.lower() in REDACTED_KEYS:
            event_dict[key] = REDACTED_PLACEHOLDER
    return event_dict


def configure_logging(level: str = "info", *, stream: Any | None = None) -> None:
    """Configure structlog for JSON output on stdout.

    Safe to call more than once; later calls reconfigure rather than stack
    processors.
    """
    global _configured

    logging.basicConfig(
        format="%(message)s",
        stream=stream if stream is not None else sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact_sensitive,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(sort_keys=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        logger_factory=structlog.WriteLoggerFactory(
            file=stream if stream is not None else sys.stdout
        ),
        cache_logger_on_first_use=False,
    )
    _configured = True


def get_logger(name: str = "job_getter_worker") -> structlog.stdlib.BoundLogger:
    """Return a bound logger, configuring logging on first use."""
    if not _configured:
        configure_logging()
    logger: structlog.stdlib.BoundLogger = structlog.get_logger(name)
    return logger


def bind_worker(worker_id: str) -> None:
    """Bind the worker identity for the lifetime of the process."""
    structlog.contextvars.bind_contextvars(worker_id=worker_id)


def bind_task(task_id: str, task_type: str, request_id: str | None = None) -> None:
    """Bind the current task to the logging context.

    ``lease_token`` is deliberately absent: it is a bearer credential for the
    task and must never be written to a log line.
    """
    structlog.contextvars.bind_contextvars(task_id=task_id, task_type=task_type)
    if request_id is not None:
        structlog.contextvars.bind_contextvars(request_id=request_id)


def clear_task() -> None:
    """Drop the per-task logging context."""
    structlog.contextvars.unbind_contextvars("task_id", "task_type", "request_id")


def log_shape(event: str, **measurements: int | float | bool | str | None) -> None:
    """Log the *shape* of data rather than the data.

    Only counts, sizes, codes and flags belong here. The helper exists so the
    natural way to describe work done - ``log_shape("extracted", chars=4821,
    draft_facts=23)`` - carries no content at all.

    Raises:
        ValueError: if a measurement looks like free text rather than a
            measurement, which is almost always an accidental content leak.
    """
    safe: dict[str, int | float | bool | str | None] = {}
    for key, value in measurements.items():
        if key.lower() in REDACTED_KEYS:
            raise ValueError(
                f"log_shape() refuses {key!r}: that name carries content or a secret. "
                "Log a count or a code instead."
            )
        if isinstance(value, str) and (len(value) > 120 or "\n" in value):
            raise ValueError(
                f"log_shape() refuses the value passed for {key!r}: it looks like "
                "document text, not a measurement. Log its length instead."
            )
        safe[key] = value
    get_logger().info(event, **safe)
