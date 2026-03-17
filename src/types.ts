import type { ActionInput, CheckConfig, PreviewConfig, SubgraphConfig } from './schema';

export type {
  Config,
  SubgraphConfig,
  PreviewConfig,
  PreviewSubgraph,
  CheckConfig,
  ActionInput,
} from './schema';

export interface Inputs {
  cosmoApiKey: string;
  githubToken: string;
  action: ActionInput['action'];
  stage: ActionInput['stage'];
  subgraphs: SubgraphConfig[];
  previews: PreviewConfig[];
  check: CheckConfig | undefined;
  configPath: string;
}

export interface FeatureSubgraphsOutputConfig {
  previewName: string;
  namespace: string;
  featureSubgraphName: string;
  schemaPath: string;
  routingUrl: string;
  baseSubgraphName: string;
}
