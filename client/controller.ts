import type { PluginButton, PluginButtonRegistration, PluginClientContext } from '@getpaseo/plugin/client';
import type { JiraSettings } from '../shared/settings.ts';
import { detectTickets, hasMappings, manualTicket, type Ticket, type TicketWorkspace } from '../shared/resolver.ts';

export type Workspace = TicketWorkspace & { id: string };
export type SettingsState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; values: JiraSettings };
interface Ports {
  addHeaderButton: PluginClientContext['addHeaderButton'];
  openExternalUrl(url: string): Promise<void>;
}

export function createController(ports: Ports) {
  let disposed = false;
  let settings: SettingsState = { status: 'loading' };
  const workspaces = new Map<string, Workspace>();
  const registrations = new Map<string, PluginButtonRegistration>();
  const destinations = new Map<string, Ticket[]>();

  async function open(ticket: Ticket) {
    try {
      // Invoke in this synchronous stack, before the first await preserves user activation.
      await ports.openExternalUrl(ticket.url);
    } catch {
      throw new Error(`Could not open ${ticket.key} in your browser. Please try again.`);
    }
  }
  function action(id: string, ticket: Ticket) {
    return () => {
      if (disposed || !destinations.get(id)?.some(current => current.key === ticket.key && current.url === ticket.url)) {
        throw new Error('Jira ticket changed or is no longer available. Choose the current header action.');
      }
      return open(ticket);
    };
  }
  function refresh(id: string) {
    const workspace = workspaces.get(id);
    const tickets = workspace && settings.status === 'ready' ? detectTickets(workspace, settings.values) : [];
    destinations.set(id, tickets);
    if (!tickets.length) {
      registrations.get(id)?.remove();
      registrations.delete(id);
      return;
    }
    const button: PluginButton = {
      title: tickets.length === 1 ? `Open ${tickets[0].key} in Jira` : 'Open Jira ticket',
      icon: 'Ticket',
      label: tickets.length === 1 ? tickets[0].key : `Jira (${tickets.length})`,
      behavior: tickets.length === 1
        ? { kind: 'action', onPress: action(id, tickets[0]) }
        : { kind: 'menu', items: tickets.map((ticket, index) => ({
          kind: 'item', id: `ticket-${index}`, title: ticket.key, icon: 'ExternalLink',
          behavior: { kind: 'action', onPress: action(id, ticket) },
        })) },
    };
    const registration = registrations.get(id);
    if (registration) registration.update(button);
    else registrations.set(id, ports.addHeaderButton({ id: 'jira', workspaceId: id, button }));
  }
  function remove(id: string) {
    registrations.get(id)?.remove();
    registrations.delete(id);
    destinations.delete(id);
    workspaces.delete(id);
  }
  return {
    setSettings(next: SettingsState) {
      if (disposed) return;
      settings = next;
      for (const id of workspaces.keys()) refresh(id);
    },
    upsert(workspace: Workspace) {
      if (disposed) return;
      workspaces.set(workspace.id, workspace);
      refresh(workspace.id);
    },
    replace(next: Workspace[]) {
      if (disposed) return;
      const ids = new Set(next.map(workspace => workspace.id));
      for (const id of workspaces.keys()) if (!ids.has(id)) remove(id);
      for (const workspace of next) workspaces.set(workspace.id, workspace);
      for (const id of ids) refresh(id);
    },
    remove,
    submit(id: string, args: string): Promise<void> {
      if (disposed) throw new Error('Jira Tickets is no longer available.');
      if (settings.status === 'loading') throw new Error('Jira settings are loading. Please try again.');
      if (settings.status === 'error') throw new Error(settings.error);
      const workspace = workspaces.get(id);
      if (!workspace) throw new Error('Workspace details are loading or unavailable. Please try again.');
      const input = args.trim();
      if (input) return open(manualTicket(input, workspace.projectId, settings.values));
      if (!hasMappings(workspace.projectId, settings.values)) throw new Error('Configure Jira Tickets mappings for this project in plugin settings.');
      const tickets = destinations.get(id) ?? [];
      if (!tickets.length) throw new Error('No configured Jira ticket was found in this workspace branch, title or name. Use /jira KEY.');
      if (tickets.length > 1) throw new Error('Multiple Jira tickets found. Choose one from the header menu or use an explicit /jira KEY.');
      return open(tickets[0]);
    },
    dispose() {
      disposed = true;
      for (const id of workspaces.keys()) remove(id);
    },
  };
}
export type JiraController = ReturnType<typeof createController>;
