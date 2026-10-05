import type { ModulePhase } from '../../bridge/context';

type ProgressPhase = ModulePhase | 'theory';

interface ProgressStop {
  phase: ProgressPhase;
  label: string;
}

const STOPS: ProgressStop[] = [
  { phase: 'intro', label: 'Интро' },
  { phase: 'theory', label: 'Теория' },
  { phase: 'task', label: 'Задание' },
  { phase: 'result', label: 'Итог' },
];

interface ProgressRouteProps {
  activePhase: ModulePhase;
  theoryComplete: boolean;
}

export function ProgressRoute({ activePhase, theoryComplete }: ProgressRouteProps) {
  const activeIndex = Math.max(
    0,
    STOPS.findIndex((stop) => stop.phase === getVisualPhase(activePhase, theoryComplete)),
  );

  return (
    <nav className="progress-route" aria-label="Прогресс модуля">
      <ol>
        {STOPS.map((stop, index) => {
          const stateClass = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-current' : '';

          return (
            <li aria-current={index === activeIndex ? 'step' : undefined} className={stateClass} key={stop.phase}>
              <span aria-hidden="true">{index < activeIndex ? '✓' : index + 1}</span>
              <b>{stop.label}</b>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function getVisualPhase(activePhase: ModulePhase, theoryComplete: boolean): ProgressPhase {
  if (activePhase === 'task' && !theoryComplete) {
    return 'theory';
  }

  return activePhase;
}
