from __future__ import annotations

"""
Доменные модели (минимальный набор) для описания сценария планирования.

Содержат постановки, сцены, таймслоты, параметры сценария, а также результат расписания.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Production:
	"""Постановка"""
	id: str                      	 # ID постановки
	title: str                       # Название постановки
	stage_id: str                    # ID сцены
	max_shows: int = 1               # Требуемое количество показов
	weekend_priority: bool = False   # Приоритет на выходные дни

@dataclass
class TimeSlot:
	"""Дискретный слот времени для показа.
	
	Каждый таймслот привязан к конкретной сцене и времени начала.
	"""
	id: str                        # ID таймслота
	stage_id: str                  # ID сцены
	date: str                      # ISO date string, "2025-11-01"
	day_of_week: int = 0           # 0=Monday, 6=Sunday
	start_time: str = "19:00"      # "HH:MM" - время начала для этой сцены

@dataclass
class Stage:
	"""Сцена"""
	id: str    # ID сцены
	name: str  # Название сцены


@dataclass
class FixedAssignment:
	"""Закреплённое назначение спектакля на конкретную дату, время и сцену.
	
	Используется для предварительного закрепления определённых спектаклей
	на определённые таймслоты. Солвер должен учитывать эти назначения
	как жёсткие ограничения.
	"""
	production_id: str      # ID постановки
	timeslot_id: str        # ID таймслота
	stage_id: str           # ID сцены
	date: str               # Дата в формате "2025-11-01"
	start_time: str         # "HH:MM" - время начала


@dataclass
class Constraints:
	"""Настройки ограничений для решателя.
	
	Все ограничения включены по умолчанию (True).
	"""
	# Жёсткие ограничения
	one_production_per_timeslot: bool = True  # В каждом таймслоте максимум одна постановка
	exact_shows_count: bool = True  # Точное количество показов для каждой постановки
	consecutive_shows: bool = True  # Все показы одного спектакля должны идти подряд
	monday_off: bool = True  # Понедельник — выходной день
	weekend_always_show: bool = True  # В выходные всегда должен быть спектакль
	same_show_weekend: bool = True  # Если спектакль идет в субботу, то он должен идти и в воскресенье (и наоборот) ?
	
	# Мягкие ограничения
	break_between_different_shows: bool = True  # Перерыв между разными спектаклями
	weekend_priority_bonus: bool = True  # Бонус для спектаклей с приоритетом на выходные


@dataclass
class ScenarioParams:
	"""Параметры расчёта: веса целей и ограничения времени."""
	objective_weights: Dict[str, float] = field(default_factory=lambda: {"revenue": 1.0})  # зачем ?
	time_limit_seconds: float = 7.0                                                            
	constraints: Constraints = field(default_factory=Constraints)


@dataclass
class Scenario:
	"""Класс для составления расписания со всеми входными данными для решателя"""
	id: str                                                                      # ID сценария
	productions: List[Production]                                                # Постановки
	stages: List[Stage]                                                          # Сцены
	timeslots: List[TimeSlot]                                                    # Таймслоты
	# revenue[(production_id, stage_id, timeslot_id)] = float                      зачем ?
	revenue: Dict[str, float]                                                    # зачем ?
	params: ScenarioParams = field(default_factory=ScenarioParams)               # зачем ?
	fixed_assignments: List[FixedAssignment] = field(default_factory=list)       # закпрепленные комментарии
	status: str = "created"                                                      # статус создания
	# Новые поля для управления людьми и ролями
	people: List[Person] = field(default_factory=list)                           # Люди (персонал)
	roles: List[Role] = field(default_factory=list)                              # Роли для постановок
	person_production_roles: List[PersonProductionRole] = field(default_factory=list)  # Кто может играть какую роль


# Классы для хранения составленного расписания

@dataclass
class ScheduleItem:
	"""Элемент расписания: одно назначение постановки на сцену и слот."""
	scenario_id: str
	production_id: str
	stage_id: str
	timeslot_id: str
	revenue: float


@dataclass
class ScenarioResult:
	"""Результат решения сценария: список назначений и значение цели."""
	scenario_id: str
	schedule: List[ScheduleItem]
	objective_value: float
	status: str
	assignments: List[Assignment] = field(default_factory=list)  # Назначения людей на роли


# Модели для управления людьми и ролями

@dataclass
class Person:
	"""Человек (персонал театра)."""
	id: str
	name: str
	email: Optional[str] = None


@dataclass
class Role:
	"""Роль в спектакле (например, "Принц", "Фея", "Дирижер")."""
	id: str
	name: str  # Название роли
	production_id: str  # К какой постановке относится роль
	is_conductor: bool = False  # Является ли роль дирижером
	required_count: int = 1  # Сколько человек требуется на эту роль


@dataclass
class PersonProductionRole:
	"""Связь: кто может играть какую роль в каком спектакле (редактируется вручную)."""
	person_id: str
	production_id: str
	role_id: str
	can_play: bool = True  # Может ли этот человек играть эту роль в этом спектакле


@dataclass
class Assignment:
	"""Назначение человека на роль/дирижера для конкретного показа."""
	scenario_id: str
	schedule_item_id: str  # ID элемента расписания (production_id|stage_id|timeslot_id)
	production_id: str
	timeslot_id: str
	stage_id: str
	person_id: str
	role_id: str
	is_conductor: bool = False


