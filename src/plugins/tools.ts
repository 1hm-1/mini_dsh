import type { MiniPlugin } from '../plugin.js';
import type { ToolCall, ToolDefinition, ToolResult, ToolSchema } from '../types.js';

const MAX_OUTPUT = 16000;
const TRUNCATION_MARKER = '\n[truncated]';

type ValidatedSchema = ToolSchema & {
  parameters: {
    type: 'object';
    properties: Record<string, { type: 'string'; description?: string }>;
    required: string[];
    additionalProperties: false;
  };
};
type Registration = { schema: ValidatedSchema; execute: ToolDefinition['execute'] };

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function parseSchema(definition: ToolDefinition): ValidatedSchema {
  if (typeof definition.name !== 'string' || definition.name.trim() === ''
    || typeof definition.description !== 'string' || definition.description.trim() === ''
    || typeof definition.execute !== 'function') throw new Error('tool schema: invalid definition');
  const input = definition.parameters;
  if (!plainObject(input) || !onlyKeys(input, ['type', 'properties', 'required', 'additionalProperties'])
    || input.type !== 'object' || input.additionalProperties !== false
    || !plainObject(input.properties) || !Array.isArray(input.required)) {
    throw new Error('tool schema: unsupported parameters');
  }
  const properties: ValidatedSchema['parameters']['properties'] = Object.create(null);
  for (const [name, value] of Object.entries(input.properties)) {
    if (!plainObject(value) || !onlyKeys(value, ['type', 'description']) || value.type !== 'string'
      || value.description !== undefined && typeof value.description !== 'string') {
      throw new Error('tool schema: unsupported property');
    }
    properties[name] = value.description === undefined ? { type: 'string' } : { type: 'string', description: value.description };
  }
  const required: string[] = [];
  for (const name of input.required) {
    if (typeof name !== 'string' || !Object.hasOwn(properties, name) || required.includes(name)) {
      throw new Error('tool schema: invalid required field');
    }
    required.push(name);
  }
  return {
    name: definition.name, description: definition.description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  };
}

function copySchema(schema: ValidatedSchema): ToolSchema {
  return {
    name: schema.name, description: schema.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(schema.parameters.properties).map(([name, value]) => [name, { ...value }])),
      required: [...schema.parameters.required], additionalProperties: false,
    },
  };
}

function failure(errorCode: string, output: string): ToolResult {
  return { ok: false, output, errorCode, truncated: false };
}

function parseArguments(raw: string, schema: ValidatedSchema): Record<string, unknown> | null {
  let args: unknown;
  try { args = JSON.parse(raw); } catch { return null; }
  if (!plainObject(args)) return null;
  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(schema.parameters.properties, name) || typeof args[name] !== 'string') return null;
  }
  for (const name of schema.parameters.required) if (!Object.hasOwn(args, name)) return null;
  return args;
}

function limitOutput(result: ToolResult): ToolResult {
  if (typeof result.output !== 'string' || typeof result.ok !== 'boolean'
    || (result.errorCode !== null && typeof result.errorCode !== 'string')
    || typeof result.truncated !== 'boolean') return failure('tool_error', 'Tool execution failed');
  if (result.output.length <= MAX_OUTPUT) return {
    ok: result.ok, output: result.output, errorCode: result.errorCode, truncated: result.truncated,
  };
  return {
    ok: result.ok, errorCode: result.errorCode,
    output: result.output.slice(0, MAX_OUTPUT - TRUNCATION_MARKER.length) + TRUNCATION_MARKER,
    truncated: true,
  };
}

export function toolsPlugin(): MiniPlugin {
  return { name: 'tools', dependencies: ['permissions'], setup(ctx) {
    const permissions = ctx.get('permissions');
    const definitions = new Map<string, Registration>();
    let closed = false;
    const remove = ctx.provide('tools', {
      register(definition) {
        if (closed) throw new Error('tools service is closed');
        const schema = parseSchema(definition);
        if (definitions.has(schema.name)) throw new Error(`tool ${schema.name} already registered`);
        const entry = { schema, execute: definition.execute };
        definitions.set(schema.name, entry);
        return () => { if (definitions.get(schema.name) === entry) definitions.delete(schema.name); };
      },
      schemas() {
        if (closed) throw new Error('tools service is closed');
        return [...definitions.values()].map(entry => copySchema(entry.schema))
          .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      },
      async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
        signal.throwIfAborted();
        if (closed) throw new Error('tools service is closed');
        const entry = definitions.get(call.name);
        if (!entry) return failure('unknown_tool', 'Unknown tool');
        const args = parseArguments(call.arguments, entry.schema);
        if (!args) return failure('invalid_arguments', 'Invalid tool arguments');
        const decision = permissions.check(call.name, args);
        if (!decision.allowed) return failure('permission_denied', 'Permission denied');
        signal.throwIfAborted();
        try {
          const result = await entry.execute(args, signal);
          signal.throwIfAborted();
          return limitOutput(result);
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error;
          return failure('tool_error', 'Tool execution failed');
        }
      },
    });
    return () => { closed = true; definitions.clear(); remove(); };
  } };
}
