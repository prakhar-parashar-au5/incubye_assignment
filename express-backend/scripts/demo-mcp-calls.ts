#!/usr/bin/env node
// Three real MCP calls (success, invalid arguments, unknown tool) so the Admin
// MCP page has recorded rows (AI Task 06).
//
//   API_BASE_URL=http://127.0.0.1:4000 DEMO_EMAIL=… DEMO_PASSWORD=… npm run demo:mcp-calls
//   (inside the deployed backend: npm run demo:mcp-calls:dist)
//
// Reads API_BASE_URL, DEMO_EMAIL, and DEMO_PASSWORD from the injected
// environment only; never reads .env files. Refuses any API_BASE_URL that is
// not https://… or http://127.0.0.1… / http://localhost…. Prints only tool
// names and statuses; never the URL, the password, or the token.
import { errorMessage } from '../src/errors.js';
import { runDemoMcpCalls } from '../src/evaluation/demo-mcp-calls.js';

try {
  const results = await runDemoMcpCalls({ apiBaseUrl: process.env.API_BASE_URL, email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD });
  for (const r of results) console.log(`${r.tool}: ${r.outcome} (expected recorded status ${r.expectedRecordedStatus})`);
} catch (error) {
  console.error(`Error: ${error instanceof Error && error.name === 'DemoMcpRefusedError' ? error.message : `MCP calls failed: ${errorMessage(error).replace(/https?:\/\/\S+/g, '<url>')}`}`);
  process.exitCode = 1;
}
