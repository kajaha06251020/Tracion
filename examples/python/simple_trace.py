"""
Python SDK — simple trace example

Usage:
    pip install traceforge
    python simple_trace.py

Requires Traceforge API running at http://localhost:3001
Start with: docker compose up
"""

import os
import time
from traceforge import TraceforgeSDK

sdk = TraceforgeSDK(
    endpoint=os.environ.get("TRACEFORGE_API_URL", "http://localhost:3001"),
    api_key=os.environ.get("TRACEFORGE_API_KEY"),
    agent_id="python-example",
    session_id=f"session-{int(time.time())}",
)


def main():
    print("Sending trace to Traceforge...")

    with sdk.trace("research_pipeline", kind="agent") as root:
        root.set_input({"task": "Analyze customer feedback"})

        # Step 1: LLM call
        with sdk.trace("llm_extract_themes", kind="llm") as span:
            span.set_input({"feedback_count": 150})
            time.sleep(0.1)
            span.set_output({"themes": ["pricing", "support", "features"]})
            span.set_attribute("traceforge.model", "claude-opus-4-6")
            span.set_attribute("traceforge.input_tokens", 512)
            span.set_attribute("traceforge.output_tokens", 128)

        # Step 2: Tool call
        with sdk.trace("tool_fetch_tickets", kind="tool") as span:
            span.set_input({"theme": "pricing", "limit": 50})
            time.sleep(0.05)
            span.set_output({"tickets": 47, "avg_sentiment": -0.3})

        # Step 3: Final LLM summary
        with sdk.trace("llm_write_report", kind="llm") as span:
            span.set_input({"themes_analyzed": 3})
            time.sleep(0.2)
            span.set_output({"report_length": 850, "action_items": 5})
            span.set_attribute("traceforge.model", "claude-opus-4-6")
            span.set_attribute("traceforge.input_tokens", 2048)
            span.set_attribute("traceforge.output_tokens", 512)

        root.set_output({"report": "Pricing is the top concern..."})

    # Wait for export
    time.sleep(6)
    print("✓ Trace sent! Open http://localhost:3000/traces to view it.")


if __name__ == "__main__":
    main()
