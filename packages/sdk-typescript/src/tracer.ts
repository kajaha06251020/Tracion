import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import type { TracionConfig } from './types'
import { createExporter } from './exporter'

type GithubPrContext = {
  prNumber: string
  prUrl: string
  repository: string
}

function detectGithubPrContext(): GithubPrContext | null {
  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    const raw = execSync(
      'gh pr view --json number,url,headRefName,baseRefName,headRepository',
      { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }
    ) as string
    const pr = JSON.parse(raw) as {
      number: number
      url: string
      headRefName: string
      baseRefName: string
      headRepository: { nameWithOwner: string }
    }
    return {
      prNumber: String(pr.number),
      prUrl: pr.url,
      repository: pr.headRepository.nameWithOwner,
    }
  } catch {
    return null
  }
}

export function createTracerProvider(config: TracionConfig): BasicTracerProvider {
  const prContext = detectGithubPrContext()

  const resource = new Resource({
    'tracion.agent_id': config.agentId ?? 'unknown',
    'tracion.session_id': config.sessionId ?? 'default',
    'service.name': config.agentId ?? 'unknown',
    'process.runtime.version': process.version,
    'process.pid': process.pid,
    ...(prContext ? {
      'github.pr.number': prContext.prNumber,
      'github.pr.url': prContext.prUrl,
      'github.repository': prContext.repository,
    } : {}),
  })

  const exporter = config._exporter ?? createExporter(config)
  const provider = new BasicTracerProvider({ resource })

  if (config._exporter) {
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  } else {
    provider.addSpanProcessor(
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: config.batchSize ?? 512,
        scheduledDelayMillis: config.exportIntervalMs ?? 5000,
      })
    )
  }

  return provider
}
