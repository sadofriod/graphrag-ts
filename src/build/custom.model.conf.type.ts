export enum CustomModelConfigType {
  slice = 'slice',
  judge = 'judge',
  embedding = 'embedding',
}

export interface CustomModelConfig {
  baseURL: string;
  model: string;
  apiKey: string;
  type: CustomModelConfigType;
}
