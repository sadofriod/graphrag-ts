import { describe, expect, it } from 'bun:test';

import { agentRegistry } from './agentRegistry';
import { assmblyAgent } from './assmblyAgent';

describe('assmblyAgent', () => {
  it('replaces the input placeholder with the provided content', async () => {
    const result = await assmblyAgent('This is a test input');

    expect(result).toContain('This is a test input');
    expect(result).not.toContain('<input_content/>');
  });

  it('loads templates through the typed registry constant', async () => {
    expect(agentRegistry.ragSliceAgent.file).toBe('ragSliceAgent.md');
    expect(agentRegistry.communitySummary.file).toBe('communitySummary.agent.md');
    expect(agentRegistry.ragSliceAgent.dir).toBe('./');

    const result = await assmblyAgent({ content: 'This is a registry input' }, agentRegistry.ragSliceAgent);
    expect(result).toContain('This is a registry input');
  });
});
