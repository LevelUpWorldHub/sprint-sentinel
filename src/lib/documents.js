export function buildDigestDocument({ id, title, text, url, now, sequence }) {
  if (!url) throw new Error('A page URL is required before a digest can enter Teamwork Graph.');
  const timestamp = now || new Date().toISOString();
  return {
    schemaVersion: '1.0',
    id,
    updateSequenceNumber: sequence || Date.parse(timestamp) || Date.now(),
    displayName: title,
    url,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
    permissions: [{
      accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }],
    }],
    'atlassian:document': {
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: String(text || '').slice(0, 20000) },
    },
  };
}
