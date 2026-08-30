import { invokeModelText, modelLoaderSingleton } from '../build/modelLoader';

export async function invokeSliceModel(prompt: string): Promise<string> {
  const sliceModel = modelLoaderSingleton.models?.slice;

  if (!sliceModel) {
    throw new Error('Slice model is not loaded. Please check the configuration for the slice model.');
  }

  return invokeModelText(sliceModel, prompt);
}
