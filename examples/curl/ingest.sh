#!/bin/bash
# Send a sample OTLP trace to Traceforge via cURL
# Usage: ./ingest.sh [API_URL]

API_URL="${1:-http://localhost:3001}"
TRACE_ID="$(python3 -c 'import secrets; print(secrets.token_hex(16))' 2>/dev/null || echo "aabbccddeeff00112233445566778899")"
SPAN_ID="$(python3 -c 'import secrets; print(secrets.token_hex(8))' 2>/dev/null || echo "aabbccdd11223344")"
NOW_NS="$(date +%s)000000000"
END_NS="$(( $(date +%s) + 1 ))000000000"

echo "Sending trace ${TRACE_ID} to ${API_URL}..."

curl -s -X POST "${API_URL}/v1/traces" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceSpans\": [{
      \"resource\": {
        \"attributes\": [
          {\"key\": \"service.name\", \"value\": {\"stringValue\": \"curl-example\"}},
          {\"key\": \"traceforge.agent_id\", \"value\": {\"stringValue\": \"curl-agent\"}}
        ]
      },
      \"scopeSpans\": [{
        \"spans\": [{
          \"traceId\": \"${TRACE_ID}\",
          \"spanId\": \"${SPAN_ID}\",
          \"name\": \"curl_example_trace\",
          \"kind\": 1,
          \"startTimeUnixNano\": \"${NOW_NS}\",
          \"endTimeUnixNano\": \"${END_NS}\",
          \"status\": {\"code\": 1},
          \"attributes\": [
            {\"key\": \"traceforge.kind\", \"value\": {\"stringValue\": \"agent\"}},
            {\"key\": \"traceforge.input\", \"value\": {\"stringValue\": \"\\\"hello from curl\\\"\"}},
            {\"key\": \"traceforge.output\", \"value\": {\"stringValue\": \"\\\"success\\\"\"}},
            {\"key\": \"traceforge.input_tokens\", \"value\": {\"intValue\": 10}},
            {\"key\": \"traceforge.output_tokens\", \"value\": {\"intValue\": 5}}
          ]
        }]
      }]
    }]
  }"

echo ""
echo "✓ Done! Open http://localhost:3000/traces to see your trace."
