import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Load .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export interface Config {
  port: number;
  vaultPath: string;
  corsOrigin: string | string[];
  nodeEnv: string;
  // OpenClaw gateway settings for auto-grooming
  openclawGatewayUrl: string;
  openclawToken: string | undefined;
  autoGroomingEnabled: boolean;
}

function parseOrigins(origins: string | undefined): string | string[] {
  if (!origins) return '*';
  if (origins.includes(',')) {
    return origins.split(',').map(o => o.trim());
  }
  return origins;
}

/**
 * Try to read the OpenClaw gateway token from the local config file
 * Falls back to undefined if not available
 */
function getOpenClawToken(): string | undefined {
  // First check env var
  if (process.env.OPENCLAW_TOKEN) {
    return process.env.OPENCLAW_TOKEN;
  }
  
  // Try to read from OpenClaw config file
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const openclawConfig = JSON.parse(configContent);
    
    const token = openclawConfig?.gateway?.auth?.token;
    if (token) {
      console.log('[Config] Loaded OpenClaw token from ~/.openclaw/openclaw.json');
      return token;
    }
  } catch (error) {
    // Config file not found or invalid - that's okay
  }
  
  return undefined;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3001', 10),
  vaultPath: process.env.VAULT_PATH || '/home/chris/Kolenko/Mission Control/tickets',
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN),
  nodeEnv: process.env.NODE_ENV || 'development',
  // OpenClaw gateway settings
  openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789',
  openclawToken: getOpenClawToken(),
  autoGroomingEnabled: process.env.AUTO_GROOMING_ENABLED !== 'false' // Enabled by default
};

export default config;
