import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { env } from '../../config/env.ts';

let sdk: NodeSDK | undefined;
export function startTracing(): void {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'super-api',
      'deployment.environment.name': env.NODE_ENV,
    }),
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  });
  sdk.start();
}
export async function stopTracing(): Promise<void> {
  await sdk?.shutdown();
}
