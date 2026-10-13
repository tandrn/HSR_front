import { useModuleState } from '../../bridge/context';
import { PZ3_LEVELING_LIMIT, getPz3Leveling } from './leveling';
import type { Pz3LevelingRow, Pz3LevelingState } from './leveling';
import type { Pz3Draft } from './types';

/**
 * Упражнение Ольги Владимировны — выравнивание загрузки (ТЗ ПЗ3 §7.1).
 *
 * Раньше здесь стоял тренажёр КСГ целиком: определитель работ на десять
 * колонок, редактор работы, таблица расчёта, схема зависимостей, восемь плиток
 * показателей и две диаграммы загрузки. Это была отдельная программа внутри
 * шага — студенту предлагалось сначала спроектировать сетевой график, а уже
 * потом чему-то на нём учиться. Упражнение же состоит из одного действия:
 * подвинуть работы, у которых есть резерв, чтобы бригада была занята ровно.
 * Экран теперь показывает ровно это, а расчёт остался прежним — движок
 * `domain/network` не переписывался, ТЗ §7.1 этого не позволяет.
 */
export function LevelingExercise() {
  const { draft, updateDraft } = useModuleState<Pz3Draft>();
  const shifts = draft.levelingShifts ?? {};
  const state = getPz3Leveling(shifts);
  const hasShifts = Object.values(shifts).some((shift) => shift > 0);

  function setShift(id: string, shift: number) {
    updateDraft((current) => ({
      ...current,
      levelingShifts: { ...(current.levelingShifts ?? {}), [id]: shift },
    }));
  }

  return (
    <section className="form-section leveling-exercise">
      <div className="osm-map-card__head">
        <div>
          <p className="eyebrow">Выравнивание загрузки</p>
          <h3>Упражнение: ровная бригада</h3>
        </div>
        <button
          className="button button--outline"
          disabled={!hasShifts}
          onClick={() => updateDraft((current) => ({ ...current, levelingShifts: {} }))}
          type="button"
        >
          Сбросить сдвиги
        </button>
      </div>

      <p className="status-note leveling-exercise__intro">
        В бригаде {PZ3_LEVELING_LIMIT} человек, и больше их не станет. Работы на критическом пути держат срок — их
        двигать нельзя. У остальных есть резерв: сдвиньте их так, чтобы ни в один день не требовалось больше{' '}
        {PZ3_LEVELING_LIMIT} человек. Срок проекта от этого не изменится — в этом и смысл резерва.
      </p>

      <dl className="forecast-summary-grid forecast-summary-grid--compact">
        <div>
          <dt>Пик потребности</dt>
          <dd className={state.peakWorkers > state.limit ? 'is-off' : 'is-matched'}>{state.peakWorkers} чел.</dd>
        </div>
        <div>
          <dt>В бригаде</dt>
          <dd>{state.limit} чел.</dd>
        </div>
        <div>
          <dt>Дней с перегрузкой</dt>
          <dd className={state.overloadDays > 0 ? 'is-off' : 'is-matched'}>{state.overloadDays}</dd>
        </div>
        <div>
          <dt>Срок проекта</dt>
          <dd>{state.durationDays} дн.</dd>
        </div>
      </dl>

      <LevelingChart onShiftChange={setShift} state={state} />

      <p className={state.isSolved ? 'status-note' : 'field-warning'}>
        {state.isSolved
          ? `Готово: в каждый день занято не больше ${state.limit} человек, а срок остался прежним — ${state.durationDays} дн. Ровная загрузка и означает, что бригаду не приходится набирать и распускать.`
          : `Осталось дней, когда людей не хватает: ${state.overloadDays}. Двигать можно только работы с резервом — они отмечены ползунком.`}
      </p>
    </section>
  );
}

function LevelingChart({
  state,
  onShiftChange,
}: {
  state: Pz3LevelingState;
  onShiftChange: (id: string, shift: number) => void;
}) {
  // Высота столбика меряется от большего из двух: пика и бригады. Иначе при
  // решённой задаче линия бригады оказывалась бы выше поля графика.
  const peakHeight = Math.max(state.peakWorkers, state.limit);

  return (
    <div className="leveling">
      {/* Шкала дней стоит над строками: она общая и для работ, и для гистограммы
          под ними, а внизу линия бригады перечёркивала бы подписи. */}
      <div className="leveling__axis">
        <span>день 1</span>
        <span>день {state.durationDays}</span>
      </div>

      {state.rows.map((row) => (
        <LevelingRow key={row.id} onShiftChange={onShiftChange} row={row} totalDays={state.durationDays} />
      ))}

      <div className="leveling__load">
        {/* Линия бригады: всё, что выше неё, — дни, на которые людей не хватает. */}
        <span className="leveling__limit" style={{ bottom: `${(state.limit / peakHeight) * 100}%` }}>
          <b>бригада: {state.limit} чел.</b>
        </span>
        {state.load.map((day) => (
          <span
            className={`leveling__bar${day.overloaded ? ' is-over' : ''}`}
            key={day.day}
            style={{ height: `${(day.workers / peakHeight) * 100}%` }}
            title={`День ${day.day}: ${day.workers} чел.`}
          />
        ))}
      </div>
    </div>
  );
}

function LevelingRow({
  row,
  totalDays,
  onShiftChange,
}: {
  row: Pz3LevelingRow;
  totalDays: number;
  onShiftChange: (id: string, shift: number) => void;
}) {
  const share = (days: number) => `${(days / Math.max(totalDays, 1)) * 100}%`;
  // Куда работу вообще можно сдвинуть: от раннего начала до позднего конца.
  const floatStart = row.startDay - row.appliedShift;

  return (
    <div className="leveling__row">
      <span className="leveling__name">
        <strong>{row.code}</strong> {row.title}
        <small>
          {row.workers} чел. · {row.durationDays} дн.
        </small>
      </span>

      <span className="leveling__track">
        {row.floatDays > 0 ? (
          <span
            className="leveling__float"
            style={{ left: share(floatStart), width: share(row.durationDays + row.floatDays) }}
            title={`Резерв: ${row.floatDays} дн.`}
          />
        ) : null}
        <span
          className={`leveling__work${row.isCritical ? ' is-critical' : ''}`}
          style={{ left: share(row.startDay), width: share(row.durationDays) }}
          title={`${row.title}: дни ${row.startDay + 1}–${row.startDay + row.durationDays}, ${row.workers} чел.`}
        >
          {row.workers} чел.
        </span>
      </span>

      <span className="leveling__shift">
        {row.floatDays === 0 ? (
          <em>критическая</em>
        ) : (
          <>
            <input
              aria-label={`Сдвиг работы ${row.code} — ${row.title}`}
              max={row.floatDays}
              min={0}
              onChange={(event) => onShiftChange(row.id, Number(event.target.value))}
              type="range"
              value={row.requestedShift}
            />
            <b>
              +{row.appliedShift} из {row.floatDays} дн.
            </b>
          </>
        )}
      </span>
    </div>
  );
}
