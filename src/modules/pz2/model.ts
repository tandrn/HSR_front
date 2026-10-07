import { createBridge } from '../../bridge/io';
import type {
  BridgeSchema,
  ModulePosition,
  Pz2CriticalPathAnswer,
  Pz2PlanResult,
  Pz2ReportResult,
  Pz2Result,
  Pz2Stage,
  Pz2Work,
} from '../../bridge/schema';
import { buildRoutePointsBySegment, computeRouteLineMetrics } from '../../shared/lib/routeGeometry';
import { calculateCriticalPath, checkCriticalPathSubmission, createEmptyCriticalPathSubmission } from '../../shared/lib/criticalPath';
import type { CriticalPathSubmission, CriticalPathTimingInput } from '../../shared/lib/criticalPath';
import { createRouteRulerFromSegments, projectOntoRoute } from '../../shared/lib/routeRuler';
import type { RouteRuler } from '../../shared/lib/routeRuler';
import { pz2NetworkExercises } from './networkExercises';
import { getPz2Leveling } from './leveling';
import { getPz2WorkIcon } from './workIcons';
import { getPz2Plan, getPz2Report } from './plan';
import type {
  Pz2Draft,
  Pz2RouteSpan,
  Pz2StationMark,
  Pz2SoilCondition,
  Pz2RoutePointMark,
  Pz2RouteSource,
  Pz2SegmentMark,
  Pz2StageDraft,
  Pz2WorkDraft,
  Pz2WorkKind,
  Pz2WorkMark,
  Pz2WorkMeasure,
} from './types';

interface Pz2WorkKindInfo {
  id: Pz2WorkKind;
  label: string;
  measure: Pz2WorkMeasure;
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
export const pz2WorkKinds: Pz2WorkKindInfo[] = [
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


export const pz2SoilConditions: { id: Pz2SoilCondition; label: string; hint: string }[] = [
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
 * ВРЕМЕННОЕ ЗНАЧЕНИЕ: заказчик допуск не назвал (ТЗ ПЗ2 в-5). Полкилометра
 * взято как «точнее линейкой всё равно не намеряешь». На поведение это влияет
 * только на подпись «сошлось»: переход дальше не блокируется ни при каком
 * расхождении, как и требует ТЗ до ответа на в-5.
 */
export const PZ2_LENGTH_TOLERANCE_KM = 0.5;
/** Насколько участки могут перекрыться, чтобы это ещё считалось стыком, а не наложением. */
export const PZ2_SPAN_TOUCH_TOLERANCE_KM = 0.05;

export function getPz2WorkKind(kind: Pz2WorkKind) {
  return pz2WorkKinds.find((item) => item.id === kind) ?? pz2WorkKinds[0];
}

/**
 * Черновик ПЗ2, при загрузке файла — с уже введёнными значениями.
 *
 * Заказчик просил дословно: файл должен открывать тот же экран «с уже
 * введёнными значениями». В мост числа уходят числами, а поля ввода в проекте
 * работают со строками, поэтому здесь обратный перевод.
 */
export function createInitialPz2Draft(importedBridge?: BridgeSchema | null): Pz2Draft {
  const saved = importedBridge?.completed?.pz2;

  if (!saved) {
    return { works: [], stages: [], criticalPathAnswers: {}, totalWorkers: '', workersByStage: {}, rulerMarksKm: [] };
  }

  return {
    works: saved.works.map((work) => ({
      id: work.id,
      kind: work.kind,
      lengthKm: work.lengthKm === null ? '' : formatPz2InputNumber(work.lengthKm),
      count: work.count === null ? '' : formatPz2InputNumber(work.count),
      conditions: work.conditions,
      stageId: work.stageId,
      ...(work.span ? { span: work.span } : {}),
      ...(Number.isFinite(work.positionKm) ? { positionKm: work.positionKm } : {}),
    })),
    stages: saved.stages.map((stage) => ({ id: stage.id, title: stage.title, order: stage.order })),
    criticalPathAnswers: Object.fromEntries(saved.criticalPath.map((answer) => [answer.exerciseId, restoreCriticalPathAnswer(answer)])),
    ...(saved.levelingShifts ? { levelingShifts: saved.levelingShifts } : {}),
    totalWorkers: saved.plan.totalWorkers > 0 ? formatPz2InputNumber(saved.plan.totalWorkers) : '',
    workersByStage: Object.fromEntries(
      Object.entries(saved.plan.workersByStage).map(([stageId, workers]) => [stageId, formatPz2InputNumber(workers)]),
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
function restoreCriticalPathAnswer(answer: Pz2CriticalPathAnswer): CriticalPathSubmission {
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
function formatPz2InputNumber(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

export function createPz2Work(
  kind: Pz2WorkKind = 'existingLineRepair',
  lengthKm = '',
  span?: Pz2RouteSpan,
): Pz2WorkDraft {
  return {
    id: `work-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    lengthKm,
    count: getPz2WorkKind(kind).measure === 'count' ? '1' : '',
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
export function setPz2WorkLength(work: Pz2WorkDraft, lengthKm: string): Pz2WorkDraft {
  if (work.span && lengthKm !== work.lengthKm) {
    const { span, ...rest } = work;
    void span;

    return { ...rest, lengthKm };
  }

  return { ...work, lengthKm };
}

/** Условие включают и выключают галочкой, поэтому переключатель, а не замена. */
export function togglePz2SoilCondition(work: Pz2WorkDraft, condition: Pz2SoilCondition): Pz2WorkDraft {
  const conditions = work.conditions.includes(condition)
    ? work.conditions.filter((item) => item !== condition)
    : [...work.conditions, condition];

  return { ...work, conditions };
}

export function renamePz2Stage(draft: Pz2Draft, stageId: string, title: string): Pz2Draft {
  return {
    ...draft,
    stages: draft.stages.map((stage) => (stage.id === stageId ? { ...stage, title } : stage)),
  };
}

export function createPz2Stage(title: string, order: number): Pz2StageDraft {
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
export function findPz2OverlappingWorks(draft: Pz2Draft): string[] {
  const measured = draft.works
    .filter((object) => object.span && getPz2WorkKind(object.kind).measure === 'length')
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
    if (current.fromKm < previous.toKm - PZ2_SPAN_TOUCH_TOLERANCE_KM) {
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
export function changePz2WorkKind(
  object: Pz2WorkDraft,
  kind: Pz2WorkKind,
  routeKm = 0,
  initialPositionKm = routeKm / 2,
): Pz2WorkDraft {
  const needsCount = getPz2WorkKind(kind).measure === 'count';

  return {
    ...object,
    kind,
    count: needsCount && !object.count.trim() ? '1' : object.count,
    ...(getPz2WorkIcon(kind) && (kind === 'turnout' || !object.span) && !Number.isFinite(object.positionKm)
      ? { positionKm: Math.max(0, Math.min(routeKm, initialPositionKm)) }
      : {}),
  };
}

/** Первые значки разводим по трассе, чтобы новые объекты не закрывали друг друга. */
export function getPz2DefaultWorkPosition(index: number, routeKm: number): number {
  return routeKm * ((index % 4) + 1) / 5;
}

/** Перетаскивание переводит координату маркера в километраж и удерживает его на трассе. */
export function setPz2WorkPosition(work: Pz2WorkDraft, distanceKm: number, routeKm: number): Pz2WorkDraft {
  if (!getPz2WorkIcon(work.kind) || (work.kind !== 'turnout' && work.span) || !Number.isFinite(distanceKm)) {
    return work;
  }

  return { ...work, positionKm: Math.max(0, Math.min(routeKm, distanceKm)) };
}

/**
 * Трасса из ПЗ1. Без загруженного файла ПЗ2 мерить нечего — это не ошибка,
 * а нормальное состояние до того, как студент принесёт свой JSON-мост.
 */
export function getPz2RouteSource(bridge: BridgeSchema | null | undefined): Pz2RouteSource {
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
export function getPz2StationMarks(source: Pz2RouteSource, ruler: RouteRuler): Pz2StationMark[] {
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
export function createPz2Ruler(source: Pz2RouteSource): RouteRuler {
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

export interface Pz2LengthCheck {
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
export function getPz2LengthCheck(draft: Pz2Draft, routeKm: number): Pz2LengthCheck {
  const measuredKm = draft.works.reduce((sum, object) => {
    if (getPz2WorkKind(object.kind).measure !== 'length') {
      return sum;
    }

    return sum + (parsePz2Number(object.lengthKm) ?? 0);
  }, 0);

  const differenceKm = measuredKm - routeKm;

  if (draft.works.length === 0) {
    return { measuredKm, routeKm, differenceKm, status: 'empty' };
  }

  if (Math.abs(differenceKm) <= PZ2_LENGTH_TOLERANCE_KM) {
    return { measuredKm, routeKm, differenceKm, status: 'match' };
  }

  return { measuredKm, routeKm, differenceKm, status: differenceKm < 0 ? 'short' : 'over' };
}

export function validatePz2Work(object: Pz2WorkDraft): string | null {
  const measure = getPz2WorkKind(object.kind).measure;

  if (measure === 'count') {
    const count = parsePz2Number(object.count);

    if (count === null) {
      return 'Укажите количество';
    }

    return count > 0 && Number.isInteger(count) ? null : 'Количество — целое число больше нуля';
  }

  const lengthKm = parsePz2Number(object.lengthKm);

  if (lengthKm === null) {
    return 'Укажите длину';
  }

  return lengthKm > 0 ? null : 'Длина должна быть больше нуля';
}

export function isPz2WorksComplete(draft: Pz2Draft) {
  return draft.works.length > 0 && draft.works.every((object) => validatePz2Work(object) === null);
}

/** Числовой ввод в стиле проекта: запятая как разделитель, пробелы разрядов игнорируются. */
export function parsePz2Number(value: string): number | null {
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
export function formatPz2Km(value: number) {
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
export function isPz2StagesComplete(draft: Pz2Draft) {
  return draft.stages.length > 0 && draft.works.length > 0 && draft.works.every((work) => work.stageId !== null);
}

/**
 * Точки линии трассы из ПЗ1 — те же, что студент ставил в первом задании.
 *
 * Номер сохраняется по порядку вершин: на карте ПЗ2 точка подписана тем же
 * числом, что и в ПЗ1, иначе два задания показывали бы одну трассу по-разному.
 */
export function getPz2RoutePointMarks(source: Pz2RouteSource, ruler: RouteRuler): Pz2RoutePointMark[] {
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
export function getPz2SegmentMarks(source: Pz2RouteSource): Pz2SegmentMark[] {
  if (!source.routeLine) {
    return [];
  }

  const metrics = computeRouteLineMetrics(source.routeLine);
  let fromKm = 0;

  return source.routeLine.segments.map((segment, index) => {
    const measured = metrics.segments.find((item) => item.segmentId === segment.id);
    const lengthKm = measured?.arcLengthKm ?? 0;
    const mark: Pz2SegmentMark = {
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
export function getPz2WorkMarks(draft: Pz2Draft, routeKm = 0): Pz2WorkMark[] {
  return draft.works.flatMap<Pz2WorkMark>((work, index) => {
    const icon = getPz2WorkIcon(work.kind);

    if (!icon) {
      return [];
    }

    if (work.kind === 'turnout') {
      const count = parsePz2Number(work.count) ?? 0;
      const distanceKm = Number.isFinite(work.positionKm) ? work.positionKm! : getPz2DefaultWorkPosition(index, routeKm);

      return [{
        id: work.id,
        kind: work.kind,
        label: icon.label,
        title: `Стрелочный перевод 1/25: ${count} шт. — ${formatPz2Km(distanceKm)} от начала трассы`,
        distanceKm,
        count,
        draggable: true,
      }];
    }

    if (!work.span) {
      const distanceKm = Number.isFinite(work.positionKm) ? work.positionKm! : getPz2DefaultWorkPosition(index, routeKm);
      const lengthKm = parsePz2Number(work.lengthKm);

      return [{
        id: work.id,
        kind: work.kind,
        label: icon.label,
        title: `${getPz2WorkKind(work.kind).label}${lengthKm !== null ? `: ${formatPz2Km(lengthKm)}` : ''} — ${formatPz2Km(distanceKm)} от начала трассы`,
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
        title: `${getPz2WorkKind(work.kind).label}: ${formatPz2Km(to - from)}`,
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
export const pz2StageColors = ['#003d84', '#08a696', '#e0182d', '#8a5cf5', '#e07b18', '#0f6e56', '#c0392b'];

export function getPz2StageColor(order: number) {
  return pz2StageColors[order % pz2StageColors.length];
}

/**
 * Куски трассы, занятые работами этапа.
 *
 * Рисуются только намеренные линейкой работы: у введённых руками места на
 * трассе нет, и показать их на карте нечем — вместо догадки экран честно
 * говорит, сколько работ осталось без участка.
 */
export function getPz2StageSpans(draft: Pz2Draft) {
  return draft.stages.map((stage) => {
    const works = getPz2StageWorks(draft, stage.id);

    return {
      id: stage.id,
      title: stage.title,
      color: getPz2StageColor(stage.order),
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
export function getPz2StageWorks(draft: Pz2Draft, stageId: string | null) {
  return draft.works.filter((work) => work.stageId === stageId);
}

/**
 * Перенос работы в этап. Работа принадлежит ровно одному этапу, поэтому это
 * замена принадлежности, а не добавление в список — двух этапов у неё быть не
 * может (DoD экрана 2).
 */
export function assignPz2WorkToStage(draft: Pz2Draft, workId: string, stageId: string | null): Pz2Draft {
  return {
    ...draft,
    works: draft.works.map((work) => (work.id === workId ? { ...work, stageId } : work)),
  };
}

/**
 * Удаление этапа: его работы возвращаются в пул, а не исчезают вместе с ним.
 * Порядок оставшихся этапов пересчитывается, чтобы не осталось дыр.
 */
export function removePz2Stage(draft: Pz2Draft, stageId: string): Pz2Draft {
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
export function checkPz2CriticalPath(answer: string, reference: string[]): boolean {
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
export function isPz2PlanComplete(draft: Pz2Draft) {
  const total = parsePz2Number(draft.totalWorkers) ?? 0;

  if (total <= 0 || draft.stages.length === 0) {
    return false;
  }

  return draft.stages.every((stage) => (parsePz2Number(draft.workersByStage[stage.id] ?? '') ?? 0) > 0);
}

export interface Pz2ExercisesProgress {
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
export function getPz2ExercisesProgress(draft: Pz2Draft): Pz2ExercisesProgress {
  const solvedCriticalPath = pz2NetworkExercises.filter((exercise) => {
    const submission = draft.criticalPathAnswers[exercise.id];

    return Boolean(
      submission
      && checkCriticalPathSubmission(submission, calculateCriticalPath(exercise.works)).coreCorrect,
    );
  }).length;
  const levelingSolved = getPz2Leveling(draft.levelingShifts ?? {}).isSolved;
  const totalCriticalPath = pz2NetworkExercises.length;

  return {
    solvedCriticalPath,
    totalCriticalPath,
    levelingSolved,
    isComplete: solvedCriticalPath === totalCriticalPath && levelingSolved,
  };
}

export function isPz2ExercisesComplete(draft: Pz2Draft) {
  return getPz2ExercisesProgress(draft).isComplete;
}

/** Шаги задания стабильными идентификаторами: позиция в файле не зависит от порядка. */
export const pz2StepIds = ['works', 'stages', 'exercises', 'plan'] as const;

export type Pz2StepId = (typeof pz2StepIds)[number];

/**
 * Итог ПЗ2 для моста.
 *
 * Строки ввода превращаются в числа здесь и только здесь: дальше по цепочке
 * заданий пойдут посчитанные величины, а не то, что студент набрал в поле.
 */
export function createPz2Result(draft: Pz2Draft, routeLengthKm: number): Pz2Result {
  return {
    works: draft.works.map((work): Pz2Work => {
      const measure = getPz2WorkKind(work.kind).measure;

      return {
        id: work.id,
        kind: work.kind,
        lengthKm: measure === 'length' ? parsePz2Number(work.lengthKm) : null,
        count: measure === 'count' ? parsePz2Number(work.count) : null,
        stageId: work.stageId,
        conditions: work.conditions,
        ...(work.span ? { span: work.span } : {}),
        ...(Number.isFinite(work.positionKm) ? { positionKm: work.positionKm } : {}),
      };
    }),
    stages: draft.stages.map((stage): Pz2Stage => ({ id: stage.id, title: stage.title, order: stage.order })),
    criticalPath: pz2NetworkExercises.map((exercise) => {
      const submission = draft.criticalPathAnswers[exercise.id] ?? createEmptyCriticalPathSubmission();
      return {
        exerciseId: exercise.id,
        answer: submission.paths,
        correct: checkCriticalPathSubmission(submission, calculateCriticalPath(exercise.works)).coreCorrect,
        submission,
      };
    }),
    plan: createPz2PlanResult(draft),
    report: createPz2ReportResult(draft),
    ...(draft.levelingShifts ? { levelingShifts: draft.levelingShifts } : {}),
    routeLengthKm,
    measuredLengthKm: getPz2LengthCheck(draft, routeLengthKm).measuredKm,
    ...(draft.previewImage ? { previewImage: draft.previewImage } : {}),
  };
}

/** Раскладка людей и то, что из неё вышло по срокам. */
function createPz2PlanResult(draft: Pz2Draft): Pz2PlanResult {
  const totalWorkers = parsePz2Number(draft.totalWorkers) ?? 0;
  const allocations = draft.stages.map((stage) => ({
    stageId: stage.id,
    workers: parsePz2Number(draft.workersByStage[stage.id] ?? '') ?? 0,
  }));
  const plan = getPz2Plan(draft, allocations, totalWorkers);

  return {
    totalWorkers,
    workersByStage: Object.fromEntries(allocations.map((allocation) => [allocation.stageId, allocation.workers])),
    durationDays: plan.metrics.projectDuration,
    peakWorkers: plan.metrics.maxWorkers,
    overloadDays: plan.metrics.overloadDays,
  };
}

/** Отчёт по нормативам. Признак черновых данных едет вместе с числами. */
function createPz2ReportResult(draft: Pz2Draft): Pz2ReportResult {
  const report = getPz2Report(draft);

  return {
    laborHours: report.laborHours,
    machineHours: report.machineHours,
    materials: report.materials.map((row) => ({ title: row.title, unit: row.unit, amount: row.amount })),
    machines: report.machines.map((row) => ({ title: row.title, unit: row.unit, amount: row.amount })),
    normsAreDraft: true,
  };
}

/**
 * Файл ПЗ2. Данные ПЗ1 переносятся из загруженного моста как есть: второе
 * задание продолжает первое, и сохранение ПЗ2 не должно обнулять то, с чем
 * студент пришёл.
 */
export function createPz2Bridge(
  draft: Pz2Draft,
  importedBridge: BridgeSchema | null,
  position?: ModulePosition,
): BridgeSchema {
  const source = getPz2RouteSource(importedBridge);
  const passport = importedBridge?.passport ?? {
    team: '',
    lineTitle: '',
    createdAt: new Date().toISOString(),
  };

  return createBridge(
    passport,
    { ...importedBridge?.completed, pz2: createPz2Result(draft, source.totalLengthKm) },
    {
      ...importedBridge?.progress,
      pz2: {
        works: isPz2WorksComplete(draft),
        stages: isPz2StagesComplete(draft),
        plan: isPz2PlanComplete(draft),
      },
    },
    { ...importedBridge?.position, ...(position ? { pz2: position } : {}) },
  );
}

/**
 * Куда открывать задание после загрузки файла — тем же способом, что в ПЗ1:
 * шаг ищется по стабильному id, незнакомый id и файлы без позиции дают интро.
 */
export function readPz2Position(bridge: BridgeSchema | null | undefined) {
  const position = bridge?.position?.pz2;

  if (!position || !position.phase || position.phase === 'intro') {
    return null;
  }

  if (position.phase === 'result') {
    return { phase: 'result' as const, stepIndex: pz2StepIds.length - 1, theorySeen: true };
  }

  const stepIndex = position.stepId ? pz2StepIds.indexOf(position.stepId as Pz2StepId) : -1;

  if (stepIndex < 0) {
    return null;
  }

  return { phase: 'task' as const, stepIndex, theorySeen: position.theorySeen ?? true };
}
