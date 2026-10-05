import { describe, expect, it } from 'vitest';
import type { BridgeSchema } from '../../bridge/schema';
import { calculateCriticalPath } from '../../shared/lib/criticalPath';
import {
  PZ2_LENGTH_TOLERANCE_KM,
  createInitialPz2Draft,
  changePz2WorkKind,
  assignPz2WorkToStage,
  checkPz2CriticalPath,
  createPz2Bridge,
  createPz2Ruler,
  createPz2Stage,
  findPz2OverlappingWorks,
  getPz2RoutePointMarks,
  getPz2ExercisesProgress,
  getPz2SegmentMarks,
  getPz2StageWorks,
  getPz2WorkMarks,
  isPz2StagesComplete,
  isPz2ExercisesComplete,
  readPz2Position,
  removePz2Stage,
  setPz2WorkLength,
  createPz2Work,
  getPz2LengthCheck,
  getPz2RouteSource,
  getPz2StationMarks,
  isPz2WorksComplete,
  parsePz2Number,
  pz2WorkKinds,
  validatePz2Work,
} from './model';
import { pz2NetworkExercises } from './networkExercises';
import { getPz2IconKinds, getPz2WorkIcon } from './workIcons';

function draftWith(objects: Parameters<typeof getPz2LengthCheck>[0]['works']) {
  return { ...createInitialPz2Draft(), works: objects };
}

function lengthObject(kind: Parameters<typeof createPz2Work>[0], lengthKm: string) {
  return { ...createPz2Work(kind), lengthKm };
}

describe('справочник работ', () => {
  it('содержит согласованный со встречи 02.09 состав', () => {
    // Порядок сверен с ТЗ ПЗ2 §4.1 — он же задаёт порядок в выпадающем списке.
    expect(pz2WorkKinds.map((kind) => kind.id)).toEqual([
      'existingLineRepair',
      'ballastTrack',
      'earthworks',
      'viaduct',
      'bridge',
      'tunnel',
      'turnout',
    ]);
  });

  it('стрелка меряется штуками, остальные — длиной', () => {
    const byMeasure = Object.fromEntries(pz2WorkKinds.map((kind) => [kind.id, kind.measure]));

    expect(byMeasure.turnout).toBe('count');
    expect(byMeasure.bridge).toBe('length');
    expect(byMeasure.existingLineRepair).toBe('length');
  });
});

describe('getPz2RouteSource', () => {
  it('забирает трассу и длину маршрута из моста ПЗ1', () => {
    const bridge = {
      schemaVersion: '1.1',
      passport: { team: 'Юнит-3', lineTitle: '', createdAt: '2026-09-03T00:00:00.000Z' },
      completed: {
        pz1: {
          totalLengthKm: 512.85,
          variantId: '1',
          routeLine: {
            vertices: [
              { id: 'v1', lat: 0, lon: 0 },
              { id: 'v2', lat: 0, lon: 1 },
            ],
            segments: [{ id: 's1', fromVertexId: 'v1', toVertexId: 'v2', sagittaKm: 0 }],
          },
        },
      },
    } as unknown as BridgeSchema;

    const source = getPz2RouteSource(bridge);

    expect(source.totalLengthKm).toBe(512.85);
    expect(source.routeLine?.vertices).toHaveLength(2);
    expect(createPz2Ruler(source).totalKm).toBeGreaterThan(0);
  });

  it('без загруженного файла трасса пустая, а не сломанная', () => {
    const source = getPz2RouteSource(null);

    expect(source.routeLine).toBeNull();
    expect(source.totalLengthKm).toBe(0);
    expect(createPz2Ruler(source).totalKm).toBe(0);
  });
});

describe('станции на трассе', () => {
  const bridge = {
    completed: {
      pz1: {
        totalLengthKm: 222.39,
        stations: [
          { label: 'Г', name: 'Конечная', lat: 0, lng: 2, type: 'terminal' },
          { label: 'А', name: 'Начальная', lat: 0, lng: 0, type: 'terminal' },
          { label: 'Б', name: 'Промежуточная', lat: 0.2, lng: 1, type: 'intermediate' },
        ],
        routeLine: {
          vertices: [
            { id: 'v1', lat: 0, lon: 0 },
            { id: 'v2', lat: 0, lon: 2 },
          ],
          segments: [{ id: 's1', fromVertexId: 'v1', toVertexId: 'v2', sagittaKm: 0 }],
        },
      },
    },
  } as unknown as BridgeSchema;

  it('километраж считается вдоль трассы, порядок — по трассе, а не по алфавиту', () => {
    const source = getPz2RouteSource(bridge);
    const marks = getPz2StationMarks(source, createPz2Ruler(source));

    expect(marks.map((mark) => mark.label)).toEqual(['А', 'Б', 'Г']);
    expect(marks[0].distanceKm).toBeCloseTo(0, 6);
    // Градус долготы на экваторе — примерно 111,19 км.
    expect(marks[1].distanceKm).toBeCloseTo(111.19, 1);
    expect(marks[2].distanceKm).toBeCloseTo(222.39, 1);
  });

  it('станция в стороне от линии всё равно получает километраж ближайшей точки', () => {
    const source = getPz2RouteSource(bridge);
    const marks = getPz2StationMarks(source, createPz2Ruler(source));

    // Промежуточная стоит в 0,2° севернее линии, но её километраж — по трассе.
    expect(marks[1].lat).toBeCloseTo(0.2, 6);
    expect(marks[1].distanceKm).toBeCloseTo(111.19, 1);
  });

  it('без станций в файле список пустой, а не сломанный', () => {
    const source = getPz2RouteSource(null);

    expect(getPz2StationMarks(source, createPz2Ruler(source))).toEqual([]);
  });
});

describe('проверка длины', () => {
  it('пустая таблица — отдельное состояние, а не расхождение', () => {
    expect(getPz2LengthCheck(createInitialPz2Draft(), 100).status).toBe('empty');
  });

  it('сумма сошлась с длиной маршрута в пределах допуска', () => {
    const check = getPz2LengthCheck(draftWith([lengthObject('earthworks', '60'), lengthObject('bridge', '40,2')]), 100);

    expect(check.measuredKm).toBeCloseTo(100.2, 6);
    expect(check.status).toBe('match');
  });

  it('недомерил и перемерил различаются знаком, а не только текстом', () => {
    expect(getPz2LengthCheck(draftWith([lengthObject('earthworks', '80')]), 100).status).toBe('short');
    expect(getPz2LengthCheck(draftWith([lengthObject('earthworks', '120')]), 100).status).toBe('over');
    expect(getPz2LengthCheck(draftWith([lengthObject('earthworks', '80')]), 100).differenceKm).toBeCloseTo(-20, 6);
  });

  it('на границе допуска ещё считается сошедшимся', () => {
    const check = getPz2LengthCheck(draftWith([lengthObject('earthworks', String(100 + PZ2_LENGTH_TOLERANCE_KM))]), 100);

    expect(check.status).toBe('match');
  });

  it('стрелки в длину трассы не идут — они меряются штуками', () => {
    const objects = [lengthObject('earthworks', '100'), { ...createPz2Work('turnout'), count: '4' }];

    expect(getPz2LengthCheck(draftWith(objects), 100).measuredKm).toBeCloseTo(100, 6);
  });
});

describe('наложение участков', () => {
  const span = (kind: Parameters<typeof createPz2Work>[0], fromKm: number, toKm: number) =>
    createPz2Work(kind, String(Math.abs(toKm - fromKm)), { fromKm, toKm });

  it('участки встык наложением не считаются', () => {
    const draft = draftWith([span('earthworks', 0, 50), span('bridge', 50, 80)]);

    expect(findPz2OverlappingWorks(draft)).toEqual([]);
  });

  it('перекрытие находится с обеих сторон, независимо от порядка строк', () => {
    const first = span('earthworks', 40, 90);
    const second = span('bridge', 0, 50);
    const overlapping = findPz2OverlappingWorks(draftWith([first, second]));

    expect(overlapping).toHaveLength(2);
    expect(overlapping).toContain(first.id);
    expect(overlapping).toContain(second.id);
  });

  it('участок, намеренный в обратную сторону, тоже сравнивается верно', () => {
    const draft = draftWith([span('earthworks', 90, 40), span('bridge', 0, 50)]);

    expect(findPz2OverlappingWorks(draft)).toHaveLength(2);
  });

  it('строки без участка молчат — у ручного ввода места на трассе нет', () => {
    const draft = draftWith([lengthObject('earthworks', '50'), lengthObject('bridge', '50')]);

    expect(findPz2OverlappingWorks(draft)).toEqual([]);
  });
});

describe('валидация работы', () => {
  it('длина обязательна и должна быть положительной', () => {
    expect(validatePz2Work(lengthObject('bridge', ''))).toBe('Укажите длину');
    expect(validatePz2Work(lengthObject('bridge', '0'))).toBe('Длина должна быть больше нуля');
    expect(validatePz2Work(lengthObject('bridge', '1,5'))).toBeNull();
  });

  it('у стрелки проверяется целое количество, а не длина', () => {
    const base = createPz2Work('turnout');

    expect(validatePz2Work({ ...base, count: '' })).toBe('Укажите количество');
    expect(validatePz2Work({ ...base, count: '1,5' })).toBe('Количество — целое число больше нуля');
    expect(validatePz2Work({ ...base, count: '2' })).toBeNull();
  });

  it('шаг завершён, когда есть работы и все они корректны', () => {
    expect(isPz2WorksComplete(createInitialPz2Draft())).toBe(false);
    expect(isPz2WorksComplete(draftWith([lengthObject('bridge', '2')]))).toBe(true);
    expect(isPz2WorksComplete(draftWith([lengthObject('bridge', '')]))).toBe(false);
  });
});

describe('смена типа работы', () => {
  it('переключение на штучный тип подставляет одну штуку, а не пустое поле', () => {
    const changed = changePz2WorkKind(lengthObject('bridge', '12,5'), 'turnout');

    expect(changed.count).toBe('1');
    expect(validatePz2Work(changed)).toBeNull();
  });

  it('намеренная длина переживает переключение туда и обратно', () => {
    const measured = lengthObject('bridge', '12,5');
    const back = changePz2WorkKind(changePz2WorkKind(measured, 'turnout'), 'tunnel');

    expect(back.lengthKm).toBe('12,5');
  });

  it('уже заполненное количество не перетирается', () => {
    const counted = { ...createPz2Work('turnout'), count: '7' };

    expect(changePz2WorkKind(counted, 'turnout').count).toBe('7');
  });
});

describe('parsePz2Number', () => {
  it('принимает запятую и разделители разрядов', () => {
    expect(parsePz2Number('1 234,5')).toBeCloseTo(1234.5, 6);
    expect(parsePz2Number('12,25')).toBeCloseTo(12.25, 6);
  });

  it('пустое и мусорное дают null, а не ноль', () => {
    expect(parsePz2Number('')).toBeNull();
    expect(parsePz2Number('   ')).toBeNull();
    expect(parsePz2Number('абв')).toBeNull();
  });
});

describe('этапы', () => {
  const draftWithStages = () => {
    const stage = createPz2Stage('Первый участок', 0);
    const work = createPz2Work('bridge', '12');

    return { ...createInitialPz2Draft(), stages: [stage], works: [work] };
  };

  it('работа по умолчанию лежит в пуле, а не в этапе', () => {
    expect(createPz2Work('bridge', '12').stageId).toBeNull();
    expect(getPz2StageWorks(draftWithStages(), null)).toHaveLength(1);
  });

  it('перенос в этап заменяет принадлежность, а не добавляет вторую', () => {
    const draft = draftWithStages();
    const second = createPz2Stage('Второй участок', 1);
    const withStages = { ...draft, stages: [...draft.stages, second] };

    const assigned = assignPz2WorkToStage(withStages, draft.works[0].id, draft.stages[0].id);
    const moved = assignPz2WorkToStage(assigned, draft.works[0].id, second.id);

    expect(getPz2StageWorks(moved, draft.stages[0].id)).toHaveLength(0);
    expect(getPz2StageWorks(moved, second.id)).toHaveLength(1);
  });

  it('работу можно вернуть обратно в пул', () => {
    const draft = draftWithStages();
    const assigned = assignPz2WorkToStage(draft, draft.works[0].id, draft.stages[0].id);

    expect(getPz2StageWorks(assignPz2WorkToStage(assigned, draft.works[0].id, null), null)).toHaveLength(1);
  });

  it('удаление этапа возвращает его работы в пул, а не стирает их', () => {
    const draft = draftWithStages();
    const assigned = assignPz2WorkToStage(draft, draft.works[0].id, draft.stages[0].id);
    const removed = removePz2Stage(assigned, draft.stages[0].id);

    expect(removed.stages).toHaveLength(0);
    expect(removed.works).toHaveLength(1);
    expect(removed.works[0].stageId).toBeNull();
  });

  it('после удаления порядок этапов идёт без дыр', () => {
    const draft = {
      ...createInitialPz2Draft(),
      stages: [createPz2Stage('А', 0), createPz2Stage('Б', 1), createPz2Stage('В', 2)],
    };

    const removed = removePz2Stage(draft, draft.stages[1].id);

    expect(removed.stages.map((stage) => stage.order)).toEqual([0, 1]);
  });

  it('шаг завершён, когда этапы есть и ни одна работа не осталась в пуле', () => {
    const draft = draftWithStages();

    expect(isPz2StagesComplete(draft)).toBe(false);
    expect(isPz2StagesComplete(assignPz2WorkToStage(draft, draft.works[0].id, draft.stages[0].id))).toBe(true);
  });
});

describe('мост ПЗ2', () => {
  it('сохранение не теряет данные ПЗ1 и поднимает версию схемы', () => {
    const imported = {
      schemaVersion: '1.1',
      passport: { team: 'Юнит-3', lineTitle: '', createdAt: '2026-09-03T00:00:00.000Z' },
      completed: { pz1: { totalLengthKm: 100, routeLine: null } },
    } as unknown as BridgeSchema;
    const draft = { ...createInitialPz2Draft(), works: [createPz2Work('bridge', '40')] };

    const bridge = createPz2Bridge(draft, imported, { phase: 'task', stepId: 'works', theorySeen: true });

    expect(bridge.schemaVersion).toBe('1.2');
    expect(bridge.passport.team).toBe('Юнит-3');
    expect(bridge.completed.pz1).toEqual(imported.completed.pz1);
    expect(bridge.completed.pz2?.works[0].lengthKm).toBe(40);
    expect(bridge.completed.pz2?.works[0].count).toBeNull();
    expect(bridge.completed.pz2?.routeLengthKm).toBe(100);
  });

  it('у штучной работы в мост уходит количество, а не длина', () => {
    const draft = { ...createInitialPz2Draft(), works: [{ ...createPz2Work('turnout'), count: '4' }] };
    const result = createPz2Bridge(draft, null).completed.pz2;

    expect(result?.works[0].count).toBe(4);
    expect(result?.works[0].lengthKm).toBeNull();
  });

  it('сохраняет все поля упражнения и читает прежний файл с одним ответом-путём', () => {
    const draft = createInitialPz2Draft();
    const submission = {
      durationDays: '16', paths: 'A-C-E-G', reasoning: 'E заканчивается позже F',
      timings: {
        A: { earlyStart: '0', earlyFinish: '4', lateStart: '0', lateFinish: '4', float: '0' },
      },
    };
    draft.criticalPathAnswers.bridge = submission;
    const bridge = createPz2Bridge(draft, null);
    const saved = bridge.completed.pz2?.criticalPath.find((answer) => answer.exerciseId === 'bridge');

    expect(saved?.submission).toEqual(submission);
    expect(createInitialPz2Draft(bridge).criticalPathAnswers.bridge).toEqual(submission);

    const legacy = {
      ...bridge,
      completed: {
        ...bridge.completed,
        pz2: { ...bridge.completed.pz2, criticalPath: [{ exerciseId: 'bridge', answer: 'A-C-E-G', correct: true }] },
      },
    } as BridgeSchema;
    expect(createInitialPz2Draft(legacy).criticalPathAnswers.bridge.paths).toBe('A-C-E-G');
  });

  it('позиция читается по стабильному id, незнакомый шаг даёт интро', () => {
    const position = (stepId: string) =>
      readPz2Position({ position: { pz2: { phase: 'task', stepId, theorySeen: true } } } as unknown as BridgeSchema);

    expect(position('stages')?.stepIndex).toBe(1);
    expect(position('exercises')?.stepIndex).toBe(2);
    expect(position('чего-то-нет')).toBeNull();
    expect(readPz2Position(null)).toBeNull();
  });
});

describe('критический путь', () => {
  it('разделители не важны — важны номера и их порядок', () => {
    expect(checkPz2CriticalPath('1-3-5-7', ['1', '3', '5', '7'])).toBe(true);
    expect(checkPz2CriticalPath('1, 3, 5, 7', ['1', '3', '5', '7'])).toBe(true);
    expect(checkPz2CriticalPath(' 1 3 5 7 ', ['1', '3', '5', '7'])).toBe(true);
  });

  it('порядок значим: путь идёт от начала к концу', () => {
    expect(checkPz2CriticalPath('7-5-3-1', ['1', '3', '5', '7'])).toBe(false);
  });

  it('лишнее или недостающее событие делает ответ неверным', () => {
    expect(checkPz2CriticalPath('1-3-5', ['1', '3', '5', '7'])).toBe(false);
    expect(checkPz2CriticalPath('1-3-4-5-7', ['1', '3', '5', '7'])).toBe(false);
  });

  it('пустой ответ не считается верным даже при пустом эталоне', () => {
    expect(checkPz2CriticalPath('', [])).toBe(false);
    expect(checkPz2CriticalPath('   ', ['1'])).toBe(false);
  });
});

describe('обязательное выполнение упражнений', () => {
  function solveCriticalPathExercises() {
    return Object.fromEntries(pz2NetworkExercises.map((exercise) => {
      const result = calculateCriticalPath(exercise.works);

      return [exercise.id, {
        durationDays: String(result.durationDays),
        paths: result.paths.map((path) => path.join('-')).join('; '),
        reasoning: '',
        timings: Object.fromEntries(Object.entries(result.timings).map(([id, timing]) => [id, {
          earlyStart: String(timing.earlyStart),
          earlyFinish: String(timing.earlyFinish),
          lateStart: '',
          lateFinish: '',
          float: '',
        }])),
      }];
    }));
  }

  it('не разрешает пропустить пустой экран упражнений', () => {
    const draft = createInitialPz2Draft();

    expect(getPz2ExercisesProgress(draft)).toEqual({
      solvedCriticalPath: 0,
      totalCriticalPath: 7,
      levelingSolved: false,
      isComplete: false,
    });
    expect(isPz2ExercisesComplete(draft)).toBe(false);
  });

  it('требует все семь вариантов и решённое выравнивание', () => {
    const answers = solveCriticalPathExercises();
    const almostDone = {
      ...createInitialPz2Draft(),
      criticalPathAnswers: answers,
    };

    expect(getPz2ExercisesProgress(almostDone).solvedCriticalPath).toBe(7);
    expect(isPz2ExercisesComplete(almostDone)).toBe(false);
    expect(isPz2ExercisesComplete({ ...almostDone, levelingShifts: { w6: 6 } })).toBe(true);
  });

  it('одного нерешённого варианта достаточно, чтобы оставить переход закрытым', () => {
    const answers = solveCriticalPathExercises();
    delete answers.turnout;
    const draft = {
      ...createInitialPz2Draft(),
      criticalPathAnswers: answers,
      levelingShifts: { w6: 6 },
    };

    expect(getPz2ExercisesProgress(draft).solvedCriticalPath).toBe(6);
    expect(isPz2ExercisesComplete(draft)).toBe(false);
  });
});

describe('точки и сегменты трассы из ПЗ1', () => {
  // Ломаная с кривой в середине: две прямые вставки и дуга между ними.
  const bridge = {
    completed: {
      pz1: {
        totalLengthKm: 0,
        stations: [],
        routeLine: {
          vertices: [
            { id: 'v1', lat: 0, lon: 0 },
            { id: 'v2', lat: 0, lon: 1 },
            { id: 'v3', lat: 0, lon: 2 },
          ],
          segments: [
            { id: 's1', fromVertexId: 'v1', toVertexId: 'v2', sagittaKm: 0 },
            { id: 's2', fromVertexId: 'v2', toVertexId: 'v3', sagittaKm: 5 },
          ],
        },
      },
    },
  } as unknown as BridgeSchema;

  it('точки переносятся все и с теми же номерами, что в ПЗ1', () => {
    const source = getPz2RouteSource(bridge);
    const marks = getPz2RoutePointMarks(source, createPz2Ruler(source));

    expect(marks.map((mark) => mark.number)).toEqual([1, 2, 3]);
    expect(marks[0].distanceKm).toBeCloseTo(0, 6);
    expect(marks[2].distanceKm).toBeGreaterThan(marks[1].distanceKm);
  });

  it('кривая длиннее своей хорды — дуга переносится, а не спрямляется', () => {
    const segments = getPz2SegmentMarks(getPz2RouteSource(bridge));

    expect(segments).toHaveLength(2);
    expect(segments[0].radiusM).toBeNull();
    expect(segments[1].radiusM).toBeGreaterThan(0);
    expect(segments[1].lengthKm).toBeGreaterThan(segments[0].lengthKm);
  });

  it('километры сегментов идут подряд, без разрывов', () => {
    const segments = getPz2SegmentMarks(getPz2RouteSource(bridge));

    expect(segments[0].fromKm).toBeCloseTo(0, 6);
    expect(segments[1].fromKm).toBeCloseTo(segments[0].lengthKm, 6);
  });

  it('линейка считает трассу по дуге, а не по прямой между точками', () => {
    const source = getPz2RouteSource(bridge);
    const straight = 2 * 111.19;

    expect(createPz2Ruler(source).totalKm).toBeGreaterThan(straight);
  });

  it('без файла точек и сегментов нет, а не ноль штук с мусором', () => {
    const source = getPz2RouteSource(null);

    expect(getPz2RoutePointMarks(source, createPz2Ruler(source))).toEqual([]);
    expect(getPz2SegmentMarks(source)).toEqual([]);
  });
});

describe('правка длины руками', () => {
  it('снимает привязку к участку на карте: где легли новые километры — неизвестно', () => {
    const measured = createPz2Work('earthworks', '100', { fromKm: 0, toKm: 100 });

    expect(setPz2WorkLength(measured, '120').span).toBeUndefined();
    expect(setPz2WorkLength(measured, '120').lengthKm).toBe('120');
  });

  it('та же самая длина привязку не рвёт — студент ничего не менял', () => {
    const measured = createPz2Work('earthworks', '100', { fromKm: 0, toKm: 100 });

    expect(setPz2WorkLength(measured, '100').span).toEqual({ fromKm: 0, toKm: 100 });
  });

  it('строка без участка правится как обычно', () => {
    expect(setPz2WorkLength(createPz2Work('bridge', '5'), '7').lengthKm).toBe('7');
  });

  it('исправленная строка уходит из проверки наложений', () => {
    const first = createPz2Work('earthworks', '100', { fromKm: 0, toKm: 100 });
    const second = createPz2Work('bridge', '100', { fromKm: 50, toKm: 150 });

    expect(findPz2OverlappingWorks(draftWith([first, second]))).toHaveLength(2);
    expect(findPz2OverlappingWorks(draftWith([setPz2WorkLength(first, '80'), second]))).toEqual([]);
  });
});

describe('линейка сходится с длиной маршрута из ПЗ1', () => {
  // Сегмент с кривой: именно на дуге ломаная и аналитическая длина расходятся.
  const bridge = (sagittaKm: number) =>
    ({
      completed: {
        pz1: {
          totalLengthKm: 0,
          stations: [],
          routeLine: {
            vertices: [
              { id: 'v1', lat: 47.9, lon: 135.3 },
              { id: 'v2', lat: 46.2, lon: 133.5 },
              { id: 'v3', lat: 44.1, lon: 131.6 },
            ],
            segments: [
              { id: 's1', fromVertexId: 'v1', toVertexId: 'v2', sagittaKm },
              { id: 's2', fromVertexId: 'v2', toVertexId: 'v3', sagittaKm: 0 },
            ],
          },
        },
      },
    }) as unknown as BridgeSchema;

  it('на кривой трассе линейка даёт ровно ту же длину, что посчитал ПЗ1', () => {
    const source = getPz2RouteSource(bridge(60));
    const expected = getPz2SegmentMarks(source).reduce((sum, segment) => sum + segment.lengthKm, 0);

    // До согласования линейка мерила по ломаной и давала на ~0,25 % больше:
    // студент, отмеривший всю трассу, всё равно видел расхождение.
    expect(createPz2Ruler(source).totalKm).toBeCloseTo(expected, 6);
  });

  it('на прямой трассе поведение не изменилось', () => {
    const source = getPz2RouteSource(bridge(0));
    const expected = getPz2SegmentMarks(source).reduce((sum, segment) => sum + segment.lengthKm, 0);

    expect(createPz2Ruler(source).totalKm).toBeCloseTo(expected, 6);
  });

  it('отметки внутри кривой растут монотонно', () => {
    const ruler = createPz2Ruler(getPz2RouteSource(bridge(60)));

    for (let index = 1; index < ruler.cumulativeKm.length; index += 1) {
      expect(ruler.cumulativeKm[index]).toBeGreaterThanOrEqual(ruler.cumulativeKm[index - 1]);
    }
  });
});

describe('значки сооружений на карте', () => {
  const measured = (kind: Parameters<typeof createPz2Work>[0], fromKm: number, toKm: number) =>
    createPz2Work(kind, String(toKm - fromKm), { fromKm, toKm });

  it('значок ставится посередине участка', () => {
    const marks = getPz2WorkMarks(draftWith([measured('bridge', 100, 120)]));

    expect(marks).toHaveLength(1);
    expect(marks[0].distanceKm).toBeCloseTo(110, 6);
    expect(marks[0].label).toBe('мост');
  });

  it('значок есть у сооружений, а у земляного полотна и пути — нет', () => {
    const marks = getPz2WorkMarks(
      draftWith([
        measured('bridge', 0, 10),
        measured('tunnel', 20, 30),
        measured('viaduct', 32, 36),
        measured('earthworks', 40, 90),
        measured('ballastTrack', 90, 120),
      ]),
    );

    expect(marks.map((mark) => mark.kind)).toEqual(['bridge', 'tunnel', 'viaduct']);
    expect(marks.map((mark) => mark.label)).toEqual(['мост', 'тоннель', 'эстакада']);
  });

  it('у каждого значка есть контуры — иначе маркер будет пустым кружком', () => {
    for (const kind of getPz2IconKinds()) {
      const icon = getPz2WorkIcon(kind);

      expect(icon?.label).toBeTruthy();
      expect(icon?.paths.length).toBeGreaterThan(0);
    }
  });

  it('работа без участка на карте не показывается — где она, неизвестно', () => {
    expect(getPz2WorkMarks(draftWith([lengthObject('bridge', '12')]))).toEqual([]);
  });

  it('участок, намеренный в обратную сторону, даёт ту же середину', () => {
    expect(getPz2WorkMarks(draftWith([measured('tunnel', 120, 100)]))[0].distanceKm).toBeCloseTo(110, 6);
  });
});
