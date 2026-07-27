#!/usr/bin/env node

// DEFERRED to spec 28 (CLI/SDK) audit — CLI parity gaps from specs 01-03 audit
import { Command } from 'commander';
import { WalwatchClient } from '@walwatch/sdk';
import { loadConfig, saveConfig } from './config.js';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import ora from 'ora';
import pc from 'picocolors';

function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createClient(): WalwatchClient {
  const config = loadConfig();
  const client = new WalwatchClient({
    apiUrl: config.api_url || 'http://localhost:3001/api',
    token: config.token,
    apiKey: config.api_key,
    orgId: config.org_id,
  });
  return client;
}

function formatJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Output structured result — JSON in --json mode, human-readable message otherwise. */
function outputResult(message: string, data?: Record<string, unknown>): void {
  if (isJsonMode()) {
    formatJson({ message, ...data });
  } else {
    console.log(`${pc.green('✓')} ${message}`);
  }
}

/**
 * Confirm a destructive action.
 * Returns true if the user confirmed (or --yes/--confirm was passed).
 */
async function confirmDestructive(actionDescription: string, options: { confirm?: boolean; yes?: boolean }): Promise<boolean> {
  if (options.confirm || options.yes) return true;
  const rl = createInterface({ input, output });
  const answer = await rl.question(`${pc.yellow(`Are you sure you want to ${actionDescription}? (yes/no): `)}`);
  rl.close();
  if (answer.toLowerCase() !== 'yes') {
    console.log(pc.dim('Aborted.'));
    return false;
  }
  return true;
}

function requireOrg(client: WalwatchClient): string {
  const config = loadConfig();
  if (!config.org_id) {
    console.error(pc.red('No org_id configured. Run `walwatch login` first.'));
    process.exit(1);
  }
  return config.org_id;
}

const program = new Command();

program
  .name('walwatch')
  .description(`${pc.cyan('Walwatch CLI')} ${pc.dim('— Auto-renewal vault management')}`)
  .version('0.1.0')
  .option('--json', 'Output in JSON format (machine-readable)')
  .addHelpText('after', `
${pc.bold('Examples:')}
  ${pc.green('walwatch login')}                     Authenticate with email and password
  ${pc.green('walwatch vaults deposit <id> <amt>')}  Deposit WAL into a vault
  ${pc.green('walwatch blobs list')}                 List all blobs in the org
  ${pc.green('walwatch blobs list --json')}          List blobs as JSON
  ${pc.green('walwatch policies create <name>')}     Create a renewal policy
  ${pc.green('walwatch analytics overview')}         Show analytics dashboard
  ${pc.green('walwatch completion bash')}            Generate bash completion script

${pc.bold('Setup:')}
  1. Run ${pc.green('walwatch login')} to authenticate
  2. Run ${pc.green('walwatch init')} to create ~/.walwatch/config.json
  3. Optionally set API URL via: ${pc.green('walwatch config set api_url <url>')}

${pc.dim('Documentation: https://walwatch.io/docs')}
`);

/** Returns true if the --json global flag was passed. */
function isJsonMode(): boolean {
  return program.getOptionValue('json') === true;
}

// ==================== login ====================

program
  .command('login')
  .description('Login with email and password, save token to ~/.walwatch/config')
  .action(async () => {
    const rl = createInterface({ input, output });
    const email = await rl.question('Email: ');
    const password = await rl.question('Password: ');
    rl.close();

    const spinner = ora('Authenticating...').start();
    try {
      const config = loadConfig();
      const client = new WalwatchClient({ apiUrl: config.api_url || 'http://localhost:3001/api' });
      const result = await client.login(email, password);
      saveConfig({ ...loadConfig(), token: result.token });
      spinner.succeed(`Logged in as ${pc.bold(result.user.email)}`);
    } catch (err: unknown) {
      spinner.fail(`Login failed: ${safeError(err)}`);
      process.exit(1);
    }
  });

// ==================== register ====================

program
  .command('register')
  .description('Register a new account')
  .option('-n, --name <name>', 'Display name')
  .action(async (options) => {
    const rl = createInterface({ input, output });
    const email = await rl.question('Email: ');
    const password = await rl.question('Password: ');
    rl.close();

    const spinner = ora('Creating account...').start();
    try {
      const config = loadConfig();
      const client = new WalwatchClient({ apiUrl: config.api_url || 'http://localhost:3001/api' });
      const result = await client.register(email, password, options.name);
      saveConfig({ ...loadConfig(), token: result.token });
      spinner.succeed(`Registered and logged in as ${pc.bold(result.user.email)}`);
    } catch (err: unknown) {
      spinner.fail(`Registration failed: ${safeError(err)}`);
      process.exit(1);
    }
  });

// ==================== logout ====================

program
  .command('logout')
  .description('Clear saved authentication token')
  .action(() => {
    const config = loadConfig();
    if (config.token) {
      saveConfig({ ...config, token: undefined });
      console.log(pc.green('✓') + ' Logged out.');
    } else {
      console.log(pc.dim('Not logged in.'));
    }
  });

// ==================== me ====================

program
  .command('me')
  .description('Show current user profile')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.me();
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== init ====================

program
  .command('init')
  .description('Creates ~/.walwatch/config.json')
  .action(() => {
    const config = loadConfig();
    if (!config.api_url) {
      console.log(pc.dim('No API URL configured. Using default ') + pc.yellow('http://localhost:3001/api'));
      saveConfig({ ...config, api_url: 'http://localhost:3001/api' });
    }
    console.log(pc.green('✓') + ' Walwatch initialized.');
  });

// ==================== config ====================

const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a config value (e.g. api_url, org_id)')
  .action((key, value) => {
    const config = loadConfig();
    saveConfig({ ...config, [key]: value });
    console.log(`${pc.green('✓')} Set ${pc.bold(key)} to ${pc.cyan(value)}`);
  });

configCmd
  .command('get <key>')
  .description('Get a config value')
  .action((key) => {
    const config = loadConfig();
    const val = (config as Record<string, string | undefined>)[key];
    if (val === undefined) {
      console.log(`${pc.yellow('!')} ${key} is not set`);
    } else {
      console.log(val);
    }
  });

configCmd
  .command('show')
  .description('Show all config values')
  .action(() => {
    const config = loadConfig();
    formatJson(config);
  });

// ==================== upload ====================

program
  .command('upload <blob-id>')
  .description('Upload a blob and create vault')
  .option('-w, --wallet <address>', 'Wallet address')
  .option('-a, --amount <amount>', 'Initial WAL amount')
  .option('-t, --threshold <epochs>', 'Renew threshold epochs', '5')
  .option('-e, --extension <epochs>', 'Renew by epochs', '10')
  .addHelpText('after', `
${pc.bold('Examples:')}
  ${pc.green('walwatch upload 0x123... -w 0xabc... -a 100')}
  ${pc.green('walwatch upload 0x123... -w 0xabc... -t 10 -e 20')}
`)
  .action(async (blobId, options) => {
    const spinner = ora('Creating vault...').start();
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.createVault({
        blob_id: blobId,
        wallet_address: options.wallet || '',
        initial_wal_amount: options.amount ?? '100',
        renew_threshold_epochs: parseInt(options.threshold),
        renew_by_epochs: parseInt(options.extension),
      });
      spinner.succeed('Vault created successfully');
      formatJson(result);
    } catch (err: unknown) {
      spinner.fail(`Upload failed: ${safeError(err)}`);
      process.exit(1);
    }
  });

// ==================== renew ====================

program
  .command('renew')
  .description('Trigger a renewal job for a blob')
  .requiredOption('--blob-id <id>', 'Blob registration ID')
  .option('-j, --justification <text>', 'Reason for renewal')
  .option('--wallet-id <id>', 'Wallet ID')
  .option('--project-id <id>', 'Project ID')
  .option('--policy-id <id>', 'Policy ID')
  .option('-e, --extension <epochs>', 'Extension epochs', '1')
  .addHelpText('after', `
${pc.bold('Examples:')}
  ${pc.green('walwatch renew --blob-id <uuid>')}
  ${pc.green('walwatch renew --blob-id <uuid> --policy-id <uuid> --extension 10')}
`)
  .action(async (options) => {
    const spinner = ora('Triggering renewal...').start();
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {
        blobRegistrationId: options.blobId,
        extensionEpochs: parseInt(options.extension),
      };
      if (options.justification) data.justification = options.justification;
      if (options.walletId) data.walletId = options.walletId;
      if (options.projectId) data.projectId = options.projectId;
      if (options.policyId) data.policyId = options.policyId;
      const job = await client.createRenewalJob(orgId, data as any);
      spinner.succeed(`Renewal job created: ${pc.bold(job.id)} — status: ${pc.cyan(job.status)}`);
    } catch (err: unknown) {
      spinner.fail(`Renewal failed: ${safeError(err)}`);
      process.exit(1);
    }
  });

// ==================== track ====================

program
  .command('track <blob-id>')
  .description('Track blob status')
  .action(async (blobId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const blob = await client.getBlob(orgId, blobId);
      formatJson(blob);
    } catch (err: unknown) {
      console.error(pc.red(`Track failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== status ====================

program
  .command('status')
  .description('Show all vaults status')
  .addHelpText('after', `
${pc.bold('Examples:')}
  ${pc.green('walwatch status')}
`)
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.listBlobs(orgId);
      const policies = await client.listPolicies(orgId);
      console.log(`${pc.bold('Organization:')} ${pc.cyan(orgId)}`);
      console.log(`${pc.bold('Blobs:')} ${result.total}`);
      console.log(`${pc.bold('Policies:')} ${policies.length}`);
      if (result.total > 0) {
        console.log('');
        console.log(pc.bold('Blobs:'));
        for (const b of result.data) {
          const statusColor = b.status === 'active' ? pc.green : b.status === 'expired' ? pc.red : pc.yellow;
          console.log(`  ${pc.dim(b.id)} — ${b.blobId} — ${statusColor(b.status)}${b.suiVaultId ? ` — vault: ${pc.dim(b.suiVaultId)}` : ''}`);
        }
      }
    } catch (err: unknown) {
      console.error(pc.red(`Status failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== projects ====================

const projectsCmd = program
  .command('projects')
  .description('Manage projects');

projectsCmd
  .command('list')
  .description('List all projects')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const projects = await client.listProjects(orgId);
      formatJson(projects);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

projectsCmd
  .command('create <name> <slug>')
  .description('Create a project')
  .option('-d, --description <description>', 'Project description')
  .option('-e, --environment <environment>', 'Environment name')
  .action(async (name, slug, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: { name: string; slug: string; description?: string; environment?: string } = { name, slug };
      if (options.description) data.description = options.description;
      if (options.environment) data.environment = options.environment;
      const project = await client.createProject(orgId, data);
      console.log(`${pc.green('✓')} Project created: ${pc.bold(project.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

projectsCmd
  .command('delete <project-id>')
  .description('Delete a project')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (projectId, options) => {
    const ok = await confirmDestructive(`delete project ${projectId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteProject(orgId, projectId);
      outputResult(result.message, { projectId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== blobs ====================

const blobsCmd = program
  .command('blobs')
  .description('Manage blobs');

blobsCmd
  .command('list')
  .description('List all blobs')
  .option('-s, --search <query>', 'Search blobs')
  .option('--status <status>', 'Filter by status')
  .action(async (options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.listBlobs(orgId, { search: options.search, status: options.status });
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

blobsCmd
  .command('get <blob-id>')
  .description('Get blob details')
  .action(async (blobId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const blob = await client.getBlob(orgId, blobId);
      formatJson(blob);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

blobsCmd
  .command('delete <blob-id>')
  .description('Delete a blob')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (blobId, options) => {
    const ok = await confirmDestructive(`delete blob ${blobId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteBlob(orgId, blobId);
      outputResult(result.message, { blobId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== wallets ====================

const walletsCmd = program
  .command('wallets')
  .description('Manage wallets');

walletsCmd
  .command('list')
  .description('List all wallets')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const wallets = await client.listWallets(orgId);
      formatJson(wallets);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

walletsCmd
  .command('create <address>')
  .description('Register a wallet')
  .option('-l, --label <label>', 'Wallet label')
  .option('-t, --type <type>', 'Wallet type (owned|watch-only)', 'owned')
  .action(async (address, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const wallet = await client.createWallet(orgId, { address, label: options.label, type: options.type });
      console.log(`${pc.green('✓')} Wallet created: ${pc.bold(wallet.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== orgs ====================

const orgsCmd = program
  .command('orgs')
  .description('Manage organizations');

orgsCmd
  .command('list')
  .description('List organizations')
  .action(async () => {
    try {
      const client = createClient();
      const orgs = await client.listOrganizations();
      formatJson(orgs);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

orgsCmd
  .command('create <name> <slug>')
  .description('Create an organization')
  .action(async (name, slug) => {
    try {
      const client = createClient();
      const org = await client.createOrganization(name, slug);
      console.log(`${pc.green('✓')} Organization created: ${pc.bold(org.id)}`);
      const config = loadConfig();
      if (!config.org_id) {
        saveConfig({ ...config, org_id: org.id });
        console.log(`${pc.dim('Set as default org_id in config')}`);
      }
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

orgsCmd
  .command('delete <org-id>')
  .description('Delete an organization')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (orgId, options) => {
    const ok = await confirmDestructive(`delete organization ${orgId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const result = await client.deleteOrganization(orgId);
      outputResult(result.message, { orgId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== policies ====================

const policiesCmd = program
  .command('policies')
  .description('Manage renewal policies');

policiesCmd
  .command('list')
  .description('List all policies')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const policies = await client.listPolicies(orgId);
      formatJson(policies);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('create <name>')
  .description('Create a policy')
  .requiredOption('-t, --threshold <epochs>', 'Renew threshold epochs')
  .requiredOption('-e, --extension <epochs>', 'Renew by epochs')
  .option('-d, --description <description>', 'Policy description')
  .option('--max-epochs <epochs>', 'Max total epochs')
  .option('--inactive', 'Create as inactive (default active)')
  .addHelpText('after', `
${pc.bold('Examples:')}
  ${pc.green('walwatch policies create auto-renew -t 5 -e 10')}
  ${pc.green('walwatch policies create long-term -t 10 -e 20 --max-epochs 100')}
`)
  .action(async (name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: { name: string; description?: string; renewThreshold: number; renewExtension: number; maxTotalEpochs?: number; active?: boolean } = {
        name,
        renewThreshold: parseInt(options.threshold),
        renewExtension: parseInt(options.extension),
      };
      if (options.description) data.description = options.description;
      if (options.maxEpochs) data.maxTotalEpochs = parseInt(options.maxEpochs);
      if (options.inactive) data.active = false;
      const policy = await client.createPolicy(orgId, data);
      console.log(`${pc.green('✓')} Policy created: ${pc.bold(policy.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('delete <policy-id>')
  .description('Delete a policy')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (policyId, options) => {
    const ok = await confirmDestructive(`delete policy ${policyId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deletePolicy(orgId, policyId);
      outputResult(result.message, { policyId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('assign <policy-id> <blob-ids...>')
  .description('Assign policy to one or more blobs')
  .action(async (policyId, blobIds) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.assignPolicy(orgId, policyId, blobIds);
      console.log(`${pc.green('✓')} Assigned to ${pc.bold(String(result.assigned))} blob(s)`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('unassign <policy-id> <blob-ids...>')
  .description('Unassign policy from one or more blobs')
  .action(async (policyId, blobIds) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.unassignPolicy(orgId, policyId, blobIds);
      console.log(`${pc.green('✓')} Unassigned from ${pc.bold(String(result.unassigned))} blob(s)`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('update <policy-id>')
  .description('Update a policy')
  .option('-n, --name <name>', 'New name')
  .option('-d, --description <description>', 'New description')
  .option('-t, --threshold <epochs>', 'New renew threshold epochs')
  .option('-e, --extension <epochs>', 'New renew by epochs')
  .option('--max-epochs <epochs>', 'New max total epochs')
  .action(async (policyId, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.description) data.description = options.description;
      if (options.threshold) data.renewThreshold = parseInt(options.threshold);
      if (options.extension) data.renewExtension = parseInt(options.extension);
      if (options.maxEpochs) data.maxTotalEpochs = parseInt(options.maxEpochs);
      const policy = await client.updatePolicy(orgId, policyId, data);
      console.log(`${pc.green('✓')} Policy updated: ${pc.bold(policy.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('pause <policy-id>')
  .description('Pause a policy')
  .action(async (policyId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.pausePolicy(orgId, policyId);
      outputResult(result.message, { policyId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('activate <policy-id>')
  .description('Activate a paused policy')
  .action(async (policyId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.activatePolicy(orgId, policyId);
      outputResult(result.message, { policyId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

policiesCmd
  .command('archive <policy-id>')
  .description('Archive a policy')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (policyId, options) => {
    const ok = await confirmDestructive(`archive policy ${policyId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.archivePolicy(orgId, policyId);
      outputResult(result.message, { policyId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== analytics ====================

const analyticsCmd = program
  .command('analytics')
  .description('View analytics');

analyticsCmd
  .command('overview')
  .description('Get analytics overview')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data = await client.getAnalyticsOverview(orgId);
      formatJson(data);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

analyticsCmd
  .command('storage')
  .description('Get storage analytics')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data = await client.getAnalyticsStorage(orgId);
      formatJson(data);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

analyticsCmd
  .command('renewals')
  .description('Get renewal analytics')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data = await client.getAnalyticsRenewals(orgId);
      formatJson(data);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

analyticsCmd
  .command('costs')
  .description('Get cost analytics')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data = await client.getAnalyticsCosts(orgId);
      formatJson(data);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

analyticsCmd
  .command('forecasts')
  .description('Get forecast analytics')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data = await client.getAnalyticsForecasts(orgId);
      formatJson(data);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== channels ====================

const channelsCmd = program
  .command('channels')
  .description('Manage notification channels');

channelsCmd
  .command('list')
  .description('List all notification channels')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const channels = await client.listChannels(orgId);
      formatJson(channels);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

channelsCmd
  .command('create <type> <name>')
  .description('Create a notification channel')
  .option('--config <json>', 'Channel config as JSON string', '{}')
  .option('--disabled', 'Create as disabled (default enabled)')
  .action(async (type, name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const config = JSON.parse(options.config);
      const channel = await client.createChannel(orgId, { type, name, config, enabled: !options.disabled });
      console.log(`${pc.green('✓')} Channel created: ${pc.bold(channel.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

channelsCmd
  .command('update <channel-id>')
  .description('Update a notification channel')
  .option('-n, --name <name>', 'New name')
  .option('--config <json>', 'Channel config as JSON string')
  .option('--enable', 'Enable channel')
  .option('--disable', 'Disable channel')
  .action(async (channelId, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.config) data.config = JSON.parse(options.config);
      if (options.enable) data.enabled = true;
      if (options.disable) data.enabled = false;
      const channel = await client.updateChannel(orgId, channelId, data);
      console.log(`${pc.green('✓')} Channel updated: ${pc.bold(channel.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

channelsCmd
  .command('delete <channel-id>')
  .description('Delete a notification channel')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (channelId, options) => {
    const ok = await confirmDestructive(`delete channel ${channelId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteChannel(orgId, channelId);
      outputResult(result.message, { channelId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== alert-rules ====================

const alertRulesCmd = program
  .command('alert-rules')
  .description('Manage alert rules');

alertRulesCmd
  .command('list')
  .description('List all alert rules')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const rules = await client.listAlertRules(orgId);
      formatJson(rules);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

alertRulesCmd
  .command('create <name> <trigger>')
  .description('Create an alert rule')
  .option('--channel-ids <ids>', 'Comma-separated channel IDs')
  .option('--project-ids <ids>', 'Comma-separated project IDs')
  .option('--disabled', 'Create as disabled (default enabled)')
  .action(async (name, trigger, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: { name: string; trigger: string; channelIds?: string[]; projectIds?: string[]; enabled?: boolean } = { name, trigger };
      if (options.channelIds) data.channelIds = options.channelIds.split(',');
      if (options.projectIds) data.projectIds = options.projectIds.split(',');
      if (options.disabled) data.enabled = false;
      const rule = await client.createAlertRule(orgId, data);
      console.log(`${pc.green('✓')} Alert rule created: ${pc.bold(rule.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

alertRulesCmd
  .command('update <rule-id>')
  .description('Update an alert rule')
  .option('-n, --name <name>', 'New name')
  .option('-t, --trigger <trigger>', 'New trigger')
  .option('--channel-ids <ids>', 'Comma-separated channel IDs')
  .option('--project-ids <ids>', 'Comma-separated project IDs')
  .option('--enable', 'Enable rule')
  .option('--disable', 'Disable rule')
  .action(async (ruleId, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.trigger) data.trigger = options.trigger;
      if (options.channelIds) data.channelIds = options.channelIds.split(',');
      if (options.projectIds) data.projectIds = options.projectIds.split(',');
      if (options.enable) data.enabled = true;
      if (options.disable) data.enabled = false;
      const rule = await client.updateAlertRule(orgId, ruleId, data);
      console.log(`${pc.green('✓')} Alert rule updated: ${pc.bold(rule.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

alertRulesCmd
  .command('delete <rule-id>')
  .description('Delete an alert rule')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (ruleId, options) => {
    const ok = await confirmDestructive(`delete alert rule ${ruleId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteAlertRule(orgId, ruleId);
      outputResult(result.message, { ruleId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== billing ====================

const billingCmd = program
  .command('billing')
  .description('View billing information');

billingCmd
  .command('subscription')
  .description('Get current subscription')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const sub = await client.getSubscription(orgId);
      formatJson(sub);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

billingCmd
  .command('invoices')
  .description('List invoices')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const invoices = await client.listInvoices(orgId);
      formatJson(invoices);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

billingCmd
  .command('usage')
  .description('Get usage records')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const usage = await client.getUsage(orgId);
      formatJson(usage);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== api-keys ====================

const apiKeysCmd = program
  .command('api-keys')
  .description('Manage API keys');

apiKeysCmd
  .command('list')
  .description('List all API keys')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const keys = await client.listApiKeys(orgId);
      formatJson(keys);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

apiKeysCmd
  .command('create <name>')
  .description('Create an API key')
  .option('-p, --permissions <perms>', 'Comma-separated permissions')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const permissions = options.permissions ? options.permissions.split(',') : undefined;
      const result = await client.createApiKey(orgId, { name, permissions });
      console.log(pc.green('✓') + ' API key created:');
      console.log(`  ${pc.bold('ID:')}    ${result.id}`);
      console.log(`  ${pc.bold('Name:')}  ${result.name}`);
      console.log(`  ${pc.bold('Key:')}   ${pc.yellow(result.rawKey)}`);
      console.log(`  ${pc.dim('Store this key securely — it will not be shown again.')}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

apiKeysCmd
  .command('delete <key-id>')
  .description('Delete an API key')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (keyId, options) => {
    const ok = await confirmDestructive(`delete API key ${keyId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteApiKey(orgId, keyId);
      outputResult(result.message, { keyId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== members ====================

const membersCmd = program
  .command('members')
  .description('Manage organization members');

membersCmd
  .command('list')
  .description('List all members')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const members = await client.listMembers(orgId);
      formatJson(members);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

membersCmd
  .command('add <email> <role>')
  .description('Add a member to the organization')
  .action(async (email, role) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.addMember(orgId, email, role);
      console.log(pc.green('✓') + ' ' + result.message);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

membersCmd
  .command('update-role <user-id> <role>')
  .description('Update a member role')
  .action(async (userId, role) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.updateMemberRole(orgId, userId, role);
      console.log(pc.green('✓') + ' ' + result.message);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

membersCmd
  .command('remove <user-id>')
  .description('Remove a member from the organization')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (userId, options) => {
    const ok = await confirmDestructive(`remove member ${userId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.removeMember(orgId, userId);
      outputResult(result.message, { userId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== vaults ====================

const vaultsCmd = program
  .command('vaults')
  .description('Manage vaults');

vaultsCmd
  .command('deposit <vault-id> <amount>')
  .description('Deposit WAL into a vault')
  .requiredOption('-w, --wallet <address>', 'Wallet address')
  .action(async (vaultId, amount, options) => {
    try {
      const client = createClient();
      const result = await client.depositToVault(vaultId, { wallet_address: options.wallet, amount });
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Deposit failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

vaultsCmd
  .command('withdraw <vault-id> <amount>')
  .description('Withdraw WAL from a vault')
  .requiredOption('-w, --wallet <address>', 'Wallet address')
  .action(async (vaultId, amount, options) => {
    try {
      const client = createClient();
      const result = await client.withdrawFromVault(vaultId, { wallet_address: options.wallet, amount });
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Withdraw failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

vaultsCmd
  .command('reclaim <vault-id>')
  .description('Reclaim a vault')
  .requiredOption('-w, --wallet <address>', 'Wallet address')
  .action(async (vaultId, options) => {
    try {
      const client = createClient();
      const result = await client.reclaimFromVault(vaultId, { wallet_address: options.wallet });
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Reclaim failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

vaultsCmd
  .command('history <vault-id>')
  .description('Get vault transaction history')
  .option('--page <page>', 'Page number')
  .option('--limit <limit>', 'Items per page')
  .action(async (vaultId, options) => {
    try {
      const client = createClient();
      const page = options.page ? parseInt(options.page) : undefined;
      const limit = options.limit ? parseInt(options.limit) : undefined;
      const result = await client.getVaultHistory(vaultId, page, limit);
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`History failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== completion ====================

program
  .command('completion')
  .description('Generate shell completion script')
  .argument('<shell>', 'Shell type (bash, zsh, fish)')
  .addHelpText('after', `
${pc.bold('Installation:')}
  ${pc.dim('# bash')}
  ${pc.green('walwatch completion bash > /etc/bash_completion.d/walwatch')}
  ${pc.dim('  or')}
  ${pc.green('source <(walwatch completion bash)')}

  ${pc.dim('# zsh')}
  ${pc.green('walwatch completion zsh > "${fpath[1]}/_walwatch"')}
  ${pc.dim('  or')}
  ${pc.green('source <(walwatch completion zsh)')}

  ${pc.dim('# fish')}
  ${pc.green('walwatch completion fish > ~/.config/fish/completions/walwatch.fish')}
`)
  .action((shell: string) => {
    const validShells = ['bash', 'zsh', 'fish'];
    if (!validShells.includes(shell)) {
      console.error(pc.red(`Unsupported shell: ${shell}. Supported: ${validShells.join(', ')}`));
      process.exit(1);
    }

    const cmdName = program.name();
    const commands = program.commands.map(c => ({ name: c.name(), desc: c.description() }));

    if (shell === 'bash') {
      const lines: string[] = [
        `_${cmdName}_completions() {`,
        '  local cur prev opts',
        '  COMPREPLY=()',
        '  cur="${COMP_WORDS[COMP_CWORD]}"',
        '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
        `  opts="$(${cmdName} --help | grep -oP '^  \\K[a-z][a-z-]+(?= )' | tr '\\n' ' ')"`,
        '',
        '  if [[ ${cur} == -* ]] ; then',
        '    COMPREPLY=($(compgen -W "--help --version" -- "${cur}"))',
        `  elif [[ \${prev} == ${cmdName} ]] ; then`,
        '    COMPREPLY=($(compgen -W "${opts}" -- "${cur}"))',
        '  fi',
        '  return 0',
        '}',
        `complete -F _${cmdName}_completions ${cmdName}`,
      ];
      console.log(lines.join('\n'));
    } else if (shell === 'zsh') {
      const cmdLines = commands.map(c => `    '${c.name}:${c.desc}'`).join('\n');
      console.log(`#compdef ${cmdName}

_${cmdName}() {
  local -a commands
  commands=(
${cmdLines}
  )

  _describe 'command' commands
}

_${cmdName} "$@"`);
    } else if (shell === 'fish') {
      const fishLines = commands.map(c => `complete -c ${cmdName} -n "__fish_use_subcommand" -a ${c.name} -d "${c.desc}"`).join('\n');
      console.log(`complete -c ${cmdName} -f

${fishLines}
`);
    }
  });

// ==================== schedules ====================
const schedulesCmd = program
  .command('schedules')
  .description('Manage schedules');

schedulesCmd
  .command('list')
  .description('List all schedules')
  .option('-t, --type <type>', 'Filter by type (system|user)')
  .action(async (options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const schedules = await client.listSchedules(orgId, { type: options.type });
      formatJson(schedules);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

schedulesCmd
  .command('create <name>')
  .description('Create a schedule')
  .requiredOption('-c, --cron <expression>', 'Cron expression')
  .option('-t, --type <type>', 'Schedule type (system|user)', 'user')
  .option('--config <json>', 'Config as JSON string', '{}')
  .option('--min-interval <ms>', 'Minimum interval in ms')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = { name, cronExpr: options.cron, type: options.type, config: JSON.parse(options.config) };
      if (options.minInterval) data.minIntervalMs = parseInt(options.minInterval);
      const schedule = await client.createSchedule(orgId, data);
      console.log(`${pc.green('✓')} Schedule created: ${pc.bold(schedule.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

schedulesCmd
  .command('update <schedule-id>')
  .description('Update a schedule')
  .option('-n, --name <name>', 'New name')
  .option('-c, --cron <expression>', 'New cron expression')
  .option('--enable', 'Enable schedule')
  .option('--disable', 'Disable schedule')
  .action(async (scheduleId, options) => {
    try {
      const client = createClient();
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.cron) data.cronExpr = options.cron;
      if (options.enable) data.enabled = true;
      if (options.disable) data.enabled = false;
      const schedule = await client.updateSchedule(scheduleId, data);
      console.log(`${pc.green('✓')} Schedule updated: ${pc.bold(schedule.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

schedulesCmd
  .command('delete <schedule-id>')
  .description('Delete a schedule')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (scheduleId, options) => {
    const ok = await confirmDestructive(`delete schedule ${scheduleId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const result = await client.deleteSchedule(scheduleId);
      outputResult(result.message, { scheduleId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== dashboard ====================
const dashboardCmd = program
  .command('dashboard')
  .description('View dashboard data');

dashboardCmd
  .command('summary')
  .description('Get dashboard summary')
  .option('-p, --project <id>', 'Project ID to filter')
  .action(async (options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const summary = await client.getDashboardSummary(orgId, options.project);
      formatJson(summary);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== webhooks ====================
const webhooksCmd = program
  .command('webhooks')
  .description('Manage webhooks');

webhooksCmd
  .command('list')
  .description('List all webhooks')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const webhooks = await client.listWebhooks(orgId);
      formatJson(webhooks);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create <name> <url>')
  .description('Create a webhook')
  .option('--events <events>', 'Comma-separated event types')
  .action(async (name, url, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = { name, url };
      if (options.events) data.events = options.events.split(',');
      const webhook = await client.createWebhook(orgId, data);
      console.log(`${pc.green('✓')} Webhook created: ${pc.bold(webhook.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <webhook-id>')
  .description('Update a webhook')
  .option('-n, --name <name>', 'New name')
  .option('-u, --url <url>', 'New URL')
  .option('--events <events>', 'Comma-separated event types')
  .option('--enable', 'Enable webhook')
  .option('--disable', 'Disable webhook')
  .action(async (webhookId, options) => {
    try {
      const client = createClient();
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.url) data.url = options.url;
      if (options.events) data.events = options.events.split(',');
      if (options.enable) data.enabled = true;
      if (options.disable) data.enabled = false;
      const webhook = await client.updateWebhook(webhookId, data);
      console.log(`${pc.green('✓')} Webhook updated: ${pc.bold(webhook.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <webhook-id>')
  .description('Delete a webhook')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (webhookId, options) => {
    const ok = await confirmDestructive(`delete webhook ${webhookId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const result = await client.deleteWebhook(webhookId);
      outputResult(result.message, { webhookId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

webhooksCmd
  .command('test <webhook-id>')
  .description('Test a webhook')
  .action(async (webhookId) => {
    try {
      const client = createClient();
      const result = await client.testWebhook(webhookId);
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== alerts ====================
const alertsCmd = program
  .command('alerts')
  .description('Manage alert events');

alertsCmd
  .command('list')
  .description('List alert events')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const alerts = await client.listAlertEvents(orgId, { status: options.status });
      formatJson(alerts);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

alertsCmd
  .command('acknowledge <alert-id>')
  .description('Acknowledge an alert event')
  .action(async (alertId) => {
    try {
      const client = createClient();
      const result = await client.acknowledgeAlertEvent(alertId);
      console.log(pc.green('✓') + ' Alert acknowledged');
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== budgets ====================
const budgetsCmd = program
  .command('budgets')
  .description('Manage budgets');

budgetsCmd
  .command('list')
  .description('List all budgets')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const budgets = await client.listBudgets(orgId);
      formatJson(budgets);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

budgetsCmd
  .command('create <name> <amount>')
  .description('Create a budget')
  .option('-p, --project <id>', 'Project ID')
  .option('--period <period>', 'Period (daily|weekly|monthly|quarterly|yearly)')
  .option('-t, --threshold <percent>', 'Alert threshold percent')
  .action(async (name, amount, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: { name: string; amount: number; projectId?: string; period?: string; alertThreshold?: number } = { name, amount: parseInt(amount) };
      if (options.project) data.projectId = options.project;
      if (options.period) data.period = options.period;
      if (options.threshold) data.alertThreshold = parseInt(options.threshold);
      const budget = await client.createBudget(orgId, data);
      console.log(`${pc.green('✓')} Budget created: ${pc.bold(budget.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

budgetsCmd
  .command('update <budget-id>')
  .description('Update a budget')
  .option('-n, --name <name>', 'New name')
  .option('-a, --amount <amount>', 'New amount')
  .option('--period <period>', 'New period')
  .option('-t, --threshold <percent>', 'New alert threshold percent')
  .action(async (budgetId, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.amount) data.amount = parseInt(options.amount);
      if (options.period) data.period = options.period;
      if (options.threshold) data.alertThreshold = parseInt(options.threshold);
      const budget = await client.updateBudget(orgId, budgetId, data);
      console.log(`${pc.green('✓')} Budget updated: ${pc.bold(budget.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

budgetsCmd
  .command('pause <budget-id>')
  .description('Pause a budget')
  .action(async (budgetId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.pauseBudget(orgId, budgetId);
      outputResult(result.message, { budgetId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

budgetsCmd
  .command('activate <budget-id>')
  .description('Activate a budget')
  .action(async (budgetId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.activateBudget(orgId, budgetId);
      outputResult(result.message, { budgetId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

budgetsCmd
  .command('archive <budget-id>')
  .description('Archive a budget')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (budgetId, options) => {
    const ok = await confirmDestructive(`archive budget ${budgetId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.archiveBudget(orgId, budgetId);
      outputResult(result.message, { budgetId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== spending-limits ====================
const spendingLimitsCmd = program
  .command('spending-limits')
  .description('Manage spending limits');

spendingLimitsCmd
  .command('list')
  .description('List all spending limits')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const limits = await client.listSpendingLimits(orgId);
      formatJson(limits);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

spendingLimitsCmd
  .command('create <name> <amount>')
  .description('Create a spending limit')
  .requiredOption('-w, --wallet <id>', 'Wallet ID')
  .option('--period <period>', 'Period (daily|weekly|monthly|quarterly|yearly)')
  .action(async (name, amount, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: { walletId: string; amount: number; name?: string; period?: string } = { walletId: options.wallet, amount: parseInt(amount), name };
      if (options.period) data.period = options.period;
      const limit = await client.createSpendingLimit(orgId, data);
      console.log(`${pc.green('✓')} Spending limit created: ${pc.bold(limit.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

spendingLimitsCmd
  .command('update <limit-id>')
  .description('Update a spending limit')
  .option('-n, --name <name>', 'New name')
  .option('-a, --amount <amount>', 'New amount')
  .option('--period <period>', 'New period')
  .action(async (limitId, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.amount) data.amount = parseInt(options.amount);
      if (options.period) data.period = options.period;
      const limit = await client.updateSpendingLimit(orgId, limitId, data);
      console.log(`${pc.green('✓')} Spending limit updated: ${pc.bold(limit.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

spendingLimitsCmd
  .command('pause <limit-id>')
  .description('Pause a spending limit')
  .action(async (limitId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.pauseSpendingLimit(orgId, limitId);
      outputResult('Spending limit paused', { limitId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

spendingLimitsCmd
  .command('activate <limit-id>')
  .description('Activate a spending limit')
  .action(async (limitId) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.activateSpendingLimit(orgId, limitId);
      outputResult('Spending limit activated', { limitId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

spendingLimitsCmd
  .command('archive <limit-id>')
  .description('Archive a spending limit')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (limitId, options) => {
    const ok = await confirmDestructive(`archive spending limit ${limitId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.archiveSpendingLimit(orgId, limitId);
      outputResult(result.message, { limitId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== admin ====================
const adminCmd = program
  .command('admin')
  .description('Admin operations');

adminCmd
  .command('health')
  .description('Get system health')
  .action(async () => {
    try {
      const client = createClient();
      const health = await client.adminGetHealth();
      formatJson(health);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

adminCmd
  .command('queues')
  .description('Get queue status')
  .action(async () => {
    try {
      const client = createClient();
      const queues = await client.adminGetQueues();
      formatJson(queues);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

adminCmd
  .command('trigger-scan')
  .description('Trigger a manual scan cycle')
  .requiredOption('-j, --justification <text>', 'Reason for triggering scan')
  .action(async (options) => {
    try {
      const client = createClient();
      const result = await client.adminTriggerScan(options.justification);
      console.log(pc.green('✓') + ' ' + result.message);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

adminCmd
  .command('metrics')
  .description('Get system metrics')
  .action(async () => {
    try {
      const client = createClient();
      const metrics = await client.adminGetMetrics();
      formatJson(metrics);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

adminCmd
  .command('tenants <org-id>')
  .description('Get tenant details')
  .action(async (orgId) => {
    try {
      const client = createClient();
      const data = await client.adminGetTenant(orgId);
      formatJson(data);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

adminCmd
  .command('retry-job <job-id>')
  .description('Retry a failed renewal job (admin)')
  .requiredOption('-j, --justification <text>', 'Reason for retry')
  .action(async (jobId, options) => {
    try {
      const client = createClient();
      const result = await client.adminRetryJob(jobId, { justification: options.justification });
      console.log(`${pc.green('✓')} ${result.message} — job: ${pc.bold(result.job.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== admin flags ====================
const flagsCmd = program
  .command('admin flags')
  .description('Manage feature flags');

flagsCmd
  .command('list')
  .description('List all feature flags')
  .action(async () => {
    try {
      const client = createClient();
      const flags = await client.adminListFlags();
      formatJson(flags);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

flagsCmd
  .command('create <name>')
  .description('Create a feature flag')
  .requiredOption('-t, --type <type>', 'Flag type (release|experiment)')
  .option('-d, --description <text>', 'Description')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const data: Record<string, unknown> = { name, type: options.type };
      if (options.description) data.description = options.description;
      const flag = await client.adminCreateFlag(data);
      console.log(`${pc.green('✓')} Feature flag created: ${pc.bold(flag.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

flagsCmd
  .command('update <flag-id>')
  .description('Update a feature flag')
  .option('-e, --enable', 'Enable flag')
  .option('-d, --disable', 'Disable flag')
  .option('--description <text>', 'Update description')
  .action(async (flagId, options) => {
    try {
      const client = createClient();
      const data: Record<string, unknown> = {};
      if (options.enable) data.enabled = true;
      if (options.disable) data.enabled = false;
      if (options.description) data.description = options.description;
      const flag = await client.adminUpdateFlag(flagId, data);
      console.log(`${pc.green('✓')} Feature flag updated: ${pc.bold(flag.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

flagsCmd
  .command('delete <flag-id>')
  .description('Delete a feature flag')
  .action(async (flagId) => {
    try {
      const client = createClient();
      await client.adminDeleteFlag(flagId);
      console.log(pc.green('✓') + ' Feature flag deleted');
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

flagsCmd
  .command('check <flag-id>')
  .description('Check if a feature flag is active')
  .option('-o, --org <id>', 'Organization ID to check against')
  .action(async (flagId, options) => {
    try {
      const client = createClient();
      const result = await client.adminCheckFlag(flagId, options.org);
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== publishers ====================
const publishersCmd = program
  .command('publishers')
  .description('Manage publishers');

publishersCmd
  .command('list')
  .description('List all publishers')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const publishers = await client.listPublishers(orgId);
      formatJson(publishers);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

publishersCmd
  .command('create <name>')
  .description('Create a publisher')
  .option('-d, --description <description>', 'Description')
  .option('-e, --endpoint <endpoint>', 'Endpoint URL')
  .option('-w, --wallet <address>', 'Wallet address')
  .option('--vault <vaultId>', 'Sui vault ID')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const publisher = await client.createPublisher(orgId, {
        name,
        description: options.description,
        endpoint: options.endpoint,
        walletAddress: options.wallet,
        suiVaultId: options.vault,
      });
      outputResult(`Publisher created: ${publisher.id}`, { publisher });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

publishersCmd
  .command('update <id>')
  .description('Update a publisher')
  .option('-n, --name <name>', 'New name')
  .option('-d, --description <description>', 'New description')
  .option('-e, --endpoint <endpoint>', 'New endpoint URL')
  .action(async (id, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const data: Record<string, unknown> = {};
      if (options.name) data.name = options.name;
      if (options.description) data.description = options.description;
      if (options.endpoint) data.endpoint = options.endpoint;
      const publisher = await client.updatePublisher(orgId, id, data);
      outputResult(`Publisher updated: ${publisher.id}`, { publisher });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

publishersCmd
  .command('delete <id>')
  .description('Delete a publisher')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const ok = await confirmDestructive(`delete publisher ${id}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deletePublisher(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

publishersCmd
  .command('heartbeat <id>')
  .description('Send a heartbeat for a publisher')
  .action(async (id) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.publisherHeartbeat(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== aggregators ====================
const aggregatorsCmd = program
  .command('aggregators')
  .description('Manage aggregators');

aggregatorsCmd
  .command('list')
  .description('List all aggregators')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const aggregators = await client.listAggregators(orgId);
      formatJson(aggregators);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

aggregatorsCmd
  .command('create <name>')
  .description('Create an aggregator')
  .option('-p, --publisher <publisherId>', 'Publisher ID')
  .option('-e, --endpoint <endpoint>', 'Endpoint URL')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const aggregator = await client.createAggregator(orgId, {
        name,
        publisherId: options.publisher,
        endpoint: options.endpoint,
      });
      outputResult(`Aggregator created: ${aggregator.id}`, { aggregator });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

aggregatorsCmd
  .command('delete <id>')
  .description('Delete an aggregator')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const ok = await confirmDestructive(`delete aggregator ${id}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteAggregator(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== renewal-jobs ====================
const renewalJobsCmd = program
  .command('renewal-jobs')
  .description('Manage renewal jobs');

renewalJobsCmd
  .command('list')
  .description('List renewal jobs')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const jobs = await client.listRenewalJobs(orgId, { status: options.status });
      formatJson(jobs);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

renewalJobsCmd
  .command('get <id>')
  .description('Get a renewal job')
  .action(async (id) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const job = await client.getRenewalJob(orgId, id);
      formatJson(job);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

renewalJobsCmd
  .command('retry <id>')
  .description('Retry a failed renewal job')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const ok = await confirmDestructive(`retry renewal job ${id}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.retryRenewalJob(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

renewalJobsCmd
  .command('cancel <id>')
  .description('Cancel a renewal job')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const ok = await confirmDestructive(`cancel renewal job ${id}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.cancelRenewalJob(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== teams ====================
const teamsCmd = program
  .command('teams')
  .description('Manage teams');

teamsCmd
  .command('list')
  .description('List all teams')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const teams = await client.listTeams(orgId);
      formatJson(teams);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

teamsCmd
  .command('create <name>')
  .description('Create a team')
  .option('-d, --description <description>', 'Description')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const team = await client.createTeam(orgId, { name, description: options.description });
      outputResult(`Team created: ${team.id}`, { team });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

teamsCmd
  .command('delete <id>')
  .description('Delete a team')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const ok = await confirmDestructive(`delete team ${id}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.deleteTeam(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

teamsCmd
  .command('add-member <team-id> <user-id>')
  .description('Add a member to a team')
  .option('-r, --role <role>', 'Role in team')
  .action(async (teamId, userId, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const member = await client.addTeamMember(orgId, teamId, userId, options.role);
      outputResult(`Member added to team`, { member });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

teamsCmd
  .command('remove-member <team-id> <user-id>')
  .description('Remove a member from a team')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (teamId, userId, options) => {
    const ok = await confirmDestructive(`remove member ${userId} from team ${teamId}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.removeTeamMember(orgId, teamId, userId);
      outputResult(result.message, { teamId, userId });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== invitations ====================
const invitationsCmd = program
  .command('invitations')
  .description('Manage invitations');

invitationsCmd
  .command('list')
  .description('List all invitations')
  .action(async () => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const invitations = await client.listInvitations(orgId);
      formatJson(invitations);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

invitationsCmd
  .command('create <email>')
  .description('Invite a user')
  .option('-r, --role <role>', 'Role (admin, member, viewer)', 'member')
  .action(async (email, options) => {
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const invitation = await client.createInvitation(orgId, { email, role: options.role });
      outputResult(`Invitation sent to ${email}`, { invitation });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

invitationsCmd
  .command('cancel <id>')
  .description('Cancel an invitation')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const ok = await confirmDestructive(`cancel invitation ${id}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      const orgId = requireOrg(client);
      const result = await client.cancelInvitation(orgId, id);
      outputResult(result.message, { id });
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== activity-feed ====================
const activityFeedCmd = program
  .command('activity-feed')
  .description('Manage activity feed');

activityFeedCmd
  .command('list')
  .description('List activity feed entries')
  .option('--org <id>', 'Organization ID')
  .option('--limit <limit>', 'Items per page')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--entity-type <type>', 'Filter by resource type')
  .action(async (options) => {
    try {
      const client = createClient();
      const orgId = options.org || requireOrg(client);
      const params: { limit?: number; cursor?: string; resourceType?: string } = {};
      if (options.limit) params.limit = parseInt(options.limit);
      if (options.cursor) params.cursor = options.cursor;
      if (options.entityType) params.resourceType = options.entityType;
      const result = await client.listActivityFeed(orgId, params);
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

// ==================== experiments ====================
const experimentsCmd = program
  .command('experiments')
  .description('Manage experiments');

experimentsCmd
  .command('list')
  .description('List all experiments')
  .action(async () => {
    try {
      const client = createClient();
      const experiments = await client.listExperiments();
      formatJson(experiments);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

experimentsCmd
  .command('create <name>')
  .description('Create (assign) an experiment')
  .requiredOption('-o, --org <id>', 'Organization ID')
  .requiredOption('-v, --variant <variant>', 'Variant name')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const assignment = await client.assignExperiment(name, options.org, options.variant);
      console.log(`${pc.green('✓')} Experiment assigned: ${pc.bold(assignment.id)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

experimentsCmd
  .command('get <name>')
  .description('Get experiment assignments')
  .action(async (name) => {
    try {
      const client = createClient();
      const assignments = await client.getExperiment(name);
      formatJson(assignments);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

experimentsCmd
  .command('delete <name>')
  .description('Delete an experiment (all assignments)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (name, options) => {
    const ok = await confirmDestructive(`delete experiment ${name}`, options);
    if (!ok) return;
    try {
      const client = createClient();
      await client.adminDeleteExperiment(name);
      console.log(`${pc.green('✓')} Experiment deleted: ${pc.bold(name)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

experimentsCmd
  .command('assign <name>')
  .description('Assign an organization to an experiment')
  .requiredOption('-o, --org <id>', 'Organization ID')
  .requiredOption('-v, --variant <variant>', 'Variant name')
  .action(async (name, options) => {
    try {
      const client = createClient();
      const assignment = await client.assignExperiment(name, options.org, options.variant);
      console.log(`${pc.green('✓')} Assigned org ${pc.bold(options.org)} to ${pc.bold(name)} with variant ${pc.cyan(options.variant)}`);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

experimentsCmd
  .command('variant <name>')
  .description('Get experiment variant for current org')
  .action(async (name) => {
    try {
      const client = createClient();
      const result = await client.getExperimentVariant(name);
      formatJson(result);
    } catch (err: unknown) {
      console.error(pc.red(`Failed: ${safeError(err)}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
