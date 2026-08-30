import { agentRegistry } from '../../agents.md/agentRegistry';
import { assmblyAgent } from '../../agents.md/assmblyAgent';
import { invokeModelText, modelLoaderSingleton } from '../../modelLoader';
import { parseLlmJson } from '../../../helper/parseLlmJson';
import type { Community, CommunitySummaryResult } from '../types';

const buildCommunitySummaryPrompt = async (
  community: Community,
  inputContent: string,
): Promise<string> => {
  return assmblyAgent(
    {
      communityId: community.id,
      communityName: `community_${community.id}`,
      content: inputContent,
    },
    agentRegistry.communitySummary,
  );
};

export const generateCommunitySummary = async (
  community: Community,
  inputContent: string,
): Promise<CommunitySummaryResult> => {
  const sliceModel = modelLoaderSingleton.models?.slice;

  if (!sliceModel) {
    throw new Error('Slice model is not loaded. Please check the configuration for the slice model.');
  }

  const prompt = await buildCommunitySummaryPrompt(community, inputContent);
  const response = await invokeModelText(sliceModel, prompt);
  const summary = parseLlmJson<Partial<CommunitySummaryResult>>(response);

  if (typeof summary.communityName !== 'string' || typeof summary.summaryContent !== 'string') {
    throw new Error(`Invalid community summary response for community ${community.id}: ${response}`);
  }

  return {
    communityName: summary.communityName,
    summaryContent: summary.summaryContent,
  };
};
