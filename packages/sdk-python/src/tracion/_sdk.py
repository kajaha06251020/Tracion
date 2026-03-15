from contextlib import contextmanager
from typing import Generator

from opentelemetry import context as context_api, trace as trace_api
from opentelemetry.sdk.trace.export import SpanExporter

from tracion._span import OtelTracionSpan, NoopTracionSpan, TracionSpan
from tracion._tracer import create_tracer_provider
from tracion._types import SpanKind


class TracionSDK:
    def __init__(
        self,
        endpoint: str,
        api_key: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        enabled: bool = True,
        batch_size: int = 512,
        export_interval_ms: int = 5000,
        _exporter: SpanExporter | None = None,
    ) -> None:
        self._enabled = enabled
        self._tracer = None

        if self._enabled:
            provider = create_tracer_provider(
                endpoint=endpoint,
                api_key=api_key,
                agent_id=agent_id,
                session_id=session_id,
                batch_size=batch_size,
                export_interval_ms=export_interval_ms,
                _exporter=_exporter,
            )
            # provider.register() は呼ばない — SDK は provider.get_tracer() を直接使用する
            # グローバル登録するとテスト間で OTel グローバル状態が汚染される
            self._tracer = provider.get_tracer("tracion", "0.1.0")

    @contextmanager
    def trace(
        self,
        name: str,
        kind: SpanKind | None = None,
    ) -> Generator[TracionSpan, None, None]:
        if not self._enabled or self._tracer is None:
            yield NoopTracionSpan()
            return

        otel_span = self._tracer.start_span(name)
        if kind:
            otel_span.set_attribute("tracion.kind", kind)

        ctx = trace_api.set_span_in_context(otel_span)
        token = context_api.attach(ctx)
        tf_span = OtelTracionSpan(otel_span)

        try:
            yield tf_span
            tf_span.end(status="success")
        except Exception as e:
            tf_span.end(status="error", error=e)
            raise
        finally:
            context_api.detach(token)

    def start_span(self, name: str, kind: SpanKind | None = None) -> TracionSpan:
        if not self._enabled or self._tracer is None:
            return NoopTracionSpan()

        otel_span = self._tracer.start_span(name)
        if kind:
            otel_span.set_attribute("tracion.kind", kind)
        return OtelTracionSpan(otel_span)
