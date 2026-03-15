import { describe, it, expect } from 'vitest'
import { spansToGraph } from './spans-to-graph'

const base = {
  startTime: new Date(),
  endTime: null,
  model: null,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: '0',
  status: 'success' as const,
  attributes: {},
  events: [],
}

describe('spansToGraph', () => {
  it('returns empty graph for empty input', () => {
    const result = spansToGraph([])
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('creates one node per span with no edges for root-only trace', () => {
    const spans = [
      { id: 'a', name: 'root', kind: 'agent' as const, parentSpanId: null, traceId: 't1', ...base },
    ]
    const result = spansToGraph(spans)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('a')
    expect(result.edges).toHaveLength(0)
  })

  it('creates an edge from parent to child', () => {
    const spans = [
      { id: 'a', name: 'root', kind: 'agent' as const, parentSpanId: null, traceId: 't1', ...base },
      { id: 'b', name: 'llm-call', kind: 'llm' as const, parentSpanId: 'a', traceId: 't1', ...base },
    ]
    const result = spansToGraph(spans)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({ source: 'a', target: 'b' })
  })

  it('handles branching tree', () => {
    const spans = [
      { id: 'root', name: 'root', kind: 'agent' as const, parentSpanId: null, traceId: 't1', ...base },
      { id: 'child1', name: 'tool-1', kind: 'tool' as const, parentSpanId: 'root', traceId: 't1', ...base },
      { id: 'child2', name: 'tool-2', kind: 'tool' as const, parentSpanId: 'root', traceId: 't1', ...base },
    ]
    const result = spansToGraph(spans)
    expect(result.nodes).toHaveLength(3)
    expect(result.edges).toHaveLength(2)
    expect(result.edges.map((e) => e.target).sort()).toEqual(['child1', 'child2'])
  })

  it('nodes have position initialised to 0,0 (dagre overrides)', () => {
    const spans = [
      { id: 'a', name: 'root', kind: 'agent' as const, parentSpanId: null, traceId: 't1', ...base },
    ]
    const result = spansToGraph(spans)
    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})
