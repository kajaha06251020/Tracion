"""traceforge — AI エージェント用 OpenTelemetry トレーシング SDK"""

from contextlib import contextmanager
from typing import Generator

from traceforge._sdk import TraceforgeSDK
from traceforge._span import NoopTraceforgeSpan, TraceforgeSpan
from traceforge._types import SpanKind, TraceStatus

__all__ = [
    "TraceforgeSDK",
    "TraceforgeSpan",
    "SpanKind",
    "TraceStatus",
    "configure",
    "traceforge",
]

__version__ = "0.1.0"


class _GlobalTraceforge:
    """グローバルシングルトン。init() 前でも NoopSpan を返して安全に動作する。"""

    def __init__(self) -> None:
        self._sdk: TraceforgeSDK | None = None

    def init(
        self,
        endpoint: str,
        api_key: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        enabled: bool = True,
    ) -> None:
        self._sdk = TraceforgeSDK(
            endpoint=endpoint,
            api_key=api_key,
            agent_id=agent_id,
            session_id=session_id,
            enabled=enabled,
        )

    @contextmanager
    def trace(
        self, name: str, kind: SpanKind | None = None
    ) -> Generator[TraceforgeSpan, None, None]:
        if self._sdk is None:
            yield NoopTraceforgeSpan()
            return
        with self._sdk.trace(name, kind=kind) as span:
            yield span

    def start_span(self, name: str, kind: SpanKind | None = None) -> TraceforgeSpan:
        if self._sdk is None:
            return NoopTraceforgeSpan()
        return self._sdk.start_span(name, kind=kind)


traceforge = _GlobalTraceforge()


def configure(
    endpoint: str,
    api_key: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    enabled: bool = True,
) -> None:
    """グローバルシングルトンを初期化する便利関数。traceforge.init() の別名。"""
    traceforge.init(
        endpoint=endpoint,
        api_key=api_key,
        agent_id=agent_id,
        session_id=session_id,
        enabled=enabled,
    )
