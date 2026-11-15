import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  ProductSearch,
  ProductSearchInput,
  ProductSearchItem,
} from '../../application/ports/product-search.ts';
import { db } from './client.ts';
import { products } from './schema.ts';

export class DrizzleProductSearch implements ProductSearch {
  async search(input: ProductSearchInput): Promise<ProductSearchItem[]> {
    const pattern = `%${input.query.replace(/[!%_]/g, '!$&')}%`;
    const relevance = sql<number>`greatest(
      similarity(${products.name}, ${input.query}),
      similarity(coalesce(${products.brand}, ''), ${input.query})
    )`;
    const filters: SQL[] = [
      sql`(
        ${products.name} % ${input.query}
        or ${products.brand} % ${input.query}
        or ${products.name} ilike ${pattern} escape '!'
        or ${products.brand} ilike ${pattern} escape '!'
      )`,
    ];

    if (input.cursor) {
      const afterCursor = or(
        lt(relevance, input.cursor.relevance),
        and(eq(relevance, input.cursor.relevance), gt(products.id, input.cursor.id)),
      );
      if (afterCursor) filters.push(afterCursor);
    }

    return db
      .select({
        id: products.id,
        gtin: products.gtin,
        name: products.name,
        brand: products.brand,
        category: products.category,
        unit: products.unit,
        relevance,
      })
      .from(products)
      .where(and(...filters))
      .orderBy(desc(relevance), asc(products.id))
      .limit(input.limit);
  }
}
