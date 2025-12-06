from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Optional
import pytz

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Московский часовой пояс
MOSCOW_TZ = pytz.timezone('Europe/Moscow')

from theater_sched.repositories.memory import InMemoryRepository
from theater_sched.services.scenarios import ScenarioService
from theater_sched.domain.models import Person, Role, PersonProductionRole, Assignment


class ProductionIn(BaseModel):
	"""Входная модель для описания постановки."""
	id: str                                        # ID постановки
	title: Optional[str] = None                    # Название постановки
	stage_id: str                                  # Привязка к конкретной сцене
	max_shows: int = Field(default=1, ge=1)        # Количество последовательных показов
	weekend_priority: bool = Field(default=False)  # Приоритет на выходные дни


class StageIn(BaseModel):
	"""Входная модель для сцены/площадки."""
	id: str                                        # ID сцены
	name: Optional[str] = None                     # Название сцены


class TimeSlotIn(BaseModel):
	"""Входная модель для таймслота (даты/окна времени).
	
	Теперь каждый таймслот привязан к конкретной сцене и времени.
	"""
	id: str                                                    # ID таймслота
	stage_id: str                                              # ID сцены
	date: Optional[str] = None                                 # Дата в формате "2025-11-01"
	day_of_week: Optional[int] = Field(default=0, ge=0, le=6)  # 0=Monday, 6=Sunday
	start_time: str = "19:00"                                  # "HH:MM" - время начала


class FixedAssignmentIn(BaseModel):
	"""Входная модель для закреплённого назначения спектакля."""
	production_id: str
	timeslot_id: str
	stage_id: str
	date: str
	start_time: str


class ConstraintsIn(BaseModel):
	"""Настройки ограничений для решателя."""
	one_production_per_timeslot: bool = True
	exact_shows_count: bool = True
	consecutive_shows: bool = True
	monday_off: bool = True
	weekend_always_show: bool = True
	same_show_weekend: bool = True
	break_between_different_shows: bool = True
	weekend_priority_bonus: bool = True


class ParamsIn(BaseModel):
	"""Параметры решателя (ограничение по времени и веса целей)."""
	objective_weights: Dict[str, float] = Field(default_factory=lambda: {"revenue": 1.0})
	time_limit_seconds: int = 5
	constraints: Optional[ConstraintsIn] = None


class PersonIn(BaseModel):
	"""Входная модель для человека."""
	id: str
	name: str
	email: Optional[str] = None


class RoleIn(BaseModel):
	"""Входная модель для роли."""
	id: str
	name: str
	production_id: str
	is_conductor: bool = False
	required_count: int = Field(default=1, ge=1)


class PersonProductionRoleIn(BaseModel):
	"""Входная модель для связи человек-роль-спектакль."""
	person_id: str
	production_id: str
	role_id: str
	can_play: bool = True


class ScenarioCreateIn(BaseModel):
	"""Запрос на создание сценария.

	Ключи словаря revenue должны иметь формат "production_id|stage_id|timeslot_id".
	"""
	productions: List[ProductionIn]
	stages: List[StageIn]
	timeslots: List[TimeSlotIn]
	# revenue опционально, если не оптимизируем выручку
	revenue: Dict[str, float] = Field(default_factory=dict)
	params: Optional[ParamsIn] = None
	# Закреплённые назначения (фиксированные спектакли)
	fixed_assignments: List[FixedAssignmentIn] = Field(default_factory=list)
	# Новые поля для людей и ролей
	people: List[PersonIn] = Field(default_factory=list)
	roles: List[RoleIn] = Field(default_factory=list)
	person_production_roles: List[PersonProductionRoleIn] = Field(default_factory=list)


repo = InMemoryRepository()
svc = ScenarioService(repo)
app = FastAPI(title="Theater Scheduler API", version="0.1.0")

# Разрешаем запросы с фронтенда (при необходимости сузьте allow_origins)
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.post("/scenarios")
def create_scenario(payload: ScenarioCreateIn) -> Dict:
	"""Создать сценарий с входными данными и вернуть его идентификатор."""
	s = svc.create_scenario(
		productions=[p.model_dump() for p in payload.productions],
		stages=[s.model_dump() for s in payload.stages],
		timeslots=[t.model_dump() for t in payload.timeslots],
		revenue=payload.revenue or {},
		params=payload.params.model_dump() if payload.params else None,
		fixed_assignments=[fa.model_dump() for fa in (payload.fixed_assignments or [])],
		people=[p.model_dump() for p in (payload.people or [])],
		roles=[r.model_dump() for r in (payload.roles or [])],
		person_production_roles=[ppr.model_dump() for ppr in (payload.person_production_roles or [])],
	)
	return {"scenario_id": s.id, "status": s.status}


class SolveRequest(BaseModel):
	"""Запрос на решение сценария с настройками ограничений."""
	constraints: Optional[ConstraintsIn] = None


@app.post("/scenarios/{scenario_id}/solve")
def solve_scenario(scenario_id: str, request: Optional[SolveRequest] = None) -> Dict:
	"""Запустить оптимизацию для указанного сценария.
	
	Если переданы constraints, они будут применены к решению.
	"""
	try:
		# Если переданы ограничения, обновляем сценарий
		if request and request.constraints:
			s = repo.get_scenario(scenario_id)
			if not s:
				raise ValueError("Scenario not found")
			# Обновляем constraints в params
			from theater_sched.domain.models import Constraints
			constraints = Constraints(
				one_production_per_timeslot=request.constraints.one_production_per_timeslot,
				exact_shows_count=request.constraints.exact_shows_count,
				consecutive_shows=request.constraints.consecutive_shows,
				monday_off=request.constraints.monday_off,
				weekend_always_show=request.constraints.weekend_always_show,
				same_show_weekend=request.constraints.same_show_weekend,
				break_between_different_shows=request.constraints.break_between_different_shows,
				weekend_priority_bonus=request.constraints.weekend_priority_bonus,
			)
			s.params.constraints = constraints
			repo.save_scenario(s)  # Используем save_scenario вместо update_scenario
		
		result = svc.solve(scenario_id)
		return {
			"scenario_id": result.scenario_id,
			"status": result.status,
			"objective_value": result.objective_value,
		}
	except ValueError as e:
		raise HTTPException(status_code=404, detail=str(e))
	except Exception as e:
		import traceback
		error_detail = f"Ошибка при решении: {str(e)}"
		# В режиме разработки показываем полный traceback
		raise HTTPException(status_code=500, detail=error_detail)


@app.get("/scenarios/{scenario_id}/status")
def scenario_status(scenario_id: str) -> Dict:
	"""Получить текущий статус сценария и значение цели (если доступно)."""
	try:
		return svc.get_status(scenario_id)
	except ValueError as e:
		raise HTTPException(status_code=404, detail=str(e))


@app.get("/scenarios/{scenario_id}/schedule")
def scenario_schedule(scenario_id: str) -> Dict:
	"""Получить построенное расписание для сценария."""
	try:
		return svc.get_schedule(scenario_id)
	except ValueError as e:
		raise HTTPException(status_code=404, detail=str(e))


@app.get("/scenarios/{scenario_id}/gantt")
def scenario_gantt(scenario_id: str) -> Dict:
    """Вернёт расписание в формате задач для диаграммы Ганта.

    Формат: [{id, resource, start, end, title}]
    start/end — ISO 8601 (например, 2025-11-01T19:00:00)
    """
    try:
        schedule_data = svc.get_schedule(scenario_id)
        s = repo.get_scenario(scenario_id)
        if not s:
            raise ValueError("Scenario not found")

        ts_by_id = {t.id: t for t in s.timeslots}
        stages_by_id = {st.id: st for st in s.stages}

        def to_iso(date_str: str, hm: str | None, fallback_hm: str = "19:00") -> str:
            # Форматируем время правильно для datetime.fromisoformat в московском времени
            time_str = (hm or fallback_hm).strip()
            if len(time_str) == 5:  # "HH:MM"
                time_str = f"{time_str}:00"  # Преобразуем в "HH:MM:SS"
            # Создаем naive datetime и локализуем в московское время
            naive_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
            moscow_dt = MOSCOW_TZ.localize(naive_dt)
            # Возвращаем в ISO формате (с часовым поясом)
            return moscow_dt.isoformat()

        tasks = []
        for item in schedule_data.get("schedule", []):
            tslot = ts_by_id.get(item["timeslot_id"])  # type: ignore[index]
            if not tslot:
                continue
            # Время начала из таймслота (он уже привязан к конкретной сцене)
            start_iso = to_iso(tslot.date, tslot.start_time)
            # Для визуализации используем фиксированную длительность (3 часа)
            try:
                # Парсим дату в московском времени (to_iso уже возвращает datetime с часовым поясом)
                start_dt = datetime.fromisoformat(start_iso)
                # Если datetime naive (не должно быть, но на всякий случай), локализуем в московское время
                if start_dt.tzinfo is None:
                    start_dt = MOSCOW_TZ.localize(start_dt)
                # Добавляем 3 часа
                end_dt = start_dt + timedelta(hours=3)
                # Форматируем в ISO с часовым поясом
                end_iso = end_dt.isoformat()
            except (ValueError, TypeError) as e:
                # Если не удалось распарсить время, пропускаем этот элемент
                continue
            
            # Сцена уже в таймслоте
            stage_obj = stages_by_id.get(tslot.stage_id)
            stage_label = stage_obj.name if stage_obj else tslot.stage_id
            tasks.append(
                {
                    "id": f"{item['production_id']}|{item['stage_id']}|{item['timeslot_id']}",
                    "resource": stage_label,
                    "start": start_iso,
                    "end": end_iso,
                    "title": item["production_id"],
                }
            )

        return {"scenario_id": scenario_id, "status": schedule_data["status"], "tasks": tasks}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}\n{traceback.format_exc()}")


# Эндпоинты для управления людьми, ролями и назначениями

@app.post("/scenarios/{scenario_id}/people")
def add_person(scenario_id: str, person: PersonIn) -> Dict:
	"""Добавить человека в сценарий."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	# Проверяем, нет ли уже человека с таким ID
	if any(p.id == person.id for p in s.people):
		raise HTTPException(status_code=400, detail=f"Person with id {person.id} already exists")
	
	new_person = Person(id=person.id, name=person.name, email=person.email)
	s.people.append(new_person)
	repo.save_scenario(s)
	return {"person_id": person.id, "status": "added"}


@app.get("/scenarios/{scenario_id}/people")
def get_people(scenario_id: str) -> Dict:
	"""Получить список всех людей в сценарии."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	return {
		"scenario_id": scenario_id,
		"people": [{"id": p.id, "name": p.name, "email": p.email} for p in s.people]
	}


@app.delete("/scenarios/{scenario_id}/people/{person_id}")
def delete_person(scenario_id: str, person_id: str) -> Dict:
	"""Удалить человека из сценария."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	s.people = [p for p in s.people if p.id != person_id]
	# Также удаляем все связи с ролями
	s.person_production_roles = [ppr for ppr in s.person_production_roles if ppr.person_id != person_id]
	repo.save_scenario(s)
	return {"person_id": person_id, "status": "deleted"}


@app.post("/scenarios/{scenario_id}/roles")
def add_role(scenario_id: str, role: RoleIn) -> Dict:
	"""Добавить роль в сценарий."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	# Проверяем, что постановка существует
	if not any(p.id == role.production_id for p in s.productions):
		raise HTTPException(status_code=400, detail=f"Production {role.production_id} not found")
	
	# Проверяем, нет ли уже роли с таким ID
	if any(r.id == role.id for r in s.roles):
		raise HTTPException(status_code=400, detail=f"Role with id {role.id} already exists")
	
	new_role = Role(
		id=role.id,
		name=role.name,
		production_id=role.production_id,
		is_conductor=role.is_conductor,
		required_count=role.required_count
	)
	s.roles.append(new_role)
	repo.save_scenario(s)
	return {"role_id": role.id, "status": "added"}


@app.get("/scenarios/{scenario_id}/roles")
def get_roles(scenario_id: str, production_id: Optional[str] = None) -> Dict:
	"""Получить список ролей в сценарии (опционально фильтр по постановке)."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	roles = s.roles
	if production_id:
		roles = [r for r in roles if r.production_id == production_id]
	
	return {
		"scenario_id": scenario_id,
		"roles": [{
			"id": r.id,
			"name": r.name,
			"production_id": r.production_id,
			"is_conductor": r.is_conductor,
			"required_count": r.required_count
		} for r in roles]
	}


@app.delete("/scenarios/{scenario_id}/roles/{role_id}")
def delete_role(scenario_id: str, role_id: str) -> Dict:
	"""Удалить роль из сценария."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	s.roles = [r for r in s.roles if r.id != role_id]
	# Также удаляем все связи с людьми
	s.person_production_roles = [ppr for ppr in s.person_production_roles if ppr.role_id != role_id]
	repo.save_scenario(s)
	return {"role_id": role_id, "status": "deleted"}


@app.post("/scenarios/{scenario_id}/person-production-roles")
def set_person_production_role(scenario_id: str, ppr: PersonProductionRoleIn) -> Dict:
	"""Установить/обновить связь: кто может играть какую роль в каком спектакле."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	# Проверяем существование
	if not any(p.id == ppr.person_id for p in s.people):
		raise HTTPException(status_code=400, detail=f"Person {ppr.person_id} not found")
	if not any(p.id == ppr.production_id for p in s.productions):
		raise HTTPException(status_code=400, detail=f"Production {ppr.production_id} not found")
	if not any(r.id == ppr.role_id for r in s.roles):
		raise HTTPException(status_code=400, detail=f"Role {ppr.role_id} not found")
	
	# Удаляем существующую связь, если есть
	s.person_production_roles = [
		existing for existing in s.person_production_roles
		if not (existing.person_id == ppr.person_id and 
		        existing.production_id == ppr.production_id and 
		        existing.role_id == ppr.role_id)
	]
	
	# Добавляем новую
	new_ppr = PersonProductionRole(
		person_id=ppr.person_id,
		production_id=ppr.production_id,
		role_id=ppr.role_id,
		can_play=ppr.can_play
	)
	s.person_production_roles.append(new_ppr)
	repo.save_scenario(s)
	return {"status": "updated"}


@app.get("/scenarios/{scenario_id}/person-production-roles")
def get_person_production_roles(scenario_id: str) -> Dict:
	"""Получить все связи человек-роль-спектакль."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	return {
		"scenario_id": scenario_id,
		"person_production_roles": [{
			"person_id": ppr.person_id,
			"production_id": ppr.production_id,
			"role_id": ppr.role_id,
			"can_play": ppr.can_play
		} for ppr in s.person_production_roles]
	}


@app.get("/scenarios/{scenario_id}/assignments")
def get_assignments(scenario_id: str) -> Dict:
	"""Получить все назначения людей на роли для расписания."""
	result = repo.get_result(scenario_id)
	if not result:
		raise HTTPException(status_code=404, detail="Result not found")
	
	return {
		"scenario_id": scenario_id,
		"assignments": [{
			"schedule_item_id": a.schedule_item_id,
			"production_id": a.production_id,
			"timeslot_id": a.timeslot_id,
			"stage_id": a.stage_id,
			"person_id": a.person_id,
			"role_id": a.role_id,
			"is_conductor": a.is_conductor
		} for a in result.assignments]
	}


@app.put("/scenarios/{scenario_id}/assignments")
def update_assignment(scenario_id: str, assignment: Dict) -> Dict:
	"""Обновить назначение вручную."""
	result = repo.get_result(scenario_id)
	if not result:
		raise HTTPException(status_code=404, detail="Result not found")
	
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	schedule_item_id = assignment.get("schedule_item_id")
	person_id = assignment.get("person_id")
	role_id = assignment.get("role_id")
	
	if not schedule_item_id or not person_id or not role_id:
		raise HTTPException(status_code=400, detail="Missing required fields")
	
	# Находим существующее назначение
	found = False
	for a in result.assignments:
		if a.schedule_item_id == schedule_item_id and a.role_id == role_id:
			a.person_id = person_id
			found = True
			break
	
	if not found:
		# Создаём новое назначение
		# Нужно найти соответствующий элемент расписания
		schedule_item = None
		for item in result.schedule:
			item_id = f"{item.production_id}|{item.stage_id}|{item.timeslot_id}"
			if item_id == schedule_item_id:
				schedule_item = item
				break
		
		if not schedule_item:
			raise HTTPException(status_code=400, detail="Schedule item not found")
		
		# Находим роль, чтобы определить is_conductor
		role = next((r for r in s.roles if r.id == role_id), None)
		if not role:
			raise HTTPException(status_code=400, detail="Role not found")
		
		new_assignment = Assignment(
			scenario_id=scenario_id,
			schedule_item_id=schedule_item_id,
			production_id=schedule_item.production_id,
			timeslot_id=schedule_item.timeslot_id,
			stage_id=schedule_item.stage_id,
			person_id=person_id,
			role_id=role_id,
			is_conductor=role.is_conductor
		)
		result.assignments.append(new_assignment)
	
	repo.save_result(result)
	return {"status": "updated"}


@app.post("/scenarios/{scenario_id}/auto-generate-roles")
def auto_generate_roles(scenario_id: str) -> Dict:
	"""Автоматически сгенерировать роли для всех постановок на основе их названий."""
	s = repo.get_scenario(scenario_id)
	if not s:
		raise HTTPException(status_code=404, detail="Scenario not found")
	
	from theater_sched.services.role_generator import generate_roles_for_production
	
	generated_roles = []
	for production in s.productions:
		roles = generate_roles_for_production(production)
		for role in roles:
			# Проверяем, нет ли уже такой роли
			if not any(r.id == role.id for r in s.roles):
				s.roles.append(role)
				generated_roles.append({
					"id": role.id,
					"name": role.name,
					"production_id": role.production_id,
					"is_conductor": role.is_conductor,
					"required_count": role.required_count
				})
	
	repo.save_scenario(s)
	return {
		"scenario_id": scenario_id,
		"generated_roles": generated_roles,
		"count": len(generated_roles)
	}

