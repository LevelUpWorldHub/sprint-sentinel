import { kvs } from '@forge/kvs';

const DEFAULT_CONFIG = {
  projects: [],
  spaceKey: '',
  thresholds: {},
  storyPointFieldId: null,
  siteUrl: '',
};

async function read(key, fallback) {
  const value = await kvs.get(key);
  return value === undefined ? fallback : value;
}

export function createKvsStore() {
  return {
    async getConfig() {
      return { ...DEFAULT_CONFIG, ...(await read('config', {})) };
    },
    async saveConfig(config) {
      const next = { ...DEFAULT_CONFIG, ...config };
      await kvs.set('config', next);
      return next;
    },
    async getStatus() {
      return read('status', {});
    },
    async mergeStatus(partial) {
      const next = { ...(await read('status', {})), ...partial };
      await kvs.set('status', next);
      return next;
    },
    async getBaselines(projectKey) {
      return read(`baselines:${projectKey}`, {});
    },
    async saveBaselines(projectKey, baselines) {
      await kvs.set(`baselines:${projectKey}`, baselines);
    },
    async listProposals(projectKey) {
      return read(`proposals:${projectKey}`, []);
    },
    async saveProposals(projectKey, proposals) {
      await kvs.set(`proposals:${projectKey}`, proposals.slice(0, 100));
    },
    /**
     * Atomic lock: FAIL_IF_EXISTS makes exactly one caller win. The TTL frees a lock
     * left behind by a crashed invocation.
     */
    async acquireLock(name, ttlSeconds = 120) {
      const key = `lock:${name}`;
      try {
        await kvs.set(key, { at: Date.now() }, { keyPolicy: 'FAIL_IF_EXISTS', ttl: { value: ttlSeconds, unit: 'SECONDS' } });
        return true;
      } catch (error) {
        const status = error?.responseDetails?.status;
        if (status === 409 || /EXIST|CONFLICT/i.test(String(error?.code || ''))) return false;
        if ((await kvs.get(key)) !== undefined) return false;
        throw error;
      }
    },
    async releaseLock(name) {
      await kvs.delete(`lock:${name}`);
    },
    async putProposal(projectKey, proposal) {
      const list = await read(`proposals:${projectKey}`, []);
      const index = list.findIndex((item) => item.id === proposal.id);
      if (index === -1) list.push(proposal);
      else list[index] = proposal;
      await kvs.set(`proposals:${projectKey}`, list);
      return proposal;
    },
    async listAudit(projectKey) {
      return read(`audit:${projectKey}`, []);
    },
    async appendAudit(projectKey, entry) {
      const list = await read(`audit:${projectKey}`, []);
      const base = `${entry.at}:${entry.action}:${entry.outcome}`;
      let id = base;
      let n = 2;
      const ids = new Set(list.map((item) => item.id));
      while (ids.has(id)) {
        id = `${base}:${n}`;
        n += 1;
      }
      list.unshift({ id, ...entry });
      const next = list.slice(0, 80);
      await kvs.set(`audit:${projectKey}`, next);
      return next[0];
    },
    async getSnapshot(projectKey) {
      return read(`snapshot:${projectKey}`, null);
    },
    async saveSnapshot(projectKey, snapshot) {
      await kvs.set(`snapshot:${projectKey}`, snapshot);
    },
    async getConnection() {
      return read('connection', null);
    },
    async saveConnection(connection) {
      if (!connection) {
        await kvs.delete('connection');
        return null;
      }
      await kvs.set('connection', connection);
      return connection;
    },
  };
}
