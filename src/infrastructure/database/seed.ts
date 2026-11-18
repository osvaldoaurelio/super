import { closeDatabase, sqlClient } from './client.ts';

try {
  const [product] =
    await sqlClient`insert into products (gtin, name, brand, category, unit, unit_measure, unit_quantity) values ('7891000053508', 'Leite integral', 'Exemplo', 'Laticínios', '1 L', 'ml', 1000) on conflict (gtin) do update set name = excluded.name, unit_measure = excluded.unit_measure, unit_quantity = excluded.unit_quantity returning id`;
  const [store] =
    await sqlClient`insert into stores (name, chain, city, state, latitude, longitude) values ('Loja Centro', 'Mercado Exemplo', 'São Paulo', 'SP', -23.550520, -46.633308) returning id`;
  if (!product || !store) throw new Error('Falha ao inserir dados de exemplo.');
  await sqlClient`insert into current_prices (product_id, store_id, price_cents, observed_at) values (${product['id']}, ${store['id']}, 599, now()) on conflict (product_id, store_id) do update set price_cents = excluded.price_cents, observed_at = excluded.observed_at`;
  console.info('Seed inicial aplicado.');
} finally {
  await closeDatabase();
}
