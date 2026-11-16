import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createActivity, createSchedule } from '../../src/db/repositories/local'
import { getUserDb } from '../../src/db/dexie/database'

describe('persistência local', () => {
  it('impede atividade duplicada e permite vários agendamentos da mesma atividade', async () => {
    const userId = crypto.randomUUID()
    const created = await createActivity(userId, { title: 'Leitura', color: '#0F766E' })
    expect(created.ok).toBe(true)
    const duplicate = await createActivity(userId, { title: '  leitura ', color: '#115E59' })
    expect(duplicate.ok).toBe(false)
    if (!created.ok) return
    const first = await createSchedule(userId, {
      routineId: crypto.randomUUID(),
      activityId: created.activity.id,
      startAt: '2026-11-16T17:00:00.000Z',
      endAt: '2026-11-16T17:30:00.000Z',
      timezone: 'America/Sao_Paulo',
      updatedByName: 'Ana',
    })
    const second = await createSchedule(userId, {
      routineId: first.ok ? first.schedule.routineId : crypto.randomUUID(),
      activityId: created.activity.id,
      startAt: '2026-11-16T18:00:00.000Z',
      endAt: '2026-11-16T18:30:00.000Z',
      timezone: 'America/Sao_Paulo',
      updatedByName: 'Ana',
    })
    expect(first.ok && second.ok).toBe(true)
    const rows = await getUserDb(userId).schedules.toArray()
    expect(rows.filter((row) => !row.deletedAt)).toHaveLength(2)
  })
})
