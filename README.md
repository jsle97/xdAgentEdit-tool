# xdAgentEdit-tool

`xdAgentEdit-tool` to CLI do edycji pojedynczego pliku kodu z pomocą modelu AI. Narzędzie działa w dwóch fazach:
1. **Planowanie** (model planner) – tworzy plan zmian.
2. **Wykonanie** (model worker/fallback) – wykonuje edycje pliku przez zestaw narzędzi (`read_file`, `str_replace`, `advanced_edit`, `bash`, `finish`).

## Jak to działa
- Uruchamiasz CLI i wskazujesz plik docelowy.
- Narzędzie tworzy kopię zapasową `*.bak`.
- Wklejasz polecenia i kończysz wpisywanie komendą `/exec`.
- Agent analizuje plik, planuje zmiany i iteracyjnie je stosuje.
- Na końcu wykonywana jest walidacja składni `node --check`.

## Konfiguracja
Konfiguracja odbywa się przez zmienne środowiskowe (plik `.env` w katalogu projektu lub lokalnie przy plikach `src/`):

- `AI_API_KEY` – klucz API
- `AI_BASE_URL` – host API (bez ścieżki)
- `EDITOR_PLANNER` – model planujący
- `EDITOR_WORKER` – model wykonawczy
- `EDITOR_FALLBACK` – model zapasowy

## Użycie
```bash
node src/agent-edit.js <ścieżka-do-pliku>
```

Przykład:
```bash
node src/agent-edit.js server.js
```

W trybie interaktywnym:
- wpisz treść zadania,
- zakończ przez `/exec` (start),
- lub `/exit` (anulowanie).
