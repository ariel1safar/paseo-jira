import type { PluginServerContext } from '@getpaseo/plugin/server';
import { jiraSettings } from './shared/settings.ts';

export default function contribute(server: PluginServerContext) {
  server.registerSettings(jiraSettings);
  return () => {};
}
