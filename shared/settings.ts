import { defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';

export function validateTemplate(template: string): string | undefined {
  if (/[\s\\]/u.test(template)) return 'Use an HTTPS URL without whitespace or backslashes.';
  // Examine the raw components before URL normalization can escape braces.
  const parts = /^https:\/\/([^/?#]+)([^#]*)(?:#(.*))?$/i.exec(template);
  if (!parts || parts[1].includes('{ticket}') || parts[3]?.includes('{ticket}') || !parts[2].includes('{ticket}')) {
    return 'Use an HTTPS URL with {ticket} in its path or query, never its host or fragment.';
  }
  try {
    new URL(template.replaceAll('{ticket}', 'IC-1'));
    if (parts[1].includes('@')) {
      return 'Use an HTTPS URL without credentials.';
    }
  } catch {
    return 'Enter a valid HTTPS URL template.';
  }
  return undefined;
}

export const mappingSchema = z.object({
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*$/, 'Prefix must start with a letter and contain only letters, digits or underscores.'),
  urlTemplate: z.string().trim().superRefine((value, ctx) => {
    const error = validateTemplate(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  }),
});
const mappingsSchema = z.array(mappingSchema).superRefine((mappings, ctx) => {
  const seen = new Set<string>();
  mappings.forEach(({ prefix }, index) => {
    if (seen.has(prefix)) ctx.addIssue({ code: 'custom', path: [index, 'prefix'], message: `Duplicate prefix ${prefix} in this project.` });
    seen.add(prefix);
  });
});
export const settingsSchema = z.object({
  projects: z.record(z.string(), mappingsSchema).default({}),
});
export type JiraSettings = z.infer<typeof settingsSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export const jiraSettings = defineSettings({ id: 'jira', scope: 'host', version: 1, schema: settingsSchema });
