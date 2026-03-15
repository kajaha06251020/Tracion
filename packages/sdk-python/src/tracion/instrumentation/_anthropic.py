from typing import Any

from opentelemetry.trace import Tracer, StatusCode, Status


def patch_anthropic(tracer: Tracer, client: Any) -> None:
    """Anthropic クライアントの messages.create をパッチしてトークンを記録する。

    client が None の場合は何もしない（anthropic 未インストール時のフォールバック）。
    """
    if client is None:
        return

    original_create = client.messages.create

    def patched_create(*args: Any, **kwargs: Any) -> Any:
        span = tracer.start_span("anthropic.messages.create")
        span.set_attribute("tracion.kind", "llm")
        span.set_attribute("llm.provider", "anthropic")

        model = kwargs.get("model") or (args[0] if args else None)
        if model:
            span.set_attribute("llm.model", str(model))

        try:
            result = original_create(*args, **kwargs)
            usage = getattr(result, "usage", None)
            if usage:
                input_tokens = getattr(usage, "input_tokens", None)
                output_tokens = getattr(usage, "output_tokens", None)
                if input_tokens is not None:
                    span.set_attribute("llm.input_tokens", int(input_tokens))
                if output_tokens is not None:
                    span.set_attribute("llm.output_tokens", int(output_tokens))
            span.set_status(Status(StatusCode.OK))
            span.end()
            return result
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.end()
            raise

    client.messages.create = patched_create


def try_patch_anthropic(tracer: Tracer) -> None:
    """Anthropic SDK が存在する場合に自動パッチを試みる。"""
    try:
        import anthropic  # noqa: PLC0415
        patch_anthropic(tracer, anthropic.Anthropic)
    except ImportError:
        pass
