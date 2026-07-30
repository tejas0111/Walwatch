import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.walwatch');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  api_url?: string;
  token?: string;
  org_id?: string;
  api_key?: string;
}

export function loadConfig(): CliConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn(`Warning: Corrupt config at ${CONFIG_PATH}, using defaults.`);
  }
  return {};
}

export function saveConfig(config: CliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const tmpPath = CONFIG_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  renameSync(tmpPath, CONFIG_PATH);
  if (process.platform !== 'win32') {
    chmodSync(CONFIG_PATH, 0o600);
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}