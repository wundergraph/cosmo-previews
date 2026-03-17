import { existsSync, readFileSync } from 'node:fs';
import * as core from '@actions/core';
import * as yaml from 'js-yaml';
import { resolve } from 'pathe';
import { actionInputSchema, configSchema } from './schema';
import type { Inputs } from './types';

export const getInputs = (): Inputs | undefined => {
  const configPath = core.getInput('config_path') || '.github/cosmo.yaml';
  const cosmoApiKey = core.getInput('cosmo_api_key', { required: true });
  const githubToken = core.getInput('github_token', { required: true });
  const action = core.getInput('action', { required: true });
  const stage = core.getInput('stage', { required: true });

  if (!githubToken) {
    core.setFailed('GITHUB_TOKEN is not available.');
    return;
  }

  const actionResult = actionInputSchema.safeParse({ action, stage });
  if (!actionResult.success) {
    const formatted = actionResult.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    core.setFailed(`Invalid action/stage combination:\n${formatted}`);
    return;
  }

  const inputFile = resolve(process.cwd(), configPath);

  if (!existsSync(inputFile)) {
    core.setFailed(`The input file '${inputFile}' does not exist. Please check the path.`);
    return;
  }

  const fileContent = readFileSync(inputFile).toString();
  const raw = yaml.load(fileContent);

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    core.setFailed(`Invalid config in '${inputFile}':\n${formatted}`);
    return;
  }

  const config = result.data;

  if (
    actionResult.data.action === 'preview' &&
    (!config.previews || config.previews.length === 0)
  ) {
    core.setFailed(
      `Preview action requires at least one preview in the config file '${inputFile}'.`,
    );
    return;
  }

  if (actionResult.data.action === 'schema' && !config.check) {
    core.setFailed(`Schema action requires a check section in the config file '${inputFile}'.`);
    return;
  }

  // Resolve schema paths to absolute
  const subgraphs = config.subgraphs.map((s) => ({
    ...s,
    schema_path: resolve(process.cwd(), s.schema_path),
  }));

  return {
    action: actionResult.data.action,
    stage: actionResult.data.stage,
    cosmoApiKey,
    githubToken,
    subgraphs,
    previews: config.previews ?? [],
    check: config.check,
    configPath,
  };
};
