import { describe, expect, it } from 'vitest'
import { applyDisputeEvent } from '../../src/domain/rules/conflictMachine'
import { classifyScheduleMutation, evaluateBatchDelete } from '../../src/domain/rules/conflicts'
import { schedulesInScope } from '../../src/domain/rules/deletion'
import { parseImageDataUrl } from '../../src/domain/rules/image'
import { evaluateOverlap } from '../../src/domain/rules/overlap'
import { canEditSchedules, canManageRoutine } from '../../src/domain/rules/permissions'
import { planRetention, retentionDeletionPolicy } from '../../src/domain/rules/retention'
import { parseBackup } from '../../src/domain/rules/backup'
import { loginSchema, registerSchema } from '../../src/domain/schemas/auth'
import { findDuplicateActivity, normalizeTitle } from '../../src/domain/rules/title'
import { normalizeScheduleRange, validateScheduleRange, zonedWeekRange } from '../../src/domain/rules/time'
import { textColorForBackground } from '../../src/domain/rules/color'
import type { Activity, ScheduleSnapshot } from '../../src/domain/entities/types'

const snapshot = (patch: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot => ({
  id: '11111111-1111-4111-8111-111111111111',
  routineId: '22222222-2222-4222-8222-222222222222',
  activityId: '33333333-3333-4333-8333-333333333333',
  startAt: '2026-11-16T17:00:00.000Z',
  endAt: '2026-11-16T18:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  version: 1,
  deletedAt: null,
  updatedBy: 'user-a',
  updatedByName: 'Ana',
  ...patch,
})

describe('atividades', () => {
  it('normaliza títulos e detecta duplicata sem diferenciar maiúsculas', () => {
    const activity = {
      id: 'a',
      ownerId: 'u',
      title: 'Treino',
      normalizedTitle: normalizeTitle('  Treino   funcional '),
      description: '',
      color: '#0F766E',
      version: 1,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
    } satisfies Activity
    expect(normalizeTitle('  Treino   funcional ')).toBe('treino funcional')
    expect(findDuplicateActivity([activity], 'TREINO FUNCIONAL')?.id).toBe('a')
    expect(findDuplicateActivity([{ ...activity, deletedAt: '2026-01-01T00:00:00.000Z' }], 'treino funcional')).toBeUndefined()
  })
})

describe('calendário', () => {
  it('aceita 5 minutos e recusa duração menor ou horário invertido', () => {
    expect(validateScheduleRange({
      startAt: '2026-11-16T17:00:00.000Z',
      endAt: '2026-11-16T17:05:00.000Z',
      timezone: 'America/Sao_Paulo',
    }).ok).toBe(true)
    expect(validateScheduleRange({
      startAt: '2026-11-16T17:00:00.000Z',
      endAt: '2026-11-16T17:04:00.000Z',
      timezone: 'America/Sao_Paulo',
    }).ok).toBe(false)
    expect(validateScheduleRange({
      startAt: '2026-11-16T18:00:00.000Z',
      endAt: '2026-11-16T17:00:00.000Z',
      timezone: 'America/Sao_Paulo',
    }).ok).toBe(false)
  })

  it('escolhe o conjunto certo para exclusão por dia, semana e mês', () => {
    const schedules = [
      { id: 'one', activityId: 'act', routineId: 'rot', startAt: '2026-11-16T15:00:00.000Z', deletedAt: null, version: 1 },
      { id: 'same-day', activityId: 'act', routineId: 'rot', startAt: '2026-11-16T18:00:00.000Z', deletedAt: null, version: 1 },
      { id: 'week', activityId: 'act', routineId: 'rot', startAt: '2026-11-18T15:00:00.000Z', deletedAt: null, version: 1 },
      { id: 'month', activityId: 'act', routineId: 'rot', startAt: '2026-11-27T15:00:00.000Z', deletedAt: null, version: 1 },
      { id: 'other', activityId: 'other', routineId: 'rot', startAt: '2026-11-16T15:00:00.000Z', deletedAt: null, version: 1 },
    ]
    const anchor = schedules[0]!
    expect(schedulesInScope({ schedules, anchor, scope: 'one', timeZone: 'America/Sao_Paulo' }).map((item) => item.id)).toEqual(['one'])
    expect(schedulesInScope({ schedules, anchor, scope: 'day', timeZone: 'America/Sao_Paulo' }).map((item) => item.id)).toEqual(['one', 'same-day'])
    expect(schedulesInScope({ schedules, anchor, scope: 'week', timeZone: 'America/Sao_Paulo' }).map((item) => item.id)).toEqual(['one', 'same-day', 'week'])
    expect(schedulesInScope({ schedules, anchor, scope: 'month', timeZone: 'America/Sao_Paulo' }).map((item) => item.id)).toEqual(['one', 'same-day', 'week', 'month'])
  })

  it('define a semana operacional a partir de segunda-feira no fuso da rotina', () => {
    const range = zonedWeekRange('2026-11-18T15:00:00.000Z', 'America/Sao_Paulo')
    expect(range.start.toISOString()).toBe('2026-11-16T03:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-11-23T03:00:00.000Z')
  })

  it('normaliza um arraste curto para o mínimo de cinco minutos', () => {
    const result = normalizeScheduleRange('2026-11-16T17:00:00.000Z', '2026-11-16T17:01:00.000Z', 'America/Sao_Paulo')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.minutes).toBeGreaterThanOrEqual(5)
  })
})

describe('conflitos', () => {
  it('distingue edição, exclusão e realocação', () => {
    const base = snapshot()
    expect(classifyScheduleMutation({
      operation: 'update',
      base,
      current: snapshot({ version: 2, startAt: '2026-11-16T19:00:00.000Z' }),
      proposed: { startAt: '2026-11-16T20:00:00.000Z', endAt: base.endAt },
    })).toMatchObject({ type: 'conflict', kind: 'relocation' })
    expect(classifyScheduleMutation({
      operation: 'update',
      base,
      current: snapshot({ deletedAt: '2026-11-16T18:00:00.000Z', version: 2 }),
      proposed: { startAt: base.startAt, endAt: base.endAt },
    })).toMatchObject({ type: 'conflict', kind: 'delete_vs_edit' })
    expect(classifyScheduleMutation({
      operation: 'delete',
      base,
      current: snapshot({ version: 2 }),
    })).toMatchObject({ type: 'conflict', kind: 'delete_vs_edit' })
  })

  it('não trata toda sobreposição como disputa quando a rotina permite', () => {
    expect(evaluateOverlap({
      policy: 'allow',
      proposed: { id: 'new', startAt: snapshot().startAt, endAt: snapshot().endAt },
      schedules: [snapshot()],
      knownVersions: {},
    }).type).toBe('ok')
  })

  it('abre disputa apenas quando a sobreposição veio de uma versão desconhecida', () => {
    const current = snapshot()
    expect(evaluateOverlap({
      policy: 'conflict',
      proposed: { id: 'new', startAt: current.startAt, endAt: current.endAt },
      schedules: [current],
      knownVersions: { [current.id]: current.version },
    }).type).toBe('validation')
    expect(evaluateOverlap({
      policy: 'conflict',
      proposed: { id: 'new', startAt: current.startAt, endAt: current.endAt },
      schedules: [current],
      knownVersions: {},
    })).toMatchObject({ type: 'conflict' })
  })

  it('percorre proposta, recusa e contraproposta até a aceitação', () => {
    const initial = { status: 'open' as const, involvedUserIds: ['a', 'b'], proposals: [] }
    const proposed = applyDisputeEvent(initial, {
      type: 'propose',
      actorId: 'a',
      proposal: { id: 'p1', proposerId: 'a', proposedChanges: { action: 'keep', choice: 'server' }, status: 'pending', createdAt: '2026-11-16T12:00:00.000Z', respondedAt: null },
    })
    expect(proposed.ok && proposed.state.status).toBe('proposal_pending')
    if (!proposed.ok) return
    const rejected = applyDisputeEvent(proposed.state, { type: 'reject', actorId: 'b', proposalId: 'p1', respondedAt: '2026-11-16T12:05:00.000Z' })
    expect(rejected.ok && rejected.state.status).toBe('open')
    if (!rejected.ok) return
    const counter = applyDisputeEvent(rejected.state, {
      type: 'propose',
      actorId: 'b',
      proposal: { id: 'p2', proposerId: 'b', proposedChanges: { action: 'delete', scheduleId: snapshot().id }, status: 'pending', createdAt: '2026-11-16T12:06:00.000Z', respondedAt: null },
    })
    expect(counter.ok && counter.state.status).toBe('proposal_pending')
    if (!counter.ok) return
    const accepted = applyDisputeEvent(counter.state, { type: 'accept', actorId: 'a', proposalId: 'p2', respondedAt: '2026-11-16T12:10:00.000Z' })
    expect(accepted.ok && accepted.state.status).toBe('resolved')
  })

  it('recusa lote quando outro usuário alterou um agendamento incluído', () => {
    expect(evaluateBatchDelete({
      expected: [{ id: 'one', baseVersion: 1 }],
      matched: [{ id: 'one', version: 2, deletedAt: null }],
    }).ok).toBe(false)
  })
})

describe('retenção, backup e segurança de formulário', () => {
  it('classifica a semana atual e não autoriza exclusão remota', () => {
    const plan = planRetention({
      schedules: [
        { id: 'now', startAt: '2026-11-18T15:00:00.000Z', deletedAt: null },
        { id: 'old', startAt: '2026-11-01T15:00:00.000Z', deletedAt: null },
        { id: 'pending', startAt: '2026-10-01T15:00:00.000Z', deletedAt: null },
      ],
      pendingEntityIds: ['pending'],
      conflictEntityIds: [],
      now: new Date('2026-11-18T15:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    })
    expect(plan.operational).toContain('now')
    expect(plan.archiveEligible).toContain('old')
    expect(plan.blocked).toContain('pending')
    expect(retentionDeletionPolicy().code).toBe('retention_disabled')
  })

  it('valida backup e rejeita login sem usuário', () => {
    expect(parseBackup({ version: 1, exportedAt: '2026-11-16T00:00:00.000Z', userId: '11111111-1111-4111-8111-111111111111', activities: [], routines: [], schedules: [], conflicts: [] }).ok).toBe(true)
    expect(loginSchema.safeParse({ username: '', password: '' }).success).toBe(false)
    expect(registerSchema.safeParse({
      username: 'ana',
      email: 'ana@example.com',
      password: 'senha-segura1',
      confirmPassword: 'diferente1',
      displayName: 'Ana',
      profileColor: '#0F766E',
      timezone: 'America/Sao_Paulo',
    }).success).toBe(false)
  })

  it('escolhe texto legível e recusa imagem que não é PNG', () => {
    expect(textColorForBackground('#0F766E')).toBe('#F8FAFC')
    expect(textColorForBackground('#F8FAFC')).toBe('#0F172A')
    expect(parseImageDataUrl('data:image/png;base64,AAAA').ok).toBe(false)
  })

  it('separa proprietário e editor', () => {
    expect(canManageRoutine('editor')).toBe(false)
    expect(canEditSchedules('editor')).toBe(true)
    expect(canEditSchedules(null)).toBe(false)
  })
})
