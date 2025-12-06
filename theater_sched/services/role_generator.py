from __future__ import annotations

"""
Сервис для автоматической генерации ролей на основе названий спектаклей.
"""

from theater_sched.domain.models import Production, Role


def generate_roles_for_production(production: Production) -> list[Role]:
	"""Генерирует роли для постановки на основе её названия.
	
	Всегда добавляет дирижера. Для остальных ролей использует эвристики
	на основе названия спектакля.
	"""
	title_lower = (production.title or production.id).lower()
	roles = []
	
	# Всегда добавляем дирижера
	conductor_role = Role(
		id=f"{production.id}_conductor",
		name="Дирижер",
		production_id=production.id,
		is_conductor=True,
		required_count=1
	)
	roles.append(conductor_role)
	
	# Генерируем роли на основе названия
	# Балет "Щелкунчик"
	if "щелкунчик" in title_lower or "nutcracker" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_clara", name="Клара", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_prince", name="Принц", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_drosselmeyer", name="Дроссельмейер", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_mouse_king", name="Мышиный король", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_sugar_plum", name="Фея Драже", production_id=production.id, required_count=1),
		])
	
	# Опера "Аида"
	elif "аида" in title_lower or "aida" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_aida", name="Аида", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_radames", name="Радамес", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_amneris", name="Амнерис", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_amonasro", name="Амонасро", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_ramfis", name="Рамфис", production_id=production.id, required_count=1),
		])
	
	# Балет "Лебединое озеро"
	elif "лебединое" in title_lower or "swan" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_odette", name="Одетта", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_odile", name="Одиллия", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_prince_siegfried", name="Принц Зигфрид", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_rothbart", name="Ротбарт", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_queen", name="Королева", production_id=production.id, required_count=1),
		])
	
	# Опера "Евгений Онегин"
	elif "онегин" in title_lower or "onegin" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_onegin", name="Онегин", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_tatiana", name="Татьяна", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_lenski", name="Ленский", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_olga", name="Ольга", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_gremin", name="Гремин", production_id=production.id, required_count=1),
		])
	
	# Опера "Кармен"
	elif "кармен" in title_lower or "carmen" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_carmen", name="Кармен", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_don_jose", name="Дон Хосе", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_escamillo", name="Эскамильо", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_micaela", name="Микаэла", production_id=production.id, required_count=1),
		])
	
	# Балет "Спящая красавица"
	elif "спящая" in title_lower or "sleeping" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_aurora", name="Аврора", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_prince_desire", name="Принц Дезире", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_lilac_fairy", name="Фея Сирени", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_carabosse", name="Карабосс", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_king", name="Король", production_id=production.id, required_count=1),
		])
	
	# Опера "Риголетто"
	elif "риголетто" in title_lower or "rigoletto" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_rigoletto", name="Риголетто", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_gilda", name="Джильда", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_duke", name="Герцог Мантуанский", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_sparafucile", name="Спарафучиле", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_maddalena", name="Маддалена", production_id=production.id, required_count=1),
		])
	
	# Опера "Адриана Лекуврёр"
	elif "адриана" in title_lower or "adriana" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_adriana", name="Адриана Лекуврёр", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_maurizio", name="Маурицио", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_princess", name="Принцесса де Буйон", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_michonnet", name="Мишонне", production_id=production.id, required_count=1),
		])
	
	# Балет "Петрушка"
	elif "петрушка" in title_lower or "petrushka" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_petrushka", name="Петрушка", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_ballerina", name="Балерина", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_moor", name="Мавр", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_magician", name="Фокусник", production_id=production.id, required_count=1),
		])
	
	# Опера "Мертвые души"
	elif "мертвые" in title_lower or "души" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_chichikov", name="Чичиков", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_manilov", name="Манилов", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_korobochka", name="Коробочка", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_nozdrev", name="Ноздрёв", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_sobolievich", name="Соболевич", production_id=production.id, required_count=1),
		])
	
	# Опера "Симон Бокканегра"
	elif "симон" in title_lower or "бокканегра" in title_lower or "boccanegra" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_simon", name="Симон Бокканегра", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_amelia", name="Амелия", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_gabriele", name="Габриэле Адорно", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_fiesco", name="Фьеско", production_id=production.id, required_count=1),
		])
	
	# Балет "Ромео и Джульетта"
	elif "ромео" in title_lower or "джульетта" in title_lower or "romeo" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_romeo", name="Ромео", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_juliet", name="Джульетта", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_mercutio", name="Меркуцио", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_tybalt", name="Тибальт", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_friar", name="Лоренцо", production_id=production.id, required_count=1),
		])
	
	# Опера "Сказка о царе Салтане"
	elif "салтан" in title_lower or "saltyk" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_tsar", name="Царь Салтан", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_tsarina", name="Царица", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_guidon", name="Гвидон", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_swan", name="Царевна-Лебедь", production_id=production.id, required_count=1),
		])
	
	# Балет "Жизель"
	elif "жизель" in title_lower or "giselle" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_giselle", name="Жизель", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_albrecht", name="Альбрехт", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_hilarion", name="Гиларион", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_myrtha", name="Мирта", production_id=production.id, required_count=1),
		])
	
	# Опера "Мастер и Маргарита"
	elif "мастер" in title_lower or "маргарита" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_master", name="Мастер", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_margarita", name="Маргарита", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_woland", name="Воланд", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_yeshua", name="Иешуа", production_id=production.id, required_count=1),
		])
	
	# Опера "Иоланта"
	elif "иоланта" in title_lower or "iolanta" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_iolanta", name="Иоланта", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_vautdemont", name="Водемон", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_king", name="Король Рене", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_robert", name="Роберт", production_id=production.id, required_count=1),
		])
	
	# Опера "Так поступают все женщины"
	elif "женщины" in title_lower or "cosi" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_fiordiligi", name="Фьордилиджи", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_dorabella", name="Дорабелла", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_ferrando", name="Феррандо", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_guglielmo", name="Гульельмо", production_id=production.id, required_count=1),
		])
	
	# Балет "Светлый ручей"
	elif "ручей" in title_lower or "stream" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_zya", name="Зина", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_pyotr", name="Пётр", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_ballerina_guest", name="Балерина-гостья", production_id=production.id, required_count=1),
		])
	
	# Опера "Сказание о невидимом граде"
	elif "невидимом" in title_lower or "граде" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_fyodor", name="Фёдор", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_fevronia", name="Феврония", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_grishka", name="Гришка", production_id=production.id, required_count=1),
		])
	
	# Опера "Снегурочка"
	elif "снегурочка" in title_lower or "snow" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_snegurochka", name="Снегурочка", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_mizgir", name="Мизгирь", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_lial", name="Лель", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_spring", name="Весна", production_id=production.id, required_count=1),
		])
	
	# Опера "Сорочинская ярмарка"
	elif "сорочинская" in title_lower or "ярмарка" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_gritsko", name="Грицько", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_parasya", name="Парася", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_cherevik", name="Черевик", production_id=production.id, required_count=1),
		])
	
	# Опера "Сын мандарина"
	elif "мандарин" in title_lower or "mandarin" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_mandarin_son", name="Сын мандарина", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_princess", name="Принцесса", production_id=production.id, required_count=1),
		])
	
	# Опера "Король"
	elif "король" in title_lower and "царь" not in title_lower or "king" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_king_main", name="Король", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_queen_main", name="Королева", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_prince_main", name="Принц", production_id=production.id, required_count=1),
		])
	
	# Опера "Ариадна на Наксосе"
	elif "ариадна" in title_lower or "ariadne" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_ariadne", name="Ариадна", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_bacchus", name="Бахус", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_zerbinetta", name="Цербинетта", production_id=production.id, required_count=1),
		])
	
	# Опера "Петя и волк"
	elif "петя" in title_lower or "волк" in title_lower or "peter" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_peter", name="Петя", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_grandfather", name="Дедушка", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_bird", name="Птичка", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_duck", name="Утка", production_id=production.id, required_count=1),
		])
	
	# Опера "Похождения повесы"
	elif "повесы" in title_lower or "rake" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_tom", name="Том Рейквелл", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_anne", name="Энн Трулав", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_nick", name="Ник Шэдоу", production_id=production.id, required_count=1),
		])
	
	# Опера "Питер Пэн"
	elif "питер" in title_lower and "пэн" in title_lower or "peter pan" in title_lower:
		roles.extend([
			Role(id=f"{production.id}_peter_pan", name="Питер Пэн", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_wendy", name="Венди", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_captain", name="Капитан Крюк", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_tinker", name="Динь-Динь", production_id=production.id, required_count=1),
		])
	
	# По умолчанию: стандартный набор ролей
	else:
		roles.extend([
			Role(id=f"{production.id}_lead_male", name="Главная мужская роль", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_lead_female", name="Главная женская роль", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_supporting_male", name="Второстепенная мужская роль", production_id=production.id, required_count=1),
			Role(id=f"{production.id}_supporting_female", name="Второстепенная женская роль", production_id=production.id, required_count=1),
		])
	
	return roles

