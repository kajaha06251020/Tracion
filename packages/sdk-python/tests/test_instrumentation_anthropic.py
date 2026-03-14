from unittest.mock import MagicMock
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from traceforge.instrumentation._anthropic import patch_anthropic


def setup_provider():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test"), exporter


class TestPatchAnthropic:
    def test_none_client_does_not_raise(self):
        tracer, _ = setup_provider()
        patch_anthropic(tracer, None)  # エラーにならないこと

    def test_patches_messages_create_and_records_tokens(self):
        tracer, exporter = setup_provider()

        # 新しいモッククライアントを毎テスト生成（パッチ蓄積防止）
        mock_response = MagicMock()
        mock_response.usage.input_tokens = 200
        mock_response.usage.output_tokens = 100

        mock_create = MagicMock(return_value=mock_response)
        mock_client = MagicMock()
        mock_client.messages.create = mock_create

        patch_anthropic(tracer, mock_client)

        mock_client.messages.create(
            model="claude-opus-4-6",
            messages=[{"role": "user", "content": "Hi"}],
            max_tokens=100,
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        span = spans[0]
        assert span.name == "anthropic.messages.create"
        assert span.attributes["llm.model"] == "claude-opus-4-6"
        assert span.attributes["llm.input_tokens"] == 200
        assert span.attributes["llm.output_tokens"] == 100
        assert span.attributes["llm.provider"] == "anthropic"
        assert span.attributes["traceforge.kind"] == "llm"
        assert span.status.status_code == StatusCode.OK

    def test_records_error_span_on_exception(self):
        tracer, exporter = setup_provider()

        mock_create = MagicMock(side_effect=RuntimeError("API error"))
        mock_client = MagicMock()
        mock_client.messages.create = mock_create

        patch_anthropic(tracer, mock_client)

        try:
            mock_client.messages.create(model="claude-opus-4-6", messages=[], max_tokens=10)
        except RuntimeError:
            pass

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
