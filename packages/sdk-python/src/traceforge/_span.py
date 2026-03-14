import json
from abc import ABC, abstractmethod
from typing import Any, cast

from opentelemetry.trace import Span as OtelSpan, StatusCode, Status
from opentelemetry.util.types import Attributes

from traceforge._types import TraceStatus


class TraceforgeSpan(ABC):
    @abstractmethod
    def set_input(self, value: Any) -> None: ...

    @abstractmethod
    def set_output(self, value: Any) -> None: ...

    @abstractmethod
    def set_attribute(self, key: str, value: Any) -> None: ...

    @abstractmethod
    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None: ...

    @abstractmethod
    def end(self, status: TraceStatus = "success", error: BaseException | None = None) -> None: ...


class OtelTraceforgeSpan(TraceforgeSpan):
    def __init__(self, otel_span: OtelSpan) -> None:
        self._otel_span = otel_span

    def set_input(self, value: Any) -> None:
        self._otel_span.set_attribute("traceforge.input", json.dumps(value))

    def set_output(self, value: Any) -> None:
        self._otel_span.set_attribute("traceforge.output", json.dumps(value))

    def set_attribute(self, key: str, value: Any) -> None:
        if isinstance(value, (str, bool, int, float)):
            self._otel_span.set_attribute(key, value)
        else:
            self._otel_span.set_attribute(key, json.dumps(value))

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        self._otel_span.add_event(name, cast(Attributes, attributes) if attributes else None)

    def end(self, status: TraceStatus = "success", error: BaseException | None = None) -> None:
        if status == "error":
            message = str(error) if error else ""
            self._otel_span.set_status(Status(StatusCode.ERROR, message))
        else:
            self._otel_span.set_status(Status(StatusCode.OK))
        self._otel_span.end()


class NoopTraceforgeSpan(TraceforgeSpan):
    def set_input(self, value: Any) -> None:
        pass

    def set_output(self, value: Any) -> None:
        pass

    def set_attribute(self, key: str, value: Any) -> None:
        pass

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        pass

    def end(self, status: TraceStatus = "success", error: BaseException | None = None) -> None:
        pass
