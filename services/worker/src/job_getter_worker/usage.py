"""Reserving daily budget before a model request, and settling it afterwards.

``docs/spec/06_AI_PROFILE_AND_CV.md``:

    Reserve estimated token/cost budget before requests; settle actual usage if
    reported.

There are two budgets, and both must agree before a request is sent.

* The **workspace's** daily budget, which is the authoritative one. It lives in
  ``usage_ledger`` on the API side and is reserved against over HTTP, because a
  worker process is born for one task and dies with it: a counter held here
  starts at zero every time and so could only ever refuse a single request
  larger than the whole day's allowance.
* The **worker's own** caps, from its environment. These are an operator bound
  on one process, and they stay in force as the stricter of the two.

The local reservation is taken first because it costs nothing; the remote one
follows. Either refusal raises
:class:`~job_getter_worker.errors.BudgetExhaustedError` before the provider is
touched, which is the whole point: a budget checked after the request is not a
budget, because the money is already spent.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from .handlers import TaskContext
from .logging import get_logger
from .providers import BudgetLedger, Reservation, SettledUsage, build_budget, estimate_tokens
from .providers.base import TokenUsage

_log = get_logger(__name__)


class BudgetHold:
    """One in-flight reservation, on both ledgers.

    A hold is always resolved: settled with what the provider reported, or
    released because the request was never sent. Leaving it neither would leave
    the day's budget quietly occupied by a request that never happened.
    """

    def __init__(
        self,
        ctx: TaskContext,
        local: BudgetLedger,
        local_reservation: Reservation,
        reservation_id: str,
    ) -> None:
        self._ctx = ctx
        self._local = local
        self._local_reservation = local_reservation
        self.reservation_id = reservation_id
        self.resolved = False

    async def settle(self, usage: TokenUsage) -> SettledUsage:
        """Record what the request actually used.

        ``usage`` with nothing reported is not an error and not a zero: the
        estimate stands as the charge on both ledgers, and the *price* stays
        unknown rather than being invented.
        """
        # Keeps this process's own caps honest for the rest of its life.
        self._local.settle(self._local_reservation, usage)
        remote = await self._ctx.api.settle_usage(
            self._ctx.task_id,
            self._ctx.lease_token,
            self.reservation_id,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
        )
        self.resolved = True
        # The API owns the price, because it owns the rate card. The local
        # ledger's view of cost is only ever a second opinion.
        return SettledUsage(
            input_tokens=remote.input_tokens,
            output_tokens=remote.output_tokens,
            measured_cost=remote.measured_cost,
            currency=remote.currency,
            cost_is_unknown=remote.cost_is_unknown,
        )

    async def release(self) -> None:
        """Give the budget back for a request that was never sent."""
        if self.resolved:
            return
        self._local.release(self._local_reservation)
        self.resolved = True
        try:
            await self._ctx.api.release_usage(
                self._ctx.task_id, self._ctx.lease_token, self.reservation_id
            )
        except Exception as error:
            # A release that cannot be delivered leaves the reservation standing
            # against the day's budget. That is the safe direction to fail —
            # it over-counts rather than handing out budget twice — and the
            # original failure must not be replaced by this one.
            _log.warning("usage.release_failed", reason=type(error).__name__)


@asynccontextmanager
async def reserved_budget(
    ctx: TaskContext, *, prompt_text: str, output_token_limit: int
) -> AsyncIterator[BudgetHold]:
    """Hold budget for one model request for the duration of the block.

    Raises:
        BudgetExhaustedError: before the provider is contacted, when either
            ledger refuses.
    """
    estimated_input = estimate_tokens(prompt_text)
    local = build_budget(ctx.settings)
    local_reservation = local.reserve(estimated_input, output_token_limit)

    try:
        remote = await ctx.api.reserve_usage(
            ctx.task_id,
            ctx.lease_token,
            estimated_input_tokens=estimated_input,
            estimated_output_tokens=output_token_limit,
        )
    except BaseException:
        local.release(local_reservation)
        raise

    hold = BudgetHold(ctx, local, local_reservation, remote.reservation_id)
    try:
        yield hold
    except BaseException:
        await hold.release()
        raise
    # A block that left without settling did not send the request it reserved
    # for; the reservation goes back rather than sitting on the day's budget.
    await hold.release()
