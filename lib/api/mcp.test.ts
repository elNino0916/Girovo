import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeDesktopConfig } from './mcp.ts';

test('the Claude Desktop snippet names the helper as its command, as valid JSON', () => {
  const windows = 'C:\\Users\\nino\\AppData\\Local\\Girovo Next\\girovo-mcp.exe';
  const text = claudeDesktopConfig(windows);
  assert.deepEqual(JSON.parse(text), { mcpServers: { girovo: { command: windows } } });
  assert.ok(text.includes('C:\\\\Users\\\\nino'), 'backslashes doubled, as JSON wants them');
  assert.deepEqual(JSON.parse(claudeDesktopConfig('/usr/bin/girovo-mcp')).mcpServers.girovo, { command: '/usr/bin/girovo-mcp' });
});
