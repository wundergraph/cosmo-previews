/* eslint-disable no-template-curly-in-string */
import { resolve } from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';

import { SubgraphCommandJsonOutput, WhoAmICommandJsonOutput } from 'wgc/dist/core/types/types.js';

import { Context } from '@actions/github/lib/context.js';
import { getInputs } from './inputs.js';
import { addComment } from './utils.js';
import {
  getChangedFilesFromGithubAPI,
  getFilteredChangedFiles,
  getRemovedGraphQLFilesInLastCommit,
  hasCosmoConfigChangedInLastCommit,
} from './githubFiles.js';
import { FeatureSubgraphsOutputConfig, Inputs } from './types.js';

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
    const organizationDetails = await getOrganizationDetails();
    if (!organizationDetails) {
      core.setFailed('Failed to get organization details.');
      return;
    }

    const changedFiles = await getChangedFilesFromGithubAPI({ githubToken: inputs.githubToken });
    const changedGraphQLFiles = getFilteredChangedFiles({
      allDiffFiles: changedFiles,
      filePatterns: ['**/*.graphql', '**/*.gql', '**/*.graphqls'],
    });

    if (inputs.actionType === 'update') {
      const isCosmoConfigChanged = await hasCosmoConfigChangedInLastCommit({
        githubToken: inputs.githubToken,
        prNumber,
      });

      if (isCosmoConfigChanged) {
        const octokit = github.getOctokit(inputs.githubToken);
        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: prNumber,
          body: `❌  The Cosmo configuration file has been modified. Please close and reopen the pull request. Failing to do so may cause the feature flag to function improperly. Please make sure that the destroy job(triggered when the PR is closed) is completed before reopening the pull request.`,
        });
        core.setFailed('Cosmo config file is changed. Please close and reopen the pr.');
        return;
      }
    }

    switch (inputs.actionType) {
      case 'create': {
        await create({
          inputs,
          prNumber,
          changedGraphQLFiles,
          context,
          organizationSlug: organizationDetails.organizationSlug,
        });
        break;
      }
      case 'update': {
        await update({
          inputs,
          prNumber,
          changedGraphQLFiles,
          context,
          organizationSlug: organizationDetails.organizationSlug,
        });
        break;
      }
      case 'destroy': {
        await destroy({ inputs, prNumber, changedGraphQLFiles });
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

const getOrganizationDetails = async (): Promise<WhoAmICommandJsonOutput | undefined> => {
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
  await exec.exec(`wgc auth whoami --json`, [], options);
  if (error) {
    core.setFailed(error);
    return;
  }
  return JSON.parse(output);
};

const create = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
  organizationSlug,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
  organizationSlug: string;
}): Promise<void> => {
  // Create the resources
  const featureSubgraphNames: string[] = [];
  const deployedFeatureFlags: string[] = [];
  const featureFlagErrorOutputs: {
    [key: string]: SubgraphCommandJsonOutput;
  } = {};
  const featureSubgraphsToDeploy: FeatureSubgraphsOutputConfig[] = [];

  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const routingURL = subgraph.routingUrl.replaceAll('${PR_NUMBER}', prNumber.toString());
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${routingURL} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphNames.push(featureSubgraphName);
    featureSubgraphsToDeploy.push({
      featureSubgraphName,
      schemaPath: subgraph.schemaPath,
      routingUrl: routingURL,
      baseSubgraphName: subgraph.name,
    });
  }

  core.setOutput('feature_subgraphs_to_deploy', featureSubgraphsToDeploy);

  if (featureSubgraphNames.length === 0) {
    core.info('No subgraphs found to create feature subgraphs.');
    return;
  }

  for (const featureFlag of inputs.featureFlags) {
    const featureFlagName = `${featureFlag.name}-${prNumber}`;
    const command = `wgc feature-flag create ${featureFlagName} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphNames.join(' ')} --enabled --json`;
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
    featureSubgraphs: featureSubgraphNames,
    featureFlagErrorOutputs,
    context,
    organizationSlug,
    namespace: inputs.namespace,
  });
};

const update = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
  context,
  organizationSlug,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
  context: Context;
  organizationSlug: string;
}): Promise<void> => {
  // Update the resources
  const featureSubgraphNames: string[] = [];
  const deployedFeatureFlags: string[] = [];
  const featureFlagErrorOutputs: {
    [key: string]: SubgraphCommandJsonOutput;
  } = {};
  const featureSubgraphsToDeploy: FeatureSubgraphsOutputConfig[] = [];
  const featureSubgraphsToDestroy: FeatureSubgraphsOutputConfig[] = [];

  const removedGraphQLFiles = await getRemovedGraphQLFilesInLastCommit({
    githubToken: inputs.githubToken,
    prNumber,
    changedGraphQLFilesInPr: changedGraphQLFiles,
  });

  // delete feature subgraphs which were removed in the last commit
  for (const removedFile of removedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), removedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const routingURL = subgraph.routingUrl.replaceAll('${PR_NUMBER}', prNumber.toString());
    const command = `wgc subgraph delete ${featureSubgraphName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
    featureSubgraphsToDestroy.push({
      featureSubgraphName,
      schemaPath: subgraph.schemaPath,
      routingUrl: routingURL,
      baseSubgraphName: subgraph.name,
    });
  }

  for (const changedFile of changedGraphQLFiles) {
    const subgraph = inputs.subgraphs.find((subgraph) => resolve(process.cwd(), changedFile) === subgraph.schemaPath);
    if (!subgraph) {
      continue;
    }
    const featureSubgraphName = `${subgraph.name}-${inputs.namespace}-${prNumber}`;
    const routingURL = subgraph.routingUrl.replaceAll('${PR_NUMBER}', prNumber.toString());
    const command = `wgc feature-subgraph publish ${featureSubgraphName} --subgraph ${subgraph.name} --routing-url ${routingURL} --schema ${subgraph.schemaPath} -n ${inputs.namespace}`;
    await exec.exec(command);
    featureSubgraphNames.push(featureSubgraphName);
    featureSubgraphsToDeploy.push({
      featureSubgraphName,
      schemaPath: subgraph.schemaPath,
      routingUrl: routingURL,
      baseSubgraphName: subgraph.name,
    });
  }

  core.setOutput('feature_subgraphs_to_deploy', featureSubgraphsToDeploy);
  core.setOutput('feature_subgraphs_to_destroy', featureSubgraphsToDestroy);

  if (featureSubgraphNames.length === 0) {
    core.info('No changes found in subgraphs to update feature subgraphs.');
    return;
  }

  for (const featureFlag of inputs.featureFlags) {
    const featureFlagName = `${featureFlag.name}-${prNumber}`;
    let commandName = 'update';
    const listCommand = `wgc feature-flag list -n ${inputs.namespace} --json`;
    let listOutput = '';
    const listOptions = {
      listeners: {
        stdout: (data: Buffer) => {
          listOutput += data.toString();
        },
      },
    };
    // fetching all the feature flags in the namesapce to check if the feature flag exists or not
    await exec.exec(listCommand, [], listOptions);

    if (listOutput) {
      const jsonOutput = JSON.parse(listOutput);
      const featureFlagExists = jsonOutput.find((flag: { name: string }) => flag.name === featureFlagName);
      if (!featureFlagExists) {
        commandName = 'create';
      }
    }

    const command = `wgc feature-flag ${commandName} ${featureFlagName} -n ${inputs.namespace} --label ${featureFlag.labels.join(' ')} --feature-subgraphs ${featureSubgraphNames.join(' ')} --json`;

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
    featureSubgraphs: featureSubgraphNames,
    featureFlagErrorOutputs,
    context,
    organizationSlug,
    namespace: inputs.namespace,
  });
};

const destroy = async ({
  inputs,
  prNumber,
  changedGraphQLFiles,
}: {
  inputs: Inputs;
  prNumber: number;
  changedGraphQLFiles: string[];
}): Promise<void> => {
  const featureSubgraphsToDestroy: FeatureSubgraphsOutputConfig[] = [];
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
    const routingURL = subgraph.routingUrl.replaceAll('${PR_NUMBER}', prNumber.toString());
    const command = `wgc subgraph delete ${featureSubgraphName} -n ${inputs.namespace} -f`;
    await exec.exec(command);
    featureSubgraphsToDestroy.push({
      featureSubgraphName,
      schemaPath: subgraph.schemaPath,
      routingUrl: routingURL,
      baseSubgraphName: subgraph.name,
    });
  }
  core.setOutput('feature_subgraphs_to_destroy', featureSubgraphsToDestroy);
};
