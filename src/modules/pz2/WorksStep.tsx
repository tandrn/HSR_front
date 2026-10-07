import { useMemo, useState } from 'react';
import { useModuleState } from '../../bridge/context';
import { useTouchedFields } from '../../shared/hooks/useTouchedFields';
import { GroupedNumberInput } from '../../shared/ui/GroupedNumberInput';
import { Pz2RouteMap } from './lazyRouteMap';
import {
  changePz2WorkKind,
  createPz2Ruler,
  findPz2OverlappingWorks,
  createPz2Work,
  formatPz2Km,
  getPz2LengthCheck,
  getPz2DefaultWorkPosition,
  getPz2RouteSource,
  getPz2RoutePointMarks,
  getPz2SegmentMarks,
  getPz2StationMarks,
  getPz2WorkMarks,
  setPz2WorkLength,
  setPz2WorkPosition,
  togglePz2SoilCondition,
  getPz2WorkKind,
  pz2SoilConditions,
  pz2WorkKinds,
  validatePz2Work,
} from './model';
import type { Pz2Draft, Pz2RouteSpan, Pz2SoilCondition, Pz2WorkDraft, Pz2WorkKind } from './types';

/**
 * Шаг 01 ПЗ2: какие работы нужно выполнить на трассе (ТЗ ПЗ2 §5).
 *
 * Слева карта из ПЗ1 с линейкой, справа таблица работ. Измеренный участок
 * сразу заводится строкой в таблицу — так студенту не приходится переписывать
 * число руками, а сумма длин сходится с длиной маршрута.
 */
export function WorksStep() {
  const { draft, importedBridge, updateDraft } = useModuleState<Pz2Draft>();
  const { markTouched, shouldShowError } = useTouchedFields();
  // Трасса из ПЗ1 не меняется, пока не загрузят другой файл, а километраж
  // станций и точек считается по всей её геометрии. Без этого замера каждый
  // введённый символ пересобирал линейку заново и заодно перезапускал эффекты
  // карты: на шести строках ввод отставал примерно на 40 мс на нажатие.
  const source = useMemo(() => getPz2RouteSource(importedBridge), [importedBridge]);
  const ruler = useMemo(() => createPz2Ruler(source), [source]);
  const stations = useMemo(() => getPz2StationMarks(source, ruler), [source, ruler]);
  const routePoints = useMemo(() => getPz2RoutePointMarks(source, ruler), [source, ruler]);
  const segments = useMemo(() => getPz2SegmentMarks(source), [source]);
  const workMarks = useMemo(() => getPz2WorkMarks(draft, ruler.totalKm), [draft.works, ruler.totalKm]);
  const [highlightedId, setHighlightedId] = useState('');
  const overlapping = new Set(findPz2OverlappingWorks(draft));
  const highlighted = draft.works.find((object) => object.id === highlightedId)?.span ?? null;
  const check = getPz2LengthCheck(draft, source.totalLengthKm || ruler.totalKm);

  function patchObject(id: string, patch: Partial<Pz2WorkDraft>) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    }));
  }

  function setLength(id: string, lengthKm: string) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((work) => (work.id === id ? setPz2WorkLength(work, lengthKm) : work)),
    }));
  }

  function toggleCondition(id: string, condition: Pz2SoilCondition) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((work) => (work.id === id ? togglePz2SoilCondition(work, condition) : work)),
    }));
  }

  function changeKind(id: string, kind: Pz2WorkKind) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((object, index) =>
        object.id === id
          ? changePz2WorkKind(object, kind, ruler.totalKm, getPz2DefaultWorkPosition(index, ruler.totalKm))
          : object,
      ),
    }));
  }

  function addObject(lengthKm = '', span?: Pz2RouteSpan) {
    updateDraft((current) => ({
      ...current,
      works: [...current.works, createPz2Work('existingLineRepair', lengthKm, span)],
    }));
  }

  function removeObject(id: string) {
    updateDraft((current) => ({
      ...current,
      works: current.works.filter((object) => object.id !== id),
    }));
  }

  return (
    <div className="works-step">
      <Pz2RouteMap
        marksKm={draft.rulerMarksKm}
        onMarksChange={(rulerMarksKm) => updateDraft((current) => ({ ...current, rulerMarksKm }))}
        highlightedSpan={highlighted}
        onMeasured={(lengthKm, span) => addObject(formatMeasured(lengthKm), span)}
        onPreviewImageChange={(previewImage) =>
          updateDraft((current) => (current.previewImage === previewImage ? current : { ...current, previewImage }))
        }
        routePoints={routePoints}
        ruler={ruler}
        segments={segments}
        stations={stations}
        workMarks={workMarks}
        onWorkPositionChange={(id, distanceKm) => updateDraft((current) => ({
          ...current,
          works: current.works.map((work) =>
            work.id === id ? setPz2WorkPosition(work, distanceKm, ruler.totalKm) : work,
          ),
        }))}
      />

      <section className="form-section">
        <div className="osm-map-card__head">
          <div>
            <p className="eyebrow">Работы по трассе</p>
            <h3>Что нужно построить</h3>
          </div>
          <button className="button button--outline" onClick={() => addObject()} type="button">
            + Добавить работу
          </button>
        </div>

        {draft.works.length === 0 ? (
          <p className="status-note">
            Пока пусто. Измерьте участок линейкой на карте — строка добавится сама, либо добавьте работу вручную.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="input-table works-table">
              <thead>
                <tr>
                  <th>Тип работы</th>
                  <th className="numeric">Длина, км</th>
                  <th className="numeric">Количество, шт.</th>
                  <th>Условия</th>
                  <th aria-label="Удалить" />
                </tr>
              </thead>
              <tbody>
                {draft.works.map((object, index) => {
                  const kind = getPz2WorkKind(object.kind);
                  const value = kind.measure === 'count' ? object.count : object.lengthKm;
                  const error = shouldShowError(object.id, value) ? validatePz2Work(object) : null;

                  return (
                    <tr
                      className={overlapping.has(object.id) ? 'is-overlapping' : undefined}
                      key={object.id}
                      onBlur={() => setHighlightedId('')}
                      onFocus={() => setHighlightedId(object.id)}
                      onMouseEnter={() => setHighlightedId(object.id)}
                      onMouseLeave={() => setHighlightedId('')}
                    >
                      <th scope="row">
                        <select
                          aria-label={`Тип работы ${index + 1}`}
                          onChange={(event) => changeKind(object.id, event.target.value as Pz2WorkKind)}
                          value={object.kind}
                        >
                          {pz2WorkKinds.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <small>{kind.hint}</small>
                      </th>
                      <td>
                        <GroupedNumberInput
                          ariaLabel={`Длина работы ${index + 1}, км`}
                          error={kind.measure === 'length' ? error : null}
                          onBlur={() => markTouched(object.id)}
                          onChange={(lengthKm) => setLength(object.id, lengthKm)}
                          readOnly={kind.measure === 'count'}
                          value={kind.measure === 'count' ? '' : object.lengthKm}
                        />
                        {kind.measure === 'length' && error ? <small className="field-error">{error}</small> : null}
                      </td>
                      <td>
                        <GroupedNumberInput
                          ariaLabel={`Количество для работы ${index + 1}, шт.`}
                          error={kind.measure === 'count' ? error : null}
                          onBlur={() => markTouched(object.id)}
                          onChange={(count) => patchObject(object.id, { count })}
                          readOnly={kind.measure === 'length'}
                          value={kind.measure === 'length' ? '' : object.count}
                        />
                        {kind.measure === 'count' && error ? <small className="field-error">{error}</small> : null}
                      </td>
                      <td>
                        {/* Условия не исключают друг друга: участок может быть
                            и в слабых грунтах, и в скальных породах. */}
                        <ul className="soil-conditions">
                          {pz2SoilConditions.map((item) => (
                            <li key={item.id}>
                              <label title={item.hint}>
                                <input
                                  checked={object.conditions.includes(item.id)}
                                  onChange={() => toggleCondition(object.id, item.id)}
                                  type="checkbox"
                                />
                                <span>{item.label}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <button
                          aria-label={`Удалить работу ${index + 1}`}
                          className="data-entry__remove-column"
                          onClick={() => removeObject(object.id)}
                          type="button"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="forecast-summary-panel">
        <p className="eyebrow">Проверка длины</p>
        <h3>Сумма участков и длина маршрута</h3>
        <dl className="forecast-summary-grid forecast-summary-grid--compact">
          <div>
            <dt>Намерено</dt>
            <dd>{formatPz2Km(check.measuredKm)}</dd>
          </div>
          <div>
            <dt>Маршрут из ПЗ1</dt>
            <dd>{formatPz2Km(check.routeKm)}</dd>
          </div>
          <div>
            <dt>Расхождение</dt>
            {/* Красным только само число расхождения: это ожидаемая часть
                работы, а не ошибка ввода, и ругать экраном за неё нельзя. */}
            <dd className={check.status === 'match' ? 'is-matched' : 'is-off'}>
              {formatPz2Km(Math.abs(check.differenceKm))}
            </dd>
          </div>
        </dl>
        <p className={check.status === 'match' ? 'status-note' : 'field-warning'}>{describeCheck(check.status)}</p>
        {overlapping.size > 0 ? (
          <p className="field-warning">
            Участки налезают друг на друга: {overlapping.size} строк{overlapping.size === 1 ? 'а' : 'и'} меряют один и тот
            же кусок трассы. Наведите на строку — её участок подсветится на карте.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function describeCheck(status: ReturnType<typeof getPz2LengthCheck>['status']) {
  if (status === 'empty') {
    return 'Добавьте работы — тогда сумму будет с чем сверять.';
  }

  if (status === 'match') {
    return 'Сумма участков сошлась с длиной маршрута.';
  }

  // Про наложение отдельно говорит проверка участков — она это знает точно,
  // а не предполагает по одной лишь сумме.
  return status === 'short'
    ? 'Участков намерено меньше длины маршрута — часть трассы осталась без работ.'
    : 'Участков намерено больше длины маршрута — где-то набрались лишние километры.';
}

/** Линейкой точнее сотни метров не намеряешь, поэтому округляем до двух знаков. */
function formatMeasured(lengthKm: number) {
  return lengthKm.toFixed(2).replace('.', ',');
}
