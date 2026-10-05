import type { Pz1PassengerFlowResult, TransportModeId } from '../../bridge/schema';

/** Порядок слоёв и цвета повторяют диаграмму из презентации ПЗ1. */
export const passengerFlowChartModes: ReadonlyArray<{ id: TransportModeId; label: string; color: string }> = [
  { id: 'hSR', label: 'ВСМ', color: '#5B9BD5' },
  { id: 'airplane', label: 'Самолёт', color: '#ED7D31' },
  { id: 'bus', label: 'Автобус', color: '#A5A5A5' },
  { id: 'suburbanTrain', label: 'Пригородный поезд и экспресс', color: '#FFC000' },
  { id: 'longDistanceTrain', label: 'Поезд дальнего следования', color: '#4472C4' },
  { id: 'car', label: 'Личный автомобиль', color: '#70AD47' },
];

export type PassengerFlowStackedRow = { period: 'Существующие' | 'Прогноз' } & Record<TransportModeId, number>;

function modeValues(
  forecast: Pz1PassengerFlowResult,
  field: 'existingAnnualFlow' | 'forecastAnnualFlow',
): Record<TransportModeId, number> {
  const values = {} as Record<TransportModeId, number>;
  for (const { id } of passengerFlowChartModes) {
    values[id] = forecast.modes.find((mode) => mode.modeId === id)?.[field] ?? 0;
  }
  return values;
}

export function buildPassengerFlowStackedData(forecast: Pz1PassengerFlowResult): PassengerFlowStackedRow[] {
  return [
    {
      period: 'Существующие',
      ...modeValues(forecast, 'existingAnnualFlow'),
    },
    {
      period: 'Прогноз',
      ...modeValues(forecast, 'forecastAnnualFlow'),
    },
  ];
}
