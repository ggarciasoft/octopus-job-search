"""Token and cost budgets.

``docs/spec/06_AI_PROFILE_AND_CV.md``:

    Reserve estimated token/cost budget before requests; settle actual usage if
    reported. Track unknown price as unknown, never zero. A cost cap requires a
    configured rate card; otherwise enforce token/request caps.

Two rules do the real work here. A reservation is taken *before* the request,
so a run cannot discover it is over budget only after spending the money; and
an unreported price stays ``None`` all the way through, so nobody later adds it
up as zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..contracts.generated import RateCard
from ..errors import TaskFailureError
from .base import TokenUsage


class BudgetExhaustedError(TaskFailureError):
    """A new request would exceed the configured budget."""

    def __init__(self, message: str) -> None:
        super().__init__("BUDGET_EXHAUSTED", message, retryable=False)


@dataclass(frozen=True)
class Reservation:
    """Tokens (and possibly cost) held for one in-flight request."""

    tokens: int
    cost: float | None


@dataclass(frozen=True)
class SettledUsage:
    """What a request finally cost.

    ``measured_cost is None`` means the price is genuinely unknown - either the
    provider reported no usage, or no rate card is configured. It does not mean
    the request was free.
    """

    input_tokens: int | None
    output_tokens: int | None
    measured_cost: float | None
    currency: str | None
    cost_is_unknown: bool


@dataclass
class BudgetLedger:
    """An in-process daily budget.

    The authoritative ledger lives in the database on the Node side; this one
    exists so a single worker process stops itself before making a request it
    cannot afford.
    """

    daily_token_budget: int | None = None
    daily_cost_budget: float | None = None
    requests_per_day: int | None = None
    rate_card: RateCard | None = None

    tokens_used: int = 0
    tokens_reserved: int = 0
    requests_made: int = 0
    cost_used: float = 0.0
    unknown_cost_requests: int = 0
    notes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.daily_cost_budget is not None and self.rate_card is None:
            # Enforcing a currency cap without a price list would mean inventing
            # the price. Say so plainly and fall back to the token/request caps.
            self.notes.append(
                "A daily cost budget is configured but no rate card is, so the cost cap "
                "cannot be enforced. Token and request caps still apply."
            )

    @property
    def cost_cap_enforceable(self) -> bool:
        return self.daily_cost_budget is not None and self.rate_card is not None

    def _price(self, input_tokens: int, output_tokens: int) -> float | None:
        if self.rate_card is None:
            return None
        return (
            input_tokens * self.rate_card.input_cost_per_million
            + output_tokens * self.rate_card.output_cost_per_million
        ) / 1_000_000

    def reserve(self, estimated_input_tokens: int, estimated_output_tokens: int) -> Reservation:
        """Hold budget for one request, or refuse it.

        Raises:
            BudgetExhaustedError: when the request would cross a configured cap.
        """
        if self.requests_per_day is not None and self.requests_made >= self.requests_per_day:
            raise BudgetExhaustedError(
                f"The daily limit of {self.requests_per_day} model requests has been "
                "reached. Reviewing, editing and exporting still work; new inference "
                "resumes when the limit resets."
            )

        estimated = estimated_input_tokens + estimated_output_tokens
        if self.daily_token_budget is not None:
            projected = self.tokens_used + self.tokens_reserved + estimated
            if projected > self.daily_token_budget:
                raise BudgetExhaustedError(
                    f"This request needs about {estimated} tokens, which would take the "
                    f"day's usage to {projected}, above the {self.daily_token_budget} "
                    "token budget. No request was sent."
                )

        cost = self._price(estimated_input_tokens, estimated_output_tokens)
        if self.cost_cap_enforceable and cost is not None:
            assert self.daily_cost_budget is not None
            if self.cost_used + cost > self.daily_cost_budget:
                raise BudgetExhaustedError(
                    f"This request is estimated at {cost:.4f} "
                    f"{self.rate_card.currency if self.rate_card else ''}, which would "
                    f"exceed the daily cost budget of {self.daily_cost_budget}. "
                    "No request was sent."
                )

        self.tokens_reserved += estimated
        self.requests_made += 1
        return Reservation(tokens=estimated, cost=cost)

    def settle(self, reservation: Reservation, usage: TokenUsage) -> SettledUsage:
        """Replace a reservation with the real usage, if it was reported."""
        self.tokens_reserved = max(0, self.tokens_reserved - reservation.tokens)

        reported = usage.total
        if reported is None:
            # The provider told us nothing, so the estimate is the best figure
            # available; the *price* stays unknown rather than being invented.
            self.tokens_used += reservation.tokens
            self.unknown_cost_requests += 1
            return SettledUsage(
                input_tokens=None,
                output_tokens=None,
                measured_cost=None,
                currency=self.rate_card.currency if self.rate_card else None,
                cost_is_unknown=True,
            )

        self.tokens_used += reported
        cost = self._price(usage.input_tokens or 0, usage.output_tokens or 0)
        if cost is None:
            self.unknown_cost_requests += 1
        else:
            self.cost_used += cost
        return SettledUsage(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            measured_cost=cost,
            currency=self.rate_card.currency if self.rate_card else None,
            cost_is_unknown=cost is None,
        )

    def release(self, reservation: Reservation) -> None:
        """Give back a reservation for a request that was never sent."""
        self.tokens_reserved = max(0, self.tokens_reserved - reservation.tokens)
        self.requests_made = max(0, self.requests_made - 1)
