import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { PriceAlertRepository } from '../../application/ports/price-alert-repository.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppEnv } from '../types.ts';

const Id = z.string().uuid();
const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const Alert = z.object({
  id: Id,
  productId: Id,
  targetPriceCents: z.number().int().positive(),
  active: z.boolean(),
  channel: z.enum(['email', 'push']),
  createdAt: z.string().datetime(),
  triggeredAt: z.string().datetime().nullable(),
});
const AlertResponse = z.object({ data: Alert });
const AlertListResponse = z.object({ data: z.array(Alert), meta: z.object({ count: z.number() }) });
const CreateAlertInput = z.object({
  productId: Id,
  targetPriceCents: z.number().int().positive().max(10_000_000),
  channel: z.enum(['email', 'push']),
});
const UpdateAlertInput = z
  .object({
    targetPriceCents: z.number().int().positive().max(10_000_000).optional(),
    active: z.boolean().optional(),
    channel: z.enum(['email', 'push']).optional(),
  })
  .refine((input) => Object.keys(input).length > 0);

const listRoute = createRoute({
  method: 'get',
  path: '',
  tags: ['Alerts'],
  middleware: [requireAuth],
  responses: {
    200: {
      description: 'Alertas do usuário autenticado.',
      content: { 'application/json': { schema: AlertListResponse } },
    },
    401: {
      description: 'Autenticação necessária.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
const createRouteDefinition = createRoute({
  method: 'post',
  path: '',
  tags: ['Alerts'],
  middleware: [requireAuth],
  request: { body: { content: { 'application/json': { schema: CreateAlertInput } } } },
  responses: {
    201: {
      description: 'Alerta criado.',
      content: { 'application/json': { schema: AlertResponse } },
    },
    400: {
      description: 'Dados inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Autenticação necessária.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
const updateRoute = createRoute({
  method: 'patch',
  path: '/{alertId}',
  tags: ['Alerts'],
  middleware: [requireAuth],
  request: {
    params: z.object({ alertId: Id }),
    body: { content: { 'application/json': { schema: UpdateAlertInput } } },
  },
  responses: {
    200: {
      description: 'Alerta atualizado.',
      content: { 'application/json': { schema: AlertResponse } },
    },
    400: {
      description: 'Dados inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Autenticação necessária.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'Alerta não encontrado.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{alertId}',
  tags: ['Alerts'],
  middleware: [requireAuth],
  request: { params: z.object({ alertId: Id }) },
  responses: {
    200: {
      description: 'Alerta removido.',
      content: {
        'application/json': { schema: z.object({ data: z.object({ deleted: z.literal(true) }) }) },
      },
    },
    400: {
      description: 'Identificador inválido.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Autenticação necessária.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'Alerta não encontrado.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

function serializeAlert(alert: Awaited<ReturnType<PriceAlertRepository['create']>>) {
  return {
    ...alert,
    createdAt: alert.createdAt.toISOString(),
    triggeredAt: alert.triggeredAt?.toISOString() ?? null,
  };
}

export function createAlertRoutes(dependencies: { repository: PriceAlertRepository }) {
  const routes = new OpenAPIHono<AppEnv>();
  routes.openapi(listRoute, async (context) => {
    const data = await dependencies.repository.listByUser(context.get('userId'));
    return context.json({ data: data.map(serializeAlert), meta: { count: data.length } }, 200);
  });
  routes.openapi(createRouteDefinition, async (context) => {
    const alert = await dependencies.repository.create({
      ...context.req.valid('json'),
      userId: context.get('userId'),
    });
    return context.json({ data: serializeAlert(alert) }, 201);
  });
  routes.openapi(updateRoute, async (context) => {
    const body = context.req.valid('json');
    const input: {
      targetPriceCents?: number;
      active?: boolean;
      channel?: 'email' | 'push';
    } = {};
    if (body.targetPriceCents !== undefined) input.targetPriceCents = body.targetPriceCents;
    if (body.active !== undefined) input.active = body.active;
    if (body.channel !== undefined) input.channel = body.channel;
    const alert = await dependencies.repository.update(
      context.get('userId'),
      context.req.valid('param').alertId,
      input,
    );
    if (!alert) {
      return context.json(
        { error: { code: 'ALERT_NOT_FOUND', message: 'Alerta não encontrado.' } },
        404,
      );
    }
    return context.json({ data: serializeAlert(alert) }, 200);
  });
  routes.openapi(deleteRoute, async (context) => {
    const deleted = await dependencies.repository.delete(
      context.get('userId'),
      context.req.valid('param').alertId,
    );
    if (!deleted) {
      return context.json(
        { error: { code: 'ALERT_NOT_FOUND', message: 'Alerta não encontrado.' } },
        404,
      );
    }
    return context.json({ data: { deleted: true as const } }, 200);
  });
  return routes;
}
