import json
from unittest.mock import MagicMock
from opentelemetry.trace import StatusCode, Status

from traceforge._span import OtelTraceforgeSpan, NoopTraceforgeSpan


def make_mock_span():
    span = MagicMock()
    span.set_attribute = MagicMock()
    span.set_status = MagicMock()
    span.end = MagicMock()
    span.add_event = MagicMock()
    return span


class TestOtelTraceforgeSpan:
    def test_set_input_stores_json_string(self):
        otel = make_mock_span()
        span = OtelTraceforgeSpan(otel)
        span.set_input({"prompt": "hello"})
        otel.set_attribute.assert_called_once_with(
            "traceforge.input", json.dumps({"prompt": "hello"})
        )

    def test_set_output_stores_json_string(self):
        otel = make_mock_span()
        span = OtelTraceforgeSpan(otel)
        span.set_output("result text")
        otel.set_attribute.assert_called_once_with(
            "traceforge.output", json.dumps("result text")
        )

    def test_end_success_sets_ok_status(self):
        otel = make_mock_span()
        span = OtelTraceforgeSpan(otel)
        span.end(status="success")

        # Check set_status was called once
        assert otel.set_status.call_count == 1
        call_args = otel.set_status.call_args[0][0]
        assert call_args._status_code == StatusCode.OK
        assert call_args._description is None

        otel.end.assert_called_once()

    def test_end_error_sets_error_status_with_message(self):
        otel = make_mock_span()
        span = OtelTraceforgeSpan(otel)
        span.end(status="error", error=ValueError("boom"))

        # Check set_status was called once
        assert otel.set_status.call_count == 1
        call_args = otel.set_status.call_args[0][0]
        assert call_args._status_code == StatusCode.ERROR
        assert call_args._description == "boom"

        otel.end.assert_called_once()


class TestNoopTraceforgeSpan:
    def test_all_methods_do_not_raise(self):
        span = NoopTraceforgeSpan()
        span.set_input("x")
        span.set_output("x")
        span.set_attribute("k", "v")
        span.add_event("e")
        span.end()
        span.end(status="error", error=ValueError("e"))
