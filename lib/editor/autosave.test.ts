import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineStatuses, createAutosave, type SaveStatus } from './autosave.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once `predicate()` is true, polling frequently. Avoids coupling
 *  tests to exact timer ordering beyond what the debounce itself implies. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await wait(5);
  }
}

test('immediate (debounceMs=0): a single schedule() sends right away', async () => {
  const calls: number[] = [];
  const statuses: SaveStatus[] = [];
  const autosave = createAutosave<number>({
    save: async (value) => {
      calls.push(value);
    },
    onStatusChange: (status) => statuses.push(status),
  });

  autosave.schedule(1);
  await waitFor(() => calls.length === 1);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(statuses, ['saving', 'saved']);
});

test('immediate mode coalesces bursts: only the latest value is ever sent, never in parallel', async () => {
  const calls: number[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const autosave = createAutosave<number>({
    save: async (value) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await wait(20);
      calls.push(value);
      concurrent -= 1;
    },
  });

  // Fire a burst synchronously, faster than the in-flight save can resolve.
  autosave.schedule(1);
  autosave.schedule(2);
  autosave.schedule(3);

  await waitFor(() => calls.length === 2, 2000);
  // First send picks up 1 (whatever was pending at the moment `run` started),
  // then the trailing edge sends the latest (3), never 2 (superseded before
  // it was ever sent) and never more than one request at a time.
  assert.deepEqual(calls, [1, 3]);
  assert.equal(maxConcurrent, 1);
});

test('debounced mode (debounceMs>0) only sends once after the burst settles', async () => {
  const calls: number[] = [];
  const autosave = createAutosave<string>({
    save: async (value) => {
      calls.push(value.length);
    },
    debounceMs: 30,
  });

  autosave.schedule('a');
  await wait(5);
  autosave.schedule('ab');
  await wait(5);
  autosave.schedule('abc');

  // Not sent yet — still within the debounce window.
  assert.deepEqual(calls, []);

  await waitFor(() => calls.length === 1, 2000);
  assert.deepEqual(calls, [3]);
});

test('a failed save reports status "error" and does not silently disappear', async () => {
  const statuses: Array<{ status: SaveStatus; message?: string }> = [];
  const autosave = createAutosave<number>({
    save: async () => {
      throw new Error('network down');
    },
    onStatusChange: (status, message) => statuses.push({ status, message }),
  });

  autosave.schedule(1);
  await waitFor(() => statuses.some((s) => s.status === 'error'));
  assert.deepEqual(statuses, [
    { status: 'saving', message: undefined },
    { status: 'error', message: 'network down' },
  ]);
});

test('retry() resends the last-failed value and can succeed', async () => {
  let attempt = 0;
  const calls: number[] = [];
  const statuses: SaveStatus[] = [];
  const autosave = createAutosave<number>({
    save: async (value) => {
      attempt += 1;
      calls.push(value);
      if (attempt === 1) throw new Error('first attempt fails');
    },
    onStatusChange: (status) => statuses.push(status),
  });

  autosave.schedule(42);
  await waitFor(() => statuses.includes('error'));

  autosave.retry();
  await waitFor(() => statuses.filter((s) => s === 'saved').length === 1);

  assert.deepEqual(calls, [42, 42]);
  assert.deepEqual(statuses, ['saving', 'error', 'saving', 'saved']);
});

test('retry() with nothing pending and nothing failed is a harmless no-op', async () => {
  const calls: number[] = [];
  const autosave = createAutosave<number>({ save: async (v) => void calls.push(v) });
  autosave.retry();
  await wait(20);
  assert.deepEqual(calls, []);
});

test('scheduling a fresh value after a failure supersedes the failed one rather than losing it', async () => {
  let calls: number[] = [];
  let shouldFail = true;
  const statuses: SaveStatus[] = [];
  const autosave = createAutosave<number>({
    save: async (value) => {
      calls.push(value);
      if (shouldFail) throw new Error('boom');
    },
    onStatusChange: (status) => statuses.push(status),
  });

  autosave.schedule(1);
  await waitFor(() => statuses.includes('error'));

  shouldFail = false;
  autosave.schedule(2);
  await waitFor(() => statuses.filter((s) => s === 'saved').length === 1);

  assert.deepEqual(calls, [1, 2]);
});

test('combineStatuses: any "saving" takes priority over everything else', () => {
  assert.equal(combineStatuses(['saved', 'saving', 'error']), 'saving');
});

test('combineStatuses: an error is surfaced unless something is actively saving', () => {
  assert.equal(combineStatuses(['saved', 'error']), 'error');
});

test('combineStatuses: all saved is "saved"', () => {
  assert.equal(combineStatuses(['saved', 'saved']), 'saved');
});

test('combineStatuses: nothing has ever run is "idle"', () => {
  assert.equal(combineStatuses(['idle', 'idle']), 'idle');
  assert.equal(combineStatuses([]), 'idle');
});
