import { Router, Request, Response } from 'express';
import pool from '../config/database.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { GATEWAY_PRESETS, createGatewayAdapter } from '@autoorch/provider-registry/universal-gateway';
import type { GatewayProviderConfig } from '@autoorch/provider-registry/universal-gateway';
import { providerRouter } from '../services.js';

const router = Router();

// In-memory credential cache — populated from DB on startup/first access.
// Write-through: saves to DB and cache simultaneously.
export const gatewayCredentialStore = new Map<string, string>();

// AES-256-GCM authenticated encryption for credential storage
const ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY; // 32-byte hex key (64 characters)

// Validate encryption key format on module load
function validateEncryptionKey(): void {
  if (process.env.NODE_ENV === 'production' && !ENCRYPTION_KEY) {
    throw new Error('CRITICAL: APP_ENCRYPTION_KEY is required in production. Generate with: openssl rand -hex 32');
  }
  if (ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    throw new Error('APP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate with: openssl rand -hex 32');
  }
}

// Run validation immediately
validateEncryptionKey();

function encryptCredential(plaintext: string): string {
  if (!ENCRYPTION_KEY) {
    // Development only - log warning and use reversible encoding
    console.warn('[SECURITY WARNING] No encryption key - credentials stored with weak encoding. Set APP_ENCRYPTION_KEY in production.');
    return 'UNENCRYPTED:' + Buffer.from(plaintext).toString('base64');
  }
  const iv = randomBytes(12); // GCM standard: 12-byte nonce
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return 'AES256GCM:' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptCredential(ciphertext: string): string {
  // Handle unencrypted credentials (development mode)
  if (ciphertext.startsWith('UNENCRYPTED:')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Unencrypted credential found in production - re-encrypt with APP_ENCRYPTION_KEY');
    }
    return Buffer.from(ciphertext.slice(12), 'base64').toString('utf8');
  }
  
  // Handle legacy base64-only format (migration path)
  if (!ciphertext.startsWith('AES256GCM:') && !ciphertext.includes(':')) {
    console.warn('[SECURITY WARNING] Legacy unencrypted credential detected - please re-register provider');
    return Buffer.from(ciphertext, 'base64').toString('utf8');
  }
  
  if (!ENCRYPTION_KEY) {
    throw new Error('Cannot decrypt credentials without APP_ENCRYPTION_KEY');
  }
  
  const payload = ciphertext.startsWith('AES256GCM:') ? ciphertext.slice(10) : ciphertext;
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted credential format');
  const [ivHex, authTagHex, encHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

// Persist credential to DB and cache
async function storeCredential(providerId: string, ref: string, apiKey: string): Promise<void> {
  const encrypted = encryptCredential(apiKey);
  await pool.query(
    `INSERT INTO provider_credentials (provider_id, credential_ref, encrypted_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (credential_ref) DO UPDATE SET encrypted_value = $3, updated_at = NOW()`,
    [providerId, ref, encrypted]
  );
  gatewayCredentialStore.set(ref, apiKey);
}

// Load all credentials from DB into cache (call on startup)
export async function loadCredentialsFromDB(): Promise<void> {
  try {
    const result = await pool.query('SELECT credential_ref, encrypted_value FROM provider_credentials');
    for (const row of result.rows) {
      try {
        gatewayCredentialStore.set(row.credential_ref, decryptCredential(row.encrypted_value));
      } catch {
        console.warn(`[Gateway] Failed to decrypt credential: ${row.credential_ref}`);
      }
    }
    console.log(`[Gateway] Loaded ${result.rows.length} credentials from DB`);
  } catch {
    // Table may not exist yet — will be created by migration
    console.warn('[Gateway] Credential table not found, skipping load');
  }
}

// Resolve a credential from cache → env → empty
export function resolveGatewayCredential(ref: string): string {
  return gatewayCredentialStore.get(ref) || process.env[ref] || '';
}

// SSRF protection: block private/internal IPs and cloud metadata endpoints
// Note: For local deployment, this primarily prevents accidental misconfiguration
import { lookup } from 'dns/promises';

async function resolveToIP(hostname: string): Promise<string | null> {
  try {
    // Skip resolution for IP addresses
    if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
      return hostname;
    }
    const result = await lookup(hostname, { family: 4 });
    return result.address;
  } catch {
    return null;
  }
}

function isPrivateIP(ip: string): boolean {
  // Check if IP is in private/reserved ranges
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  
  const [a, b] = parts;
  return (
    a === 10 ||                           // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12
    (a === 192 && b === 168) ||           // 192.168.0.0/16
    a === 127 ||                          // 127.0.0.0/8 (loopback)
    a === 0 ||                            // 0.0.0.0/8
    (a === 169 && b === 254)              // 169.254.0.0/16 (link-local)
  );
}

async function isUrlSafeAsync(url: string): Promise<{ safe: boolean; reason?: string }> {
  const allowLocal = process.env.ALLOW_LOCAL_PROVIDERS === 'true';

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Block cloud metadata endpoints (always, regardless of allowLocal)
    // Be careful NOT to block host.docker.internal which is needed for Docker-to-host communication
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || 
        hostname === 'metadata.azure.com' || hostname === 'metadata.aws.internal' ||
        (hostname.endsWith('.internal') && hostname !== 'host.docker.internal')) {
      return { safe: false, reason: 'Cloud metadata endpoint blocked' };
    }

    // Block IPv6 zone identifiers (bypass technique)
    if (hostname.includes('%')) {
      return { safe: false, reason: 'IPv6 zone identifiers not allowed' };
    }

    // Block hex/decimal/octal IP representations
    if (/^0x[0-9a-f]+$/i.test(hostname) || /^\d{10,}$/.test(hostname) || /^0\d+\./.test(hostname)) {
      return { safe: false, reason: 'Numeric IP bypass detected' };
    }

    // Resolve hostname to IP to prevent DNS rebinding
    const isLocalHost = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
    const isLoopback = /^127\./.test(hostname);
    
    if (isLocalHost || isLoopback) {
      if (allowLocal) return { safe: true };
      return { safe: false, reason: 'Localhost not allowed without ALLOW_LOCAL_PROVIDERS=true' };
    }

    // For non-localhost hostnames, resolve and check the IP
    const resolvedIP = await resolveToIP(hostname);
    if (!resolvedIP) {
      return { safe: false, reason: 'Could not resolve hostname' };
    }

    if (isPrivateIP(resolvedIP)) {
      if (allowLocal) return { safe: true };
      return { safe: false, reason: `Hostname resolves to private IP (${resolvedIP})` };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }
}

// Synchronous version for quick checks (hostname only, no DNS resolution)
function isUrlSafe(url: string): boolean {
  const allowLocal = process.env.ALLOW_LOCAL_PROVIDERS === 'true';

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Block cloud metadata endpoints (always)
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      return false;
    }

    // Resolve known hostnames to check
    const isLocalHost = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
    const isLoopback = /^127\./.test(hostname) || hostname === '0.0.0.0';
    const isPrivate10 = /^10\./.test(hostname);
    const isPrivate172 = /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    const isPrivate192 = /^192\.168\./.test(hostname);
    const isZero = /^0\./.test(hostname);
    const isLinkLocal = /^169\.254\./.test(hostname);
    const isIPv6Private = /^\[f[cd]/.test(hostname);
    const isIPv6Mapped = /^\[.*:ffff:/i.test(hostname);

    // Block hex/decimal/octal IP representations (non-dotted-decimal numeric hosts)
    const isNumericBypass = /^0x[0-9a-f]+$/i.test(hostname) || /^\d{4,}$/.test(hostname) || /^0\d+\./.test(hostname);

    const isInternal = isLocalHost || isLoopback || isPrivate10 || isPrivate172 || isPrivate192
      || isZero || isLinkLocal || isIPv6Private || isIPv6Mapped || isNumericBypass;

    if (isInternal) {
      // Allow local addresses only when explicitly permitted (for Ollama/LMStudio)
      if (allowLocal && (isLocalHost || isLoopback || isPrivate192 || isPrivate10)) {
        return true;
      }
      return false;
    }

    return true;
  } catch {
    return false; // Invalid URL = blocked
  }
}

// List all available presets
router.get('/presets', (_req: Request, res: Response) => {
  const presets = Object.entries(GATEWAY_PRESETS).map(([name, config]) => ({
    name,
    displayName: config.connection?.baseUrl || name,
    authType: config.auth?.type || 'none',
    capabilities: config.capabilities || {},
    defaultModel: config.requestMapping?.modelValue || 'unknown',
  }));
  res.json(presets);
});

// Get details of a specific preset
router.get('/presets/:name', (req: Request, res: Response) => {
  const presetName = req.params.name as string;
  const preset = GATEWAY_PRESETS[presetName];
  if (!preset) {
    res.status(404).json({ error: `Preset "${req.params.name}" not found` });
    return;
  }
  res.json({ name: req.params.name, config: preset });
});

// Fetch available models from Ollama
router.get('/ollama/models', async (_req: Request, res: Response) => {
  try {
    // Try host.docker.internal first (Docker environment), then localhost
    const ollamaUrls = [
      'http://host.docker.internal:11434',
      'http://localhost:11434',
      'http://127.0.0.1:11434'
    ];

    let models: any[] = [];
    let lastError: any = null;

    for (const baseUrl of ollamaUrls) {
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(3000), // 3s timeout
        });

        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          continue;
        }

        const data = await response.json() as { models?: any[] };
        models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
          digest: m.digest?.slice(0, 12) || '',
        }));
        
        res.json({ 
          success: true, 
          models,
          source: baseUrl,
        });
        return;
      } catch (err: any) {
        lastError = err;
        continue;
      }
    }

    // All URLs failed
    res.status(503).json({ 
      success: false, 
      error: 'Ollama not reachable. Is it running?',
      details: lastError?.message,
      models: []
    });
  } catch (err: any) {
    console.error('[Gateway] Ollama model scan failed:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch Ollama models',
      models: []
    });
  }
});

// Register a provider using the universal gateway
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, preset, apiKey, modelOverride, endpointOverride, customConfig, capabilities } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    // Build the gateway config
    let gatewayConfig: Partial<GatewayProviderConfig> & { name: string } = { name };

    if (preset && GATEWAY_PRESETS[preset]) {
      // Start from a preset
      gatewayConfig = { ...GATEWAY_PRESETS[preset], name } as Partial<GatewayProviderConfig> & { name: string };
    }

    // Apply overrides
    if (endpointOverride && gatewayConfig.connection) {
      gatewayConfig.connection = { ...gatewayConfig.connection, baseUrl: endpointOverride };
    }
    if (modelOverride && gatewayConfig.requestMapping) {
      gatewayConfig.requestMapping = { ...gatewayConfig.requestMapping, modelValue: modelOverride };
    }
    if (capabilities) {
      gatewayConfig.capabilities = { ...gatewayConfig.capabilities, ...capabilities } as GatewayProviderConfig['capabilities'];
    }

    // Merge any custom config on top
    if (customConfig && typeof customConfig === 'object') {
      gatewayConfig = { ...gatewayConfig, ...customConfig, name };
    }

    // Determine credential reference
    const credentialsRef = apiKey ? `GATEWAY_KEY_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : null;

    // Store API key securely — persist to DB with encryption, cache in memory
    if (apiKey && credentialsRef) {
      // Insert provider first to get the ID, then store credential
      gatewayCredentialStore.set(credentialsRef, apiKey);
    }

    // Auto-fix localhost URLs for Docker environment
    // When running inside Docker, localhost refers to the container itself, not the host
    // Use host.docker.internal to reach the host machine
    let endpoint = gatewayConfig.connection?.baseUrl || 'http://localhost';
    if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) {
      endpoint = endpoint.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
      if (gatewayConfig.connection) {
        gatewayConfig.connection = { ...gatewayConfig.connection, baseUrl: endpoint };
      }
    }
    const modelName = gatewayConfig.requestMapping?.modelValue || 'default';

    // SSRF protection: validate provider endpoint with DNS resolution
    const ssrfCheck = await isUrlSafeAsync(endpoint);
    if (!ssrfCheck.safe) {
      res.status(400).json({ error: `Endpoint URL blocked: ${ssrfCheck.reason}. Set ALLOW_LOCAL_PROVIDERS=true for local models.` });
      return;
    }

    const result = await pool.query(
      `INSERT INTO provider_definitions
         (name, type, endpoint, model_name, capabilities, credentials_ref, cost_metadata, rate_limits, gateway_config, preset_name, health_status)
       VALUES ($1, 'GENERIC_HTTP', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        name,
        endpoint,
        modelName,
        JSON.stringify(gatewayConfig.capabilities || { structuredOutput: false, toolUse: false, streaming: false, maxContextTokens: 4096 }),
        credentialsRef,
        JSON.stringify(gatewayConfig.cost || { costPerInputToken: 0, costPerOutputToken: 0, currency: 'USD' }),
        JSON.stringify({ requestsPerMinute: 60, tokensPerMinute: 100000 }),
        JSON.stringify(gatewayConfig),
        preset || null,
        JSON.stringify({ isHealthy: true, lastCheckedAt: new Date().toISOString(), failureCount: 0, lastError: null })
      ]
    );

    // Persist credential to DB (encrypted) now that we have the provider ID
    if (apiKey && credentialsRef && result.rows[0]) {
      try {
        await storeCredential(result.rows[0].id, credentialsRef, apiKey);
      } catch (credErr) {
        console.warn('[gateway.register] Credential persistence failed (in-memory only):', (credErr as Error).message);
      }
    }

    // Reload provider adapters so the new provider is available for routing
    try {
      await providerRouter.loadAdapters();
      console.log(`[Gateway] Reloaded provider adapters after registering "${name}"`);
    } catch (reloadErr) {
      console.warn('[Gateway] Failed to reload adapters:', (reloadErr as Error).message);
    }

    res.status(201).json({
      provider: result.rows[0],
      message: `Provider "${name}" registered via universal gateway${preset ? ` (preset: ${preset})` : ''}`,
    });
  } catch (err) {
    console.error('[gateway.register]', err);
    res.status(500).json({ error: 'Failed to register gateway provider' });
  }
});

// Test connection to a gateway provider
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { preset, apiKey, endpointOverride, modelOverride, customConfig } = req.body;

    let config: Partial<GatewayProviderConfig> & { name: string } = { name: 'test' };

    if (preset && GATEWAY_PRESETS[preset]) {
      config = { ...GATEWAY_PRESETS[preset], name: 'test' } as Partial<GatewayProviderConfig> & { name: string };
    }

    if (endpointOverride && config.connection) {
      config.connection = { ...config.connection, baseUrl: endpointOverride };
    }
    if (modelOverride && config.requestMapping) {
      config.requestMapping = { ...config.requestMapping, modelValue: modelOverride };
    }
    if (customConfig) {
      config = { ...config, ...customConfig, name: 'test' };
    }

    // SSRF protection: validate test endpoint
    const testUrl = config.connection?.baseUrl || '';
    if (testUrl && !isUrlSafe(testUrl)) {
      res.status(400).json({ error: 'Endpoint URL blocked — private/internal addresses not allowed. Set ALLOW_LOCAL_PROVIDERS=true for local models.' });
      return;
    }

    const adapter = createGatewayAdapter(config, apiKey, preset);

    // Run health check
    const health = await adapter.healthCheck();

    // Optionally run a small completion test
    let completionTest = null;
    if (health.healthy && req.body.testCompletion) {
      try {
        const result = await adapter.complete({
          systemPrompt: 'You are a test assistant. Respond with exactly: {"status":"ok"}',
          userMessage: 'Respond with a JSON object containing status ok.',
          maxTokens: 50,
          temperature: 0,
        });
        completionTest = {
          success: true,
          content: result.content.substring(0, 200),
          tokenUsage: result.tokenUsage,
          durationMs: result.durationMs,
        };
      } catch (err) {
        completionTest = { success: false, error: (err as Error).message };
      }
    }

    res.json({
      healthy: health.healthy,
      latencyMs: health.latencyMs,
      error: health.error,
      completionTest,
    });
  } catch (err) {
    console.error('[gateway.test]', err);
    res.status(500).json({ error: 'Connection test failed', details: (err as Error).message });
  }
});

// Update a gateway provider's config
router.put('/:id/config', async (req: Request, res: Response) => {
  try {
    const { gatewayConfig, modelOverride, endpointOverride } = req.body;

    // SSRF protection: validate endpoint override
    if (endpointOverride && !isUrlSafe(endpointOverride)) {
      res.status(400).json({ error: 'Endpoint URL blocked — private/internal addresses not allowed. Set ALLOW_LOCAL_PROVIDERS=true for local models.' });
      return;
    }

    // Fetch current config
    const current = await pool.query('SELECT * FROM provider_definitions WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    let config = (current.rows[0].gateway_config || {}) as Record<string, unknown>;

    if (gatewayConfig) {
      config = { ...config, ...gatewayConfig };
    }
    if (endpointOverride && config.connection) {
      config.connection = { ...(config.connection as Record<string, unknown>), baseUrl: endpointOverride };
    }
    if (modelOverride && config.requestMapping) {
      config.requestMapping = { ...(config.requestMapping as Record<string, unknown>), modelValue: modelOverride };
    }

    const result = await pool.query(
      `UPDATE provider_definitions
       SET gateway_config = $1,
           endpoint = COALESCE($2, endpoint),
           model_name = COALESCE($3, model_name),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        JSON.stringify(config),
        endpointOverride || null,
        modelOverride || null,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[gateway.updateConfig]', err);
    res.status(500).json({ error: 'Failed to update gateway config' });
  }
});

export default router;
