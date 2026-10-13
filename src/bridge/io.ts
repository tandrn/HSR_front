import type { BridgeSchema, BridgeSchemaVersion, Passport } from './schema';

const CURRENT_SCHEMA_VERSION: BridgeSchemaVersion = '1.2';
/**
 * Читаем и прежние версии. Сохранения прежнего номера задания переносим
 * на актуальный ключ при загрузке; версия схемы при этом не меняется.
 */
const SUPPORTED_SCHEMA_VERSIONS: BridgeSchemaVersion[] = ['1.0', '1.1', CURRENT_SCHEMA_VERSION];

export function createBridge(
  passport: Passport,
  completed: BridgeSchema['completed'] = {},
  progress?: BridgeSchema['progress'],
  position?: BridgeSchema['position'],
): BridgeSchema {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    passport,
    savedAt: new Date().toISOString(),
    ...(progress ? { progress } : {}),
    ...(position ? { position } : {}),
    completed,
  };
}

export function serializeBridge(bridge: BridgeSchema): string {
  return `${JSON.stringify(bridge, null, 2)}\n`;
}

/**
 * Разбор файла задания.
 *
 * Сообщения об отказе читает студент, а не разработчик: «мост» и
 * «schemaVersion» — наши внутренние слова, по ним нельзя понять, что делать
 * дальше. Поэтому каждый отказ называет причину обычными словами и говорит,
 * какой файл нужен.
 */
export function parseBridgeJson(input: string): BridgeSchema {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(`Файл повреждён и не читается. ${EXPECTED_FILE_HINT}`);
  }

  if (!isBridgeSchema(parsed)) {
    const version = isRecord(parsed) && typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : null;

    // Файл нашего формата, но другой версии — это не «чужой файл», и советовать
    // сохранить заново тут неправильно: сохранять, возможно, нечего.
    if (version && !SUPPORTED_SCHEMA_VERSIONS.includes(version as BridgeSchemaVersion)) {
      throw new Error(
        `Файл сохранён версией задания ${version}, а эта версия открывает ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}. Откройте файл в той версии, где он был сохранён.`,
      );
    }

    throw new Error(`Это не файл задания. ${EXPECTED_FILE_HINT}`);
  }

  return migrateLegacyModuleKey(parsed);
}

/** Старые файлы хранили текущий модуль под номером 2. */
function migrateLegacyModuleKey(bridge: BridgeSchema): BridgeSchema {
  const legacyKey = 'pz2';
  const migrateSection = (section: Record<string, unknown> | undefined) => {
    if (!section || !(legacyKey in section)) return section;
    const { [legacyKey]: legacyValue, ...current } = section;
    return { ...current, pz3: current.pz3 ?? legacyValue };
  };

  return {
    ...bridge,
    completed: migrateSection(bridge.completed) as BridgeSchema['completed'],
    ...(bridge.progress ? { progress: migrateSection(bridge.progress) as BridgeSchema['progress'] } : {}),
    ...(bridge.position ? { position: migrateSection(bridge.position) as BridgeSchema['position'] } : {}),
  };
}

/** Что именно нужно загрузить — повторяется во всех отказах, чтобы не гадать. */
const EXPECTED_FILE_HINT = 'Загрузите JSON, сохранённый кнопкой «Скачать JSON» в конце задания.';

export function downloadBridgeJson(bridge: BridgeSchema, fileName = 'vsm-bridge.json'): void {
  downloadTextFile(fileName, 'application/json;charset=utf-8', serializeBridge(bridge));
}

export function downloadTextFile(fileName: string, mimeType: string, content: string | ArrayBuffer): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Браузер может начать чтение blob уже после click(). Немедленный revoke
  // срывал загрузку в отдельных Windows/WebView окружениях.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isBridgeSchema(value: unknown): value is BridgeSchema {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.schemaVersion === 'string' &&
    SUPPORTED_SCHEMA_VERSIONS.includes(value.schemaVersion as BridgeSchemaVersion) &&
    isPassport(value.passport) &&
    isRecord(value.completed)
  );
}

function isPassport(value: unknown): value is Passport {
  if (!isRecord(value)) {
    return false;
  }

  const defaultVariantIsValid = value.defaultVariant === undefined || typeof value.defaultVariant === 'number';

  return (
    typeof value.team === 'string' &&
    typeof value.lineTitle === 'string' &&
    typeof value.createdAt === 'string' &&
    defaultVariantIsValid
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
