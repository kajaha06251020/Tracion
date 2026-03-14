from unittest.mock import MagicMock
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from traceforge.instrumentation._openai import patch_openai


def setup_provider():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test"), exporter


class TestPatchOpenAI:
    def test_none_client_does_not_raise(self):
        tracer, _ = setup_provider()
        patch_openai(tracer, None)

    def test_patches_chat_completions_create_and_records_tokens(self):
        tracer, exporter = setup_provider()

        # 新しいモッククライアントを毎テスト生成
        mock_response = MagicMock()
        mock_response.usage.prompt_tokens = 150
        mock_response.usage.completion_tokens = 80

        mock_create = MagicMock(return_value=mock_response)
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create

        patch_openai(tracer, mock_client)

        mock_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hi"}],
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        span = spans[0]
        assert span.name == "openai.chat.completions.create"
        assert span.attributes["llm.model"] == "gpt-4o"
        assert span.attributes["llm.input_tokens"] == 150
        assert span.attributes["llm.output_tokens"] == 80
        assert span.attributes["llm.provider"] == "openai"
        assert span.attributes["traceforge.kind"] == "llm"
        assert span.status.status_code == StatusCode.OK

    def test_records_error_span_on_exception(self):
        tracer, exporter = setup_provider()

        mock_create = MagicMock(side_effect=RuntimeError("rate limit"))
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_create

        patch_openai(tracer, mock_client)

        try:
            mock_client.chat.completions.create(model="gpt-4o", messages=[])
        except RuntimeError:
            pass

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
