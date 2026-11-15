import { describe, expect, it, vi } from 'vitest';
import type {
  ProductSearch,
  ProductSearchInput,
  ProductSearchItem,
} from '../../src/application/ports/product-search.ts';
import { SearchProducts } from '../../src/application/use-cases/search-products.ts';

const products: ProductSearchItem[] = [
  {
    id: '123e4567-e89b-42d3-a456-426614174000',
    gtin: null,
    name: 'Leite Integral',
    brand: 'Fazenda Azul',
    category: 'Laticínios',
    unit: '1 L',
    relevance: 0.95,
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174001',
    gtin: null,
    name: 'Leite Desnatado',
    brand: 'Fazenda Azul',
    category: 'Laticínios',
    unit: '1 L',
    relevance: 0.78,
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174002',
    gtin: null,
    name: 'Leite em Pó',
    brand: 'Serra Branca',
    category: 'Laticínios',
    unit: '400 g',
    relevance: 0.61,
  },
];

describe('SearchProducts', () => {
  it('trims the query, applies the limit, and creates a keyset cursor', async () => {
    const productSearch: ProductSearch = {
      search: vi.fn(async (input: ProductSearchInput) =>
        input.cursor ? products.slice(2) : products,
      ),
    };
    const useCase = new SearchProducts(productSearch);

    const firstPage = await useCase.execute({ query: ' leite ', limit: 2 });
    if (!firstPage.nextCursor) throw new Error('Cursor esperado para a próxima página.');
    const secondPage = await useCase.execute({
      query: 'leite',
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.products).toEqual(products.slice(0, 2));
    expect(firstPage.nextCursor).toBeDefined();
    expect(productSearch.search).toHaveBeenNthCalledWith(1, { query: 'leite', limit: 3 });
    expect(productSearch.search).toHaveBeenNthCalledWith(2, {
      query: 'leite',
      limit: 3,
      cursor: { relevance: products[1]?.relevance, id: products[1]?.id },
    });
    expect(secondPage.products).toEqual(products.slice(2));
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it('rejects malformed or query-mismatched cursors', async () => {
    const productSearch: ProductSearch = { search: vi.fn().mockResolvedValue(products) };
    const useCase = new SearchProducts(productSearch);
    const page = await useCase.execute({ query: 'leite', limit: 1 });
    if (!page.nextCursor) throw new Error('Cursor esperado para a próxima página.');

    await expect(useCase.execute({ query: 'leite', cursor: 'not-a-cursor' })).rejects.toMatchObject(
      { code: 'INVALID_SEARCH_CURSOR' },
    );
    await expect(useCase.execute({ query: 'café', cursor: page.nextCursor })).rejects.toMatchObject(
      { code: 'INVALID_SEARCH_CURSOR' },
    );
  });
});
