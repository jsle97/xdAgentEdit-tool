# Dokumentacja techniczna

## Struktura
Kod aplikacji znajduje się w katalogu `src/`:

- `src/agent-edit.js` – główny punkt wejścia CLI i orkiestracja procesu plan/execution.
- `src/agent-edit-ai.js` – konfiguracja providera AI, definicje narzędzi i wykonawca narzędzi.
- `src/agent-edit-editor.js` – publiczne API `FileEditor` do operacji na plikach.
- `src/agent-edit-editor-fnc.js` – niskopoziomowe funkcje I/O, locki, walidacje i bezpieczeństwo ścieżek.
- `src/agent-edit-helpers.js` – logowanie, kolory, diff i pomocnicze funkcje CLI.
- `src/load-env.js` – ładowanie zmiennych z pliku `.env`.

## Przepływ działania
1. **Walidacja wejścia**: `agent-edit.js` sprawdza argumenty i dostępność pliku.
2. **Backup**: tworzony jest plik `*.bak` dla bezpieczeństwa.
3. **Zebranie zadania**: interfejs `readline` zbiera instrukcje użytkownika.
4. **Planowanie**: wywołanie `callAPI()` modelem planner z pełnym kontekstem pliku.
5. **Wykonanie iteracyjne**: model worker używa narzędzi i modyfikuje plik.
6. **Kontrola jakości**: sprawdzanie składni i podsumowanie statystyk.

## Narzędzia AI (tool calling)
Zdefiniowane w `src/agent-edit-ai.js`:
- `read_file(path)`
- `str_replace(path, old_str, new_str)`
- `advanced_edit(operation, ...)`
- `bash(command)`
- `finish()`

`executeTool()` mapuje każde wywołanie narzędzia na operacje `FileEditor` lub polecenie shellowe.

## Bezpieczeństwo i niezawodność
- Ochrona przed path traversal przez `resolveSafe()` (root = `process.cwd()`).
- Atomowy zapis plików przez plik tymczasowy + rename (`atomicWriteRaw`).
- Locki per plik (`acquireLock`) i limit współbieżności (`withConcurrencyLimit`).
- Walidacja operacji batch (`validateOperation`).
- Ograniczenie rozmiaru pliku i regexów (`MAX_FILE_SIZE`, `REGEX_MAX_LENGTH`).

## Uwagi operacyjne
- Narzędzie zakłada środowisko Node.js.
- Weryfikacja składni realizowana jest przez `node --check`.
- W przypadku błędów można wrócić do kopii zapasowej `*.bak`.
