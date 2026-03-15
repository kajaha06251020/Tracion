import type { Trace } from '../types'

export async function postSlackTraceNotification(trace: Trace): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  const webUrl = process.env.TRACION_WEB_URL ?? 'http://localhost:3000'
  const traceUrl = `${webUrl}/traces/${trace.id}`

  const status = trace.status === 'success' ? ':white_check_mark: Success' : ':x: Error'

  const durationMs = trace.endTime && trace.startTime
    ? new Date(trace.endTime).getTime() - new Date(trace.startTime).getTime()
    : null
  const durationStr = durationMs != null
    ? durationMs >= 60_000
      ? `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`
      : `${Math.floor(durationMs / 1000)}s`
    : '—'

  const costStr = `$${parseFloat(trace.totalCostUsd as string).toFixed(4)}`

  const prMeta = trace.metadata as Record<string, unknown>
  const prLink = prMeta.githubPrUrl
    ? `  |  PR: <${prMeta.githubPrUrl}|#${prMeta.githubPrNumber}>`
    : ''

  const payload = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Agent Trace Complete*${prLink}`,
            `*Agent:* ${trace.agentId}  |  *Status:* ${status}`,
            `*Duration:* ${durationStr}  |  *Cost:* ${costStr}  |  *Tokens:* ${trace.totalTokens.toLocaleString('en-US')}`,
            `<${traceUrl}|View full trace →>`,
          ].join('\n'),
        },
      },
    ],
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Slack webhook ${response.status}: ${await response.text()}`)
  }
}
