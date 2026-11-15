function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

const EMPTY_CONFIG = {
  projects: [],
  spaceKey: '',
  thresholds: {},
  storyPointFieldId: null,
  siteUrl: '',
};

export function createMemoryStore(initial = {}) {
  const state = {
    config: { ...EMPTY_CONFIG, ...(initial.config || {}) },
    status: { ...(initial.status || {}) },
    baselines: { ...(initial.baselines || {}) },
    proposals: { ...(initial.proposals || {}) },
    audits: { ...(initial.audits || {}) },
    snapshots: { ...(initial.snapshots || {}) },
    connection: initial.connection || null,
  };

  return {
    async getConfig() { return clone(state.config); },
    async saveConfig(config) { state.config = { ...EMPTY_CONFIG, ...clone(config) }; return clone(state.config); },
    async getStatus() { return clone(state.status); },
    async mergeStatus(partial) { state.status = { ...state.status, ...clone(partial) }; return clone(state.status); },
    async getBaselines(projectKey) { return clone(state.baselines[projectKey] || {}); },
    async saveBaselines(projectKey, baselines) { state.baselines[projectKey] = clone(baselines); },
    async listProposals(projectKey) { return clone(state.proposals[projectKey] || []); },
    async saveProposals(projectKey, proposals) { state.proposals[projectKey] = clone(proposals).slice(0, 100); },
    async putProposal(projectKey, proposal) {
      const list = state.proposals[projectKey] || [];
      const index = list.findIndex((item) => item.id === proposal.id);
      if (index === -1) list.push(clone(proposal));
      else list[index] = clone(proposal);
      state.proposals[projectKey] = list;
      return clone(proposal);
    },
    async listAudit(projectKey) { return clone(state.audits[projectKey] || []); },
    async appendAudit(projectKey, entry) {
      const list = state.audits[projectKey] || [];
      const base = `${entry.at}:${entry.action}:${entry.outcome}`;
      let id = base;
      let n = 2;
      const ids = new Set(list.map((item) => item.id));
      while (ids.has(id)) {
        id = `${base}:${n}`;
        n += 1;
      }
      list.unshift({ id, ...clone(entry) });
      state.audits[projectKey] = list.slice(0, 80);
      return state.audits[projectKey][0];
    },
    async getSnapshot(projectKey) { return clone(state.snapshots[projectKey] || null); },
    async saveSnapshot(projectKey, snapshot) { state.snapshots[projectKey] = clone(snapshot); },
    async getConnection() { return clone(state.connection); },
    async saveConnection(connection) { state.connection = clone(connection); return clone(state.connection); },
  };
}
