from typing import Any

from opentelemetry.trace import Tracer, StatusCode, Status


def patch_openai(tracer: Tracer, client: Any) -> None:
    """OpenAI クライアントの chat.completions.create をパッチしてトークンを記録する。

    client が None の場合は何もしない（openai 未インストール時のフォールバック）。
    prompt_tokens → llm.input_tokens、completion_tokens → llm.output_tokens にマッピング。
    """
    if client is None:
        return

    original_create = client.chat.completions.create

    def patched_create(*args: Any, **kwargs: Any) -> Any:
        span = tracer.start_span("openai.chat.completions.create")
        span.set_attribute("traceforge.kind", "llm")
        span.set_attribute("llm.provider", "openai")

        model = kwargs.get("model") or (args[0] if args else None)
        if model:
            span.set_attribute("llm.model", str(model))

        try:
            result = original_create(*args, **kwargs)
            usage = getattr(result, "usage", None)
            if usage:
                prompt_tokens = getattr(usage, "prompt_tokens", None)
                completion_tokens = getattr(usage, "completion_tokens", None)
                if prompt_tokens is not None:
                    span.set_attribute("llm.input_tokens", int(prompt_tokens))
                if completion_tokens is not None:
                    span.set_attribute("llm.output_tokens", int(completion_tokens))
            span.set_status(Status(StatusCode.OK))
            span.end()
            return result
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.end()
            raise

    client.chat.completions.create = patched_create


def try_patch_openai(tracer: Tracer) -> None:
    """OpenAI SDK が存在する場合に自動パッチを試みる。"""
    try:
        import openai  # noqa: PLC0415
        patch_openai(tracer, openai.OpenAI)
    except ImportError:
        pass
