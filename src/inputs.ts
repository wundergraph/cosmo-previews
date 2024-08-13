import { existsSync, readFileSync } from 'node:fs';
import * as core from '@actions/core';
import * as yaml from 'js-yaml';
import { dirname, resolve } from 'pathe';

export type Config = {
  namespace: string;
  feature_flags: FeatureFlag[];
  subgraphs: {
    name: string;
    schema_path: string;
    routing_url: string;
  }[];
};

export type FeatureFlag = {
  name: string;
  labels: string[];
};

export type Subgraph = {
  name: string;
  schemaPath: string;
  routingUrl: string;
};

export type ActionType = 'create' | 'update' | 'destroy';

export type Inputs = {
  cosmoApiKey: string;
  actionType: ActionType;
  namespace: string;
  featureFlags: FeatureFlag[];
  subgraphs: Subgraph[];
};

export const getInputs = (): Inputs | undefined => {
  const configPath = core.getInput('config_path') || '.github/cosmo.yaml';
  const cosmoApiKey = core.getInput('cosmo_api_key', { required: true });
  const create = core.getInput('create') === 'true';
  const update = core.getInput('update') === 'true';
  const destroy = core.getInput('destroy') === 'true';

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
  const inputFileLocation = dirname(inputFile);

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
      schemaPath: resolve(inputFileLocation, subgraph.schema_path),
      routingUrl: subgraph.routing_url,
    };
  });

  return {
    actionType,
    cosmoApiKey,
    namespace,
    featureFlags,
    subgraphs,
  };
};
