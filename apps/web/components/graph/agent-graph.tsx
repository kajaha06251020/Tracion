'use client'

import { useCallback, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import { SpanAttributes } from '@/components/trace/span-attributes'

const KIND_COLORS: Record<string, string> = {
  llm: '#3b82f6',
  tool: '#22c55e',
  agent: '#a855f7',
  retrieval: '#f97316',
  custom: '#6b7280',
}

const NODE_WIDTH = 160
const NODE_HEIGHT = 40

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 })
  g.setDefaultEdgeLabel(() => ({}))

  nodes.forEach((node) => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((edge) => g.setEdge(edge.source, edge.target))
  dagre.layout(g)

  return nodes.map((node) => {
    const { x, y } = g.node(node.id)
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } }
  })
}

type Props = {
  initialNodes: Node[]
  initialEdges: Edge[]
  spans: {
    id: string
    name: string
    kind: string
    model: string | null
    inputTokens: number
    outputTokens: number
    costUsd: string | number
    status: string
    attributes: Record<string, unknown>
    events: unknown[]
  }[]
}

export function AgentGraph({ initialNodes, initialEdges, spans }: Props) {
  const laidOut = applyDagreLayout(initialNodes, initialEdges)
  const [nodes, , onNodesChange] = useNodesState(
    laidOut.map((n) => ({
      ...n,
      style: {
        background: KIND_COLORS[(n.data as { kind: string }).kind] ?? KIND_COLORS.custom,
        color: '#fff',
        borderRadius: 6,
        border: 'none',
        fontSize: 12,
        width: NODE_WIDTH,
      },
    }))
  )
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)

  const selectedSpan = spans.find((s) => s.id === selectedSpanId)

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedSpanId(node.id)
  }, [])

  return (
    <div className="flex h-full">
      <div className="flex-1 h-[70vh]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      {selectedSpan && (
        <div className="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-y-auto">
          <SpanAttributes span={selectedSpan} />
        </div>
      )}
    </div>
  )
}
