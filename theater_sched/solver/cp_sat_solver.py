from __future__ import annotations

"""
CP-SAT решатель для расписания театра.

Назначаем постановки (productions) в таймслоты (timeslots):
  - Переменные: x[p,t] ∈ {0,1} — ставим ли постановку p в слот t
  - Таймслоты теперь привязаны к конкретной сцене (timeslot.stage_id)
  - Жёсткие ограничения:
      * В каждом таймслоте максимум одна постановка
      * Постановка может быть только в таймслотах своей сцены (production.stage_id == timeslot.stage_id)
      * Для каждой постановки точно max_shows показов
      * Все показы одного спектакля должны идти подряд без пропусков
      * Понедельник — выходной
      * В выходные всегда должен быть какой-то спектакль на каждой сцене
      * В один конкретный выходной день можно, чтобы один из двух слотов был пустым
      * Спектакли с weekend_priority=True имеют приоритет на выходные дни (большой бонус в целевой функции)
  - Мягкие ограничения (штрафы):
      * Между разными спектаклями желателен 1 день перерыва
  - Цель: максимизировать назначения с учётом штрафов
"""

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
		# Создаём модель CP-SAT
		model = cp_model.CpModel()

		# Входные данные из сценария
		productions: List[Production] = scenario.productions
		timeslots: List[TimeSlot] = scenario.timeslots
		constraints = scenario.params.constraints        # зачем ?
		fixed_assignments: List[FixedAssignment] = scenario.fixed_assignments or []

		
		x: Dict[Tuple[str, str], cp_model.IntVar] = {}
		for p in productions:
			for t in timeslots:
				# Только если сцена постановки совпадает со сценой таймслота
				if p.stage_id == t.stage_id:
					var = model.NewBoolVar(f"x_{p.id}_{t.id}")
					x[(p.id, t.id)] = var
				# Если сцены не совпадают, переменная не создаётся (автоматически = 0)

		# Жёсткое ограничение: закреплённые назначения (фиксированные спектакли)
		for fa in fixed_assignments:
			var = x.get((fa.production_id, fa.timeslot_id))
			if var is not None:
				# Закрепляем: эта постановка должна быть назначена в этот таймслот
				model.Add(var == 1)
			# Если переменной нет (несовместимые сцены), игнорируем (или можно выбросить ошибку)
			# Также нужно убедиться, что другие постановки не могут быть в этом таймслоте
			# (это уже обеспечивается ограничением one_production_per_timeslot)

		# Жёсткое ограничение: в каждом таймслоте максимум одна постановка (всегда включено)
		for t in timeslots:
			# Берём только постановки, которые могут быть на этой сцене
			relevant_prods = [p for p in productions if p.stage_id == t.stage_id]
			if relevant_prods:
				# Собираем переменные для этого таймслота
				slot_vars = [x.get((p.id, t.id)) for p in relevant_prods]
				slot_vars = [v for v in slot_vars if v is not None]
				if slot_vars:
					model.Add(sum(slot_vars) <= 1)

					# Жёсткое ограничение: для выходных слотов (суббота, воскресенье) — слот должен быть обязательно занят
					# ЗАКОММЕНТИРОВАНО для экспериментов - теперь это мягкое ограничение
					# if constraints.weekend_always_show and t.day_of_week in [5, 6]:
					# 	model.Add(sum(slot_vars) == 1)

		# Жёсткое ограничение: точное количество показов для каждой постановки (всегда включено)
		for p in productions:
			# Только таймслоты на сцене этой постановки
			relevant_slots = [t for t in timeslots if t.stage_id == p.stage_id]
			prod_vars = []
			for t in relevant_slots:
				var = x.get((p.id, t.id))
				if var is not None:
					prod_vars.append(var)
			if prod_vars:
				model.Add(sum(prod_vars) == p.max_shows)
			else:
				# Если нет подходящих таймслотов, но требуется max_shows > 0, задача невыполнима
				# Просто пропускаем - если нет переменных, то ограничение не добавится
				# И задача будет невыполнимой естественным образом
				pass

		# Жёсткое ограничение: все показы одного спектакля должны идти подряд без пропусков
		# Используем индикаторные переменные для начала последовательности
		if constraints.consecutive_shows:
			for p in productions:
				if p.max_shows <= 1:
					continue
				# Только таймслоты на сцене этой постановки
				ts_for_prod = sorted(
					[t for t in timeslots if t.stage_id == p.stage_id],
					key=lambda ts: (ts.date, ts.start_time)
				)
				if len(ts_for_prod) < p.max_shows:
					continue
				
				# Индикатор начала последовательности: ровно одно начало для max_shows подряд идущих показов
				start_vars = {}
				for i in range(len(ts_for_prod)):
					# Можно начать последовательность только если хватает слотов вперёд
					if i + p.max_shows > len(ts_for_prod):
						break
					start_var = model.NewBoolVar(f"start_{p.id}_{ts_for_prod[i].id}")
					start_vars[ts_for_prod[i].id] = start_var
					
					# Если start_var = 1, то следующие max_shows слотов должны быть заняты этим спектаклем
					for j in range(p.max_shows):
						if i + j < len(ts_for_prod):
							var = x.get((p.id, ts_for_prod[i + j].id))
							if var is not None:
								# Если начали последовательность, этот слот должен быть занят
								model.Add(var >= start_var)
					
					# Если start_var = 1, предыдущий слот не должен быть занят этим спектаклем
					# (чтобы не было перекрывающихся последовательностей)
					if i > 0:
						var_prev = x.get((p.id, ts_for_prod[i - 1].id))
						if var_prev is not None:
							model.Add(var_prev <= 1 - start_var)
				
				# Ровно одно начало последовательности
				if start_vars:
					model.Add(sum(start_vars.values()) == 1)

		# Жёсткое ограничение: понедельник — выходной (0 = понедельник)
		if constraints.monday_off:
			for t in timeslots:
				if t.day_of_week == 0:  # Понедельник
					relevant_prods = [p for p in productions if p.stage_id == t.stage_id]
					for p in relevant_prods:
						var = x.get((p.id, t.id))
						if var is not None:
							model.Add(var == 0)

		# Группируем выходные слоты по неделе (год + номер недели) и сцене (для бонусов и вспомогательной логики)
		from datetime import datetime
		import pytz
		
		# Московский часовой пояс
		MOSCOW_TZ = pytz.timezone('Europe/Moscow')
		
		def get_week_key(date_str: str) -> str:
			"""Возвращает ключ недели (год-неделя) для группировки субботы и воскресенья в московском времени."""
			try:
				# Парсим дату в формате YYYY-MM-DD (без времени)
				if len(date_str) == 10 and date_str.count('-') == 2:
					# Формат YYYY-MM-DD - создаем дату в московском времени (полночь)
					naive_dt = datetime.fromisoformat(date_str)
					# Локализуем в московское время
					moscow_dt = MOSCOW_TZ.localize(naive_dt)
				else:
					# Если есть время, берем только дату
					naive_dt = datetime.fromisoformat(date_str.split('T')[0])
					moscow_dt = MOSCOW_TZ.localize(naive_dt)
				# Используем ISO week в московском времени: (год, номер недели)
				iso_year, iso_week, _ = moscow_dt.isocalendar()
				return f"{iso_year}-W{iso_week:02d}"
			except (ValueError, AttributeError):
				# Если не удалось распарсить дату, используем дату как ключ
				return date_str
		
		slots_by_week_stage = defaultdict(lambda: defaultdict(list))
		for t in timeslots:
			if t.day_of_week in [5, 6]:  # Суббота (5) или воскресенье (6)
				week_key = get_week_key(t.date)
				slots_by_week_stage[week_key][t.stage_id].append(t)

		# Бонусы для спектаклей с приоритетом на выходные (используются в целевой функции)
		weekend_priority_bonus: List[cp_model.LinearExpr] = []
		
		for week_key, stages_dict in slots_by_week_stage.items():
			for stage_id, weekend_slots in stages_dict.items():
				if len(weekend_slots) >= 1:
					# Группируем слоты по дням (суббота/воскресенье)
					slots_by_day = defaultdict(list)
					for slot in weekend_slots:
						slots_by_day[slot.day_of_week].append(slot)
					
					# Собираем все переменные для выходных слотов этой сцены
					all_weekend_vars = []
					for slot in weekend_slots:
						for p in productions:
							if p.stage_id == stage_id:
								var = x.get((p.id, slot.id))
								if var is not None:
									all_weekend_vars.append(var)
					
					# Для каждой постановки на этой сцене
					for p in productions:
						if p.stage_id == stage_id:
							# Собираем переменные для субботы и воскресенья отдельно
							saturday_vars = []
							sunday_vars = []
							
							if 5 in slots_by_day:  # Суббота
								for slot in slots_by_day[5]:
									var = x.get((p.id, slot.id))
									if var is not None:
										saturday_vars.append(var)
							
							if 6 in slots_by_day:  # Воскресенье
								for slot in slots_by_day[6]:
									var = x.get((p.id, slot.id))
									if var is not None:
										sunday_vars.append(var)
							
							# Бонус для спектаклей с приоритетом на выходные
							if constraints.weekend_priority_bonus and p.weekend_priority:
								# Если спектакль с приоритетом назначен в выходные, даём большой бонус
								weekend_slot_vars = saturday_vars + sunday_vars
								if weekend_slot_vars:
									# Бонус пропорционален количеству выходных слотов, где назначен спектакль
									weekend_priority_bonus.append(sum(weekend_slot_vars))

		# Мягкое ограничение: выходные слоты должны быть заполнены (штраф за пустые выходные слоты)
		weekend_empty_penalty: List[cp_model.LinearExpr] = []
		if constraints.weekend_always_show:
			for t in timeslots:
				if t.day_of_week in [5, 6]:  # Суббота (5) или воскресенье (6)
					relevant_prods = [p for p in productions if p.stage_id == t.stage_id]
					slot_vars = [x.get((p.id, t.id)) for p in relevant_prods]
					slot_vars = [v for v in slot_vars if v is not None]
					if slot_vars:
						# Создаём переменную, показывающую, что слот пуст (sum == 0)
						slot_sum = sum(slot_vars)
						# Штраф за пустой слот: если sum == 0, то штраф = 1, иначе 0
						# Используем обратную логику: штраф = 1 - sum (но sum может быть 0 или 1)
						# Для мягкого ограничения: штраф = 1 - slot_sum (если пусто, штраф = 1)
						# Но нужно учесть, что sum может быть только 0 или 1 из-за ограничения <= 1
						# Поэтому просто добавляем (1 - slot_sum) как штраф
						weekend_empty_penalty.append(1 - slot_sum)

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
		

		# Целевая функция: максимизируем назначения минус штрафы за отсутствие перерывов
		# Плюс большой бонус для спектаклей с приоритетом на выходные
		# Минус штраф за пустые выходные слоты (мягкое ограничение)
		# Вес штрафа меньше веса назначений, чтобы не нарушать основную цель
		# Бонус для выходных имеет очень большой вес, чтобы приоритетные спектакли назначались в выходные
		objective_terms = [sum(x.values()) * 100]
		if constraints.break_between_different_shows:
			objective_terms.append(-sum(penalty_terms) * 50)  # Штраф за отсутствие перерывов между разными спектаклями
		if constraints.weekend_always_show and weekend_empty_penalty:
			objective_terms.append(-sum(weekend_empty_penalty))  # Штраф за пустые выходные слоты (мягкое ограничение)
		if constraints.weekend_priority_bonus:
			objective_terms.append(sum(weekend_priority_bonus) * 100)  # Большой бонус за приоритетные спектакли в выходные
		model.Maximize(sum(objective_terms))

		# Запускаем решатель
		cp_solver = cp_model.CpSolver()
		cp_solver.parameters.max_time_in_seconds = float(max(1, scenario.params.time_limit_seconds))
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