import { run } from 'node:test';
import { writeSync } from 'node:fs';

let summary = null;
const counts = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
function errorDetails(_key, value) {
  if (!(value instanceof Error)) return value;
  return {
    ...value,
    name: value.name,
    message: value.message,
    stack: value.stack,
    ...('cause' in value ? { cause: value.cause } : {}),
  };
}
try {
  const stream = run({ files: [process.argv[2]], isolation: 'none' });
  for await (const event of stream) {
    if (event.type === 'test:summary') summary = event.data;
    if (event.type === 'test:complete' && event.data.details?.type === 'test'
      && !(event.data.name === process.argv[2] && event.data.line === 1 && event.data.column === 1)) {
      counts.tests++;
      if (event.data.skip) counts.skipped++;
      else if (event.data.todo) counts.todo++;
      else if (event.data.details.passed) counts.passed++;
      else counts.failed++;
      if (event.data.details.error?.code === 'ERR_TEST_FAILURE' && event.data.details.error?.failureType === 'cancelledByParent') counts.cancelled++;
    }
    await new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify(event, errorDetails)}\n`, error => error ? reject(error) : resolve());
    });
  }
  if (summary !== null) {
    writeSync(3, `${JSON.stringify({ kind: 'summary', summary: { success: summary.success, counts } })}\n`);
    if (!summary.success) process.exitCode = 1;
  } else {
    writeSync(3, `${JSON.stringify({ kind: 'missing-summary' })}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeSync(3, `${JSON.stringify({ kind: 'worker-error', message })}\n`);
  process.exitCode = 1;
}
