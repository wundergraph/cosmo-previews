import { resolve } from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';

import { SubgraphCommandJsonOutput, WhoAmICommandJsonOutput } from 'wgc/dist/core/types/types.js';

import { Context } from '@actions/github/lib/context.js';
import { Inputs, getInputs } from './inputs.js';
import { addComment } from './utils.js';
import { getChangedFilesFromGithubAPI, getFilteredChangedFiles, getRemovedGraphQLFilesInLastCommit } from './github.js';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const context = github.context;

    const pullRequest = context.payload.pull_request;
    if (!pullRequest) {
      core.setFailed('This action only works with pull_requests.');
      return;
    }

    const prNumber = pullRequest.number;

    const inputs = getInputs();
    if (!inputs) {
      return;
    }

    exportApiKey(inputs.cosmoApiKey);

    const changedFiles = await getChangedFilesFromGithubAPI({ githubToken: inputs.githubToken });
    const changedGraphQLFiles = getFilteredChangedFiles({
      allDiffFiles: changedFiles,
      filePatterns: ['**/*.graphql', '**/*.gql', '**/*.graphqls'],
    });

    if (inputs.actionType === 'update') {
      const isCosmoConfigChanged =
        getFilteredChangedFiles({
          allDiffFiles: changedFiles,
          filePatterns: ['cosmo.yaml'],
        }).length > 0;
      if (isCosmoConfigChanged) {
        core.setFailed('Cosmo config file is changed. Please close and reopen the pr.');
        return;
      }
    }

    switch (inputs.actionType) {
      case 'create': {
        await create({ inputs, prNumber, changedGraphQLFiles, context });
        break;
      }
      case 'update': {
        await update({ inputs, prNumber, changedGraphQLFiles, context });
        break;
      }
      case 'destroy': {
        await destroy({ inputs, prNumber, changedGraphQLFiles, context });
        break;
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

/**
 * Exports the API key as an environment variable.
 */
function exportApiKey(apiKey: string) {
  core.exportVariable('COSMO_API_KEY', apiKey);
  core.info('Environment variable COSMO_API_KEY is set.');
}

const create = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
}): Promise<void> => {
  // Create the resources
  const featureSubgraphs: string[] = [];
  const deployedFeatureFlags: string[] = [];
  const featureFlagErrorOutputs: {
    [key: string]: SubgraphCommandJsonOutput;
  } = {};
  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${subgraph.routingUrl} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphs.push(featureSubgraphName);
  }
  if (featureSubgraphs.length === 0) {
    core.info('No subgraphs found to create feature subgraphs.');
    return;
  }
  for (const featureFlag of inputs.featureFlags) {
    const featureFlagName = `${featureFlag.name}-${prNumber}`;
    const command = `wgc feature-flag create ${featureFlagName} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphs.join(' ')} --enabled --json`;
    let output = '';
    let error = '';
    const options = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
        stderr: (data: Buffer) => {
          error += data.toString();
        },
      },
    };
    await exec.exec(command, [], options);
    if (error) {
      const errorJsonOutput: SubgraphCommandJsonOutput = JSON.parse(error);
      featureFlagErrorOutputs[featureFlagName] = errorJsonOutput;
      continue;
    }
    if (output) {
      const jsonOutput: SubgraphCommandJsonOutput = JSON.parse(output);
      if (jsonOutput.status === 'success') {
        deployedFeatureFlags.push(featureFlagName);
      } else {
        featureFlagErrorOutputs[featureFlagName] = jsonOutput;
      }
    }
  }

  await addComment({
    githubToken: inputs.githubToken,
    prNumber,
    deployedFeatureFlags,
    featureSubgraphs,
    featureFlagErrorOutputs,
    context,
  });
};

const update = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
}): Promise<void> => {
  // Update the resources
  const featureSubgraphs: string[] = [];
  const deployedFeatureFlags: string[] = [];
  const featureFlagErrorOutputs: {
    [key: string]: SubgraphCommandJsonOutput;
  } = {};
  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${subgraph.routingUrl} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphs.push(featureSubgraphName);
  }
  if (featureSubgraphs.length === 0) {
    core.info('No changes found in subgraphs to update feature subgraphs.');
    return;
  }

  const removedGraphQLFiles = await getRemovedGraphQLFilesInLastCommit({
    githubToken: inputs.githubToken,
    prNumber,
  });

  // delete feature subgraphs which were removed in the last commit
  for (const removedFile of removedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), removedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc feature-subgraph delete ${featureSubgraphName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
  }

  for (const featureFlag of inputs.featureFlags) {
    const featureFlagName = `${featureFlag.name}-${prNumber}`;
    const command = `wgc feature-flag update ${featureFlagName} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphs.join(' ')} --json`;

    let output = '';
    let error = '';
    const options = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
        stderr: (data: Buffer) => {
          error += data.toString();
        },
      },
    };

    await exec.exec(command, [], options);

    if (error) {
      const errorJsonOutput: SubgraphCommandJsonOutput = JSON.parse(error);
      featureFlagErrorOutputs[featureFlagName] = errorJsonOutput;
      continue;
    }
    if (output) {
      const jsonOutput: SubgraphCommandJsonOutput = JSON.parse(output);
      if (jsonOutput.status === 'success') {
        deployedFeatureFlags.push(featureFlagName);
      } else {
        featureFlagErrorOutputs[featureFlagName] = jsonOutput;
      }
    }
  }

  await addComment({
    githubToken: inputs.githubToken,
    prNumber,
    deployedFeatureFlags,
    featureSubgraphs,
    featureFlagErrorOutputs,
    context,
  });
};

const destroy = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
}): Promise<void> => {
  // Destroy the resources
  for (const featureFlag of inputs.featureFlags) {
    const featureFlagName = `${featureFlag.name}-${prNumber}`;
    const command = `wgc feature-flag delete ${featureFlagName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
  }
  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const command = `wgc subgraph delete ${featureSubgraphName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
  }
};
