export function formatDuration(startTime: Date | string, endTime: Date | string | null): string {
  if (!endTime) return 'running'
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function formatCost(usd: string | number): string {
  const n = typeof usd === 'string' ? parseFloat(usd) : usd
  if (n === 0) return '$0'
  if (n < 0.001) return '<$0.001'
  return `$${n.toFixed(4)}`
}

export function formatRelativeTime(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
