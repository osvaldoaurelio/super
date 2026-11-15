export type ProductSearchCursor = {
  relevance: number;
  id: string;
};

export type ProductSearchItem = {
  id: string;
  gtin: string | null;
  name: string;
  brand: string | null;
  category: string;
  unit: string;
  relevance: number;
};

export type ProductSearchInput = {
  query: string;
  limit: number;
  cursor?: ProductSearchCursor;
};

export interface ProductSearch {
  search(input: ProductSearchInput): Promise<ProductSearchItem[]>;
}
