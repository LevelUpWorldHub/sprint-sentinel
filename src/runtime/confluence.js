import api, { route } from '@forge/api';
import { withRetry } from '../lib/selfheal.js';

async function readBody(response) {
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  if (!response.ok) {
    const message = json?.message
      || json?.errors?.map?.((error) => error.title || error.detail).filter(Boolean).join(' ')
      || text.slice(0, 300)
      || `Confluence responded ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return json || {};
}

function pageUrl(page) {
  if (page?._links?.base && page?._links?.webui) return `${page._links.base}${page._links.webui}`;
  if (typeof page?.webUrl === 'string') return page.webUrl;
  return null;
}

export function createConfluenceClient({ preferUser = false } = {}) {
  async function call(url, options) {
    return withRetry(async () => {
      const principals = preferUser ? ['user', 'app'] : ['app'];
      let lastError;
      for (const principal of principals) {
        try {
          const client = principal === 'user' ? api.asUser() : api.asApp();
          const response = await client.requestConfluence(url, options);
          if (response.status >= 500 || response.status === 429) {
            const error = new Error(`Confluence responded ${response.status}`);
            error.status = response.status;
            error.retryable = true;
            lastError = error;
            continue;
          }
          return await readBody(response);
        } catch (error) {
          if (error.status && error.status < 500 && error.status !== 429) throw error;
          lastError = error;
        }
      }
      throw lastError || new Error('Confluence request failed');
    }, { retries: 2, timeoutMs: 20000, label: 'Confluence' });
  }

  return {
    async upsertDailyPage({ spaceKey, title, storage }) {
      const spaces = await call(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`);
      const space = (spaces.results || [])[0];
      if (!space?.id) throw new Error(`Confluence space ${spaceKey} was not found.`);
      const existing = await call(route`/wiki/api/v2/pages?space-id=${space.id}&title=${title}&limit=5`);
      const found = (existing.results || []).find((page) => page.title === title);
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (found) {
        const current = await call(route`/wiki/api/v2/pages/${found.id}`);
        const updated = await call(route`/wiki/api/v2/pages/${found.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            id: found.id,
            status: 'current',
            title,
            spaceId: space.id,
            body: { representation: 'storage', value: storage },
            version: {
              number: (current.version?.number || 1) + 1,
              message: 'Sprint Sentinel daily refresh',
            },
          }),
        });
        return { id: String(updated.id || found.id), url: pageUrl(updated) || pageUrl(current) };
      }
      const created = await call(route`/wiki/api/v2/pages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          spaceId: space.id,
          status: 'current',
          title,
          body: { representation: 'storage', value: storage },
        }),
      });
      return { id: String(created.id), url: pageUrl(created) };
    },
  };
}
