import { invokeModelText, modelLoaderSingleton } from '../build/modelLoader';
import type { AgentInvocation } from '../build/agents.md/agentRegistry';
import { awaitRetrieval, getRetrievalSignal } from './retrievalContext';

export async function invokeSliceModel(invocation: AgentInvocation): Promise<string> {
  const sliceModel = modelLoaderSingleton.models?.slice;

  if (!sliceModel) {
    throw new Error('Slice model is not loaded. Please check the configuration for the slice model.');
  }

  return awaitRetrieval(() => invokeModelText(sliceModel, invocation, getRetrievalSignal()));
}
