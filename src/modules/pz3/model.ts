import { createBridge } from '../../bridge/io';
import type {
  BridgeSchema,
  ModulePosition,
  Pz3CriticalPathAnswer,
  Pz3PlanResult,
  Pz3ReportResult,
  Pz3Result,
  Pz3Stage,
  Pz3Work,
} from '../../bridge/schema';
import { buildRoutePointsBySegment, computeRouteLineMetrics } from '../../shared/lib/routeGeometry';
import { calculateCriticalPath, checkCriticalPathSubmission, createEmptyCriticalPathSubmission } from '../../shared/lib/criticalPath';
import type { CriticalPathSubmission, CriticalPathTimingInput } from '../../shared/lib/criticalPath';
import { createRouteRulerFromSegments, projectOntoRoute } from '../../shared/lib/routeRuler';
import type { RouteRuler } from '../../shared/lib/routeRuler';
import { pz3NetworkExercises } from './networkExercises';
import { getPz3Option } from './options';
import { getPz3Leveling } from './leveling';
import { getPz3WorkIcon } from './workIcons';
import { getPz3Plan, getPz3Report } from './plan';
import type {
  Pz3Draft,
  Pz3RouteSpan,
  Pz3StationMark,
  Pz3SoilCondition,
  Pz3RoutePointMark,
  Pz3RouteSource,
  Pz3SegmentMark,
  Pz3StageDraft,
  Pz3WorkDraft,
  Pz3WorkKind,
  Pz3WorkMark,
  Pz3WorkMeasure,
} from './types';

interface Pz3WorkKindInfo {
  id: Pz3WorkKind;
  label: string;
  measure: Pz3WorkMeasure;
  /** Короткое пояснение со слов заказчика — студенту, чтобы не гадать по названию. */
  hint: string;
}

/**
 * Справочник объектов трассы (встреча 02.09).
 *
 * Порядок — как в ТЗ §4.1, чтобы список в коде и в документе читался одинаково.
 * Мост и тоннель заказчик намеренно отделил от остальных «длинных» объектов:
 * «они потом будут чуть иначе считаться». Пока разницы в расчёте нет, но
 * порядок в списке сохраняем — по нему потом будет проще расходиться.
 */
export const pz3WorkKinds: Pz3WorkKindInfo[] = [
  {
    id: 'existingLineRepair',
    label: 'Ремонт существующей линии',
    measure: 'length',
    hint: 'Первые километры ВСМ идут по существующим путям: их ремонтируют, меняют подстанции.',
  },
  {
    id: 'ballastTrack',
    label: 'Балластный путь',
    measure: 'length',
    hint: 'Щебень под шпальной решёткой. Укладывается быстро, но требует постоянного обслуживания.',
  },
  {
    id: 'earthworks',
    label: 'Линия на земляном полотне',
    measure: 'length',
    hint: 'Высокая насыпь под пути: держит профиль ровным и повышает устойчивость.',
  },
  {
    id: 'viaduct',
    label: 'Эстакада',
    measure: 'length',
    hint: 'Путь на опорах — там, где насыпь невозможна или невыгодна.',
  },
  { id: 'bridge', label: 'Мост', measure: 'length', hint: 'Переход через водную преграду.' },
  { id: 'tunnel', label: 'Тоннель', measure: 'length', hint: 'Переход сквозь возвышенность.' },
  {
    id: 'turnout',
    label: 'Стрелочный перевод 1/25',
    measure: 'count',
    hint: 'Путевое развитие на подходе к станции. Марка 1/25 — очень пологая, восемь приводов, считается отдельно.',
  },
];


export const pz3SoilConditions: { id: Pz3SoilCondition; label: string; hint: string }[] = [
  {
    id: 'weakSoil',
    label: 'Слабые грунты',
    hint: 'Нужны сваи до твёрдого слоя и ростверк — работ становится больше.',
  },
  { id: 'rocky', label: 'Скальные породы', hint: 'Разработка скального грунта: буровзрывные работы.' },
];

/**
 * Допуск проверки длины.
 *
 * ВРЕМЕННОЕ ЗНАЧЕНИЕ: заказчик допуск не назвал (ТЗ ПЗ3 в-5). Полкилометра
 * взято как «точнее линейкой всё равно не намеряешь». На поведение это влияет
 * только на подпись «сошлось»: переход дальше не блокируется ни при каком
 * расхождении, как и требует ТЗ до ответа на в-5.
 */
export const PZ3_LENGTH_TOLERANCE_KM = 0.5;
/** Насколько участки могут перекрыться, чтобы это ещё считалось стыком, а не наложением. */
export const PZ3_SPAN_TOUCH_TOLERANCE_KM = 0.05;

export function getPz3WorkKind(kind: Pz3WorkKind) {
  return pz3WorkKinds.find((item) => item.id === kind) ?? pz3WorkKinds[0];
}

/**
 * Черновик ПЗ3, при загрузке файла — с уже введёнными значениями.
 *
 * Заказчик просил дословно: файл должен открывать тот же экран «с уже
 * введёнными значениями». В мост числа уходят числами, а поля ввода в проекте
 * работают со строками, поэтому здесь обратный перевод.
 */
export function createInitialPz3Draft(importedBridge?: BridgeSchema | null): Pz3Draft {
  const saved = importedBridge?.completed?.pz3;

  if (!saved) {
    return { works: [], stages: [], criticalPathAnswers: {}, totalWorkers: '', workersByStage: {}, rulerMarksKm: [] };
  }

  return {
    works: saved.works.map((work) => ({
      id: work.id,
      kind: work.kind,
      lengthKm: work.lengthKm === null ? '' : formatPz3InputNumber(work.lengthKm),
      count: work.count === null ? '' : formatPz3InputNumber(work.count),
      conditions: work.conditions,
      stageId: work.stageId,
      ...(work.span ? { span: work.span } : {}),
      ...(Number.isFinite(work.positionKm) ? { positionKm: work.positionKm } : {}),
    })),
    stages: saved.stages.map((stage) => ({ id: stage.id, title: stage.title, order: stage.order })),
    criticalPathAnswers: Object.fromEntries(saved.criticalPath.map((answer) => [answer.exerciseId, restoreCriticalPathAnswer(answer)])),
    ...(saved.levelingShifts ? { levelingShifts: saved.levelingShifts } : {}),
    totalWorkers: saved.plan.totalWorkers > 0 ? formatPz3InputNumber(saved.plan.totalWorkers) : '',
    workersByStage: Object.fromEntries(
      Object.entries(saved.plan.workersByStage).map(([stageId, workers]) => [stageId, formatPz3InputNumber(workers)]),
    ),
    // Отметки линейки не сохраняются: это незаконченное измерение, а не
    // результат. Готовые участки лежат у работ.
    rulerMarksKm: [],
    // Снимок возвращается из файла: иначе отчёт, собранный сразу после
    // загрузки, выходил бы без карты, хотя карта у студента уже была.
    ...(saved.previewImage ? { previewImage: saved.previewImage } : {}),
  };
}

/** Старые файлы хранят только строку пути; новый ответ восстанавливается целиком. */
function restoreCriticalPathAnswer(answer: Pz3CriticalPathAnswer): CriticalPathSubmission {
  const saved = answer.submission;
  if (!saved || typeof saved !== 'object') {
    return { ...createEmptyCriticalPathSubmission(), paths: answer.answer };
  }

  const timings: Record<string, CriticalPathTimingInput> = {};
  if (saved.timings && typeof saved.timings === 'object') {
    for (const [id, row] of Object.entries(saved.timings)) {
      if (row && typeof row === 'object') {
        timings[id] = {
          earlyStart: typeof row.earlyStart === 'string' ? row.earlyStart : '',
          earlyFinish: typeof row.earlyFinish === 'string' ? row.earlyFinish : '',
          lateStart: typeof row.lateStart === 'string' ? row.lateStart : '',
          lateFinish: typeof row.lateFinish === 'string' ? row.lateFinish : '',
          float: typeof row.float === 'string' ? row.float : '',
        };
      }
    }
  }
  return {
    durationDays: typeof saved.durationDays === 'string' ? saved.durationDays : '',
    paths: typeof saved.paths === 'string' ? saved.paths : answer.answer,
    timings,
    reasoning: typeof saved.reasoning === 'string' ? saved.reasoning : '',
  };
}

/** Число из моста обратно в поле ввода: запятая как разделитель, без хвоста нулей. */
function formatPz3InputNumber(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

export function createPz3Work(
  kind: Pz3WorkKind = 'existingLineRepair',
  lengthKm = '',
  span?: Pz3RouteSpan,
): Pz3WorkDraft {
  return {
    id: `work-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    lengthKm,
    count: getPz3WorkKind(kind).measure === 'count' ? '1' : '',
    conditions: [],
    stageId: null,
    span,
  };
}

/**
 * Правка длины руками.
 *
 * Участок на карте привязан к строке и подсвечивается при наведении. Если
 * студент поправил длину сам, участок ей больше не соответствует: где именно
 * пролегли исправленные километры, мы не знаем. Поэтому привязка к карте
 * снимается — лучше не показать участок, чем показать неверный.
 */
export function setPz3WorkLength(work: Pz3WorkDraft, lengthKm: string): Pz3WorkDraft {
  if (work.span && lengthKm !== work.lengthKm) {
    const { span, ...rest } = work;
    void span;

    return { ...rest, lengthKm };
  }

  return { ...work, lengthKm };
}

/** Условие включают и выключают галочкой, поэтому переключатель, а не замена. */
export function togglePz3SoilCondition(work: Pz3WorkDraft, condition: Pz3SoilCondition): Pz3WorkDraft {
  const conditions = work.conditions.includes(condition)
    ? work.conditions.filter((item) => item !== condition)
    : [...work.conditions, condition];

  return { ...work, conditions };
}

export function renamePz3Stage(draft: Pz3Draft, stageId: string, title: string): Pz3Draft {
  return {
    ...draft,
    stages: draft.stages.map((stage) => (stage.id === stageId ? { ...stage, title } : stage)),
  };
}

export function createPz3Stage(title: string, order: number): Pz3StageDraft {
  return { id: `stage-${Math.random().toString(36).slice(2, 10)}`, title: title.trim(), order };
}

/**
 * Строки, участки которых налезают друг на друга.
 *
 * Сумма длин может сойтись с маршрутом и при этом быть набрана дважды по одному
 * куску трассы: тогда часть линии осталась без работ, а проверка длины об этом
 * молчит. Считаем только намеренные линейкой участки — у ручных строк места на
 * трассе нет, и сказать о них нечего.
 */
export function findPz3OverlappingWorks(draft: Pz3Draft): string[] {
  const measured = draft.works
    .filter((object) => object.span && getPz3WorkKind(object.kind).measure === 'length')
    .map((object) => ({
      id: object.id,
      fromKm: Math.min(object.span!.fromKm, object.span!.toKm),
      toKm: Math.max(object.span!.fromKm, object.span!.toKm),
    }))
    .sort((left, right) => left.fromKm - right.fromKm);

  const overlapping = new Set<string>();

  for (let index = 1; index < measured.length; index += 1) {
    const previous = measured[index - 1];
    const current = measured[index];

    // Стык встык — не наложение: конец одного участка совпадает с началом другого.
    if (current.fromKm < previous.toKm - PZ3_SPAN_TOUCH_TOLERANCE_KM) {
      overlapping.add(previous.id);
      overlapping.add(current.id);
    }
  }

  return [...overlapping];
}

/**
 * Смена типа объекта.
 *
 * У штучных объектов количество по умолчанию — одна штука: строка, только что
 * переключённая на стрелочный перевод, иначе оставалась бы с пустым полем и
 * ошибкой «укажите количество», хотя студент ничего не стирал. Намеренную
 * длину при этом не трогаем: вернёт тип обратно — вернётся и длина.
 */
export function changePz3WorkKind(
  object: Pz3WorkDraft,
  kind: Pz3WorkKind,
  routeKm = 0,
  initialPositionKm = routeKm / 2,
): Pz3WorkDraft {
  const needsCount = getPz3WorkKind(kind).measure === 'count';

  return {
    ...object,
    kind,
    conditions: object.conditions.filter((condition) => getPz3Option(condition, kind) !== undefined),
    count: needsCount && !object.count.trim() ? '1' : object.count,
    ...(getPz3WorkIcon(kind) && (kind === 'turnout' || !object.span) && !Number.isFinite(object.positionKm)
      ? { positionKm: Math.max(0, Math.min(routeKm, initialPositionKm)) }
      : {}),
  };
}

/** Первые значки разводим по трассе, чтобы новые объекты не закрывали друг друга. */
export function getPz3DefaultWorkPosition(index: number, routeKm: number): number {
  return routeKm * ((index % 4) + 1) / 5;
}

/** Перетаскивание переводит координату маркера в километраж и удерживает его на трассе. */
export function setPz3WorkPosition(work: Pz3WorkDraft, distanceKm: number, routeKm: number): Pz3WorkDraft {
  if (!getPz3WorkIcon(work.kind) || (work.kind !== 'turnout' && work.span) || !Number.isFinite(distanceKm)) {
    return work;
  }

  return { ...work, positionKm: Math.max(0, Math.min(routeKm, distanceKm)) };
}

/**
 * Трасса из ПЗ1. Без загруженного файла ПЗ3 мерить нечего — это не ошибка,
 * а нормальное состояние до того, как студент принесёт свой JSON-мост.
 */
export function getPz3RouteSource(bridge: BridgeSchema | null | undefined): Pz3RouteSource {
  const pz1 = bridge?.completed?.pz1;

  return {
    routeLine: pz1?.routeLine ?? null,
    stations: (pz1?.stations ?? []).filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lng)),
    totalLengthKm: pz1?.totalLengthKm ?? 0,
    variantTitle: pz1?.variantId ? `Вариант ${pz1.variantId}` : '',
  };
}

/**
 * Станции ПЗ1 с километражом от начала трассы.
 *
 * Студент меряет участки между станциями, поэтому одной точки на карте мало:
 * нужно видеть, на каком километре стоит станция. Километраж считается той же
 * линейкой, что и участки, — иначе цифры на карте и в таблице разошлись бы.
 * Порядок — по трассе, а не по алфавиту меток.
 */
export function getPz3StationMarks(source: Pz3RouteSource, ruler: RouteRuler): Pz3StationMark[] {
  return source.stations
    .flatMap((station) => {
      const position = projectOntoRoute(ruler, { lat: station.lat, lon: station.lng });

      if (!position) {
        return [];
      }

      return [
        {
          label: station.label,
          name: station.name,
          lat: station.lat,
          lon: station.lng,
          distanceKm: position.distanceKm,
        },
      ];
    })
    .sort((left, right) => left.distanceKm - right.distanceKm);
}

/**
 * Линейка по трассе из ПЗ1.
 *
 * Длину каждого сегмента берём у ПЗ1, а не пересчитываем по ломаной: иначе
 * сумма намеренного не сойдётся с эталоном, с которым её же и сверяют.
 */
export function createPz3Ruler(source: Pz3RouteSource): RouteRuler {
  if (!source.routeLine) {
    return createRouteRulerFromSegments([]);
  }

  const metrics = computeRouteLineMetrics(source.routeLine);
  const pointsBySegment = buildRoutePointsBySegment(source.routeLine);

  return createRouteRulerFromSegments(
    source.routeLine.segments.map((segment, index) => ({
      points: pointsBySegment[index] ?? [],
      lengthKm: metrics.segments.find((item) => item.segmentId === segment.id)?.arcLengthKm ?? 0,
    })),
  );
}

export interface Pz3LengthCheck {
  measuredKm: number;
  routeKm: number;
  differenceKm: number;
  status: 'empty' | 'short' | 'match' | 'over';
}

/**
 * Сверка намеренного с длиной маршрута.
 *
 * Заказчик: студент прикладывает линейку, неточности неизбежны, «чтобы потом он
 * ручками просто добил, чтобы длина была одинаковой». Поэтому проверка мягкая:
 * показывает расхождение и его знак, а не блокирует переход.
 *
 * Считаются только объекты с длиной: стрелки меряются штуками и в длину трассы
 * не укладываются.
 */
export function getPz3LengthCheck(draft: Pz3Draft, routeKm: number): Pz3LengthCheck {
  const measuredKm = draft.works.reduce((sum, object) => {
    if (getPz3WorkKind(object.kind).measure !== 'length') {
      return sum;
    }

    return sum + (parsePz3Number(object.lengthKm) ?? 0);
  }, 0);

  const differenceKm = measuredKm - routeKm;

  if (draft.works.length === 0) {
    return { measuredKm, routeKm, differenceKm, status: 'empty' };
  }

  if (Math.abs(differenceKm) <= PZ3_LENGTH_TOLERANCE_KM) {
    return { measuredKm, routeKm, differenceKm, status: 'match' };
  }

  return { measuredKm, routeKm, differenceKm, status: differenceKm < 0 ? 'short' : 'over' };
}

export function validatePz3Work(object: Pz3WorkDraft): string | null {
  const measure = getPz3WorkKind(object.kind).measure;

  if (measure === 'count') {
    const count = parsePz3Number(object.count);

    if (count === null) {
      return 'Укажите количество';
    }

    return count > 0 && Number.isInteger(count) ? null : 'Количество — целое число больше нуля';
  }

  const lengthKm = parsePz3Number(object.lengthKm);

  if (lengthKm === null) {
    return 'Укажите длину';
  }

  return lengthKm > 0 ? null : 'Длина должна быть больше нуля';
}

export function isPz3WorksComplete(draft: Pz3Draft) {
  return draft.works.length > 0 && draft.works.every((object) => validatePz3Work(object) === null);
}

/** Числовой ввод в стиле проекта: запятая как разделитель, пробелы разрядов игнорируются. */
export function parsePz3Number(value: string): number | null {
  const normalized = value.replace(/[\s ]/g, '').replace(',', '.');

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Километры с двумя знаками — всегда, даже когда второй знак нулевой.
 * Иначе в одной панели рядом стоят «1 022,53» и «711,5», и числа выглядят
 * посчитанными с разной точностью, хотя точность одна.
 */
export function formatPz3Km(value: number) {
  const format = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return `${format.format(value)} км`;
}

/**
 * Шаг «Этапы» пройден, когда этапы созданы и каждая работа куда-то отнесена.
 *
 * Пустой пул — и есть смысл разбиения: трасса делится на участки целиком, а не
 * частично. Заказчик числа этапов не ограничивал (в-9), поэтому проверяется
 * только то, что они есть и что работы разложены.
 */
export function isPz3StagesComplete(draft: Pz3Draft) {
  return draft.stages.length > 0 && draft.works.length > 0 && draft.works.every((work) => work.stageId !== null);
}

/**
 * Точки линии трассы из ПЗ1 — те же, что студент ставил в первом задании.
 *
 * Номер сохраняется по порядку вершин: на карте ПЗ3 точка подписана тем же
 * числом, что и в ПЗ1, иначе два задания показывали бы одну трассу по-разному.
 */
export function getPz3RoutePointMarks(source: Pz3RouteSource, ruler: RouteRuler): Pz3RoutePointMark[] {
  const vertices = source.routeLine?.vertices ?? [];

  return vertices.flatMap((vertex, index) => {
    const position = projectOntoRoute(ruler, { lat: vertex.lat, lon: vertex.lon });

    if (!position) {
      return [];
    }

    return [
      {
        id: vertex.id,
        number: index + 1,
        lat: vertex.lat,
        lon: vertex.lon,
        distanceKm: position.distanceKm,
      },
    ];
  });
}

/**
 * Сегменты трассы из ПЗ1: прямые вставки и кривые с их радиусами.
 *
 * Длины и радиусы считает та же функция, что и в ПЗ1, — числа в двух заданиях
 * обязаны совпадать. Километр начала нужен, чтобы студент понимал, какой
 * кусок трассы он сейчас меряет.
 */
export function getPz3SegmentMarks(source: Pz3RouteSource): Pz3SegmentMark[] {
  if (!source.routeLine) {
    return [];
  }

  const metrics = computeRouteLineMetrics(source.routeLine);
  let fromKm = 0;

  return source.routeLine.segments.map((segment, index) => {
    const measured = metrics.segments.find((item) => item.segmentId === segment.id);
    const lengthKm = measured?.arcLengthKm ?? 0;
    const mark: Pz3SegmentMark = {
      id: segment.id,
      number: index + 1,
      lengthKm,
      radiusM: measured?.radiusKm != null ? Math.round(measured.radiusKm * 1000) : null,
      fromKm,
    };

    fromKm += lengthKm;

    return mark;
  });
}

/**
 * Значки сооружений на трассе: мост, тоннель, эстакада.
 *
 * Заказчик просил значки для моста и тоннеля («может не делать, если будет
 * время» — ТЗ §3, этап B). Эстакада добавлена нами: это такое же искусственное
 * сооружение с участком трассы, и без значка она одна из трёх выпадала из
 * карты. Если заказчик решит иначе — убирается строкой из словаря значков.
 *
 * У измеренных сооружений значок ставится посередине участка. У ручной строки
 * он появляется на трассе и остаётся подвижным, пока студент не задаст место.
 */
export function getPz3WorkMarks(draft: Pz3Draft, routeKm = 0): Pz3WorkMark[] {
  return draft.works.flatMap<Pz3WorkMark>((work, index) => {
    const icon = getPz3WorkIcon(work.kind);

    if (!icon) {
      return [];
    }

    if (work.kind === 'turnout') {
      const count = parsePz3Number(work.count) ?? 0;
      const distanceKm = Number.isFinite(work.positionKm) ? work.positionKm! : getPz3DefaultWorkPosition(index, routeKm);

      return [{
        id: work.id,
        kind: work.kind,
        label: icon.label,
        title: `Стрелочный перевод 1/25: ${count} шт. — ${formatPz3Km(distanceKm)} от начала трассы`,
        distanceKm,
        count,
        draggable: true,
      }];
    }

    if (!work.span) {
      const distanceKm = Number.isFinite(work.positionKm) ? work.positionKm! : getPz3DefaultWorkPosition(index, routeKm);
      const lengthKm = parsePz3Number(work.lengthKm);

      return [{
        id: work.id,
        kind: work.kind,
        label: icon.label,
        title: `${getPz3WorkKind(work.kind).label}${lengthKm !== null ? `: ${formatPz3Km(lengthKm)}` : ''} — ${formatPz3Km(distanceKm)} от начала трассы`,
        distanceKm,
        draggable: true,
      }];
    }

    const from = Math.min(work.span.fromKm, work.span.toKm);
    const to = Math.max(work.span.fromKm, work.span.toKm);

    return [
      {
        id: work.id,
        kind: work.kind,
        label: icon.label,
        title: `${getPz3WorkKind(work.kind).label}: ${formatPz3Km(to - from)}`,
        // Значок ставится посередине участка: у концов он налезал бы на отметки
        // соседних работ и на станции.
        distanceKm: (from + to) / 2,
      },
    ];
  });
}


/**
 * Цвета этапов на карте.
 *
 * Взяты из токенов дизайн-системы, чтобы карта не жила своей палитрой: синий,
 * бирюзовый и красный — основные цвета проекта, остальные подобраны к ним по
 * насыщенности. Когда этапов больше, цвета идут по кругу: семь-девять этапов,
 * о которых говорил заказчик, помещаются без повторов.
 */
export const pz3StageColors = ['#003d84', '#08a696', '#e0182d', '#8a5cf5', '#e07b18', '#0f6e56', '#c0392b'];

export function getPz3StageColor(order: number) {
  return pz3StageColors[order % pz3StageColors.length];
}

/**
 * Куски трассы, занятые работами этапа.
 *
 * Рисуются только намеренные линейкой работы: у введённых руками места на
 * трассе нет, и показать их на карте нечем — вместо догадки экран честно
 * говорит, сколько работ осталось без участка.
 */
export function getPz3StageSpans(draft: Pz3Draft) {
  return draft.stages.map((stage) => {
    const works = getPz3StageWorks(draft, stage.id);

    return {
      id: stage.id,
      title: stage.title,
      color: getPz3StageColor(stage.order),
      spans: works.flatMap((work) => (work.span ? [work.span] : [])),
      worksWithoutSpan: works.filter((work) => !work.span).length,
    };
  });
}

/** Склонение слова «работа» при числе — нужно и на экране этапов, и в графике. */
export function pluralWorks(count: number) {
  const tail = count % 100;

  if (tail >= 11 && tail <= 14) {
    return 'работ';
  }

  if (count % 10 === 1) {
    return 'работа';
  }

  return count % 10 >= 2 && count % 10 <= 4 ? 'работы' : 'работ';
}

/** Работы этапа в порядке их появления. Пул — этап с id null. */
export function getPz3StageWorks(draft: Pz3Draft, stageId: string | null) {
  return draft.works.filter((work) => work.stageId === stageId);
}

/**
 * Перенос работы в этап. Работа принадлежит ровно одному этапу, поэтому это
 * замена принадлежности, а не добавление в список — двух этапов у неё быть не
 * может (DoD экрана 2).
 */
export function assignPz3WorkToStage(draft: Pz3Draft, workId: string, stageId: string | null): Pz3Draft {
  return {
    ...draft,
    works: draft.works.map((work) => (work.id === workId ? { ...work, stageId } : work)),
  };
}

/**
 * Удаление этапа: его работы возвращаются в пул, а не исчезают вместе с ним.
 * Порядок оставшихся этапов пересчитывается, чтобы не осталось дыр.
 */
export function removePz3Stage(draft: Pz3Draft, stageId: string): Pz3Draft {
  // Люди, назначенные удалённому этапу, освобождаются вместе с ним: иначе они
  // остались бы «распределены» в никуда и не сошлись бы с общим числом.
  const { [stageId]: removedWorkers, ...workersByStage } = draft.workersByStage;
  void removedWorkers;

  return {
    ...draft,
    workersByStage,
    stages: draft.stages
      .filter((stage) => stage.id !== stageId)
      .map((stage, index) => ({ ...stage, order: index })),
    works: draft.works.map((work) => (work.stageId === stageId ? { ...work, stageId: null } : work)),
  };
}

/**
 * Сверка ответа про критический путь с эталоном.
 *
 * Путь — это последовательность событий, а как студент их разделит, дело
 * десятое: «1-3-5», «1, 3, 5» и «1 3 5» — один и тот же ответ. Сравниваются
 * только сами номера и их порядок, порядок значим: путь идёт от начала к концу.
 */
export function checkPz3CriticalPath(answer: string, reference: string[]): boolean {
  const parsed = splitPathNodes(answer);

  return parsed.length > 0 && parsed.join('-') === reference.map((node) => node.trim()).join('-');
}

export function splitPathNodes(answer: string): string[] {
  return answer
    .split(/[^0-9A-Za-zА-Яа-яЁё]+/)
    .map((node) => node.trim())
    .filter(Boolean);
}

/**
 * Шаг «Ресурсный график» пройден, когда людей хватило на все этапы.
 *
 * Ровность загрузки не проверяется: это предмет упражнения, а не условие
 * перехода — критерий качества заказчик словами задал, числом нет.
 */
export function isPz3PlanComplete(draft: Pz3Draft) {
  const total = parsePz3Number(draft.totalWorkers) ?? 0;

  if (total <= 0 || draft.stages.length === 0) {
    return false;
  }

  return draft.stages.every((stage) => (parsePz3Number(draft.workersByStage[stage.id] ?? '') ?? 0) > 0);
}

export interface Pz3ExercisesProgress {
  solvedCriticalPath: number;
  totalCriticalPath: number;
  levelingSolved: boolean;
  isComplete: boolean;
}

/**
 * Экран упражнений нельзя пропустить: студент решает все варианты по
 * критическому пути и снимает перегрузку в задаче на выравнивание.
 * Дополнительные поздние сроки и письменное объяснение остаются добровольными.
 */
export function getPz3ExercisesProgress(draft: Pz3Draft): Pz3ExercisesProgress {
  const solvedCriticalPath = pz3NetworkExercises.filter((exercise) => {
    const submission = draft.criticalPathAnswers[exercise.id];

    return Boolean(
      submission
      && checkCriticalPathSubmission(submission, calculateCriticalPath(exercise.works)).coreCorrect,
    );
  }).length;
  const levelingSolved = getPz3Leveling(draft.levelingShifts ?? {}).isSolved;
  const totalCriticalPath = pz3NetworkExercises.length;

  return {
    solvedCriticalPath,
    totalCriticalPath,
    levelingSolved,
    isComplete: solvedCriticalPath === totalCriticalPath && levelingSolved,
  };
}

export function isPz3ExercisesComplete(draft: Pz3Draft) {
  return getPz3ExercisesProgress(draft).isComplete;
}

/** Шаги задания стабильными идентификаторами: позиция в файле не зависит от порядка. */
export const pz3StepIds = ['works', 'stages', 'exercises', 'plan'] as const;

export type Pz3StepId = (typeof pz3StepIds)[number];

/**
 * Итог ПЗ3 для моста.
 *
 * Строки ввода превращаются в числа здесь и только здесь: дальше по цепочке
 * заданий пойдут посчитанные величины, а не то, что студент набрал в поле.
 */
export function createPz3Result(draft: Pz3Draft, routeLengthKm: number): Pz3Result {
  return {
    works: draft.works.map((work): Pz3Work => {
      const measure = getPz3WorkKind(work.kind).measure;

      return {
        id: work.id,
        kind: work.kind,
        lengthKm: measure === 'length' ? parsePz3Number(work.lengthKm) : null,
        count: measure === 'count' ? parsePz3Number(work.count) : null,
        stageId: work.stageId,
        conditions: work.conditions,
        ...(work.span ? { span: work.span } : {}),
        ...(Number.isFinite(work.positionKm) ? { positionKm: work.positionKm } : {}),
      };
    }),
    stages: draft.stages.map((stage): Pz3Stage => ({ id: stage.id, title: stage.title, order: stage.order })),
    criticalPath: pz3NetworkExercises.map((exercise) => {
      const submission = draft.criticalPathAnswers[exercise.id] ?? createEmptyCriticalPathSubmission();
      return {
        exerciseId: exercise.id,
        answer: submission.paths,
        correct: checkCriticalPathSubmission(submission, calculateCriticalPath(exercise.works)).coreCorrect,
        submission,
      };
    }),
    plan: createPz3PlanResult(draft),
    report: createPz3ReportResult(draft),
    ...(draft.levelingShifts ? { levelingShifts: draft.levelingShifts } : {}),
    routeLengthKm,
    measuredLengthKm: getPz3LengthCheck(draft, routeLengthKm).measuredKm,
    ...(draft.previewImage ? { previewImage: draft.previewImage } : {}),
  };
}

/** Раскладка людей и то, что из неё вышло по срокам. */
function createPz3PlanResult(draft: Pz3Draft): Pz3PlanResult {
  const totalWorkers = parsePz3Number(draft.totalWorkers) ?? 0;
  const allocations = draft.stages.map((stage) => ({
    stageId: stage.id,
    workers: parsePz3Number(draft.workersByStage[stage.id] ?? '') ?? 0,
  }));
  const plan = getPz3Plan(draft, allocations, totalWorkers);

  return {
    totalWorkers,
    workersByStage: Object.fromEntries(allocations.map((allocation) => [allocation.stageId, allocation.workers])),
    durationDays: plan.metrics.projectDuration,
    peakWorkers: plan.metrics.maxWorkers,
    overloadDays: plan.metrics.overloadDays,
  };
}

/** Отчёт по нормативам. Признак черновых данных едет вместе с числами. */
function createPz3ReportResult(draft: Pz3Draft): Pz3ReportResult {
  const report = getPz3Report(draft);

  return {
    laborHours: report.laborHours,
    machineHours: report.machineHours,
    materials: report.materials.map((row) => ({ title: row.title, unit: row.unit, amount: row.amount })),
    machines: report.machines.map((row) => ({ title: row.title, unit: row.unit, amount: row.amount })),
    normsAreDraft: true,
  };
}

/**
 * Файл ПЗ3. Данные ПЗ1 переносятся из загруженного моста как есть: третье
 * задание использует результат первого, и сохранение ПЗ3 не должно обнулять то, с чем
 * студент пришёл.
 */
export function createPz3Bridge(
  draft: Pz3Draft,
  importedBridge: BridgeSchema | null,
  position?: ModulePosition,
): BridgeSchema {
  const source = getPz3RouteSource(importedBridge);
  const passport = importedBridge?.passport ?? {
    team: '',
    lineTitle: '',
    createdAt: new Date().toISOString(),
  };

  return createBridge(
    passport,
    { ...importedBridge?.completed, pz3: createPz3Result(draft, source.totalLengthKm) },
    {
      ...importedBridge?.progress,
      pz3: {
        works: isPz3WorksComplete(draft),
        stages: isPz3StagesComplete(draft),
        plan: isPz3PlanComplete(draft),
      },
    },
    { ...importedBridge?.position, ...(position ? { pz3: position } : {}) },
  );
}

/**
 * Куда открывать задание после загрузки файла — тем же способом, что в ПЗ1:
 * шаг ищется по стабильному id, незнакомый id и файлы без позиции дают интро.
 */
export function readPz3Position(bridge: BridgeSchema | null | undefined) {
  const position = bridge?.position?.pz3;

  if (!position || !position.phase || position.phase === 'intro') {
    return null;
  }

  if (position.phase === 'result') {
    return { phase: 'result' as const, stepIndex: pz3StepIds.length - 1, theorySeen: true };
  }

  const stepIndex = position.stepId ? pz3StepIds.indexOf(position.stepId as Pz3StepId) : -1;

  if (stepIndex < 0) {
    return null;
  }

  return { phase: 'task' as const, stepIndex, theorySeen: position.theorySeen ?? true };
}
