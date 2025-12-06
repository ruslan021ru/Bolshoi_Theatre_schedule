from __future__ import annotations

import uuid
from typing import Dict, List

from theater_sched.domain.models import (
	Constraints,
	FixedAssignment,
	Person,
	PersonProductionRole,
	Production,
	Role,
	Scenario,
	ScenarioParams,
	ScenarioResult,
	Stage,
	TimeSlot,
)
from theater_sched.repositories.memory import InMemoryRepository
from theater_sched.solver.cp_sat_solver import MinimalCPSATSolver


class ScenarioService:
	"""Сервис сценариев: создание, запуск решателя, выдача статуса и расписания."""
	def __init__(self, repo: InMemoryRepository) -> None:
		self._repo = repo
		self._solver = MinimalCPSATSolver()

	def create_scenario(
		self,
		productions: List[Dict],
		stages: List[Dict],
		timeslots: List[Dict],
		revenue: Dict[str, float] | None = None,
		params: Dict | None = None,
		fixed_assignments: List[Dict] | None = None,
		people: List[Dict] | None = None,
		roles: List[Dict] | None = None,
		person_production_roles: List[Dict] | None = None,
	) -> Scenario:
		"""Создать сценарий из простых словарей и сохранить его в репозитории.

		Ожидается, что ключи для revenue имеют вид "production_id|stage_id|timeslot_id".
		"""
		scenario = Scenario(
			id=str(uuid.uuid4()),
			productions=[
				Production(
					id=p["id"],
					title=p.get("title", p["id"]),
					stage_id=p.get("stage_id", ""),
					max_shows=int(p.get("max_shows", 1)),
					weekend_priority=bool(p.get("weekend_priority", False)),
				)
				for p in productions
			],
			stages=[Stage(id=s["id"], name=s.get("name", s["id"])) for s in stages],
			timeslots=[
				TimeSlot(
					id=t["id"],
					stage_id=t.get("stage_id", ""),
					date=t.get("date", t["id"]),
					day_of_week=int(t.get("day_of_week", 0)),
					start_time=t.get("start_time", "19:00"),
				)
				for t in timeslots
			],
			revenue={str(k): float(v) for k, v in (revenue or {}).items()},
			params=ScenarioParams(
				objective_weights=params.get("objective_weights", {"revenue": 1.0}) if params else {"revenue": 1.0},
				time_limit_seconds=params.get("time_limit_seconds", 5) if params else 5,
				constraints=Constraints(**params.get("constraints", {})) if params and params.get("constraints") else Constraints(),
			) if params else ScenarioParams(),
			fixed_assignments=[
				FixedAssignment(
					production_id=fa["production_id"],
					timeslot_id=fa["timeslot_id"],
					stage_id=fa.get("stage_id", ""),
					date=fa.get("date", ""),
					start_time=fa.get("start_time", "19:00"),
				)
				for fa in (fixed_assignments or [])
			],
			people=[
				Person(
					id=p["id"],
					name=p.get("name", p["id"]),
					email=p.get("email"),
				)
				for p in (people or [])
			],
			roles=[
				Role(
					id=r["id"],
					name=r.get("name", r["id"]),
					production_id=r["production_id"],
					is_conductor=bool(r.get("is_conductor", False)),
					required_count=int(r.get("required_count", 1)),
				)
				for r in (roles or [])
			],
			person_production_roles=[
				PersonProductionRole(
					person_id=ppr["person_id"],
					production_id=ppr["production_id"],
					role_id=ppr["role_id"],
					can_play=bool(ppr.get("can_play", True)),
				)
				for ppr in (person_production_roles or [])
			],
			status="created",
		)
		self._repo.save_scenario(scenario)
		return scenario

	def solve(self, scenario_id: str) -> ScenarioResult:
		"""Запустить решатель для сценария, сохранить и вернуть результат."""
		scenario = self._repo.get_scenario(scenario_id)
		if not scenario:
			raise ValueError("Scenario not found")
		scenario.status = "solving"
		self._repo.save_scenario(scenario)
		result = self._solver.solve(scenario)
		self._repo.save_result(result)
		scenario.status = "solved" if result.status != "infeasible" else "failed"
		self._repo.save_scenario(scenario)
		return result

	def get_status(self, scenario_id: str) -> Dict:
		"""Вернуть текущий статус сценария и значение цели (если есть результат)."""
		scenario = self._repo.get_scenario(scenario_id)
		if not scenario:
			raise ValueError("Scenario not found")
		result = self._repo.get_result(scenario_id)
		return {
			"scenario_id": scenario_id,
			"status": scenario.status,
			"objective_value": getattr(result, "objective_value", None),
		}

	def get_schedule(self, scenario_id: str) -> Dict:
		"""Вернуть расписание по сценарию (если решение уже получено)."""
		result = self._repo.get_result(scenario_id)
		if not result:
			raise ValueError("Result not found")
		return {
			"scenario_id": result.scenario_id,
			"status": result.status,
			"objective_value": result.objective_value,
			"schedule": [
				{
					"production_id": it.production_id,
					"stage_id": it.stage_id,
					"timeslot_id": it.timeslot_id,
					"revenue": it.revenue,
				}
				for it in result.schedule
			],
			"assignments": [
				{
					"schedule_item_id": a.schedule_item_id,
					"production_id": a.production_id,
					"timeslot_id": a.timeslot_id,
					"stage_id": a.stage_id,
					"person_id": a.person_id,
					"role_id": a.role_id,
					"is_conductor": a.is_conductor,
				}
				for a in result.assignments
			],
		}


