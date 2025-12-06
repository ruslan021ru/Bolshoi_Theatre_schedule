from __future__ import annotations

from typing import Dict, Optional

from theater_sched.domain.models import Scenario, ScenarioResult


class InMemoryRepository:
	"""Простейшее in-memory хранилище сценариев и результатов.

	Подходит для MVP/демо. В продакшне заменить на БД/персистентное хранилище.
	"""
	def __init__(self) -> None:
		self._scenarios: Dict[str, Scenario] = {}
		self._results: Dict[str, ScenarioResult] = {}

	def save_scenario(self, scenario: Scenario) -> None:
		"""Сохранить/обновить сценарий по его id."""
		self._scenarios[scenario.id] = scenario

	def get_scenario(self, scenario_id: str) -> Optional[Scenario]:
		"""Вернуть сценарий по id, либо None, если не найден."""
		return self._scenarios.get(scenario_id)

	def save_result(self, result: ScenarioResult) -> None:
		"""Сохранить результат решения для сценария."""
		self._results[result.scenario_id] = result

	def get_result(self, scenario_id: str) -> Optional[ScenarioResult]:
		"""Вернуть результат для сценария, либо None, если не найден."""
		return self._results.get(scenario_id)