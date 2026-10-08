import type { JiraSettings, Mapping } from './settings.ts';

export interface TicketWorkspace {
  projectId: string;
  name: string;
  title?: string | null;
  gitRuntime?: { currentBranch?: string | null } | null;
}
export interface Ticket { key: string; url: string }

function mappingsFor(projectId: string, values: JiraSettings): Mapping[] {
  return Object.hasOwn(values.projects, projectId) ? values.projects[projectId] : [];
}
function destination(key: string, mapping: Mapping): Ticket {
  return { key, url: mapping.urlTemplate.replaceAll('{ticket}', encodeURIComponent(key)) };
}
export function detectTickets(workspace: TicketWorkspace, values: JiraSettings): Ticket[] {
  const mappings = mappingsFor(workspace.projectId, values);
  for (const source of [workspace.gitRuntime?.currentBranch, workspace.title, workspace.name]) {
    if (!source) continue;
    const tickets = new Map<string, Ticket>();
    // Hyphens delimit branch prose; Unicode letters/numbers and underscores belong to tokens.
    const pattern = /(?<![\p{L}\p{N}_])([A-Z][A-Z0-9_]*-[0-9]+)(?![\p{L}\p{N}_])/giu;
    for (const match of source.matchAll(pattern)) {
      const key = match[1].toUpperCase();
      const prefix = key.slice(0, key.lastIndexOf('-'));
      const mapping = mappings.find(item => item.prefix === prefix);
      if (mapping) tickets.set(key, destination(key, mapping));
    }
    if (tickets.size) return [...tickets.values()];
  }
  return [];
}
export function manualTicket(input: string, projectId: string, values: JiraSettings): Ticket {
  if (!/^[A-Z][A-Z0-9_]*-[0-9]+$/i.test(input)) throw new Error('Enter one ticket key, for example /jira IC-123.');
  const mappings = mappingsFor(projectId, values);
  if (!mappings.length) throw new Error('Configure Jira Tickets mappings for this project in plugin settings.');
  const key = input.toUpperCase();
  const prefix = key.slice(0, key.lastIndexOf('-'));
  const mapping = mappings.find(item => item.prefix === prefix);
  if (!mapping) throw new Error(`No Jira URL is configured for prefix ${prefix} in this project.`);
  return destination(key, mapping);
}
export function hasMappings(projectId: string, values: JiraSettings): boolean {
  return mappingsFor(projectId, values).length > 0;
}
