import { existsSync, readFileSync } from 'node:fs';
import * as core from '@actions/core';
import * as yaml from 'js-yaml';
import { resolve } from 'pathe';
import { Config, Inputs } from './types.js';

export const getInputs = (): Inputs | undefined => {
  const configPath = core.getInput('config_path') || '.github/cosmo.yaml';
  const cosmoApiKey = core.getInput('cosmo_api_key', { required: true });
  const githubToken = core.getInput('github_token', { required: true });
  const create = core.getInput('create') === 'true';
  const update = core.getInput('update') === 'true';
  const destroy = core.getInput('destroy') === 'true';

  if (!githubToken) {
    core.setFailed('GITHUB_TOKEN is not available.');
    return;
  }

  if (!create && !update && !destroy) {
    core.setFailed('Please provide at least one action type to perform. Either create, update, or destroy.');
    return;
  }

  // Ensure only one of create, update, or destroy is true
  const trueCount = [create, update, destroy].filter(Boolean).length;
  if (trueCount !== 1) {
    core.setFailed('Exactly one of "create", "update", or "destroy" must be true.');
    return;
  }

  const actionType = create ? 'create' : update ? 'update' : 'destroy';

  const inputFile = resolve(process.cwd(), configPath);

  if (!existsSync(inputFile)) {
    core.setFailed(`The input file '${inputFile}' does not exist. Please check the path.`);
    return;
  }

  const fileContent = readFileSync(inputFile).toString();
  const config = yaml.load(fileContent) as Config;

  const namespace = config.namespace;

  if (!config.feature_flags || config.feature_flags.length === 0) {
    core.setFailed(`Please provide at least one feature flag in the config file '${inputFile}'.`);
    return;
  }
  const featureFlags = config.feature_flags;

  if (!config.subgraphs || config.subgraphs.length === 0) {
    core.setFailed(`Please provide at least one subgraph in the config file '${inputFile}'.`);
    return;
  }
  const subgraphs = config.subgraphs.map((subgraph) => {
    return {
      name: subgraph.name,
      schemaPath: resolve(process.cwd(), subgraph.schema_path),
      routingUrl: subgraph.routing_url,
    };
  });

  return {
    actionType,
    cosmoApiKey,
    githubToken,
    namespace,
    featureFlags,
    subgraphs,
    configPath,
  };
};
