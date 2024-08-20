import * as github from '@actions/github';
import { SubgraphCommandJsonOutput } from 'wgc/dist/core/types/types.js';
import { Context } from '@actions/github/lib/context.js';

export const addComment = async ({
  githubToken,
  prNumber,
  deployedFeatureFlags,
  featureSubgraphs,
  featureFlagErrorOutputs,
  context,
  organizationSlug,
  namespace,
}: {
  githubToken: string;
  prNumber: number;
  deployedFeatureFlags: string[];
  featureSubgraphs: string[];
  featureFlagErrorOutputs: {
    [key: string]: SubgraphCommandJsonOutput;
  };
  context: Context;
  organizationSlug: string;
  namespace: string;
}) => {
  const octokit = github.getOctokit(githubToken);

  // Generate Markdown table
  const tableHeader = '| Feature Flag | Feature Subgraphs |\n| --- | --- |\n';
  const tableBody = deployedFeatureFlags.map((name) => {
    return `| [${name}](https://cosmo.wundergraph.com/${organizationSlug}/feature-flags/${name}?namespace=${namespace}) | ${featureSubgraphs.join(', ')} |`;
  });
  const markdownTable = `${tableHeader}${tableBody}`;

  if (Object.keys(featureFlagErrorOutputs).length === 0) {
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: `### 🚀  The following feature flags have been deployed: \n${markdownTable} \n #### To query any of these feature flags, pass the feature flag name to the 'X-Feature-Flag' header when making a request. Refer to the [documentation](https://cosmo-docs.wundergraph.com/tutorial/gradual-and-experimental-feature-rollout-with-feature-flags#using-cosmo-router-to-serve-the-feature-flag-to-clients) for more information.`,
    });
  } else {
    let body = '';
    if (deployedFeatureFlags.length > 0) {
      body = `### 🚀  The following feature flags have been deployed: \n${markdownTable} \n #### To query any of these feature flags, pass the feature flag name to the 'X-Feature-Flag' header when making a request.  Refer to the [documentation](https://cosmo-docs.wundergraph.com/tutorial/gradual-and-experimental-feature-rollout-with-feature-flags#using-cosmo-router-to-serve-the-feature-flag-to-clients) for more information.`;
    }
    const failedFeatureFlags = Object.keys(featureFlagErrorOutputs);
    const failedFFTableHeader = '| Feature Flag | Federated Graph | Error |\n| --- | --- | --- |\n';
    const failedFFTableBody = failedFeatureFlags.map((name) => {
      if (featureFlagErrorOutputs[name].compositionErrors.length > 0) {
        const compositionErrors = featureFlagErrorOutputs[name].compositionErrors;
        const compositionError = compositionErrors.find((error) => error.featureFlag === name);
        if (compositionError) {
          return `| [${name}](https://cosmo.wundergraph.com/${organizationSlug}/feature-flags/${name}?namespace=${namespace}) | ${compositionError.federatedGraphName} | ${compositionError.message.replaceAll('\n', '<br>')} |`;
        } else {
          const federatedGraphNames = [...new Set(compositionErrors.map((error) => error.federatedGraphName))];
          return `| [${name}](https://cosmo.wundergraph.com/${organizationSlug}/feature-flags/${name}?namespace=${namespace}) | ${federatedGraphNames.join(',')} | ${featureFlagErrorOutputs[name].message}. Please check the compositions page of the respective federated graphs for more details. |`;
        }
      } else if (featureFlagErrorOutputs[name].deploymentErrors.length > 0) {
        const deploymentErrors = featureFlagErrorOutputs[name].deploymentErrors;
        const deploymentError = deploymentErrors.find((error) => error.featureFlag === name);
        if (deploymentError) {
          return `| [${name}](https://cosmo.wundergraph.com/${organizationSlug}/feature-flags/${name}?namespace=${namespace}) | ${deploymentError.federatedGraphName} | ${deploymentError.message.replaceAll('\n', '<br>')} |`;
        } else {
          const federatedGraphNames = [...new Set(deploymentErrors.map((error) => error.federatedGraphName))];
          return `| [${name}](https://cosmo.wundergraph.com/${organizationSlug}/feature-flags/${name}?namespace=${namespace}) | ${federatedGraphNames.join(',')} | ${featureFlagErrorOutputs[name].message}. Please check the compositions page of the respective federated graphs for more details. |`;
        }
      } else {
        return `| [${name}](https://cosmo.wundergraph.com/${organizationSlug}/feature-flags/${name}?namespace=${namespace}) | - | ${featureFlagErrorOutputs[name].message} |`;
      }
    });
    const failedFFMarkdownTable = `${failedFFTableHeader}${failedFFTableBody}`;
    body += `\n ### ❌ The following feature flags failed to deploy in these federated graphs: \n ${failedFFMarkdownTable}`;

    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body,
    });
  }
};
