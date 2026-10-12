import { calculateResourceUsage, calculateSchedule, getProjectMetrics } from '../../domain/network/calculations';
import type { ProjectMetrics, ResourceUsagePoint, ScheduledWorkItem, WorkItem } from '../../domain/network/types';
import { getPz3StageWorks, getPz3WorkKind, parsePz3Number } from './model';
import { getPz3Option } from './options';
import { PZ3_SHIFT_HOURS, getPz3AdditionalNorm, pz3WorkNorms } from './workNorms';
import type { Pz3MachineNorm, Pz3MaterialNorm, Pz3SubWorkNorm, Pz3WorkNorm } from './workNorms';
import type { Pz3Draft, Pz3WorkDraft } from './types';

/**
 * Ресурсный план ПЗ3: сколько людей, сколько времени и что расходуется.
 *
 * Считает не этот файл: расписание, загрузку и метрики даёт движок из
 * domain/network — тот же, на котором работает тренажёр КСГ. Здесь только
 * перевод работ студента в его входные данные и обратно.
 */

/** Сколько единиц в работе: километров у линейных, штук у штучных. */
export function getPz3WorkUnits(work: Pz3WorkDraft): number {
  const measure = getPz3WorkKind(work.kind).measure;
  const value = parsePz3Number(measure === 'count' ? work.count : work.lengthKm);

  return value !== null && value > 0 ? value : 0;
}

/** Подработы работы вместе с теми, что добавляют условия грунта. */
export function getPz3SubWorks(work: Pz3WorkDraft): Pz3SubWorkNorm[] {
  return [
    ...pz3WorkNorms[work.kind].subWorks,
    ...work.conditions.flatMap((condition) => getPz3AdditionalNorm(condition)?.subWorks ?? []),
  ];
}

function getWorkNormEntries(work: Pz3WorkDraft): { norm: Pz3WorkNorm; units: number }[] {
  const units = getPz3WorkUnits(work);
  return [
    { norm: pz3WorkNorms[work.kind], units },
    ...work.conditions.flatMap((condition) => {
      const norm = getPz3AdditionalNorm(condition);
      return norm ? [{ norm, units: norm.basis === 'work' ? 1 : units }] : [];
    }),
  ];
}

function getCostMultipliers(work: Pz3WorkDraft) {
  const effects = work.conditions.map((id) => getPz3Option(id, work.kind)?.effect);
  return {
    labor: 1 + effects.filter((effect) => effect === 'labor30' || effect === 'laborMaterials30').length * 0.3,
    materials: 1 + effects.filter((effect) => effect === 'laborMaterials30').length * 0.3,
  };
}

/**
 * Трудоёмкость работы, человеко-часы.
 *
 * Считается как сумма подработ на единицу, умноженная на длину или количество:
 * отчёт и график берут её из одного места и разойтись не могут.
 */
export function getPz3WorkLaborHours(work: Pz3WorkDraft): number {
  const base = getWorkNormEntries(work).reduce(
    (sum, { norm, units }) => sum + norm.subWorks.reduce((part, item) => part + item.laborHours * units, 0),
    0,
  );
  return base * getCostMultipliers(work).labor;
}

/**
 * Длительность работы в днях.
 *
 * Люди делят работу: вдвое больше людей — вдвое короче срок. Меньше дня работа
 * длиться не может, дробные дни округляются вверх — смену не делят.
 */
export function getPz3WorkDurationDays(work: Pz3WorkDraft, workers: number): number {
  if (workers <= 0) {
    return 0;
  }

  const baseDays = Math.max(1, Math.ceil(getPz3WorkLaborHours(work) / (workers * PZ3_SHIFT_HOURS)));
  return baseDays + (work.conditions.includes('settlement') ? 90 : 0);
}

export interface Pz3StageAllocation {
  stageId: string;
  workers: number;
}

/**
 * Работы этапов в виде задач для движка расписания.
 *
 * Внутри этапа работы идут одна за другой — это участок трассы, две работы на
 * нём одновременно не ведут. Этапы независимы и стартуют вместе: в этом и смысл
 * разбиения, участки строят параллельно.
 */
export function buildPz3WorkItems(draft: Pz3Draft, allocations: Pz3StageAllocation[]): WorkItem[] {
  const workersByStage = new Map(allocations.map((allocation) => [allocation.stageId, allocation.workers]));

  return draft.stages.flatMap((stage, stageIndex) => {
    const workers = Math.max(0, workersByStage.get(stage.id) ?? 0);
    const works = getPz3StageWorks(draft, stage.id);
    let previousId: string | null = null;

    return works.flatMap((work, workIndex) => {
      const duration = getPz3WorkDurationDays(work, workers);

      if (duration === 0) {
        return [];
      }

      const item: WorkItem = {
        id: work.id,
        code: `${stageIndex + 1}.${workIndex + 1}`,
        title: getPz3WorkKind(work.kind).label,
        from: previousId ?? `stage-${stage.id}-start`,
        to: work.id,
        duration: duration - (work.conditions.includes('settlement') ? 90 : 0),
        labor: Math.round(getPz3WorkLaborHours(work)),
        workers,
        dependencies: previousId ? [previousId] : [],
      };

      if (work.conditions.includes('settlement')) {
        const waitId = `${work.id}-settlement`;
        const wait: WorkItem = {
          id: waitId,
          code: `${item.code}.п`,
          title: 'Стабилизация осадок',
          from: work.id,
          to: waitId,
          duration: 90,
          labor: 0,
          workers: 0,
          isWaiting: true,
          dependencies: [work.id],
        };
        previousId = waitId;
        return [item, wait];
      }

      previousId = work.id;
      return [item];
    });
  });
}

export interface Pz3Plan {
  items: ScheduledWorkItem[];
  usage: ResourceUsagePoint[];
  metrics: ProjectMetrics;
  /** Сколько людей распределено по этапам — сумма по всем этапам. */
  assignedWorkers: number;
  /** Этапы, которым не назначили ни одного человека. */
  stagesWithoutWorkers: string[];
}

/**
 * План по текущему распределению людей.
 *
 * Предел ресурса — общее число рабочих на проект: движок по нему и считает
 * перегрузку и простой. Этап без людей в график не попадает — работать некому,
 * и молча ставить ему срок нельзя.
 */
export function getPz3Plan(draft: Pz3Draft, allocations: Pz3StageAllocation[], totalWorkers: number): Pz3Plan {
  const items = buildPz3WorkItems(draft, allocations);
  const schedule = calculateSchedule(items);
  const assignedWorkers = allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.workers), 0);

  return {
    items: schedule.items,
    usage: calculateResourceUsage(schedule.items, totalWorkers),
    metrics: getProjectMetrics(schedule.items, totalWorkers),
    assignedWorkers,
    stagesWithoutWorkers: draft.stages
      .filter((stage) => {
        const workers = allocations.find((allocation) => allocation.stageId === stage.id)?.workers ?? 0;

        return workers <= 0 && getPz3StageWorks(draft, stage.id).length > 0;
      })
      .map((stage) => stage.id),
  };
}

/** Столбцов в гистограмме загрузки: больше на экране не различить. */
export const PZ3_LOAD_COLUMNS = 90;

export interface Pz3LoadColumn {
  /** Первый и последний день, попавшие в столбец. */
  fromDay: number;
  toDay: number;
  /** Пиковая потребность в людях за эти дни. */
  workers: number;
  overloaded: boolean;
}

/**
 * Загрузка, сведённая к столбцам постоянной ширины.
 *
 * По дню на столбец не годится: на проекте в тысячу дней столбец тоньше
 * пикселя, и гистограмма просто исчезает. Внутри столбца берём пик, а не
 * среднее: нехватка людей на два дня из десяти — это нехватка, и усреднение
 * прятало бы её.
 */
export function getPz3LoadColumns(usage: ResourceUsagePoint[], columns = PZ3_LOAD_COLUMNS): Pz3LoadColumn[] {
  if (usage.length === 0) {
    return [];
  }

  const size = Math.ceil(usage.length / columns);

  return Array.from({ length: Math.ceil(usage.length / size) }, (_, index) => {
    const slice = usage.slice(index * size, index * size + size);
    const peak = slice.reduce(
      (best, point) => (point.workers > best.workers ? point : best),
      slice[0],
    );

    return {
      fromDay: slice[0].day,
      toDay: slice[slice.length - 1].day,
      workers: peak.workers,
      overloaded: slice.some((point) => point.overloaded),
    };
  });
}

export interface Pz3ReportRow {
  title: string;
  unit: string;
  amount: number;
}

export interface Pz3Report {
  laborHours: number;
  machineHours: number;
  materials: Pz3ReportRow[];
  machines: Pz3ReportRow[];
  subWorks: Pz3ReportRow[];
}

/**
 * Отчёт по проекту: материалы, человеко-часы и машино-часы (ТЗ ПЗ3 §9).
 *
 * Одинаковые позиции складываются: студент видит расход по проекту, а не по
 * каждой строке таблицы работ.
 */
export function getPz3Report(draft: Pz3Draft): Pz3Report {
  const materials = new Map<string, Pz3ReportRow>();
  const machines = new Map<string, Pz3ReportRow>();
  const subWorks = new Map<string, Pz3ReportRow>();
  let laborHours = 0;
  let machineHours = 0;

  for (const work of draft.works) {
    const units = getPz3WorkUnits(work);

    if (units === 0) {
      continue;
    }

    const multipliers = getCostMultipliers(work);
    const norms = getWorkNormEntries(work);

    for (const { norm, units: normUnits } of norms) {
      norm.subWorks.forEach((subWork: Pz3SubWorkNorm) => {
        const amount = subWork.laborHours * normUnits * multipliers.labor;
        laborHours += amount;
        addRow(subWorks, subWork.title, 'чел.-ч', amount);
      });

      norm.materials.forEach((material: Pz3MaterialNorm) => {
        addRow(materials, material.title, material.unit, material.perUnit * normUnits * multipliers.materials);
      });

      norm.machines.forEach((machine: Pz3MachineNorm) => {
        machineHours += machine.machineHours * normUnits;
        addRow(machines, machine.title, 'маш.-ч', machine.machineHours * normUnits);
      });
    }
  }

  return {
    laborHours,
    machineHours,
    materials: sortRows(materials),
    machines: sortRows(machines),
    subWorks: sortRows(subWorks),
  };
}

function addRow(rows: Map<string, Pz3ReportRow>, title: string, unit: string, amount: number) {
  const existing = rows.get(title);

  if (existing) {
    existing.amount += amount;
    return;
  }

  rows.set(title, { title, unit, amount });
}

/** По убыванию расхода: крупные позиции первыми — их и обсуждают. */
function sortRows(rows: Map<string, Pz3ReportRow>): Pz3ReportRow[] {
  return [...rows.values()].sort((left, right) => right.amount - left.amount);
}
