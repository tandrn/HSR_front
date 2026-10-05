import { useState } from 'react';
import type { ReactNode } from 'react';
import { useModuleState } from '../../bridge/context';
import type { ModulePhase } from '../../bridge/context';
import { ProgressRoute } from './ProgressRoute';
import { StepHeader } from './StepHeader';

export interface ModuleTaskStep {
  id: string;
  title: string;
  goal: string;
  content: ReactNode;
  isComplete?: boolean;
  completionHint?: string;
  /**
   * Что писать под шагом, который пропускает дальше. Пусто — «шаг завершён».
   *
   * Шаг может пускать вперёд и при этом быть заполнен не до конца: так задумано
   * там, где значений по умолчанию нет, а придумывать их за студента нельзя.
   * Писать в таком случае «шаг завершён» — неправда, поэтому шаг может сказать
   * о себе точнее.
   */
  readyHint?: string;
}

interface ModuleShellProps {
  title: string;
  subtitle: string;
  intro: ReactNode;
  introComplete?: boolean;
  introCompletionHint?: string;
  theory: ReactNode;
  taskSteps: ModuleTaskStep[];
  result: ReactNode;
  onSaveDraft?: () => void;
}

export function ModuleShell({
  title,
  subtitle,
  intro,
  introComplete = true,
  introCompletionHint = 'Заполните паспорт работы, чтобы начать сценарий.',
  theory,
  taskSteps,
  result,
  onSaveDraft,
}: ModuleShellProps) {
  const { phase, currentStepIndex, theorySeen, setPhase, setCurrentStepIndex, setTheorySeen } = useModuleState<unknown>();
  const [theoryOpen, setTheoryOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const activeTaskStep = taskSteps[currentStepIndex] ?? taskSteps[0];
  const activeTaskStepComplete = activeTaskStep?.isComplete ?? true;
  const canGoForward =
    phase === 'intro' ? introComplete : phase === 'task' ? theorySeen && activeTaskStepComplete : false;
  const progressHint = getProgressHint({
    activeTaskStep,
    activeTaskStepComplete,
    introComplete,
    introCompletionHint,
    phase,
    theorySeen,
  });

  function goBack() {
    if (phase === 'result') {
      setPhase('task');
      setCurrentStepIndex(Math.max(0, taskSteps.length - 1));
      return;
    }

    if (phase === 'task' && currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      return;
    }

    if (phase === 'task') {
      setPhase('intro');
      setTheoryOpen(false);
    }
  }

  function goForward() {
    if (!canGoForward) {
      return;
    }

    if (phase === 'intro') {
      // Шаг не сбрасываем на первый: сюда попадают и те, кто заглянул на интро
      // с середины задания, и те, кто загрузил файл и возвращается на своё
      // место. Раньше и тех и других отбрасывало на шаг 01.
      setPhase('task');
      setCurrentStepIndex(Math.min(Math.max(currentStepIndex, 0), taskSteps.length - 1));
      setTheoryOpen(!theorySeen);
      return;
    }

    if (phase === 'task' && currentStepIndex < taskSteps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      return;
    }

    if (phase === 'task') {
      setPhase('result');
    }
  }

  return (
    <main className={`module-shell module-shell--${phase}`}>
      {phase === 'intro' ? (
        <header className="module-topline">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <ProgressRoute activePhase={phase} />
        </header>
      ) : (
        <header className="module-workbar">
          <div className="module-workbar__title">
            <strong>{title}</strong>
          </div>
          <ProgressRoute activePhase={phase} />
          {phase === 'task' ? (
            <button className="button button--ghost" onClick={() => setTheoryOpen(true)} type="button">
              Теория
            </button>
          ) : null}
        </header>
      )}

      <section className="module-canvas">
        {phase === 'intro' && <PhasePanel phase="intro">{intro}</PhasePanel>}
        {phase === 'task' && activeTaskStep && (
          <PhasePanel phase="task">
            <StepHeader
              goal={activeTaskStep.goal}
              stepNumber={currentStepIndex + 1}
              title={activeTaskStep.title}
              totalSteps={taskSteps.length}
            />
            {activeTaskStep.content}
          </PhasePanel>
        )}
        {phase === 'result' && <PhasePanel phase="result">{result}</PhasePanel>}
      </section>

      {phase === 'result' ? (
        <footer className="module-actions module-actions--result">
          <button className="button button--outline" onClick={goBack} type="button">
            ← Вернуться к редактированию
          </button>
          <span className="module-actions__hint">Можно изменить данные и снова перейти к итогу.</span>
        </footer>
      ) : (
        <footer className="module-actions">
          <button className="button button--outline" disabled={phase === 'intro'} onClick={goBack} type="button">
            ← Назад
          </button>
          <span className="module-actions__hint">{saveStatus || progressHint}</span>
          {phase === 'task' && onSaveDraft ? (
            <button
              className="button button--secondary"
              onClick={() => {
                onSaveDraft();
                setSaveStatus(`Сохранено, ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
              }}
              type="button"
            >
              Сохранить
            </button>
          ) : null}
          <button className="button button--primary" disabled={!canGoForward} onClick={goForward} type="button">
            {getPrimaryActionLabel(phase, currentStepIndex, taskSteps.length)}
          </button>
        </footer>
      )}

      {phase === 'task' && theoryOpen ? (
        <TheoryOverlay
          onComplete={() => {
            setTheorySeen(true);
            setTheoryOpen(false);
          }}
        >
          {theory}
        </TheoryOverlay>
      ) : null}
    </main>
  );
}

function PhasePanel({ children, phase }: { children: ReactNode; phase: ModulePhase }) {
  return <div className={`phase-panel phase-panel--${phase}`}>{children}</div>;
}

function TheoryOverlay({ children, onComplete }: { children: ReactNode; onComplete: () => void }) {
  return (
    <div className="theory-overlay" role="dialog" aria-labelledby="theory-overlay-title" aria-modal="true">
      <div className="theory-overlay__scrim" />
      <section className="theory-panel">
        <header className="theory-panel__head">
          <h2 id="theory-overlay-title">Теория перед заданием</h2>
        </header>
        <div className="theory-panel__body">{children}</div>
        <footer className="theory-panel__actions">
          <span>После этого откроется выполнение текущего шага.</span>
          <button className="button button--primary" onClick={onComplete} type="button">
            Вернуться к заданию
          </button>
        </footer>
      </section>
    </div>
  );
}

function getPrimaryActionLabel(phase: ModulePhase, currentStepIndex: number, taskStepCount: number) {
  if (phase === 'intro') {
    return 'Начать';
  }

  if (currentStepIndex >= taskStepCount - 1) {
    return 'К итогу';
  }

  return 'Далее →';
}

function getProgressHint({
  activeTaskStep,
  activeTaskStepComplete,
  introComplete,
  introCompletionHint,
  phase,
  theorySeen,
}: {
  activeTaskStep?: ModuleTaskStep;
  activeTaskStepComplete: boolean;
  introComplete: boolean;
  introCompletionHint: string;
  phase: ModulePhase;
  theorySeen: boolean;
}) {
  if (phase === 'intro') {
    return introComplete ? 'Паспорт готов, можно начать.' : introCompletionHint;
  }

  if (!theorySeen) {
    return 'Откройте теорию и подтвердите переход к практике.';
  }

  if (!activeTaskStepComplete) {
    return activeTaskStep?.completionHint ?? 'Завершите текущий шаг, чтобы продолжить.';
  }

  return activeTaskStep?.readyHint ?? 'Шаг завершён, можно двигаться дальше.';
}
