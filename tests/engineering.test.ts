import assert from 'node:assert/strict';
import test from 'node:test';

test('TypeScript tests execute through tsx', () => {
  const fixture: { nodeMajor: number } = { nodeMajor: Number(process.versions.node.split('.')[0]) };
  assert.equal(fixture.nodeMajor, 24);
});

// This function is type-checked by tsc but never executed by the test runner.
function strictOnlyCompileChecks() {
  // @ts-expect-error strictNullChecks rejects undefined as a string.
  const invalidString: string = undefined;
  // @ts-expect-error noImplicitAny rejects an untyped parameter.
  function invalidParameter(value) {
    return value;
  }
  return [invalidString, invalidParameter];
}
void strictOnlyCompileChecks;
