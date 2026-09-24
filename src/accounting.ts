import type { Budget, ContextStats, ModelRequestKind, ModelResponse, RunResult, WorkerContextMetrics } from './types.js';
import { parseBudget } from './config.js';

export type ModelFailure = Extract<RunResult['termination'], 'request_limit' | 'timeout' | 'cancelled' | 'context_overflow' | 'model_error' | 'io_error'>;

export class ModelCallError extends Error {
  constructor(readonly termination: ModelFailure, message: string = termination) {
    super(message);
    this.name = 'ModelCallError';
  }
}

export class Accounting {
  readonly signal: AbortSignal;
  private readonly deadlineSignal: AbortSignal;
  private readonly runSignal: AbortSignal | undefined;
  private readonly limits: Budget;
  private calls = { worker: 0, optimizer: 0, summary: 0 };
  private inputKnown = 0;
  private outputKnown = 0;
  private inputComplete = true;
  private outputComplete = true;
  private workerEstimates: number[] = [];
  private workerChars: number[] = [];
  private thresholds = 0;
  private eligible = 0;

  constructor(budget: Budget, runSignal?: AbortSignal) {
    this.limits = parseBudget(budget);
    this.runSignal = runSignal;
    this.deadlineSignal = AbortSignal.timeout(budget.timeoutMs);
    this.signal = runSignal ? AbortSignal.any([runSignal, this.deadlineSignal]) : this.deadlineSignal;
  }

  get budget(): Budget { return { ...this.limits }; }

  check(): void {
    this.checkSignal();
    if (this.modelRequests >= this.limits.maxModelRequests) throw new ModelCallError('request_limit');
  }

  checkSignal(): void {
    if (this.runSignal?.aborted) throw new ModelCallError('cancelled');
    if (this.deadlineSignal.aborted) throw new ModelCallError('timeout');
    if (this.signal.aborted) throw new ModelCallError('cancelled');
  }

  get modelRequests(): number { return this.calls.worker + this.calls.optimizer + this.calls.summary; }

  reserve(kind: ModelRequestKind, metrics?: WorkerContextMetrics): void {
    this.check();
    if (kind === 'worker' && !metrics) throw new Error('worker context metrics required');
    this.calls[kind]++;
    if (kind === 'worker' && metrics) {
      this.workerEstimates.push(metrics.estimatedInputTokens);
      this.workerChars.push(metrics.requestChars);
      if (metrics.thresholdReached) this.thresholds++;
      if (metrics.compactionEligible) this.eligible++;
    }
  }

  recordUsage(usage: ModelResponse['usage'] | null): void {
    if (usage?.inputTokens === null || usage === null) this.inputComplete = false;
    else this.inputKnown += usage.inputTokens;
    if (usage?.outputTokens === null || usage === null) this.outputComplete = false;
    else this.outputKnown += usage.outputTokens;
  }

  snapshot(): Pick<RunResult, 'modelRequests' | 'workerRequests' | 'optimizerRequests' | 'summaryRequests' |
    'inputTokens' | 'outputTokens' | 'knownInputTokens' | 'knownOutputTokens' | 'contextStats'> {
    const workerRequests = this.calls.worker;
    const contextStats: ContextStats = {
      workerRequests,
      meanEstimatedInputTokens: workerRequests ? this.workerEstimates.reduce((a, b) => a + b, 0) / workerRequests : null,
      peakEstimatedInputTokens: workerRequests ? Math.max(...this.workerEstimates) : null,
      peakRequestChars: workerRequests ? Math.max(...this.workerChars) : null,
      thresholdRequests: this.thresholds,
      eligibleCompactionRequests: this.eligible,
    };
    return {
      modelRequests: this.modelRequests,
      workerRequests,
      optimizerRequests: this.calls.optimizer,
      summaryRequests: this.calls.summary,
      inputTokens: this.inputComplete ? this.inputKnown : null,
      outputTokens: this.outputComplete ? this.outputKnown : null,
      knownInputTokens: this.inputKnown,
      knownOutputTokens: this.outputKnown,
      contextStats,
    };
  }
}
