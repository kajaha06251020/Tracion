import type { Node, Edge } from 'reactflow'

type Span = {
  id: string
  name: string
  kind: string
  parentSpanId: string | null
}

export function spansToGraph(spans: Span[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = spans.map((span) => ({
    id: span.id,
    data: { label: span.name, kind: span.kind },
    position: { x: 0, y: 0 },
  }))

  const edges: Edge[] = spans
    .filter((span) => span.parentSpanId !== null)
    .map((span) => ({
      id: `${span.parentSpanId}-${span.id}`,
      source: span.parentSpanId as string,
      target: span.id,
      type: 'smoothstep',
    }))

  return { nodes, edges }
}
