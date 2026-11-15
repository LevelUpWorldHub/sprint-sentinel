import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  EmptyState,
  Heading,
  HelperMessage,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
  Toggle,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

const TYPE_LABEL = {
  stalled: 'Stalled',
  blocked: 'Blocked',
  scope_creep: 'Scope creep',
  overloaded: 'Overloaded',
  sprint_goal: 'Sprint goal',
};

function severityAppearance(severity) {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'removed';
  if (severity === 'medium') return 'inprogress';
  return 'default';
}

function fieldValue(event) {
  if (typeof event === 'string') return event;
  return event?.target?.value ?? '';
}

function toggleChecked(event) {
  if (typeof event === 'boolean') return event;
  return Boolean(event?.target?.checked);
}

function Health({ status, source }) {
  if (!status?.lastScanAt && !status?.idleReason) {
    return (
      <SectionMessage appearance="information" title="No check yet">
        <Text>Watch the project and run a check. Sprint Sentinel will keep looking on its own after that.</Text>
      </SectionMessage>
    );
  }
  if (status.lastScanOk === false) {
    return (
      <SectionMessage appearance="error" title="The last check failed">
        <Text>{status.lastError || 'The previous risk list is still available. The hourly check will try again.'}</Text>
      </SectionMessage>
    );
  }
  const grok = status.grok || {};
  const usingGrok = (source || grok.lastSource) === 'grok';
  return (
    <SectionMessage appearance={usingGrok ? 'success' : 'warning'} title={usingGrok ? 'Grok is explaining risks' : 'Rules are explaining risks'}>
      <Text>
        {usingGrok
          ? `Last check used ${grok.lastModel || 'Grok'}.`
          : grok.configured
            ? `Grok was configured but the last call failed${grok.lastError ? `: ${grok.lastError}` : '.'} Deterministic rules covered the check.`
            : 'XAI_API_KEY is not set, so nothing is sent to xAI. The rules still detect every risk type.'}
      </Text>
      {status.graph?.lastOk === false && status.graph?.lastError ? (
        <Text>Teamwork Graph was skipped: {status.graph.lastError}. Jira data was still used.</Text>
      ) : null}
      {status.digest?.lastError ? <Text>Digest: {status.digest.lastError}</Text> : null}
      {status.idleReason ? <Text>{status.idleReason}</Text> : null}
    </SectionMessage>
  );
}

function RiskCard({ risk, proposal, busy, onDecide }) {
  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={severityAppearance(risk.severity)}>{risk.severity}</Lozenge>
        <Lozenge>{TYPE_LABEL[risk.type] || risk.type}</Lozenge>
        {risk.explanation ? <Lozenge appearance={proposal?.source === 'grok' ? 'success' : 'inprogress'}>{proposal?.source === 'grok' ? 'Grok' : 'Rules'}</Lozenge> : null}
      </Inline>
      <Heading size="small">{risk.title}</Heading>
      {risk.explanation ? <Text>{risk.explanation}</Text> : null}
      <Text>{risk.fixSummary || proposal?.fixSummary || 'A fix is ready for review.'}</Text>
      {proposal ? (
        <Inline space="space.100">
          <Button appearance="primary" isDisabled={busy} onClick={() => onDecide(proposal.id, 'approve')}>
            {proposal.status === 'failed' ? 'Retry approval' : 'Approve fix'}
          </Button>
          <Button appearance="subtle" isDisabled={busy} onClick={() => onDecide(proposal.id, 'dismiss')}>Dismiss</Button>
        </Inline>
      ) : (
        <HelperMessage>This risk was already approved or dismissed. It stays quiet unless a later check sees new evidence.</HelperMessage>
      )}
      {proposal?.lastError ? <Text>Last attempt failed: {proposal.lastError}</Text> : null}
    </Stack>
  );
}

function ProjectApp({ data, setData, busy, setBusy, setError }) {
  const [tab, setTab] = useState('risks');
  const [spaceKey, setSpaceKey] = useState(data.config?.spaceKey || '');
  const [stalledDays, setStalledDays] = useState(String(data.config?.thresholds?.stalledInProgressDays || 3));
  const [overloadCount, setOverloadCount] = useState(String(data.config?.thresholds?.overloadIssueCount || 8));

  async function run(name, payload) {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke(name, { projectKey: data.projectKey, ...payload });
      setData(next);
      if (next.scanError || next.actionError || next.digestError) {
        setError(next.scanError || next.actionError || next.digestError);
      }
    } catch (error) {
      setError(error.message || 'Sprint Sentinel could not complete that action.');
    } finally {
      setBusy(false);
    }
  }

  const proposalsByRisk = new Map((data.proposals || []).map((proposal) => [proposal.riskId, proposal]));
  const risks = data.risks || [];

  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Heading size="medium">Sprint Sentinel</Heading>
        <Text>Watches {data.projectKey} for work that is stalling, blocked, growing, or overloading someone. Nothing changes until you approve it.</Text>
      </Stack>
      <Health status={data.status} source={data.source} />
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={data.watched ? 'success' : 'default'}>{data.watched ? 'Watching' : 'Not watching'}</Lozenge>
        <Text>{risks.length} open risks</Text>
        <Text>{(data.proposals || []).length} waiting</Text>
        {data.scannedAt ? <Text>Checked {data.scannedAt.slice(0, 16).replace('T', ' ')} UTC</Text> : null}
      </Inline>
      <Inline space="space.100">
        <Button appearance="primary" isDisabled={busy} onClick={() => run('scanNow')}>Watch and check</Button>
        <Button isDisabled={busy} onClick={() => run('writeDigest')}>Write digest</Button>
      </Inline>
      <Toggle
        label="Keep watching this project"
        isChecked={Boolean(data.watched)}
        isDisabled={busy}
        onChange={(event) => run('setWatch', { watch: toggleChecked(event) })}
      />
      <Inline space="space.100">
        {['risks', 'approvals', 'activity', 'settings'].map((name) => (
          <Button key={name} appearance={tab === name ? 'primary' : 'subtle'} onClick={() => setTab(name)}>
            {name[0].toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </Inline>
      {tab === 'risks' && (risks.length === 0 ? (
        <EmptyState
          header="Nothing is waiting on you"
          description="The last check found no stalled work, blockers, scope creep, overload, or a sprint goal slipping."
        />
      ) : (
        <Stack space="space.300">
          {risks.map((risk) => (
            <RiskCard
              key={risk.id}
              risk={risk}
              proposal={proposalsByRisk.get(risk.id)}
              busy={busy}
              onDecide={(proposalId, decision) => run('decide', { proposalId, decision })}
            />
          ))}
        </Stack>
      ))}
      {tab === 'approvals' && (
        <Stack space="space.200">
          {(data.proposals || []).length === 0 ? <Text>No fixes are waiting. Dismissed and applied proposals stay in the activity log.</Text> : null}
          {(data.proposals || []).map((proposal) => (
            <Stack key={proposal.id} space="space.100">
              <Inline space="space.100">
                <Lozenge appearance={proposal.status === 'failed' ? 'removed' : 'inprogress'}>{proposal.status}</Lozenge>
                <Text>{proposal.issueKey}</Text>
              </Inline>
              <Text>{proposal.fixSummary || proposal.title}</Text>
              <Inline space="space.100">
                <Button appearance="primary" isDisabled={busy} onClick={() => run('decide', { proposalId: proposal.id, decision: 'approve' })}>Approve</Button>
                <Button appearance="subtle" isDisabled={busy} onClick={() => run('decide', { proposalId: proposal.id, decision: 'dismiss' })}>Dismiss</Button>
              </Inline>
            </Stack>
          ))}
        </Stack>
      )}
      {tab === 'activity' && (
        <Stack space="space.100">
          {(data.audit || []).length === 0 ? <Text>No actions recorded yet.</Text> : null}
          {(data.audit || []).map((entry) => (
            <Text key={entry.id}>{entry.at?.slice(0, 16).replace('T', ' ')} UTC · {entry.action} · {entry.outcome} · {entry.detail}</Text>
          ))}
        </Stack>
      )}
      {tab === 'settings' && (
        <Stack space="space.150">
          <Label labelFor="space-key">Confluence space key</Label>
          <Textfield id="space-key" value={spaceKey} onChange={(event) => setSpaceKey(fieldValue(event))} />
          <HelperMessage>The daily digest is created in this space. Leave it blank to skip publishing.</HelperMessage>
          <Label labelFor="stalled-days">Days in progress before a stall</Label>
          <Textfield id="stalled-days" value={stalledDays} onChange={(event) => setStalledDays(fieldValue(event))} />
          <Label labelFor="overload-count">Open issues before someone is overloaded</Label>
          <Textfield id="overload-count" value={overloadCount} onChange={(event) => setOverloadCount(fieldValue(event))} />
          <Button
            appearance="primary"
            isDisabled={busy}
            onClick={() => run('saveSettings', {
              spaceKey,
              stalledInProgressDays: Number(stalledDays),
              overloadIssueCount: Number(overloadCount),
            })}
          >
            Save settings
          </Button>
          <HelperMessage>Approving a fix writes to Jira as you when the session allows it, and as the app otherwise. Issue summaries are sent to xAI only when an admin has set XAI_API_KEY.</HelperMessage>
        </Stack>
      )}
    </Stack>
  );
}

function IssueApp({ data, setData, busy, setBusy, setError }) {
  async function run(name, payload) {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke(name, { projectKey: data.projectKey, issueKey: data.issueKey, ...payload });
      setData(next);
      if (next.actionError || next.scanError) setError(next.actionError || next.scanError);
    } catch (error) {
      setError(error.message || 'Sprint Sentinel could not complete that action.');
    } finally {
      setBusy(false);
    }
  }
  const proposalsByRisk = new Map((data.proposals || []).map((proposal) => [proposal.riskId, proposal]));
  const risks = data.risks || [];
  return (
    <Stack space="space.200">
      <Heading size="small">Sprint Sentinel</Heading>
      <Text>{data.issueKey} is checked against the latest project scan{data.scannedAt ? ` from ${data.scannedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}.</Text>
      <Health status={data.status} source={data.source} />
      <Button appearance="primary" isDisabled={busy} onClick={() => run('scanNow')}>Check this project</Button>
      {risks.length === 0 ? (
        <EmptyState header="This issue looks clear" description="The last check did not flag it as stalled, blocked, growing, or part of an overload." />
      ) : (
        <Stack space="space.300">
          {risks.map((risk) => (
            <RiskCard
              key={risk.id}
              risk={risk}
              proposal={proposalsByRisk.get(risk.id)}
              busy={busy}
              onDecide={(proposalId, decision) => run('decide', { proposalId, decision })}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function ConfluenceApp({ data, setData, busy, setBusy, setError }) {
  const [spaceKey, setSpaceKey] = useState(data.config?.spaceKey || '');
  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke('writeDigest', { spaceKey });
      setData({ ...data, ...next, config: next.config || { ...data.config, spaceKey } });
      if (next.digestError) setError(next.digestError);
    } catch (error) {
      setError(error.message || 'The digest could not be published.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack space="space.200">
      <Heading size="medium">Sprint Sentinel digest</Heading>
      <Text>A daily page of delivery risks. Fixes are still approved in Jira, not from this page.</Text>
      <Health status={data.status} source={data.status?.grok?.lastSource} />
      {(data.projects || []).length === 0 ? <Text>No Jira project is being watched yet. Open a project and choose Watch and check.</Text> : null}
      <Stack space="space.100">
        {(data.projects || []).map((project) => (
          <Text key={project.projectKey}>{project.projectKey}: {project.openRisks ?? 0} open risks{project.scannedAt ? `, checked ${project.scannedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}</Text>
        ))}
      </Stack>
      <Label labelFor="digest-space">Space key</Label>
      <Textfield id="digest-space" value={spaceKey} onChange={(event) => setSpaceKey(fieldValue(event))} />
      <Button appearance="primary" isDisabled={busy} onClick={publish}>Publish today’s digest</Button>
      {data.status?.digest?.url ? <Text>Latest page: {data.status.digest.url}</Text> : null}
    </Stack>
  );
}

const App = () => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [surface, setSurface] = useState('project');
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const context = await view.getContext();
        if (cancelled) return;
        const type = context?.extension?.type || '';
        const moduleKey = context?.moduleKey || '';
        const projectKey = context?.extension?.project?.key;
        const issueKey = context?.extension?.issue?.key;
        let nextSurface = 'project';
        let method = 'getProjectView';
        if (type.includes('confluence') || moduleKey.includes('confluence')) {
          nextSurface = 'confluence';
          method = 'getConfluenceView';
        } else if (type.includes('issue') || moduleKey.includes('issue')) {
          nextSurface = 'issue';
          method = 'getIssueView';
        }
        const next = await invoke(method, { projectKey, issueKey });
        if (cancelled) return;
        setSurface(nextSurface);
        setData(next);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Sprint Sentinel could not load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  if (loading) {
    return (
      <Stack space="space.100">
        <Spinner />
        <Text>Reading the sprint…</Text>
      </Stack>
    );
  }

  return (
    <Stack space="space.200">
      {error ? (
        <SectionMessage appearance="error" title="Something needs attention">
          <Text>{error}</Text>
          <Button appearance="subtle" onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1); }}>Try again</Button>
        </SectionMessage>
      ) : null}
      {data && surface === 'project' ? <ProjectApp data={data} setData={setData} busy={busy} setBusy={setBusy} setError={setError} /> : null}
      {data && surface === 'issue' ? <IssueApp data={data} setData={setData} busy={busy} setBusy={setBusy} setError={setError} /> : null}
      {data && surface === 'confluence' ? <ConfluenceApp data={data} setData={setData} busy={busy} setBusy={setBusy} setError={setError} /> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
