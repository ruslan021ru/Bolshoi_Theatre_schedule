from __future__ import annotations
from collections import defaultdict
from typing import Dict, List, Tuple
from ortools.sat.python import cp_model

from theater_sched.domain.models import (
	Assignment,
	FixedAssignment,
	Person,
	PersonProductionRole,
	Production,
	Role,
	ScheduleItem,
	Scenario,
	ScenarioResult,
	TimeSlot,
)


def _key(p: str, s: str, t: str) -> str:
	return f"{p}|{s}|{t}"


class MinimalCPSATSolver:
	def solve(self, scenario: Scenario) -> ScenarioResult:
		model = cp_model.CpModel()

		# Вытаскиваем данные из созданного сценария
		productions: List[Production] = scenario.productions
		timeslots: List[TimeSlot] = scenario.timeslots
		constraints = scenario.params.constraints        # зачем ?
		fixed_assignments: List[FixedAssignment] = scenario.fixed_assignments or []

		# Инициализация переменных для модели
		x: Dict[Tuple[str, str], cp_model.IntVar] = {}
		for p in productions:
			for t in timeslots:
				if p.stage_id == t.stage_id:
					x[(p.id, t.id)] = model.NewBoolVar(f"x_{p.id}_{t.id}")

		# Жесткие ограничения:

		# Учёт фиксированных спектаклей
		for fa in fixed_assignments:
			var = x.get((fa.production_id, fa.timeslot_id))
			if var is not None: model.Add(var == 1)
			else: raise Exception("Входные данные не согласованы")

		# Каждый таймслот -> максимум одна постановка
		for t in timeslots:
			relevant_prods = [p for p in productions if p.stage_id == t.stage_id]
			if relevant_prods:
				slot_vars = [x.get((p.id, t.id)) for p in relevant_prods if x.get((p.id, t.id)) is not None]
				if slot_vars: model.Add(sum(slot_vars) <= 1)

		# Учёт требуемого количества постановок
		for p in productions:
			relevant_slots = [t for t in timeslots if t.stage_id == p.stage_id]
			prod_vars = [x.get((p.id, t.id)) for t in relevant_slots if x.get((p.id, t.id)) is not None]
			if prod_vars: model.Add(sum(prod_vars) == p.max_shows)
			else: raise Exception("Для данной сцены нет таймслотов")

		# Понедельник - выходной день
		if constraints.monday_off:
			for t in timeslots:
				if t.day_of_week == 0:
					relevant_prods = [p for p in productions if p.stage_id == t.stage_id]
					prod_vars = [x.get((p.id, t.id)) for p in relevant_prods if x.get((p.id, t.id)) is not None]
					model.Add(sum(prod_vars) == 0)

		# Показы спектаклей идут подряд
		if constraints.consecutive_shows:
			for p in productions:
				if p.max_shows <= 1: continue
				ts_for_prod = sorted([t for t in timeslots if t.stage_id == p.stage_id],
									  key=lambda ts: (ts.date, ts.start_time))
				
				start_vars = {}
				for i in range(len(ts_for_prod)-p.max_shows+1):
					start_var = model.NewBoolVar(f"start_{p.id}_{ts_for_prod[i].id}")
					start_vars[ts_for_prod[i].id] = start_var
					
					# после открывающего спектакля -> все остальные идут за ним
					for j in range(p.max_shows):
						var = x.get((p.id, ts_for_prod[i + j].id))
						if var is not None: model.Add(var >= start_var)

				# одно начало последовательности
				model.Add(sum(start_vars.values()) == 1)


		# Мягкие ограничения (максимизация)

		# Заполнение каждого слота в выходной день
		weekend_empty_penalty: List[cp_model.LinearExpr] = []
		if constraints.weekend_always_show:
			for t in [t for t in timeslots if t.day_of_week in (5, 6)]:
				relevant_prods = [p for p in productions if p.stage_id == t.stage_id]
				slot_vars = [x.get((p.id, t.id)) for p in relevant_prods if x.get((p.id, t.id)) is not None]
				if slot_vars:
					weekend_empty_penalty.append(1 - sum(slot_vars))

		# Учёт приоритета для спектаклей выходного дня
		weekend_priority_bonus: List[cp_model.LinearExpr] = []
		if constraints.weekend_priority_bonus:
			slots_by_stage = defaultdict(list)
			for t in (t for t in timeslots if t.day_of_week in (5, 6)):
				slots_by_stage[t.stage_id].append(t)

			for p in (p for p in productions if p.weekend_priority):
				weekend_slot_vars = []
				for slot in slots_by_stage[p.stage_id]:
					var = x.get((p.id, slot.id))
					if var is not None: weekend_slot_vars.append(var)

				weekend_priority_bonus.append(sum(weekend_slot_vars))

		# Мягкое ограничение: между РАЗНЫМИ спектаклями желателен пустой слот (перерыв)
		# Реализуем штраф за отсутствие пустого слота между разными спектаклями на буднях (Вт–Пт)
		penalty_terms: List[cp_model.LinearExpr] = []
		if constraints.break_between_different_shows:
			# Группируем таймслоты по сцене
			slots_by_stage: Dict[str, List[TimeSlot]] = defaultdict(list)
			for t in timeslots:
				if t.day_of_week in [0, 1, 2, 3, 4, 5, 6]:  # Вт-Пт, исключаем понедельник и выходные
					slots_by_stage[t.stage_id].append(t)
			# Для каждой сцены рассматриваем соседние по времени слоты
			for stage_id, stage_slots in slots_by_stage.items():
				stage_slots.sort(key=lambda ts: (ts.date, ts.start_time))
				for i in range(len(stage_slots) - 1):
					t1, t2 = stage_slots[i], stage_slots[i + 1]
					# A = назначен ли кто-то в t1; B = назначен ли кто-то в t2
					A_vars = [x.get((p.id, t1.id)) for p in productions if p.stage_id == stage_id]
					B_vars = [x.get((p.id, t2.id)) for p in productions if p.stage_id == stage_id]
					A_vars = [v for v in A_vars if v is not None]
					B_vars = [v for v in B_vars if v is not None]
					if not A_vars or not B_vars:
						continue
					A_sum = sum(A_vars)
					B_sum = sum(B_vars)
					# both_assigned = AND(A_sum==1, B_sum==1) через стандартную линейную релаксацию
					both_assigned = model.NewBoolVar(f"both_assigned_{stage_id}_{t1.id}_{t2.id}")
					model.Add(both_assigned <= A_sum)
					model.Add(both_assigned <= B_sum)
					model.Add(both_assigned >= A_sum + B_sum - 1)
					# same_prod = существует p, такой что x[p,t1]==1 и x[p,t2]==1
					same_terms: List[cp_model.IntVar] = []
					for p in productions:
						if p.stage_id != stage_id:
							continue
						v1 = x.get((p.id, t1.id))
						v2 = x.get((p.id, t2.id))
						if v1 is None or v2 is None:
							continue
						y = model.NewBoolVar(f"same_{p.id}_{t1.id}_{t2.id}")
						model.Add(y <= v1)
						model.Add(y <= v2)
						model.Add(y >= v1 + v2 - 1)
						same_terms.append(y)
					same_sum = sum(same_terms) if same_terms else 0
					# different_adjacent = both_assigned - same_sum (0/1)
					# Добавляем как штраф: если подряд идут РАЗНЫЕ спектакли без пустого слота
					penalty_terms.append(both_assigned - same_sum)
		

		# Целевая функция:

			# заполнение слотов в выходные дни    - штраф
			# приоритет выходных спектаклей       - награда
			# интервалы между разными спектаклями - штраф

		objective_terms = []
		# штраф - отсутствие перерыва между разными спектаклями
		if constraints.break_between_different_shows: objective_terms.append(-sum(penalty_terms) * 50)
		# штраф - пустые выходные слоты
		if constraints.weekend_always_show and weekend_empty_penalty: objective_terms.append(-sum(weekend_empty_penalty))
		# награда - приоритет выходных спектаклей
		if constraints.weekend_priority_bonus: objective_terms.append(sum(weekend_priority_bonus) * 100)

		model.Maximize(sum(objective_terms))

		# Запускаем решатель
		cp_solver = cp_model.CpSolver()
		cp_solver.parameters.max_time_in_seconds = scenario.params.time_limit_seconds
		cp_solver.parameters.num_search_workers = 8

		status = cp_solver.Solve(model)

		schedule: List[ScheduleItem] = []
		objective_value: float = 0.0
		if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
			# Извлекаем решение и формируем расписание
			for p in productions:
				for t in timeslots:
					if p.stage_id == t.stage_id:  # Только если сцены совпадают
						var = x.get((p.id, t.id))
						if var is not None and cp_solver.Value(var) == 1:
							rev = 0.0
							schedule.append(
								ScheduleItem(
									scenario_id=scenario.id,
									production_id=p.id,
									stage_id=t.stage_id,  # Сцена из таймслота
									timeslot_id=t.id,
									revenue=rev,
								)
							)
			# Значение цели = количество назначений
			objective_value = float(cp_solver.ObjectiveValue())
			result_status = "feasible" if status == cp_model.FEASIBLE else "optimal"
		else:
			result_status = "infeasible"

		# Распределяем людей по ролям с балансировкой нагрузки
		assignments = []
		if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) and schedule:
			assignments = _assign_people_to_roles(scenario, schedule)
		
		return ScenarioResult(
			scenario_id=scenario.id,
			schedule=sorted(
				schedule,
				key=lambda it: (it.timeslot_id, it.stage_id, it.production_id),
			),
			objective_value=objective_value,
			status=result_status,
			assignments=assignments,
		)


def _assign_people_to_roles(scenario: Scenario, schedule: List[ScheduleItem]) -> List[Assignment]:
	"""Распределяет людей по ролям для каждого показа с балансировкой нагрузки.
	
	Алгоритм:
	1. Для каждого элемента расписания находим нужные роли
	2. Для каждой роли находим людей, которые могут её играть
	3. Распределяем людей равномерно (каждый человек играет примерно одинаковое количество раз)
	"""
	from collections import defaultdict
	
	assignments = []
	
	# Группируем роли по постановкам
	roles_by_production: Dict[str, List[Role]] = defaultdict(list)
	for role in scenario.roles:
		roles_by_production[role.production_id].append(role)
	
	# Создаём словарь: кто может играть какую роль в каком спектакле
	# (person_id, production_id, role_id) -> can_play
	can_play_map: Dict[Tuple[str, str, str], bool] = {}
	for ppr in scenario.person_production_roles:
		key = (ppr.person_id, ppr.production_id, ppr.role_id)
		can_play_map[key] = ppr.can_play
	
	# Считаем, сколько раз каждый человек уже назначен (для балансировки)
	person_assignment_count: Dict[str, int] = defaultdict(int)
	
	# Группируем элементы расписания по постановке для балансировки
	schedule_by_production: Dict[str, List[ScheduleItem]] = defaultdict(list)
	for item in schedule:
		schedule_by_production[item.production_id].append(item)
	
	# Для каждой постановки распределяем людей равномерно
	for production_id, production_items in schedule_by_production.items():
		roles = roles_by_production.get(production_id, [])
		
		# Для каждой роли в этой постановке
		for role in roles:
			# Находим людей, которые могут играть эту роль
			available_people = []
			for person in scenario.people:
				key = (person.id, production_id, role.id)
				if can_play_map.get(key, False):
					available_people.append(person)
			
			if not available_people:
				# Если нет доступных людей, пропускаем роль (или можно выбросить ошибку)
				continue
			
			# Распределяем людей равномерно по всем показам
			# Если требуется N человек на роль и есть M показов, каждый человек должен играть примерно M*N/len(available_people) раз
			num_shows = len(production_items)
			total_assignments_needed = num_shows * role.required_count
			
			# Сортируем людей по количеству уже сделанных назначений (для балансировки)
			available_people.sort(key=lambda p: person_assignment_count[p.id])
			
			# Распределяем назначения
			assignment_idx = 0
			for item in production_items:
				schedule_item_id = f"{item.production_id}|{item.stage_id}|{item.timeslot_id}"
				
				# Назначаем требуемое количество людей на эту роль
				for _ in range(role.required_count):
					if assignment_idx >= len(available_people):
						# Если людей не хватает, начинаем заново (циклическое распределение)
						assignment_idx = 0
					
					person = available_people[assignment_idx]
					assignment = Assignment(
						scenario_id=scenario.id,
						schedule_item_id=schedule_item_id,
						production_id=item.production_id,
						timeslot_id=item.timeslot_id,
						stage_id=item.stage_id,
						person_id=person.id,
						role_id=role.id,
						is_conductor=role.is_conductor,
					)
					assignments.append(assignment)
					person_assignment_count[person.id] += 1
					assignment_idx += 1
			
			# После распределения для роли, пересортировываем для следующей роли
			# (чтобы следующая роль тоже распределялась равномерно)
			available_people.sort(key=lambda p: person_assignment_count[p.id])
	
	return assignments