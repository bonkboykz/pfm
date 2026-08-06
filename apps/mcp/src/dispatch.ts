export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface DispatchResult {
  /** HTTP status returned by the route. >= 400 marks the tool result as an error. */
  status: number;
  /** Parsed JSON body, or the raw text when the response was not JSON. */
  body: unknown;
}

/**
 * Performs one call against the PFM REST surface.
 *
 * This is the only seam between the MCP tool table and the API. Production
 * wiring routes into an in-process Hono app; tests pass a recorder.
 */
export type Dispatch = (method: HttpMethod, path: string, body?: unknown) => Promise<DispatchResult>;
