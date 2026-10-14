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

test('the registry serves the library, application and apply tools, in this order', () => {
  assert.deepEqual(
    TOOLS.map((t) => t.name),
    [
      'ping',
      'get_library',
      'get_saved_answers',
      'list_applications',
      'get_application',
      'get_apply_packet',
      'create_application',
      'add_questions',
      'set_resume_selection',
      'suggest_bullet',
      'set_cover_letter_body',
      'submit_for_review',
      'report_question',
      'mark_applied',
    ],
  );
});

test('no tool approves anything: approval happens only in the UI', () => {
  // The board's NOT EXPOSED list (.claude/rules/mcp.md).
  for (const tool of TOOLS) assert.doesNotMatch(tool.name, /^approve_/, tool.name);
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

/** Valid apart from the empty company. */
const CREATE_ARGS = {
  company: '',
  role_title: 'Engineer',
  posting_url: 'https://jobs.example.test/1',
  job_description: 'Build.',
  agent_summary: 'Fits.',
};

test('create_application advertises no multipleOf, and still holds fit_score to one decimal', async () => {
  const tool = TOOLS.find((t) => t.name === 'create_application');
  assert.ok(tool);
  const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.fit_score?.multipleOf, undefined, JSON.stringify(properties.fit_score));
  assert.ok(!JSON.stringify(TOOLS.map((t) => t.inputSchema)).includes('multipleOf'));

  // An empty company fails validation alongside the score, so no call ever
  // reaches the database; the issue list then shows what fit_score made of it.
  const issuesFor = async (fit_score: number) => {
    const result = await tool.call({ userId: 'nobody' }, { ...CREATE_ARGS, fit_score });
    assert.equal(result.isError, true);
    return result.content[0]?.text ?? '';
  };
  for (let tenths = 0; tenths <= 50; tenths++) {
    const score = tenths / 10;
    assert.doesNotMatch(await issuesFor(score), /fit_score/, String(score));
  }
  for (const score of [4.25, 0.05, 3.333]) {
    assert.match(
      await issuesFor(score),
      /fit_score: must have at most one decimal place, e.g\. 4\.3/,
      String(score),
    );
  }
});
