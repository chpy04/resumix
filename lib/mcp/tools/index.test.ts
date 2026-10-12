/**
 * Rules every registered tool keeps, checked once here so a later tool
 * cannot quietly break them. No database: this only inspects the registry.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS } from './index.ts';

test('tool names are unique snake_case', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, `duplicate tool name in ${names.join(', ')}`);
  for (const name of names) assert.match(name, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
});

test('every tool has a description', () => {
  // D1: the description is how the agent knows when to reach for the tool.
  for (const tool of TOOLS) assert.ok(tool.description.trim().length > 0, tool.name);
});

test('every input schema is an object schema without $schema', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(!('$schema' in tool.inputSchema), tool.name);
  }
});
