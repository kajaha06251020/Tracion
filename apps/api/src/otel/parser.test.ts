import { describe, it, expect } from 'vitest'
import { parseOtlpPayload, type OtlpPayload } from './parser'

const minimalPayload: OtlpPayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-agent' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'aabbccdd00112233',
              spanId: 'span001122334455',
              name: 'generate_code',
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000001000000000',
              status: { code: 1 },
              attributes: [],
              events: [],
            },
          ],
        },
      ],
    },
  ],
}

describe('parseOtlpPayload', () => {
  it('extracts agentId from traceforge.agent_id attribute', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.resource!.attributes!.push(
      { key: 'traceforge.agent_id', value: { stringValue: 'claude-code' } }
    )
    const { trace } = parseOtlpPayload(payload)
    expect(trace.agentId).toBe('claude-code')
  })

  it('falls back agentId to service.name', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.agentId).toBe('my-agent')
  })

  it('falls back agentId to "unknown" when no resource attrs', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.resource!.attributes = []
    const { trace } = parseOtlpPayload(payload)
    expect(trace.agentId).toBe('unknown')
  })

  it('defaults sessionId to "default"', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.sessionId).toBe('default')
  })

  it('extracts sessionId from traceforge.session_id attribute', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.resource!.attributes!.push(
      { key: 'traceforge.session_id', value: { stringValue: 'sess-abc' } }
    )
    const { trace } = parseOtlpPayload(payload)
    expect(trace.sessionId).toBe('sess-abc')
  })

  it('uses root span name as trace name', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.name).toBe('generate_code')
  })

  it('maps OTel status code 2 to "error"', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status!.code = 2
    const { trace } = parseOtlpPayload(payload)
    expect(trace.status).toBe('error')
  })

  it('maps OTel status code 1 to "success"', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.status).toBe('success')
  })

  it('parses unix nano timestamps to Date', () => {
    const { spans } = parseOtlpPayload(minimalPayload)
    expect(spans[0]!.startTime).toBeInstanceOf(Date)
    expect(spans[0]!.startTime.getFullYear()).toBe(2023)
  })

  it('maps traceforge.kind span attribute to span.kind', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes!.push(
      { key: 'traceforge.kind', value: { stringValue: 'llm' } }
    )
    const { spans } = parseOtlpPayload(payload)
    expect(spans[0]!.kind).toBe('llm')
  })

  it('sums tokens across all spans for trace.totalTokens', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes!.push(
      { key: 'llm.input_tokens', value: { intValue: '500' } },
      { key: 'llm.output_tokens', value: { intValue: '300' } }
    )
    const { trace } = parseOtlpPayload(payload)
    expect(trace.totalTokens).toBe(800)
  })
})
