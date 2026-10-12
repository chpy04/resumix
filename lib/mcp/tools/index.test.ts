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

test('the registry serves the library and application tools, in this order', () => {
  assert.deepEqual(
    TOOLS.map((t) => t.name),
    [
      'ping',
      'get_library',
      'list_applications',
      'get_application',
      'create_application',
      'set_resume_selection',
    ],
  );
});

test('every input rejects unknown keys', () => {
  // `z.strictObject` (.claude/rules/mcp.md): a misspelt key is an error.
  for (const tool of TOOLS) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
});

test('a tool that acts on one application takes it as a required application_id (C1)', () => {
  for (const tool of TOOLS) {
    const properties = Object.keys((tool.inputSchema.properties ?? {}) as object);
    const named = properties.filter((p) => /application/.test(p));
    if (named.length === 0) continue;
    assert.deepEqual(named, ['application_id'], tool.name);
    assert.ok((tool.inputSchema.required as string[]).includes('application_id'), tool.name);
  }
});
