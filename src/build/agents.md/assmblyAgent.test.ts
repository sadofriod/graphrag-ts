import { describe, expect, it } from 'bun:test';

import { agentRegistry } from './agentRegistry';
import { assmblyAgent } from './assmblyAgent';

describe('assmblyAgent', () => {
  it('replaces the input placeholder with the provided content', async () => {
    const result = await assmblyAgent('This is a test input');

    expect(result.prompt).toContain('This is a test input');
    expect(result.prompt).not.toContain('<input_content/>');
    expect(result.inputFormat).toBe('text');
    expect(result.outputFormat.type).toBe('json_object');
  });

  it('loads templates through the typed registry constant', async () => {
    expect(agentRegistry.ragSliceAgent.file).toBe('ragSliceAgent.md');
    expect(agentRegistry.communitySummary.file).toBe('communitySummary.agent.md');
    expect(agentRegistry.ragSliceAgent.dir).toBe('./');

    const result = await assmblyAgent({ content: 'This is a registry input' }, agentRegistry.ragSliceAgent);
    expect(result.prompt).toContain('This is a registry input');
  });

  it('uses the registry schema for both the prompt contract and model invocation', async () => {
    const invocation = await assmblyAgent({ query: 'Who arrived?' }, agentRegistry.queryIntent);
    if (invocation.outputFormat.type !== 'json_object') {
      throw new Error('Query intent must use a JSON output contract.');
    }
    const schemaText = JSON.stringify(invocation.outputFormat.schema, null, 2);

    expect(invocation.inputFormat).toBe(agentRegistry.queryIntent.inputFormat);
    expect(invocation.outputFormat).toBe(agentRegistry.queryIntent.outputFormat);
    expect(invocation.prompt).toContain(schemaText);
  });

  it('rejects missing required input variables', async () => {
    await expect(assmblyAgent({}, agentRegistry.queryIntent))
      .rejects.toThrow('Missing queryIntent.agent.md input fields: query.');
  });
});
