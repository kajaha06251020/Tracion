import json
import urllib.request
from typing import Any, Sequence

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import StatusCode


class OtlpJsonExporter(SpanExporter):
    def __init__(self, endpoint: str, headers: dict[str, str] | None = None) -> None:
        self._endpoint = f"{endpoint}/v1/traces"
        self._headers = {"Content-Type": "application/json"}
        if headers:
            self._headers.update(headers)

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        if not spans:
            return SpanExportResult.SUCCESS
        payload = self._to_otlp_json(spans)
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self._endpoint,
                data=data,
                headers=self._headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                return SpanExportResult.SUCCESS if resp.status < 400 else SpanExportResult.FAILURE
        except Exception:
            return SpanExportResult.FAILURE

    def shutdown(self) -> None:
        pass

    def _to_otlp_json(self, spans: Sequence[ReadableSpan]) -> dict[str, Any]:
        # Resource ごとにグルーピング
        resource_map: dict[tuple, dict] = {}
        for span in spans:
            key = tuple(sorted(span.resource.attributes.items())) if span.resource.attributes else ()
            if key not in resource_map:
                resource_map[key] = {
                    "resource": {
                        "attributes": self._encode_attributes(dict(span.resource.attributes or {}))
                    },
                    "scopeSpans": [{"spans": []}],
                }
            resource_map[key]["scopeSpans"][0]["spans"].append(self._encode_span(span))
        return {"resourceSpans": list(resource_map.values())}

    def _encode_span(self, span: ReadableSpan) -> dict[str, Any]:
        d: dict[str, Any] = {
            "traceId": format(span.context.trace_id, "032x"),
            "spanId": format(span.context.span_id, "016x"),
            "name": span.name,
            "startTimeUnixNano": str(span.start_time or 0),
            "endTimeUnixNano": str(span.end_time or 0),
            "attributes": self._encode_attributes(dict(span.attributes or {})),
            "events": [],
            "status": self._encode_status(span.status),
        }
        if span.parent and span.parent.span_id:
            d["parentSpanId"] = format(span.parent.span_id, "016x")
        return d

    def _encode_status(self, status: Any) -> dict[str, Any]:
        if status.status_code == StatusCode.OK:
            return {"code": 1}
        if status.status_code == StatusCode.ERROR:
            return {"code": 2, "message": status.description or ""}
        return {"code": 0}

    def _encode_attributes(self, attrs: dict[str, Any]) -> list[dict[str, Any]]:
        return [{"key": k, "value": self._encode_value(v)} for k, v in attrs.items()]

    def _encode_value(self, value: Any) -> dict[str, Any]:
        if isinstance(value, bool):
            return {"boolValue": value}
        if isinstance(value, int):
            return {"intValue": str(value)}
        if isinstance(value, float):
            return {"doubleValue": value}
        return {"stringValue": str(value)}
