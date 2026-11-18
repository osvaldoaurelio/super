import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { closeDatabase, db } from '../../src/infrastructure/database/client.ts';
import { stores } from '../../src/infrastructure/database/schema.ts';
import { DrizzleStoreLocator } from '../../src/infrastructure/database/store-locator-drizzle.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;

describeIntegration('DrizzleStoreLocator (PostgreSQL)', () => {
  const storeLocator = new DrizzleStoreLocator();
  const storeIds: string[] = [];

  beforeAll(async () => {
    await runIntegrationSetup();
    const inserted = await db
      .insert(stores)
      .values([
        {
          name: 'Loja Centro',
          chain: 'Rede Exemplo',
          city: 'São Paulo',
          state: 'SP',
          latitude: '-23.550520',
          longitude: '-46.633308',
        },
        {
          name: 'Loja Próxima',
          chain: 'Rede Exemplo',
          city: 'São Paulo',
          state: 'SP',
          latitude: '-23.551000',
          longitude: '-46.633500',
        },
        {
          name: 'Loja Distante',
          chain: 'Rede Exemplo',
          city: 'São Paulo',
          state: 'SP',
          latitude: '-23.650000',
          longitude: '-46.633308',
        },
        {
          name: 'Loja Inativa',
          chain: 'Rede Exemplo',
          city: 'São Paulo',
          state: 'SP',
          latitude: '-23.550520',
          longitude: '-46.633308',
          active: false,
        },
        {
          name: 'Loja Na Linha Internacional',
          chain: 'Rede Exemplo',
          city: 'Fiji',
          state: 'FJ',
          latitude: '0',
          longitude: '-179.990000',
        },
      ])
      .returning({ id: stores.id });
    storeIds.push(...inserted.map((store) => store.id));
  });

  afterAll(async () => {
    if (storeIds.length) await db.delete(stores).where(inArray(stores.id, storeIds));
    await closeDatabase();
  });

  it('returns active stores inside the radius in increasing distance order', async () => {
    const nearby = await storeLocator.findNearby({
      latitude: -23.55052,
      longitude: -46.633308,
      radiusKm: 5,
      limit: 20,
    });

    expect(nearby.map((store) => store.name)).toEqual(['Loja Centro', 'Loja Próxima']);
    expect(nearby[0]?.distanceKm).toBe(0);
    expect(nearby[1]?.distanceKm).toBeGreaterThan(0);
  });

  it('searches across the antimeridian', async () => {
    const nearby = await storeLocator.findNearby({
      latitude: 0,
      longitude: 179.99,
      radiusKm: 5,
      limit: 20,
    });

    expect(nearby.map((store) => store.name)).toContain('Loja Na Linha Internacional');
  });

  it('rejects incomplete or out-of-range coordinates', async () => {
    const baseStore = {
      name: 'Loja inválida',
      chain: 'Rede Exemplo',
      city: 'São Paulo',
      state: 'SP',
    };

    await expect(
      db.insert(stores).values({ ...baseStore, latitude: '-23.5', longitude: null }),
    ).rejects.toThrow();
    await expect(
      db.insert(stores).values({ ...baseStore, latitude: '91', longitude: '0' }),
    ).rejects.toThrow();
  });
});
