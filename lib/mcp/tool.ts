/**
 * What an MCP tool is, and the one way to define one (D-040).
 *
 * A tool's input is a zod object. `defineTool` turns it into the JSON Schema
 * `tools/list` advertises, once, at module load, and erases the types, so
 * the registry is a plain `McpTool[]` and the dispatcher needs no generics.
 *
 * Every failure a tool can have is a `ToolResult` with `isError: true`,
 * never a JSON-RPC error: the model reads result text and can act on it, so
 * that text always says what to do next (C1).
 */
import { z } from 'zod';

/** Who is calling. Every tool's `run` scopes its queries by this id, as a
 *  route handler scopes by `requireUserId`. */
export interface McpContext {
  userId: string;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** MCP requires a tool's `inputSchema` to be an object schema. */
type JsonObjectSchema = { type: 'object' } & Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
  call(ctx: McpContext, rawArgs: unknown): Promise<ToolResult>;
}

export function toolText(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** `path: message`, the shape `parseJsonBody` gives an HTTP caller. */
export function describeIssue(issue: z.core.$ZodIssue): string {
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/**
 * Write inputs as `z.strictObject(...)`. It emits `additionalProperties:
 * false` and rejects unknown keys, so an agent's `applicationId` for
 * `application_id` fails loudly instead of being dropped.
 */
export function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  description: string;
  input: S;
  run: (ctx: McpContext, args: z.output<S>) => Promise<ToolResult>;
}): McpTool {
  // `$schema` is noise in `tools/list`; the client assumes 2020-12 anyway.
  const { $schema: _, ...inputSchema } = z.toJSONSchema(tool.input, { io: 'input' });

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchema as JsonObjectSchema,
    async call(ctx, rawArgs) {
      const parsed = tool.input.safeParse(rawArgs);
      if (!parsed.success) {
        // Every issue, not the first: the model fixes them all in one retry.
        const issues = parsed.error.issues.map(describeIssue).join('; ');
        return toolError(
          `Invalid arguments: ${issues}. Fix the arguments and call again; tools/list has the schema.`,
        );
      }
      return tool.run(ctx, parsed.data);
    },
  };
}
