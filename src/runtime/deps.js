import api from '@forge/api';
import { createConfluenceClient } from './confluence.js';
import { createGraphClient } from './graph.js';
import { createJiraClient } from './jira.js';
import { createKvsStore } from './store.js';

export function readRuntimeEnv() {
  return {
    XAI_API_KEY: process.env.XAI_API_KEY || '',
    XAI_MODEL: process.env.XAI_MODEL || 'grok-4.7',
  };
}

export async function createRuntime({ preferUser = false, cloudId } = {}) {
  const store = createKvsStore();
  const connection = await store.getConnection();
  return {
    store,
    env: readRuntimeEnv(),
    fetchImpl: (url, options) => api.fetch(url, options),
    jira: createJiraClient({ preferUser }),
    confluence: createConfluenceClient({ preferUser }),
    graph: createGraphClient({ connectionId: connection?.connectionId, cloudId }),
    cloudId,
  };
}
