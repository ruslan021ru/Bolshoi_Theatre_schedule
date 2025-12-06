## Theater Scheduler (MVP)

Minimal FastAPI + OR-Tools CP-SAT solver to assign productions to stages and timeslots maximizing revenue with simple constraints.

### Run

```bash
uvicorn theater_sched.api.main:app --reload --host 0.0.0.0 --port 8000
```

### Example payloads

POST `/scenarios`

```json
{
  "productions": [
    {"id": "p1", "title": "Nutcracker", "max_shows": 2},
    {"id": "p2", "title": "Aida", "max_shows": 1}
  ],
  "stages": [
    {"id": "s1", "name": "Main"},
    {"id": "s2", "name": "Chamber"}
  ],
  "timeslots": [
    {"id": "t1", "date": "2025-11-01", "label": "evening"},
    {"id": "t2", "date": "2025-11-02", "label": "evening"}
  ],
  "revenue": {
    "p1|s1|t1": 100.0,
    "p1|s2|t1": 70.0,
    "p2|s1|t1": 110.0,
    "p2|s2|t1": 60.0,
    "p1|s1|t2": 120.0,
    "p1|s2|t2": 65.0,
    "p2|s1|t2": 90.0,
    "p2|s2|t2": 55.0
  },
  "params": {"time_limit_seconds": 5}
}
```

Then:

- POST `/scenarios/{id}/solve`
- GET `/scenarios/{id}/schedule`

### Web клиент (диаграмма Ганта)

Откройте `web/index.html` в браузере (или поднимите простой статик-сервер):

```bash
python -m http.server 5500
# затем откройте http://localhost:5500/web/
```

Задайте `API base URL` (по умолчанию `http://localhost:8000`), отредактируйте JSON-поля, нажмите «Создать сценарий», затем «Составить расписание». График отрисуется справа с помощью vis-timeline.


