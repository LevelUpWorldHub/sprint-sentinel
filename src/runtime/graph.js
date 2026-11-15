import api from '@forge/api';
import { graph } from '@forge/teamwork-graph';
import { buildDigestDocument } from '../lib/documents.js';
import { enrichSnapshot } from '../lib/graph.js';

export function createGraphClient({ connectionId, cloudId } = {}) {
  return {
    async enrich(snapshot, options = {}) {
      return enrichSnapshot(snapshot, async (query, variables) => {
        const response = await api.asUser().requestTeamworkGraph(query, variables);
        return response.json();
      }, { cloudId, overloadCount: options.overloadCount });
    },
    async ingest({ id, title, text, url, now }) {
      if (!connectionId) {
        return { ok: false, skipped: true, reason: 'Connect Sprint Sentinel in Teamwork Graph before digests are ingested.' };
      }
      const document = buildDigestDocument({ id, title, text, url, now });
      const response = await graph.setObjects({
        objects: [document],
        connectionId,
        operationType: 'NORMAL',
      });
      if (response && response.success === false) {
        throw new Error(response.error || 'Teamwork Graph rejected the digest');
      }
      const rejected = response?.results?.rejected || [];
      if (rejected.length) {
        const message = rejected.flatMap((item) => item.errors || []).map((error) => error.message).join('; ');
        throw new Error(message || 'Teamwork Graph rejected the digest document');
      }
      return { ok: true };
    },
  };
}
