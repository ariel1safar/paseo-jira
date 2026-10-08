import { createController } from '../client/controller.ts';
export const settings = { projects: { p: [{ prefix: 'IC', urlTemplate: 'https://jira.test/{ticket}' }, { prefix: 'WEB', urlTemplate: 'https://web.test/{ticket}' }] } };
export const workspace = (id = 'w', branch = 'ic-01') => ({ id, projectId: 'p', name: 'IC-3', title: 'IC-2', gitRuntime: { currentBranch: branch } });
export function harness(opener = () => Promise.resolve()) {
  const buttons = new Map();
  const opened = [];
  const controller = createController({
    addHeaderButton({ workspaceId, button }) {
      buttons.set(workspaceId, button);
      return { update(patch) { buttons.set(workspaceId, { ...buttons.get(workspaceId), ...patch }); }, remove() { buttons.delete(workspaceId); } };
    },
    openExternalUrl(url) { opened.push(url); return opener(url); },
  });
  return { controller, buttons, opened };
}

