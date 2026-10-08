import { settingsSchema, type JiraSettings, type Mapping } from '../shared/settings.ts';

export interface ProjectDraft {
  base: JiraSettings;
  revision: string;
  projectId: string;
  mappings: Mapping[];
}
export function beginProjectEdit(values: JiraSettings, revision: string, projectId: string): ProjectDraft {
  const base = settingsSchema.parse(values);
  return { base, revision, projectId, mappings: (Object.hasOwn(base.projects, projectId) ? base.projects[projectId] : []).map(mapping => ({ ...mapping })) };
}
export function prepareProjectSave(draft: ProjectDraft) {
  return {
    revision: draft.revision,
    values: settingsSchema.parse({ projects: { ...draft.base.projects, [draft.projectId]: draft.mappings } }),
  };
}
