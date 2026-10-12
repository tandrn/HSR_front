import {
  calculateResourceUsage,
  calculateSchedule,
  getProjectMetrics,
} from '../../domain/network/calculations';
import { initialScenario } from '../../domain/network/mockData';
import type { WorkItem } from '../../domain/network/types';

/**
 * Упражнение на выравнивание загрузки (ТЗ ПЗ3 §7.1, упражнение Ольги
 * Владимировны).
 *
 * Смысл упражнения — тот, что заказчик записал на доске критерием качества
 * ресурсного графика: хорошо, когда потребность в людях постоянна и не
 * приходится набирать и распускать бригады. Работы на критическом пути держат
 * срок и не двигаются; у остальных есть резерв, и сдвиг внутри резерва меняет
 * загрузку, не меняя срока. Студент двигает работы, пока в каждый день не
 * останется не больше людей, чем есть в бригаде.
 *
 * Расчёт берётся из движка тренажёра КСГ (`domain/network`) — его ТЗ §7.1
 * запрещает переписывать, и переписывать его незачем: сетевой график, резервы
 * и загрузка по дням там уже есть и покрыты тестами. Здесь — только раскладка
 * для экрана и проверка решения.
 */

/** Сколько человек в бригаде: больше этого числа в день занять нельзя. */
export const PZ3_LEVELING_LIMIT = initialScenario.resourceLimit;

export interface Pz3LevelingRow {
  id: string;
  code: string;
  title: string;
  workers: number;
  durationDays: number;
  /** День начала, считая с нуля. */
  startDay: number;
  /** Резерв работы в исходной раскладке — максимум, на который её можно сдвинуть. */
  floatDays: number;
  /** Сдвиг, который просил студент. */
  requestedShift: number;
  /** Сдвиг, который получилось применить: соседи могли занять часть резерва. */
  appliedShift: number;
  isCritical: boolean;
}

export interface Pz3LevelingDay {
  day: number;
  workers: number;
  overloaded: boolean;
}

export interface Pz3LevelingState {
  limit: number;
  rows: Pz3LevelingRow[];
  load: Pz3LevelingDay[];
  peakWorkers: number;
  overloadDays: number;
  durationDays: number;
  /** Срок исходной раскладки: сдвиг внутри резерва не должен его менять. */
  baselineDurationDays: number;
  /** Задача решена: ни одного дня сверх бригады. */
  isSolved: boolean;
}

/**
 * Раскладка упражнения при заданных сдвигах.
 *
 * Резерв берётся из исходной раскладки, а не из текущей: студент двигает работы
 * относительно неё, и ползунок не должен менять свой предел от того, что
 * подвинули соседа.
 */
export function getPz3Leveling(shifts: Record<string, number>): Pz3LevelingState {
  const baseline = calculateSchedule(initialScenario.works);
  const shifted = initialScenario.works.map(
    (work): WorkItem => ({ ...work, plannedShift: Math.max(0, Math.round(shifts[work.id] ?? 0)) }),
  );
  const schedule = calculateSchedule(shifted);
  const metrics = getProjectMetrics(schedule.items, PZ3_LEVELING_LIMIT);
  const load = calculateResourceUsage(schedule.items, PZ3_LEVELING_LIMIT).map((point) => ({
    day: point.day,
    workers: point.workers,
    overloaded: point.overloaded,
  }));

  const rows = baseline.items.map((base): Pz3LevelingRow => {
    const current = schedule.items.find((item) => item.id === base.id) ?? base;

    return {
      id: base.id,
      code: base.code,
      title: base.title,
      workers: base.workers,
      durationDays: base.duration,
      startDay: current.earlyStart,
      floatDays: base.totalFloat,
      requestedShift: Math.max(0, Math.round(shifts[base.id] ?? 0)),
      appliedShift: current.plannedShift ?? 0,
      isCritical: base.isCritical,
    };
  });

  return {
    limit: PZ3_LEVELING_LIMIT,
    rows,
    load,
    peakWorkers: metrics.maxWorkers,
    overloadDays: metrics.overloadDays,
    durationDays: schedule.projectDuration,
    baselineDurationDays: baseline.projectDuration,
    isSolved: metrics.overloadDays === 0,
  };
}

/** Сдвиги, с которых упражнение начинается: работы стоят по ранним срокам. */
export function getPz3LevelingReset(): Record<string, number> {
  return {};
}
