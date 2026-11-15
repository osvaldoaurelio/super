import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { SearchProducts } from '../../src/application/use-cases/search-products.ts';
import { closeDatabase, db } from '../../src/infrastructure/database/client.ts';
import { products } from '../../src/infrastructure/database/schema.ts';
import { DrizzleProductSearch } from '../../src/infrastructure/database/product-search-drizzle.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;

describeIntegration('DrizzleProductSearch (PostgreSQL)', () => {
  const search = new DrizzleProductSearch();
  const searchProducts = new SearchProducts(search);
  const productIds: string[] = [];

  beforeAll(async () => {
    await runIntegrationSetup();
    const inserted = await db
      .insert(products)
      .values([
        {
          name: 'Leite Integral 1 L',
          brand: 'Fazenda Azul',
          category: 'Laticínios',
          unit: '1 L',
        },
        {
          name: 'Leite Desnatado 1 L',
          brand: 'Fazenda Azul',
          category: 'Laticínios',
          unit: '1 L',
        },
        {
          name: 'Leite Integral Semidesnatado',
          brand: 'Fazenda Azul',
          category: 'Laticínios',
          unit: '1 L',
        },
        {
          name: 'Leite em Pó',
          brand: 'Serra Branca',
          category: 'Laticínios',
          unit: '400 g',
        },
        {
          name: 'Café Torrado',
          brand: 'Grão do Sul',
          category: 'Mercearia',
          unit: '500 g',
        },
      ])
      .returning({ id: products.id });
    productIds.push(...inserted.map((product) => product.id));
  });

  afterAll(async () => {
    if (productIds.length) {
      await db.delete(products).where(inArray(products.id, productIds));
    }
    await closeDatabase();
  });

  it('ranks closer name matches first and honors the result limit', async () => {
    const results = await search.search({ query: 'Leite Integral', limit: 2 });
    const fuzzyMatches = await search.search({ query: 'Leite Integraal', limit: 5 });

    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe('Leite Integral 1 L');
    expect(results[0]?.relevance).toBeGreaterThan(results[1]?.relevance ?? 0);
    expect(fuzzyMatches.some((product) => product.name === 'Leite Integral 1 L')).toBe(true);
  });

  it('paginates by relevance without repeating products', async () => {
    const firstPage = await searchProducts.execute({ query: 'leite', limit: 1 });
    if (!firstPage.nextCursor) throw new Error('Cursor esperado para a próxima página.');
    const secondPage = await searchProducts.execute({
      query: 'leite',
      limit: 1,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.products).toHaveLength(1);
    expect(secondPage.products).toHaveLength(1);
    expect(secondPage.products[0]?.id).not.toBe(firstPage.products[0]?.id);
  });
});
