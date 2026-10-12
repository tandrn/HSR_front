import type { Pz3SoilCondition, Pz3WorkKind } from './types';

export type Pz3OptionEffect = 'extraWork' | 'laborMaterials30' | 'labor30' | 'duration90' | 'durationUnspecified';

export interface Pz3WorkOption {
  id: Pz3SoilCondition;
  kind: Pz3WorkKind;
  label: string;
  effect: Pz3OptionEffect;
  detail: string;
}

/** Таблица опций из комментариев заказчика. Старые weakSoil/rocky читаются отдельно. */
export const pz3WorkOptions: Pz3WorkOption[] = [
  { id: 'shortWindows', kind: 'existingLineRepair', label: 'Короткие технологические «окна»', effect: 'durationUnspecified', detail: 'Работы выполняются в ограниченные технологические окна.' },
  { id: 'ballastContamination', kind: 'existingLineRepair', label: 'Сильное загрязнение балласта', effect: 'extraWork', detail: 'Добавляется очистка балласта.' },
  { id: 'formationDeformation', kind: 'existingLineRepair', label: 'Деформации земляного полотна', effect: 'extraWork', detail: 'Добавляется восстановление земляного полотна.' },
  { id: 'restrictedAccess', kind: 'existingLineRepair', label: 'Стеснённый доступ к участку', effect: 'durationUnspecified', detail: 'Доступ к месту работ ограничен.' },
  { id: 'weakFoundation', kind: 'ballastTrack', label: 'Слабые грунты основания', effect: 'extraWork', detail: 'Добавляется забивка свай.' },
  { id: 'groundwater', kind: 'ballastTrack', label: 'Сложные грунтовые воды', effect: 'extraWork', detail: 'Добавляется создание песчаных свай.' },
  { id: 'highEmbankment', kind: 'ballastTrack', label: 'Высокая насыпь', effect: 'laborMaterials30', detail: 'Трудоёмкость и материалы увеличиваются на 30%.' },
  { id: 'deepCut', kind: 'ballastTrack', label: 'Глубокая выемка', effect: 'laborMaterials30', detail: 'Трудоёмкость и материалы увеличиваются на 30%.' },
  { id: 'weakFoundation', kind: 'earthworks', label: 'Слабые грунты основания', effect: 'extraWork', detail: 'Добавляется забивка свай.' },
  { id: 'settlement', kind: 'earthworks', label: 'Длительная стабилизация осадок', effect: 'duration90', detail: 'Срок увеличивается на 3 месяца (в графике — 90 расчётных дней).' },
  { id: 'transition', kind: 'earthworks', label: 'Переход к мосту или тоннелю', effect: 'extraWork', detail: 'Добавляется устройство переходного участка.' },
  { id: 'curvedViaduct', kind: 'viaduct', label: 'Криволинейный участок', effect: 'extraWork', detail: 'Добавляется геодезическая выверка.' },
  { id: 'weakBridgeSupport', kind: 'bridge', label: 'Слабые грунты под опорами', effect: 'extraWork', detail: 'Добавляется забивка свай.' },
  { id: 'riverSupports', kind: 'bridge', label: 'Устройство опор в русле реки', effect: 'labor30', detail: 'Трудоёмкость увеличивается на 30%.' },
  { id: 'navigableRiver', kind: 'bridge', label: 'Судоходная река', effect: 'extraWork', detail: 'Добавляется согласование моста.' },
  { id: 'unstableTunnelGround', kind: 'tunnel', label: 'Неустойчивые грунты или породы', effect: 'extraWork', detail: 'Добавляются временные усиления.' },
  { id: 'tunnelGroundwater', kind: 'tunnel', label: 'Значительный приток подземных вод', effect: 'extraWork', detail: 'Добавляется организация водоотлива.' },
  { id: 'abrasiveRock', kind: 'tunnel', label: 'Твёрдые абразивные породы', effect: 'labor30', detail: 'Трудоёмкость увеличивается на 30%.' },
  { id: 'underBuildings', kind: 'tunnel', label: 'Проходка под существующей застройкой', effect: 'extraWork', detail: 'Добавляются временные усиления.' },
];

export function getPz3OptionsForKind(kind: Pz3WorkKind): Pz3WorkOption[] {
  return pz3WorkOptions.filter((option) => option.kind === kind);
}

export function getPz3Option(id: Pz3SoilCondition, kind: Pz3WorkKind): Pz3WorkOption | undefined {
  return pz3WorkOptions.find((option) => option.id === id && option.kind === kind);
}

export function getPz3OptionLabel(id: Pz3SoilCondition, kind: Pz3WorkKind): string {
  if (id === 'weakSoil') return 'Слабые грунты';
  if (id === 'rocky') return 'Скальные породы';
  return getPz3Option(id, kind)?.label ?? id;
}
