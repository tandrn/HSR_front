/** Расчёт учебной сети работ: все связи означают «окончание — начало». */
export interface CriticalPathWork {
  id: string;
  durationDays: number;
  predecessors: string[];
}

export interface CriticalPathTiming {
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  float: number;
}

export interface CriticalPathResult {
  durationDays: number;
  timings: Record<string, CriticalPathTiming>;
  paths: string[][];
}

export interface CriticalPathTimingInput {
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  float: string;
}

export interface CriticalPathSubmission {
  durationDays: string;
  paths: string;
  timings: Record<string, CriticalPathTimingInput>;
  /** Ответ на дополнительный вопрос варианта, который проверяет преподаватель. */
  reasoning: string;
}

export interface CriticalPathCheck {
  durationCorrect: boolean;
  pathsCorrect: boolean;
  earlyErrors: string[];
  optionalErrors: string[];
  earlyComplete: boolean;
  optionalComplete: boolean;
  coreCorrect: boolean;
}

export function createEmptyCriticalPathSubmission(): CriticalPathSubmission {
  return { durationDays: '', paths: '', timings: {}, reasoning: '' };
}

/** Прямой и обратный проходы по сети; пути перечисляются по критическим связям. */
export function calculateCriticalPath(works: CriticalPathWork[]): CriticalPathResult {
  const byId = new Map(works.map((work) => [work.id, work]));
  if (byId.size !== works.length || works.some((work) => !Number.isFinite(work.durationDays) || work.durationDays <= 0)) {
    throw new Error('Сеть содержит повторяющиеся работы или неверную длительность.');
  }

  const successors = new Map(works.map((work) => [work.id, [] as string[]]));
  for (const work of works) {
    for (const predecessor of work.predecessors) {
      const next = successors.get(predecessor);
      if (!next) throw new Error(`Не найдена работа ${predecessor}.`);
      next.push(work.id);
    }
  }

  const order: CriticalPathWork[] = [];
  const pending = new Map(works.map((work) => [work.id, work.predecessors.length]));
  const ready = works.filter((work) => work.predecessors.length === 0);
  while (ready.length > 0) {
    const work = ready.shift()!;
    order.push(work);
    for (const successor of successors.get(work.id) ?? []) {
      const left = pending.get(successor)! - 1;
      pending.set(successor, left);
      if (left === 0) ready.push(byId.get(successor)!);
    }
  }
  if (order.length !== works.length || works.length === 0) {
    throw new Error('Сеть пуста или содержит цикл.');
  }

  const timings: Record<string, CriticalPathTiming> = {};
  for (const work of order) {
    const earlyStart = Math.max(0, ...work.predecessors.map((id) => timings[id].earlyFinish));
    timings[work.id] = { earlyStart, earlyFinish: earlyStart + work.durationDays, lateStart: 0, lateFinish: 0, float: 0 };
  }
  const durationDays = Math.max(...order.map((work) => timings[work.id].earlyFinish));
  for (const work of [...order].reverse()) {
    const next = successors.get(work.id)!;
    const lateFinish = next.length === 0 ? durationDays : Math.min(...next.map((id) => timings[id].lateStart));
    const lateStart = lateFinish - work.durationDays;
    timings[work.id] = { ...timings[work.id], lateStart, lateFinish, float: lateStart - timings[work.id].earlyStart };
  }

  const paths: string[][] = [];
  function visit(id: string, path: string[]) {
    const current = timings[id];
    const next = successors.get(id)!.filter((successor) =>
      timings[successor].float === 0 && current.earlyFinish === timings[successor].earlyStart,
    );
    if (next.length === 0) {
      if (current.earlyFinish === durationDays) paths.push([...path, id]);
      return;
    }
    for (const successor of next) visit(successor, [...path, id]);
  }
  for (const work of order) {
    if (work.predecessors.length === 0 && timings[work.id].float === 0) visit(work.id, []);
  }

  return { durationDays, timings, paths };
}

/** Пути вводятся через ; или с новой строки; порядок самих путей не важен. */
export function parseCriticalPaths(input: string): string[][] {
  return input
    .split(/[;\n]+/)
    .map((path) => path.trim().toUpperCase().split(/[^A-ZА-ЯЁ0-9]+/).filter(Boolean))
    .filter((path) => path.length > 0);
}

export function matchCriticalPathSet(input: string, expected: string[][]): boolean {
  const actual = parseCriticalPaths(input).map((path) => path.join('→')).sort();
  const reference = expected.map((path) => path.join('→')).sort();
  return actual.length > 0 && actual.length === reference.length && actual.every((path, index) => path === reference[index]);
}

function matchesDay(input: string, expected: number): boolean {
  const value = input.trim();
  return /^\d+$/.test(value) && Number(value) === expected;
}

/** Проверка не раскрывает эталон: интерфейс получает только коды ошибочных строк. */
export function checkCriticalPathSubmission(
  submission: CriticalPathSubmission,
  expected: CriticalPathResult,
): CriticalPathCheck {
  const earlyErrors: string[] = [];
  const optionalErrors: string[] = [];
  let earlyComplete = true;
  let optionalComplete = true;
  for (const [id, timing] of Object.entries(expected.timings)) {
    const input = submission.timings[id];
    for (const field of ['earlyStart', 'earlyFinish'] as const) {
      if (!input?.[field]?.trim()) earlyComplete = false;
      if (input?.[field]?.trim() && !matchesDay(input[field], timing[field])) earlyErrors.push(`${id}:${field}`);
    }
    for (const field of ['lateStart', 'lateFinish', 'float'] as const) {
      if (!input?.[field]?.trim()) optionalComplete = false;
      if (input?.[field]?.trim() && !matchesDay(input[field], timing[field])) optionalErrors.push(`${id}:${field}`);
    }
  }
  const durationCorrect = matchesDay(submission.durationDays, expected.durationDays);
  const pathsCorrect = matchCriticalPathSet(submission.paths, expected.paths);
  return {
    durationCorrect, pathsCorrect, earlyErrors, optionalErrors, earlyComplete, optionalComplete,
    coreCorrect: durationCorrect && pathsCorrect && earlyComplete && earlyErrors.length === 0,
  };
}
