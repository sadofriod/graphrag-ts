import { file } from 'bun';
import {
  agentRegistry,
  type AgentInvocation,
  type AgentTemplateContract,
  type AgentTemplateName,
  type AgentTemplateInput,
} from './agentRegistry';

export type AgentInput = AgentTemplateInput;

const outputFormatInstruction = (format: AgentTemplateContract['outputFormat']): string => {
  if (format.type === 'text') {
    return '\n\nOutput format: plain text.';
  }

  return [
    '',
    '',
    'Output format: return only a JSON object matching this JSON Schema; do not include Markdown or surrounding text.',
    JSON.stringify(format.schema, null, 2),
  ].join('\n');
};

const resolveTemplateEntry = (templateName: AgentTemplateName): AgentTemplateContract => {
  if (typeof templateName === 'string') {
    return agentRegistry[templateName as keyof typeof agentRegistry];
  }

  return templateName;
};

export const assmblyAgent = async (
  input: AgentInput,
  templateName: AgentTemplateName = 'ragSliceAgent',
): Promise<AgentInvocation> => {
  const entry = resolveTemplateEntry(templateName);
  const templateLabel = typeof templateName === 'string' ? templateName : templateName.file;
  const { file: templateFile, dir: templateDir } = entry;
  const template = await file(new URL(`${templateDir}/${templateFile}`, import.meta.url)).text();

  const values = typeof input === 'string' ? { content: input } : input;
  const missingVariables = entry.inputVariables.filter((key) => values[key] === undefined || values[key] === null);
  if (missingVariables.length > 0) {
    throw new Error(`Missing ${templateLabel} input fields: ${missingVariables.join(', ')}.`);
  }

  const prompt = template
    .replace(/\$\{input\.([A-Za-z0-9_]+)\}/g, (_, key: string) => String(values[key] ?? ''))
    .replace(/<input_content\s*\/?>/g, String(values.content ?? ''));

  return {
    inputFormat: entry.inputFormat,
    prompt: `${prompt}${outputFormatInstruction(entry.outputFormat)}`,
    outputFormat: entry.outputFormat,
  };
};