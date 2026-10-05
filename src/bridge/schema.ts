import type { CriticalPathSubmission } from '../shared/lib/criticalPath';

export type StationLabel = 'А' | 'Б' | 'В' | 'Г';
export type StationType = 'terminal' | 'intermediate';

export interface Pz1Station {
  label: StationLabel;
  name: string;
  lat: number;
  lng: number;
  type: StationType;
  region?: string;
}

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface RouteVertex extends GeoPoint {
  id: string;
}

export interface RouteSegment {
  id: string;
  fromVertexId: string;
  toVertexId: string;
  sagittaKm: number;
}

export interface RouteLine {
  vertices: RouteVertex[];
  segments: RouteSegment[];
}

export type TransportModeId = 'hSR' | 'airplane' | 'suburbanTrain' | 'longDistanceTrain' | 'bus' | 'car';
export type BridgeSchemaVersion = '1.0' | '1.1' | '1.2';

export interface Pz1DiscomfortMatrix {
  values: Record<string, Record<TransportModeId, string>>;
}

export interface CorrespondenceTable {
  pairKey: string;
  activeModes: TransportModeId[];
  values: Record<string, Record<string, string>>;
}

export interface Pz1PassengerFlowRegionalInputs {
  grpCurrentRegionA: string;
  grpCurrentRegionB: string;
  grpGrowthPctRegionA: string;
  grpGrowthPctRegionB: string;
  populationCurrentRegionA: string;
  populationCurrentRegionB: string;
  populationGrowthPctRegionA: string;
  populationGrowthPctRegionB: string;
  gdpPassengerFlowCoefficientRegionA: string;
  gdpPassengerFlowCoefficientRegionB: string;
  inducedDemandPct: string;
}

export interface Pz1PassengerFlowModeInputs {
  existingAnnualFlow: string;
  travelTimeHours: string;
  waitingTimeHours: string;
  totalTransportCost: string;
  existingTravelTimeHours: string;
}

export interface Pz1PassengerFlowInputs {
  regional: Pz1PassengerFlowRegionalInputs;
  modes: Record<TransportModeId, Pz1PassengerFlowModeInputs>;
}

export interface Pz1PassengerFlowTotalDemand {
  existingAnnualFlow: number;
  baseForecast: number;
  inducedDemand: number;
  totalForecast: number;
  grpDelta: number;
  populationDelta: number;
  weightedGdpPassengerFlowCoefficient: number;
}

export interface Pz1PassengerFlowModeResult {
  modeId: TransportModeId;
  existingAnnualFlow: number;
  forecastAnnualFlow: number;
  forecastShare: number;
  directCapture: number;
  gravityCapture: number;
  inducedCapture: number;
}

export interface Pz1PassengerFlowResult {
  inputs: Pz1PassengerFlowInputs;
  totalDemand: Pz1PassengerFlowTotalDemand;
  modes: Pz1PassengerFlowModeResult[];
}

export interface Pz1HsrTravelTimeSegment {
  fromLabel: StationLabel;
  toLabel: StationLabel;
  distanceKm: number;
  speedKmh: number;
  travelTimeMinutes: number;
}

export interface Pz1HsrTravelTimeResult {
  accelerationMinutes: number;
  brakingMinutes: number;
  totalMinutes: number;
  segments: Pz1HsrTravelTimeSegment[];
}

export interface Pz1RegionalParameterInputs {
  grpExisting: string;
  grpForecast: string;
  populationExisting: string;
  populationForecast: string;
  averageSalary: string;
  kGdpFlow: string;
}

export interface Pz1RegionalCharacteristicInputs {
  regionA: string;
  regionB: string;
  grpExistingRegionA: string;
  grpExistingRegionB: string;
  grpForecastRegionA: string;
  grpForecastRegionB: string;
  populationExistingRegionA: string;
  populationExistingRegionB: string;
  populationForecastRegionA: string;
  populationForecastRegionB: string;
  averageSalaryRegionA: string;
  averageSalaryRegionB: string;
  kGdpFlowRegionA: string;
  kGdpFlowRegionB: string;
  inducedDemandPct: string;
  regionParameters?: Record<string, Pz1RegionalParameterInputs>;
}

export interface SplitTransportValue {
  existing: string;
  forecast: string;
}

export interface Pz1AnnualFlowModeInputs {
  capacity: string;
  capacityExisting?: string;
  capacityForecast?: string;
  occupancyExisting: string;
  occupancyForecast: string;
  existingAnnualFlow?: number;
  forecastAnnualFlow?: number;
}

export interface Pz1CorrespondenceScenario {
  pairKey: string;
  title: string;
  travelTime: Record<string, Record<TransportModeId, SplitTransportValue>>;
  discomfortExisting: Pz1DiscomfortMatrix;
  discomfortForecast: Pz1DiscomfortMatrix;
  discomfortAggregates: Record<TransportModeId, { existing: number | null; forecast: number | null }>;
  frequency: Record<TransportModeId, SplitTransportValue>;
  fare: Record<TransportModeId, SplitTransportValue>;
  otherParameters: Record<string, string>;
  annualFlows: Record<TransportModeId, Pz1AnnualFlowModeInputs>;
  passengerFlowForecast?: Pz1PassengerFlowResult;
}

export type Pz1StationOtherParameters = Record<StationLabel, Record<string, string>>;

export interface Pz1Result {
  stations: Pz1Station[];
  routeLine: RouteLine;
  totalLengthKm: number;
  previewImage?: string;
  variantId?: string;
  hsrTravelTime?: Pz1HsrTravelTimeResult;
  regionalCharacteristics?: Pz1RegionalCharacteristicInputs;
  stationOtherParameters?: Pz1StationOtherParameters;
  correspondenceScenarios?: Record<string, Pz1CorrespondenceScenario>;
  consumerProperties?: Record<string, CorrespondenceTable>;
  discomfortMatrix?: Pz1DiscomfortMatrix;
  passengerFlowForecast?: Pz1PassengerFlowResult;
  finalIndicators?: Record<string, string>;
  notes?: string;
}

/**
 * Итог ПЗ2 (ТЗ ПЗ2 §10). Длины и количества здесь уже числа: в черновике они
 * живут строками, потому что это поля ввода, а в мост уходит посчитанное.
 */
export interface Pz2Work {
  id: string;
  kind: Pz2WorkKind;
  /** Длина участка, км. null у штучных работ — у них считается count. */
  lengthKm: number | null;
  /** Количество, шт. null у линейных работ. */
  count: number | null;
  /** Этап, которому принадлежит работа. null — работа в общем пуле. */
  stageId: string | null;
  conditions: Pz2SoilCondition[];
  /** Где работа стоит на трассе, км от начала. Есть только у намеренных линейкой. */
  span?: { fromKm: number; toKm: number };
}

export type Pz2WorkKind =
  | 'existingLineRepair'
  | 'earthworks'
  | 'ballastTrack'
  | 'viaduct'
  | 'bridge'
  | 'tunnel'
  | 'turnout';

export type Pz2SoilCondition = 'weakSoil' | 'rocky';

/** Пространственный этап: участок трассы, который строится параллельно другим. */
export interface Pz2Stage {
  id: string;
  title: string;
  order: number;
}

/** Ответ на упражнение «критический путь» (ТЗ ПЗ2 §7.2). */
export interface Pz2CriticalPathAnswer {
  exerciseId: string;
  /** Сырой ввод пути; оставлен для файлов ПЗ2, сохранённых до появления таблицы сроков. */
  answer: string;
  correct: boolean;
  /** Полный ответ на вариант: сроки работ, срок проекта, пути и объяснение. */
  submission?: CriticalPathSubmission;
}

/** Ресурсный план: как студент разложил людей и что из этого вышло. */
export interface Pz2PlanResult {
  totalWorkers: number;
  /** Сколько людей назначено этапу: id этапа → число. */
  workersByStage: Record<string, number>;
  durationDays: number;
  peakWorkers: number;
  overloadDays: number;
}

/**
 * Отчёт по проекту. Числа посчитаны по временным нормативам (ТЗ ПЗ2 §9):
 * заказчик разрешил их сгенерировать до проверки экспертом.
 */
export interface Pz2ReportResult {
  laborHours: number;
  machineHours: number;
  materials: { title: string; unit: string; amount: number }[];
  machines: { title: string; unit: string; amount: number }[];
  /** Нормативы черновые и подлежат замене — признак едет вместе с числами. */
  normsAreDraft: true;
}

export interface Pz2Result {
  works: Pz2Work[];
  stages: Pz2Stage[];
  criticalPath: Pz2CriticalPathAnswer[];
  /**
   * Упражнение на выравнивание загрузки: id работы учебного примера → сдвиг в
   * днях. Поле необязательное — файлы, сохранённые раньше, его не имеют.
   */
  levelingShifts?: Record<string, number>;
  plan: Pz2PlanResult;
  report: Pz2ReportResult;
  /** Эталон из ПЗ1, с которым сверялась сумма длин. */
  routeLengthKm: number;
  /** Сумма длин линейных работ на момент сохранения. */
  measuredLengthKm: number;
  /**
   * Снимок карты трассы с работами и этапами — data URL PNG, как в ПЗ1.
   * Поле необязательное: файлы, сохранённые раньше, его не имеют, а отчёт
   * без снимка печатается с оговоркой вместо картинки.
   */
  previewImage?: string;
}
// TODO: уточнить по методичке при разработке ПЗ3.
export type Pz3Result = unknown;
// TODO: уточнить по методичке при разработке ПЗ4.
export type Pz4Result = unknown;
// TODO: уточнить по методичке при разработке ПЗ5.
export type Pz5Result = unknown;
// TODO: уточнить по методичке при разработке ПЗ6.
export type Pz6Result = unknown;
// TODO: уточнить по методичке при разработке ПЗ7.
export type Pz7Result = unknown;
// TODO: уточнить по методичке при разработке ПЗ8.
export type Pz8Result = unknown;

export interface Passport {
  team: string;
  lineTitle: string;
  defaultVariant?: number;
  createdAt: string;
  /**
   * Идентификатор прохода задания. Заводится один раз при начале работы и
   * переживает выгрузку и загрузку файла: продолжение своей работы сохраняет
   * тот же id, а два файла с одинаковым id — это один и тот же проход,
   * то есть копия. Поле необязательное — файлы, сохранённые раньше, его
   * не имеют и открываются как обычно.
   */
  runId?: string;
}

/**
 * Где студент остановился, когда сохранял файл.
 *
 * Шаг адресуется стабильным id, а не номером: порядок шагов уже менялся
 * (ТЗ v3.6 T-2), и файл, сохранённый до реордера, не должен открывать чужой
 * экран. Поле необязательное — файлы, сохранённые раньше, просто открываются
 * с интро, как и открывались.
 */
export interface ModulePosition {
  stepId?: string;
  phase?: 'intro' | 'task' | 'result';
  theorySeen?: boolean;
}

export interface BridgeSchema {
  schemaVersion: BridgeSchemaVersion;
  passport: Passport;
  /** Когда файл был записан. Вместе с runId показывает, как шла работа. */
  savedAt?: string;
  progress?: Partial<Record<'pz1' | 'pz2' | 'pz3' | 'pz4' | 'pz5' | 'pz6' | 'pz7' | 'pz8', Record<string, boolean>>>;
  position?: Partial<Record<'pz1' | 'pz2' | 'pz3' | 'pz4' | 'pz5' | 'pz6' | 'pz7' | 'pz8', ModulePosition>>;
  completed: Partial<{
    pz1: Pz1Result;
    pz2: Pz2Result;
    pz3: Pz3Result;
    pz4: Pz4Result;
    pz5: Pz5Result;
    pz6: Pz6Result;
    pz7: Pz7Result;
    pz8: Pz8Result;
  }>;
}