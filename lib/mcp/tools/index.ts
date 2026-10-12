/**
 * Every tool `/api/mcp` serves, in `tools/list` order. A new tool is one
 * module here, one entry below, one row in docs/API.md's tool reference, and
 * a test (.claude/rules/mcp.md).
 */
import type { McpTool } from '../tool.ts';
import { ping } from './ping.ts';

export const TOOLS: readonly McpTool[] = [ping];
