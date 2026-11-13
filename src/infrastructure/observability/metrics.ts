import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: 'super-api' });
collectDefaultMetrics({ register: metricsRegistry });
export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});
export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});
export const outboxBacklog = new Gauge({
  name: 'outbox_backlog_events',
  help: 'Eventos da outbox ainda não publicados (inclui os que esgotaram tentativas)',
  registers: [metricsRegistry],
});
export const outboxDispatchFailures = new Counter({
  name: 'outbox_dispatch_failures_total',
  help: 'Falhas ao publicar eventos da outbox, por desfecho',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});
