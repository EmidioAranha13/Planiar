import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CurrentUser, Routine, RoutineMember } from '../../src/domain/entities/types'
import { clearDatabase, setDatabase, type Database } from '../../server/database/client'
import { createPgliteDatabase } from '../../server/database/pglite'
import { handleApi, type ApiRequest, type ApiResponse } from '../../server/app'

let database: Database

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.LOGIN_RATE_LIMIT = '3'
  database = await createPgliteDatabase()
  setDatabase(database, 'pglite')
})

afterAll(() => {
  clearDatabase()
})

function request(method: string, url: string, body?: unknown, cookie?: string): ApiRequest {
  return {
    method,
    url,
    body: body ?? null,
    ip: '203.0.113.10',
    headers: {
      origin: 'http://localhost:5174',
      'x-planiar-request': '1',
      cookie,
    },
  }
}

function sessionCookie(response: ApiResponse): string {
  const cookie = response.cookies?.[0] ?? ''
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Lax')
  return cookie.split(';')[0] ?? ''
}

async function register(username: string, email: string) {
  const response = await handleApi(request('POST', '/api/auth/register', {
    username,
    email,
    password: 'senha-segura1',
    confirmPassword: 'senha-segura1',
    displayName: username,
    profileColor: '#0F766E',
    timezone: 'America/Sao_Paulo',
  }))
  expect(response.status).toBe(201)
  const body = response.body as { user: CurrentUser; routine: Routine; member: RoutineMember }
  return { cookie: sessionCookie(response), ...body }
}

describe('autenticação e autorização', () => {
  it('não revela qual credencial falhou e limita tentativas', async () => {
    const response = await handleApi(request('POST', '/api/auth/login', { username: 'ninguem', password: 'senha-segura1' }))
    expect(response.status).toBe(401)
    expect(JSON.stringify(response.body)).toContain('Usuário ou senha inválidos.')
    await handleApi(request('POST', '/api/auth/login', { username: 'ninguem', password: 'senha-segura1' }, undefined))
    await handleApi(request('POST', '/api/auth/login', { username: 'ninguem', password: 'senha-segura1' }, undefined))
    const limited = await handleApi(request('POST', '/api/auth/login', { username: 'ninguem', password: 'senha-segura1' }))
    expect(limited.status).toBe(429)
  })

  it('rejeita mutação sem cabeçalho de origem', async () => {
    const response = await handleApi({
      method: 'POST',
      url: '/api/auth/login',
      body: { username: 'ana', password: 'senha-segura1' },
      ip: '203.0.113.11',
      headers: { origin: 'http://localhost:5174' },
    })
    expect(response.status).toBe(403)
  })

  it('recupera senha sem enviá-la e invalida a sessão anterior quando o e-mail não está configurado', async () => {
    const ana = await register('ana', 'ana@example.com')
    const forgot = await handleApi(request('POST', '/api/auth/forgot-password', { email: 'ana@example.com' }))
    expect(forgot.status).toBe(503)
    const body = forgot.body as { devResetUrl?: string; error: { code: string } }
    expect(body.error.code).toBe('email_not_configured')
    expect(body.devResetUrl).toContain('/reset-password?token=')
    const token = new URL(body.devResetUrl ?? '').searchParams.get('token')
    const reset = await handleApi(request('POST', '/api/auth/reset-password', {
      token,
      password: 'outra-senha2',
      confirmPassword: 'outra-senha2',
    }))
    expect(reset.status).toBe(200)
    const oldSession = await handleApi(request('GET', '/api/auth/me', undefined, ana.cookie))
    expect(oldSession.status).toBe(401)
  })
})

describe('sincronização, compartilhamento e conflitos', () => {
  it('protege rotina de terceiros, sincroniza convite e resolve disputa', async () => {
    const bia = await register('bia', 'bia@example.com')
    const caio = await register('caio', 'caio@example.com')
    const activityId = crypto.randomUUID()
    const scheduleId = crypto.randomUUID()
    const clientId = 'client-test-bia-0001'
    const createdActivity = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'activity',
        entityId: activityId,
        operationType: 'create',
        payload: { title: 'Estudo', description: '', color: '#0F766E' },
        baseVersion: null,
        baseSnapshot: null,
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    expect(createdActivity.status).toBe(200)
    const duplicate = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'activity',
        entityId: crypto.randomUUID(),
        operationType: 'create',
        payload: { title: '  estudo ', color: '#115E59' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    const duplicateBody = duplicate.body as { results: { status: string; code?: string }[] }
    expect(duplicateBody.results[0]?.code).toBe('duplicate_activity')

    const scheduleOp = crypto.randomUUID()
    const schedule = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: scheduleOp,
        clientId,
        entityType: 'schedule',
        entityId: scheduleId,
        operationType: 'create',
        payload: {
          routineId: bia.routine.id,
          activityId,
          startAt: '2026-11-16T17:00:00.000Z',
          endAt: '2026-11-16T18:00:00.000Z',
          timezone: 'America/Sao_Paulo',
        },
        baseVersion: null,
        knownScheduleVersions: {},
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    const scheduleBody = schedule.body as { results: { status: string }[] }
    expect(scheduleBody.results[0]?.status).toBe('applied')
    const repeated = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: scheduleOp,
        clientId,
        entityType: 'schedule',
        entityId: scheduleId,
        operationType: 'create',
        payload: {
          routineId: bia.routine.id,
          activityId,
          startAt: '2026-11-16T17:00:00.000Z',
          endAt: '2026-11-16T18:00:00.000Z',
          timezone: 'America/Sao_Paulo',
        },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    expect((repeated.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')

    const forbidden = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-caio-0001',
        entityType: 'schedule',
        entityId: crypto.randomUUID(),
        operationType: 'create',
        payload: {
          routineId: bia.routine.id,
          activityId,
          startAt: '2026-11-16T19:00:00.000Z',
          endAt: '2026-11-16T20:00:00.000Z',
          timezone: 'America/Sao_Paulo',
        },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, caio.cookie))
    expect((forbidden.body as { results: { code?: string }[] }).results[0]?.code).toBe('forbidden')

    const invitationId = crypto.randomUUID()
    const invitation = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'invitation',
        entityId: invitationId,
        operationType: 'create',
        payload: { routineId: bia.routine.id, username: 'caio' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    expect((invitation.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')
    const accepted = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-caio-0001',
        entityType: 'invitation',
        entityId: invitationId,
        operationType: 'respond',
        payload: { status: 'accepted' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, caio.cookie))
    expect((accepted.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')

    const conflicted = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-caio-0001',
        entityType: 'schedule',
        entityId: scheduleId,
        operationType: 'update',
        payload: { startAt: '2026-11-16T21:00:00.000Z', endAt: '2026-11-16T22:00:00.000Z' },
        baseVersion: 0,
        baseSnapshot: {
          id: scheduleId,
          routineId: bia.routine.id,
          activityId,
          startAt: '2026-11-16T17:00:00.000Z',
          endAt: '2026-11-16T18:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          version: 0,
          deletedAt: null,
          updatedBy: caio.user.id,
          updatedByName: 'caio',
        },
        knownScheduleVersions: { [scheduleId]: 0 },
        createdAt: new Date().toISOString(),
      }],
    }, caio.cookie))
    const conflictBody = conflicted.body as { results: { status: string; conflict?: { id: string } }[] }
    expect(conflictBody.results[0]?.status).toBe('conflict')
    const conflictId = conflictBody.results[0]?.conflict?.id
    expect(conflictId).toBeTruthy()
    const proposalId = crypto.randomUUID()
    const proposal = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-caio-0001',
        entityType: 'proposal',
        entityId: proposalId,
        operationType: 'propose',
        payload: { conflictId, changes: { action: 'keep', choice: 'server' } },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, caio.cookie))
    expect((proposal.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')
    const refused = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'proposal',
        entityId: proposalId,
        operationType: 'respond_proposal',
        payload: { decision: 'rejected' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    expect((refused.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')
    const secondProposal = crypto.randomUUID()
    await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'proposal',
        entityId: secondProposal,
        operationType: 'propose',
        payload: { conflictId, changes: { action: 'keep', choice: 'server' } },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, bia.cookie))
    const resolved = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-caio-0001',
        entityType: 'proposal',
        entityId: secondProposal,
        operationType: 'respond_proposal',
        payload: { decision: 'accepted' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, caio.cookie))
    expect((resolved.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')

    const pull = await handleApi(request('POST', '/api/sync/pull', { cursor: 0 }, caio.cookie))
    expect(pull.status).toBe(200)
    expect((pull.body as { changes: unknown[] }).changes.length).toBeGreaterThan(0)

    const retention = await handleApi(request('GET', '/api/retention/status', undefined, bia.cookie))
    expect((retention.body as { deletion: { code: string } }).deletion.code).toBe('retention_disabled')
  })

  it('recusa duração curta, exclusão concorrente, convite recusado e exclusão do dia', async () => {
    const dora = await register('dora', 'dora@example.com')
    const eli = await register('eli', 'eli@example.com')
    const activityId = crypto.randomUUID()
    const morningId = crypto.randomUUID()
    const afternoonId = crypto.randomUUID()
    const clientId = 'client-test-dora-0001'
    await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'activity',
        entityId: activityId,
        operationType: 'create',
        payload: { title: 'Caminhada', color: '#0F766E' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    const tooShort = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'schedule',
        entityId: crypto.randomUUID(),
        operationType: 'create',
        payload: {
          routineId: dora.routine.id,
          activityId,
          startAt: '2026-11-16T17:00:00.000Z',
          endAt: '2026-11-16T17:04:00.000Z',
          timezone: 'America/Sao_Paulo',
        },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    expect((tooShort.body as { results: { code?: string }[] }).results[0]?.code).toBe('validation')

    const created = await handleApi(request('POST', '/api/sync/push', {
      operations: [
        {
          id: crypto.randomUUID(),
          clientId,
          entityType: 'schedule',
          entityId: morningId,
          operationType: 'create',
          payload: {
            routineId: dora.routine.id,
            activityId,
            startAt: '2026-11-16T14:00:00.000Z',
            endAt: '2026-11-16T14:30:00.000Z',
            timezone: 'America/Sao_Paulo',
          },
          baseVersion: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          clientId,
          entityType: 'schedule',
          entityId: afternoonId,
          operationType: 'create',
          payload: {
            routineId: dora.routine.id,
            activityId,
            startAt: '2026-11-16T18:00:00.000Z',
            endAt: '2026-11-16T18:30:00.000Z',
            timezone: 'America/Sao_Paulo',
          },
          baseVersion: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }, dora.cookie))
    expect((created.body as { results: { status: string }[] }).results.every((result) => result.status === 'applied')).toBe(true)

    const invitationId = crypto.randomUUID()
    await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'invitation',
        entityId: invitationId,
        operationType: 'create',
        payload: { routineId: dora.routine.id, username: 'eli' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    const rejectedInvite = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-eli-00001',
        entityType: 'invitation',
        entityId: invitationId,
        operationType: 'respond',
        payload: { status: 'rejected' },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, eli.cookie))
    expect((rejectedInvite.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')
    const stillForbidden = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId: 'client-test-eli-00001',
        entityType: 'schedule',
        entityId: crypto.randomUUID(),
        operationType: 'create',
        payload: {
          routineId: dora.routine.id,
          activityId,
          startAt: '2026-11-16T20:00:00.000Z',
          endAt: '2026-11-16T20:30:00.000Z',
          timezone: 'America/Sao_Paulo',
        },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, eli.cookie))
    expect((stillForbidden.body as { results: { code?: string }[] }).results[0]?.code).toBe('forbidden')

    const deleted = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'schedule',
        entityId: morningId,
        operationType: 'delete_scope',
        payload: {
          scope: 'day',
          anchorScheduleId: morningId,
          activityId,
          routineId: dora.routine.id,
          timezone: 'America/Sao_Paulo',
          anchorStartAt: '2026-11-16T14:00:00.000Z',
          expected: [
            { id: morningId, baseVersion: 1 },
            { id: afternoonId, baseVersion: 1 },
          ],
        },
        baseVersion: 1,
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    expect((deleted.body as { results: { status: string }[] }).results[0]?.status).toBe('applied')

    const eveningId = crypto.randomUUID()
    await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'schedule',
        entityId: eveningId,
        operationType: 'create',
        payload: {
          routineId: dora.routine.id,
          activityId,
          startAt: '2026-11-17T14:00:00.000Z',
          endAt: '2026-11-17T14:30:00.000Z',
          timezone: 'America/Sao_Paulo',
        },
        baseVersion: null,
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'schedule',
        entityId: eveningId,
        operationType: 'update',
        payload: { startAt: '2026-11-17T15:00:00.000Z', endAt: '2026-11-17T15:30:00.000Z' },
        baseVersion: 1,
        baseSnapshot: {
          id: eveningId,
          routineId: dora.routine.id,
          activityId,
          startAt: '2026-11-17T14:00:00.000Z',
          endAt: '2026-11-17T14:30:00.000Z',
          timezone: 'America/Sao_Paulo',
          version: 1,
          deletedAt: null,
          updatedBy: dora.user.id,
          updatedByName: 'dora',
        },
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    const staleDelete = await handleApi(request('POST', '/api/sync/push', {
      operations: [{
        id: crypto.randomUUID(),
        clientId,
        entityType: 'schedule',
        entityId: eveningId,
        operationType: 'delete',
        payload: {},
        baseVersion: 1,
        baseSnapshot: {
          id: eveningId,
          routineId: dora.routine.id,
          activityId,
          startAt: '2026-11-17T14:00:00.000Z',
          endAt: '2026-11-17T14:30:00.000Z',
          timezone: 'America/Sao_Paulo',
          version: 1,
          deletedAt: null,
          updatedBy: dora.user.id,
          updatedByName: 'dora',
        },
        createdAt: new Date().toISOString(),
      }],
    }, dora.cookie))
    expect((staleDelete.body as { results: { status: string; code?: string }[] }).results[0]?.code).toBe('delete_vs_edit')
  })
})
