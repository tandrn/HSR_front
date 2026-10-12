import type {
  NetworkValidationError,
  ProjectMetrics,
  ResourceUsagePoint,
  ScheduleResult,
  ScheduledWorkItem,
  WorkDefinition,
  WorkItem,
} from './types';

const idleThreshold = 0.45;

export function recalculateDurationsByLabor(workItems: WorkItem[]): WorkItem[] {
  return workItems.map((item) => ({
    ...item,
    duration: item.isWaiting ? item.duration : Math.max(1, Math.ceil(item.labor / item.workers)),
  }));
}

export function recalculateDefinition(definition: WorkDefinition): WorkDefinition {
  const labor = sanitizePositiveNumber(definition.labor);
  const workers = sanitizePositiveNumber(definition.workers);
  const duration =
    definition.calculationMode === 'manual-duration'
      ? sanitizePositiveNumber(definition.duration)
      : Math.max(1, Math.ceil(labor / workers));

  return {
    ...definition,
    labor,
    workers,
    duration,
  };
}

export function buildWorkItemsFromDefinitions(definitions: WorkDefinition[]): { items: WorkItem[]; errors: NetworkValidationError[] } {
  const errors = validateWorkDefinitions(definitions);
  if (errors.length > 0) {
    return { items: [], errors };
  }

  const normalized = definitions.map(recalculateDefinition);
  const items = normalized.map((definition) => ({
    id: definition.id,
    code: definition.code.trim(),
    title: definition.title.trim(),
    from: definition.from.trim(),
    to: definition.to.trim(),
    labor: definition.labor,
    workers: definition.workers,
    duration: definition.duration,
    plannedShift: definition.plannedShift,
    dependencies: normalized
      .filter((candidate) => candidate.id !== definition.id && candidate.to.trim() === definition.from.trim())
      .map((candidate) => candidate.id),
  }));

  return { items, errors: validateNetwork(items) };
}

export function validateWorkDefinitions(definitions: WorkDefinition[]): NetworkValidationError[] {
  const errors: NetworkValidationError[] = [];

  if (definitions.length === 0) {
    errors.push({ type: 'empty-project', field: 'project', message: 'Проект должен иметь хотя бы одну работу.' });
    return errors;
  }

  for (const definition of definitions) {
    if (!definition.code.trim()) {
      errors.push({ type: 'empty-code', field: 'code', workId: definition.id, message: 'Номер работы не должен быть пустым.' });
    }
    if (!definition.title.trim()) {
      errors.push({ type: 'empty-title', field: 'title', workId: definition.id, message: 'Заполните название работы.' });
    }
    if (!definition.from.trim()) {
      errors.push({ type: 'empty-from', field: 'from', workId: definition.id, message: 'Заполните событие начала.' });
    }
    if (!definition.to.trim()) {
      errors.push({ type: 'empty-to', field: 'to', workId: definition.id, message: 'Заполните событие окончания.' });
    }
    if (definition.from.trim() && definition.from.trim() === definition.to.trim()) {
      errors.push({
        type: 'same-event',
        field: 'to',
        workId: definition.id,
        message: 'Событие начала и событие окончания не могут совпадать.',
      });
    }
    if (!Number.isFinite(definition.labor) || definition.labor < 1) {
      errors.push({ type: 'invalid-labor', field: 'labor', workId: definition.id, message: 'Трудоёмкость должна быть больше 0.' });
    }
    if (!Number.isFinite(definition.workers) || definition.workers < 1) {
      errors.push({
        type: 'invalid-workers',
        field: 'workers',
        workId: definition.id,
        message: 'Количество исполнителей должно быть больше 0.',
      });
    }
    if (!Number.isFinite(definition.duration) || definition.duration < 1) {
      errors.push({
        type: 'invalid-duration',
        field: 'duration',
        workId: definition.id,
        message: 'Продолжительность должна быть больше 0.',
      });
    }
  }

  return errors;
}

export function updateWorkWorkers(workItems: WorkItem[], workItemId: string, workers: number): WorkItem[] {
  if (workers < 1) {
    throw new Error('Количество сотрудников должно быть не меньше 1.');
  }

  return workItems.map((item) =>
    item.id === workItemId
      ? {
          ...item,
          workers,
          duration: Math.max(1, Math.ceil(item.labor / workers)),
        }
      : item,
  );
}

export function updateWorkDuration(workItems: WorkItem[], workItemId: string, duration: number): WorkItem[] {
  if (duration < 1) {
    throw new Error('Длительность должна быть не меньше 1 дня.');
  }

  return workItems.map((item) =>
    item.id === workItemId
      ? {
          ...item,
          duration,
          workers: Math.max(1, Math.ceil(item.labor / duration)),
        }
      : item,
  );
}

export function shiftWork(workItems: WorkItem[], workItemId: string, shift: number): WorkItem[] {
  return workItems.map((item) => (item.id === workItemId ? { ...item, plannedShift: Math.max(0, shift) } : item));
}

export function calculateSchedule(workItems: WorkItem[]): ScheduleResult {
  const errors = validateNetwork(workItems);
  if (errors.length > 0) {
    return { items: [], projectDuration: 0, errors };
  }

  const order = topologicalSort(workItems);
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const successors = buildSuccessors(workItems);
  const baseSchedule = buildForwardSchedule(order, byId, 0);
  const baseProjectDuration = getScheduleDuration(baseSchedule);
  applyLateDates(order, baseSchedule, successors, baseProjectDuration);
  const hasManualShifts = order.some((id) => (byId.get(id)?.plannedShift ?? 0) > 0);

  if (!hasManualShifts) {
    return { items: order.map((id) => baseSchedule.get(id)!), projectDuration: baseProjectDuration, errors: [] };
  }

  const shiftedSchedule = new Map<string, ScheduledWorkItem>();
  for (const id of order) {
    const item = byId.get(id)!;
    const baseItem = baseSchedule.get(id)!;
    const dependencyFinish = item.dependencies.reduce((finish, dependencyId) => {
      return Math.max(finish, shiftedSchedule.get(dependencyId)?.earlyFinish ?? 0);
    }, 0);
    const requestedShift = Math.max(0, item.plannedShift ?? 0);
    const allowedShift = Math.max(0, baseItem.lateStart - dependencyFinish);
    const appliedShift = Math.min(requestedShift, allowedShift);
    const earlyStart = dependencyFinish + appliedShift;
    const earlyFinish = earlyStart + Math.max(1, item.duration);

    shiftedSchedule.set(id, {
      ...item,
      plannedShift: appliedShift,
      duration: Math.max(1, item.duration),
      earlyStart,
      earlyFinish,
      lateStart: 0,
      lateFinish: 0,
      totalFloat: 0,
      freeFloat: 0,
      isCritical: false,
    });
  }

  const shiftedProjectDuration = getScheduleDuration(shiftedSchedule);
  applyLateDates(order, shiftedSchedule, successors, shiftedProjectDuration);

  return { items: order.map((id) => shiftedSchedule.get(id)!), projectDuration: shiftedProjectDuration, errors: [] };
}

function buildForwardSchedule(order: string[], byId: Map<string, WorkItem>, defaultShift: number): Map<string, ScheduledWorkItem> {
  const scheduled = new Map<string, ScheduledWorkItem>();
  for (const id of order) {
    const item = byId.get(id)!;
    const dependencyFinish = item.dependencies.reduce((finish, dependencyId) => {
      return Math.max(finish, scheduled.get(dependencyId)?.earlyFinish ?? 0);
    }, 0);
    const earlyStart = dependencyFinish + defaultShift;
    const earlyFinish = earlyStart + Math.max(1, item.duration);

    scheduled.set(id, {
      ...item,
      plannedShift: defaultShift,
      duration: Math.max(1, item.duration),
      earlyStart,
      earlyFinish,
      lateStart: 0,
      lateFinish: 0,
      totalFloat: 0,
      freeFloat: 0,
      isCritical: false,
    });
  }
  return scheduled;
}

function getScheduleDuration(scheduled: Map<string, ScheduledWorkItem>): number {
  return scheduled.size ? Math.max(...Array.from(scheduled.values()).map((item) => item.earlyFinish)) : 0;
}

function applyLateDates(
  order: string[],
  scheduled: Map<string, ScheduledWorkItem>,
  successors: Map<string, string[]>,
  projectDuration: number,
) {
  for (const id of [...order].reverse()) {
    const item = scheduled.get(id)!;
    const itemSuccessors = successors.get(id) ?? [];
    const lateFinish =
      itemSuccessors.length === 0
        ? projectDuration
        : Math.min(...itemSuccessors.map((successorId) => scheduled.get(successorId)!.lateStart));
    item.lateFinish = lateFinish;
    item.lateStart = lateFinish - item.duration;
    item.totalFloat = item.lateStart - item.earlyStart;
    item.freeFloat =
      itemSuccessors.length === 0
        ? projectDuration - item.earlyFinish
        : Math.min(...itemSuccessors.map((successorId) => scheduled.get(successorId)!.earlyStart)) - item.earlyFinish;
    item.isCritical = item.totalFloat === 0;
  }
}

export function calculateResourceUsage(workItems: WorkItem[], resourceLimit = 0): ResourceUsagePoint[] {
  const schedule = isScheduled(workItems) ? { items: workItems as ScheduledWorkItem[] } : calculateSchedule(workItems);
  if (!schedule.items.length) {
    return [];
  }

  const duration = Math.max(...schedule.items.map((item) => item.earlyFinish));
  return Array.from({ length: duration }, (_, day) => {
    const workers = schedule.items.reduce((sum, item) => {
      return day >= item.earlyStart && day < item.earlyFinish ? sum + item.workers : sum;
    }, 0);

    return {
      day: day + 1,
      workers,
      overloaded: resourceLimit > 0 && workers > resourceLimit,
      idle: resourceLimit > 0 && workers > 0 && workers < resourceLimit * idleThreshold,
    };
  });
}

export function calculateResourceUsageWithFloat(workItems: WorkItem[], resourceLimit = 0): ResourceUsagePoint[] {
  const schedule = isScheduled(workItems) ? { items: workItems as ScheduledWorkItem[] } : calculateSchedule(workItems);
  if (!schedule.items.length) {
    return [];
  }

  const duration = Math.max(...schedule.items.map((item) => item.earlyFinish));
  const allocations = schedule.items.map(getReserveAwareAllocation);

  return Array.from({ length: duration }, (_, day) => {
    const workers = allocations.reduce((sum, allocation) => {
      return day >= allocation.start && day < allocation.finish ? sum + allocation.workers : sum;
    }, 0);

    return {
      day: day + 1,
      workers,
      overloaded: resourceLimit > 0 && workers > resourceLimit,
      idle: resourceLimit > 0 && workers > 0 && workers < resourceLimit * idleThreshold,
    };
  });
}

function getReserveAwareAllocation(item: ScheduledWorkItem) {
  const availableDuration = Math.max(1, item.duration + Math.max(0, item.totalFloat));
  const workers = item.totalFloat > 0 ? Math.max(1, Math.ceil(item.labor / availableDuration)) : item.workers;
  const duration = item.totalFloat > 0 ? Math.min(availableDuration, Math.max(1, Math.ceil(item.labor / workers))) : item.duration;

  return {
    start: item.earlyStart,
    finish: Math.min(item.lateFinish, item.earlyStart + duration),
    workers,
  };
}

export function getCriticalPath(workItems: WorkItem[]): ScheduledWorkItem[] {
  const schedule = isScheduled(workItems) ? (workItems as ScheduledWorkItem[]) : calculateSchedule(workItems).items;
  return schedule.filter((item) => item.isCritical);
}

export function getProjectMetrics(workItems: WorkItem[], resourceLimit: number): ProjectMetrics {
  const schedule = isScheduled(workItems) ? (workItems as ScheduledWorkItem[]) : calculateSchedule(workItems).items;
  const usage = calculateResourceUsage(schedule, resourceLimit);
  const projectDuration = schedule.length ? Math.max(...schedule.map((item) => item.earlyFinish)) : 0;
  const maxWorkers = usage.length ? Math.max(...usage.map((point) => point.workers)) : 0;
  const averageWorkers = usage.length ? usage.reduce((sum, point) => sum + point.workers, 0) / usage.length : 0;
  const overloadDays = usage.filter((point) => point.overloaded).length;
  const idleDays = usage.filter((point) => point.idle).length;
  const efficiency = resourceLimit > 0 && projectDuration > 0 ? Math.round((averageWorkers / resourceLimit) * 100) : 0;

  return {
    projectDuration,
    maxWorkers,
    averageWorkers,
    criticalCount: schedule.filter((item) => item.isCritical).length,
    floatCount: schedule.filter((item) => item.totalFloat > 0).length,
    overloadDays,
    idleDays,
    efficiency,
  };
}

export function validateNetwork(workItems: WorkItem[]): NetworkValidationError[] {
  const errors: NetworkValidationError[] = [];
  const ids = new Set(workItems.map((item) => item.id));

  for (const item of workItems) {
    if (item.workers < 1 && !(item.isWaiting && item.workers === 0 && item.labor === 0)) {
      errors.push({ type: 'invalid-workers', workId: item.id, message: `В работе ${item.code} сотрудников должно быть не меньше 1.` });
    }
    if (item.duration < 1) {
      errors.push({ type: 'invalid-duration', workId: item.id, message: `В работе ${item.code} длительность должна быть не меньше 1.` });
    }
    for (const dependencyId of item.dependencies) {
      if (!ids.has(dependencyId)) {
        errors.push({
          type: 'missing-dependency',
          workId: item.id,
          message: `Работа ${item.code} ссылается на несуществующую зависимость ${dependencyId}.`,
        });
      }
    }
  }

  if (errors.length === 0 && topologicalSort(workItems).length !== workItems.length) {
    errors.push({ type: 'cycle', field: 'project', message: 'В графике обнаружен цикл. Проверьте события начала и окончания.' });
  }

  return errors;
}

function sanitizePositiveNumber(value: number): number {
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

function topologicalSort(workItems: WorkItem[]): string[] {
  const ids = new Set(workItems.map((item) => item.id));
  const incoming = new Map(workItems.map((item) => [item.id, item.dependencies.filter((id) => ids.has(id)).length]));
  const outgoing = buildSuccessors(workItems);
  const queue = workItems.filter((item) => incoming.get(item.id) === 0).map((item) => item.id);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);

    for (const successorId of outgoing.get(id) ?? []) {
      incoming.set(successorId, (incoming.get(successorId) ?? 0) - 1);
      if (incoming.get(successorId) === 0) {
        queue.push(successorId);
      }
    }
  }

  return order;
}

function buildSuccessors(workItems: WorkItem[]): Map<string, string[]> {
  const successors = new Map(workItems.map((item) => [item.id, [] as string[]]));
  for (const item of workItems) {
    for (const dependencyId of item.dependencies) {
      successors.get(dependencyId)?.push(item.id);
    }
  }
  return successors;
}

function isScheduled(workItems: WorkItem[]): boolean {
  return workItems.every((item) => typeof item.earlyStart === 'number' && typeof item.earlyFinish === 'number');
}
