from typing import Literal

TraceStatus = Literal["running", "success", "error"]
SpanKind = Literal["llm", "tool", "agent", "retrieval", "custom"]
