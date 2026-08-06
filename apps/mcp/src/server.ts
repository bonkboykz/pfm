import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Dispatch } from './dispatch.js';
import { tools } from './tools.js';

/**
 * Builds an McpServer with every PFM tool registered against the given dispatch.
 *
 * Tool results carry the route's JSON body verbatim: the REST layer already
 * emits both `*Cents` and `*Formatted` money fields, so no second renderer.
 */
export function createMcpServer(dispatch: Dispatch): McpServer {
  const server = new McpServer({ name: 'pfm', version: '0.4.0' });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>) => {
        try {
          const { status, body } = await dispatch(
            tool.method,
            tool.path(args ?? {}),
            tool.body ? tool.body(args ?? {}) : undefined,
          );
          return {
            isError: status >= 400,
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: { code: 'INTERNAL_ERROR', message, suggestion: 'Check the API server logs' },
                }),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}
