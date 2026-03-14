import json
from unittest.mock import patch, MagicMock
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from traceforge._exporter import OtlpJsonExporter


def _make_spans():
    """InMemorySpanExporter を使って実際のスパンを生成する"""
    mem = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(mem))
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("child-span") as span:
        span.set_attribute("llm.model", "claude-opus-4-6")
        span.set_attribute("llm.input_tokens", 100)
    return mem.get_finished_spans()


class TestOtlpJsonExporter:
    def test_export_success_returns_success(self):
        exporter = OtlpJsonExporter(endpoint="http://localhost:3001")
        spans = _make_spans()

        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.__enter__ = lambda s: s
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_response):
            result = exporter.export(spans)

        assert result == SpanExportResult.SUCCESS

    def test_export_sends_correct_json_structure(self):
        exporter = OtlpJsonExporter(
            endpoint="http://localhost:3001",
            headers={"X-Traceforge-Api-Key": "test-key"},
        )
        spans = _make_spans()

        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["body"] = json.loads(req.data.decode())
            captured["headers"] = dict(req.headers)
            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            return mock_resp

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            exporter.export(spans)

        assert captured["url"] == "http://localhost:3001/v1/traces"
        # urllib.request.Request は capitalize() でヘッダーキーを正規化する
        # "X-Traceforge-Api-Key" → "X-traceforge-api-key" → lower → "x-traceforge-api-key"
        assert "x-traceforge-api-key" in {k.lower() for k in captured["headers"]}

        body = captured["body"]
        assert "resourceSpans" in body
        resource_span = body["resourceSpans"][0]
        scope_span = resource_span["scopeSpans"][0]
        span_data = scope_span["spans"][0]
        assert span_data["name"] == "child-span"

        # 属性が OTLP JSON 形式でエンコードされていること
        attrs = {a["key"]: a["value"] for a in span_data["attributes"]}
        assert attrs["llm.model"] == {"stringValue": "claude-opus-4-6"}
        assert attrs["llm.input_tokens"] == {"intValue": "100"}

    def test_export_network_failure_returns_failure(self):
        exporter = OtlpJsonExporter(endpoint="http://localhost:3001")
        spans = _make_spans()

        with patch("urllib.request.urlopen", side_effect=OSError("connection refused")):
            result = exporter.export(spans)

        assert result == SpanExportResult.FAILURE
