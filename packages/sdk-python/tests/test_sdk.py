import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from tracion._sdk import TracionSDK


def make_sdk(**kwargs):
    exporter = InMemorySpanExporter()
    sdk = TracionSDK(
        endpoint="http://localhost:3001",
        agent_id="test-agent",
        session_id="test-session",
        _exporter=exporter,
        **kwargs,
    )
    return sdk, exporter


class TestTracionSDK:
    def test_trace_context_manager_records_span(self):
        sdk, exporter = make_sdk()
        with sdk.trace("generate_code") as span:
            span.set_input("hello")
            span.set_output("world")

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == "generate_code"
        assert spans[0].attributes["tracion.input"] == '"hello"'
        assert spans[0].attributes["tracion.output"] == '"world"'

    def test_trace_sets_error_status_on_exception(self):
        sdk, exporter = make_sdk()
        with pytest.raises(ValueError, match="something failed"):
            with sdk.trace("failing-op"):
                raise ValueError("something failed")

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR

    def test_trace_sets_kind_attribute(self):
        sdk, exporter = make_sdk()
        with sdk.trace("llm-call", kind="llm"):
            pass

        spans = exporter.get_finished_spans()
        assert spans[0].attributes["tracion.kind"] == "llm"

    def test_start_span_manual_style(self):
        sdk, exporter = make_sdk()
        span = sdk.start_span("tool_call", kind="tool")
        span.end(status="success")

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == "tool_call"
        assert spans[0].attributes["tracion.kind"] == "tool"

    def test_disabled_sdk_trace_still_executes_body(self):
        sdk, _ = make_sdk(enabled=False)
        executed = []
        with sdk.trace("noop") as span:
            executed.append(True)
            span.set_input("ignored")
        assert executed == [True]

    def test_disabled_sdk_start_span_returns_noop(self):
        sdk, exporter = make_sdk(enabled=False)
        span = sdk.start_span("noop")
        span.end()
        assert len(exporter.get_finished_spans()) == 0
