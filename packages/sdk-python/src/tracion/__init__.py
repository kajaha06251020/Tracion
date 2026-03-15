"""tracion — AI エージェント用 OpenTelemetry トレーシング SDK"""

from contextlib import contextmanager
from typing import Generator

from tracion._sdk import TracionSDK
from tracion._span import NoopTracionSpan, TracionSpan
from tracion._types import SpanKind, TraceStatus

__all__ = [
    "TracionSDK",
    "TracionSpan",
    "SpanKind",
    "TraceStatus",
    "configure",
    "tracion",
]

__version__ = "0.1.0"


class _GlobalTracion:
    """グローバルシングルトン。init() 前でも NoopSpan を返して安全に動作する。"""

    def __init__(self) -> None:
        self._sdk: TracionSDK | None = None

    def init(
        self,
        endpoint: str,
        api_key: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        enabled: bool = True,
    ) -> None:
        self._sdk = TracionSDK(
            endpoint=endpoint,
            api_key=api_key,
            agent_id=agent_id,
            session_id=session_id,
            enabled=enabled,
        )

    @contextmanager
    def trace(
        self, name: str, kind: SpanKind | None = None
    ) -> Generator[TracionSpan, None, None]:
        if self._sdk is None:
            yield NoopTracionSpan()
            return
        with self._sdk.trace(name, kind=kind) as span:
            yield span

    def start_span(self, name: str, kind: SpanKind | None = None) -> TracionSpan:
        if self._sdk is None:
            return NoopTracionSpan()
        return self._sdk.start_span(name, kind=kind)


tracion = _GlobalTracion()


def configure(
    endpoint: str,
    api_key: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    enabled: bool = True,
) -> None:
    """グローバルシングルトンを初期化する便利関数。tracion.init() の別名。"""
    tracion.init(
        endpoint=endpoint,
        api_key=api_key,
        agent_id=agent_id,
        session_id=session_id,
        enabled=enabled,
    )
