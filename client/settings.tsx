import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { usePaseo, useSettings, type PluginSurfaceProps, type SettingsState } from '@getpaseo/plugin/client';
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from '@getpaseo/plugin/client/ui';
import { jiraSettings, type Mapping } from '../shared/settings.ts';
import { beginProjectEdit, prepareProjectSave, type ProjectDraft } from './editor.ts';

type ReadySettings = Extract<SettingsState<typeof jiraSettings.schema>, { status: 'ready' }>;

function ProjectEditor({ projectId, settings, theme, layout }: PluginSurfaceProps & { projectId: string; settings: ReadySettings }) {
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = draft ?? beginProjectEdit(settings.values, settings.revision, projectId);
  function change(mappings: Mapping[]) {
    setMessage(null);
    setDraft({ ...current, mappings });
  }
  async function save() {
    setMessage(null);
    try {
      const write = prepareProjectSave(current);
      if (await settings.save(write.values, write.revision)) {
        setDraft(null);
        setMessage('Mappings saved. All worktrees of this project use these settings.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check your mappings and try again.');
    }
  }
  const inputStyle = { color: theme.colors.foreground, backgroundColor: theme.colors.surface0, padding: 12, borderRadius: 8, fontSize: 14 };
  return (
    <SettingsSection title="Ticket mappings">
      <Text style={{ color: theme.colors.foregroundMuted }}>Add literal prefixes such as IC and an HTTPS URL containing {'{ticket}'}. Changing project discards unsaved edits.</Text>
      {current.mappings.length === 0 && <Text style={{ color: theme.colors.foregroundMuted }}>No mappings yet. Jira actions are hidden for this project.</Text>}
      {current.mappings.map((mapping, index) => (
        <SettingsCard key={index}>
          <SettingsRow label={`Prefix ${index + 1}`} hint="Letters, digits and underscores; start with a letter.">
            <TextInput accessibilityLabel={`Ticket prefix ${index + 1}`} value={mapping.prefix} editable={!settings.saving} autoCapitalize="characters" autoCorrect={false} placeholder="IC" placeholderTextColor={theme.colors.foregroundMuted} style={inputStyle}
              onChangeText={prefix => change(current.mappings.map((row, i) => i === index ? { ...row, prefix } : row))} />
          </SettingsRow>
          <SettingsRow label="HTTPS URL template" hint="Place {ticket} in the path or query.">
            <TextInput accessibilityLabel={`Jira URL template ${index + 1}`} value={mapping.urlTemplate} editable={!settings.saving} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://jira.example.com/browse/{ticket}" placeholderTextColor={theme.colors.foregroundMuted} style={inputStyle}
              onChangeText={urlTemplate => change(current.mappings.map((row, i) => i === index ? { ...row, urlTemplate } : row))} />
          </SettingsRow>
          <SettingsAction label={`Mapping ${index + 1}`} actionLabel="Remove" disabled={settings.saving} onPress={() => change(current.mappings.filter((_, i) => i !== index))} />
        </SettingsCard>
      ))}
      <SettingsCard>
        <SettingsAction label="Another ticket prefix" actionLabel="Add mapping" disabled={settings.saving} onPress={() => change([...current.mappings, { prefix: '', urlTemplate: '' }])} />
        <SettingsAction label={settings.saving ? 'Saving mappings…' : 'Save project mappings'} actionLabel="Save" disabled={!draft || settings.saving} onPress={() => { void save(); }} />
        <SettingsAction label="Discard edits and reload saved mappings" actionLabel="Reload" disabled={settings.saving} onPress={() => { setDraft(null); setMessage(null); void settings.reload(); }} />
      </SettingsCard>
      {(message || settings.saveError) && <Text accessibilityRole="alert" style={{ color: theme.colors.foreground, paddingVertical: layout.compact ? 8 : 12 }}>{message ?? settings.saveError}</Text>}
    </SettingsSection>
  );
}

export function JiraSettingsScreen(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const paseo = usePaseo();
  const settings = useSettings(jiraSettings);
  const [projects, setProjects] = useState<{ label: string; value: string }[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadingProjects(true);
    setProjectError(null);
    void paseo.projects.list().then(result => {
      if (!active) return;
      setProjects(result.projects.map(project => ({
        value: project.projectId,
        label: `${project.projectCustomName || project.projectDisplayName} · ${project.projectRootPath}`,
      })));
      setLoadingProjects(false);
    }).catch(() => {
      if (active) { setProjectError('Could not load Paseo projects. Try again.'); setLoadingProjects(false); }
    });
    return () => { active = false; };
  }, [paseo, reload]);
  const foreground = { color: theme.colors.foreground };
  return (
    <View style={{ gap: layout.compact ? 16 : 24, padding: layout.compact ? 12 : 16, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ ...foreground, fontSize: 20, fontWeight: '600' }}>Jira Tickets</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>Choose a Paseo project. Its worktrees share these mappings; other projects have their own settings.</Text>
      <SettingsSection title="Paseo project">
        <SettingsCard>
          <SettingsSelect label="Project" value={projectId} options={[{ label: 'Choose a project', value: '' }, ...projects]} onValueChange={setProjectId} disabled={loadingProjects || settings.saving} />
          <SettingsAction label="Refresh project list" actionLabel="Refresh" disabled={loadingProjects} onPress={() => setReload(value => value + 1)} />
        </SettingsCard>
        {loadingProjects && <Text style={foreground}>Loading projects…</Text>}
        {projectError && <Text accessibilityRole="alert" style={foreground}>{projectError}</Text>}
        {!loadingProjects && !projectError && projects.length === 0 && <Text style={foreground}>No Paseo projects yet. Open a project, then refresh this list.</Text>}
      </SettingsSection>
      {settings.status === 'loading' && <Text style={foreground}>Loading Jira settings…</Text>}
      {(settings.status === 'error' || settings.status === 'invalid') && <SettingsCard>
        <SettingsRow label="Could not load Jira settings" error={settings.error} />
        <SettingsAction label="Read saved settings again" actionLabel="Retry" onPress={() => { void settings.reload(); }} />
        {settings.status === 'invalid' && <SettingsAction label="Reset all project mappings to empty" hint="This deletes the invalid saved mappings for every project." actionLabel="Reset mappings" disabled={settings.saving} onPress={() => { void settings.reset(); }} />}
        {settings.saveError && <SettingsRow label="Settings error" error={settings.saveError} />}
      </SettingsCard>}
      {settings.status === 'ready' && projectId && projects.some(project => project.value === projectId) && <ProjectEditor key={projectId} {...props} projectId={projectId} settings={settings} />}
    </View>
  );
}
