"""Worker configuration.

Every shared limit and capability name comes from
``job_getter_worker.contracts.generated``. Nothing here restates a contract
value; it only reads environment variables and checks them against the
generated constants.
"""

from __future__ import annotations

from typing import Annotated, Final

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .contracts.generated import (
    MAX_UPLOAD_BYTES,
    RUNNER_ONLY_CAPABILITIES,
    ProviderId,
    ProviderLimits,
    TaskType,
)

#: ``docs/spec/09_SECURITY_PRIVACY.md`` -> "File processing and storage".
#: These are defaults, not suggestions: the values are the spec's bounds.
DEFAULT_MAX_PDF_PAGES: Final = 100
DEFAULT_MAX_EXTRACTED_CHARS: Final = 200_000
DEFAULT_MAX_DOCX_UNCOMPRESSED_BYTES: Final = 50 * 1024 * 1024


class CapabilityConfigurationError(ValueError):
    """Raised when the declared capabilities cannot be honoured by this process."""


class WorkerSettings(BaseSettings):
    """Environment contract for the container worker.

    Variable names follow ``docs/spec/10_DEPLOYMENT.md`` -> "Environment
    contract" and the worker block of ``.env.example``.
    """

    model_config = SettingsConfigDict(
        env_prefix="WORKER_",
        extra="ignore",
        case_sensitive=False,
        secrets_dir=None,
    )

    # --- internal task protocol -------------------------------------------------
    api_base_url: Annotated[str, Field(min_length=1)]
    auth_token: SecretStr
    worker_id: Annotated[str, Field(min_length=1, max_length=128, validation_alias="WORKER_ID")]
    capabilities: Annotated[str, Field(min_length=1)] = "noop_echo,parse_profile"

    poll_interval_seconds: Annotated[float, Field(gt=0, le=300)] = 2.0
    idle_poll_max_seconds: Annotated[float, Field(gt=0, le=900)] = 15.0
    request_timeout_seconds: Annotated[float, Field(gt=0, le=600)] = 30.0

    # --- parse limits -----------------------------------------------------------
    max_download_bytes: Annotated[int, Field(gt=0)] = MAX_UPLOAD_BYTES
    max_pdf_pages: Annotated[int, Field(gt=0)] = DEFAULT_MAX_PDF_PAGES
    max_extracted_chars: Annotated[int, Field(gt=0)] = DEFAULT_MAX_EXTRACTED_CHARS
    max_docx_uncompressed_bytes: Annotated[int, Field(gt=0)] = DEFAULT_MAX_DOCX_UNCOMPRESSED_BYTES
    extraction_timeout_seconds: Annotated[float, Field(gt=0, le=600)] = 30.0

    # --- observability ----------------------------------------------------------
    log_level: Annotated[str, Field(validation_alias="LOG_LEVEL")] = "info"

    # --- model provider ---------------------------------------------------------
    # docs/spec/06 keeps per-workspace provider secrets in encrypted settings.
    # ParseProfileInput carries no provider block yet, so the worker falls back
    # to its own environment. See services/worker/README.md -> "Known gaps".
    provider: Annotated[ProviderId, Field(validation_alias="PROVIDER_DEFAULT")] = ProviderId.NONE
    provider_model: Annotated[str, Field(max_length=128, validation_alias="WORKER_MODEL")] = ""
    provider_base_url: Annotated[
        str | None, Field(max_length=500, validation_alias="LOCAL_MODEL_BASE_URL")
    ] = None
    provider_api_key: SecretStr | None = None

    provider_context_limit: Annotated[int, Field(ge=512, le=2_000_000)] = 8192
    provider_output_token_limit: Annotated[int, Field(ge=64, le=200_000)] = 4096
    provider_temperature: Annotated[float, Field(ge=0, le=2)] = 0.0
    provider_timeout_seconds: Annotated[int, Field(ge=5, le=600)] = 120
    provider_daily_token_budget: Annotated[int, Field(ge=0)] | None = None
    provider_daily_cost_budget: Annotated[float, Field(ge=0)] | None = None
    provider_requests_per_day: Annotated[int, Field(ge=0)] | None = None

    # A cost cap is only enforceable with a configured rate card
    # (docs/spec/06 -> "Provider abstraction"). Unknown price stays unknown.
    provider_rate_currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    provider_input_cost_per_million: Annotated[float, Field(ge=0)] | None = None
    provider_output_cost_per_million: Annotated[float, Field(ge=0)] | None = None

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, value: str) -> str:
        allowed = {"debug", "info", "warning", "error", "critical"}
        lowered = value.strip().lower()
        if lowered not in allowed:
            raise ValueError(f"LOG_LEVEL must be one of {sorted(allowed)}, got {value!r}")
        return lowered

    @field_validator("api_base_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @model_validator(mode="after")
    def _check_capabilities(self) -> WorkerSettings:
        # Parsing happens here rather than in a field validator so the error
        # message can name the variable the operator actually has to fix.
        _ = self.declared_capabilities  # the property raises on bad input
        return self

    @property
    def declared_capabilities(self) -> tuple[TaskType, ...]:
        """Capabilities this process will claim, validated against the contract.

        A container worker that declares a runner-only capability refuses to
        start: ``docs/spec/02_ARCHITECTURE.md`` is explicit that a headless
        container cannot drive the user's desktop browser, and ADR05 exists
        precisely so it never pretends to.
        """
        raw = [item.strip() for item in self.capabilities.split(",")]
        names = [item for item in raw if item]
        if not names:
            raise CapabilityConfigurationError(
                "WORKER_CAPABILITIES is empty. Set at least one task type, "
                "for example WORKER_CAPABILITIES=noop_echo,parse_profile"
            )

        known = {member.value for member in TaskType}
        unknown = [name for name in names if name not in known]
        if unknown:
            raise CapabilityConfigurationError(
                f"WORKER_CAPABILITIES contains unknown task type(s) {unknown}. "
                f"Valid task types are {sorted(known)}"
            )

        runner_only = [name for name in names if name in RUNNER_ONLY_CAPABILITIES]
        if runner_only:
            raise CapabilityConfigurationError(
                f"WORKER_CAPABILITIES declares {runner_only}, which only the paired "
                "desktop runner may claim. A headless container has no access to "
                "the user's desktop browser session, so it must not accept this "
                "work (docs/spec/02_ARCHITECTURE.md, ADR05). Remove "
                f"{runner_only} from WORKER_CAPABILITIES, and run "
                "`job-getter-runner pair` on the desktop instead."
            )

        deduplicated: list[TaskType] = []
        for name in names:
            task_type = TaskType(name)
            if task_type not in deduplicated:
                deduplicated.append(task_type)
        return tuple(deduplicated)

    @property
    def provider_limits(self) -> ProviderLimits:
        """Provider limits expressed with the generated contract model."""
        return ProviderLimits(
            context_limit=self.provider_context_limit,
            output_token_limit=self.provider_output_token_limit,
            temperature=self.provider_temperature,
            timeout_seconds=self.provider_timeout_seconds,
            daily_token_budget=self.provider_daily_token_budget,
            daily_cost_budget=self.provider_daily_cost_budget,
        )


def load_settings() -> WorkerSettings:
    """Load settings, turning a configuration mistake into a readable failure."""
    return WorkerSettings()  # type: ignore[call-arg]  # values come from the environment
