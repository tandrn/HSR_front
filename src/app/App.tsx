import { Suspense, useEffect } from 'react';
import { moduleRegistry } from '../modules/registry';
import type { PzNumber } from '../modules/types';

export function App() {
  const requestedPz = new URLSearchParams(window.location.search).get('pz');
  const pzNumber = readPzNumber(window.location.search);
  const module = pzNumber === null ? undefined : moduleRegistry[pzNumber];

  useEffect(() => {
    document.title = module ? `ВСМ — ${module.shortTitle}` : 'ВСМ — модуль не найден';
  }, [module]);

  if (!module) {
    return <ModuleNotFound requestedPz={requestedPz} />;
  }

  const SelectedModule = module.Component;

  return (
    <Suspense fallback={<ModuleLoading title={module.title} />}>
      <SelectedModule />
    </Suspense>
  );
}

function readPzNumber(search: string): PzNumber | null {
  const rawValue = new URLSearchParams(search).get('pz');
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    return null;
  }

  return parsed as PzNumber;
}

/** Пока модуль едет: та же рамка, что у экрана задания, — без пустого мига. */
function ModuleLoading({ title }: { title: string }) {
  return (
    <main className="module-shell module-shell--empty">
      <section className="empty-module">
        <h1>{title}</h1>
        <p>Загружается…</p>
      </section>
    </main>
  );
}

/**
 * Показываем то, что реально стоит в адресе, а не разобранное число: раньше
 * «?pz=99» сообщал «не указан», хотя номер указан — и опечатка в адресе
 * Web Object выглядела как отсутствие параметра.
 */
function ModuleNotFound({ requestedPz }: { requestedPz: string | null }) {
  const label = requestedPz === null || requestedPz.trim() === '' ? 'не указан' : requestedPz;

  return (
    <main className="module-shell module-shell--empty">
      <section className="empty-module">
        <h1>Модуль не найден</h1>
        <p>
          Параметр <code>?pz=</code> сейчас равен: <strong>{label}</strong>. Доступны модули <code>?pz=1</code> и{' '}
          <code>?pz=3</code>.
        </p>
      </section>
    </main>
  );
}
