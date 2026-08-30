import { file } from 'bun';

import { agentRegistry, type AgentTemplateEntry, type AgentTemplateName } from './agentRegistry';

export type AgentInput = string | Record<string, string | number | boolean | null | undefined>;

const resolveTemplateEntry = (templateName: AgentTemplateName): AgentTemplateEntry => {
  if (typeof templateName === 'string') {
    return agentRegistry[templateName as keyof typeof agentRegistry];
  }

  return templateName;
};

export const assmblyAgent = async (
  input: AgentInput,
  templateName: AgentTemplateName = 'ragSliceAgent',
): Promise<string> => {
  const { file: templateFile, dir: templateDir } = resolveTemplateEntry(templateName);
  const template = await file(new URL(`${templateDir}/${templateFile}`, import.meta.url)).text();

  if (typeof input === 'string') {
    return template.replace(/<input_content\s*\/?>/g, input);
  }

  return template
    .replace(/\$\{input\.([A-Za-z0-9_]+)\}/g, (_, key: string) => {
      const value = input[key];
      return value === undefined || value === null ? '' : String(value);
    })
    .replace(/<input_content\s*\/?>/g, String(input.content ?? ''));
};