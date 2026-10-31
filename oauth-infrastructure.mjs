import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import * as util from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded with Node --import BEFORE the application's configuration and clients.
export const policy = {"bucket":["GCS_BUCKET"],"profiles":{"primary":["LRS","XAPI","XAPI_LRS"],"debug":["BUG_LRS","DEBUG_XAPI_LRS"],"webhooks":["WORKBUDDY_LRS","WEBHOOK_XAPI_LRS"]},"root":".","gcsEnable":{},"lrsEnable":{}};
const complete = p => p && ['endpoint', 'username', 'password'].every(k => typeof p[k] === 'string' && p[k].trim());
const first = (...values) => values.find(v => typeof v === 'string' && v.trim()) || '';
export async function configureInfrastructure(env, transport = fetch) {
  const useGCS = env.USE_OAUTH_GCS === 'true', useLRS = env.USE_OAUTH_LRS === 'true';
  if (!useGCS && !useLRS) return { gcs: 'original', lrs: 'original' };
  const client = first(env.PROXY_CLIENT_ID, env.SKO_CLIENT_ID, env.GENAI_CLIENT_ID);
  const secret = first(env.PROXY_CLIENT_SECRET, env.SKO_CLIENT_SECRET, env.GENAI_CLIENT_SECRET);
  if (!client || !secret) throw Error('OAuth infrastructure requires PROXY_CLIENT_ID and PROXY_CLIENT_SECRET.');
  const origin = new URL(first(env.OAUTH_BASE_URL, env.SKO_PROXY_ORIGIN, env.GENAI_ORIGIN, env.OAUTH_GATEWAY_URL, env.OAUTH_PROXY_URL, env.OAUTH_GATEWAY) || 'https://oauth.skoonline.org');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw Error('OAuth infrastructure origin must be an HTTPS origin.');
  let response;
  try {
    response = await transport(new URL('/genai/services/config', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(client + ':' + secret).toString('base64') },
      body: JSON.stringify({ gcs: useGCS, lrs: useLRS }),
    });
  } catch {
    return { gcs: 'original', lrs: 'original', fallback: 'network' };
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500)
      return { gcs: 'original', lrs: 'original', fallback: 'gateway_unavailable' };
    throw Error('OAuth infrastructure configuration rejected: HTTP ' + response.status);
  }
  const data = await response.json();
  if (data.appId !== client || !data.optionalConnections || typeof data.optionalConnections !== 'object')
    throw Error('Invalid OAuth infrastructure response.');
  const settings = data.optionalConnections, changes = {}, selected = { gcs: 'original', lrs: 'original', profiles: {} };
  if (useGCS && typeof settings.bucket === 'string' && settings.bucket.trim()) {
    for (const name of policy.bucket) changes[name] = settings.bucket.trim();
    Object.assign(changes, policy.gcsEnable || {});
    selected.gcs = 'oauth';
  }
  if (useLRS) {
    for (const [role, prefixes] of Object.entries(policy.profiles)) {
      const profile = settings[role];
      if (!complete(profile)) { selected.profiles[role] = 'original'; continue; }
      const endpoint = new URL(profile.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw Error('Invalid registered LRS URL.');
      const header = 'Basic ' + Buffer.from(profile.username + ':' + profile.password).toString('base64');
      for (const prefix of prefixes) {
        changes[prefix + '_ENDPOINT'] = profile.endpoint;
        changes[prefix + '_USERNAME'] = profile.username;
        changes[prefix + '_PASSWORD'] = profile.password;
        changes[prefix + '_KEY'] = profile.username;
        changes[prefix + '_SECRET'] = profile.password;
        changes[prefix + '_AUTHORIZATION'] = header;
        changes[prefix + '_AUTH'] = header;
        changes[prefix + '_AUTH_TYPE'] = 'basic';
        changes[prefix + '_AUTH_TOKEN'] = '';
        changes[prefix + '_TOKEN'] = '';
        changes[prefix + '_VERSION'] = '1.0.3';
      }
      if (role === 'primary') {
        if (prefixes.includes('LRS')) changes.LRS_URL = profile.endpoint;
        Object.assign(changes, policy.lrsEnable || {});
      }
      selected.profiles[role] = 'oauth';
      selected.lrs = 'oauth';
    }
  }
  // Commit a fully validated selection atomically; no partial credentials on errors.
  Object.assign(env, changes);
  return selected;
}
async function initialize() {
  // Read infrastructure inputs without changing how the app loads unrelated settings.
  const inputs = { ...process.env };
  if (inputs.SKIP_DOTENV !== 'true') {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), policy.root || '.');
    const paths = inputs.DOTENV_PATH ? [resolve(inputs.DOTENV_PATH)] :
      [...new Set([resolve(process.cwd(), '.env'), resolve(root, '.env')])];
    for (const path of paths) {
      if (!existsSync(path)) continue;
      const parse = util.parseEnv || createRequire(import.meta.url)('dotenv').parse;
      const parsed = parse(readFileSync(path, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) if (inputs[key] === undefined) inputs[key] = value;
    }
  }
  inputs.USE_OAUTH_GCS ??= 'false';
  inputs.USE_OAUTH_LRS ??= 'false';
  const before = { ...inputs };
  const result = await configureInfrastructure(inputs);
  // Only infrastructure overrides reach the app. Its own dotenv loading stays intact.
  for (const [key, value] of Object.entries(inputs)) {
    if (value !== before[key] || key === 'USE_OAUTH_GCS' || key === 'USE_OAUTH_LRS') process.env[key] = value;
  }
  if (result.fallback) console.warn('OAuth infrastructure unavailable; using original app configuration.');
}
await initialize();

