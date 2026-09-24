import variantSpec from '../specs/variants.json' with { type: 'json' };

export type Variant = keyof typeof variantSpec.variants;
export interface Budget {
  maxModelRequests: number;
  maxToolCalls: number;
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputChars: number;
}
export interface ModelConfig { endpoint: string; id: string; temperature: number }
export interface ContextConfig { estimatedWindowTokens: number; triggerRatio: number; keepRecentRounds: number }
export interface RunConfig {
  schemaVersion: 1;
  variant: Variant;
  model: ModelConfig;
  budget: Budget;
  context: ContextConfig;
  workspace: string;
  writable: string[];
  sessionPath: string;
}

export interface ToolCall { id: string; name: string; arguments: string }
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; calls: ToolCall[] }
  | { role: 'tool'; callId: string; content: string };
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolResult { ok: boolean; output: string; errorCode: string | null; truncated: boolean }
export interface ToolDefinition extends ToolSchema {
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}
export interface WorkerContextMetrics {
  requestChars: number;
  estimatedInputTokens: number;
  preCompressionEstimatedTokens: number;
  olderRounds: number;
  thresholdReached: boolean;
  compactionEligible: boolean;
  observationSeq: number;
}
export type ModelRequestKind = 'worker' | 'optimizer' | 'summary';
export interface ModelRequest {
  kind: ModelRequestKind;
  contextMetrics?: Omit<WorkerContextMetrics, 'requestChars' | 'observationSeq'>;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  maxOutputTokens: number;
  signal: AbortSignal;
}
export interface ModelResponse {
  content: string;
  calls: ToolCall[];
  finish: 'stop' | 'tool_calls' | 'length' | 'other';
  usage: { inputTokens: number | null; outputTokens: number | null };
  actualModel: string | null;
  fingerprint: string | null;
}
export type Termination = 'completed' | 'request_limit' | 'tool_limit' | 'timeout'
  | 'cancelled' | 'context_overflow' | 'model_error' | 'io_error' | 'internal_error';
export interface ContextStats {
  workerRequests: number;
  meanEstimatedInputTokens: number | null;
  peakEstimatedInputTokens: number | null;
  peakRequestChars: number | null;
  thresholdRequests: number;
  eligibleCompactionRequests: number;
}
export interface RunResult {
  schemaVersion: 1;
  termination: Termination;
  answer: string | null;
  modelRequests: number;
  workerRequests: number;
  optimizerRequests: number;
  summaryRequests: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number | null;
  outputTokens: number | null;
  knownInputTokens: number;
  knownOutputTokens: number;
  durationMs: number;
  compactions: number;
  error: string | null;
  contextStats: ContextStats;
}
export type KnownEventType = 'run_start' | 'message' | 'request' | 'response' | 'tool_start' | 'tool_end'
  | 'context_compacted' | 'context_observation' | 'run_end';
export interface Event {
  schemaVersion: 1;
  seq: number;
  type: string;
  elapsedMs: number;
  data: unknown;
}
export interface EventInput { type: string; data: unknown }
