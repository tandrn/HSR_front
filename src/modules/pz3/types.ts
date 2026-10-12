import type { Pz1Station, RouteLine } from '../../bridge/schema';
import type { CriticalPathSubmission } from '../../shared/lib/criticalPath';

/** Что студент размещает на трассе. Список закрыт заказчиком на встрече 02.09. */
export type Pz3WorkKind =
  | 'existingLineRepair'
  | 'earthworks'
  | 'ballastTrack'
  | 'viaduct'
  | 'bridge'
  | 'tunnel'
  | 'turnout';

/** Как объект меряется: длиной вдоль трассы или штуками. */
export type Pz3WorkMeasure = 'length' | 'count';

/**
 * Дополнительное условие на участке. Меняет состав работ: слабые грунты
 * требуют забивки свай до твёрдого слоя с устройством ростверка (ТЗ ПЗ3 §4.1).
 * Насколько меняется трудоёмкость — вопрос к заказчику (в-6).
 *
 * Формулировка второго условия расходится в источниках: на доске «скальные
 * породы», в записи «скальные основания». Взято написание из ТЗ (в-2).
 */
export type Pz3SoilCondition =
  | 'weakSoil' | 'rocky' // сохранения до уточнения заказчиком состава опций
  | 'shortWindows' | 'ballastContamination' | 'formationDeformation' | 'restrictedAccess'
  | 'weakFoundation' | 'groundwater' | 'highEmbankment' | 'deepCut'
  | 'settlement' | 'transition' | 'curvedViaduct'
  | 'weakBridgeSupport' | 'riverSupports' | 'navigableRiver'
  | 'unstableTunnelGround' | 'tunnelGroundwater' | 'abrasiveRock' | 'underBuildings';

export interface Pz3WorkDraft {
  id: string;
  kind: Pz3WorkKind;
  /** Длина участка, км. Текстом — как и все числовые поля в проекте. */
  lengthKm: string;
  /** Количество штук для объектов без длины. */
  count: string;
  /** Пусто — обычные условия. Условия не исключают друг друга, поэтому список. */
  conditions: Pz3SoilCondition[];
  /** Этап, которому принадлежит работа. null — работа в общем пуле (ТЗ §4.1). */
  stageId: string | null;
  /** Участок трассы, которым строку намерили: км от начала. У ручных строк пусто. */
  span?: Pz3RouteSpan;
  /** Положение объекта без намеренного участка на трассе, км от начала. */
  positionKm?: number;
}

/** Отмеренный линейкой кусок трассы. */
export interface Pz3RouteSpan {
  fromKm: number;
  toKm: number;
}

/** Пространственный этап: участок трассы, который строится параллельно другим. */
export interface Pz3StageDraft {
  id: string;
  title: string;
  order: number;
}

export interface Pz3Draft {
  works: Pz3WorkDraft[];
  stages: Pz3StageDraft[];
  /** Ответы на упражнения про критический путь: id упражнения → заполненная форма. */
  criticalPathAnswers: Record<string, CriticalPathSubmission>;
  /** Упражнение на выравнивание: id работы → сдвиг в днях. Пусто — не начато. */
  levelingShifts?: Record<string, number>;
  /** Сколько рабочих есть на проект. Откуда берётся число — вопрос в-7. */
  totalWorkers: string;
  /** Сколько рабочих назначено этапу: id этапа → число. */
  workersByStage: Record<string, string>;
  /** Отметки линейки на трассе, км от начала. Незавершённое измерение — одна отметка. */
  rulerMarksKm: number[];
  /** Последний снимок карты — уходит в отчёт. Пусто, пока карту не открывали. */
  previewImage?: string;
}

/** Данные, которые ПЗ3 забирает из JSON-моста ПЗ1. */
export interface Pz3RouteSource {
  routeLine: RouteLine | null;
  stations: Pz1Station[];
  totalLengthKm: number;
  variantTitle: string;
}

/** Точка линии трассы из ПЗ1 с километражом от начала. */
export interface Pz3RoutePointMark {
  id: string;
  /** Номер по порядку — тот же, что видел студент в ПЗ1. */
  number: number;
  lat: number;
  lon: number;
  distanceKm: number;
}

/** Сегмент трассы из ПЗ1: прямая вставка или кривая между двумя точками. */
export interface Pz3SegmentMark {
  id: string;
  number: number;
  lengthKm: number;
  /** Радиус кривой, м. null — прямая вставка. */
  radiusM: number | null;
  /** Километр начала сегмента от начала трассы. */
  fromKm: number;
}

/** Станция ПЗ1 на трассе ПЗ3: та же точка, но с километражом от начала. */
export interface Pz3StationMark {
  label: string;
  name: string;
  lat: number;
  lon: number;
  /** Расстояние от начала трассы, км. */
  distanceKm: number;
}

/** Значок объекта на трассе: где стоит и что подписано. */
export interface Pz3WorkMark {
  id: string;
  kind: Pz3WorkKind;
  /** Название объекта из словаря значков. */
  label: string;
  title: string;
  /** Километр от начала трассы. */
  distanceKm: number;
  /** Количество переводов в этой точке; только для стрелочного перевода. */
  count?: number;
  /** Значок без намеренного участка можно поставить вручную. */
  draggable?: boolean;
}

/** Куски трассы одного этапа с его цветом — раскраска карты на экране 02. */
export interface Pz3StageSpanGroup {
  id: string;
  title: string;
  color: string;
  spans: Pz3RouteSpan[];
}
