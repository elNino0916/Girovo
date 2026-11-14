// Girovo MCP (src-tauri/mcp-helper, docs/girovo-api.md phase 3): what
// Einstellungen → Girovo API hands the user to set up an assistant.
//
// Pure and node-test-safe.

/** The server's name in an assistant's configuration. */
export const MCP_SERVER_NAME = 'girovo';

/**
 * Claude Desktop's claude_desktop_config.json with Girovo MCP as its one
 * server: `command` is the helper's full path, written as JSON writes it (a
 * Windows path's backslashes doubled).
 */
export function claudeDesktopConfig(command: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command } } }, null, 2);
}
