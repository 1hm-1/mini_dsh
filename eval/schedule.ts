import { readFileSync } from 'node:fs';
import type { Variant } from '../src/types.js';
import { parseTaskId } from './task.js';
import type { ScheduleEntry } from './contracts.js';

export function buildSchedule(taskIds: readonly string[], variants: readonly Variant[], repeats: number): ScheduleEntry[] {
  if (!Array.isArray(taskIds) || taskIds.length === 0) throw new Error('schedule taskIds: expected nonempty list');
  if (!Array.isArray(variants) || variants.length === 0) throw new Error('schedule variants: expected nonempty list');
  if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('schedule repeats: expected positive integer');
  const tasks = Array.from(taskIds, id => parseTaskId(id, 'schedule taskId'));
  if (new Set(tasks).size !== tasks.length) throw new Error('schedule taskIds: duplicate');
  const spec = JSON.parse(readFileSync(new URL('../specs/variants.json', import.meta.url), 'utf8')) as { order: Variant[] };
  const requested = Array.from(variants);
  if (new Set(requested).size !== requested.length || requested.some(variant => !spec.order.includes(variant))) {
    throw new Error('schedule variants: invalid or duplicate');
  }
  const selected = spec.order.filter(variant => requested.includes(variant));
  tasks.sort();
  const entries: ScheduleEntry[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const [taskIndex, taskId] of tasks.entries()) {
      for (let offset = 0; offset < selected.length; offset++) {
        entries.push({ taskId, variant: selected[(taskIndex + repeat - 1 + offset) % selected.length]!, repeat, orderIndex: entries.length });
      }
    }
  }
  return entries;
}
