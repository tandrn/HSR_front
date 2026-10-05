import type { TransportModeId } from '../../bridge/schema';

export interface PassengerFlowModeWeights {
  time: number;
  price: number;
  comfort: number;
}

export const passengerFlowModeIds: TransportModeId[] = [
  'hSR',
  'airplane',
  'bus',
  'suburbanTrain',
  'longDistanceTrain',
  'car',
];

export const passengerFlowModeWeights: Record<TransportModeId, PassengerFlowModeWeights> = {
  hSR: {
    time: 0.7,
    price: 0.1,
    comfort: 0.2,
  },
  airplane: {
    time: 0.7,
    price: 0.2,
    comfort: 0.1,
  },
  bus: {
    time: 0.3,
    price: 0.6,
    comfort: 0.1,
  },
  suburbanTrain: {
    time: 0.3,
    price: 0.3,
    comfort: 0.4,
  },
  longDistanceTrain: {
    time: 0.1,
    price: 0.7,
    comfort: 0.2,
  },
  car: {
    time: 0.4,
    price: 0.1,
    comfort: 0.5,
  },
};

/**
 * Коэффициенты удержания для уровня 1 распределения — доля существующего
 * потока вида, которая остаётся за ним в прогнозе.
 *
 * Заданы заказчиком явно (документ «Расчет модели», 01.09.2026) и НЕ выводятся
 * из таблицы весов выше. Раньше здесь стояло `1 − max(вес)` — реконструкция по
 * Excel, которая совпала с этими числами лишь у двух видов из шести.
 *
 * У ВСМ коэффициент 0: существующего потока у линии нет, удерживать нечего.
 */
export const passengerFlowRetentionCoefficients: Record<TransportModeId, number> = {
  hSR: 0,
  airplane: 0.7,
  bus: 0.7,
  suburbanTrain: 0.6,
  longDistanceTrain: 0.4,
  car: 0.5,
};

/**
 * Наполняемость личного автомобиля. Существующий поток авто не считается по
 * рейсам и вместимости: заказчик задаёт его как сумму потоков остальных видов,
 * умноженную на это число.
 */
export const CAR_EXISTING_FLOW_MULTIPLIER = 1.3;

/**
 * Период обслуживания в часах: среднее ожидание отправления принимается как
 * `18 / частота сообщения`. Из формулы `k2 = 18 / частота / 24` — деление на 24
 * там переводит в сутки, потому что в исходной таблице время хранится в сутках.
 */
export const SERVICE_WINDOW_HOURS = 18;
