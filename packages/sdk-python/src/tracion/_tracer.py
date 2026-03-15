import os
import platform

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter

from tracion._exporter import OtlpJsonExporter


def create_tracer_provider(
    endpoint: str,
    api_key: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    batch_size: int = 512,
    export_interval_ms: int = 5000,
    _exporter: SpanExporter | None = None,
) -> TracerProvider:
    """TracerProvider を生成して設定する。

    agentId と sessionId は Resource 属性として設定する（スパン属性ではない）。
    バックエンドパーサーは resourceSpans[].resource.attributes から読み取る。
    """
    resource = Resource.create({
        "tracion.agent_id": agent_id or "unknown",
        "tracion.session_id": session_id or "default",
        "service.name": agent_id or "unknown",
        "process.pid": str(os.getpid()),
        "process.runtime.version": platform.python_version(),
    })

    provider = TracerProvider(resource=resource)

    exporter: SpanExporter
    if _exporter is not None:
        # テスト用: 同期エクスポーターで即時フラッシュ
        exporter = _exporter
        provider.add_span_processor(SimpleSpanProcessor(exporter))
    else:
        headers: dict[str, str] = {}
        if api_key:
            headers["X-Tracion-Api-Key"] = api_key
        exporter = OtlpJsonExporter(endpoint=endpoint, headers=headers)
        provider.add_span_processor(
            BatchSpanProcessor(
                exporter,
                max_export_batch_size=batch_size,
                schedule_delay_millis=export_interval_ms,
            )
        )

    return provider
