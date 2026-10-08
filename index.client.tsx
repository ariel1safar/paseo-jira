import { openExternalUrl, type PluginClientContext } from '@getpaseo/plugin/client';
import { createController } from './client/controller.ts';
import { JiraSettingsScreen } from './client/settings.tsx';
import { watchJira } from './client/watch.ts';

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({ id: 'jira', title: 'Jira Tickets', icon: 'Ticket', Component: JiraSettingsScreen });
  const controller = createController({ addHeaderButton: button => client.addHeaderButton(button), openExternalUrl });
  client.addSlashCommand({
    name: 'jira', description: 'Open a Jira ticket for this project', argumentHint: '[KEY]', context: 'workspace',
    onSubmit({ workspace, args }) {
      // Slash snapshots omit gitRuntime; the controller uses the cached SDK descriptor.
      return controller.submit(workspace.id, args);
    },
  });
  return watchJira(client, controller);
}
