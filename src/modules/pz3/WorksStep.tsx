import { useMemo, useState } from 'react';
import { useModuleState } from '../../bridge/context';
import { useTouchedFields } from '../../shared/hooks/useTouchedFields';
import { GroupedNumberInput } from '../../shared/ui/GroupedNumberInput';
import { Pz3RouteMap } from './lazyRouteMap';
import { getPz3OptionsForKind } from './options';
import {
  changePz3WorkKind,
  createPz3Ruler,
  findPz3OverlappingWorks,
  createPz3Work,
  formatPz3Km,
  getPz3LengthCheck,
  getPz3DefaultWorkPosition,
  getPz3RouteSource,
  getPz3RoutePointMarks,
  getPz3SegmentMarks,
  getPz3StationMarks,
  getPz3WorkMarks,
  setPz3WorkLength,
  setPz3WorkPosition,
  togglePz3SoilCondition,
  getPz3WorkKind,
  pz3SoilConditions,
  pz3WorkKinds,
  validatePz3Work,
} from './model';
import type { Pz3Draft, Pz3RouteSpan, Pz3SoilCondition, Pz3WorkDraft, Pz3WorkKind } from './types';

/**
 * Шаг 01 ПЗ3: какие работы нужно выполнить на трассе (ТЗ ПЗ3 §5).
 *
 * Рядом с картой из ПЗ1 — карточки работ. Измеренный участок
 * сразу заводится карточкой — так студенту не приходится переписывать
 * число руками, а сумма длин сходится с длиной маршрута.
 */
export function WorksStep() {
  const { draft, importedBridge, updateDraft } = useModuleState<Pz3Draft>();
  const { markTouched, shouldShowError } = useTouchedFields();
  // Трасса из ПЗ1 не меняется, пока не загрузят другой файл, а километраж
  // станций и точек считается по всей её геометрии. Без этого замера каждый
  // введённый символ пересобирал линейку заново и заодно перезапускал эффекты
  // карты: на шести строках ввод отставал примерно на 40 мс на нажатие.
  const source = useMemo(() => getPz3RouteSource(importedBridge), [importedBridge]);
  const ruler = useMemo(() => createPz3Ruler(source), [source]);
  const stations = useMemo(() => getPz3StationMarks(source, ruler), [source, ruler]);
  const routePoints = useMemo(() => getPz3RoutePointMarks(source, ruler), [source, ruler]);
  const segments = useMemo(() => getPz3SegmentMarks(source), [source]);
  const workMarks = useMemo(() => getPz3WorkMarks(draft, ruler.totalKm), [draft.works, ruler.totalKm]);
  const [highlightedId, setHighlightedId] = useState('');
  const overlapping = new Set(findPz3OverlappingWorks(draft));
  const highlighted = draft.works.find((object) => object.id === highlightedId)?.span ?? null;
  const check = getPz3LengthCheck(draft, source.totalLengthKm || ruler.totalKm);

  function patchObject(id: string, patch: Partial<Pz3WorkDraft>) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    }));
  }

  function setLength(id: string, lengthKm: string) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((work) => (work.id === id ? setPz3WorkLength(work, lengthKm) : work)),
    }));
  }

  function toggleCondition(id: string, condition: Pz3SoilCondition) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((work) => (work.id === id ? togglePz3SoilCondition(work, condition) : work)),
    }));
  }

  function changeKind(id: string, kind: Pz3WorkKind) {
    updateDraft((current) => ({
      ...current,
      works: current.works.map((object, index) =>
        object.id === id
          ? changePz3WorkKind(object, kind, ruler.totalKm, getPz3DefaultWorkPosition(index, ruler.totalKm))
          : object,
      ),
    }));
  }

  function addObject(lengthKm = '', span?: Pz3RouteSpan) {
    updateDraft((current) => ({
      ...current,
      works: [...current.works, createPz3Work('existingLineRepair', lengthKm, span)],
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
      <Pz3RouteMap
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
            work.id === id ? setPz3WorkPosition(work, distanceKm, ruler.totalKm) : work,
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
          <div className="works-list">
                {draft.works.map((object, index) => {
                  const kind = getPz3WorkKind(object.kind);
                  const options = getPz3OptionsForKind(object.kind);
                  const legacyOptions = pz3SoilConditions.filter((item) => object.conditions.includes(item.id));
                  const value = kind.measure === 'count' ? object.count : object.lengthKm;
                  const error = shouldShowError(object.id, value) ? validatePz3Work(object) : null;

                  return (
                    <div
                      className={overlapping.has(object.id) ? 'is-overlapping' : undefined}
                      key={object.id}
                      onBlur={() => setHighlightedId('')}
                      onFocus={() => setHighlightedId(object.id)}
                      onMouseEnter={() => setHighlightedId(object.id)}
                      onMouseLeave={() => setHighlightedId('')}
                    >
                      <div className="works-list__header">
                        <div className="works-list__title">
                          <span className="works-list__number">Работа {index + 1}</span>
                          <select
                          aria-label={`Тип работы ${index + 1}`}
                          onChange={(event) => changeKind(object.id, event.target.value as Pz3WorkKind)}
                          value={object.kind}
                        >
                          {pz3WorkKinds.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                          </select>
                          <small>{kind.hint}</small>
                        </div>
                        <button
                          aria-label={`Удалить работу ${index + 1}`}
                          className="data-entry__remove-column"
                          onClick={() => removeObject(object.id)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                      <div className="works-list__field">
                        <span>{kind.measure === 'count' ? 'Количество, шт.' : 'Длина, км'}</span>
                        {kind.measure === 'count' ? (
                          <GroupedNumberInput
                            ariaLabel={`Количество для работы ${index + 1}, шт.`}
                            error={error}
                            onBlur={() => markTouched(object.id)}
                            onChange={(count) => patchObject(object.id, { count })}
                            value={object.count}
                          />
                        ) : (
                          <GroupedNumberInput
                            ariaLabel={`Длина работы ${index + 1}, км`}
                            error={error}
                            onBlur={() => markTouched(object.id)}
                            onChange={(lengthKm) => setLength(object.id, lengthKm)}
                            value={object.lengthKm}
                          />
                        )}
                        {error ? <small className="field-error">{error}</small> : null}
                      </div>
                      <div className="works-list__options">
                        <span>Условия работы</span>
                        <ul className="soil-conditions">
                          {[
                            ...options.map((option) => ({ ...option, hint: option.detail })),
                            ...legacyOptions.map((item) => ({ ...item, detail: '', effect: undefined })),
                          ].map((item) => (
                            <li key={item.id}>
                              <label title={item.hint}>
                                <input
                                  checked={object.conditions.includes(item.id)}
                                  onChange={() => toggleCondition(object.id, item.id)}
                                  type="checkbox"
                                />
                                <span>{item.label}</span>
                              </label>
                              {object.conditions.includes(item.id) && item.detail ? (
                                <small>{item.detail}</small>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </section>

      <section className="forecast-summary-panel">
        <p className="eyebrow">Проверка длины</p>
        <h3>Сумма участков и длина маршрута</h3>
        <dl className="forecast-summary-grid forecast-summary-grid--compact">
          <div>
            <dt>Намерено</dt>
            <dd>{formatPz3Km(check.measuredKm)}</dd>
          </div>
          <div>
            <dt>Маршрут из ПЗ1</dt>
            <dd>{formatPz3Km(check.routeKm)}</dd>
          </div>
          <div>
            <dt>Расхождение</dt>
            {/* Красным только само число расхождения: это ожидаемая часть
                работы, а не ошибка ввода, и ругать экраном за неё нельзя. */}
            <dd className={check.status === 'match' ? 'is-matched' : 'is-off'}>
              {formatPz3Km(Math.abs(check.differenceKm))}
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

function describeCheck(status: ReturnType<typeof getPz3LengthCheck>['status']) {
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
