import type { Trace } from '../types'

type GithubMetadata = {
  githubPrUrl: string
  githubPrNumber: string
  githubRepository: string
}

export async function postGithubPrComment(trace: Trace): Promise<void> {
  const meta = trace.metadata as GithubMetadata
  const [owner, repo] = meta.githubRepository.split('/')
  const prNumber = meta.githubPrNumber

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: buildCommentBody(trace) }),
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
  }
}

export function buildCommentBody(trace: Trace): string {
  const status = trace.status === 'success' ? '✅ Success' : '❌ Error'

  const durationMs = trace.endTime && trace.startTime
    ? new Date(trace.endTime).getTime() - new Date(trace.startTime).getTime()
    : null
  const durationStr = durationMs != null
    ? durationMs >= 60_000
      ? `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`
      : `${Math.floor(durationMs / 1000)}s`
    : '—'

  const costStr = `$${parseFloat(trace.totalCostUsd as string).toFixed(4)}`
  const traceUrl = `${process.env.TRACION_WEB_URL ?? 'http://localhost:3000'}/traces/${trace.id}`

  return [
    '## 🤖 Tracion — Agent Trace',
    '',
    '| | |',
    '|---|---|',
    `| **Status** | ${status} |`,
    `| **Agent** | ${trace.agentId} |`,
    `| **Duration** | ${durationStr} |`,
    `| **Cost** | ${costStr} |`,
    `| **Tokens** | ${trace.totalTokens.toLocaleString('en-US')} |`,
    '',
    `[View full trace →](${traceUrl})`,
    '',
    '<sub>Posted by [Tracion](https://github.com/kajaha06251020/Tracion)</sub>',
  ].join('\n')
}
