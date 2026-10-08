import type { PluginClientContext } from '@getpaseo/plugin/client';
import type { PaseoWorkspaceListResult } from '@getpaseo/client';
import { settingsRpc } from '@getpaseo/plugin';
import { jiraSettings, settingsSchema } from '../shared/settings.ts';
import type { JiraController, Workspace } from './controller.ts';

type Schedule = (callback: () => void, delay: number) => () => void;
const scheduleRetry: Schedule = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};

export function watchJira(
  client: Pick<PluginClientContext, 'paseo' | 'rpc'>,
  controller: JiraController,
  schedule: Schedule = scheduleRetry,
) {
  let disposed = false;
  let generation = 0;
  let snapshotVersion = 0;
  let readVersion = 0;
  let retryDelay = 1000;
  let cancelRetry: (() => void) | undefined;
  let cleanups: (() => void)[] = [];
  const active = (version: number) => !disposed && version === generation;
  function release() {
    for (const cleanup of cleanups.splice(0)) cleanup();
  }
  function own(subscription: { release(): Promise<void> }) {
    cleanups.push(() => { void subscription.release().catch(() => {}); });
  }
  function retry(version: number) {
    if (!active(version)) return;
    generation++;
    snapshotVersion++;
    readVersion++;
    release();
    controller.setSettings({ status: 'error', error: 'Could not load Jira settings or workspace details. Reconnecting; please try again.' });
    controller.replace([]);
    cancelRetry = schedule(() => { cancelRetry = undefined; start(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }
  function readSettings(version: number) {
    const read = ++readVersion;
    controller.setSettings({ status: 'loading' });
    void client.rpc(settingsRpc(jiraSettings.id).read, {}).then(result => {
      if (!active(version) || read !== readVersion) return;
      if (result.status === 'invalid') {
        controller.setSettings({ status: 'error', error: 'Jira settings are invalid. Open Jira Tickets settings to recover them.' });
        return;
      }
      const parsed = settingsSchema.safeParse(result.values);
      controller.setSettings(parsed.success
        ? { status: 'ready', values: parsed.data }
        : { status: 'error', error: 'Jira settings are invalid. Open Jira Tickets settings to correct them.' });
    }).catch(() => { if (read === readVersion) retry(version); });
  }
  function start() {
    if (disposed) return;
    const version = ++generation;
    controller.setSettings({ status: 'loading' });
    // Events are established before the first read; each reconnect snapshot rereads this installation.
    try {
      const events = client.paseo.observeEvents(['status.plugin_settings_changed']);
      own(events);
      cleanups.push(events.subscribe({
        snapshot: () => { if (active(version)) readSettings(version); },
        update(message) {
          if (active(version) && message.type === 'status' && message.payload.status === 'plugin_settings_changed' && message.payload.settingsId === jiraSettings.id) readSettings(version);
        },
        error: () => retry(version),
      }));
      void events.ready.catch(() => retry(version));
    } catch { retry(version); return; }
    if (!active(version)) return;
    void client.paseo.workspaces.list({ subscribe: {}, page: { limit: 200 } }).then(({ subscription }) => {
      if (!active(version)) { void subscription.release().catch(() => {}); return; }
      own(subscription);
      let pendingChanges: Map<string, Workspace | null> | undefined;
      async function snapshot(first: PaseoWorkspaceListResult) {
        const snapshot = ++snapshotVersion;
        const changes = new Map<string, Workspace | null>();
        pendingChanges = changes;
        controller.replace([]);
        const current = () => active(version) && snapshot === snapshotVersion;
        const collected = new Map(first.entries.map(workspace => [workspace.id, workspace]));
        let page = first;
        const cursors = new Set<string>();
        try {
          while (page.pageInfo.hasMore) {
            const cursor = page.pageInfo.nextCursor;
            if (!cursor || cursors.has(cursor)) throw new Error('Invalid workspace pagination cursor');
            cursors.add(cursor);
            page = await client.paseo.workspaces.list({ page: { limit: 200, cursor } });
            if (!current()) return;
            for (const workspace of page.entries) collected.set(workspace.id, workspace);
          }
          if (!current()) return;
          // Live updates win over pages that were in flight, including tombstones for removals.
          const merged = new Map<string, Workspace>(collected);
          for (const [id, workspace] of changes) {
            if (workspace) merged.set(id, workspace);
            else merged.delete(id);
          }
          pendingChanges = undefined;
          controller.replace([...merged.values()]);
          retryDelay = 1000;
        } catch { if (current()) retry(version); }
      }
      cleanups.push(subscription.subscribe({
        snapshot(first) { if (active(version)) void snapshot(first); },
        update(message) {
          if (!active(version) || message.type !== 'workspace_update') return;
          const update = message.payload;
          if (update.kind === 'remove') {
            pendingChanges?.set(update.id, null);
            controller.remove(update.id);
          } else {
            pendingChanges?.set(update.workspace.id, update.workspace);
            controller.upsert(update.workspace);
          }
        },
        error: () => retry(version),
      }));
    }).catch(() => retry(version));
  }
  start();
  return () => {
    disposed = true;
    generation++;
    snapshotVersion++;
    readVersion++;
    cancelRetry?.();
    release();
    controller.dispose();
  };
}
