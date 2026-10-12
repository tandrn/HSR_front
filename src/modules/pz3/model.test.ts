import { describe, expect, it } from 'vitest';
import type { BridgeSchema } from '../../bridge/schema';
import { calculateCriticalPath } from '../../shared/lib/criticalPath';
import {
  PZ3_LENGTH_TOLERANCE_KM,
  createInitialPz3Draft,
  changePz3WorkKind,
  assignPz3WorkToStage,
  checkPz3CriticalPath,
  createPz3Bridge,
  createPz3Ruler,
  createPz3Stage,
  findPz3OverlappingWorks,
  getPz3RoutePointMarks,
  getPz3ExercisesProgress,
  getPz3SegmentMarks,
  getPz3StageWorks,
  getPz3WorkMarks,
  isPz3StagesComplete,
  isPz3ExercisesComplete,
  readPz3Position,
  removePz3Stage,
  setPz3WorkLength,
  setPz3WorkPosition,
  createPz3Work,
  getPz3LengthCheck,
  getPz3RouteSource,
  getPz3StationMarks,
  isPz3WorksComplete,
  parsePz3Number,
  pz3WorkKinds,
  validatePz3Work,
} from './model';
import { pz3NetworkExercises } from './networkExercises';
import { getPz3IconKinds, getPz3WorkIcon } from './workIcons';

function draftWith(objects: Parameters<typeof getPz3LengthCheck>[0]['works']) {
  return { ...createInitialPz3Draft(), works: objects };
}

function lengthObject(kind: Parameters<typeof createPz3Work>[0], lengthKm: string) {
  return { ...createPz3Work(kind), lengthKm };
}

describe('справочник работ', () => {
  it('содержит согласованный со встречи 02.09 состав', () => {
    // Порядок сверен с ТЗ ПЗ3 §4.1 — он же задаёт порядок в выпадающем списке.
    expect(pz3WorkKinds.map((kind) => kind.id)).toEqual([
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
    const byMeasure = Object.fromEntries(pz3WorkKinds.map((kind) => [kind.id, kind.measure]));

    expect(byMeasure.turnout).toBe('count');
    expect(byMeasure.bridge).toBe('length');
    expect(byMeasure.existingLineRepair).toBe('length');
  });
});

describe('getPz3RouteSource', () => {
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

    const source = getPz3RouteSource(bridge);

    expect(source.totalLengthKm).toBe(512.85);
    expect(source.routeLine?.vertices).toHaveLength(2);
    expect(createPz3Ruler(source).totalKm).toBeGreaterThan(0);
  });

  it('без загруженного файла трасса пустая, а не сломанная', () => {
    const source = getPz3RouteSource(null);

    expect(source.routeLine).toBeNull();
    expect(source.totalLengthKm).toBe(0);
    expect(createPz3Ruler(source).totalKm).toBe(0);
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
    const source = getPz3RouteSource(bridge);
    const marks = getPz3StationMarks(source, createPz3Ruler(source));

    expect(marks.map((mark) => mark.label)).toEqual(['А', 'Б', 'Г']);
    expect(marks[0].distanceKm).toBeCloseTo(0, 6);
    // Градус долготы на экваторе — примерно 111,19 км.
    expect(marks[1].distanceKm).toBeCloseTo(111.19, 1);
    expect(marks[2].distanceKm).toBeCloseTo(222.39, 1);
  });

  it('станция в стороне от линии всё равно получает километраж ближайшей точки', () => {
    const source = getPz3RouteSource(bridge);
    const marks = getPz3StationMarks(source, createPz3Ruler(source));

    // Промежуточная стоит в 0,2° севернее линии, но её километраж — по трассе.
    expect(marks[1].lat).toBeCloseTo(0.2, 6);
    expect(marks[1].distanceKm).toBeCloseTo(111.19, 1);
  });

  it('без станций в файле список пустой, а не сломанный', () => {
    const source = getPz3RouteSource(null);

    expect(getPz3StationMarks(source, createPz3Ruler(source))).toEqual([]);
  });
});

describe('проверка длины', () => {
  it('пустая таблица — отдельное состояние, а не расхождение', () => {
    expect(getPz3LengthCheck(createInitialPz3Draft(), 100).status).toBe('empty');
  });

  it('сумма сошлась с длиной маршрута в пределах допуска', () => {
    const check = getPz3LengthCheck(draftWith([lengthObject('earthworks', '60'), lengthObject('bridge', '40,2')]), 100);

    expect(check.measuredKm).toBeCloseTo(100.2, 6);
    expect(check.status).toBe('match');
  });

  it('недомерил и перемерил различаются знаком, а не только текстом', () => {
    expect(getPz3LengthCheck(draftWith([lengthObject('earthworks', '80')]), 100).status).toBe('short');
    expect(getPz3LengthCheck(draftWith([lengthObject('earthworks', '120')]), 100).status).toBe('over');
    expect(getPz3LengthCheck(draftWith([lengthObject('earthworks', '80')]), 100).differenceKm).toBeCloseTo(-20, 6);
  });

  it('на границе допуска ещё считается сошедшимся', () => {
    const check = getPz3LengthCheck(draftWith([lengthObject('earthworks', String(100 + PZ3_LENGTH_TOLERANCE_KM))]), 100);

    expect(check.status).toBe('match');
  });

  it('стрелки в длину трассы не идут — они меряются штуками', () => {
    const objects = [lengthObject('earthworks', '100'), { ...createPz3Work('turnout'), count: '4' }];

    expect(getPz3LengthCheck(draftWith(objects), 100).measuredKm).toBeCloseTo(100, 6);
  });
});

describe('наложение участков', () => {
  const span = (kind: Parameters<typeof createPz3Work>[0], fromKm: number, toKm: number) =>
    createPz3Work(kind, String(Math.abs(toKm - fromKm)), { fromKm, toKm });

  it('участки встык наложением не считаются', () => {
    const draft = draftWith([span('earthworks', 0, 50), span('bridge', 50, 80)]);

    expect(findPz3OverlappingWorks(draft)).toEqual([]);
  });

  it('перекрытие находится с обеих сторон, независимо от порядка строк', () => {
    const first = span('earthworks', 40, 90);
    const second = span('bridge', 0, 50);
    const overlapping = findPz3OverlappingWorks(draftWith([first, second]));

    expect(overlapping).toHaveLength(2);
    expect(overlapping).toContain(first.id);
    expect(overlapping).toContain(second.id);
  });

  it('участок, намеренный в обратную сторону, тоже сравнивается верно', () => {
    const draft = draftWith([span('earthworks', 90, 40), span('bridge', 0, 50)]);

    expect(findPz3OverlappingWorks(draft)).toHaveLength(2);
  });

  it('строки без участка молчат — у ручного ввода места на трассе нет', () => {
    const draft = draftWith([lengthObject('earthworks', '50'), lengthObject('bridge', '50')]);

    expect(findPz3OverlappingWorks(draft)).toEqual([]);
  });
});

describe('валидация работы', () => {
  it('длина обязательна и должна быть положительной', () => {
    expect(validatePz3Work(lengthObject('bridge', ''))).toBe('Укажите длину');
    expect(validatePz3Work(lengthObject('bridge', '0'))).toBe('Длина должна быть больше нуля');
    expect(validatePz3Work(lengthObject('bridge', '1,5'))).toBeNull();
  });

  it('у стрелки проверяется целое количество, а не длина', () => {
    const base = createPz3Work('turnout');

    expect(validatePz3Work({ ...base, count: '' })).toBe('Укажите количество');
    expect(validatePz3Work({ ...base, count: '1,5' })).toBe('Количество — целое число больше нуля');
    expect(validatePz3Work({ ...base, count: '2' })).toBeNull();
  });

  it('шаг завершён, когда есть работы и все они корректны', () => {
    expect(isPz3WorksComplete(createInitialPz3Draft())).toBe(false);
    expect(isPz3WorksComplete(draftWith([lengthObject('bridge', '2')]))).toBe(true);
    expect(isPz3WorksComplete(draftWith([lengthObject('bridge', '')]))).toBe(false);
  });
});

describe('смена типа работы', () => {
  it('переключение на штучный тип подставляет одну штуку, а не пустое поле', () => {
    const changed = changePz3WorkKind(lengthObject('bridge', '12,5'), 'turnout');

    expect(changed.count).toBe('1');
    expect(validatePz3Work(changed)).toBeNull();
  });

  it('намеренная длина переживает переключение туда и обратно', () => {
    const measured = lengthObject('bridge', '12,5');
    const back = changePz3WorkKind(changePz3WorkKind(measured, 'turnout'), 'tunnel');

    expect(back.lengthKm).toBe('12,5');
  });

  it('уже заполненное количество не перетирается', () => {
    const counted = { ...createPz3Work('turnout'), count: '7' };

    expect(changePz3WorkKind(counted, 'turnout').count).toBe('7');
  });
});

describe('parsePz3Number', () => {
  it('принимает запятую и разделители разрядов', () => {
    expect(parsePz3Number('1 234,5')).toBeCloseTo(1234.5, 6);
    expect(parsePz3Number('12,25')).toBeCloseTo(12.25, 6);
  });

  it('пустое и мусорное дают null, а не ноль', () => {
    expect(parsePz3Number('')).toBeNull();
    expect(parsePz3Number('   ')).toBeNull();
    expect(parsePz3Number('абв')).toBeNull();
  });
});

describe('этапы', () => {
  const draftWithStages = () => {
    const stage = createPz3Stage('Первый участок', 0);
    const work = createPz3Work('bridge', '12');

    return { ...createInitialPz3Draft(), stages: [stage], works: [work] };
  };

  it('работа по умолчанию лежит в пуле, а не в этапе', () => {
    expect(createPz3Work('bridge', '12').stageId).toBeNull();
    expect(getPz3StageWorks(draftWithStages(), null)).toHaveLength(1);
  });

  it('перенос в этап заменяет принадлежность, а не добавляет вторую', () => {
    const draft = draftWithStages();
    const second = createPz3Stage('Второй участок', 1);
    const withStages = { ...draft, stages: [...draft.stages, second] };

    const assigned = assignPz3WorkToStage(withStages, draft.works[0].id, draft.stages[0].id);
    const moved = assignPz3WorkToStage(assigned, draft.works[0].id, second.id);

    expect(getPz3StageWorks(moved, draft.stages[0].id)).toHaveLength(0);
    expect(getPz3StageWorks(moved, second.id)).toHaveLength(1);
  });

  it('работу можно вернуть обратно в пул', () => {
    const draft = draftWithStages();
    const assigned = assignPz3WorkToStage(draft, draft.works[0].id, draft.stages[0].id);

    expect(getPz3StageWorks(assignPz3WorkToStage(assigned, draft.works[0].id, null), null)).toHaveLength(1);
  });

  it('удаление этапа возвращает его работы в пул, а не стирает их', () => {
    const draft = draftWithStages();
    const assigned = assignPz3WorkToStage(draft, draft.works[0].id, draft.stages[0].id);
    const removed = removePz3Stage(assigned, draft.stages[0].id);

    expect(removed.stages).toHaveLength(0);
    expect(removed.works).toHaveLength(1);
    expect(removed.works[0].stageId).toBeNull();
  });

  it('после удаления порядок этапов идёт без дыр', () => {
    const draft = {
      ...createInitialPz3Draft(),
      stages: [createPz3Stage('А', 0), createPz3Stage('Б', 1), createPz3Stage('В', 2)],
    };

    const removed = removePz3Stage(draft, draft.stages[1].id);

    expect(removed.stages.map((stage) => stage.order)).toEqual([0, 1]);
  });

  it('шаг завершён, когда этапы есть и ни одна работа не осталась в пуле', () => {
    const draft = draftWithStages();

    expect(isPz3StagesComplete(draft)).toBe(false);
    expect(isPz3StagesComplete(assignPz3WorkToStage(draft, draft.works[0].id, draft.stages[0].id))).toBe(true);
  });
});

describe('мост ПЗ3', () => {
  it('сохранение не теряет данные ПЗ1 и поднимает версию схемы', () => {
    const imported = {
      schemaVersion: '1.1',
      passport: { team: 'Юнит-3', lineTitle: '', createdAt: '2026-09-03T00:00:00.000Z' },
      completed: { pz1: { totalLengthKm: 100, routeLine: null } },
    } as unknown as BridgeSchema;
    const draft = { ...createInitialPz3Draft(), works: [createPz3Work('bridge', '40')] };

    const bridge = createPz3Bridge(draft, imported, { phase: 'task', stepId: 'works', theorySeen: true });

    expect(bridge.schemaVersion).toBe('1.2');
    expect(bridge.passport.team).toBe('Юнит-3');
    expect(bridge.completed.pz1).toEqual(imported.completed.pz1);
    expect(bridge.completed.pz3?.works[0].lengthKm).toBe(40);
    expect(bridge.completed.pz3?.works[0].count).toBeNull();
    expect(bridge.completed.pz3?.routeLengthKm).toBe(100);
  });

  it('у штучной работы в мост уходит количество, а не длина', () => {
    const draft = { ...createInitialPz3Draft(), works: [{ ...createPz3Work('turnout'), count: '4', positionKm: 72.5 }] };
    const bridge = createPz3Bridge(draft, null);
    const result = bridge.completed.pz3;

    expect(result?.works[0].count).toBe(4);
    expect(result?.works[0].lengthKm).toBeNull();
    expect(result?.works[0].positionKm).toBe(72.5);
    expect(createInitialPz3Draft(bridge).works[0].positionKm).toBe(72.5);
  });

  it('новые опции сохраняются в JSON и восстанавливаются вместе с работой', () => {
    const work = { ...createPz3Work('ballastTrack', '2'), conditions: ['weakFoundation' as const, 'highEmbankment' as const] };
    const bridge = createPz3Bridge({ ...createInitialPz3Draft(), works: [work] }, null);

    expect(bridge.completed.pz3?.works[0].conditions).toEqual(work.conditions);
    expect(createInitialPz3Draft(bridge).works[0].conditions).toEqual(work.conditions);
    expect(changePz3WorkKind(work, 'bridge').conditions).toEqual([]);
  });

  it('сохраняет все поля упражнения и читает прежний файл с одним ответом-путём', () => {
    const draft = createInitialPz3Draft();
    const submission = {
      durationDays: '16', paths: 'A-C-E-G', reasoning: 'E заканчивается позже F',
      timings: {
        A: { earlyStart: '0', earlyFinish: '4', lateStart: '0', lateFinish: '4', float: '0' },
      },
    };
    draft.criticalPathAnswers.bridge = submission;
    const bridge = createPz3Bridge(draft, null);
    const saved = bridge.completed.pz3?.criticalPath.find((answer) => answer.exerciseId === 'bridge');

    expect(saved?.submission).toEqual(submission);
    expect(createInitialPz3Draft(bridge).criticalPathAnswers.bridge).toEqual(submission);

    const legacy = {
      ...bridge,
      completed: {
        ...bridge.completed,
        pz3: { ...bridge.completed.pz3, criticalPath: [{ exerciseId: 'bridge', answer: 'A-C-E-G', correct: true }] },
      },
    } as BridgeSchema;
    expect(createInitialPz3Draft(legacy).criticalPathAnswers.bridge.paths).toBe('A-C-E-G');
  });

  it('позиция читается по стабильному id, незнакомый шаг даёт интро', () => {
    const position = (stepId: string) =>
      readPz3Position({ position: { pz3: { phase: 'task', stepId, theorySeen: true } } } as unknown as BridgeSchema);

    expect(position('stages')?.stepIndex).toBe(1);
    expect(position('exercises')?.stepIndex).toBe(2);
    expect(position('чего-то-нет')).toBeNull();
    expect(readPz3Position(null)).toBeNull();
  });
});

describe('критический путь', () => {
  it('разделители не важны — важны номера и их порядок', () => {
    expect(checkPz3CriticalPath('1-3-5-7', ['1', '3', '5', '7'])).toBe(true);
    expect(checkPz3CriticalPath('1, 3, 5, 7', ['1', '3', '5', '7'])).toBe(true);
    expect(checkPz3CriticalPath(' 1 3 5 7 ', ['1', '3', '5', '7'])).toBe(true);
  });

  it('порядок значим: путь идёт от начала к концу', () => {
    expect(checkPz3CriticalPath('7-5-3-1', ['1', '3', '5', '7'])).toBe(false);
  });

  it('лишнее или недостающее событие делает ответ неверным', () => {
    expect(checkPz3CriticalPath('1-3-5', ['1', '3', '5', '7'])).toBe(false);
    expect(checkPz3CriticalPath('1-3-4-5-7', ['1', '3', '5', '7'])).toBe(false);
  });

  it('пустой ответ не считается верным даже при пустом эталоне', () => {
    expect(checkPz3CriticalPath('', [])).toBe(false);
    expect(checkPz3CriticalPath('   ', ['1'])).toBe(false);
  });
});

describe('обязательное выполнение упражнений', () => {
  function solveCriticalPathExercises() {
    return Object.fromEntries(pz3NetworkExercises.map((exercise) => {
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
    const draft = createInitialPz3Draft();

    expect(getPz3ExercisesProgress(draft)).toEqual({
      solvedCriticalPath: 0,
      totalCriticalPath: 9,
      levelingSolved: false,
      isComplete: false,
    });
    expect(isPz3ExercisesComplete(draft)).toBe(false);
  });

  it('требует все девять вариантов и решённое выравнивание', () => {
    const answers = solveCriticalPathExercises();
    const almostDone = {
      ...createInitialPz3Draft(),
      criticalPathAnswers: answers,
    };

    expect(getPz3ExercisesProgress(almostDone).solvedCriticalPath).toBe(9);
    expect(isPz3ExercisesComplete(almostDone)).toBe(false);
    expect(isPz3ExercisesComplete({ ...almostDone, levelingShifts: { w6: 6 } })).toBe(true);
  });

  it('одного нерешённого варианта достаточно, чтобы оставить переход закрытым', () => {
    const answers = solveCriticalPathExercises();
    delete answers.turnout;
    const draft = {
      ...createInitialPz3Draft(),
      criticalPathAnswers: answers,
      levelingShifts: { w6: 6 },
    };

    expect(getPz3ExercisesProgress(draft).solvedCriticalPath).toBe(8);
    expect(isPz3ExercisesComplete(draft)).toBe(false);
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
    const source = getPz3RouteSource(bridge);
    const marks = getPz3RoutePointMarks(source, createPz3Ruler(source));

    expect(marks.map((mark) => mark.number)).toEqual([1, 2, 3]);
    expect(marks[0].distanceKm).toBeCloseTo(0, 6);
    expect(marks[2].distanceKm).toBeGreaterThan(marks[1].distanceKm);
  });

  it('кривая длиннее своей хорды — дуга переносится, а не спрямляется', () => {
    const segments = getPz3SegmentMarks(getPz3RouteSource(bridge));

    expect(segments).toHaveLength(2);
    expect(segments[0].radiusM).toBeNull();
    expect(segments[1].radiusM).toBeGreaterThan(0);
    expect(segments[1].lengthKm).toBeGreaterThan(segments[0].lengthKm);
  });

  it('километры сегментов идут подряд, без разрывов', () => {
    const segments = getPz3SegmentMarks(getPz3RouteSource(bridge));

    expect(segments[0].fromKm).toBeCloseTo(0, 6);
    expect(segments[1].fromKm).toBeCloseTo(segments[0].lengthKm, 6);
  });

  it('линейка считает трассу по дуге, а не по прямой между точками', () => {
    const source = getPz3RouteSource(bridge);
    const straight = 2 * 111.19;

    expect(createPz3Ruler(source).totalKm).toBeGreaterThan(straight);
  });

  it('без файла точек и сегментов нет, а не ноль штук с мусором', () => {
    const source = getPz3RouteSource(null);

    expect(getPz3RoutePointMarks(source, createPz3Ruler(source))).toEqual([]);
    expect(getPz3SegmentMarks(source)).toEqual([]);
  });
});

describe('правка длины руками', () => {
  it('снимает привязку к участку на карте: где легли новые километры — неизвестно', () => {
    const measured = createPz3Work('earthworks', '100', { fromKm: 0, toKm: 100 });

    expect(setPz3WorkLength(measured, '120').span).toBeUndefined();
    expect(setPz3WorkLength(measured, '120').lengthKm).toBe('120');
  });

  it('та же самая длина привязку не рвёт — студент ничего не менял', () => {
    const measured = createPz3Work('earthworks', '100', { fromKm: 0, toKm: 100 });

    expect(setPz3WorkLength(measured, '100').span).toEqual({ fromKm: 0, toKm: 100 });
  });

  it('строка без участка правится как обычно', () => {
    expect(setPz3WorkLength(createPz3Work('bridge', '5'), '7').lengthKm).toBe('7');
  });

  it('исправленная строка уходит из проверки наложений', () => {
    const first = createPz3Work('earthworks', '100', { fromKm: 0, toKm: 100 });
    const second = createPz3Work('bridge', '100', { fromKm: 50, toKm: 150 });

    expect(findPz3OverlappingWorks(draftWith([first, second]))).toHaveLength(2);
    expect(findPz3OverlappingWorks(draftWith([setPz3WorkLength(first, '80'), second]))).toEqual([]);
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
    const source = getPz3RouteSource(bridge(60));
    const expected = getPz3SegmentMarks(source).reduce((sum, segment) => sum + segment.lengthKm, 0);

    // До согласования линейка мерила по ломаной и давала на ~0,25 % больше:
    // студент, отмеривший всю трассу, всё равно видел расхождение.
    expect(createPz3Ruler(source).totalKm).toBeCloseTo(expected, 6);
  });

  it('на прямой трассе поведение не изменилось', () => {
    const source = getPz3RouteSource(bridge(0));
    const expected = getPz3SegmentMarks(source).reduce((sum, segment) => sum + segment.lengthKm, 0);

    expect(createPz3Ruler(source).totalKm).toBeCloseTo(expected, 6);
  });

  it('отметки внутри кривой растут монотонно', () => {
    const ruler = createPz3Ruler(getPz3RouteSource(bridge(60)));

    for (let index = 1; index < ruler.cumulativeKm.length; index += 1) {
      expect(ruler.cumulativeKm[index]).toBeGreaterThanOrEqual(ruler.cumulativeKm[index - 1]);
    }
  });
});

describe('значки сооружений на карте', () => {
  const measured = (kind: Parameters<typeof createPz3Work>[0], fromKm: number, toKm: number) =>
    createPz3Work(kind, String(toKm - fromKm), { fromKm, toKm });

  it('значок ставится посередине участка', () => {
    const marks = getPz3WorkMarks(draftWith([measured('bridge', 100, 120)]));

    expect(marks).toHaveLength(1);
    expect(marks[0].distanceKm).toBeCloseTo(110, 6);
    expect(marks[0].label).toBe('мост');
  });

  it('значок есть у сооружений, а у земляного полотна и пути — нет', () => {
    const marks = getPz3WorkMarks(
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

  it('стрелочный перевод появляется при выборе типа и показывает количество под значком', () => {
    const work = changePz3WorkKind(createPz3Work(), 'turnout', 200);
    const marks = getPz3WorkMarks(draftWith([{ ...work, count: '7' }]), 200);

    expect(work.positionKm).toBe(100);
    expect(marks).toMatchObject([{ kind: 'turnout', count: 7, distanceKm: 100 }]);
    expect(marks[0].title).toContain('7 шт.');
  });

  it('перетаскивание сохраняет километр и не выпускает перевод за конец трассы', () => {
    const work = changePz3WorkKind(createPz3Work(), 'turnout', 200);
    const moved = setPz3WorkPosition(work, 72.5, 200);

    expect(moved.positionKm).toBe(72.5);
    expect(getPz3WorkMarks(draftWith([moved]), 200)[0].distanceKm).toBe(72.5);
    expect(setPz3WorkPosition(work, 300, 200).positionKm).toBe(200);
  });

  it('ручные тоннель и эстакада тоже получают перемещаемые значки', () => {
    const tunnel = changePz3WorkKind(createPz3Work(), 'tunnel', 200);
    const viaduct = changePz3WorkKind(createPz3Work(), 'viaduct', 200);
    const marks = getPz3WorkMarks(draftWith([tunnel, viaduct]), 200);

    expect(marks.map((mark) => [mark.kind, mark.draggable])).toEqual([
      ['tunnel', true],
      ['viaduct', true],
    ]);
    expect(setPz3WorkPosition(viaduct, 75, 200).positionKm).toBe(75);
  });

  it('у каждого значка есть контуры — иначе маркер будет пустым кружком', () => {
    for (const kind of getPz3IconKinds()) {
      const icon = getPz3WorkIcon(kind);

      expect(icon?.label).toBeTruthy();
      expect(icon?.paths.length).toBeGreaterThan(0);
      expect(icon?.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
    expect(new Set(getPz3IconKinds().map((kind) => getPz3WorkIcon(kind)?.color)).size).toBe(4);
  });

  it('у ручного сооружения значок есть, но его можно переставить в точное место', () => {
    expect(getPz3WorkMarks(draftWith([lengthObject('bridge', '12')]), 100)).toMatchObject([
      { kind: 'bridge', distanceKm: 20, draggable: true },
    ]);
  });

  it('участок, намеренный в обратную сторону, даёт ту же середину', () => {
    expect(getPz3WorkMarks(draftWith([measured('tunnel', 120, 100)]))[0].distanceKm).toBeCloseTo(110, 6);
  });
});
