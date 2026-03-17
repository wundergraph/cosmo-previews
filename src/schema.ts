import { z } from 'zod';

// --- Config file schema (cosmo.yaml) ---

export const subgraphConfigSchema = z.object({
  name: z.string().min(1, 'Subgraph name is required'),
  type: z.enum(['standard', 'edfs', 'grpc']).default('standard'),
  schema_path: z.string().min(1, 'Schema path is required'),
});

export const previewSubgraphSchema = z.object({
  name: z.string().min(1, 'Subgraph name is required'),
  routing_url: z.string().min(1, 'Routing URL template is required'),
});

export const previewConfigSchema = z.object({
  name: z.string().min(1, 'Preview name is required'),
  namespace: z.string().min(1, 'Namespace is required'),
  labels: z.array(z.string().min(1)).min(1, 'At least one label is required'),
  subgraphs: z.array(previewSubgraphSchema).min(1, 'At least one subgraph is required'),
});

export const checkConfigSchema = z.object({
  namespaces: z.array(z.string().min(1)).min(1, 'At least one namespace is required'),
});

export const configSchema = z
  .object({
    version: z.string().optional(),
    subgraphs: z.array(subgraphConfigSchema).min(1, 'At least one subgraph is required'),
    previews: z.array(previewConfigSchema).optional(),
    check: checkConfigSchema.optional(),
  })
  .refine(
    (config) => {
      const standardSubgraphs = new Set(
        config.subgraphs.filter((s) => s.type === 'standard').map((s) => s.name),
      );
      for (const preview of config.previews ?? []) {
        for (const ref of preview.subgraphs) {
          if (!standardSubgraphs.has(ref.name)) {
            return false;
          }
        }
      }
      return true;
    },
    { message: 'Preview subgraphs must reference existing standard subgraphs' },
  );

// --- Action input schema ---

const previewActionSchema = z.object({
  action: z.literal('preview'),
  stage: z.enum(['create', 'update', 'delete']),
});

const schemaActionSchema = z.object({
  action: z.literal('schema'),
  stage: z.enum(['check']),
});

export const actionInputSchema = z.discriminatedUnion('action', [
  previewActionSchema,
  schemaActionSchema,
]);

// --- Inferred types ---

export type Config = z.infer<typeof configSchema>;
export type SubgraphConfig = z.infer<typeof subgraphConfigSchema>;
export type PreviewConfig = z.infer<typeof previewConfigSchema>;
export type PreviewSubgraph = z.infer<typeof previewSubgraphSchema>;
export type CheckConfig = z.infer<typeof checkConfigSchema>;
export type ActionInput = z.infer<typeof actionInputSchema>;
