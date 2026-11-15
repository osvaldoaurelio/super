import { Buffer } from 'node:buffer';
import { DomainError } from '../../domain/errors.ts';
import type {
  ProductSearch,
  ProductSearchCursor,
  ProductSearchItem,
} from '../ports/product-search.ts';

type SearchCursorPayload = ProductSearchCursor & { query: string };
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function invalidCursor(): DomainError {
  return new DomainError('O cursor da busca é inválido.', 'INVALID_SEARCH_CURSOR');
}

function decodeCursor(encoded: string, query: string): ProductSearchCursor {
  if (!encoded || encoded.length > 512 || !/^[\da-z_-]+$/i.test(encoded)) {
    throw invalidCursor();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw invalidCursor();
  }
  if (typeof payload !== 'object' || payload === null) throw invalidCursor();

  const cursor = payload as Record<string, unknown>;
  if (
    cursor['query'] !== query ||
    typeof cursor['relevance'] !== 'number' ||
    !Number.isFinite(cursor['relevance']) ||
    cursor['relevance'] < 0 ||
    cursor['relevance'] > 1 ||
    typeof cursor['id'] !== 'string' ||
    !UUID_PATTERN.test(cursor['id'])
  ) {
    throw invalidCursor();
  }

  return { relevance: cursor['relevance'], id: cursor['id'] };
}

function encodeCursor(query: string, item: ProductSearchItem): string {
  const payload: SearchCursorPayload = {
    query,
    relevance: item.relevance,
    id: item.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export class SearchProducts {
  constructor(private readonly productSearch: ProductSearch) {}

  async execute(input: {
    query: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ products: ProductSearchItem[]; nextCursor?: string }> {
    const query = input.query.trim();
    const limit = input.limit ?? 20;
    const searchInput = {
      query,
      limit: limit + 1,
      ...(input.cursor !== undefined ? { cursor: decodeCursor(input.cursor, query) } : {}),
    };
    const rows = await this.productSearch.search(searchInput);
    const products = rows.slice(0, limit);
    const lastProduct = products.at(-1);
    const nextCursor =
      rows.length > limit && lastProduct ? encodeCursor(query, lastProduct) : undefined;

    return nextCursor === undefined ? { products } : { products, nextCursor };
  }
}
