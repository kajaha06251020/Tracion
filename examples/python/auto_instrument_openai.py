"""
Python SDK — OpenAI auto-instrumentation example

Usage:
    pip install traceforge openai
    OPENAI_API_KEY=sk-... python auto_instrument_openai.py
"""

import os
import time
import openai
from traceforge import TraceforgeSDK
from traceforge.instrumentation import patch_openai

client = openai.OpenAI()

sdk = TraceforgeSDK(
    endpoint=os.environ.get("TRACEFORGE_API_URL", "http://localhost:3001"),
    agent_id="openai-example",
)

# Auto-instrument — all subsequent chat.completions.create() calls are traced
patch_openai(client, sdk)


def main():
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "What is 2 + 2?"}],
    )
    print(response.choices[0].message.content)
    time.sleep(6)
    print("✓ Check http://localhost:3000/traces for the auto-traced call.")


if __name__ == "__main__":
    main()
