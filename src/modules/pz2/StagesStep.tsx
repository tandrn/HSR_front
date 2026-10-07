import { useMemo, useRef, useState } from 'react';
import { useModuleState } from '../../bridge/context';
import { Pz2RouteMap } from './lazyRouteMap';
import {
  assignPz2WorkToStage,
  createPz2Ruler,
  createPz2Stage,
  formatPz2Km,
  getPz2RoutePointMarks,
  getPz2RouteSource,
  getPz2SegmentMarks,
  getPz2StageColor,
  getPz2StageSpans,
  getPz2StationMarks,
  getPz2WorkMarks,
  pluralWorks,
  getPz2StageWorks,
  getPz2WorkKind,
  parsePz2Number,
  pz2SoilConditions,
  removePz2Stage,
  renamePz2Stage,
} from './model';
import type { Pz2Draft, Pz2WorkDraft } from './types';

/**
 * Шаг 02 ПЗ2: разбиение трассы на пространственные этапы (ТЗ ПЗ2 §6).
 *
 * Этап — участок трассы, который строится параллельно другим, а не отрезок
 * времени. Работы разносятся по этапам перетаскиванием; работа принадлежит
 * ровно одному этапу, поэтому перенос — это замена принадлежности.
 *
 * Перетаскивание сделано на нативном HTML drag & drop: заказчик отдельно
 * отметил, что техника не принципиальна, важен результат. Мышью можно не
 * попасть — рядом с каждой карточкой есть список этапов для выбора, иначе шаг
 * был бы непроходим с клавиатуры.
 */
export function StagesStep() {
  const { draft, importedBridge, updateDraft } = useModuleState<Pz2Draft>();
  // См. пояснение в WorksStep: пересбор линейки на каждый рендер стоил дорого,
  // а трасса из ПЗ1 меняется только при загрузке другого файла.
  const source = useMemo(() => getPz2RouteSource(importedBridge), [importedBridge]);
  const ruler = useMemo(() => createPz2Ruler(source), [source]);
  const stations = useMemo(() => getPz2StationMarks(source, ruler), [source, ruler]);
  const routePoints = useMemo(() => getPz2RoutePointMarks(source, ruler), [source, ruler]);
  const segments = useMemo(() => getPz2SegmentMarks(source), [source]);
  const workMarks = useMemo(() => getPz2WorkMarks(draft, ruler.totalKm), [draft.works, ruler.totalKm]);
  const stageSpans = useMemo(() => getPz2StageSpans(draft), [draft]);
  const [hoveredStageId, setHoveredStageId] = useState('');
  const [title, setTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const [draggedId, setDraggedId] = useState('');
  const [dropTargetId, setDropTargetId] = useState<string | null | undefined>(undefined);
  const poolWorks = getPz2StageWorks(draft, null);

  function addStage() {
    const trimmed = title.trim();

    if (!trimmed) {
      return;
    }

    updateDraft((current) => ({
      ...current,
      stages: [...current.stages, createPz2Stage(trimmed, current.stages.length)],
    }));
    setTitle('');
    closeAddForm();
  }

  /** После закрытия формы фокус возвращается на кнопку: этапы заводят подряд. */
  function closeAddForm() {
    setIsAdding(false);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function moveWork(workId: string, stageId: string | null) {
    updateDraft((current) => assignPz2WorkToStage(current, workId, stageId));
  }

  function dropHandlers(stageId: string | null) {
    return {
      onDragEnter: () => setDropTargetId(stageId),
      onDragLeave: () => setDropTargetId((current) => (current === stageId ? undefined : current)),
      onDragOver: (event: React.DragEvent) => event.preventDefault(),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const workId = event.dataTransfer.getData('text/plain') || draggedId;

        if (workId) {
          moveWork(workId, stageId);
        }

        setDraggedId('');
        setDropTargetId(undefined);
      },
    };
  }

  const worksWithoutSpan = stageSpans.reduce((sum, stage) => sum + stage.worksWithoutSpan, 0);

  return (
    <div className="stages-step">
      <Pz2RouteMap
        highlightedStageId={hoveredStageId}
        marksKm={[]}
        onMarksChange={() => undefined}
        onMeasured={() => undefined}
        onPreviewImageChange={(previewImage) =>
          updateDraft((current) => (current.previewImage === previewImage ? current : { ...current, previewImage }))
        }
        routePoints={routePoints}
        ruler={ruler}
        segments={segments}
        stageSpans={stageSpans}
        stations={stations}
        workMarks={workMarks}
        withRuler={false}
      />

      <section className="form-section">
        <div className="osm-map-card__head">
          <div>
            <p className="eyebrow">Этапы</p>
            <h3>Участки, которые строятся параллельно</h3>
          </div>
        </div>

        {isAdding ? (
          <div className="stage-add-form">
            <label htmlFor="pz2-stage-title">Название этапа</label>
            <input
              autoFocus
              id="pz2-stage-title"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                // Enter добавляет, Esc отменяет — форма открывается на месте, и
                // выходить из неё мышью каждый раз не нужно.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addStage();
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  setTitle('');
                  closeAddForm();
                }
              }}
              placeholder="Например: Участок Хабаровск — Бикин"
              value={title}
            />
            <div className="stage-add-form__actions">
              <button className="button button--primary" disabled={!title.trim()} onClick={addStage} type="button">
                Добавить
              </button>
              <button
                className="button button--outline"
                onClick={() => {
                  setTitle('');
                  closeAddForm();
                }}
                type="button"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button
            className="button button--outline stage-add-row"
            onClick={() => setIsAdding(true)}
            ref={addButtonRef}
            type="button"
          >
            + Добавить этап
          </button>
        )}

        {worksWithoutSpan > 0 ? (
          <p className="status-note">
            На карте показаны только работы, намеренные линейкой. Работ, введённых руками, — {worksWithoutSpan}: где они
            на трассе, неизвестно.
          </p>
        ) : null}

        {draft.stages.length === 0 ? (
          <p className="status-note">
            Этапов пока нет. Трассу делят на участки, которые строят одновременно: на Москве — Санкт-Петербурге их
            семь-девять.
          </p>
        ) : (
          <ul className="stage-list">
            {draft.stages.map((stage) => {
              const works = getPz2StageWorks(draft, stage.id);

              return (
                <li
                  className={`stage-card${dropTargetId === stage.id ? ' is-drop-target' : ''}`}
                  key={stage.id}
                  onMouseEnter={() => setHoveredStageId(stage.id)}
                  onMouseLeave={() => setHoveredStageId('')}
                  {...dropHandlers(stage.id)}
                >
                  <div className="stage-card__head">
                    <span
                      aria-hidden="true"
                      className="stage-card__color"
                      style={{ background: getPz2StageColor(stage.order) }}
                    />
                    {/* Название правится на месте: из-за опечатки этап не должен
                        пересоздаваться — вместе с ним уехали бы и работы. */}
                    <input
                      aria-label={`Название этапа ${stage.order + 1}`}
                      className="stage-card__title"
                      onChange={(event) =>
                        updateDraft((current) => renamePz2Stage(current, stage.id, event.target.value))
                      }
                      value={stage.title}
                    />
                    <span className="stage-card__meta">{describeWorks(works)}</span>
                    <button
                      aria-label={`Удалить этап ${stage.title}`}
                      className="data-entry__remove-column"
                      onClick={() => updateDraft((current) => removePz2Stage(current, stage.id))}
                      type="button"
                    >
                      ×
                    </button>
                  </div>

                  {works.length === 0 ? (
                    <p className="stage-drop-hint">Перетащите сюда работы из пула</p>
                  ) : (
                    <ul className="work-cards">
                      {works.map((work) => (
                        <WorkCard
                          draft={draft}
                          isDragging={draggedId === work.id}
                          key={work.id}
                          onDragStart={setDraggedId}
                          onMove={moveWork}
                          stageColor={getPz2StageColor(stage.order)}
                          work={work}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        className={`form-section work-pool${dropTargetId === null ? ' is-drop-target' : ''}`}
        {...dropHandlers(null)}
      >
        <div className="osm-map-card__head">
          <div>
            <p className="eyebrow">Пул работ</p>
            <h3>Ещё не разнесены по этапам</h3>
          </div>
          <span className="stage-card__meta">{describeWorks(poolWorks)}</span>
        </div>

        {poolWorks.length === 0 ? (
          <p className="status-note">
            {draft.works.length === 0
              ? 'Работ нет — вернитесь на шаг «Работы» и перечислите их.'
              : 'Все работы разнесены по этапам.'}
          </p>
        ) : (
          <ul className="work-cards">
            {poolWorks.map((work) => (
              <WorkCard
                draft={draft}
                isDragging={draggedId === work.id}
                key={work.id}
                onDragStart={setDraggedId}
                onMove={moveWork}
                work={work}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface WorkCardProps {
  draft: Pz2Draft;
  work: Pz2WorkDraft;
  /** Карточка сейчас переносится: на прежнем месте от неё остаётся след. */
  isDragging: boolean;
  /**
   * Цвет этапа, которому принадлежит работа. У карточки в пуле его нет — она
   * ничьей и остаётся серой. Полоска повторяет цвет квадратика этапа и его
   * участка на карте: до этого все карточки были красными, и по цвету нельзя
   * было понять, где чья.
   */
  stageColor?: string;
  onDragStart: (workId: string) => void;
  onMove: (workId: string, stageId: string | null) => void;
}

function WorkCard({ draft, work, isDragging, stageColor, onDragStart, onMove }: WorkCardProps) {
  const kind = getPz2WorkKind(work.kind);
  const conditions = pz2SoilConditions.filter((item) => work.conditions.includes(item.id));

  return (
    <li
      className={`work-card${isDragging ? ' is-ghost' : ''}`}
      draggable
      style={stageColor ? { borderLeftColor: stageColor } : undefined}
      onDragEnd={() => onDragStart('')}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', work.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(work.id);
      }}
    >
      <div>
        <strong>{kind.label}</strong>
        <span className="work-card__meta">{describeWork(work)}</span>
        {work.span ? <span className="work-card__meta">{describeSpan(work.span)}</span> : null}
      </div>

      {conditions.length > 0 ? (
        <span className="work-card__conditions">
          {conditions.map((item) => (
            <span className="work-card__pill" key={item.id} title={item.hint}>
              {item.label}
            </span>
          ))}
        </span>
      ) : null}

      {/* Запасной путь к тому же действию: мышью в карточку можно и не попасть,
          а с клавиатуры перетаскивание недоступно вовсе. */}
      <select
        aria-label={`Этап для работы «${kind.label}»`}
        onChange={(event) => onMove(work.id, event.target.value || null)}
        value={work.stageId ?? ''}
      >
        <option value="">В пуле</option>
        {draft.stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.title}
          </option>
        ))}
      </select>
    </li>
  );
}

/** Где работа лежит на трассе — по нему и решают, какому этапу она принадлежит. */
function describeSpan(span: NonNullable<Pz2WorkDraft['span']>) {
  const from = Math.min(span.fromKm, span.toKm);
  const to = Math.max(span.fromKm, span.toKm);

  return `${formatPz2Km(from).replace(' км', '')} — ${formatPz2Km(to)} трассы`;
}

function describeWork(work: Pz2WorkDraft) {
  const kind = getPz2WorkKind(work.kind);

  if (kind.measure === 'count') {
    return `${parsePz2Number(work.count) ?? 0} шт.`;
  }

  return formatPz2Km(parsePz2Number(work.lengthKm) ?? 0);
}

/** Сводка по этапу: сколько работ и сколько в них километров. */
function describeWorks(works: Pz2WorkDraft[]) {
  if (works.length === 0) {
    return 'пусто';
  }

  const lengthKm = works.reduce(
    (sum, work) =>
      getPz2WorkKind(work.kind).measure === 'length' ? sum + (parsePz2Number(work.lengthKm) ?? 0) : sum,
    0,
  );

  return `${works.length} ${pluralWorks(works.length)} · ${formatPz2Km(lengthKm)}`;
}
