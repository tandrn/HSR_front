import type {
  BridgeSchema,
  ModulePosition,
  CorrespondenceTable,
  Passport,
  Pz1DiscomfortMatrix,
  Pz1PassengerFlowInputs,
  Pz1PassengerFlowModeInputs,
  Pz1PassengerFlowRegionalInputs,
  Pz1RegionalCharacteristicInputs,
  Pz1RegionalParameterInputs,
  Pz1PassengerFlowResult,
  Pz1Result,
  Pz1Station,
  RouteLine,
  SplitTransportValue,
  StationLabel,
  StationType,
  TransportModeId,
} from '../../bridge/schema';
import { stripGroupSeparators } from '../../shared/lib/numberFormat';
import { createBridge } from '../../bridge/io';
import { calculateCarTravelCost } from '../../shared/lib/carTravelCost';
import { isDurationInvalid, parseDurationToMinutes } from '../../shared/lib/durationInput';
import { distributePassengerFlowByMode, forecastTotalDemand } from '../../shared/lib/passengerFlow';
import type { PassengerFlowModeInput, TotalDemandForecastInput } from '../../shared/lib/passengerFlow';
import {
  CAR_EXISTING_FLOW_MULTIPLIER,
  SERVICE_WINDOW_HOURS,
  passengerFlowModeIds,
} from '../../shared/lib/passengerFlowWeights';
import { buildDisplayRoutePoints, buildRoutePointsBySegment, computeArcMetrics, computeRouteLineMetrics, computeSagittaFromRadius, haversineDistanceKm } from '../../shared/lib/routeGeometry';
import type { DataEntryColumn, DataEntryRow } from '../../shared/ui/DataEntryTable';
import type {
  Pz1CorrespondenceDetailDraft,
  Pz1CorrespondenceTableDraft,
  Pz1Draft,
  Pz1HsrSpeedDraft,
  Pz1RoutePointDraft,
  Pz1StationDraft,
} from './types';
import { pz1Variants } from './variants';

const STATION_LABELS: StationLabel[] = ['А', 'Б', 'В', 'Г'];
const TERMINAL_LABELS: StationLabel[] = ['А', 'Г'];
const HSR_MODE_ID: TransportModeId = 'hSR';
const CAR_MODE_ID: TransportModeId = 'car';
const HSR_ACCELERATION_MINUTES = 2;
const HSR_BRAKING_MINUTES = 1;
const PASSPORT_LIMITS = {
  team: { min: 2, max: 40 },
};

export const russianRegions = [
  'Алтайский край',
  'Амурская область',
  'Архангельская область',
  'Астраханская область',
  'Белгородская область',
  'Брянская область',
  'Владимирская область',
  'Волгоградская область',
  'Вологодская область',
  'Воронежская область',
  'Еврейская автономная область',
  'Забайкальский край',
  'Ивановская область',
  'Иркутская область',
  'Кабардино-Балкарская Республика',
  'Калининградская область',
  'Калужская область',
  'Камчатский край',
  'Карачаево-Черкесская Республика',
  'Кемеровская область',
  'Кировская область',
  'Костромская область',
  'Краснодарский край',
  'Красноярский край',
  'Курганская область',
  'Курская область',
  'Ленинградская область',
  'Липецкая область',
  'Магаданская область',
  'Москва',
  'Московская область',
  'Мурманская область',
  'Ненецкий автономный округ',
  'Нижегородская область',
  'Новгородская область',
  'Новосибирская область',
  'Омская область',
  'Оренбургская область',
  'Орловская область',
  'Пензенская область',
  'Пермский край',
  'Приморский край',
  'Псковская область',
  'Республика Адыгея',
  'Республика Алтай',
  'Республика Башкортостан',
  'Республика Бурятия',
  'Республика Дагестан',
  'Республика Ингушетия',
  'Республика Калмыкия',
  'Республика Карелия',
  'Республика Коми',
  'Республика Крым',
  'Республика Марий Эл',
  'Республика Мордовия',
  'Республика Саха (Якутия)',
  'Республика Северная Осетия — Алания',
  'Республика Татарстан',
  'Республика Тыва',
  'Республика Хакасия',
  'Ростовская область',
  'Рязанская область',
  'Самарская область',
  'Санкт-Петербург',
  'Саратовская область',
  'Сахалинская область',
  'Свердловская область',
  'Севастополь',
  'Смоленская область',
  'Ставропольский край',
  'Тамбовская область',
  'Тверская область',
  'Томская область',
  'Тульская область',
  'Тюменская область',
  'Удмуртская Республика',
  'Ульяновская область',
  'Хабаровский край',
  'Ханты-Мансийский автономный округ — Югра',
  'Челябинская область',
  'Чеченская Республика',
  'Чувашская Республика',
  'Чукотский автономный округ',
  'Ямало-Ненецкий автономный округ',
  'Ярославская область',
];

export const transportColumns: Array<DataEntryColumn & { id: TransportModeId }> = [
  { id: 'hSR', label: 'ВСМ' },
  { id: 'airplane', label: 'Самолёт' },
  { id: 'suburbanTrain', label: 'Пригородный поезд' },
  { id: 'longDistanceTrain', label: 'Поезд дальнего следования' },
  { id: 'bus', label: 'Автобус' },
  { id: 'car', label: 'Личный автомобиль' },
];
const ALL_TRANSPORT_MODE_IDS = transportColumns.map((column) => column.id);

export const consumerRows: DataEntryRow[] = [
  { id: 'travelTime', label: 'Время в пути', helper: 'ч' },
  { id: 'dailyFrequency', label: 'Частота сообщения за сутки', helper: 'рейсов' },
  { id: 'fare', label: 'Средняя стоимость проезда', helper: 'руб.' },
];

export const discomfortRows: DataEntryRow[] = [
  { id: 'passengerDensity', label: 'Индекс плотности пассажиров в салоне' },
  { id: 'noiseVibrationTransfers', label: 'Индекс уровня шума, вибрация, плавности хода, пересадки' },
  { id: 'climateControl', label: 'Индекс качества работы климат-контроля, наличие неприятных запахов и пр.' },
  { id: 'additionalServices', label: 'Индекс объёма и качества дополнительных услуг, оказываемых пассажиру' },
  {
    id: 'technicalSafety',
    label: 'Индекс технической безопасности транспортного средства (индекс аварийности), предсказуемость в пути',
  },
  { id: 'personalSafety', label: 'Индекс личной безопасности (охрана, безопасность, вероятность кражи)' },
  { id: 'seatAvailability', label: 'Наличие свободных мест' },
  { id: 'ticketPurchaseComplexity', label: 'Сложность приобретения билета' },
  { id: 'comfortElasticity', label: 'Коэффициент эластичности к уровню комфорта' },
];

export const correspondenceTravelTimeRows: DataEntryRow[] = [
  { id: 'originAccess', label: 'Среднее время от центра города 1 до вокзала/автовокзала/аэропорта', helper: 'ЧЧ:ММ' },
  { id: 'waiting', label: 'Среднее время ожидания отправления транспортного средства', helper: 'ЧЧ:ММ' },
  { id: 'cleanTravel', label: 'Чистое время поездки', helper: 'ЧЧ:ММ' },
  { id: 'destinationAccess', label: 'Среднее время от вокзала/аэропорта до центра города 2', helper: 'ЧЧ:ММ' },
];

export const correspondenceOtherParameterRows: DataEntryRow[] = [
  { id: 'cityFareOrigin', label: 'Стоимость проезда по городу 1', helper: 'руб.' },
  { id: 'cityFareDestination', label: 'Стоимость проезда по городу 2', helper: 'руб.' },
  { id: 'carOccupancy', label: 'Наполняемость автомобиля', helper: 'чел.' },
  { id: 'annualWorkHours', label: 'Количество рабочих часов в году', helper: 'ч' },
  { id: 'gasolinePrice', label: 'Стоимость бензина АИ-92', helper: 'руб./л' },
  { id: 'gasolineConsumption', label: 'Расход бензина на 100 км', helper: 'л/100 км' },
  { id: 'carMaintenanceCostKm', label: 'Стоимость ОСАГО и ТО за 1 км', helper: 'руб./км' },
];

export const stationOtherParameterRows: DataEntryRow[] = [
  { id: 'cityFare', label: 'Стоимость проезда по городу', helper: 'руб.' },
  { id: 'carOccupancy', label: 'Наполняемость автомобиля', helper: 'чел.' },
  { id: 'annualWorkHours', label: 'Количество рабочих часов в году', helper: 'ч' },
  { id: 'gasolinePrice', label: 'Стоимость бензина АИ-92', helper: 'руб./л' },
  { id: 'gasolineConsumption', label: 'Расход бензина на 100 км', helper: 'л/100 км' },
  { id: 'carMaintenanceCostKm', label: 'Стоимость ОСАГО и ТО за 1 км', helper: 'руб./км' },
];

const defaultOtherParameterValues: Record<string, string> = {
  cityFareOrigin: '33',
  cityFareDestination: '75',
  carOccupancy: '1,3',
  annualWorkHours: '1973',
  gasolinePrice: '55',
  gasolineConsumption: '11',
  carMaintenanceCostKm: '1,75',
};

const defaultStationOtherParameterValues: Record<string, string> = {
  cityFare: '33',
  carOccupancy: defaultOtherParameterValues.carOccupancy,
  annualWorkHours: defaultOtherParameterValues.annualWorkHours,
  gasolinePrice: defaultOtherParameterValues.gasolinePrice,
  gasolineConsumption: defaultOtherParameterValues.gasolineConsumption,
  carMaintenanceCostKm: defaultOtherParameterValues.carMaintenanceCostKm,
};

const defaultOccupancyByMode: Partial<Record<TransportModeId, string>> = {
  hSR: '0,7',
  airplane: '0,95',
  suburbanTrain: '0,7',
  longDistanceTrain: '0,9',
  bus: '0,95',
  car: '1',
};

const defaultExistingDiscomfortValues: Partial<Record<TransportModeId, string[]>> = {
  hSR: ['0', '0', '0', '0', '0', '0', '0', '0', '1'],
  airplane: ['0', '0,8', '0,1', '0,4', '0,3', '0,1', '0,7', '1', '1'],
  suburbanTrain: ['0,6', '0,9', '0,5', '0,9', '0', '0,7', '0,3', '0,1', '1'],
  longDistanceTrain: ['0', '0,2', '0,4', '0,2', '0', '0,1', '0,9', '1', '1'],
  bus: ['0,5', '1', '0,8', '1', '0,6', '0,3', '0,7', '0', '1'],
  car: ['0', '0,2', '0', '1', '0,7', '0', '0', '0', '1'],
};

const defaultForecastDiscomfortValues: Record<TransportModeId, string[]> = {
  hSR: ['0', '0,1', '0,1', '0,1', '0', '0,1', '0,6', '0,3', '1'],
  airplane: ['0', '0,8', '0,1', '0,4', '0,3', '0,1', '0,7', '1', '1'],
  suburbanTrain: ['0,6', '0,9', '0,5', '0,9', '0', '0,7', '0,3', '0,1', '1'],
  longDistanceTrain: ['0', '0,2', '0,4', '0,2', '0', '0,1', '0,9', '1', '1'],
  bus: ['0,5', '1', '0,8', '1', '0,6', '0,3', '0,7', '0', '1'],
  car: ['0', '0,2', '0', '1', '0,9', '0', '0', '0', '1'],
};

export interface StationRouteDistance {
  fromLabel: StationLabel;
  toLabel: StationLabel;
  distanceKm: number;
}

interface StationRouteMark {
  label: StationLabel;
  distanceFromStartKm: number;
}

export const finalIndicators = [
  { id: 'lineLength', label: 'Протяженность участка', hint: 'Справочный диапазон уточняется по методичке', unit: 'км' },
  { id: 'maxSpeed', label: 'Максимальная скорость', hint: 'Справочный диапазон уточняется по методичке', unit: 'км/ч' },
  { id: 'gauge', label: 'Ширина колеи', hint: 'Значение уточняется по методичке', unit: 'мм' },
  { id: 'stationCount', label: 'Количество станций', hint: 'Проверьте с трассировкой' },
  { id: 'travelTime', label: 'Время в пути ВСМ', hint: 'Справочный диапазон уточняется по методичке' },
  { id: 'annualFlow', label: 'Годовой пассажиропоток', hint: 'Рассчитывается автоматически на шаге прогноза пассажиропотока' },
  { id: 'dailyTrains', label: 'Размеры движения N_сут', hint: 'Формула уточняется по методичке' },
  { id: 'maxCapacity', label: 'A_max', hint: 'Формула уточняется по методичке' },
  { id: 'rollingStockNeed', label: 'Потребный парк', hint: 'I_ВСМ, T_об и M уточняются по методичке' },
  { id: 'constructionCost', label: 'Затраты на строительство', hint: 'Диапазон цен уточняется по методичке' },
  { id: 'rollingStockCost', label: 'Затраты на подвижной состав', hint: 'Диапазон цен уточняется по методичке' },
  { id: 'ticketRevenue', label: 'Билетная выручка', hint: '0, 5, 10, 15, 20 годы' },
  { id: 'riskNotes', label: 'Ограничения и допущения', hint: 'Запишите, какие данные требуют уточнения' },
] as const;

export const passengerFlowRegionalFields: Array<{
  id: keyof Pz1PassengerFlowRegionalInputs;
  label: string;
  hint: string;
}> = [
  { id: 'grpCurrentRegionA', label: 'ВРП региона A', hint: 'Текущее значение, Росстат' },
  { id: 'grpCurrentRegionB', label: 'ВРП региона B', hint: 'Текущее значение, Росстат' },
  { id: 'grpGrowthPctRegionA', label: 'Рост ВРП региона A', hint: 'Доля: 0,12 = 12%' },
  { id: 'grpGrowthPctRegionB', label: 'Рост ВРП региона B', hint: 'Доля: 0,12 = 12%' },
  { id: 'populationCurrentRegionA', label: 'Население региона A', hint: 'Текущее значение, человек' },
  { id: 'populationCurrentRegionB', label: 'Население региона B', hint: 'Текущее значение, человек' },
  { id: 'populationGrowthPctRegionA', label: 'Рост населения региона A', hint: 'Доля: 0,01 = 1%' },
  { id: 'populationGrowthPctRegionB', label: 'Рост населения региона B', hint: 'Доля: 0,01 = 1%' },
  { id: 'gdpPassengerFlowCoefficientRegionA', label: 'Коэф. ВРП-потока A', hint: 'Из варианта задания' },
  { id: 'gdpPassengerFlowCoefficientRegionB', label: 'Коэф. ВРП-потока B', hint: 'Из варианта задания' },
  { id: 'inducedDemandPct', label: 'Индуцированный спрос', hint: 'Доля: 0,35 = 35%' },
];

export const passengerFlowModeRows: Array<DataEntryRow & { id: keyof Pz1PassengerFlowModeInputs }> = [
  { id: 'existingAnnualFlow', label: 'Существующий поток', helper: 'пасс./год' },
  { id: 'travelTimeHours', label: 'Время в пути в модели', helper: 'ч' },
  { id: 'waitingTimeHours', label: 'Время ожидания', helper: 'ч' },
  { id: 'totalTransportCost', label: 'TTC', helper: 'руб.' },
  { id: 'existingTravelTimeHours', label: 'Существующее время в пути', helper: 'ч' },
];

export const regionalCharacteristicFields: Array<{
  id: Exclude<keyof Pz1RegionalCharacteristicInputs, 'regionA' | 'regionB' | 'inducedDemandPct' | 'regionParameters'>;
  label: string;
  helper: string;
}> = [
  { id: 'grpExistingRegionA', label: 'ВРП региона 1, существующий', helper: 'млн руб.' },
  { id: 'grpForecastRegionA', label: 'ВРП региона 1, прогнозный', helper: 'млн руб.' },
  { id: 'populationExistingRegionA', label: 'Численность населения региона 1, существующая', helper: 'тыс. чел.' },
  { id: 'populationForecastRegionA', label: 'Численность населения региона 1, прогнозная', helper: 'тыс. чел.' },
  { id: 'averageSalaryRegionA', label: 'Средняя заработная плата региона 1', helper: 'руб./мес.' },
  { id: 'kGdpFlowRegionA', label: 'Коэффициент влияния ВВП на пассажиропоток региона 1', helper: 'безразм.' },
  { id: 'grpExistingRegionB', label: 'ВРП региона 2, существующий', helper: 'млн руб.' },
  { id: 'grpForecastRegionB', label: 'ВРП региона 2, прогнозный', helper: 'млн руб.' },
  { id: 'populationExistingRegionB', label: 'Численность населения региона 2, существующая', helper: 'тыс. чел.' },
  { id: 'populationForecastRegionB', label: 'Численность населения региона 2, прогнозная', helper: 'тыс. чел.' },
  { id: 'averageSalaryRegionB', label: 'Средняя заработная плата региона 2', helper: 'руб./мес.' },
  { id: 'kGdpFlowRegionB', label: 'Коэффициент влияния ВВП на пассажиропоток региона 2', helper: 'безразм.' },
];

/**
 * Определение индуцированного спроса — дословно из презентации заказчика
 * от 26.08.2026 (ТЗ v3.5 §3 П-06). Неразрывные пробелы после коротких союзов
 * и предлогов — по правилу русской типографики из architecture.md.
 */
export const INDUCED_DEMAND_TOOLTIP =
  'Дополнительный пассажиропоток, который возникает вследствие запуска новой линии ' +
  'и\u00A0не существовал бы при\u00A0её отсутствии.';

/**
 * `grouped: true` — показывать значение с разделителями разрядов при потере
 * фокуса (ТЗ v3.5 §3 П-05). Не проставлено у `kGdpFlow`: это безразмерный
 * коэффициент около единицы, разряды ему не нужны. Индуцированный спрос —
 * проценты, он вне этой таблицы и тоже без группировки.
 */
export const regionalParameterFields: Array<{
  id: keyof Pz1RegionalParameterInputs;
  label: string;
  helper: string;
  grouped?: boolean;
}> = [
  { id: 'grpExisting', label: 'ВРП, существующий', helper: 'млн руб.', grouped: true },
  { id: 'grpForecast', label: 'ВРП, прогнозный', helper: 'млн руб.', grouped: true },
  { id: 'populationExisting', label: 'Численность населения, существующая', helper: 'тыс. чел.', grouped: true },
  { id: 'populationForecast', label: 'Численность населения, прогнозная', helper: 'тыс. чел.', grouped: true },
  { id: 'averageSalary', label: 'Средняя заработная плата', helper: 'руб./мес.', grouped: true },
  { id: 'kGdpFlow', label: 'Коэффициент влияния ВВП на пассажиропоток', helper: 'безразм.' },
];

export function createInitialPz1Draft(importedBridge?: BridgeSchema | null): Pz1Draft {
  const importedPz1 = importedBridge?.completed.pz1;
  const selectedVariantId = String(importedBridge?.passport.defaultVariant ?? importedPz1?.variantId ?? '1');
  const variant = getVariantById(selectedVariantId);
  const stationDrafts = createStationDrafts(importedPz1?.stations ?? [], variant);

  return {
    passport: {
      team: importedBridge?.passport.team ?? '',
      lineTitle: importedBridge?.passport.lineTitle ?? '',
      createdAt: importedBridge?.passport.createdAt ?? new Date().toISOString(),
      // Свой проход — свой id. Загрузили файл — id берём из него, иначе
      // продолжение работы считалось бы новым проходом.
      runId: importedBridge?.passport.runId ?? createRunId(),
    },
    selectedVariantId,
    stationDrafts,
    routePointDrafts: createRoutePointDrafts(importedPz1?.routeLine),
    previewImage: importedPz1?.previewImage ?? '',
    correspondenceTables: syncCorrespondenceTables(
      {
        stationDrafts,
        correspondenceTables: mergeCorrespondenceTables(importedPz1?.consumerProperties),
      },
      stationDrafts,
    ),
    discomfortMatrix: mergeDiscomfortMatrix(importedPz1?.discomfortMatrix),
    hsrTravelTimes: mergeHsrTravelTimes(importedPz1?.hsrTravelTime),
    regionalCharacteristics: mergeRegionalCharacteristics(importedPz1?.regionalCharacteristics, stationDrafts, variant),
    stationOtherParameters: mergeStationOtherParameters(importedPz1?.stationOtherParameters),
    correspondenceDetails: syncCorrespondenceDetails(
      {
        stationDrafts,
        correspondenceDetails: mergeCorrespondenceDetails(importedPz1?.correspondenceScenarios),
      },
      stationDrafts,
    ),
    passengerFlowForecast: mergePassengerFlowForecast(importedPz1?.passengerFlowForecast?.inputs),
    finalIndicators: mergeFinalIndicators(importedPz1?.finalIndicators),
    notes: importedPz1?.notes ?? '',
  };
}

/**
 * Идентификатор прохода задания: дата, время и случайный хвост.
 *
 * Заказчик предложил собирать его из времени и названия команды. Название
 * берём не в id, а рядом в паспорте: команду студент правит в любой момент,
 * и id, завязанный на неё, менялся бы вместе с ней — именно то, чего от
 * идентификатора не ждут. Случайный хвост нужен, чтобы два прохода,
 * начатых в одну и ту же минуту, не совпали.
 */
export function createRunId(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const tail = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  return `${stamp}-${tail}`;
}

export function createPz1Bridge(draft: Pz1Draft, position?: ModulePosition): BridgeSchema {
  return createBridge(
    createPassport(draft),
    {
      pz1: createPz1Result(draft),
    },
    {
      pz1: {
        stations: isStationsStepComplete(draft),
        hsrTravelTime: isHsrTravelTimeComplete(draft),
        regionalCharacteristics: isRegionalCharacteristicsComplete(draft),
        consumerProperties: isConsumerPropertiesComplete(draft),
        passengerFlowForecast: isPassengerFlowForecastComplete(draft),
        finalIndicators: isFinalIndicatorsComplete(draft),
      },
    },
    position ? { pz1: position } : undefined,
  );
}

/**
 * Куда открывать задание после загрузки файла.
 *
 * Шаг ищется по стабильному id, поэтому файл, сохранённый до реордера шагов,
 * открывает тот же экран, а не тот же номер. Незнакомый id и файлы без позиции
 * дают интро — как было до появления поля.
 */
export function readPz1Position(bridge: BridgeSchema | null | undefined) {
  const position = bridge?.position?.pz1;

  if (!position || position.phase === 'intro' || !position.phase) {
    return null;
  }

  if (position.phase === 'result') {
    return { phase: 'result' as const, stepIndex: pz1StepIds.length - 1, theorySeen: true };
  }

  const stepIndex = position.stepId ? pz1StepIds.indexOf(position.stepId as Pz1StepId) : -1;

  if (stepIndex < 0) {
    return null;
  }

  return { phase: 'task' as const, stepIndex, theorySeen: position.theorySeen ?? true };
}

export function createPz1Result(draft: Pz1Draft): Pz1Result {
  const stations = draft.stationDrafts
    .filter((stationDraft) => stationDraft.enabled)
    .map(toStation)
    .filter((station): station is Pz1Station => station !== null);
  const routeLine = createRouteLine(draft.routePointDrafts);
  const metrics = computeRouteLineMetrics(routeLine);
  const correspondenceTables = getSyncedCorrespondenceTables(draft);
  const hsrTravelTime = getHsrTravelTimeResult(draft);
  const passengerFlowForecast = getPz1PassengerFlowForecast(draft);

  return {
    stations,
    routeLine,
    totalLengthKm: metrics.totalLengthKm,
    previewImage: draft.previewImage || undefined,
    variantId: draft.selectedVariantId,
    hsrTravelTime: hsrTravelTime ?? undefined,
    regionalCharacteristics: getPz1RegionalCharacteristics(draft),
    stationOtherParameters: cloneStationOtherParameters(draft.stationOtherParameters),
    correspondenceScenarios: getPz1CorrespondenceScenarios(draft),
    consumerProperties: correspondenceTables.reduce<Record<string, CorrespondenceTable>>((tables, table) => {
      tables[table.pairKey] = {
        pairKey: table.pairKey,
        activeModes: normalizeActiveTransportModes(table.activeModes),
        values: table.values,
      };
      return tables;
    }, {}),
    discomfortMatrix: cloneDiscomfortMatrix(draft.discomfortMatrix),
    passengerFlowForecast: passengerFlowForecast ?? undefined,
    finalIndicators: getComputedFinalIndicators(draft),
    notes: draft.notes,
  };
}

export function updateCellValue(
  values: Record<string, Record<string, string>>,
  rowId: string,
  columnId: string,
  value: string,
) {
  return {
    ...values,
    [rowId]: {
      ...(values[rowId] ?? {}),
      [columnId]: value,
    },
  };
}

export function sanitizeFileName(value: string, fallback: string) {
  const cleaned = value.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function createRouteLine(routePointDrafts: Pz1RoutePointDraft[]): RouteLine {
  const validRoutePoints = routePointDrafts
    .map((draft) => ({ draft, vertex: toRouteVertex(draft) }))
    .filter((point): point is { draft: Pz1RoutePointDraft; vertex: RouteLine['vertices'][number] } => point.vertex !== null);
  const vertices = validRoutePoints.map((point) => point.vertex);

  return {
    vertices,
    segments: validRoutePoints.slice(0, -1).map(({ draft, vertex }, index) => {
      const nextVertex = vertices[index + 1];

      return {
        id: `${vertex.id}-${nextVertex.id}`,
        fromVertexId: vertex.id,
        toVertexId: nextVertex.id,
        sagittaKm: getRouteSagittaKm(draft, vertex, nextVertex),
      };
    }),
  };
}

export function getRouteMetrics(draft: Pz1Draft) {
  return computeRouteLineMetrics(createRouteLine(draft.routePointDrafts));
}

export function getStationNameByLabel(draft: Pick<Pz1Draft, 'stationDrafts'>, label: StationLabel) {
  return draft.stationDrafts.find((station) => station.label === label)?.name.trim() || label;
}

export function getEnabledStationRegions(stationDrafts: Pz1StationDraft[]) {
  return [...new Set(stationDrafts.filter((station) => station.enabled).map((station) => station.region.trim()).filter(Boolean))];
}

export function getCorrespondenceTitle(draft: Pick<Pz1Draft, 'stationDrafts'>, fromLabel: StationLabel, toLabel: StationLabel) {
  return `${getStationNameByLabel(draft, fromLabel)} — ${getStationNameByLabel(draft, toLabel)}`;
}

export function getPz1RegionalCharacteristics(draft: Pick<Pz1Draft, 'regionalCharacteristics' | 'stationDrafts'>) {
  const initialStation = draft.stationDrafts.find((station) => station.label === 'А');
  const terminalStation = draft.stationDrafts.find((station) => station.label === 'Г');
  const baseRegional = {
    ...draft.regionalCharacteristics,
    regionA: initialStation?.region.trim() || draft.regionalCharacteristics.regionA,
    regionB: terminalStation?.region.trim() || draft.regionalCharacteristics.regionB,
  };

  return {
    ...baseRegional,
    regionParameters: mergeRegionParameters(baseRegional, getEnabledStationRegions(draft.stationDrafts)),
  };
}

export function getHsrTravelTimeResult(draft: Pick<Pz1Draft, 'hsrTravelTimes' | 'routePointDrafts' | 'stationDrafts'>) {
  const distances = getStationRouteDistances(draft);

  if (distances.length === 0) {
    return null;
  }

  const segments = distances.reduce<NonNullable<Pz1Result['hsrTravelTime']>['segments'] | null>((items, distance) => {
    if (items === null) {
      return null;
    }

    const speedKmh = parseNumericInput(draft.hsrTravelTimes[getDistanceKey(distance.fromLabel, distance.toLabel)]?.speedKmh ?? '');
    if (speedKmh === null || speedKmh <= 0) {
      return null;
    }

    items.push({
      fromLabel: distance.fromLabel,
      toLabel: distance.toLabel,
      distanceKm: distance.distanceKm,
      speedKmh,
      travelTimeMinutes: (distance.distanceKm / speedKmh) * 60 + HSR_ACCELERATION_MINUTES + HSR_BRAKING_MINUTES,
    });

    return items;
  }, []);

  if (!segments) {
    return null;
  }

  return {
    accelerationMinutes: HSR_ACCELERATION_MINUTES,
    brakingMinutes: HSR_BRAKING_MINUTES,
    totalMinutes: segments.reduce((sum, segment) => sum + segment.travelTimeMinutes, 0),
    segments,
  };
}

export function getSyncedCorrespondenceTables(draft: Pick<Pz1Draft, 'stationDrafts' | 'correspondenceTables'>) {
  return Object.values(syncCorrespondenceTables(draft, draft.stationDrafts));
}

export function getSyncedCorrespondenceDetails(draft: Pick<Pz1Draft, 'stationDrafts' | 'correspondenceDetails'>) {
  return Object.values(syncCorrespondenceDetails(draft, draft.stationDrafts));
}

export function syncCorrespondenceTables(
  draft: Pick<Pz1Draft, 'stationDrafts' | 'correspondenceTables'>,
  stationDrafts = draft.stationDrafts,
) {
  const enabledLabels = stationDrafts.filter((stationDraft) => stationDraft.enabled).map((stationDraft) => stationDraft.label);
  const tables: Record<string, Pz1CorrespondenceTableDraft> = {};

  for (let fromIndex = 0; fromIndex < enabledLabels.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < enabledLabels.length; toIndex += 1) {
      const fromLabel = enabledLabels[fromIndex];
      const toLabel = enabledLabels[toIndex];
      const pairKey = `${fromLabel}-${toLabel}`;
      const existingTable = draft.correspondenceTables[pairKey];
      tables[pairKey] = {
        pairKey,
        fromLabel,
        toLabel,
        activeModes: normalizeActiveTransportModes(existingTable?.activeModes ?? [...ALL_TRANSPORT_MODE_IDS]),
        values: mergeConsumerValues(existingTable?.values),
      };
    }
  }

  return tables;
}

export function syncCorrespondenceDetails(
  draft: Pick<Pz1Draft, 'stationDrafts' | 'correspondenceDetails'>,
  stationDrafts = draft.stationDrafts,
) {
  const enabledLabels = stationDrafts.filter((stationDraft) => stationDraft.enabled).map((stationDraft) => stationDraft.label);
  const details: Record<string, Pz1CorrespondenceDetailDraft> = {};

  for (let fromIndex = 0; fromIndex < enabledLabels.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < enabledLabels.length; toIndex += 1) {
      const fromLabel = enabledLabels[fromIndex];
      const toLabel = enabledLabels[toIndex];
      const pairKey = `${fromLabel}-${toLabel}`;
      details[pairKey] = mergeCorrespondenceDetail(pairKey, fromLabel, toLabel, draft.correspondenceDetails[pairKey]);
    }
  }

  return details;
}

/**
 * Сколько расчётных ячеек по корреспонденциям студент заполнил.
 *
 * Считается по `correspondenceDetails` — по тем самым таблицам, которые он
 * видит на шагах 04…08. Раньше счёт шёл по `correspondenceTables` и
 * `discomfortMatrix`: их заполнял отдельный экран «Потребительские свойства»,
 * которого после перехода на компоновку «страница на тему» в задании нет.
 * Писать в эти структуры стало некому, и в отчёте всегда стоял 0 — сколько бы
 * студент ни ввёл.
 *
 * Исключённые из корреспонденции виды транспорта в счёт не идут: их ячейки
 * студенту не показывают, и заполнить он их не может.
 */
export function countFilledConsumerCells(draft: Pz1Draft) {
  const isFilled = (value: string | undefined) => (value ?? '').trim().length > 0;
  const countSplit = (value: SplitTransportValue | undefined) =>
    (isFilled(value?.existing) ? 1 : 0) + (isFilled(value?.forecast) ? 1 : 0);

  return getSyncedCorrespondenceDetails(draft).reduce((total, detail) => {
    const activeModes = getActiveTransportModes(draft, detail.pairKey);

    const travelTimeCells = correspondenceTravelTimeRows.reduce(
      (sum, row) => sum + activeModes.reduce((rowSum, modeId) => rowSum + countSplit(detail.travelTime[row.id]?.[modeId]), 0),
      0,
    );

    const discomfortCells = discomfortRows.reduce(
      (sum, row) =>
        sum +
        activeModes.reduce(
          (rowSum, modeId) =>
            rowSum +
            (isFilled(detail.discomfortExisting.values[row.id]?.[modeId]) ? 1 : 0) +
            (isFilled(detail.discomfortForecast.values[row.id]?.[modeId]) ? 1 : 0),
          0,
        ),
      0,
    );

    const frequencyAndFareCells = activeModes.reduce(
      (sum, modeId) => sum + countSplit(detail.frequency[modeId]) + countSplit(detail.fare[modeId]),
      0,
    );

    const annualFlowCells = activeModes.reduce((sum, modeId) => {
      const flow = detail.annualFlows[modeId];

      return (
        sum +
        (isFilled(flow?.capacityExisting) ? 1 : 0) +
        (isFilled(flow?.capacityForecast) ? 1 : 0) +
        (isFilled(flow?.occupancyExisting) ? 1 : 0) +
        (isFilled(flow?.occupancyForecast) ? 1 : 0)
      );
    }, 0);

    return total + travelTimeCells + discomfortCells + frequencyAndFareCells + annualFlowCells;
  }, 0);
}

export function getPz1PassengerFlowForecast(draft: Pz1Draft): Pz1PassengerFlowResult | null {
  const correspondenceForecast = getAggregateCorrespondencePassengerFlowForecast(draft);

  if (correspondenceForecast) {
    return correspondenceForecast;
  }

  const effectiveInputs = getEffectivePassengerFlowInputs(draft);
  const regionalInput = parseRegionalPassengerFlowInput(effectiveInputs.regional);
  const modeInputs = passengerFlowModeIds.reduce<PassengerFlowModeInput[] | null>((modes, modeId) => {
    if (modes === null) {
      return null;
    }

    const mode = effectiveInputs.modes[modeId];
    const existingAnnualFlow = parseNumericInput(mode.existingAnnualFlow);
    const travelTimeHours = parseNumericInput(mode.travelTimeHours);
    const waitingTimeHours = parseNumericInput(mode.waitingTimeHours);
    const totalTransportCost = parseNumericInput(mode.totalTransportCost);
    const existingTravelTimeHours = parseNumericInput(mode.existingTravelTimeHours);

    if (
      existingAnnualFlow === null ||
      travelTimeHours === null ||
      waitingTimeHours === null ||
      totalTransportCost === null ||
      existingTravelTimeHours === null
    ) {
      return null;
    }

    modes.push({
      modeId,
      existingAnnualFlow,
      travelTimeHours,
      waitingTimeHours,
      totalTransportCost,
      existingTravelTimeHours,
    });

    return modes;
  }, []);

  if (!regionalInput || !modeInputs) {
    return null;
  }

  const existingAnnualFlow = modeInputs.reduce((sum, mode) => sum + mode.existingAnnualFlow, 0);

  if (existingAnnualFlow <= 0) {
    return null;
  }

  try {
    const totalDemand = forecastTotalDemand({
      existingAnnualFlow,
      ...regionalInput,
    });
    const distribution = distributePassengerFlowByMode({
      existingAnnualFlow,
      baseForecast: totalDemand.baseForecast,
      inducedDemand: totalDemand.inducedDemand,
      modes: modeInputs,
    });

    return {
      inputs: clonePassengerFlowInputs(effectiveInputs),
      totalDemand: {
        existingAnnualFlow,
        baseForecast: totalDemand.baseForecast,
        inducedDemand: totalDemand.inducedDemand,
        totalForecast: totalDemand.totalForecast,
        grpDelta: totalDemand.grpDelta,
        populationDelta: totalDemand.populationDelta,
        weightedGdpPassengerFlowCoefficient: totalDemand.weightedGdpPassengerFlowCoefficient,
      },
      modes: distribution.modes.map((mode) => ({
        modeId: mode.modeId,
        existingAnnualFlow: mode.existingAnnualFlow,
        forecastAnnualFlow: mode.forecastAnnualFlow,
        forecastShare: mode.forecastShare,
        directCapture: mode.directCapture,
        gravityCapture: mode.gravityCapture,
        inducedCapture: mode.inducedCapture,
      })),
    };
  } catch {
    return null;
  }
}

export function getEffectivePassengerFlowInputs(draft: Pz1Draft): Pz1Draft['passengerFlowForecast'] {
  const hsrTravelTime = getHsrTravelTimeResult(draft);
  const firstCorrespondenceTable = getSyncedCorrespondenceTables(draft)[0];
  const regional = mergeRegionalPassengerFlowInputs(
    deriveRegionalPassengerFlowInput(getPz1RegionalCharacteristics(draft)),
    draft.passengerFlowForecast.regional,
  );

  const modes = passengerFlowModeIds.reduce<Record<TransportModeId, Pz1PassengerFlowModeInputs>>((modeMap, modeId) => {
    const currentMode = draft.passengerFlowForecast.modes[modeId];
    const consumerTravelTime = firstCorrespondenceTable?.values.travelTime?.[modeId] ?? '';
    const consumerFrequency = firstCorrespondenceTable?.values.dailyFrequency?.[modeId] ?? '';
    const consumerFare = firstCorrespondenceTable?.values.fare?.[modeId] ?? '';
    const parsedFrequency = parseNumericInput(consumerFrequency);
    const fallbackWaitingTimeHours = parsedFrequency !== null && parsedFrequency > 0 ? formatDecimal(1 / parsedFrequency) : '';
    const hsrTravelTimeHours = hsrTravelTime ? formatDecimal(hsrTravelTime.totalMinutes / 60) : '';

    modeMap[modeId] = {
      existingAnnualFlow: currentMode.existingAnnualFlow,
      travelTimeHours:
        currentMode.travelTimeHours ||
        (modeId === HSR_MODE_ID ? hsrTravelTimeHours : consumerTravelTime),
      waitingTimeHours:
        currentMode.waitingTimeHours ||
        (modeId === CAR_MODE_ID ? '0' : fallbackWaitingTimeHours),
      totalTransportCost: currentMode.totalTransportCost || consumerFare,
      existingTravelTimeHours:
        currentMode.existingTravelTimeHours ||
        (modeId === HSR_MODE_ID ? '0' : consumerTravelTime),
    };

    return modeMap;
  }, {} as Record<TransportModeId, Pz1PassengerFlowModeInputs>);

  return {
    regional,
    modes,
  };
}

export function getPz1CorrespondenceScenarios(draft: Pz1Draft) {
  return getSyncedCorrespondenceDetails(draft).reduce<NonNullable<Pz1Result['correspondenceScenarios']>>((scenarios, detail) => {
    const annualFlows = transportColumns.reduce<NonNullable<Pz1Result['correspondenceScenarios']>[string]['annualFlows']>(
      (flowMap, column) => {
        const existingAnnualFlow = calculateAnnualFlow(
          detail.annualFlows[column.id].capacityExisting ?? detail.annualFlows[column.id].capacity,
          detail.annualFlows[column.id].occupancyExisting,
          detail.frequency[column.id].existing,
        );
        const forecastAnnualFlow = calculateAnnualFlow(
          detail.annualFlows[column.id].capacityForecast ?? detail.annualFlows[column.id].capacity,
          detail.annualFlows[column.id].occupancyForecast,
          detail.frequency[column.id].forecast,
        );

        flowMap[column.id] = {
          ...detail.annualFlows[column.id],
          existingAnnualFlow: existingAnnualFlow ?? undefined,
          forecastAnnualFlow: forecastAnnualFlow ?? undefined,
        };
        return flowMap;
      },
      {} as NonNullable<Pz1Result['correspondenceScenarios']>[string]['annualFlows'],
    );

    scenarios[detail.pairKey] = {
      pairKey: detail.pairKey,
      title: getCorrespondenceTitle(draft, detail.fromLabel, detail.toLabel),
      travelTime: getEffectiveTravelTimeValues(draft, detail),
      discomfortExisting: cloneDiscomfortMatrix(detail.discomfortExisting),
      discomfortForecast: cloneDiscomfortMatrix(detail.discomfortForecast),
      discomfortAggregates: transportColumns.reduce<NonNullable<Pz1Result['correspondenceScenarios']>[string]['discomfortAggregates']>(
        (aggregateMap, column) => {
          aggregateMap[column.id] = {
            existing: calculateDiscomfortAggregate(detail.discomfortExisting, column.id),
            forecast: calculateDiscomfortAggregate(detail.discomfortForecast, column.id),
          };
          return aggregateMap;
        },
        {} as NonNullable<Pz1Result['correspondenceScenarios']>[string]['discomfortAggregates'],
      ),
      frequency: detail.frequency,
      // Стоимость личного авто считается, а не вводится: в отчёт должна уйти
      // та же величина, что видит студент на экране, иначе в PDF на её месте
      // остаётся «не заполнено».
      fare: getEffectiveFareValues(draft, detail),
      otherParameters: getLegacyOtherParametersForCorrespondence(draft, detail),
      annualFlows,
      passengerFlowForecast: getPz1CorrespondencePassengerFlowForecast(draft, detail.pairKey) ?? undefined,
    };

    return scenarios;
  }, {});
}

export function getPz1CorrespondencePassengerFlowForecast(draft: Pz1Draft, pairKey: string): Pz1PassengerFlowResult | null {
  const detail = syncCorrespondenceDetails(draft)[pairKey];
  const table = syncCorrespondenceTables(draft)[pairKey];
  const regionalInput = getRegionalPassengerFlowInputForCorrespondence(draft, detail?.fromLabel, detail?.toLabel);

  if (!detail || !table || !regionalInput) {
    return null;
  }

  const effectiveTravelTime = getEffectiveTravelTimeValues(draft, detail);
  // Идём по ВСЕМ видам транспорта, а не только по активным (ТЗ v3.6 T-1):
  // исключённый вид остаётся строкой результата с нулями, а не выпадает из
  // массива. Если его выбросить, оставшиеся перенормируются между собой —
  // это и есть отменённое заказчиком «перераспределение долей».
  const modeInputs = ALL_TRANSPORT_MODE_IDS.reduce<PassengerFlowModeInput[] | null>((modes, modeId) => {
    if (modes === null) {
      return null;
    }

    if (!table.activeModes.includes(modeId)) {
      modes.push({
        modeId,
        existingAnnualFlow: 0,
        travelTimeHours: 0,
        waitingTimeHours: 0,
        totalTransportCost: 0,
        existingTravelTimeHours: 0,
        excluded: true,
      });

      return modes;
    }

    // Существующий поток авто считается не по рейсам, а от суммы остальных
    // видов — он подставляется вторым проходом ниже.
    const existingAnnualFlow =
      modeId === HSR_MODE_ID || modeId === CAR_MODE_ID
        ? 0
        : calculateAnnualFlow(
            detail.annualFlows[modeId].capacityExisting ?? detail.annualFlows[modeId].capacity,
            detail.annualFlows[modeId].occupancyExisting,
            detail.frequency[modeId].existing,
          );
    const forecastAnnualFlowInput = calculateAnnualFlow(
      detail.annualFlows[modeId].capacityForecast ?? detail.annualFlows[modeId].capacity,
      detail.annualFlows[modeId].occupancyForecast,
      detail.frequency[modeId].forecast,
    );
    const existingTravelTimeHours = getTravelTimeTotalHours(effectiveTravelTime, modeId, 'existing');
    const forecastTravelTimeHours = getTravelTimeTotalHours(effectiveTravelTime, modeId, 'forecast');
    // k1 в итоговой модели — именно «чистое время в пути». Время ожидания
    // входит отдельно как k2 = 18 / частота / 24, поэтому подмешивать сюда
    // весь путь (и затем ещё раз ожидание) нельзя.
    const forecastCleanTravelMinutes = parseDurationToMinutes(
      effectiveTravelTime.cleanTravel[modeId].forecast,
    );
    const forecastCleanTravelTimeHours =
      forecastCleanTravelMinutes === null ? null : forecastCleanTravelMinutes / 60;
    const discomfortAggregate = calculateDiscomfortAggregate(detail.discomfortForecast, modeId);
    const totalTransportCost =
      forecastTravelTimeHours === null ? null : getTotalTransportCost(draft, detail, modeId, forecastTravelTimeHours, discomfortAggregate);

    if (
      existingAnnualFlow === null ||
      forecastAnnualFlowInput === null ||
      existingTravelTimeHours === null ||
      forecastTravelTimeHours === null ||
      forecastCleanTravelTimeHours === null ||
      totalTransportCost === null ||
      totalTransportCost <= 0
    ) {
      return null;
    }

    modes.push({
      modeId,
      existingAnnualFlow,
      travelTimeHours: forecastCleanTravelTimeHours,
      waitingTimeHours: getWaitingTimeHours(detail, modeId),
      totalTransportCost,
      existingTravelTimeHours,
    });

    return modes;
  }, []);

  if (!modeInputs) {
    return null;
  }

  // Поток личного авто — сумма потоков остальных видов, умноженная на
  // наполняемость (документ заказчика «Расчет модели»). Поэтому он считается
  // вторым проходом: на первом остальные виды уже посчитаны.
  const flowWithoutCar = modeInputs.reduce(
    (sum, mode) => (mode.modeId === CAR_MODE_ID ? sum : sum + mode.existingAnnualFlow),
    0,
  );
  const carInput = modeInputs.find((mode) => mode.modeId === CAR_MODE_ID);
  if (carInput && !carInput.excluded) {
    carInput.existingAnnualFlow = flowWithoutCar * CAR_EXISTING_FLOW_MULTIPLIER;
  }

  const existingAnnualFlow = modeInputs.reduce((sum, mode) => sum + mode.existingAnnualFlow, 0);
  if (existingAnnualFlow <= 0) {
    return null;
  }

  try {
    const totalDemand = forecastTotalDemand({
      existingAnnualFlow,
      ...regionalInput,
    });
    const distribution = distributePassengerFlowByMode({
      existingAnnualFlow,
      baseForecast: totalDemand.baseForecast,
      inducedDemand: totalDemand.inducedDemand,
      modes: modeInputs,
    });

    return {
      inputs: {
        regional: getEffectivePassengerFlowInputs(draft).regional,
        modes: passengerFlowModeIds.reduce<Record<TransportModeId, Pz1PassengerFlowModeInputs>>((modeMap, modeId) => {
          const inputMode = modeInputs.find((mode) => mode.modeId === modeId);
          modeMap[modeId] = {
            existingAnnualFlow: inputMode ? String(inputMode.existingAnnualFlow) : '',
            travelTimeHours: inputMode ? String(inputMode.travelTimeHours) : '',
            waitingTimeHours: inputMode ? String(inputMode.waitingTimeHours) : '',
            totalTransportCost: inputMode ? String(inputMode.totalTransportCost) : '',
            existingTravelTimeHours: inputMode ? String(inputMode.existingTravelTimeHours) : '',
          };
          return modeMap;
        }, {} as Record<TransportModeId, Pz1PassengerFlowModeInputs>),
      },
      totalDemand: {
        existingAnnualFlow,
        baseForecast: totalDemand.baseForecast,
        inducedDemand: totalDemand.inducedDemand,
        totalForecast: totalDemand.totalForecast,
        grpDelta: totalDemand.grpDelta,
        populationDelta: totalDemand.populationDelta,
        weightedGdpPassengerFlowCoefficient: totalDemand.weightedGdpPassengerFlowCoefficient,
      },
      modes: distribution.modes.map((mode) => ({
        modeId: mode.modeId,
        existingAnnualFlow: mode.existingAnnualFlow,
        forecastAnnualFlow: mode.forecastAnnualFlow,
        forecastShare: mode.forecastShare,
        directCapture: mode.directCapture,
        gravityCapture: mode.gravityCapture,
        inducedCapture: mode.inducedCapture,
      })),
    };
  } catch {
    return null;
  }
}

function getAggregateCorrespondencePassengerFlowForecast(draft: Pz1Draft): Pz1PassengerFlowResult | null {
  const details = getSyncedCorrespondenceDetails(draft);
  if (details.length === 0) {
    return null;
  }

  const forecasts = details.map((detail) => getPz1CorrespondencePassengerFlowForecast(draft, detail.pairKey));
  if (forecasts.some((forecast) => forecast === null)) {
    return null;
  }

  const completedForecasts = forecasts.filter((forecast): forecast is Pz1PassengerFlowResult => forecast !== null);
  const totalForecastAnnualFlow = completedForecasts.reduce((sum, forecast) => sum + forecast.totalDemand.totalForecast, 0);
  const modes = passengerFlowModeIds.map((modeId) => {
    const modeForecasts = completedForecasts.map((forecast) => forecast.modes.find((mode) => mode.modeId === modeId));
    const existingAnnualFlow = modeForecasts.reduce((sum, mode) => sum + (mode?.existingAnnualFlow ?? 0), 0);
    const forecastAnnualFlow = modeForecasts.reduce((sum, mode) => sum + (mode?.forecastAnnualFlow ?? 0), 0);

    return {
      modeId,
      existingAnnualFlow,
      forecastAnnualFlow,
      forecastShare: totalForecastAnnualFlow > 0 ? forecastAnnualFlow / totalForecastAnnualFlow : 0,
      directCapture: modeForecasts.reduce((sum, mode) => sum + (mode?.directCapture ?? 0), 0),
      gravityCapture: modeForecasts.reduce((sum, mode) => sum + (mode?.gravityCapture ?? 0), 0),
      inducedCapture: modeForecasts.reduce((sum, mode) => sum + (mode?.inducedCapture ?? 0), 0),
    };
  });

  return {
    inputs: getEffectivePassengerFlowInputs(draft),
    totalDemand: {
      existingAnnualFlow: completedForecasts.reduce((sum, forecast) => sum + forecast.totalDemand.existingAnnualFlow, 0),
      baseForecast: completedForecasts.reduce((sum, forecast) => sum + forecast.totalDemand.baseForecast, 0),
      inducedDemand: completedForecasts.reduce((sum, forecast) => sum + forecast.totalDemand.inducedDemand, 0),
      totalForecast: totalForecastAnnualFlow,
      grpDelta: averageForecastMetric(completedForecasts, 'grpDelta'),
      populationDelta: averageForecastMetric(completedForecasts, 'populationDelta'),
      weightedGdpPassengerFlowCoefficient: averageForecastMetric(completedForecasts, 'weightedGdpPassengerFlowCoefficient'),
    },
    modes,
  };
}

export function getComputedFinalIndicators(draft: Pz1Draft): Record<string, string> {
  const passengerFlowForecast = getPz1PassengerFlowForecast(draft);
  const annualFlowFromCorrespondences = getAnnualFlowForecastFromCorrespondenceTables(draft);
  const hsrTravelTime = getHsrTravelTimeResult(draft);
  const enabledStationCount = draft.stationDrafts.filter((stationDraft) => stationDraft.enabled).length;
  const annualFlow = passengerFlowForecast?.totalDemand.totalForecast ?? annualFlowFromCorrespondences;

  return {
    ...draft.finalIndicators,
    stationCount: enabledStationCount > 0 ? String(enabledStationCount) : '',
    travelTime: hsrTravelTime ? formatDuration(hsrTravelTime.totalMinutes) : draft.finalIndicators.travelTime,
    annualFlow: annualFlow !== null ? formatInteger(annualFlow) : '',
  };
}

function getAnnualFlowForecastFromCorrespondenceTables(draft: Pz1Draft) {
  const details = syncCorrespondenceDetails(draft);
  const tables = syncCorrespondenceTables(draft);
  let totalAnnualFlow = 0;
  let hasCalculatedFlow = false;

  for (const [pairKey, detail] of Object.entries(details)) {
    const activeModes = tables[pairKey]?.activeModes ?? ALL_TRANSPORT_MODE_IDS;

    for (const modeId of activeModes) {
      const annualFlow = detail.annualFlows[modeId];
      const forecastAnnualFlow = calculateAnnualFlow(
        annualFlow.capacityForecast ?? annualFlow.capacity,
        annualFlow.occupancyForecast,
        detail.frequency[modeId].forecast,
      );

      if (forecastAnnualFlow !== null) {
        totalAnnualFlow += forecastAnnualFlow;
        hasCalculatedFlow = true;
      }
    }
  }

  return hasCalculatedFlow ? totalAnnualFlow : null;
}

/**
 * Порядок шагов задания ПЗ1 — единственный источник истины.
 * Компонент собирает шаги по этому списку, поэтому поменять порядок можно
 * только здесь, и счётчик «N из 10» съедет автоматически.
 *
 * «Прочие параметры» стоят перед «Частотой и стоимостью» не для красоты
 * (ТЗ v3.6 T-2): формула стоимости личного авто берёт расход бензина,
 * цену АИ-92 и ОСАГО с экрана прочих параметров. Если экран стоимости идёт
 * раньше — считать нечем.
 */
export const pz1StepIds = [
  'stations',
  'hsr-travel-time',
  'regional-characteristics',
  'correspondence-travel-time',
  'correspondence-discomfort',
  'station-other-parameters',
  'correspondence-frequency-fare',
  'annual-flow',
  'model',
  'final-indicators',
] as const;

export type Pz1StepId = (typeof pz1StepIds)[number];

export function getPz1TaskStepCount(draft: Pz1Draft) {
  void draft;
  return pz1StepIds.length;
}

/**
 * Ошибка поля «Название команды» на интро.
 *
 * Возвращает null, когда всё в порядке. Поле «Учебная группа» тут намеренно
 * не проверяется: по ТЗ v3.5 §3 П-01 оно свободное.
 */
export function validatePassportTeam(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Впишите название команды';
  }

  if (trimmed.length < PASSPORT_LIMITS.team.min) {
    return `Не короче ${PASSPORT_LIMITS.team.min} символов`;
  }

  if (trimmed.length > PASSPORT_LIMITS.team.max) {
    return `Не длиннее ${PASSPORT_LIMITS.team.max} символов`;
  }

  return null;
}

export function isPassportComplete(draft: Pz1Draft) {
  // Поле «Учебная группа» (draft.passport.lineTitle) свободное — валидация непустоты/уникальности
  // снята по ТЗ v3.5 §3 П-01, оно не блокирует переход к заданию.
  return (
    isLengthInRange(draft.passport.team, PASSPORT_LIMITS.team.min, PASSPORT_LIMITS.team.max) &&
    isVariantInRange(draft.selectedVariantId)
  );
}

export function validateConsumerCell(rowId: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Заполните это поле, чтобы продолжить';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Значение должно быть числом';
  }

  if (parsed < 0) {
    return 'Значение не может быть отрицательным';
  }

  if ((rowId === 'travelTime' || rowId === 'fare') && parsed <= 0) {
    return 'Значение должно быть больше 0';
  }

  if (rowId === 'travelTime' && parsed > 48) {
    return 'Время в пути должно быть не больше 48 ч';
  }

  if (rowId === 'dailyFrequency' && !Number.isInteger(parsed)) {
    return 'Частота сообщения за сутки должна быть целым числом';
  }

  return null;
}

export function validateDiscomfortCell(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Заполните это поле, чтобы продолжить';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Значение должно быть числом';
  }

  if (parsed < 0 || parsed > 1) {
    return 'Значение должно быть в диапазоне от 0 до 1';
  }

  return null;
}

export function validateHsrSpeed(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Укажите среднюю скорость перегона';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Скорость должна быть числом';
  }

  if (parsed <= 0) {
    return 'Скорость должна быть больше 0';
  }

  return null;
}

/**
 * Предупреждающая (не блокирующая) проверка скорости перегона, 50…400 км/ч
 * (ТЗ v3.6 T-5 / ТЗ v3.4 §БЗ-2). Значение вне диапазона допустимо — студент
 * должен увидеть предупреждение, но пройти дальше. Поэтому она отделена от
 * validateHsrSpeed, которая блокирует переход, и в isHsrTravelTimeComplete
 * намеренно не участвует.
 */
const HSR_SPEED_WARNING_RANGE = { min: 50, max: 400 };

export function warnHsrSpeed(value: string) {
  const parsed = parseNumericInput(value.trim());

  if (parsed === null) {
    return null;
  }

  if (parsed < HSR_SPEED_WARNING_RANGE.min || parsed > HSR_SPEED_WARNING_RANGE.max) {
    return `Скорость вне диапазона ${HSR_SPEED_WARNING_RANGE.min}…${HSR_SPEED_WARNING_RANGE.max} км/ч — проверьте значение`;
  }

  return null;
}

export function validateRegionalCharacteristicField(fieldId: keyof Pz1RegionalCharacteristicInputs, value: string) {
  if (fieldId === 'regionA' || fieldId === 'regionB') {
    return value.trim() ? null : 'Выберите регион';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 'Заполните поле';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Значение должно быть числом';
  }

  if (fieldId === 'inducedDemandPct') {
    return parsed >= 0 && parsed <= 100 ? null : 'Индуцированный спрос должен быть в диапазоне 0…100 %';
  }

  if (fieldId === 'kGdpFlowRegionA' || fieldId === 'kGdpFlowRegionB') {
    if (parsed <= 0) {
      return 'Коэффициент должен быть больше 0';
    }

    return null;
  }

  return parsed > 0 ? null : 'Значение должно быть больше 0';
}

export function validateRegionParameterField(fieldId: keyof Pz1RegionalParameterInputs, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Заполните поле';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Значение должно быть числом';
  }

  if (fieldId === 'kGdpFlow') {
    return parsed > 0 ? null : 'Коэффициент должен быть больше 0';
  }

  return parsed > 0 ? null : 'Значение должно быть больше 0';
}

export function validateOtherParameterField(fieldId: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Заполните поле';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Значение должно быть числом';
  }

  if (fieldId === 'cityFare' || fieldId === 'cityFareOrigin' || fieldId === 'cityFareDestination' || fieldId === 'carMaintenanceCostKm') {
    return parsed >= 0 ? null : 'Значение не может быть отрицательным';
  }

  return parsed > 0 ? null : 'Значение должно быть больше 0';
}

/**
 * Вместимость ВСМ, существующая — залочена на 0 (ТЗ v3.6 T-3), по той же
 * логике, что частота и стоимость ВСМ: линии ещё не существует, заполнять
 * нечего. Поле неактивно и не должно давать ошибку валидации.
 */
export function isAnnualFlowFieldLocked(fieldId: string, modeId: TransportModeId) {
  return modeId === HSR_MODE_ID && fieldId === 'capacityExisting';
}

export function validateAnnualFlowField(fieldId: string, value: string, modeId?: TransportModeId) {
  if (modeId && isAnnualFlowFieldLocked(fieldId, modeId)) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 'Заполните поле';
  }

  const parsed = parseNumericInput(trimmed);
  if (parsed === null) {
    return 'Значение должно быть числом';
  }

  if (fieldId === 'occupancyExisting' || fieldId === 'occupancyForecast') {
    return parsed > 0 && parsed <= 1 ? null : 'Коэффициент должен быть в диапазоне 0…1';
  }

  return parsed > 0 ? null : 'Значение должно быть больше 0';
}

/**
 * Заполнены ли потребительские свойства по всем корреспонденциям.
 *
 * Смотрит `correspondenceDetails` — таблицы шагов 04 и 05, которые студент
 * заполняет сейчас. Раньше проверялись `correspondenceTables` и
 * `discomfortMatrix` от экрана «Потребительские свойства», которого в задании
 * больше нет: писать в них стало некому, пустая ячейка проверку не проходит,
 * и в сохранённом мосте `progress.pz1.consumerProperties` стоял false при
 * любой заполненной работе.
 */
export function isConsumerPropertiesComplete(draft: Pz1Draft) {
  return getSyncedCorrespondenceDetails(draft).every((detail) => {
    const activeModes = getActiveTransportModes(draft, detail.pairKey);

    const travelTimeComplete = correspondenceTravelTimeRows.every((row) =>
      activeModes.every((modeId) => {
        const cell = detail.travelTime[row.id]?.[modeId];

        return !isDurationInvalid(cell?.existing ?? '') && !isDurationInvalid(cell?.forecast ?? '');
      }),
    );

    const discomfortComplete = discomfortRows.every((row) =>
      activeModes.every(
        (modeId) =>
          validateDiscomfortCell(detail.discomfortExisting.values[row.id]?.[modeId] ?? '') === null &&
          validateDiscomfortCell(detail.discomfortForecast.values[row.id]?.[modeId] ?? '') === null,
      ),
    );

    return travelTimeComplete && discomfortComplete;
  });
}

/**
 * Что не так с показателем. null — всё в порядке.
 *
 * Одна проверка и для перехода дальше, и для подписи под полем: раньше переход
 * блокировался молча, и понять, какое из тринадцати полей не нравится, было
 * нельзя — заказчик именно на это и наткнулся.
 */
export function validateFinalIndicator(
  id: (typeof finalIndicators)[number]['id'],
  value: string,
  draft: Pz1Draft,
): string | null {
  if (id === 'lineLength') {
    return getRouteMetrics(draft).totalLengthKm > 0 ? null : 'Проложите линию трассы на шаге со станциями';
  }

  if (id === 'annualFlow') {
    return null;
  }

  if (id === 'stationCount') {
    return draft.stationDrafts.some((stationDraft) => stationDraft.enabled)
      ? null
      : 'Включите хотя бы одну станцию на шаге со станциями';
  }

  if (id === 'travelTime') {
    return getHsrTravelTimeResult(draft) !== null ? null : 'Заполните скорости на шаге времени в пути';
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return 'Заполните это поле, чтобы продолжить';
  }

  if (id === 'riskNotes') {
    return null;
  }

  // Билетная выручка — не одно число: подпись под полем просит её по годам
  // 0, 5, 10, 15, 20. Принимаем список, разделители не важны.
  if (id === 'ticketRevenue') {
    const parts = splitNumberList(trimmed);

    if (parts.length === 0 || parts.some((part) => part === null)) {
      return 'Нужны числа по годам, например: 16; 20; 27; 34; 45';
    }

    return parts.every((part) => (part ?? 0) > 0) ? null : 'Выручка должна быть больше нуля';
  }

  const parsed = parseNumericInput(trimmed);

  if (parsed === null) {
    return 'Нужно число без единиц измерения, например 644';
  }

  return parsed > 0 ? null : 'Значение должно быть больше нуля';
}

/** Список чисел через запятую, точку с запятой или пробел. */
function splitNumberList(value: string): (number | null)[] {
  return value
    .split(/[;,\n]+|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseNumericInput(part));
}

export function isFinalIndicatorsComplete(draft: Pz1Draft) {
  return finalIndicators.every(
    (indicator) => validateFinalIndicator(indicator.id, draft.finalIndicators[indicator.id] ?? '', draft) === null,
  );
}

export function isPassengerFlowForecastComplete(draft: Pz1Draft) {
  return getPz1PassengerFlowForecast(draft) !== null;
}

export function isHsrTravelTimeComplete(draft: Pz1Draft) {
  return getHsrTravelTimeResult(draft) !== null;
}

export function isRegionalCharacteristicsComplete(draft: Pz1Draft) {
  const regional = getPz1RegionalCharacteristics(draft);
  const stationRegions = getEnabledStationRegions(draft.stationDrafts);

  return (
    stationRegions.length > 0 &&
    stationRegions.every((region) => {
      const parameters = regional.regionParameters?.[region];
      return parameters && regionalParameterFields.every((field) => validateRegionParameterField(field.id, parameters[field.id]) === null);
    }) &&
    validateRegionalCharacteristicField('inducedDemandPct', regional.inducedDemandPct) === null
  );
}

export function isStationsStepComplete(draft: Pz1Draft) {
  const enabledStations = draft.stationDrafts.filter((stationDraft) => stationDraft.enabled);
  const routeLine = createRouteLine(draft.routePointDrafts);
  const duplicateStationNames = getDuplicateStationNames(draft);

  return (
    TERMINAL_LABELS.every((label) => enabledStations.some((stationDraft) => stationDraft.label === label)) &&
    enabledStations.every((stationDraft) => isStationDraftComplete(stationDraft, duplicateStationNames)) &&
    routeLine.vertices.length >= 2
  );
}

export function isTransportModeRemovable(modeId: TransportModeId) {
  return modeId !== HSR_MODE_ID;
}

/**
 * Исключение вида транспорта из корреспонденции (ТЗ v3.3 T-07, восстановлено
 * по ТЗ v3.5 §4). Состояние живёт в `correspondenceTables[pairKey].activeModes`
 * — том же поле схемы моста, которое УЖЕ учитывают расчёты: и прогон модели
 * (`getPz1CorrespondencePassengerFlowForecast`), и агрегат годового потока
 * ходят только по активным видам. Поэтому исключённый вид обязан пропадать
 * со всех таблиц корреспонденции, а не только с той, где нажали крестик:
 * иначе студент заполнял бы поля, которые молча не попадают в расчёт.
 */
export function getActiveTransportModes(
  draft: Pz1Draft,
  pairKey: string,
): TransportModeId[] {
  return syncCorrespondenceTables(draft)[pairKey]?.activeModes ?? [...ALL_TRANSPORT_MODE_IDS];
}

export function getActiveTransportColumns(draft: Pz1Draft, pairKey: string) {
  const activeModes = getActiveTransportModes(draft, pairKey);
  return transportColumns.filter((column) => activeModes.includes(column.id));
}

export function getExcludedTransportColumns(draft: Pz1Draft, pairKey: string) {
  const activeModes = getActiveTransportModes(draft, pairKey);
  return transportColumns.filter((column) => !activeModes.includes(column.id));
}

/** Точечная правка таблицы корреспонденции — как `patchCorrespondenceDetail`, но для `correspondenceTables`. */
export function patchCorrespondenceTable(
  draft: Pz1Draft,
  pairKey: string,
  patch: Partial<Pz1CorrespondenceTableDraft>,
): Pz1Draft {
  const syncedTables = syncCorrespondenceTables(draft);
  const currentTable = syncedTables[pairKey];

  if (!currentTable) {
    return draft;
  }

  return {
    ...draft,
    correspondenceTables: {
      ...syncedTables,
      [pairKey]: { ...currentTable, ...patch },
    },
  };
}

export function excludeTransportMode(draft: Pz1Draft, pairKey: string, modeId: TransportModeId): Pz1Draft {
  if (!isTransportModeRemovable(modeId)) {
    return draft;
  }

  const activeModes = getActiveTransportModes(draft, pairKey).filter((activeModeId) => activeModeId !== modeId);

  return patchCorrespondenceTable(draft, pairKey, { activeModes });
}

export function restoreTransportMode(draft: Pz1Draft, pairKey: string, modeId: TransportModeId): Pz1Draft {
  // normalize возвращает виды в каноническом порядке колонок — вернувшийся
  // столбец встаёт на своё прежнее место, а не в конец таблицы.
  const activeModes = normalizeActiveTransportModes([...getActiveTransportModes(draft, pairKey), modeId]);

  return patchCorrespondenceTable(draft, pairKey, { activeModes });
}

export function getDuplicateStationNames(draft: Pick<Pz1Draft, 'stationDrafts'>) {
  const counts = new Map<string, number>();

  for (const station of draft.stationDrafts) {
    if (!station.enabled) {
      continue;
    }

    const nameKey = normalizeStationName(station.name);
    if (!nameKey) {
      continue;
    }

    counts.set(nameKey, (counts.get(nameKey) ?? 0) + 1);
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
}

export function validateStationField(
  stationDraft: Pz1StationDraft,
  field: 'name' | 'lat' | 'lng' | 'region',
  duplicateStationNames = new Set<string>(),
) {
  if (!stationDraft.enabled) {
    return null;
  }

  if (field === 'name') {
    if (!stationDraft.name.trim()) {
      return 'Укажите название станции';
    }

    if (duplicateStationNames.has(normalizeStationName(stationDraft.name))) {
      return 'Название станции должно быть уникальным';
    }

    return null;
  }

  if (field === 'region') {
    if (!stationDraft.region.trim()) {
      return 'Выберите регион станции';
    }

    if (!russianRegions.includes(stationDraft.region.trim())) {
      return 'Выберите регион из списка субъектов РФ';
    }

    return null;
  }

  if (field === 'lat') {
    return validateCoordinateField(stationDraft.lat, -90, 90, 'Широта');
  }

  return validateCoordinateField(stationDraft.lng, -180, 180, 'Долгота');
}

export function getStationRouteDistances(draft: Pick<Pz1Draft, 'routePointDrafts' | 'stationDrafts'>): StationRouteDistance[] {
  const stationsOnRoute = getStationRouteMarks(draft);

  return stationsOnRoute.slice(0, -1).map((station, index) => ({
    fromLabel: station.label,
    toLabel: stationsOnRoute[index + 1].label,
    distanceKm: Math.max(0, stationsOnRoute[index + 1].distanceFromStartKm - station.distanceFromStartKm),
  }));
}

/**
 * Отметки станций на трассе с расстоянием от начала.
 *
 * Мерная лента — та же, что у виджета «Длина трассы» (ТЗ v3.6 T-7). Раньше
 * здесь суммировались гаверсинусы по ломаной из 48 точек на дугу, а виджет
 * брал аналитическую длину дуги из computeRouteLineMetrics. Вписанная ломаная
 * всегда короче дуги, поэтому одна и та же трасса показывалась двумя числами
 * (на скриншотах заказчика 246,18 против 246,22 км).
 *
 * Ломаная по-прежнему нужна, чтобы понять, ГДЕ на трассе стоит станция, но
 * расстояния по каждому сегменту масштабируются к его аналитической длине.
 * Масштаб посегментный, а не общий: стрела прогиба у сегментов разная, и
 * общий коэффициент врал бы на промежуточных станциях.
 */
function getStationRouteMarks(draft: Pick<Pz1Draft, 'routePointDrafts' | 'stationDrafts'>): StationRouteMark[] {
  const routeLine = createRouteLine(draft.routePointDrafts);
  const routePoints = buildDisplayRoutePoints(routeLine, 48);
  if (routePoints.length < 2) {
    return [];
  }

  const segmentArcLengthById = new Map(
    computeRouteLineMetrics(routeLine).segments.map((segment) => [segment.segmentId, segment.arcLengthKm]),
  );
  const cumulativeDistances: number[] = [0];

  buildRoutePointsBySegment(routeLine, 48).forEach((segmentPoints, segmentIndex) => {
    if (segmentPoints.length < 2) {
      return;
    }

    const stepDistances = segmentPoints.slice(1).map((point, index) => haversineDistanceKm(segmentPoints[index], point));
    const polylineLengthKm = stepDistances.reduce((sum, step) => sum + step, 0);
    const arcLengthKm = segmentArcLengthById.get(routeLine.segments[segmentIndex]?.id) ?? polylineLengthKm;
    const scale = polylineLengthKm > 0 ? arcLengthKm / polylineLengthKm : 1;

    for (const step of stepDistances) {
      cumulativeDistances.push(cumulativeDistances[cumulativeDistances.length - 1] + step * scale);
    }
  });
  const stationsOnRoute = draft.stationDrafts
    .filter((stationDraft) => stationDraft.enabled)
    .map(toStation)
    .filter((station): station is Pz1Station => station !== null)
    .map((station) => ({
      label: station.label,
      distanceFromStartKm: cumulativeDistances[getNearestRoutePointIndex({ lon: station.lng, lat: station.lat }, routePoints)],
    }))
    .sort((left, right) => left.distanceFromStartKm - right.distanceFromStartKm);

  return stationsOnRoute;
}

function getCorrespondenceDistanceKm(draft: Pz1Draft, fromLabel: StationLabel, toLabel: StationLabel) {
  const marks = getStationRouteMarks(draft);
  const fromMark = marks.find((mark) => mark.label === fromLabel);
  const toMark = marks.find((mark) => mark.label === toLabel);

  if (!fromMark || !toMark) {
    return null;
  }

  return Math.abs(toMark.distanceFromStartKm - fromMark.distanceFromStartKm);
}

function createPassport(draft: Pz1Draft): Passport {
  const parsedVariant = Number(draft.selectedVariantId);

  return {
    team: draft.passport.team,
    lineTitle: draft.passport.lineTitle,
    defaultVariant: Number.isInteger(parsedVariant) ? parsedVariant : undefined,
    createdAt: draft.passport.createdAt,
    runId: draft.passport.runId,
  };
}

function createStationDrafts(stations: Pz1Station[], variant = getVariantById('1')): Pz1StationDraft[] {
  return STATION_LABELS.map((label) => {
    const importedStation = stations.find((station) => station.label === label);
    const type = getStationType(label);
    const defaultName = label === 'А' ? variant.fromCity : label === 'Г' ? variant.toCity : '';
    const defaultRegion = label === 'А' ? variant.fromRegion : label === 'Г' ? variant.toRegion : '';

    return {
      label,
      enabled: TERMINAL_LABELS.includes(label) || importedStation !== undefined,
      name: importedStation?.name ?? defaultName,
      lat: importedStation ? String(importedStation.lat) : '',
      lng: importedStation ? String(importedStation.lng) : '',
      type,
      region: importedStation?.region ?? defaultRegion,
    };
  });
}

function createRoutePointDrafts(routeLine: Pz1Result['routeLine'] | Array<[number, number]> | undefined): Pz1RoutePointDraft[] {
  if (!routeLine) {
    return [];
  }

  if (Array.isArray(routeLine)) {
    return routeLine.map(([lng, lat], index) => ({
      id: `route-point-${index}`,
      lat: String(lat),
      lng: String(lng),
      sagittaToNextKm: '0',
      bendM: '0',
    }));
  }

  const segmentByVertexId = new Map(routeLine.segments.map((segment) => [segment.fromVertexId, segment]));
  const vertexById = new Map(routeLine.vertices.map((vertex) => [vertex.id, vertex]));

  return routeLine.vertices.map((vertex) => ({
    id: vertex.id,
    lat: String(vertex.lat),
    lng: String(vertex.lon),
    sagittaToNextKm: String(segmentByVertexId.get(vertex.id)?.sagittaKm ?? 0),
    bendM: getRouteRadiusMeters(vertex, segmentByVertexId, vertexById),
  }));
}

function mergeCorrespondenceTables(importedValues: Pz1Result['consumerProperties']) {
  if (!importedValues) {
    return {};
  }

  return Object.entries(importedValues).reduce<Record<string, Pz1CorrespondenceTableDraft>>((tables, [pairKey, table]) => {
    const [fromLabel = 'А', toLabel = 'Г'] = pairKey.split('-') as StationLabel[];
    tables[pairKey] = {
      pairKey,
      fromLabel,
      toLabel,
      activeModes: normalizeActiveTransportModes(table.activeModes.length > 0 ? table.activeModes : [...ALL_TRANSPORT_MODE_IDS]),
      values: mergeConsumerValues(table.values),
    };
    return tables;
  }, {});
}

function mergeCorrespondenceDetails(importedValues: Pz1Result['correspondenceScenarios']) {
  if (!importedValues) {
    return {};
  }

  return Object.entries(importedValues).reduce<Record<string, Pz1CorrespondenceDetailDraft>>((details, [pairKey, scenario]) => {
    const [fromLabel = 'А', toLabel = 'Г'] = pairKey.split('-') as StationLabel[];
    details[pairKey] = mergeCorrespondenceDetail(pairKey, fromLabel, toLabel, {
      pairKey,
      fromLabel,
      toLabel,
      travelTime: scenario.travelTime,
      discomfortExisting: scenario.discomfortExisting,
      discomfortForecast: scenario.discomfortForecast,
      frequency: scenario.frequency,
      fare: scenario.fare,
      otherParameters: scenario.otherParameters,
      annualFlows: scenario.annualFlows,
    });
    return details;
  }, {});
}

function mergeCorrespondenceDetail(
  pairKey: string,
  fromLabel: StationLabel,
  toLabel: StationLabel,
  importedDetail?: Partial<Pz1CorrespondenceDetailDraft>,
): Pz1CorrespondenceDetailDraft {
  return {
    pairKey,
    fromLabel,
    toLabel,
    travelTime: mergeSplitRowValues(correspondenceTravelTimeRows, importedDetail?.travelTime, getDefaultTravelTimeValue),
    discomfortExisting: mergeDiscomfortMatrix(importedDetail?.discomfortExisting, defaultExistingDiscomfortValues),
    discomfortForecast: mergeDiscomfortMatrix(importedDetail?.discomfortForecast, defaultForecastDiscomfortValues),
    frequency: mergeSplitTransportValues(importedDetail?.frequency, getDefaultFrequencyValue),
    fare: mergeSplitTransportValues(importedDetail?.fare, getDefaultFareValue),
    otherParameters: correspondenceOtherParameterRows.reduce<Record<string, string>>((values, row) => {
      values[row.id] = importedDetail?.otherParameters?.[row.id] ?? defaultOtherParameterValues[row.id] ?? '';
      return values;
    }, {}),
    annualFlows: transportColumns.reduce<Pz1CorrespondenceDetailDraft['annualFlows']>((values, column) => {
      values[column.id] = {
        capacity: importedDetail?.annualFlows?.[column.id]?.capacity ?? '',
        // Существующая вместимость ВСМ залочена на 0 (ТЗ v3.6 T-3) — кладём 0
        // в черновик, чтобы в JSON-мост уходил ноль, а не пустая строка.
        capacityExisting: isAnnualFlowFieldLocked('capacityExisting', column.id)
          ? '0'
          : importedDetail?.annualFlows?.[column.id]?.capacityExisting ?? importedDetail?.annualFlows?.[column.id]?.capacity ?? '',
        capacityForecast:
          importedDetail?.annualFlows?.[column.id]?.capacityForecast ?? importedDetail?.annualFlows?.[column.id]?.capacity ?? '',
        occupancyExisting: importedDetail?.annualFlows?.[column.id]?.occupancyExisting ?? defaultOccupancyByMode[column.id] ?? '',
        occupancyForecast: importedDetail?.annualFlows?.[column.id]?.occupancyForecast ?? defaultOccupancyByMode[column.id] ?? '',
      };
      return values;
    }, {} as Pz1CorrespondenceDetailDraft['annualFlows']),
  };
}

function mergeStationOtherParameters(importedValues?: Pz1Result['stationOtherParameters']) {
  return STATION_LABELS.reduce<Pz1Draft['stationOtherParameters']>((stationMap, label) => {
    const defaultValues = getDefaultStationOtherParameterValues(label);
    stationMap[label] = stationOtherParameterRows.reduce<Record<string, string>>((values, row) => {
      values[row.id] = importedValues?.[label]?.[row.id] ?? defaultValues[row.id] ?? '';
      return values;
    }, {});
    return stationMap;
  }, {} as Pz1Draft['stationOtherParameters']);
}

function getDefaultStationOtherParameterValues(label: StationLabel): Record<string, string> {
  return {
    ...defaultStationOtherParameterValues,
    cityFare: label === 'Г' ? defaultOtherParameterValues.cityFareDestination : defaultOtherParameterValues.cityFareOrigin,
  };
}

function mergeSplitRowValues(
  rows: DataEntryRow[],
  importedValues: Record<string, Record<TransportModeId, { existing: string; forecast: string }>> | undefined,
  getDefaultValue: (rowId: string, modeId: TransportModeId) => { existing: string; forecast: string },
) {
  return rows.reduce<Record<string, Record<TransportModeId, { existing: string; forecast: string }>>>((rowMap, row) => {
    rowMap[row.id] = transportColumns.reduce<Record<TransportModeId, { existing: string; forecast: string }>>(
      (columnMap, column) => {
        const defaultValue = getDefaultValue(row.id, column.id);
        columnMap[column.id] = {
          existing: importedValues?.[row.id]?.[column.id]?.existing ?? defaultValue.existing,
          forecast: importedValues?.[row.id]?.[column.id]?.forecast ?? defaultValue.forecast,
        };
        return columnMap;
      },
      {} as Record<TransportModeId, { existing: string; forecast: string }>,
    );
    return rowMap;
  }, {});
}

function mergeSplitTransportValues(
  importedValues: Record<TransportModeId, { existing: string; forecast: string }> | undefined,
  getDefaultValue: (modeId: TransportModeId) => { existing: string; forecast: string },
) {
  return transportColumns.reduce<Record<TransportModeId, { existing: string; forecast: string }>>((values, column) => {
    const defaultValue = getDefaultValue(column.id);
    values[column.id] = {
      existing: importedValues?.[column.id]?.existing ?? defaultValue.existing,
      forecast: importedValues?.[column.id]?.forecast ?? defaultValue.forecast,
    };
    return values;
  }, {} as Record<TransportModeId, { existing: string; forecast: string }>);
}

function getDefaultTravelTimeValue(rowId: string, modeId: TransportModeId) {
  if (modeId === CAR_MODE_ID && rowId !== 'cleanTravel') {
    return { existing: '00:00', forecast: '00:00' };
  }

  if (modeId === HSR_MODE_ID) {
    return { existing: '00:00', forecast: rowId === 'cleanTravel' ? '' : '' };
  }

  return { existing: '', forecast: '' };
}

function getDefaultFrequencyValue(modeId: TransportModeId) {
  if (modeId === HSR_MODE_ID) {
    return { existing: '0', forecast: '' };
  }

  if (modeId === CAR_MODE_ID) {
    return { existing: '0', forecast: '0' };
  }

  return { existing: '', forecast: '' };
}

function getDefaultFareValue(modeId: TransportModeId) {
  if (modeId === HSR_MODE_ID) {
    return { existing: '0', forecast: '' };
  }

  return { existing: '', forecast: '' };
}

function mergeConsumerValues(importedValues?: Record<string, Record<string, string>>) {
  const values = createEmptyConsumerValues();

  for (const row of consumerRows) {
    for (const column of transportColumns) {
      values[row.id][column.id] = importedValues?.[row.id]?.[column.id] ?? '';
    }
  }

  return values;
}

function mergePassengerFlowForecast(importedValues?: Pz1PassengerFlowInputs) {
  const regional = passengerFlowRegionalFields.reduce<Pz1PassengerFlowRegionalInputs>((values, field) => {
    values[field.id] = importedValues?.regional?.[field.id] ?? '';
    return values;
  }, createEmptyRegionalPassengerFlowInputs());

  const modes = passengerFlowModeIds.reduce<Record<TransportModeId, Pz1PassengerFlowModeInputs>>((modeMap, modeId) => {
    const importedMode = importedValues?.modes?.[modeId];
    modeMap[modeId] = passengerFlowModeRows.reduce<Pz1PassengerFlowModeInputs>((values, row) => {
      values[row.id] = importedMode?.[row.id] ?? '';
      return values;
    }, createEmptyModePassengerFlowInputs());
    return modeMap;
  }, {} as Record<TransportModeId, Pz1PassengerFlowModeInputs>);

  return {
    regional,
    modes,
  };
}

function mergeHsrTravelTimes(importedValue?: Pz1Result['hsrTravelTime']) {
  return (
    importedValue?.segments.reduce<Record<string, Pz1HsrSpeedDraft>>((speedMap, segment) => {
      speedMap[getDistanceKey(segment.fromLabel, segment.toLabel)] = { speedKmh: String(segment.speedKmh) };
      return speedMap;
    }, {}) ?? {}
  );
}

function mergeRegionalCharacteristics(
  importedValue: Pz1Result['regionalCharacteristics'],
  stationDrafts: Pz1StationDraft[],
  variant = getVariantById('1'),
): Pz1RegionalCharacteristicInputs {
  const initialStation = stationDrafts.find((station) => station.label === 'А');
  const terminalStation = stationDrafts.find((station) => station.label === 'Г');
  const emptyValue = createEmptyRegionalCharacteristics(variant, initialStation?.region, terminalStation?.region);
  const mergedValue = {
    ...emptyValue,
    ...importedValue,
    regionA: importedValue?.regionA ?? initialStation?.region ?? emptyValue.regionA,
    regionB: importedValue?.regionB ?? terminalStation?.region ?? emptyValue.regionB,
  };

  return {
    ...mergedValue,
    regionParameters: mergeRegionParameters(mergedValue, getEnabledStationRegions(stationDrafts)),
  };
}

function createEmptyRegionalCharacteristics(
  variant = getVariantById('1'),
  regionA = variant.fromRegion,
  regionB = variant.toRegion,
): Pz1RegionalCharacteristicInputs {
  return {
    regionA,
    regionB,
    grpExistingRegionA: '',
    grpExistingRegionB: '',
    grpForecastRegionA: '',
    grpForecastRegionB: '',
    populationExistingRegionA: '',
    populationExistingRegionB: '',
    populationForecastRegionA: '',
    populationForecastRegionB: '',
    averageSalaryRegionA: '',
    averageSalaryRegionB: '',
    kGdpFlowRegionA: '',
    kGdpFlowRegionB: '',
    inducedDemandPct: '',
    regionParameters: {
      [regionA]: createEmptyRegionParameter(),
      [regionB]: createEmptyRegionParameter(),
    },
  };
}

function createEmptyRegionParameter(): Pz1RegionalParameterInputs {
  return {
    grpExisting: '',
    grpForecast: '',
    populationExisting: '',
    populationForecast: '',
    averageSalary: '',
    kGdpFlow: '',
  };
}

function mergeRegionParameters(input: Pz1RegionalCharacteristicInputs, stationRegions: string[]) {
  const regionParameters: Record<string, Pz1RegionalParameterInputs> = {
    ...(input.regionParameters ?? {}),
  };

  if (input.regionA) {
    regionParameters[input.regionA] = mergeRegionParameter(regionParameters[input.regionA], {
      grpExisting: input.grpExistingRegionA,
      grpForecast: input.grpForecastRegionA,
      populationExisting: input.populationExistingRegionA,
      populationForecast: input.populationForecastRegionA,
      averageSalary: input.averageSalaryRegionA,
      kGdpFlow: input.kGdpFlowRegionA,
    });
  }

  if (input.regionB) {
    regionParameters[input.regionB] = mergeRegionParameter(regionParameters[input.regionB], {
      grpExisting: input.grpExistingRegionB,
      grpForecast: input.grpForecastRegionB,
      populationExisting: input.populationExistingRegionB,
      populationForecast: input.populationForecastRegionB,
      averageSalary: input.averageSalaryRegionB,
      kGdpFlow: input.kGdpFlowRegionB,
    });
  }

  for (const region of stationRegions) {
    regionParameters[region] = mergeRegionParameter(regionParameters[region]);
  }

  return regionParameters;
}

function mergeRegionParameter(
  currentValue?: Pz1RegionalParameterInputs,
  fallbackValue: Partial<Pz1RegionalParameterInputs> = {},
): Pz1RegionalParameterInputs {
  const emptyValue = createEmptyRegionParameter();

  return regionalParameterFields.reduce<Pz1RegionalParameterInputs>((values, field) => {
    const currentFieldValue = currentValue?.[field.id] ?? '';
    values[field.id] = currentFieldValue.trim() ? currentFieldValue : fallbackValue[field.id] ?? emptyValue[field.id];
    return values;
  }, createEmptyRegionParameter());
}

function deriveRegionalPassengerFlowInput(input: Pz1RegionalCharacteristicInputs): Pz1PassengerFlowRegionalInputs {
  const regionAParameters = input.regionParameters?.[input.regionA];
  const regionBParameters = input.regionParameters?.[input.regionB];

  if (regionAParameters && regionBParameters) {
    return {
      grpCurrentRegionA: regionAParameters.grpExisting,
      grpCurrentRegionB: regionBParameters.grpExisting,
      grpGrowthPctRegionA: deriveGrowthPct(regionAParameters.grpExisting, regionAParameters.grpForecast),
      grpGrowthPctRegionB: deriveGrowthPct(regionBParameters.grpExisting, regionBParameters.grpForecast),
      populationCurrentRegionA: regionAParameters.populationExisting,
      populationCurrentRegionB: regionBParameters.populationExisting,
      populationGrowthPctRegionA: deriveGrowthPct(regionAParameters.populationExisting, regionAParameters.populationForecast),
      populationGrowthPctRegionB: deriveGrowthPct(regionBParameters.populationExisting, regionBParameters.populationForecast),
      gdpPassengerFlowCoefficientRegionA: regionAParameters.kGdpFlow,
      gdpPassengerFlowCoefficientRegionB: regionBParameters.kGdpFlow,
      inducedDemandPct: formatDecimal((parseNumericInput(input.inducedDemandPct) ?? Number.NaN) / 100),
    };
  }

  return {
    grpCurrentRegionA: input.grpExistingRegionA,
    grpCurrentRegionB: input.grpExistingRegionB,
    grpGrowthPctRegionA: deriveGrowthPct(input.grpExistingRegionA, input.grpForecastRegionA),
    grpGrowthPctRegionB: deriveGrowthPct(input.grpExistingRegionB, input.grpForecastRegionB),
    populationCurrentRegionA: input.populationExistingRegionA,
    populationCurrentRegionB: input.populationExistingRegionB,
    populationGrowthPctRegionA: deriveGrowthPct(input.populationExistingRegionA, input.populationForecastRegionA),
    populationGrowthPctRegionB: deriveGrowthPct(input.populationExistingRegionB, input.populationForecastRegionB),
    gdpPassengerFlowCoefficientRegionA: input.kGdpFlowRegionA,
    gdpPassengerFlowCoefficientRegionB: input.kGdpFlowRegionB,
    inducedDemandPct: formatDecimal((parseNumericInput(input.inducedDemandPct) ?? Number.NaN) / 100),
  };
}

function getRegionalPassengerFlowInputForCorrespondence(
  draft: Pz1Draft,
  fromLabel: StationLabel | undefined,
  toLabel: StationLabel | undefined,
) {
  if (!fromLabel || !toLabel) {
    return null;
  }

  const fromRegion = draft.stationDrafts.find((station) => station.label === fromLabel)?.region.trim();
  const toRegion = draft.stationDrafts.find((station) => station.label === toLabel)?.region.trim();
  const regional = getPz1RegionalCharacteristics(draft);
  const fromParameters = fromRegion ? regional.regionParameters?.[fromRegion] : undefined;
  const toParameters = toRegion ? regional.regionParameters?.[toRegion] : undefined;

  if (!fromParameters || !toParameters) {
    return parseRegionalPassengerFlowInput(getEffectivePassengerFlowInputs(draft).regional);
  }

  return parseRegionalPassengerFlowInput({
    grpCurrentRegionA: fromParameters.grpExisting,
    grpCurrentRegionB: toParameters.grpExisting,
    grpGrowthPctRegionA: deriveGrowthPct(fromParameters.grpExisting, fromParameters.grpForecast),
    grpGrowthPctRegionB: deriveGrowthPct(toParameters.grpExisting, toParameters.grpForecast),
    populationCurrentRegionA: fromParameters.populationExisting,
    populationCurrentRegionB: toParameters.populationExisting,
    populationGrowthPctRegionA: deriveGrowthPct(fromParameters.populationExisting, fromParameters.populationForecast),
    populationGrowthPctRegionB: deriveGrowthPct(toParameters.populationExisting, toParameters.populationForecast),
    gdpPassengerFlowCoefficientRegionA: fromParameters.kGdpFlow,
    gdpPassengerFlowCoefficientRegionB: toParameters.kGdpFlow,
    inducedDemandPct: formatDecimal((parseNumericInput(regional.inducedDemandPct) ?? Number.NaN) / 100),
  });
}

function mergeRegionalPassengerFlowInputs(
  derivedInput: Pz1PassengerFlowRegionalInputs,
  manualInput: Pz1PassengerFlowRegionalInputs,
): Pz1PassengerFlowRegionalInputs {
  return passengerFlowRegionalFields.reduce<Pz1PassengerFlowRegionalInputs>((values, field) => {
    values[field.id] = manualInput[field.id].trim() ? manualInput[field.id] : derivedInput[field.id];
    return values;
  }, createEmptyRegionalPassengerFlowInputs());
}

function deriveGrowthPct(existingValue: string, forecastValue: string) {
  const existing = parseNumericInput(existingValue);
  const forecast = parseNumericInput(forecastValue);

  if (existing === null || forecast === null || existing <= 0) {
    return '';
  }

  return formatDecimal(forecast / existing - 1);
}

function createEmptyRegionalPassengerFlowInputs(): Pz1PassengerFlowRegionalInputs {
  return {
    grpCurrentRegionA: '',
    grpCurrentRegionB: '',
    grpGrowthPctRegionA: '',
    grpGrowthPctRegionB: '',
    populationCurrentRegionA: '',
    populationCurrentRegionB: '',
    populationGrowthPctRegionA: '',
    populationGrowthPctRegionB: '',
    gdpPassengerFlowCoefficientRegionA: '',
    gdpPassengerFlowCoefficientRegionB: '',
    inducedDemandPct: '',
  };
}

function createEmptyModePassengerFlowInputs(): Pz1PassengerFlowModeInputs {
  return {
    existingAnnualFlow: '',
    travelTimeHours: '',
    waitingTimeHours: '',
    totalTransportCost: '',
    existingTravelTimeHours: '',
  };
}

function clonePassengerFlowInputs(input: Pz1Draft['passengerFlowForecast']): Pz1PassengerFlowInputs {
  return {
    regional: { ...input.regional },
    modes: passengerFlowModeIds.reduce<Record<TransportModeId, Pz1PassengerFlowModeInputs>>((modeMap, modeId) => {
      modeMap[modeId] = { ...input.modes[modeId] };
      return modeMap;
    }, {} as Record<TransportModeId, Pz1PassengerFlowModeInputs>),
  };
}

function cloneStationOtherParameters(input: Pz1Draft['stationOtherParameters']): Pz1Draft['stationOtherParameters'] {
  return STATION_LABELS.reduce<Pz1Draft['stationOtherParameters']>((stationMap, label) => {
    stationMap[label] = stationOtherParameterRows.reduce<Record<string, string>>((values, row) => {
      values[row.id] = input[label]?.[row.id] ?? '';
      return values;
    }, {});
    return stationMap;
  }, {} as Pz1Draft['stationOtherParameters']);
}

function getRouteSagittaKm(
  routePointDraft: Pz1RoutePointDraft,
  fromVertex: RouteLine['vertices'][number],
  toVertex: RouteLine['vertices'][number],
) {
  const radiusMeters = parseNumericInput(routePointDraft.bendM ?? '');

  if (radiusMeters !== null) {
    const chordKm = haversineDistanceKm(fromVertex, toVertex);
    return computeSagittaFromRadius(chordKm, radiusMeters / 1000);
  }

  return Math.max(0, parseCoordinate(routePointDraft.sagittaToNextKm) ?? 0);
}

function getRouteRadiusMeters(
  vertex: RouteLine['vertices'][number],
  segmentByVertexId: Map<string, RouteLine['segments'][number]>,
  vertexById: Map<string, RouteLine['vertices'][number]>,
) {
  const segment = segmentByVertexId.get(vertex.id);
  const targetVertex = segment ? vertexById.get(segment.toVertexId) : undefined;

  if (!segment || !targetVertex) {
    return '0';
  }

  const chordKm = haversineDistanceKm(vertex, targetVertex);
  const radiusKm = computeArcMetrics(chordKm, segment.sagittaKm).radiusKm;

  return radiusKm === null ? '0' : formatDecimal(radiusKm * 1000);
}

function getEffectiveTravelTimeValues(draft: Pz1Draft, detail: Pz1CorrespondenceDetailDraft) {
  const hsrTravelTime = getHsrTravelTimeResult(draft);
  const hsrCleanTime = hsrTravelTime ? formatDuration(hsrTravelTime.totalMinutes) : detail.travelTime.cleanTravel.hSR.forecast;

  return correspondenceTravelTimeRows.reduce<Pz1CorrespondenceDetailDraft['travelTime']>((rows, row) => {
    rows[row.id] = transportColumns.reduce<Pz1CorrespondenceDetailDraft['travelTime'][string]>((values, column) => {
      const currentValue = detail.travelTime[row.id][column.id];
      values[column.id] = {
        existing:
          column.id === HSR_MODE_ID || (column.id === CAR_MODE_ID && row.id !== 'cleanTravel')
            ? '00:00'
            : currentValue.existing,
        forecast:
          column.id === HSR_MODE_ID && row.id === 'cleanTravel'
            ? hsrCleanTime
            : column.id === CAR_MODE_ID && row.id !== 'cleanTravel'
              ? '00:00'
              : currentValue.forecast,
      };
      return values;
    }, {} as Pz1CorrespondenceDetailDraft['travelTime'][string]);
    return rows;
  }, {} as Pz1CorrespondenceDetailDraft['travelTime']);
}

function calculateAnnualFlow(capacityValue: string, occupancyValue: string, frequencyValue: string) {
  const capacity = parseNumericInput(capacityValue);
  const occupancy = parseNumericInput(occupancyValue);
  const frequency = parseNumericInput(frequencyValue);

  if (capacity === null || occupancy === null || frequency === null || capacity < 0 || occupancy < 0 || frequency < 0) {
    return null;
  }

  return 365 * capacity * occupancy * frequency;
}

function calculateDiscomfortAggregate(matrix: Pz1DiscomfortMatrix, modeId: TransportModeId) {
  const values = discomfortRows.slice(0, 8).map((row) => parseNumericInput(matrix.values[row.id]?.[modeId] ?? ''));

  if (values.some((value) => value === null)) {
    return null;
  }

  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length;
}

function getTravelTimeTotalHours(
  travelTime: Pz1CorrespondenceDetailDraft['travelTime'],
  modeId: TransportModeId,
  side: 'existing' | 'forecast',
) {
  const totalMinutes = correspondenceTravelTimeRows.reduce<number | null>((sum, row) => {
    if (sum === null) {
      return null;
    }

    const minutes = parseDurationToMinutes(travelTime[row.id][modeId][side]);
    return minutes === null ? null : sum + minutes;
  }, 0);

  return totalMinutes === null ? null : totalMinutes / 60;
}

/**
 * Существующая стоимость проезда на личном автомобиле — вычисляется, а не
 * вводится студентом (подтверждено заказчиком 31.08).
 *
 * Расстояние — по корреспонденции, через getCorrespondenceDistanceKm.
 *
 * ДОПУЩЕНИЕ: «Прочие параметры» с 26.08 задаются по станциям, и у двух
 * станций одного перегона цена бензина или ОСАГО могут отличаться. Чьи брать
 * — заказчик не ответил (ТЗ v3.6 §3, вопрос 2). Берём среднее по двум
 * станциям корреспонденции тем же помощником, что уже используется в расчёте
 * TTC, чтобы поведение внутри модуля было одинаковым. На значениях по
 * умолчанию, одинаковых у всех станций, среднее совпадает с любым из них.
 */
export function getCarExistingFare(draft: Pz1Draft, pairKey: string): number | null {
  const detail = getSyncedCorrespondenceDetails(draft).find((item) => item.pairKey === pairKey);

  if (!detail) {
    return null;
  }

  const distanceKm = getCorrespondenceDistanceKm(draft, detail.fromLabel, detail.toLabel);
  const gasolinePrice = getAverageStationOtherParameterNumber(draft, detail, 'gasolinePrice', detail.otherParameters.gasolinePrice);
  const gasolineConsumption = getAverageStationOtherParameterNumber(
    draft,
    detail,
    'gasolineConsumption',
    detail.otherParameters.gasolineConsumption,
  );
  const carMaintenanceCostKm = getAverageStationOtherParameterNumber(
    draft,
    detail,
    'carMaintenanceCostKm',
    detail.otherParameters.carMaintenanceCostKm,
  );

  if (distanceKm === null || gasolinePrice === null || gasolineConsumption === null || carMaintenanceCostKm === null) {
    return null;
  }

  return calculateCarTravelCost({
    fuelConsumptionPer100Km: gasolineConsumption,
    fuelPricePerLitre: gasolinePrice,
    maintenanceCostPerKm: carMaintenanceCostKm,
    distanceKm,
  });
}

/**
 * Стоимость проезда корреспонденции с подставленным расчётом по личному авто.
 *
 * Селектор, а не запись в черновик: производные величины по архитектуре
 * считаются на чтение, иначе значение пришлось бы держать в состоянии и
 * синхронизировать при каждой правке прочих параметров или трассы.
 *
 * - существующая стоимость авто — всегда расчётная;
 * - прогнозная по умолчанию равна существующей (заказчик, 31.08), но если
 *   студент ввёл своё значение, побеждает оно.
 *
 * Этим же селектором обязаны пользоваться проверки заполненности: раньше они
 * читали сырой черновик, видели у авто пустую строку и сообщали «стоимость
 * Личный автомобиль, существующая» как незаполненное поле, блокируя модель.
 */
/**
 * Прогнозная стоимость поездки на авто: введённое студентом значение
 * побеждает, иначе берётся расчётная (она же существующая).
 *
 * Единственное место, где живёт это правило. Им пользуются и подстановка в
 * поле, и расчёт TTC — иначе на экране было бы одно число, а в модели другое.
 *
 * Почему поле вообще влияет на расчёт: у всех остальных видов транспорта TTC
 * считается по прогнозной стоимости, и авто не должно быть исключением.
 * «Прочие параметры» одноразрядные — отдельной прогнозной цены бензина там
 * нет, поэтому это поле остаётся единственным способом заложить в прогноз
 * подорожание топлива.
 */
export function getCarForecastFare(draft: Pz1Draft, detail: Pz1CorrespondenceDetailDraft): number | null {
  const enteredValue = parseNumericInput(detail.fare[CAR_MODE_ID].forecast);

  return enteredValue ?? getCarExistingFare(draft, detail.pairKey);
}

export function getEffectiveFareValues(
  draft: Pz1Draft,
  detail: Pz1CorrespondenceDetailDraft,
): Pz1CorrespondenceDetailDraft['fare'] {
  const carCost = getCarExistingFare(draft, detail.pairKey);

  if (carCost === null) {
    return detail.fare;
  }

  const computed = formatMoneyInput(carCost);

  return {
    ...detail.fare,
    [CAR_MODE_ID]: {
      existing: computed,
      forecast: detail.fare[CAR_MODE_ID].forecast.trim() ? detail.fare[CAR_MODE_ID].forecast : computed,
    },
  };
}

function getTotalTransportCost(
  draft: Pz1Draft,
  detail: Pz1CorrespondenceDetailDraft,
  modeId: TransportModeId,
  travelTimeHours: number,
  discomfortAggregate: number | null,
) {
  const fare = parseNumericInput(detail.fare[modeId].forecast);
  const cityFareOrigin = getStationOtherParameterNumber(draft, detail.fromLabel, 'cityFare', detail.otherParameters.cityFareOrigin);
  const cityFareDestination = getStationOtherParameterNumber(draft, detail.toLabel, 'cityFare', detail.otherParameters.cityFareDestination);
  const timeCost = getTravelTimeMonetaryCost(draft, detail, modeId, travelTimeHours, discomfortAggregate);

  if (timeCost === null) {
    return null;
  }

  if (modeId === CAR_MODE_ID) {
    // Прогнозная стоимость поездки: введённая студентом, иначе расчётная.
    // Городские тарифы к авто не прибавляются — поездка идёт от двери до
    // двери, городским транспортом человек не пользуется.
    const carCost = getCarForecastFare(draft, detail);
    const discomfortSurcharge = discomfortAggregate ?? 0;

    if (carCost !== null) {
      // Та же структура k3, что и у остальных видов: стоимость, время и
      // надбавка на дискомфорт от стоимости.
      return carCost + timeCost + carCost * discomfortSurcharge;
    }

    return fare === null ? null : fare + timeCost + fare * discomfortSurcharge;
  }

  if (fare === null || cityFareOrigin === null || cityFareDestination === null) {
    return null;
  }

  // k3 = k3_1 + k3_2 × k3_3 из документа заказчика: к сумме «стоимость плюс
  // время» добавляется ещё стоимость, взвешенная коэффициентом дискомфорта.
  const totalFare = fare + cityFareOrigin + cityFareDestination;

  return totalFare + timeCost + totalFare * (discomfortAggregate ?? 0);
}

/**
 * Среднее время ожидания отправления: период обслуживания, делённый на частоту
 * сообщения (документ заказчика, k2 = 18 / частота / 24 — деление на 24 там
 * переводит в сутки, у нас величина хранится в часах).
 *
 * У личного автомобиля ожидания нет — сел и поехал.
 */
function getWaitingTimeHours(detail: Pz1CorrespondenceDetailDraft, modeId: TransportModeId) {
  if (modeId === CAR_MODE_ID) {
    return 0;
  }

  const frequency = parseNumericInput(detail.frequency[modeId].forecast);

  return frequency !== null && frequency > 0 ? SERVICE_WINDOW_HOURS / frequency : 0;
}

function getTravelTimeMonetaryCost(
  draft: Pz1Draft,
  detail: Pz1CorrespondenceDetailDraft,
  modeId: TransportModeId,
  travelTimeHours: number,
  discomfortAggregate: number | null,
) {
  const hourlyWage = getAverageHourlyWageForCorrespondence(draft, detail);
  const frequencyFactor = getFrequencyFactor(detail, modeId);

  if (hourlyWage === null || frequencyFactor === null || discomfortAggregate === null) {
    return null;
  }

  // Дискомфорт входит множителем (сумма коэффициентов / 8), а не как (1 + …):
  // так задано в документе заказчика, k3_1_2.
  return hourlyWage * travelTimeHours * discomfortAggregate * frequencyFactor;
}

function getAverageHourlyWageForCorrespondence(draft: Pz1Draft, detail: Pz1CorrespondenceDetailDraft) {
  const annualWorkHours = getAverageStationOtherParameterNumber(draft, detail, 'annualWorkHours', detail.otherParameters.annualWorkHours);
  const regional = getPz1RegionalCharacteristics(draft);
  const endpointRegions = [detail.fromLabel, detail.toLabel]
    .map((label) => draft.stationDrafts.find((station) => station.label === label)?.region.trim())
    .filter((region): region is string => Boolean(region));
  const uniqueRegions = [...new Set(endpointRegions)];
  const regionRows = uniqueRegions.map((region) => ({
    salary: parseNumericInput(regional.regionParameters?.[region]?.averageSalary ?? ''),
    forecastPopulation: parseNumericInput(regional.regionParameters?.[region]?.populationForecast ?? ''),
  }));

  if (
    annualWorkHours === null ||
    annualWorkHours <= 0 ||
    regionRows.some(
      ({ salary, forecastPopulation }) =>
        salary === null || salary <= 0 || forecastPopulation === null || forecastPopulation <= 0,
    )
  ) {
    return null;
  }

  // k3_1_2_4: средняя зарплата регионов, взвешенная на их прогнозную
  // численность населения. Простое среднее, которое было здесь раньше,
  // расходилось с таблицей заказчика при регионах разного размера.
  const typedRows = regionRows as Array<{ salary: number; forecastPopulation: number }>;
  const forecastPopulationTotal = typedRows.reduce(
    (sum, row) => sum + row.forecastPopulation,
    0,
  );
  const weightedAverageMonthlySalary =
    typedRows.reduce(
      (sum, row) => sum + row.salary * row.forecastPopulation,
      0,
    ) / forecastPopulationTotal;

  return (weightedAverageMonthlySalary * 12) / annualWorkHours;
}

function getLegacyOtherParametersForCorrespondence(draft: Pz1Draft, detail: Pz1CorrespondenceDetailDraft) {
  return {
    cityFareOrigin: getStationOtherParameterValue(draft, detail.fromLabel, 'cityFare', detail.otherParameters.cityFareOrigin),
    cityFareDestination: getStationOtherParameterValue(draft, detail.toLabel, 'cityFare', detail.otherParameters.cityFareDestination),
    carOccupancy: getAverageStationOtherParameterValue(draft, detail, 'carOccupancy', detail.otherParameters.carOccupancy),
    annualWorkHours: getAverageStationOtherParameterValue(draft, detail, 'annualWorkHours', detail.otherParameters.annualWorkHours),
    gasolinePrice: getAverageStationOtherParameterValue(draft, detail, 'gasolinePrice', detail.otherParameters.gasolinePrice),
    gasolineConsumption: getAverageStationOtherParameterValue(draft, detail, 'gasolineConsumption', detail.otherParameters.gasolineConsumption),
    carMaintenanceCostKm: getAverageStationOtherParameterValue(
      draft,
      detail,
      'carMaintenanceCostKm',
      detail.otherParameters.carMaintenanceCostKm,
    ),
  };
}

function getStationOtherParameterValue(draft: Pz1Draft, label: StationLabel, fieldId: string, fallback = '') {
  return draft.stationOtherParameters[label]?.[fieldId] ?? fallback;
}

function getStationOtherParameterNumber(draft: Pz1Draft, label: StationLabel, fieldId: string, fallback = '') {
  return parseNumericInput(getStationOtherParameterValue(draft, label, fieldId, fallback));
}

function getAverageStationOtherParameterValue(
  draft: Pz1Draft,
  detail: Pz1CorrespondenceDetailDraft,
  fieldId: string,
  fallback = '',
) {
  const values = [detail.fromLabel, detail.toLabel]
    .map((label) => getStationOtherParameterNumber(draft, label, fieldId))
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return fallback;
  }

  return formatDecimal(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getAverageStationOtherParameterNumber(
  draft: Pz1Draft,
  detail: Pz1CorrespondenceDetailDraft,
  fieldId: string,
  fallback = '',
) {
  return parseNumericInput(getAverageStationOtherParameterValue(draft, detail, fieldId, fallback));
}

function getFrequencyFactor(detail: Pz1CorrespondenceDetailDraft, modeId: TransportModeId) {
  if (modeId === CAR_MODE_ID) {
    return 1;
  }

  const frequency = parseNumericInput(detail.frequency[modeId].forecast);
  return frequency !== null && frequency > 0 ? 1 / frequency : null;
}

function averageForecastMetric(
  forecasts: Pz1PassengerFlowResult[],
  metric: 'grpDelta' | 'populationDelta' | 'weightedGdpPassengerFlowCoefficient',
) {
  if (forecasts.length === 0) {
    return 0;
  }

  return forecasts.reduce((sum, forecast) => sum + forecast.totalDemand[metric], 0) / forecasts.length;
}

function cloneDiscomfortMatrix(matrix: Pz1DiscomfortMatrix): Pz1DiscomfortMatrix {
  return {
    values: discomfortRows.reduce<Record<string, Record<TransportModeId, string>>>((rowMap, row) => {
      rowMap[row.id] = transportColumns.reduce<Record<TransportModeId, string>>(
        (columnMap, column) => {
          columnMap[column.id] = matrix.values[row.id]?.[column.id] ?? '';
          return columnMap;
        },
        {} as Record<TransportModeId, string>,
      );
      return rowMap;
    }, {}),
  };
}

function mergeDiscomfortMatrix(
  importedMatrix?: Pz1Result['discomfortMatrix'],
  defaultValues?: Partial<Record<TransportModeId, string[]>>,
): Pz1DiscomfortMatrix {
  return {
    values: discomfortRows.reduce<Record<string, Record<TransportModeId, string>>>((rowMap, row, rowIndex) => {
      rowMap[row.id] = transportColumns.reduce<Record<TransportModeId, string>>(
        (columnMap, column) => {
          columnMap[column.id] = importedMatrix?.values?.[row.id]?.[column.id] ?? defaultValues?.[column.id]?.[rowIndex] ?? '';
          return columnMap;
        },
        {} as Record<TransportModeId, string>,
      );
      return rowMap;
    }, {}),
  };
}

function createEmptyConsumerValues() {
  return consumerRows.reduce<Record<string, Record<string, string>>>((rowMap, row) => {
    rowMap[row.id] = transportColumns.reduce<Record<string, string>>((columnMap, column) => {
      columnMap[column.id] = '';
      return columnMap;
    }, {});
    return rowMap;
  }, {});
}

function mergeFinalIndicators(importedValues: Pz1Result['finalIndicators']) {
  return finalIndicators.reduce<Record<string, string>>((values, indicator) => {
    values[indicator.id] = indicator.id === 'annualFlow' ? '' : importedValues?.[indicator.id] ?? '';
    return values;
  }, {});
}

function parseRegionalPassengerFlowInput(
  input: Pz1PassengerFlowRegionalInputs,
): Omit<TotalDemandForecastInput, 'existingAnnualFlow'> | null {
  const grpCurrentRegionA = parseNumericInput(input.grpCurrentRegionA);
  const grpCurrentRegionB = parseNumericInput(input.grpCurrentRegionB);
  const grpGrowthPctRegionA = parseNumericInput(input.grpGrowthPctRegionA);
  const grpGrowthPctRegionB = parseNumericInput(input.grpGrowthPctRegionB);
  const populationCurrentRegionA = parseNumericInput(input.populationCurrentRegionA);
  const populationCurrentRegionB = parseNumericInput(input.populationCurrentRegionB);
  const populationGrowthPctRegionA = parseNumericInput(input.populationGrowthPctRegionA);
  const populationGrowthPctRegionB = parseNumericInput(input.populationGrowthPctRegionB);
  const gdpPassengerFlowCoefficientRegionA = parseNumericInput(input.gdpPassengerFlowCoefficientRegionA);
  const gdpPassengerFlowCoefficientRegionB = parseNumericInput(input.gdpPassengerFlowCoefficientRegionB);
  const inducedDemandPct = parseNumericInput(input.inducedDemandPct);

  if (
    grpCurrentRegionA === null ||
    grpCurrentRegionB === null ||
    grpGrowthPctRegionA === null ||
    grpGrowthPctRegionB === null ||
    populationCurrentRegionA === null ||
    populationCurrentRegionB === null ||
    populationGrowthPctRegionA === null ||
    populationGrowthPctRegionB === null ||
    gdpPassengerFlowCoefficientRegionA === null ||
    gdpPassengerFlowCoefficientRegionB === null ||
    inducedDemandPct === null
  ) {
    return null;
  }

  return {
    grpCurrentRegionA,
    grpCurrentRegionB,
    grpGrowthPctRegionA,
    grpGrowthPctRegionB,
    populationCurrentRegionA,
    populationCurrentRegionB,
    populationGrowthPctRegionA,
    populationGrowthPctRegionB,
    gdpPassengerFlowCoefficientRegionA,
    gdpPassengerFlowCoefficientRegionB,
    inducedDemandPct,
  };
}

function toStation(stationDraft: Pz1StationDraft): Pz1Station | null {
  const lat = parseLatitude(stationDraft.lat);
  const lng = parseLongitude(stationDraft.lng);
  const name = stationDraft.name.trim();

  if (!name || lat === null || lng === null) {
    return null;
  }

  return {
    label: stationDraft.label,
    name,
    lat,
    lng,
    type: stationDraft.type,
    region: stationDraft.region.trim() || undefined,
  };
}

function toRouteVertex(routePointDraft: Pz1RoutePointDraft): RouteLine['vertices'][number] | null {
  const lat = parseLatitude(routePointDraft.lat);
  const lng = parseLongitude(routePointDraft.lng);

  if (lat === null || lng === null) {
    return null;
  }

  return {
    id: routePointDraft.id,
    lat,
    lon: lng,
  };
}

function parseCoordinate(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLatitude(value: string) {
  const parsed = parseCoordinate(value);
  return parsed !== null && parsed >= -90 && parsed <= 90 ? parsed : null;
}

function parseLongitude(value: string) {
  const parsed = parseCoordinate(value);
  return parsed !== null && parsed >= -180 && parsed <= 180 ? parsed : null;
}

/**
 * Разбор числа, набранного студентом.
 *
 * Поля сами расставляют разделители разрядов, пока в них печатают, поэтому
 * перед разбором их надо снять — тем же helper-ом, что и ставит. Иначе всё,
 * что больше 999, перестаёт быть числом для проверок: «3 766 066» превращалось
 * в NaN, и шаг не считался заполненным, хотя на экране стояло число.
 */
function parseNumericInput(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(stripGroupSeparators(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Денежное значение для поля ввода: два знака, запятая, без разделителя
 * разрядов. Без группировки намеренно — строка возвращается в поле формы и
 * потом разбирается parseNumericInput, лишние пробелы там ни к чему.
 */
function formatMoneyInput(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

function formatDecimal(value: number) {
  return Number.isFinite(value) ? value.toFixed(6).replace(/0+$/g, '').replace(/\.$/, '') : '';
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatDuration(totalMinutes: number) {
  const roundedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getDistanceKey(fromLabel: StationLabel, toLabel: StationLabel) {
  return `${fromLabel}-${toLabel}`;
}

function getVariantById(variantId: string) {
  return pz1Variants.find((variant) => variant.id === variantId) ?? pz1Variants[0];
}

function getStationType(label: StationLabel): StationType {
  return TERMINAL_LABELS.includes(label) ? 'terminal' : 'intermediate';
}

function isStationDraftComplete(stationDraft: Pz1StationDraft, duplicateStationNames = new Set<string>()) {
  return (
    validateStationField(stationDraft, 'name', duplicateStationNames) === null &&
    validateStationField(stationDraft, 'lat') === null &&
    validateStationField(stationDraft, 'lng') === null &&
    validateStationField(stationDraft, 'region') === null
  );
}

function isLengthInRange(value: string, min: number, max: number) {
  const length = value.trim().length;
  return length >= min && length <= max;
}

function isVariantInRange(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6;
}

function normalizeActiveTransportModes(modeIds: TransportModeId[]) {
  const requestedModes = new Set(modeIds.filter((modeId) => ALL_TRANSPORT_MODE_IDS.includes(modeId)));
  requestedModes.add(HSR_MODE_ID);

  return transportColumns.filter((column) => requestedModes.has(column.id)).map((column) => column.id);
}

function validateCoordinateField(value: string, min: number, max: number, label: string) {
  if (!value.trim()) {
    return `${label}: заполните координату`;
  }

  const parsed = parseCoordinate(value);
  if (parsed === null) {
    return `${label}: значение должно быть числом`;
  }

  if (parsed < min || parsed > max) {
    return `${label}: допустимый диапазон ${min}…${max}`;
  }

  return null;
}

function normalizeStationName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function getNearestRoutePointIndex(point: { lon: number; lat: number }, routePoints: Array<{ lon: number; lat: number }>) {
  return routePoints.reduce(
    (nearest, routePoint, index) => {
      const distanceKm = haversineDistanceKm(point, routePoint);
      return distanceKm < nearest.distanceKm ? { index, distanceKm } : nearest;
    },
    { index: 0, distanceKm: Number.POSITIVE_INFINITY },
  ).index;
}
