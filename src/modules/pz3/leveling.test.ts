import { describe, expect, it } from 'vitest';
import { PZ3_LEVELING_LIMIT, getPz3Leveling } from './leveling';

/**
 * Упражнение должно быть и осмысленным, и решаемым: без перегрузки в исходной
 * раскладке двигать нечего, а без решения студент упрётся в стену. Оба свойства
 * держатся на данных учебного примера, поэтому проверяются тестом.
 */
describe('упражнение на выравнивание загрузки', () => {
  it('в исходной раскладке бригады не хватает — иначе двигать нечего', () => {
    const state = getPz3Leveling({});

    expect(state.overloadDays).toBeGreaterThan(0);
    expect(state.peakWorkers).toBeGreaterThan(PZ3_LEVELING_LIMIT);
    expect(state.isSolved).toBe(false);
  });

  it('решение существует: сдвиг работы с резервом убирает перегрузку', () => {
    const spare = getPz3Leveling({}).rows.filter((row) => row.floatDays > 0);
    const solutions = spare.flatMap((row) =>
      Array.from({ length: row.floatDays }, (_, index) => getPz3Leveling({ [row.id]: index + 1 })),
    );

    expect(solutions.some((state) => state.isSolved)).toBe(true);
  });

  it('сдвиг внутри резерва не удлиняет срок', () => {
    const baseline = getPz3Leveling({});

    for (const row of baseline.rows) {
      const state = getPz3Leveling({ [row.id]: row.floatDays });

      expect(state.durationDays).toBe(baseline.baselineDurationDays);
    }
  });

  it('критическую работу сдвинуть нельзя: у неё нет резерва', () => {
    const critical = getPz3Leveling({}).rows.filter((row) => row.isCritical);

    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((row) => row.floatDays === 0)).toBe(true);

    const state = getPz3Leveling({ [critical[0].id]: 5 });

    expect(state.rows.find((row) => row.id === critical[0].id)?.appliedShift).toBe(0);
  });

  it('запрос больше резерва обрезается, а не растягивает проект', () => {
    const spare = getPz3Leveling({}).rows.find((row) => row.floatDays > 0);
    const state = getPz3Leveling({ [spare!.id]: spare!.floatDays + 10 });
    const row = state.rows.find((item) => item.id === spare!.id);

    expect(row?.appliedShift).toBeLessThanOrEqual(spare!.floatDays);
    expect(state.durationDays).toBe(state.baselineDurationDays);
  });

  it('загрузка считается на каждый день срока', () => {
    const state = getPz3Leveling({});

    expect(state.load).toHaveLength(state.durationDays);
    expect(state.load.every((day) => day.overloaded === day.workers > PZ3_LEVELING_LIMIT)).toBe(true);
  });
});
