import type { Disposer } from '../plugin.js';
import type { Event, EventInput, Message, ModelRequest, ModelResponse, RunResult, ToolCall, ToolDefinition, ToolResult, ToolSchema, WorkerContextMetrics } from '../types.js';

export interface ModelService { complete(request: ModelRequest): Promise<ModelResponse> }
export interface PersistenceService { append(event: Event): Promise<void>; close(): Promise<void> }
export interface SessionService { append(message: Message): Promise<void>; messages(): readonly Message[]; record(input: EventInput): Promise<Event> }
export interface ContextProjection {
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  contextMetrics: Omit<WorkerContextMetrics, 'requestChars' | 'observationSeq'>;
}
export interface ContextManagerService { build(input: { system: string; signal: AbortSignal }): Promise<ContextProjection> }
export interface PromptOptimizerService { optimize(input: string, signal: AbortSignal): Promise<string> }
export interface AgentLoopService { run(input: string, options: { signal?: AbortSignal }): Promise<RunResult> }
export interface PermissionService { check(tool: string, args: Record<string, unknown>): { allowed: boolean; reason: string | null } }
export interface ToolsService {
  register(definition: ToolDefinition): Disposer;
  schemas(): ToolSchema[];
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
}
export interface EventsService { on(listener: (event: Event) => void): Disposer; emit(event: Event): void }
export interface ServiceMap {
  model: ModelService;
  persistence: PersistenceService;
  session: SessionService;
  contextManager: ContextManagerService;
  promptOptimizer: PromptOptimizerService;
  agentLoop: AgentLoopService;
  permissions: PermissionService;
  tools: ToolsService;
  events: EventsService;
}
