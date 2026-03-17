import { describe, expect, it } from 'vitest';
import { actionInputSchema, configSchema } from '../schema';

describe('configSchema', () => {
  const validSubgraph = { name: 'my-subgraph', schema_path: 'schema.graphqls' };

  it('accepts a minimal valid config', () => {
    const result = configSchema.safeParse({
      subgraphs: [validSubgraph],
    });
    expect(result.success).toBe(true);
  });

  it('defaults subgraph type to standard', () => {
    const result = configSchema.safeParse({
      subgraphs: [validSubgraph],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subgraphs[0].type).toBe('standard');
    }
  });

  it('accepts edfs and grpc subgraph types', () => {
    const result = configSchema.safeParse({
      subgraphs: [
        { name: 'events', type: 'edfs', schema_path: 'events.graphqls' },
        { name: 'grpc-svc', type: 'grpc', schema_path: 'grpc.graphqls' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty subgraphs array', () => {
    const result = configSchema.safeParse({ subgraphs: [] });
    expect(result.success).toBe(false);
  });

  it('accepts a full config with previews and check', () => {
    const result = configSchema.safeParse({
      version: '1',
      subgraphs: [validSubgraph],
      previews: [
        {
          name: 'my-preview',
          namespace: 'dev1',
          labels: ['graph=private'],
          subgraphs: [{ name: 'my-subgraph', routing_url: 'http://preview.example.com/graphql' }],
        },
      ],
      check: { namespaces: ['dev1', 'staging'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects preview referencing a non-existent subgraph', () => {
    const result = configSchema.safeParse({
      subgraphs: [validSubgraph],
      previews: [
        {
          name: 'bad-preview',
          namespace: 'dev1',
          labels: ['graph=private'],
          subgraphs: [{ name: 'does-not-exist', routing_url: 'http://example.com' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects preview referencing an edfs subgraph', () => {
    const result = configSchema.safeParse({
      subgraphs: [{ name: 'events', type: 'edfs', schema_path: 'events.graphqls' }],
      previews: [
        {
          name: 'bad-preview',
          namespace: 'dev1',
          labels: ['graph=private'],
          subgraphs: [{ name: 'events', routing_url: 'http://example.com' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('actionInputSchema', () => {
  it('accepts valid preview actions', () => {
    for (const stage of ['create', 'update', 'delete']) {
      const result = actionInputSchema.safeParse({ action: 'preview', stage });
      expect(result.success).toBe(true);
    }
  });

  it('accepts valid schema actions', () => {
    const result = actionInputSchema.safeParse({ action: 'schema', stage: 'check' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = actionInputSchema.safeParse({ action: 'invalid', stage: 'create' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid stage for preview', () => {
    const result = actionInputSchema.safeParse({ action: 'preview', stage: 'check' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid stage for schema', () => {
    const result = actionInputSchema.safeParse({ action: 'schema', stage: 'create' });
    expect(result.success).toBe(false);
  });
});
