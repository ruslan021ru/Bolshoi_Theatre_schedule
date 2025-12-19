// Простой веб-клиент: создаёт сценарий, запускает решатель и рисует Гантт

(function () {
    const MOSCOW_TIMEZONE = 'Europe/Moscow';
    
    // Парсит ISO-строку без влияния локального часового пояса пользователя
    function parseIsoLike(isoStr) {
        if (!isoStr) return null;
        const trimmed = isoStr.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            // Дата без времени — парсим как полночь в UTC, потом форматируем в Москве
            return new Date(`${trimmed}T00:00:00Z`);
        }
        return new Date(trimmed);
    }
    
    // Функция для создания даты в московском времени
    function createMoscowDate(year, month, day, hours = 0, minutes = 0) {
        const utcDate = new Date(Date.UTC(year, month, day, hours, minutes));
        const moscowString = utcDate.toLocaleString('en-US', { timeZone: MOSCOW_TIMEZONE });
        return new Date(moscowString);
    }
    
    // Функция для получения дня недели в московском времени
    function getMoscowDayOfWeek(dateStr) {
        const baseDate = parseIsoLike(dateStr);
        if (!(baseDate instanceof Date) || isNaN(baseDate)) return 0;
        const moscowString = baseDate.toLocaleString('en-US', { timeZone: MOSCOW_TIMEZONE });
        const moscowDate = new Date(moscowString);
        const jsDow = moscowDate.getDay(); // 0=Sunday
        // Преобразуем: 0=ВС->6, 1=ПН->0, 2=ВТ->1, ..., 6=СБ->5
        return jsDow === 0 ? 6 : jsDow - 1;
    }
    
    // Получаем API URL из localStorage или используем значение по умолчанию
    function getApiBaseUrl() {
        localStorage.setItem('api_base_url', 'http://176.114.88.77/api');
        const saved = localStorage.getItem('api_base_url');
        if (saved) return saved;
        // Пытаемся определить автоматически
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:8000';
        }
        // Если на GitHub Pages или другом хостинге, возвращаем пустую строку
        // Пользователь должен будет указать URL вручную
        return '';
    }
    
    let API_BASE_URL = getApiBaseUrl();
    const statusEl = document.getElementById('status');
    const btnCreate = document.getElementById('btnCreate');
    const btnSolve = document.getElementById('btnSolve');

    const productionsList = document.getElementById('productionsList');
    const stagesList = document.getElementById('stagesList');
    const timeslotsList = document.getElementById('timeslotsList');
    const addProductionBtn = document.getElementById('addProduction');
    

    let scenarioId = null;

    const state = {
        productions: [],
        stages: [],
        timeslots: [],
        originalTimeslots: [], // Оригинальные таймслоты для восстановления
        fixedAssignments: [], // Закреплённые спектакли: [{production_id, timeslot_id, stage_id, date, start_time}]
        people: [], // Люди: [{id, name, email}]
        roles: [], // Роли: [{id, name, production_id, is_conductor, required_count}]
        person_production_roles: [], // Кто может играть какую роль: [{person_id, production_id, role_id, can_play}]
        assignments: [] // Назначения: [{schedule_item_id, production_id, timeslot_id, stage_id, person_id, role_id, is_conductor}]
    };

    // Цветовая схема для спектаклей
    const productionColors = [
        '#4299e1', // синий
        '#48bb78', // зелёный
        '#ed8936', // оранжевый
        '#9f7aea', // фиолетовый
        '#f56565', // красный
        '#38b2ac', // бирюзовый
        '#ed64a6', // розовый
        '#f6ad55', // жёлтый
    ];

    // Функция для получения цвета сцены
    function getStageColor(stageName) {
        const name = (stageName || '').toLowerCase();
        if (name.includes('историч')) {
            return '#b8002a'; // Красный (историческая)
        } else if (name.includes('новая') || name.includes('новая сцена')) {
            return '#708631'; // Зеленый (новая)
        } else if (name.includes('камерн')) {
            return '#26547c'; // Синий (камерная)
        }
        // По умолчанию серый, если не распознано
        return '#718096';
    }

    // Helpers
    function setStatus(text, isError = false, isSuccess = false) {
        statusEl.textContent = text;
        statusEl.className = 'status';
        if (isError) statusEl.classList.add('error');
        if (isSuccess) statusEl.classList.add('success');
    }

    function createInput(value = '', attrs = {}) {
        const i = document.createElement('input');
        i.value = value;
        Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v));
        return i;
    }

    function createNumber(value = 0, attrs = {}) {
        const i = createInput(String(value), { type: 'number', min: '0', step: '1', ...attrs });
        return i;
    }

    function createSelect(options, value) {
        const s = document.createElement('select');
        let hasSelected = false;
        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (o.value === value && value !== '') {
                opt.selected = true;
                hasSelected = true;
            }
            s.appendChild(opt);
        });
        // Если значение не было найдено и не пустое, устанавливаем его явно
        if (!hasSelected && value && value !== '') {
            s.value = value;
        }
        // Если значение пустое, НЕ устанавливаем его явно - пусть браузер выберет первый вариант
        // Это нормальное поведение для пустых значений
        return s;
    }

    function row(...cells) {
        const div = document.createElement('div');
        div.style.display = 'grid';
        div.style.gridTemplateColumns = '1fr 1fr 1fr 80px';
        div.style.gap = '6px';
        cells.forEach(c => div.appendChild(c));
        return div;
    }

    // Генерация ID из названия
    function generateId(text) {
        return text.toLowerCase()
            .replace(/[^a-z0-9а-яё]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '') || `item_${Date.now()}`;
    }

    // Renderers
    function renderProductions() {
        productionsList.innerHTML = '';
        
        // Храним состояние раскрытых сцен
        if (!window.expandedStages) {
            window.expandedStages = new Set();
        }
        
        // Группируем постановки по сценам
        const productionsByStage = {};
        state.productions.forEach(p => {
            const stageId = p.stage_id || 'no_stage';
            if (!productionsByStage[stageId]) {
                productionsByStage[stageId] = [];
            }
            productionsByStage[stageId].push(p);
        });
        
        // Создаем секции для каждой сцены
        state.stages.forEach(stage => {
            const stageId = stage.id;
            const stageColor = getStageColor(stage.name || stage.id);
            const stageProductions = productionsByStage[stageId] || [];
            
            // Контейнер сцены
            const stageSection = document.createElement('div');
            stageSection.style.marginBottom = '12px';
            stageSection.style.border = `2px solid ${stageColor}`;
            stageSection.style.borderRadius = '12px';
            stageSection.style.overflow = 'hidden';
            stageSection.style.background = `linear-gradient(135deg, ${stageColor}15 0%, ${stageColor}08 100%)`;
            
            // Заголовок сцены (кликабельный)
            const stageHeader = document.createElement('div');
            stageHeader.style.display = 'flex';
            stageHeader.style.alignItems = 'center';
            stageHeader.style.justifyContent = 'space-between';
            stageHeader.style.padding = '14px 16px';
            stageHeader.style.cursor = 'pointer';
            stageHeader.style.transition = 'background 0.2s';
            stageHeader.style.background = `${stageColor}20`;
            stageHeader.onmouseenter = () => {
                stageHeader.style.background = `${stageColor}30`;
            };
            stageHeader.onmouseleave = () => {
                stageHeader.style.background = `${stageColor}20`;
            };
            stageHeader.onclick = () => {
                const isExpanded = window.expandedStages.has(stageId);
                if (isExpanded) {
                    window.expandedStages.delete(stageId);
                } else {
                    window.expandedStages.add(stageId);
                }
                renderProductions();
            };
            
            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.gap = '12px';
            
            const colorBox = document.createElement('div');
            colorBox.style.width = '24px';
            colorBox.style.height = '24px';
            colorBox.style.borderRadius = '6px';
            colorBox.style.backgroundColor = stageColor;
            colorBox.style.border = '2px solid rgba(255,255,255,0.8)';
            colorBox.style.flexShrink = '0';
            
            const title = document.createElement('div');
            title.style.fontWeight = '600';
            title.style.fontSize = '16px';
            title.style.color = '#1a0a1a';
            title.textContent = stage.name || stage.id;
            
            const count = document.createElement('div');
            count.style.fontSize = '13px';
            count.style.color = '#64748b';
            count.textContent = `(${stageProductions.length} спектаклей)`;
            
            const expandIcon = document.createElement('div');
            expandIcon.style.fontSize = '18px';
            expandIcon.style.transition = 'transform 0.2s';
            expandIcon.textContent = window.expandedStages.has(stageId) ? '▼' : '▶';
            
            left.appendChild(colorBox);
            left.appendChild(title);
            left.appendChild(count);
            stageHeader.appendChild(left);
            stageHeader.appendChild(expandIcon);
            
            stageSection.appendChild(stageHeader);
            
            // Контент с постановками (раскрывается при клике)
            if (window.expandedStages.has(stageId)) {
                const content = document.createElement('div');
                content.style.padding = '12px';
                content.style.background = 'rgba(255,255,255,0.6)';
                
                // Заголовки колонок
        const headerRow = document.createElement('div');
        headerRow.style.display = 'grid';
                headerRow.style.gridTemplateColumns = '1fr 80px 80px 60px';
                headerRow.style.gap = '8px';
        headerRow.style.marginBottom = '8px';
        headerRow.style.fontWeight = '600';
        headerRow.style.fontSize = '13px';
        headerRow.style.color = '#4a5568';
        headerRow.style.paddingBottom = '8px';
        headerRow.style.borderBottom = '2px solid #e2e8f0';
                const headerNames = ['Название', 'Показов', 'Выходные', ''];
        headerNames.forEach(name => {
            const headerCell = document.createElement('div');
            headerCell.textContent = name;
            headerRow.appendChild(headerCell);
        });
                content.appendChild(headerRow);
                
                // Постановки этой сцены
                stageProductions.forEach((p, idx) => {
                    const globalIdx = state.productions.findIndex(prod => prod.id === p.id);
                    if (globalIdx === -1) return;
                    
            // Инициализируем поля, если их нет
            if (!p.id && p.title) {
                p.id = generateId(p.title);
            }
            if (p.max_shows === undefined || p.max_shows === null) {
                p.max_shows = 1;
            }
            if (p.weekend_priority === undefined || p.weekend_priority === null) {
                p.weekend_priority = false;
            }
            
            const title = createInput(p.title || '', { placeholder: 'название' });
            const maxShows = createNumber(p.max_shows || 1, { placeholder: 'кол-во показов' });
            const weekendPriority = document.createElement('input');
            weekendPriority.type = 'checkbox';
            weekendPriority.checked = Boolean(p.weekend_priority);
            weekendPriority.title = 'Приоритет на выходные';
                    const del = document.createElement('button');
                    del.textContent = '×';
                    del.onclick = () => {
                        state.productions.splice(globalIdx, 1);
                        renderProductions();
                    };
                    
            title.oninput = () => {
                p.title = title.value;
                if (title.value) {
                    p.id = generateId(title.value);
                }
            };
            maxShows.oninput = () => p.max_shows = Number(maxShows.value || 1);
            weekendPriority.onchange = () => p.weekend_priority = weekendPriority.checked;
                    
            const r = document.createElement('div');
            r.style.display = 'grid';
                    r.style.gridTemplateColumns = '1fr 80px 80px 60px';
                    r.style.gap = '8px';
            r.style.alignItems = 'center';
            r.style.marginBottom = '6px';
            r.style.paddingBottom = '6px';
            r.style.borderBottom = '1px solid #f1f5f9';
            
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.style.display = 'flex';
            checkboxWrapper.style.justifyContent = 'center';
            checkboxWrapper.appendChild(weekendPriority);
            
                    r.append(title, maxShows, checkboxWrapper, del);
                    content.appendChild(r);
                });
                
                stageSection.appendChild(content);
            }
            
            productionsList.appendChild(stageSection);
        });
        
        // Постановки без сцены
        const noStageProductions = productionsByStage['no_stage'] || [];
        if (noStageProductions.length > 0) {
            const noStageSection = document.createElement('div');
            noStageSection.style.marginBottom = '12px';
            noStageSection.style.border = '2px solid #e2e8f0';
            noStageSection.style.borderRadius = '12px';
            noStageSection.style.overflow = 'hidden';
            noStageSection.style.background = 'rgba(226, 232, 240, 0.3)';
            
            const header = document.createElement('div');
            header.style.padding = '14px 16px';
            header.style.fontWeight = '600';
            header.style.background = 'rgba(226, 232, 240, 0.5)';
            header.textContent = 'Без сцены';
            noStageSection.appendChild(header);
            
            const content = document.createElement('div');
            content.style.padding = '12px';
            content.style.background = 'rgba(255,255,255,0.6)';
            
            // Заголовки колонок
            const headerRow = document.createElement('div');
            headerRow.style.display = 'grid';
            headerRow.style.gridTemplateColumns = '1fr 1fr 80px 80px 60px';
            headerRow.style.gap = '8px';
            headerRow.style.marginBottom = '8px';
            headerRow.style.fontWeight = '600';
            headerRow.style.fontSize = '13px';
            headerRow.style.color = '#4a5568';
            headerRow.style.paddingBottom = '8px';
            headerRow.style.borderBottom = '2px solid #e2e8f0';
            const headerNames = ['Название', 'Сцена', 'Показов', 'Выходные', ''];
            headerNames.forEach(name => {
                const headerCell = document.createElement('div');
                headerCell.textContent = name;
                headerRow.appendChild(headerCell);
            });
            content.appendChild(headerRow);
            
            noStageProductions.forEach((p, idx) => {
                const globalIdx = state.productions.findIndex(prod => prod.id === p.id);
                if (globalIdx === -1) return;
                
                const stageOpts = state.stages.map(s => ({ value: s.id, label: s.name || s.id }));
                const title = createInput(p.title || '', { placeholder: 'название' });
                // Используем временное поле для выбранной сцены, чтобы не переносить сразу
                const currentStageId = p._pending_stage_id || p.stage_id || '';
                const stageSel = createSelect(stageOpts, currentStageId);
                const maxShows = createNumber(p.max_shows || 1, { placeholder: 'кол-во показов' });
                const weekendPriority = document.createElement('input');
                weekendPriority.type = 'checkbox';
                weekendPriority.checked = Boolean(p.weekend_priority);
                const del = document.createElement('button');
                del.textContent = '×';
                del.onclick = () => {
                    state.productions.splice(globalIdx, 1);
                    renderProductions();
                };
                
                title.oninput = () => {
                    p.title = title.value;
                    if (title.value) {
                        p.id = generateId(title.value);
                    }
                };
                stageSel.onchange = () => {
                    // Сохраняем выбранную сцену во временное поле, не меняя stage_id
                    p._pending_stage_id = stageSel.value;
                };
                maxShows.oninput = () => p.max_shows = Number(maxShows.value || 1);
                weekendPriority.onchange = () => p.weekend_priority = weekendPriority.checked;
                
                const r = document.createElement('div');
                r.style.display = 'grid';
                r.style.gridTemplateColumns = '1fr 1fr 80px 80px 60px';
                r.style.gap = '8px';
                r.style.marginBottom = '6px';
                r.style.alignItems = 'center';
                r.style.paddingBottom = '6px';
                r.style.borderBottom = '1px solid #f1f5f9';
                
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.style.display = 'flex';
            checkboxWrapper.style.justifyContent = 'center';
            checkboxWrapper.appendChild(weekendPriority);
            
            r.append(title, stageSel, maxShows, checkboxWrapper, del);
                content.appendChild(r);
            });
            
            // Кнопка для переноса постановок в соответствующие секции
            const assignStagesBtn = document.createElement('button');
            assignStagesBtn.textContent = '✓ Назначить записанные постановки';
            assignStagesBtn.style.width = '100%';
            assignStagesBtn.style.marginTop = '12px';
            assignStagesBtn.style.padding = '12px';
            assignStagesBtn.style.fontSize = '14px';
            assignStagesBtn.style.background = 'linear-gradient(135deg, #475569 0%, #334155 100%)';
            assignStagesBtn.onclick = () => {
                // Сначала обновляем значения из селектов в объекты
                const rows = content.querySelectorAll('div[style*="grid"]');
                rows.forEach((row, idx) => {
                    if (idx === 0) return; // Пропускаем заголовок
                    const select = row.querySelector('select');
                    if (select && noStageProductions[idx - 1]) {
                        const p = noStageProductions[idx - 1];
                        // Обновляем _pending_stage_id из селекта, если он изменился
                        p._pending_stage_id = select.value;
                    }
                });
                
                // Переносим все постановки, у которых выбрана сцена (из _pending_stage_id или stage_id)
                let moved = 0;
                noStageProductions.forEach(p => {
                    const finalStageId = p._pending_stage_id || p.stage_id;
                    if (finalStageId && finalStageId !== '') {
                        // Применяем выбранную сцену
                        p.stage_id = finalStageId;
                        delete p._pending_stage_id;
                        // Автоматически раскрываем сцену для перенесенных постановок
                        window.expandedStages.add(finalStageId);
                        moved++;
                    }
                });
                if (moved > 0) {
                    renderProductions();
                }
            };
            content.appendChild(assignStagesBtn);
            
            noStageSection.appendChild(content);
            productionsList.appendChild(noStageSection);
        }
    }

    function renderStages() {
        stagesList.innerHTML = '';
        state.stages.forEach((s, idx) => {
            // Генерируем ID автоматически, если его нет
            if (!s.id && s.name) {
                s.id = generateId(s.name);
            }
            
            // Создаем контейнер для названия и цветового индикатора
            const nameContainer = document.createElement('div');
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.gap = '8px';
            
            // Цветовой индикатор сцены
            const colorIndicator = document.createElement('div');
            const stageColor = getStageColor(s.name || '');
            colorIndicator.style.width = '20px';
            colorIndicator.style.height = '20px';
            colorIndicator.style.borderRadius = '4px';
            colorIndicator.style.backgroundColor = stageColor;
            colorIndicator.style.border = '1px solid #e2e8f0';
            colorIndicator.style.flexShrink = '0';
            colorIndicator.title = `Цвет сцены: ${stageColor}`;
            
            const name = createInput(s.name, { placeholder: 'название' });
            nameContainer.appendChild(colorIndicator);
            nameContainer.appendChild(name);
            
            // Обновляем цвет при изменении названия
            name.oninput = () => {
                s.name = name.value;
                // Автоматически обновляем ID при изменении названия
                if (name.value) {
                    s.id = generateId(name.value);
                }
                // Обновляем цвет индикатора
                const newColor = getStageColor(name.value);
                colorIndicator.style.backgroundColor = newColor;
                colorIndicator.title = `Цвет сцены: ${newColor}`;
            };
            
            const del = document.createElement('button'); del.textContent = '×';
            del.onclick = () => { 
                state.stages.splice(idx, 1);
                renderStages();
                renderProductions(); // Перерисовываем постановки, так как список сцен изменился
            };
            
            const r = document.createElement('div');
            r.style.display = 'grid';
            r.style.gridTemplateColumns = '1fr 60px';
            r.style.gap = '6px';
            r.style.alignItems = 'center';
            r.append(nameContainer, del);
            stagesList.appendChild(r);
        });
    }

    function renderTimeslots() {
		timeslotsList.innerHTML = '';
		const stageOpts = state.stages.map(s => ({ value: s.id, label: s.name || s.id }));
		
		// Храним состояние раскрытых сцен
		if (!window.expandedTimeslotStages) {
			window.expandedTimeslotStages = new Set();
		}
		
		// Группируем таймслоты по сценам (в порядке сцен)
		state.stages.forEach(stage => {
			const stageColor = getStageColor(stage.name || stage.id);
			const slotsForStage = state.timeslots.filter(t => t.stage_id === stage.id);
			
			// Контейнер сцены
			const section = document.createElement('div');
			section.style.marginBottom = '12px';
			section.style.border = `2px solid ${stageColor}`;
			section.style.borderRadius = '12px';
			section.style.overflow = 'hidden';
			section.style.background = `linear-gradient(135deg, ${stageColor}15 0%, ${stageColor}08 100%)`;
			
			// Заголовок секции сцены (кликабельный)
			const header = document.createElement('div');
			header.style.display = 'flex';
			header.style.alignItems = 'center';
			header.style.justifyContent = 'space-between';
			header.style.padding = '14px 16px';
			header.style.cursor = 'pointer';
			header.style.transition = 'background 0.2s';
			header.style.background = `${stageColor}20`;
			header.onmouseenter = () => {
				header.style.background = `${stageColor}30`;
			};
			header.onmouseleave = () => {
				header.style.background = `${stageColor}20`;
			};
			header.onclick = () => {
				const isExpanded = window.expandedTimeslotStages.has(stage.id);
				if (isExpanded) {
					window.expandedTimeslotStages.delete(stage.id);
				} else {
					window.expandedTimeslotStages.add(stage.id);
				}
				renderTimeslots();
			};
			
			const left = document.createElement('div');
			left.style.display = 'flex';
			left.style.alignItems = 'center';
			left.style.gap = '12px';
			
			const colorBox = document.createElement('div');
			colorBox.style.width = '24px';
			colorBox.style.height = '24px';
			colorBox.style.borderRadius = '6px';
			colorBox.style.backgroundColor = stageColor;
			colorBox.style.border = '2px solid rgba(255,255,255,0.8)';
			colorBox.style.flexShrink = '0';
			
			const title = document.createElement('div');
			title.style.fontWeight = '600';
			title.style.fontSize = '16px';
			title.style.color = '#1a0a1a';
			title.textContent = stage.name || stage.id;
			
			const count = document.createElement('div');
			count.style.fontSize = '13px';
			count.style.color = '#64748b';
			count.textContent = `(${slotsForStage.length} таймслотов)`;
			
			const expandIcon = document.createElement('div');
			expandIcon.style.fontSize = '18px';
			expandIcon.style.transition = 'transform 0.2s';
			expandIcon.textContent = window.expandedTimeslotStages.has(stage.id) ? '▼' : '▶';
			
			const addBtn = document.createElement('button');
			addBtn.textContent = '+ Добавить';
			addBtn.style.padding = '6px 12px';
			addBtn.style.fontSize = '12px';
			addBtn.onclick = (e) => {
				e.stopPropagation();
				state.timeslots.push({
					id: `slot_${Date.now()}`,
					stage_id: stage.id,
					date: '',
					day_of_week: 0,
					start_time: '19:00'
				});
				window.expandedTimeslotStages.add(stage.id);
				renderTimeslots();
				// Обновляем календарь при добавлении таймслота
				if (typeof renderCalendar === 'function') {
					renderCalendar();
				}
			};
			
			left.appendChild(colorBox);
			left.appendChild(title);
			left.appendChild(count);
			header.appendChild(left);
			header.appendChild(expandIcon);
			section.appendChild(header);
			
			// Контент с таймслотами (раскрывается при клике)
			if (window.expandedTimeslotStages.has(stage.id)) {
				const content = document.createElement('div');
				content.style.padding = '12px';
				content.style.background = 'rgba(255,255,255,0.6)';
				
				// Компактная сетка таймслотов
				const grid = document.createElement('div');
				grid.style.display = 'grid';
				grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
				grid.style.gap = '8px';
				
			slotsForStage.forEach((t) => {
				if (!t.id) t.id = `slot_${Date.now()}_${Math.random()}`;
					
					const slotCard = document.createElement('div');
					slotCard.style.position = 'relative';
					slotCard.style.border = `2px solid ${stageColor}40`;
					slotCard.style.borderRadius = '8px';
					slotCard.style.padding = '10px';
					slotCard.style.background = 'white';
					slotCard.style.transition = 'all 0.2s';
					slotCard.onmouseenter = () => {
						slotCard.style.borderColor = stageColor;
						slotCard.style.boxShadow = `0 2px 8px ${stageColor}40`;
						slotCard.style.transform = 'translateY(-2px)';
					};
					slotCard.onmouseleave = () => {
						slotCard.style.borderColor = `${stageColor}40`;
						slotCard.style.boxShadow = 'none';
						slotCard.style.transform = 'translateY(0)';
					};
					
					const date = createInput(t.date || '', { placeholder: 'Дата', type: 'date' });
					date.style.width = '100%';
					date.style.marginBottom = '6px';
					date.style.fontSize = '13px';
					date.oninput = () => {
						t.date = date.value;
						// Обновляем календарь при изменении даты таймслота
						if (typeof renderCalendar === 'function') {
							renderCalendar();
						}
					};
					
					const time = createInput(t.start_time || '19:00', { placeholder: 'Время', type: 'time' });
					time.style.width = '100%';
					time.style.fontSize = '13px';
					time.oninput = () => {
						t.start_time = time.value;
						// Обновляем календарь при изменении времени таймслота
						if (typeof renderCalendar === 'function') {
							renderCalendar();
						}
					};
					
				const del = document.createElement('button'); 
				del.textContent = '×';
					del.style.position = 'absolute';
					del.style.top = '4px';
					del.style.right = '4px';
					del.style.width = '24px';
					del.style.height = '24px';
					del.style.padding = '0';
					del.style.fontSize = '18px';
					del.style.lineHeight = '1';
					del.style.background = '#ef4444';
					del.style.color = 'white';
					del.style.border = 'none';
					del.style.borderRadius = '4px';
					del.style.cursor = 'pointer';
				del.onclick = () => {
					const idx = state.timeslots.findIndex(slot => slot.id === t.id);
					if (idx !== -1) {
						state.timeslots.splice(idx, 1);
						renderTimeslots();
						// Обновляем календарь при удалении таймслота
						if (typeof renderCalendar === 'function') {
							renderCalendar();
						}
					}
				};
					
					slotCard.appendChild(date);
					slotCard.appendChild(time);
					slotCard.appendChild(del);
					grid.appendChild(slotCard);
				});
				
				content.appendChild(grid);
				
				// Кнопка добавления таймслота
				const addSlotBtn = document.createElement('button');
				addSlotBtn.textContent = '+ Добавить таймслот';
				addSlotBtn.style.width = '100%';
				addSlotBtn.style.marginTop = '12px';
				addSlotBtn.style.padding = '10px';
				addSlotBtn.style.fontSize = '13px';
				addSlotBtn.onclick = () => {
					const newSlot = {
						id: `slot_${Date.now()}`,
						stage_id: stage.id,
						date: '',
						day_of_week: 0,
						start_time: '19:00'
					};
					state.timeslots.push(newSlot);
					renderTimeslots();
					// Обновляем календарь при добавлении таймслота
					if (typeof renderCalendar === 'function') {
						renderCalendar();
					}
				};
				content.appendChild(addSlotBtn);
				
				section.appendChild(content);
			}
			
			timeslotsList.appendChild(section);
		});
    }

    // revenue UI удалён

    // Генерация месячного календаря
    function generateMonthCalendar(year, month) {
        // Вычисляем количество дней в месяце (не зависит от часового пояса)
        // Используем стандартный способ: создаем дату первого дня следующего месяца и вычитаем день
        const firstDayNextMonth = new Date(Date.UTC(year, month, 1));
        const lastDayOfMonth = new Date(Date.UTC(year, month, 0));
        const daysInMonth = lastDayOfMonth.getUTCDate();
        
        const slots = [];
        let slotId = 1;
        
        for (let day = 1; day <= daysInMonth; day++) {
            // Вычисляем день недели в московском времени
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dow = getMoscowDayOfWeek(dateStr);
            
            // Создаём отдельные таймслоты для каждой сцены
            state.stages.forEach(stage => {
                // Понедельник - создаём слоты на 19:00 (выходной, но слоты нужны для данных)
                if (dow === 0) {
                    slots.push({
                        id: `slot_${slotId++}`,
                        stage_id: stage.id,
                        date: dateStr,
                        day_of_week: dow,
                        start_time: '19:00'
                    });
                    return; // Пропускаем остальную логику для понедельника
                }
                if (dow === 5 || dow === 6) {
                    // Суббота/воскресенье: два слота на сцену (утром и вечером)
                    // Историческая: 14:00 и 19:00, Новая: 12:00 и 18:00, Камерная: 11:00 и 20:00
                    let morningTime = '19:00';
                    let eveningTime = '22:00';
                    if (stage.name === 'Историческая сцена' || stage.id === 's1') {
                        morningTime = '14:00';
                        eveningTime = '19:00';
                    } else if (stage.name === 'Новая сцена' || stage.id === 's2') {
                        morningTime = '12:00';
                        eveningTime = '18:00';
                    } else {
                        morningTime = '11:00';
                        eveningTime = '20:00';
                    }
                    
                    // Утренний слот
                    slots.push({
                        id: `slot_${slotId++}`,
                        stage_id: stage.id,
                        date: dateStr,
                        day_of_week: dow,
                        start_time: morningTime
                    });
                    
                    // Вечерний слот
                    slots.push({
                        id: `slot_${slotId++}`,
                        stage_id: stage.id,
                        date: dateStr,
                        day_of_week: dow,
                        start_time: eveningTime
                    });
                } else {
                    // Будние дни - только вечер
                    let eveningTime = '19:00';
                    if (stage.name === 'Историческая сцена' || stage.id === 's1') {
                        eveningTime = '19:00';
                    } else if (stage.name === 'Новая сцена' || stage.id === 's2') {
                        eveningTime = '18:00';
                    } else {
                        eveningTime = '19:00';
                    }
                    
                    slots.push({
                        id: `slot_${slotId++}`,
                        stage_id: stage.id,
                        date: dateStr,
                        day_of_week: dow,
                        start_time: eveningTime
                    });
                }
            });
        }
        return slots;
    }

    // Функции для управления людьми, ролями и назначениями
    const peopleList = document.getElementById('peopleList');
    const rolesList = document.getElementById('rolesList');
    const personProductionRolesList = document.getElementById('personProductionRolesList');
    const addPersonBtn = document.getElementById('addPerson');
    const addRoleBtn = document.getElementById('addRole');

    function renderPeople() {
        peopleList.innerHTML = '';
        
        // Добавляем заголовки колонок
        const headerRow = document.createElement('div');
        headerRow.style.display = 'grid';
        headerRow.style.gridTemplateColumns = '1fr 1fr 60px';
        headerRow.style.gap = '6px';
        headerRow.style.marginBottom = '8px';
        headerRow.style.fontWeight = '600';
        headerRow.style.fontSize = '13px';
        headerRow.style.color = '#4a5568';
        headerRow.style.paddingBottom = '8px';
        headerRow.style.borderBottom = '2px solid #e2e8f0';
        const headerNames = ['Имя', 'Email', ''];
        headerNames.forEach(name => {
            const headerCell = document.createElement('div');
            headerCell.textContent = name;
            headerRow.appendChild(headerCell);
        });
        peopleList.appendChild(headerRow);
        
        state.people.forEach((p, idx) => {
            if (!p.id) p.id = `person_${Date.now()}_${idx}`;
            const name = createInput(p.name || '', { placeholder: 'Имя' });
            const email = createInput(p.email || '', { placeholder: 'Email (опционально)', type: 'email' });
            const del = document.createElement('button');
            del.textContent = '×';
            del.onclick = () => {
                state.people.splice(idx, 1);
                renderPeople();
                renderPersonProductionRoles();
            };
            name.oninput = () => p.name = name.value;
            email.oninput = () => p.email = email.value;
            const r = document.createElement('div');
            r.style.display = 'grid';
            r.style.gridTemplateColumns = '1fr 1fr 60px';
            r.style.gap = '6px';
            r.style.marginBottom = '6px';
            r.append(name, email, del);
            peopleList.appendChild(r);
        });
    }

    function renderRoles() {
        rolesList.innerHTML = '';
        
        // Храним состояние раскрытых сцен и спектаклей
        if (!window.expandedRoleStages) {
            window.expandedRoleStages = new Set();
        }
        if (!window.expandedRoleProductions) {
            window.expandedRoleProductions = new Set();
        }
        
        // Группируем роли по сценам и спектаклям
        const rolesByStage = {};
        const rolesWithoutProduction = state.roles.filter(r => !r.production_id || r.production_id === '');
        state.stages.forEach(stage => {
            rolesByStage[stage.id] = {};
            state.productions
                .filter(p => p.stage_id === stage.id)
                .forEach(prod => {
                    rolesByStage[stage.id][prod.id] = state.roles.filter(r => r.production_id === prod.id);
                });
        });
        
        // Создаем секции для каждой сцены
        state.stages.forEach(stage => {
            const stageColor = getStageColor(stage.name || stage.id);
            const stageProductions = state.productions.filter(p => p.stage_id === stage.id);
            const hasRoles = stageProductions.some(prod => {
                const prodRoles = rolesByStage[stage.id][prod.id] || [];
                return prodRoles.length > 0;
            });
            
            if (!hasRoles && stageProductions.length === 0) return;
            
            // Контейнер сцены
            const stageSection = document.createElement('div');
            stageSection.style.marginBottom = '12px';
            stageSection.style.border = `2px solid ${stageColor}`;
            stageSection.style.borderRadius = '12px';
            stageSection.style.overflow = 'hidden';
            stageSection.style.background = `linear-gradient(135deg, ${stageColor}15 0%, ${stageColor}08 100%)`;
            
            // Заголовок сцены
            const stageHeader = document.createElement('div');
            stageHeader.style.display = 'flex';
            stageHeader.style.alignItems = 'center';
            stageHeader.style.justifyContent = 'space-between';
            stageHeader.style.padding = '14px 16px';
            stageHeader.style.cursor = 'pointer';
            stageHeader.style.transition = 'background 0.2s';
            stageHeader.style.background = `${stageColor}20`;
            stageHeader.onmouseenter = () => {
                stageHeader.style.background = `${stageColor}30`;
            };
            stageHeader.onmouseleave = () => {
                stageHeader.style.background = `${stageColor}20`;
            };
            stageHeader.onclick = () => {
                const isExpanded = window.expandedRoleStages.has(stage.id);
                if (isExpanded) {
                    window.expandedRoleStages.delete(stage.id);
                } else {
                    window.expandedRoleStages.add(stage.id);
                }
                renderRoles();
            };
            
            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.gap = '12px';
            
            const colorBox = document.createElement('div');
            colorBox.style.width = '24px';
            colorBox.style.height = '24px';
            colorBox.style.borderRadius = '6px';
            colorBox.style.backgroundColor = stageColor;
            colorBox.style.border = '2px solid rgba(255,255,255,0.8)';
            
            const title = document.createElement('div');
            title.style.fontWeight = '600';
            title.style.fontSize = '16px';
            title.style.color = '#1a0a1a';
            title.textContent = stage.name || stage.id;
            
            const expandIcon = document.createElement('div');
            expandIcon.style.fontSize = '18px';
            expandIcon.textContent = window.expandedRoleStages.has(stage.id) ? '▼' : '▶';
            
            left.appendChild(colorBox);
            left.appendChild(title);
            stageHeader.appendChild(left);
            stageHeader.appendChild(expandIcon);
            stageSection.appendChild(stageHeader);
            
            // Контент сцены
            if (window.expandedRoleStages.has(stage.id)) {
                const stageContent = document.createElement('div');
                stageContent.style.padding = '12px';
                stageContent.style.background = 'rgba(255,255,255,0.6)';
                
                // Секции для каждого спектакля
                stageProductions.forEach(prod => {
                    const prodRoles = rolesByStage[stage.id][prod.id] || [];
                    
                    const prodSection = document.createElement('div');
                    prodSection.style.marginBottom = '12px';
                    prodSection.style.border = '1px solid #e2e8f0';
                    prodSection.style.borderRadius = '8px';
                    prodSection.style.overflow = 'hidden';
                    prodSection.style.background = 'white';
                    
                    // Заголовок спектакля
                    const prodHeader = document.createElement('div');
                    prodHeader.style.display = 'flex';
                    prodHeader.style.alignItems = 'center';
                    prodHeader.style.justifyContent = 'space-between';
                    prodHeader.style.padding = '10px 12px';
                    prodHeader.style.cursor = 'pointer';
                    prodHeader.style.background = '#f8fafc';
                    prodHeader.style.borderBottom = '1px solid #e2e8f0';
                    prodHeader.onclick = () => {
                        const key = `${stage.id}_${prod.id}`;
                        const isExpanded = window.expandedRoleProductions.has(key);
                        if (isExpanded) {
                            window.expandedRoleProductions.delete(key);
                        } else {
                            window.expandedRoleProductions.add(key);
                        }
                        renderRoles();
                    };
                    
                    const prodTitle = document.createElement('div');
                    prodTitle.style.fontWeight = '600';
                    prodTitle.style.fontSize = '14px';
                    prodTitle.textContent = prod.title || prod.id;
                    
                    const prodCount = document.createElement('div');
                    prodCount.style.fontSize = '12px';
                    prodCount.style.color = '#64748b';
                    prodCount.textContent = `${prodRoles.length} ролей`;
                    
                    const prodExpandIcon = document.createElement('div');
                    prodExpandIcon.style.fontSize = '14px';
                    prodExpandIcon.textContent = window.expandedRoleProductions.has(`${stage.id}_${prod.id}`) ? '▼' : '▶';
                    
                    prodHeader.appendChild(prodTitle);
                    prodHeader.appendChild(prodCount);
                    prodHeader.appendChild(prodExpandIcon);
                    prodSection.appendChild(prodHeader);
                    
                    // Контент спектакля
                    if (window.expandedRoleProductions.has(`${stage.id}_${prod.id}`)) {
                        const prodContent = document.createElement('div');
                        prodContent.style.padding = '10px';
                        
                        // Заголовки колонок
                        const headerRow = document.createElement('div');
                        headerRow.style.display = 'grid';
                        headerRow.style.gridTemplateColumns = '1fr 60px 60px 60px';
                        headerRow.style.gap = '8px';
                        headerRow.style.marginBottom = '8px';
                        headerRow.style.fontWeight = '600';
                        headerRow.style.fontSize = '12px';
                        headerRow.style.color = '#4a5568';
                        headerRow.style.paddingBottom = '6px';
                        headerRow.style.borderBottom = '1px solid #e2e8f0';
                        const headerNames = ['Название роли', 'Дирижер', 'Кол-во', ''];
                        headerNames.forEach(name => {
                            const headerCell = document.createElement('div');
                            headerCell.textContent = name;
                            headerRow.appendChild(headerCell);
                        });
                        prodContent.appendChild(headerRow);
                        
                        // Роли спектакля
                        prodRoles.forEach((r, idx) => {
                            const globalIdx = state.roles.findIndex(role => role.id === r.id);
                            if (globalIdx === -1) return;
                            
            if (!r.id) r.id = `role_${Date.now()}_${idx}`;
            const name = createInput(r.name || '', { placeholder: 'Название роли' });
            const isConductor = document.createElement('input');
            isConductor.type = 'checkbox';
            isConductor.checked = Boolean(r.is_conductor);
            isConductor.title = 'Дирижер';
            const requiredCount = createNumber(r.required_count || 1, { min: '1' });
            const del = document.createElement('button');
            del.textContent = '×';
            del.onclick = () => {
                                state.roles.splice(globalIdx, 1);
                renderRoles();
                renderPersonProductionRoles();
            };
                            
            name.oninput = () => r.name = name.value;
            isConductor.onchange = () => r.is_conductor = isConductor.checked;
            requiredCount.oninput = () => r.required_count = Number(requiredCount.value || 1);
                            
            const rDiv = document.createElement('div');
            rDiv.style.display = 'grid';
                            rDiv.style.gridTemplateColumns = '1fr 60px 60px 60px';
                            rDiv.style.gap = '8px';
            rDiv.style.marginBottom = '6px';
                            
            const conductorWrapper = document.createElement('div');
            conductorWrapper.style.display = 'flex';
            conductorWrapper.style.justifyContent = 'center';
            conductorWrapper.appendChild(isConductor);
                            
                            rDiv.append(name, conductorWrapper, requiredCount, del);
                            prodContent.appendChild(rDiv);
                        });
                        
                        prodSection.appendChild(prodContent);
                    }
                    
                    stageContent.appendChild(prodSection);
                });
                
                stageSection.appendChild(stageContent);
            }
            
            rolesList.appendChild(stageSection);
        });
        
        // Роли без спектакля
        if (rolesWithoutProduction.length > 0) {
            const noProdSection = document.createElement('div');
            noProdSection.style.marginBottom = '12px';
            noProdSection.style.border = '2px solid #e2e8f0';
            noProdSection.style.borderRadius = '12px';
            noProdSection.style.overflow = 'hidden';
            noProdSection.style.background = 'rgba(226, 232, 240, 0.3)';
            
            const header = document.createElement('div');
            header.style.padding = '14px 16px';
            header.style.fontWeight = '600';
            header.style.background = 'rgba(226, 232, 240, 0.5)';
            header.textContent = 'Без спектакля';
            noProdSection.appendChild(header);
            
            const content = document.createElement('div');
            content.style.padding = '12px';
            content.style.background = 'rgba(255,255,255,0.6)';
            
            // Заголовки колонок
            const headerRow = document.createElement('div');
            headerRow.style.display = 'grid';
            headerRow.style.gridTemplateColumns = '1fr 1fr 60px 60px 60px';
            headerRow.style.gap = '8px';
            headerRow.style.marginBottom = '8px';
            headerRow.style.fontWeight = '600';
            headerRow.style.fontSize = '12px';
            headerRow.style.color = '#4a5568';
            headerRow.style.paddingBottom = '6px';
            headerRow.style.borderBottom = '1px solid #e2e8f0';
            const headerNames = ['Название роли', 'Постановка', 'Дирижер', 'Кол-во', ''];
            headerNames.forEach(name => {
                const headerCell = document.createElement('div');
                headerCell.textContent = name;
                headerRow.appendChild(headerCell);
            });
            content.appendChild(headerRow);
            
        const productionOpts = state.productions.map(p => ({ value: p.id, label: p.title || p.id }));
            rolesWithoutProduction.forEach((r, idx) => {
                const globalIdx = state.roles.findIndex(role => role.id === r.id);
                if (globalIdx === -1) return;
                
            if (!r.id) r.id = `role_${Date.now()}_${idx}`;
            const name = createInput(r.name || '', { placeholder: 'Название роли' });
            // используем отложенный выбор спектакля, чтобы не переносить роль сразу
            const currentProdId = r._pending_production_id || r.production_id || '';
            const productionSel = createSelect(productionOpts, currentProdId);
            const isConductor = document.createElement('input');
            isConductor.type = 'checkbox';
            isConductor.checked = Boolean(r.is_conductor);
            isConductor.title = 'Дирижер';
            const requiredCount = createNumber(r.required_count || 1, { min: '1' });
            const del = document.createElement('button');
            del.textContent = '×';
            del.onclick = () => {
                    state.roles.splice(globalIdx, 1);
                renderRoles();
                renderPersonProductionRoles();
            };
                
            name.oninput = () => r.name = name.value;
                productionSel.onchange = () => {
                    // Сохраняем выбранный спектакль отдельно, не меняя production_id
                    r._pending_production_id = productionSel.value;
                };
            isConductor.onchange = () => r.is_conductor = isConductor.checked;
            requiredCount.oninput = () => r.required_count = Number(requiredCount.value || 1);
                
            const rDiv = document.createElement('div');
            rDiv.style.display = 'grid';
                rDiv.style.gridTemplateColumns = '1fr 1fr 60px 60px 60px';
                rDiv.style.gap = '8px';
            rDiv.style.marginBottom = '6px';
                
            const conductorWrapper = document.createElement('div');
            conductorWrapper.style.display = 'flex';
            conductorWrapper.style.justifyContent = 'center';
            conductorWrapper.appendChild(isConductor);
                
            rDiv.append(name, productionSel, conductorWrapper, requiredCount, del);
                content.appendChild(rDiv);
            });
            
            // Кнопка для переноса ролей в соответствующие секции
            const assignProductionsBtn = document.createElement('button');
            assignProductionsBtn.textContent = '✓ Назначить записанные роли';
            assignProductionsBtn.style.width = '100%';
            assignProductionsBtn.style.marginTop = '12px';
            assignProductionsBtn.style.padding = '12px';
            assignProductionsBtn.style.fontSize = '14px';
            assignProductionsBtn.style.background = 'linear-gradient(135deg, #475569 0%, #334155 100%)';
            assignProductionsBtn.onclick = () => {
                // Сначала обновляем значения из селектов в объекты
                const rows = content.querySelectorAll('div[style*="grid"]');
                rows.forEach((row, idx) => {
                    if (idx === 0) return; // Пропускаем заголовок
                    const selects = row.querySelectorAll('select');
                    if (selects.length > 0 && rolesWithoutProduction[idx - 1]) {
                        const r = rolesWithoutProduction[idx - 1];
                        // Первый select - постановка
                        const productionSelect = selects[0];
                        if (productionSelect && productionSelect.value) {
                            r._pending_production_id = productionSelect.value;
                        }
                    }
                });
                
                // Переносим все роли, у которых выбран спектакль (с учетом отложенного выбора)
                let moved = 0;
                rolesWithoutProduction.forEach(r => {
                    const finalProdId = r._pending_production_id || r.production_id;
                    if (finalProdId && finalProdId !== '') {
                        r.production_id = finalProdId;
                        delete r._pending_production_id;
                        // Находим сцену для этого спектакля
                        const prod = state.productions.find(p => p.id === r.production_id);
                        if (prod && prod.stage_id) {
                            window.expandedRoleStages.add(prod.stage_id);
                            window.expandedRoleProductions.add(`${prod.stage_id}_${r.production_id}`);
                        }
                        moved++;
                    }
                });
                if (moved > 0) {
                    renderRoles();
                }
            };
            content.appendChild(assignProductionsBtn);
            
            noProdSection.appendChild(content);
            rolesList.appendChild(noProdSection);
        }
    }

    function renderPersonProductionRoles() {
        personProductionRolesList.innerHTML = '';
        
        // Храним состояние раскрытых сцен и спектаклей
        if (!window.expandedAssignmentStages) {
            window.expandedAssignmentStages = new Set();
        }
        if (!window.expandedAssignmentProductions) {
            window.expandedAssignmentProductions = new Set();
        }
        
        const peopleOpts = state.people.map(p => ({ value: p.id, label: p.name || p.id }));
        const productionOpts = state.productions.map(p => ({ value: p.id, label: p.title || p.id }));
        const rolesByProduction = {};
        state.roles.forEach(r => {
            if (!rolesByProduction[r.production_id]) rolesByProduction[r.production_id] = [];
            rolesByProduction[r.production_id].push({ value: r.id, label: r.name || r.id });
        });
        
        // Группируем назначения по сценам и спектаклям
        const assignmentsByStage = {};
        const assignmentsWithoutProduction = state.person_production_roles.filter(
            ppr => !ppr.production_id || ppr.production_id === ''
        );
        state.stages.forEach(stage => {
            assignmentsByStage[stage.id] = {};
            state.productions
                .filter(p => p.stage_id === stage.id)
                .forEach(prod => {
                    assignmentsByStage[stage.id][prod.id] = state.person_production_roles.filter(
                        ppr => ppr.production_id === prod.id
                    );
                });
        });
        
        // Создаем секции для каждой сцены
        state.stages.forEach(stage => {
            const stageColor = getStageColor(stage.name || stage.id);
            const stageProductions = state.productions.filter(p => p.stage_id === stage.id);
            const hasAssignments = stageProductions.some(prod => {
                const prodAssignments = assignmentsByStage[stage.id][prod.id] || [];
                return prodAssignments.length > 0;
            });
            
            if (!hasAssignments && stageProductions.length === 0) return;
            
            // Контейнер сцены
            const stageSection = document.createElement('div');
            stageSection.style.marginBottom = '12px';
            stageSection.style.border = `2px solid ${stageColor}`;
            stageSection.style.borderRadius = '12px';
            stageSection.style.overflow = 'hidden';
            stageSection.style.background = `linear-gradient(135deg, ${stageColor}15 0%, ${stageColor}08 100%)`;
            
            // Заголовок сцены
            const stageHeader = document.createElement('div');
            stageHeader.style.display = 'flex';
            stageHeader.style.alignItems = 'center';
            stageHeader.style.justifyContent = 'space-between';
            stageHeader.style.padding = '14px 16px';
            stageHeader.style.cursor = 'pointer';
            stageHeader.style.transition = 'background 0.2s';
            stageHeader.style.background = `${stageColor}20`;
            stageHeader.onmouseenter = () => {
                stageHeader.style.background = `${stageColor}30`;
            };
            stageHeader.onmouseleave = () => {
                stageHeader.style.background = `${stageColor}20`;
            };
            stageHeader.onclick = () => {
                const isExpanded = window.expandedAssignmentStages.has(stage.id);
                if (isExpanded) {
                    window.expandedAssignmentStages.delete(stage.id);
                } else {
                    window.expandedAssignmentStages.add(stage.id);
                }
                renderPersonProductionRoles();
            };
            
            const left = document.createElement('div');
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.gap = '12px';
            
            const colorBox = document.createElement('div');
            colorBox.style.width = '24px';
            colorBox.style.height = '24px';
            colorBox.style.borderRadius = '6px';
            colorBox.style.backgroundColor = stageColor;
            colorBox.style.border = '2px solid rgba(255,255,255,0.8)';
            
            const title = document.createElement('div');
            title.style.fontWeight = '600';
            title.style.fontSize = '16px';
            title.style.color = '#1a0a1a';
            title.textContent = stage.name || stage.id;
            
            const expandIcon = document.createElement('div');
            expandIcon.style.fontSize = '18px';
            expandIcon.textContent = window.expandedAssignmentStages.has(stage.id) ? '▼' : '▶';
            
            left.appendChild(colorBox);
            left.appendChild(title);
            stageHeader.appendChild(left);
            stageHeader.appendChild(expandIcon);
            stageSection.appendChild(stageHeader);
            
            // Контент сцены
            if (window.expandedAssignmentStages.has(stage.id)) {
                const stageContent = document.createElement('div');
                stageContent.style.padding = '12px';
                stageContent.style.background = 'rgba(255,255,255,0.6)';
                
                // Секции для каждого спектакля
                stageProductions.forEach(prod => {
                    const prodAssignments = assignmentsByStage[stage.id][prod.id] || [];
                    
                    const prodSection = document.createElement('div');
                    prodSection.setAttribute('data-production-id', prod.id);
                    prodSection.style.marginBottom = '12px';
                    prodSection.style.border = '1px solid #e2e8f0';
                    prodSection.style.borderRadius = '8px';
                    prodSection.style.overflow = 'hidden';
                    prodSection.style.background = 'white';
                    
                    // Заголовок спектакля
                    const prodHeader = document.createElement('div');
                    prodHeader.style.display = 'flex';
                    prodHeader.style.alignItems = 'center';
                    prodHeader.style.justifyContent = 'space-between';
                    prodHeader.style.padding = '10px 12px';
                    prodHeader.style.cursor = 'pointer';
                    prodHeader.style.background = '#f8fafc';
                    prodHeader.style.borderBottom = '1px solid #e2e8f0';
                    prodHeader.onclick = () => {
                        const key = `${stage.id}_${prod.id}`;
                        const isExpanded = window.expandedAssignmentProductions.has(key);
                        if (isExpanded) {
                            window.expandedAssignmentProductions.delete(key);
                        } else {
                            window.expandedAssignmentProductions.add(key);
                        }
                        renderPersonProductionRoles();
                    };
                    
                    const prodTitle = document.createElement('div');
                    prodTitle.style.fontWeight = '600';
                    prodTitle.style.fontSize = '14px';
                    prodTitle.textContent = prod.title || prod.id;
                    
                    const prodCount = document.createElement('div');
                    prodCount.style.fontSize = '12px';
                    prodCount.style.color = '#64748b';
                    prodCount.textContent = `${prodAssignments.length} назначений`;
                    
                    const prodExpandIcon = document.createElement('div');
                    prodExpandIcon.style.fontSize = '14px';
                    prodExpandIcon.textContent = window.expandedAssignmentProductions.has(`${stage.id}_${prod.id}`) ? '▼' : '▶';
                    
                    prodHeader.appendChild(prodTitle);
                    prodHeader.appendChild(prodCount);
                    prodHeader.appendChild(prodExpandIcon);
                    prodSection.appendChild(prodHeader);
                    
                    // Контент спектакля
                    if (window.expandedAssignmentProductions.has(`${stage.id}_${prod.id}`)) {
                        const prodContent = document.createElement('div');
                        prodContent.style.padding = '10px';
                        
                        // Заголовки колонок
                        const headerRow = document.createElement('div');
                        headerRow.style.display = 'grid';
                        headerRow.style.gridTemplateColumns = '1fr 1fr 60px 60px';
                        headerRow.style.gap = '8px';
                        headerRow.style.marginBottom = '8px';
                        headerRow.style.fontWeight = '600';
                        headerRow.style.fontSize = '12px';
                        headerRow.style.color = '#4a5568';
                        headerRow.style.paddingBottom = '6px';
                        headerRow.style.borderBottom = '1px solid #e2e8f0';
                        const headerNames = ['Роль', 'Человек', 'Может играть', ''];
                        headerNames.forEach(name => {
                            const headerCell = document.createElement('div');
                            headerCell.textContent = name;
                            headerRow.appendChild(headerCell);
                        });
                        prodContent.appendChild(headerRow);
                        
                        // Назначения спектакля
                        prodAssignments.forEach((ppr, idx) => {
                            const globalIdx = state.person_production_roles.findIndex(
                                a => a === ppr
                            );
                            if (globalIdx === -1) return;

                            const roleOpts = rolesByProduction[prod.id] || [];
            // Используем текущее значение role_id
            const roleSel = createSelect(roleOpts, ppr.role_id || '');
            // Используем текущее значение person_id (для назначений с production_id всегда используется person_id)
            const personSel = createSelect(peopleOpts, ppr.person_id || '');
            // Явно устанавливаем значение после создания, чтобы гарантировать правильный выбор
            // Это важно, чтобы значение не было потеряно при перерисовке
            if (ppr.person_id) {
                // Проверяем, что значение существует в опциях перед установкой
                if (peopleOpts.some(opt => opt.value === ppr.person_id)) {
                    personSel.value = ppr.person_id;
                }
            }
            const canPlay = document.createElement('input');
            canPlay.type = 'checkbox';
            canPlay.checked = Boolean(ppr.can_play);
            const del = document.createElement('button');
            del.textContent = '×';
            del.onclick = () => {
                                state.person_production_roles.splice(globalIdx, 1);
                renderPersonProductionRoles();
            };
                            
            // Добавляем data-атрибуты для идентификации
            roleSel.setAttribute('data-assignment-index', globalIdx);
            roleSel.setAttribute('data-field', 'role_id');
            personSel.setAttribute('data-assignment-index', globalIdx);
            personSel.setAttribute('data-field', 'person_id');
            canPlay.setAttribute('data-assignment-index', globalIdx);
            canPlay.setAttribute('data-field', 'can_play');
            // Обновляем состояние сразу при изменении
            personSel.onchange = () => {
                ppr.person_id = personSel.value;
            };
            personSel.oninput = () => {
                ppr.person_id = personSel.value;
            };
            roleSel.onchange = () => {
                ppr.role_id = roleSel.value;
            };
            roleSel.oninput = () => {
                ppr.role_id = roleSel.value;
            };
            canPlay.onchange = () => {
                ppr.can_play = canPlay.checked;
            };
                            
            const rDiv = document.createElement('div');
            rDiv.setAttribute('data-assignment-global-index', globalIdx);
            rDiv.style.display = 'grid';
                            rDiv.style.gridTemplateColumns = '1fr 1fr 60px 60px';
                            rDiv.style.gap = '8px';
            rDiv.style.marginBottom = '6px';

            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.style.display = 'flex';
            checkboxWrapper.style.justifyContent = 'center';
            checkboxWrapper.appendChild(canPlay);

                            rDiv.append(roleSel, personSel, checkboxWrapper, del);
                            prodContent.appendChild(rDiv);
                        });
                        
                        prodSection.appendChild(prodContent);
                    }
                    
                    stageContent.appendChild(prodSection);
                });
                
                stageSection.appendChild(stageContent);
            }
            
            personProductionRolesList.appendChild(stageSection);
        });
        
        // Назначения без спектакля
        if (assignmentsWithoutProduction.length > 0) {
            const noProdSection = document.createElement('div');
            noProdSection.style.marginBottom = '12px';
            noProdSection.style.border = '2px solid #e2e8f0';
            noProdSection.style.borderRadius = '12px';
            noProdSection.style.overflow = 'hidden';
            noProdSection.style.background = 'rgba(226, 232, 240, 0.3)';
            
            const header = document.createElement('div');
            header.style.padding = '14px 16px';
            header.style.fontWeight = '600';
            header.style.background = 'rgba(226, 232, 240, 0.5)';
            header.textContent = 'Без спектакля';
            noProdSection.appendChild(header);
            
            const content = document.createElement('div');
            content.style.padding = '12px';
            content.style.background = 'rgba(255,255,255,0.6)';
            
            // Заголовки колонок
            const headerRow = document.createElement('div');
            headerRow.style.display = 'grid';
            headerRow.style.gridTemplateColumns = '1fr 1fr 1fr 60px 60px';
            headerRow.style.gap = '8px';
            headerRow.style.marginBottom = '8px';
            headerRow.style.fontWeight = '600';
            headerRow.style.fontSize = '12px';
            headerRow.style.color = '#4a5568';
            headerRow.style.paddingBottom = '6px';
            headerRow.style.borderBottom = '1px solid #e2e8f0';
            const headerNames = ['Постановка', 'Роль', 'Человек', 'Может играть', ''];
            headerNames.forEach(name => {
                const headerCell = document.createElement('div');
                headerCell.textContent = name;
                headerRow.appendChild(headerCell);
            });
            content.appendChild(headerRow);
            
            assignmentsWithoutProduction.forEach((ppr, idx) => {
                const globalIdx = state.person_production_roles.findIndex(
                    a => a === ppr
                );
                if (globalIdx === -1) return;
                
                // Обновляем список ролей при создании, если спектакль уже выбран
                const effectiveProductionId = ppr._pending_production_id || ppr.production_id || '';
            const roleOpts = rolesByProduction[effectiveProductionId] || [];
            // Используем _pending_role_id, если role_id пустой (роль выбрана, но еще не применена)
            const effectiveRoleId = ppr.role_id || ppr._pending_role_id || '';
            const roleSel = createSelect(roleOpts, effectiveRoleId);
                const productionSel = createSelect(productionOpts, effectiveProductionId);
                // Используем _pending_person_id, если person_id пустой (человек выбран, но еще не применен)
                const effectivePersonId = ppr.person_id || ppr._pending_person_id || '';
                const personSel = createSelect(peopleOpts, effectivePersonId);
                // Явно устанавливаем значение, если оно есть и существует в опциях
                if (effectivePersonId && peopleOpts.some(opt => opt.value === effectivePersonId)) {
                    personSel.value = effectivePersonId;
                } else if (!effectivePersonId) {
                    // Если значение пустое, устанавливаем пустое значение, чтобы не выбирался первый вариант автоматически
                    personSel.value = '';
                }
                
                // Функция для обновления списка ролей на основе выбранной постановки
                const updateRoleList = (productionId) => {
                    if (!productionId) return;
                    const newRoleOpts = rolesByProduction[productionId] || [];
                    roleSel.innerHTML = '';
                    newRoleOpts.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        roleSel.appendChild(option);
                    });
                    // Восстанавливаем выбранную роль из role_id или _pending_role_id
                    const selectedRoleId = ppr.role_id || ppr._pending_role_id;
                    if (selectedRoleId) {
                        roleSel.value = selectedRoleId;
                    }
                };
                
                // Проверяем реальное значение селекта после создания
                // Если значение выбрано (в том числе по умолчанию), обновляем список ролей
                let actualProductionId = productionSel.value;
                
                // Если значение пустое, но в селекте есть опции, выбираем первую
                if (!actualProductionId && productionOpts.length > 0) {
                    actualProductionId = productionOpts[0].value;
                    productionSel.value = actualProductionId;
                    ppr._pending_production_id = actualProductionId;
                }
                
                if (actualProductionId) {
                    // Если значение было выбрано по умолчанию (не было в effectiveProductionId), сохраняем его
                    if (actualProductionId !== effectiveProductionId) {
                        ppr._pending_production_id = actualProductionId;
                    }
                    updateRoleList(actualProductionId);
                } else if (effectiveProductionId) {
                    // Если спектакль уже был выбран, обновляем список ролей
                    updateRoleList(effectiveProductionId);
                }
            const canPlay = document.createElement('input');
            canPlay.type = 'checkbox';
            canPlay.checked = Boolean(ppr.can_play);
            const del = document.createElement('button');
            del.textContent = '×';
            del.onclick = () => {
                    state.person_production_roles.splice(globalIdx, 1);
                renderPersonProductionRoles();
            };
                
            // Добавляем data-атрибуты для идентификации
            productionSel.setAttribute('data-assignment-index', globalIdx);
            productionSel.setAttribute('data-field', 'production_id');
            roleSel.setAttribute('data-assignment-index', globalIdx);
            roleSel.setAttribute('data-field', 'role_id');
            personSel.setAttribute('data-assignment-index', globalIdx);
            personSel.setAttribute('data-field', 'person_id');
            canPlay.setAttribute('data-assignment-index', globalIdx);
            canPlay.setAttribute('data-field', 'can_play');
                
            // Обновляем состояние сразу при изменении
            personSel.onchange = () => {
                ppr._pending_person_id = personSel.value;
            };
            personSel.oninput = () => {
                ppr._pending_person_id = personSel.value;
            };
            productionSel.onchange = () => {
                    // Сохраняем выбранный спектакль отдельно и не переносим сразу
                ppr._pending_production_id = productionSel.value;
                // Обновляем список ролей
                updateRoleList(ppr._pending_production_id);
                const newRoleOpts = rolesByProduction[ppr._pending_production_id] || [];
                if (newRoleOpts.length > 0 && !ppr._pending_role_id && !ppr.role_id) {
                    ppr._pending_role_id = newRoleOpts[0].value;
                    roleSel.value = ppr._pending_role_id;
                }
            };
            productionSel.oninput = () => {
                ppr._pending_production_id = productionSel.value;
                updateRoleList(ppr._pending_production_id);
            };
            roleSel.onchange = () => {
                ppr._pending_role_id = roleSel.value;
            };
            roleSel.oninput = () => {
                ppr._pending_role_id = roleSel.value;
            };
            canPlay.onchange = () => ppr.can_play = canPlay.checked;
                
            const rDiv = document.createElement('div');
            rDiv.setAttribute('data-assignment-global-index', globalIdx);
            rDiv.style.display = 'grid';
                rDiv.style.gridTemplateColumns = '1fr 1fr 1fr 60px 60px';
                rDiv.style.gap = '8px';
            rDiv.style.marginBottom = '6px';
                
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.style.display = 'flex';
            checkboxWrapper.style.justifyContent = 'center';
            checkboxWrapper.appendChild(canPlay);
                
            // Порядок колонок: Роль, Постановка, Человек, чекбокс, удалить
            rDiv.append(productionSel, roleSel, personSel, checkboxWrapper, del);
                content.appendChild(rDiv);
            });
            
            // Кнопка для переноса назначений в соответствующие секции
            const assignProductionsBtn = document.createElement('button');
            assignProductionsBtn.textContent = '✓ Назначить записанные назначения ролей';
            assignProductionsBtn.style.width = '100%';
            assignProductionsBtn.style.marginTop = '12px';
            assignProductionsBtn.style.padding = '12px';
            assignProductionsBtn.style.fontSize = '14px';
            assignProductionsBtn.style.background = 'linear-gradient(135deg, #475569 0%, #334155 100%)';
            assignProductionsBtn.onclick = () => {
                // Сначала обновляем значения из селектов в объекты
                const rows = content.querySelectorAll('div[style*="grid"]');
                rows.forEach((row, idx) => {
                    if (idx === 0) return; // Пропускаем заголовок
                    const selects = row.querySelectorAll('select');
                    if (selects.length >= 2 && assignmentsWithoutProduction[idx - 1]) {
                        const ppr = assignmentsWithoutProduction[idx - 1];
                        // Первый select - человек, второй - спектакль, третий - роль
                        ppr.person_id = selects[0].value;
                        ppr.production_id = selects[1].value;
                        if (selects[2]) {
                            ppr.role_id = selects[2].value;
                        }
                    }
                });
                
                // Переносим все назначения, у которых выбран спектакль (с учетом отложенного выбора)
                let moved = 0;
                assignmentsWithoutProduction.forEach(ppr => {
                    const finalProdId = ppr._pending_production_id || ppr.production_id;
                    if (finalProdId && finalProdId !== '') {
                        ppr.production_id = finalProdId;
                        if (ppr._pending_person_id) {
                            ppr.person_id = ppr._pending_person_id;
                        }
                        if (ppr._pending_role_id) {
                            ppr.role_id = ppr._pending_role_id;
                        }
                        delete ppr._pending_person_id;
                        delete ppr._pending_production_id;
                        delete ppr._pending_role_id;
                        // Находим сцену для этого спектакля
                        const prod = state.productions.find(p => p.id === ppr.production_id);
                        if (prod && prod.stage_id) {
                            window.expandedAssignmentStages.add(prod.stage_id);
                            window.expandedAssignmentProductions.add(`${prod.stage_id}_${ppr.production_id}`);
                        }
                        moved++;
                    }
                });
                if (moved > 0) {
                    renderPersonProductionRoles();
                }
            };
            content.appendChild(assignProductionsBtn);
            
            noProdSection.appendChild(content);
            personProductionRolesList.appendChild(noProdSection);
        }
        
        // Кнопка добавления назначения
        const addAssignmentBtn = document.createElement('button');
        addAssignmentBtn.textContent = '+ Добавить назначение роли';
        addAssignmentBtn.style.width = '100%';
        addAssignmentBtn.style.marginTop = '12px';
        addAssignmentBtn.style.padding = '12px';
        addAssignmentBtn.style.fontSize = '14px';
        addAssignmentBtn.onclick = () => {
            // Просто добавляем новое назначение и перерисовываем
            // Значения сохраняются автоматически через обработчики onchange/oninput
            state.person_production_roles.push({
                person_id: '',
                production_id: '',
                role_id: '',
                can_play: true
            });
            renderPersonProductionRoles();
        };
        personProductionRolesList.appendChild(addAssignmentBtn);
    }

    // Обработчики для людей и ролей
    addPersonBtn.onclick = () => {
        state.people.push({
            id: `person_${Date.now()}`,
            name: '',
            email: ''
        });
        renderPeople();
    };

    addRoleBtn.onclick = () => {
        // Добавляем роль без спектакля, чтобы пользователь мог выбрать
        state.roles.push({
            id: `role_${Date.now()}`,
            name: '',
            production_id: '', // Без спектакля, пользователь выберет
            is_conductor: false,
            required_count: 1
        });
        renderRoles();
    };


    async function loadRoles() {
        if (!scenarioId) return;
        try {
            const apiBase = API_BASE_URL;
            const response = await fetch(`${apiBase}/scenarios/${scenarioId}/roles`);
            if (response.ok) {
                const data = await response.json();
                state.roles = data.roles || [];
                renderRoles();
            }
        } catch (error) {
            console.error('Ошибка загрузки ролей:', error);
        }
    }

    async function loadPeople() {
        if (!scenarioId) return;
        try {
            const apiBase = API_BASE_URL;
            const response = await fetch(`${apiBase}/scenarios/${scenarioId}/people`);
            if (response.ok) {
                const data = await response.json();
                state.people = data.people || [];
                renderPeople();
            }
        } catch (error) {
            console.error('Ошибка загрузки людей:', error);
        }
    }

    async function loadPersonProductionRoles() {
        if (!scenarioId) return;
        try {
            const apiBase = API_BASE_URL;
            const response = await fetch(`${apiBase}/scenarios/${scenarioId}/person-production-roles`);
            if (response.ok) {
                const data = await response.json();
                state.person_production_roles = data.person_production_roles || [];
                renderPersonProductionRoles();
            }
        } catch (error) {
            console.error('Ошибка загрузки назначений:', error);
        }
    }

    async function loadAssignments() {
        if (!scenarioId) return;
        try {
            const apiBase = API_BASE_URL;
            const response = await fetch(`${apiBase}/scenarios/${scenarioId}/assignments`);
            if (response.ok) {
                const data = await response.json();
                state.assignments = data.assignments || [];
                renderAssignments();
            }
        } catch (error) {
            console.error('Ошибка загрузки назначений:', error);
        }
    }

    function renderAssignments() {
        const tbody = document.querySelector('#assignmentsTable tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        if (!scenarioId) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Сначала создайте сценарий и составьте расписание</td></tr>';
            return;
        }
        
        // Группируем назначения по элементам расписания
        const assignmentsByItem = {};
        state.assignments.forEach(a => {
            if (!assignmentsByItem[a.schedule_item_id]) {
                assignmentsByItem[a.schedule_item_id] = [];
            }
            assignmentsByItem[a.schedule_item_id].push(a);
        });
        
        // Находим информацию о расписании из scheduleTasks
        const timeslotsById = {};
        state.timeslots.forEach(t => timeslotsById[t.id] = t);
        const peopleById = {};
        state.people.forEach(p => peopleById[p.id] = p);
        const rolesById = {};
        state.roles.forEach(r => rolesById[r.id] = r);
        const productionsById = {};
        state.productions.forEach(p => productionsById[p.id] = p);
        const prodTitleMap = new Map();
        state.productions.forEach(p => {
            if (p.id) prodTitleMap.set(p.id, p.title || p.id);
        });
        
        // Используем scheduleTasks для получения информации о расписании
        const sortedTasks = [...scheduleTasks].sort((a, b) => 
            new Date(a.start) - new Date(b.start)
        );
        
        if (sortedTasks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Нет расписания. Составьте расписание, чтобы увидеть назначения.</td></tr>';
            return;
        }
        
        sortedTasks.forEach(task => {
            // Извлекаем production_id, stage_id, timeslot_id из task.id
            const [productionId, stageId, timeslotId] = task.id.split('|');
            const scheduleItemId = `${productionId}|${stageId}|${timeslotId}`;
            const assignments = assignmentsByItem[scheduleItemId] || [];
            const timeslot = timeslotsById[timeslotId];
            const production = productionsById[productionId];
            const date = new Date(task.start);
            
            if (assignments.length === 0) {
                // Показываем строку даже если нет назначений
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${formatDate(task.start)}</td>
                    <td>${formatTime(task.start)}</td>
                    <td>${task.resource}</td>
                    <td>${prodTitleMap.get(productionId) || productionId}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                `;
                tbody.appendChild(tr);
            } else {
				assignments.forEach((a, idx) => {
					const tr = document.createElement('tr');
					const person = peopleById[a.person_id];
					const role = rolesById[a.role_id];
					// Находим людей, которые могут играть эту роль в этом спектакле
					const availablePeople = state.person_production_roles
						.filter(ppr => ppr.production_id === productionId && ppr.role_id === a.role_id && ppr.can_play)
						.map(ppr => peopleById[ppr.person_id])
						.filter(p => p !== undefined);
					
					tr.innerHTML = `
						<td>${idx === 0 ? formatDate(task.start) : ''}</td>
						<td>${idx === 0 ? formatTime(task.start) : ''}</td>
						<td>${idx === 0 ? task.resource : ''}</td>
						<td>${idx === 0 ? (prodTitleMap.get(productionId) || productionId) : ''}</td>
						<td>${role?.name || a.role_id} ${a.is_conductor ? '(Дирижер)' : ''}</td>
						<td>
							<select class="assignment-person-select" data-schedule-item-id="${a.schedule_item_id}" data-role-id="${a.role_id}" data-production-id="${productionId}">
								${availablePeople.map(p => `<option value="${p.id}" ${p.id === a.person_id ? 'selected' : ''}>${p.name || p.id}</option>`).join('')}
							</select>
						</td>
						<td>
							<button class="update-assignment-btn" data-schedule-item-id="${a.schedule_item_id}" data-role-id="${a.role_id}">Обновить</button>
						</td>
					`;
					tbody.appendChild(tr);
				});
			}
        });
        
        // Добавляем обработчики для обновления назначений
        document.querySelectorAll('.update-assignment-btn').forEach(btn => {
            btn.onclick = async () => {
                const scheduleItemId = btn.dataset.scheduleItemId;
                const roleId = btn.dataset.roleId;
                const select = document.querySelector(`.assignment-person-select[data-schedule-item-id="${scheduleItemId}"][data-role-id="${roleId}"]`);
                const personId = select.value;
                
                try {
                    const apiBase = API_BASE_URL;
                    const response = await fetch(`${apiBase}/scenarios/${scenarioId}/assignments`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            schedule_item_id: scheduleItemId,
                            role_id: roleId,
                            person_id: personId
                        })
                    });
                    if (!response.ok) throw new Error('Ошибка обновления назначения');
                    await loadAssignments();
                    setStatus('Назначение обновлено', false, true);
                } catch (error) {
                    setStatus(`Ошибка: ${error.message}`, true);
                }
            };
        });
    }

    // Функция для отображения модального окна с назначениями
    function showAssignmentsModal(productionId, stageId, timeslotId) {
        const scheduleItemId = `${productionId}|${stageId}|${timeslotId}`;
        const assignments = state.assignments.filter(a => a.schedule_item_id === scheduleItemId);
        
        const modal = document.getElementById('assignmentsModal');
        const content = document.getElementById('assignmentsModalContent');
        
        // Находим информацию о спектакле
        const production = state.productions.find(p => p.id === productionId);
        const timeslot = state.timeslots.find(t => t.id === timeslotId);
        const stage = state.stages.find(s => s.id === stageId);
        
        const peopleById = {};
        state.people.forEach(p => peopleById[p.id] = p);
        const rolesById = {};
        state.roles.forEach(r => rolesById[r.id] = r);
        
        // Группируем назначения по ролям
        const assignmentsByRole = {};
        assignments.forEach(a => {
            if (!assignmentsByRole[a.role_id]) {
                assignmentsByRole[a.role_id] = [];
            }
            assignmentsByRole[a.role_id].push(a);
        });
        
        let html = `
            <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 2px solid rgba(102, 126, 234, 0.2);">
                <h3 style="margin: 0 0 12px; color: #1a202c; font-family: 'Playfair Display', serif; font-size: 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">${production?.title || productionId}</h3>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; color: #64748b; font-size: 14px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 18px;">🎭</span>
                        <span><strong>Сцена:</strong> ${stage?.name || stageId}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 18px;">📅</span>
                        <span><strong>Дата:</strong> ${timeslot?.date || ''}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 18px;">🕐</span>
                        <span><strong>Время:</strong> ${timeslot?.start_time || ''}</span>
                    </div>
                </div>
            </div>
        `;
        
        if (assignments.length === 0) {
            html += '<div style="padding: 20px; text-align: center; color: #64748b;">Назначения ещё не созданы. Составьте расписание, чтобы увидеть назначения.</div>';
        } else {
            html += '<div style="display: flex; flex-direction: column; gap: 12px;">';
            
            Object.keys(assignmentsByRole).forEach(roleId => {
                const role = rolesById[roleId];
                const roleAssignments = assignmentsByRole[roleId];
                
                html += `
                    <div style="border: 2px solid rgba(102, 126, 234, 0.2); border-radius: 12px; padding: 16px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);">
                        <div style="font-weight: 600; margin-bottom: 12px; color: #1a202c; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 20px;">${role?.is_conductor ? '🎼' : '🎭'}</span>
                            <span>${role?.name || roleId} ${role?.is_conductor ? '(Дирижер)' : ''}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                `;
                
                roleAssignments.forEach(a => {
                    const person = peopleById[a.person_id];
                    // Находим людей, которые могут играть эту роль в этом спектакле
                    const availablePeople = state.person_production_roles
                        .filter(ppr => ppr.production_id === productionId && ppr.role_id === roleId && ppr.can_play)
                        .map(ppr => peopleById[ppr.person_id])
                        .filter(p => p !== undefined);
                    
                    html += `
                        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: white; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); transition: all 0.3s;">
                            <div style="flex: 1; font-weight: 500; color: #1a202c;">${person?.name || a.person_id}</div>
                            <select class="modal-assignment-select" data-schedule-item-id="${a.schedule_item_id}" data-role-id="${a.role_id}" data-production-id="${productionId}">
                                ${availablePeople.map(p => `<option value="${p.id}" ${p.id === a.person_id ? 'selected' : ''}>${p.name || p.id}</option>`).join('')}
                            </select>
                            <button class="modal-update-btn" data-schedule-item-id="${a.schedule_item_id}" data-role-id="${a.role_id}">Обновить</button>
                        </div>
                    `;
                });
                
                html += '</div></div>';
            });
            
            html += '</div>';
        }
        
        content.innerHTML = html;
        modal.style.display = 'flex';
        
        // Добавляем обработчики для обновления назначений
        document.querySelectorAll('.modal-update-btn').forEach(btn => {
            btn.onclick = async () => {
                const scheduleItemId = btn.dataset.scheduleItemId;
                const roleId = btn.dataset.roleId;
                const select = document.querySelector(`.modal-assignment-select[data-schedule-item-id="${scheduleItemId}"][data-role-id="${roleId}"]`);
                const personId = select.value;
                
                try {
                    const apiBase = API_BASE_URL;
                    const response = await fetch(`${apiBase}/scenarios/${scenarioId}/assignments`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            schedule_item_id: scheduleItemId,
                            role_id: roleId,
                            person_id: personId
                        })
                    });
                    if (!response.ok) throw new Error('Ошибка обновления назначения');
                    await loadAssignments();
                    // Обновляем модальное окно
                    showAssignmentsModal(productionId, stageId, timeslotId);
                    setStatus('Назначение обновлено', false, true);
                } catch (error) {
                    setStatus(`Ошибка: ${error.message}`, true);
                }
            };
        });
    }
    
    // Закрытие модального окна
    document.getElementById('closeAssignmentsModal').onclick = () => {
        document.getElementById('assignmentsModal').style.display = 'none';
    };
    
    // Закрытие при клике вне модального окна
    document.getElementById('assignmentsModal').onclick = (e) => {
        if (e.target.id === 'assignmentsModal') {
            document.getElementById('assignmentsModal').style.display = 'none';
        }
    };

    // Add row handlers
        addProductionBtn.onclick = () => {
            // Добавляем постановку без сцены, чтобы пользователь мог выбрать
            state.productions.push({
                id: `prod_${Date.now()}`,
                title: '',
                stage_id: '', // Без сцены, пользователь выберет
                max_shows: 1,
                weekend_priority: false
            });
            renderProductions();
        };
    // Кнопка "Добавить таймслот" удалена, теперь используется "Добавить слот сцены" в каждой секции
    // Кнопка "Сгенерировать месяц" также удалена
    

    // Seed defaults
    state.stages = [
        { id: 's1', name: 'Историческая сцена' },
        { id: 's2', name: 'Новая сцена' },
        { id: 's3', name: 'Камерная сцена' },
    ];
    state.productions = [
        { id: 'p1', title: 'Спящая красавица', stage_id: 's1', max_shows: 4, weekend_priority: true },
        { id: 'p2', title: 'Риголетто', stage_id: 's1', max_shows: 3, weekend_priority: false },
        { id: 'p3', title: 'Адриана Лекуврёр', stage_id: 's1', max_shows: 3, weekend_priority: false },
        { id: 'p4', title: 'Петрушка', stage_id: 's1', max_shows: 4, weekend_priority: true },
        { id: 'p5', title: 'Мертвые души', stage_id: 's1', max_shows: 3, weekend_priority: false },
        { id: 'p6', title: 'Симон и Бокканегра', stage_id: 's1', max_shows: 4, weekend_priority: false },
        { id: 'p7', title: 'Ромео и Джульетта', stage_id: 's1', max_shows: 4, weekend_priority: false },
        { id: 'p8', title: 'Сказка о царе Салтане', stage_id: 's2', max_shows: 3, weekend_priority: true },
        { id: 'p9', title: 'Жизель', stage_id: 's2', max_shows: 3, weekend_priority: false },
        { id: 'p10', title: 'Мастер и Маргарита', stage_id: 's2', max_shows: 4, weekend_priority: true },
        { id: 'p11', title: 'Иоланта', stage_id: 's2', max_shows: 5, weekend_priority: false },
        { id: 'p12', title: 'Так поступают все женщины', stage_id: 's2', max_shows: 2, weekend_priority: false },
        { id: 'p13', title: 'Светлый ручей', stage_id: 's2', max_shows: 4, weekend_priority: true },
        { id: 'p14', title: 'Сказание о невидимом граде', stage_id: 's2', max_shows: 1, weekend_priority: false },
        { id: 'p15', title: 'Семь девушек', stage_id: 's2', max_shows: 1, weekend_priority: false },
        { id: 'p16', title: 'Снегурочка', stage_id: 's2', max_shows: 2, weekend_priority: false },
        { id: 'p17', title: 'Сорочинская ярамрка', stage_id: 's2', max_shows: 2, weekend_priority: false },
        { id: 'p18', title: 'Сын мандарина', stage_id: 's3', max_shows: 3, weekend_priority: true },
        { id: 'p19', title: 'Король', stage_id: 's3', max_shows: 6, weekend_priority: false },
        { id: 'p20', title: 'Ариандна на наксосе', stage_id: 's3', max_shows: 2, weekend_priority: false },
        { id: 'p21', title: 'Петя и волк', stage_id: 's3', max_shows: 4, weekend_priority: true },
        { id: 'p22', title: 'Похождения повесы', stage_id: 's3', max_shows: 4, weekend_priority: false },
        { id: 'p23', title: 'Питер пэн', stage_id: 's3', max_shows: 5, weekend_priority: false }
    ];
    // Генерируем календарь для ноября (месяц 11)
    const defaultYear = 2025;
    const defaultMonth = 11; // Ноябрь
    state.timeslots = generateMonthCalendar(defaultYear, defaultMonth);
    // Сохраняем оригинальные таймслоты для возможности восстановления
    state.originalTimeslots = JSON.parse(JSON.stringify(state.timeslots));
    
    // Тестовые данные для людей (дирижеры и артисты)
    state.people = [
        // Дирижеры
        { id: 'conductor1', name: 'Антон Гришанин', email: 'grishanin@theater.ru' },
        { id: 'conductor2', name: 'Павел Сорокин', email: 'sorokin@theater.ru' },
        { id: 'conductor3', name: 'Туган Сохиев', email: 'sohiev@theater.ru' },
        { id: 'conductor4', name: 'Павел Клиничев', email: 'klinichev@theater.ru' },
        // Артисты (оперные певцы)
        { id: 'singer1', name: 'Полина Авилова', email: 'avilova@theater.ru' },
        { id: 'singer2', name: 'Марина Вульф', email: 'vulff@theater.ru' },
        { id: 'singer3', name: 'Мария Евстигнеева', email: 'evstigneeva@theater.ru' },
        { id: 'singer4', name: 'Мура Холодовская', email: 'holodovskaya@theater.ru' },
        { id: 'singer5', name: 'Константин Шушаков', email: 'shushakov@theater.ru' },
        { id: 'singer6', name: 'Илья Селиванов', email: 'selivanov@theater.ru' },
        { id: 'singer7', name: 'Медея Чикашвили', email: 'chikashvili@theater.ru' },
        { id: 'singer8', name: 'Денис Макаров', email: 'makarov@theater.ru' },
        { id: 'singer9', name: 'Ольга Глебова', email: 'arkhipova@theater.ru' },
        { id: 'singer10', name: 'Артём Попов', email: 'popov@theater.ru' },
        // Артисты (балетные танцовщики)
        { id: 'dancer1', name: 'Вероника Хорошева', email: 'horosheva@theater.ru' },
        { id: 'dancer2', name: 'Владимир Комович', email: 'komovich@theater.ru' },
        { id: 'dancer3', name: 'Гузель Шарипова', email: 'sharipova@theater.ru' },
        { id: 'dancer4', name: 'Анна Семенюк', email: 'semenyuk@theater.ru' },
        { id: 'dancer5', name: 'Александр Бородин', email: 'borodin@theater.ru' },
        { id: 'dancer6', name: 'Ирина Марченкова', email: 'marchenko@theater.ru' },
        { id: 'dancer7', name: 'Андрей Потатурин', email: 'potaturin@theater.ru' },
        { id: 'dancer8', name: 'Андрей Григорьев', email: 'grigoryev@theater.ru' },
        { id: 'dancer9', name: 'Марат Гали', email: 'gal@theater.ru' },
        { id: 'dancer10', name: 'Михаил Яненко', email: 'yanenko@theater.ru' },
        // Универсальные артисты (могут и петь, и танцевать)
        { id: 'artist1', name: 'Алексей Сулимов', email: 'sulimov@theater.ru' },
        { id: 'artist2', name: 'Демьян Онуфрак', email: 'onufrak@theater.ru' },
        { id: 'artist3', name: 'Василий Гафнер', email: 'gaffner@theater.ru' },
        { id: 'artist4', name: 'Павел Паремузов', email: 'paremuzov@theater.ru' },
    ];
    
    // Генерируем роли для всех спектаклей
    function generateRolesForAllProductions() {
        const roles = [];
        state.productions.forEach(prod => {
            // Всегда добавляем дирижера
            roles.push({
                id: `${prod.id}_conductor`,
                name: 'Дирижер',
                production_id: prod.id,
                is_conductor: true,
                required_count: 1
            });
            
            // Генерируем роли на основе названия спектакля
            const titleLower = (prod.title || '').toLowerCase();
            
            if (titleLower.includes('спящая') || titleLower.includes('sleeping')) {
                roles.push(
                    { id: `${prod.id}_aurora`, name: 'Аврора', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_prince_desire`, name: 'Принц Дезире', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_lilac_fairy`, name: 'Фея Сирени', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_carabosse`, name: 'Карабосс', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('риголетто') || titleLower.includes('rigoletto')) {
                roles.push(
                    { id: `${prod.id}_rigoletto`, name: 'Риголетто', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_gilda`, name: 'Джильда', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_duke`, name: 'Герцог Мантуанский', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_sparafucile`, name: 'Спарафучиле', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('адриана') || titleLower.includes('adriana')) {
                roles.push(
                    { id: `${prod.id}_adriana`, name: 'Адриана Лекуврёр', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_maurizio`, name: 'Маурицио', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_princess`, name: 'Принцесса де Буйон', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('петрушка') || titleLower.includes('petrushka')) {
                roles.push(
                    { id: `${prod.id}_petrushka`, name: 'Петрушка', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_ballerina`, name: 'Балерина', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_moor`, name: 'Мавр', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('мертвые') || titleLower.includes('души')) {
                roles.push(
                    { id: `${prod.id}_chichikov`, name: 'Чичиков', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_manilov`, name: 'Манилов', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_korobochka`, name: 'Коробочка', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('симон') || titleLower.includes('бокканегра')) {
                roles.push(
                    { id: `${prod.id}_simon`, name: 'Симон Бокканегра', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_amelia`, name: 'Амелия', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_gabriele`, name: 'Габриэле Адорно', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('ромео') || titleLower.includes('джульетта')) {
                roles.push(
                    { id: `${prod.id}_romeo`, name: 'Ромео', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_juliet`, name: 'Джульетта', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_mercutio`, name: 'Меркуцио', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('салтан')) {
                roles.push(
                    { id: `${prod.id}_tsar`, name: 'Царь Салтан', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_tsarina`, name: 'Царица', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_guidon`, name: 'Гвидон', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_swan`, name: 'Царевна-Лебедь', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('жизель')) {
                roles.push(
                    { id: `${prod.id}_giselle`, name: 'Жизель', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_albrecht`, name: 'Альбрехт', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_hilarion`, name: 'Гиларион', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('мастер') || titleLower.includes('маргарита')) {
                roles.push(
                    { id: `${prod.id}_master`, name: 'Мастер', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_margarita`, name: 'Маргарита', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_woland`, name: 'Воланд', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('иоланта')) {
                roles.push(
                    { id: `${prod.id}_iolanta`, name: 'Иоланта', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_vautdemont`, name: 'Водемон', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_king`, name: 'Король Рене', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('женщины') || titleLower.includes('cosi')) {
                roles.push(
                    { id: `${prod.id}_fiordiligi`, name: 'Фьордилиджи', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_dorabella`, name: 'Дорабелла', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_ferrando`, name: 'Феррандо', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('ручей')) {
                roles.push(
                    { id: `${prod.id}_zya`, name: 'Зина', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_pyotr`, name: 'Пётр', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('невидимом') || titleLower.includes('граде')) {
                roles.push(
                    { id: `${prod.id}_fyodor`, name: 'Фёдор', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_fevronia`, name: 'Феврония', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('снегурочка')) {
                roles.push(
                    { id: `${prod.id}_snegurochka`, name: 'Снегурочка', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_mizgir`, name: 'Мизгирь', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_lial`, name: 'Лель', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('сорочинская') || titleLower.includes('ярмарка')) {
                roles.push(
                    { id: `${prod.id}_gritsko`, name: 'Грицько', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_parasya`, name: 'Парася', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('мандарин')) {
                roles.push(
                    { id: `${prod.id}_mandarin_son`, name: 'Сын мандарина', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_princess`, name: 'Принцесса', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('король') && !titleLower.includes('царь')) {
                roles.push(
                    { id: `${prod.id}_king_main`, name: 'Король', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_queen_main`, name: 'Королева', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('ариадна')) {
                roles.push(
                    { id: `${prod.id}_ariadne`, name: 'Ариадна', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_bacchus`, name: 'Бахус', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('петя') || titleLower.includes('волк')) {
                roles.push(
                    { id: `${prod.id}_peter`, name: 'Петя', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_grandfather`, name: 'Дедушка', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('повесы') || titleLower.includes('rake')) {
                roles.push(
                    { id: `${prod.id}_tom`, name: 'Том Рейквелл', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_anne`, name: 'Энн Трулав', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else if (titleLower.includes('питер') && titleLower.includes('пэн')) {
                roles.push(
                    { id: `${prod.id}_peter_pan`, name: 'Питер Пэн', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_wendy`, name: 'Венди', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_captain`, name: 'Капитан Крюк', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            } else {
                // Стандартные роли по умолчанию
                roles.push(
                    { id: `${prod.id}_lead_male`, name: 'Главная мужская роль', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_lead_female`, name: 'Главная женская роль', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_supporting_male`, name: 'Второстепенная мужская роль', production_id: prod.id, is_conductor: false, required_count: 1 },
                    { id: `${prod.id}_supporting_female`, name: 'Второстепенная женская роль', production_id: prod.id, is_conductor: false, required_count: 1 }
                );
            }
        });
        return roles;
    }
    
    state.roles = generateRolesForAllProductions();
    
    // Функция для случайного выбора элементов из массива
    function randomSelect(arr, min, max) {
        const count = Math.floor(Math.random() * (max - min + 1)) + min;
        const shuffled = [...arr].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }
    
    // Создаём связи: кто может играть какую роль
    // Жёсткие ограничения: на каждый спектакль только 1-2 дирижера
    const allConductors = ['conductor1', 'conductor2', 'conductor3', 'conductor4'];
    state.productions.forEach(prod => {
        const conductorRole = state.roles.find(r => r.production_id === prod.id && r.is_conductor);
        if (conductorRole) {
            // Выбираем случайно 1-2 дирижера для каждого спектакля
            const selectedConductors = randomSelect(allConductors, 1, 2);
            selectedConductors.forEach(conductorId => {
                state.person_production_roles.push({
                    person_id: conductorId,
                    production_id: prod.id,
                    role_id: conductorRole.id,
                    can_play: true
                });
            });
        }
    });
    
    // Артисты могут играть соответствующие роли
    // Оперные певцы - для оперных спектаклей
    const operaProductions = state.productions.filter(p => 
        !p.title.toLowerCase().includes('балет') && 
        !p.title.toLowerCase().includes('петрушка') &&
        !p.title.toLowerCase().includes('спящая') &&
        !p.title.toLowerCase().includes('жизель') &&
        !p.title.toLowerCase().includes('ромео') &&
        !p.title.toLowerCase().includes('ручей')
    );
    
    const allSingers = ['singer1', 'singer2', 'singer3', 'singer4', 'singer5', 'singer6', 'singer7', 'singer8', 'singer9', 'singer10'];
    operaProductions.forEach(prod => {
        const nonConductorRoles = state.roles.filter(r => r.production_id === prod.id && !r.is_conductor);
        nonConductorRoles.forEach(role => {
            // Жёсткие ограничения: на каждую роль только 1-2 певца
            const selectedSingers = randomSelect(allSingers, 1, 2);
            selectedSingers.forEach(singerId => {
                state.person_production_roles.push({
                    person_id: singerId,
                    production_id: prod.id,
                    role_id: role.id,
                    can_play: true
                });
            });
        });
    });
    
    // Балетные танцовщики - для балетных спектаклей
    const balletProductions = state.productions.filter(p => 
        p.title.toLowerCase().includes('спящая') ||
        p.title.toLowerCase().includes('петрушка') ||
        p.title.toLowerCase().includes('жизель') ||
        p.title.toLowerCase().includes('ромео') ||
        p.title.toLowerCase().includes('ручей')
    );
    
    const allDancers = ['dancer1', 'dancer2', 'dancer3', 'dancer4', 'dancer5', 'dancer6', 'dancer7', 'dancer8', 'dancer9', 'dancer10'];
    balletProductions.forEach(prod => {
        const nonConductorRoles = state.roles.filter(r => r.production_id === prod.id && !r.is_conductor);
        nonConductorRoles.forEach(role => {
            // Жёсткие ограничения: на каждую роль только 1-2 танцовщика
            const selectedDancers = randomSelect(allDancers, 1, 2);
            selectedDancers.forEach(dancerId => {
                state.person_production_roles.push({
                    person_id: dancerId,
                    production_id: prod.id,
                    role_id: role.id,
                    can_play: true
                });
            });
        });
    });
    
    // Универсальные артисты могут играть любые роли (тоже ограничиваем)
    const allArtists = ['artist1', 'artist2', 'artist3', 'artist4'];
    state.productions.forEach(prod => {
        const nonConductorRoles = state.roles.filter(r => r.production_id === prod.id && !r.is_conductor);
        nonConductorRoles.forEach(role => {
            // Жёсткие ограничения: на каждую роль только 1-2 универсальных артиста
            const selectedArtists = randomSelect(allArtists, 1, 2);
            selectedArtists.forEach(artistId => {
                state.person_production_roles.push({
                    person_id: artistId,
                    production_id: prod.id,
                    role_id: role.id,
                    can_play: true
                });
            });
        });
    });
    
    renderProductions();
    renderStages();
    renderTimeslots();
    
    // Добавляем тестовые данные для людей сразу при загрузке
    if (state.people.length === 0) {
        state.people = [
            { id: 'person_1', name: 'Иван Иванов', email: 'ivan@example.com' },
            { id: 'person_2', name: 'Мария Петрова', email: 'maria@example.com' },
            { id: 'person_3', name: 'Петр Сидоров', email: 'petr@example.com' },
            { id: 'person_4', name: 'Анна Смирнова', email: 'anna@example.com' },
            { id: 'person_5', name: 'Сергей Козлов', email: 'sergey@example.com' }
        ];
    }
    
    // Добавляем тестовые роли, если есть постановки
    if (state.roles.length === 0 && state.productions.length > 0) {
        state.productions.forEach(prod => {
            if (prod.id && prod.title) {
                const titleLower = (prod.title || '').toLowerCase();
                if (titleLower.includes('мастер') || titleLower.includes('маргарита')) {
                    state.roles.push(
                        { id: `${prod.id}_master`, name: 'Мастер', production_id: prod.id, is_conductor: false, required_count: 1 },
                        { id: `${prod.id}_margarita`, name: 'Маргарита', production_id: prod.id, is_conductor: false, required_count: 1 },
                        { id: `${prod.id}_woland`, name: 'Воланд', production_id: prod.id, is_conductor: false, required_count: 1 }
                    );
                } else {
                    // Общие роли для других постановок
                    state.roles.push(
                        { id: `${prod.id}_role1`, name: 'Главная роль', production_id: prod.id, is_conductor: false, required_count: 1 },
                        { id: `${prod.id}_role2`, name: 'Вторая роль', production_id: prod.id, is_conductor: false, required_count: 1 }
                    );
                }
            }
        });
    }
    
    // Добавляем тестовые назначения ролей, если есть люди и роли
    if (state.person_production_roles.length === 0 && state.people.length > 0 && state.roles.length > 0) {
        state.roles.forEach((role, idx) => {
            if (role.production_id && role.id) {
                // Назначаем первого человека на первую роль, второго на вторую и т.д.
                const personIdx = idx % state.people.length;
                const person = state.people[personIdx];
                if (person && person.id) {
                    state.person_production_roles.push({
                        person_id: person.id,
                        production_id: role.production_id,
                        role_id: role.id,
                        can_play: true
                    });
                }
            }
        });
    }
    
    // Рендерим людей, роли и назначения сразу при загрузке
    renderPeople();
    renderRoles();
    renderPersonProductionRoles();

    function validate() {
        if (!state.productions || state.productions.length === 0) {
            return 'Добавьте хотя бы одну постановку';
        }
        if (!state.stages || state.stages.length === 0) {
            return 'Добавьте хотя бы одну сцену';
        }
        if (!state.timeslots || state.timeslots.length === 0) {
            return 'Добавьте хотя бы один таймслот';
        }
        if (state.productions.some(p => !p.title || !p.title.trim())) {
            return 'Заполните название у всех постановок';
        }
        if (state.productions.some(p => !p.stage_id)) {
            return 'Выберите сцену для всех постановок';
        }
        if (state.stages.some(s => !s.name || !s.name.trim())) {
            return 'Заполните название у всех сцен';
        }
        if (state.timeslots.some(t => !t.stage_id)) {
            return 'Выберите сцену для всех таймслотов';
        }
        if (state.timeslots.some(t => !t.date)) {
            return 'Заполните дату у всех таймслотов';
        }
        // Проверяем, что все stage_id в productions существуют в stages
        const stageIds = new Set(state.stages.map(s => s.id || generateId(s.name || 'stage')));
        const invalidStageIds = state.productions.filter(p => {
            const pStageId = p.stage_id;
            return pStageId && !stageIds.has(pStageId);
        });
        if (invalidStageIds.length > 0) {
            return `У постановок указаны несуществующие сцены. Проверьте привязку сцен.`;
        }
        // Проверяем, что все stage_id в timeslots существуют в stages
        const invalidTimeslotStageIds = state.timeslots.filter(t => {
            const tStageId = t.stage_id;
            return tStageId && !stageIds.has(tStageId);
        });
        if (invalidTimeslotStageIds.length > 0) {
            return `У таймслотов указаны несуществующие сцены. Проверьте привязку сцен.`;
        }
        return null;
    }

    function compilePayload() {
        return {
            productions: state.productions.map(p => ({
                id: p.id || generateId(p.title || 'production'),
                title: p.title,
                stage_id: p.stage_id,
                max_shows: Number(p.max_shows || 1),
                weekend_priority: Boolean(p.weekend_priority || false)
            })),
            stages: state.stages.map(s => ({ 
                id: s.id || generateId(s.name || 'stage'), 
                name: s.name 
            })),
            timeslots: state.timeslots
                .filter(t => t.stage_id && t.date) // Фильтруем неполные таймслоты
                .map((t, index) => {
                    // Вычисляем day_of_week из даты в московском времени
                    let dow = 0;
                    if (t.date) {
                        try {
                            dow = getMoscowDayOfWeek(t.date);
                        } catch (e) {
                            console.warn('Ошибка при обработке даты:', t.date, e);
                            return null;
                        }
                    } else if (t.day_of_week !== undefined) {
                        dow = t.day_of_week;
                    }
                    
                    // Форматируем дату в ISO формат (YYYY-MM-DD)
                    let formattedDate = t.date;
                    if (t.date) {
                        try {
                            const dateStr = t.date.trim();
                            const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
                            if (dateMatch) {
                                // Если уже в правильном формате, используем как есть
                                formattedDate = dateMatch[0];
                            } else {
                                // Иначе парсим и форматируем
                                const d = new Date(t.date);
                                if (!isNaN(d.getTime())) {
                                    const year = d.getFullYear();
                                    const month = String(d.getMonth() + 1).padStart(2, '0');
                                    const day = String(d.getDate()).padStart(2, '0');
                                    formattedDate = `${year}-${month}-${day}`;
                                }
                            }
                        } catch (e) {
                            console.warn('Ошибка форматирования даты:', t.date, e);
                        }
                    }
                    
                    return {
                        id: t.id || `slot_${Date.now()}_${index}`,
                        stage_id: t.stage_id,
                        date: formattedDate,
                        day_of_week: dow,
                        start_time: (t.start_time || '19:00').trim()
                    };
                })
                .filter(t => t !== null), // Убираем null значения
            revenue: {},
            params: { 
                time_limit_seconds: 10,
                constraints: getConstraints()
            },
            fixed_assignments: (state.fixedAssignments || []).map(fa => ({
                production_id: fa.production_id,
                timeslot_id: fa.timeslot_id,
                stage_id: fa.stage_id,
                date: fa.date,
                start_time: fa.start_time
            })),
            people: state.people.map(p => ({
                id: p.id,
                name: p.name,
                email: p.email
            })),
            roles: state.roles.map(r => ({
                id: r.id,
                name: r.name,
                production_id: r.production_id,
                is_conductor: Boolean(r.is_conductor),
                required_count: Number(r.required_count || 1)
            })),
            person_production_roles: state.person_production_roles.map(ppr => ({
                person_id: ppr.person_id,
                production_id: ppr.production_id,
                role_id: ppr.role_id,
                can_play: Boolean(ppr.can_play)
            }))
        };
    }

    async function createScenario() {
		try {
            setStatus('Создаём сценарий...');
            const err = validate();
            if (err) { 
				setStatus(err, true); 
				return; 
			}
            
            const payload = compilePayload();
            
            // Дополнительная проверка payload
            if (!payload.productions || payload.productions.length === 0) {
                setStatus('Ошибка: нет постановок для отправки', true);
                return;
            }
            if (!payload.stages || payload.stages.length === 0) {
                setStatus('Ошибка: нет сцен для отправки', true);
                return;
            }
            if (!payload.timeslots || payload.timeslots.length === 0) {
                setStatus('Ошибка: нет таймслотов для отправки', true);
                return;
            }
            
            console.log('Отправляемый payload:', JSON.stringify(payload, null, 2));
            
            const apiUrl = `${API_BASE_URL}/scenarios`;
            console.log('API URL:', apiUrl);
            
            let res;
            try {
				res = await fetch(apiUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
			} catch (fetchError) {
				setStatus(`Ошибка подключения к серверу. Убедитесь, что API запущен на ${API_BASE_URL}. Ошибка: ${fetchError.message}`, true);
				console.error('Ошибка fetch:', fetchError);
				return;
			}
            
			if (!res.ok) {
				const errorText = await res.text();
				let errorDetail = errorText;
				try {
					const errorJson = JSON.parse(errorText);
					errorDetail = errorJson.detail || errorText;
				} catch {
					// Если не JSON, используем как есть
				}
				setStatus(`Ошибка сервера (${res.status}): ${errorDetail}`, true);
				console.error('Ошибка ответа сервера:', res.status, errorDetail);
				return;
			}
            
			const data = await res.json();
			scenarioId = data.scenario_id;
			setStatus(`✅ Сценарий создан: ${scenarioId}`, false, true);
			console.log('Сценарий успешно создан:', scenarioId);
			// Загружаем людей, роли и назначения после создания сценария
			await loadPeople();
			await loadRoles();
			await loadPersonProductionRoles();
		} catch (e) {
			const errorMsg = e instanceof TypeError && e.message === 'Failed to fetch' 
				? `Ошибка подключения: не удалось подключиться к серверу на ${API_BASE_URL}. Проверьте, что API запущен и доступен.`
				: `Ошибка создания: ${e.message || e}`;
			setStatus(errorMsg, true);
			console.error('Ошибка при создании сценария:', e);
		}
	}

	function getConstraints() {
		return {
			one_production_per_timeslot: true, // Всегда включено
			exact_shows_count: true, // Всегда включено
			consecutive_shows: document.getElementById('constraint_consecutive_shows').checked,
			monday_off: document.getElementById('constraint_monday_off').checked,
			weekend_always_show: document.getElementById('constraint_weekend_always_show').checked,
			same_show_weekend: false, // Всегда выключено (ограничение удалено)
			break_between_different_shows: document.getElementById('constraint_break_between_different_shows').checked,
			weekend_priority_bonus: document.getElementById('constraint_weekend_priority_bonus').checked,
		};
	}

	async function solveScenario() {
		if (!scenarioId) {
			setStatus('Сначала создайте сценарий', true);
			return;
		}
		try {
			setStatus('Запускаем решатель...');
			const apiUrl = `${API_BASE_URL}/scenarios/${scenarioId}/solve`;
			const constraints = getConstraints();
			
			let res;
			try {
				res = await fetch(apiUrl, { 
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						constraints: constraints
					})
				});
			} catch (fetchError) {
				setStatus(`Ошибка подключения к серверу. Убедитесь, что API запущен на ${API_BASE_URL}`, true);
				return;
			}
			
			if (!res.ok) {
				const errorText = await res.text();
				let errorDetail = errorText;
				try {
					const errorJson = JSON.parse(errorText);
					errorDetail = errorJson.detail || errorText;
				} catch {
					// Если не JSON, используем как есть
				}
				setStatus(`Ошибка сервера (${res.status}): ${errorDetail}`, true);
				return;
			}
			
			const result = await res.json();
			const statusMsg = result.status === 'optimal' ? '✅ Оптимальное решение' : 
							  result.status === 'feasible' ? '✓ Допустимое решение' : 
							  '⚠ Не найдено решение';
			setStatus(`${statusMsg}. Назначений: ${result.objective_value}`, false, result.status !== 'infeasible');
			// Загружаем расписание без прокрутки
			await loadSchedule();
			// Загружаем людей, роли и назначения
			await loadPeople();
			await loadRoles();
			await loadPersonProductionRoles();
			await loadAssignments();
		} catch (e) {
			setStatus(`Ошибка решения: ${e.message || e}`, true);
			console.error('Ошибка при решении:', e);
		}
	}

    // Создаём карту цветов для спектаклей
    function getProductionColorMap(tasks) {
        const prodSet = new Set(tasks.map(t => t.title));
        const colorMap = new Map();
        let colorIdx = 0;
        prodSet.forEach(prod => {
            colorMap.set(prod, productionColors[colorIdx % productionColors.length]);
            colorIdx++;
        });
        return colorMap;
    }

    // Форматируем время для отображения (в московском времени)
    function formatTime(isoStr) {
        const d = parseIsoLike(isoStr);
        if (!(d instanceof Date) || isNaN(d)) return '--:--';
        const formatter = new Intl.DateTimeFormat('ru-RU', {
            timeZone: MOSCOW_TIMEZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        const parts = formatter.formatToParts(d);
        const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
        const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
        return `${hour}:${minute}`;
    }

    function formatDate(isoStr) {
        const d = parseIsoLike(isoStr);
        if (!(d instanceof Date) || isNaN(d)) return '';
        const formatter = new Intl.DateTimeFormat('ru-RU', {
            timeZone: MOSCOW_TIMEZONE,
            day: 'numeric',
            month: 'short',
        });
        // Убираем точку после месяца (янв., фев. -> янв, фев)
        return formatter.format(d).replace('.', '');
    }

	// Загрузка расписания из API (заменяет renderGantt)
	async function loadSchedule() {
		if (!scenarioId) {
			showEmptyState();
			return;
		}

		try {
			const apiUrl = `${API_BASE_URL}/scenarios/${scenarioId}/gantt`;
			const res = await fetch(apiUrl);
			
			if (!res.ok) {
				const errorText = await res.text();
				let errorDetail = errorText;
				try {
					const errorJson = JSON.parse(errorText);
					errorDetail = errorJson.detail || errorText;
				} catch {
					// Если не JSON, используем как есть
				}
				setStatus(`Ошибка загрузки расписания: ${errorDetail}`, true);
				showEmptyState();
				return;
			}
			
			const data = await res.json();
			scheduleTasks = data.tasks || [];
			
			// Загружаем расписание с назначениями
			const scheduleRes = await fetch(`${API_BASE_URL}/scenarios/${scenarioId}/schedule`);
			if (scheduleRes.ok) {
				const scheduleData = await scheduleRes.json();
				window.scheduleData = scheduleData;
				state.assignments = scheduleData.assignments || [];
			}
			
			// Загружаем назначения отдельно
			await loadAssignments();

			if (scheduleTasks.length === 0) {
				showEmptyState();
				return;
			}

			hideEmptyState();
			
			// Сохраняем текущую позицию прокрутки
			const scrollY = window.scrollY;
			
			// Определяем текущий активный вид и рендерим его
			const activeView = document.querySelector('.view-btn.active')?.dataset.view || 'calendar';
			if (activeView === 'calendar') {
				renderCalendar();
			} else if (activeView === 'table') {
				renderTable();
			} else if (activeView === 'assignments') {
				renderAssignments();
			}
			
			// Восстанавливаем позицию прокрутки, чтобы не уезжало вниз
			window.scrollTo(0, scrollY);
		} catch (e) {
			setStatus(`Ошибка загрузки расписания: ${e.message || e}`, true);
			console.error('Ошибка при загрузке расписания:', e);
			showEmptyState();
		}
	}

	// Удалённая функция renderGantt - больше не используется
	async function renderGantt_DELETED() {
        if (!scenarioId) {
            document.getElementById('emptyState').style.display = 'block';
            document.getElementById('ganttControls').style.display = 'none';
            document.getElementById('ganttLegend').style.display = 'none';
            return;
        }

        const res = await fetch(`${API_BASE_URL}/scenarios/${scenarioId}/gantt`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const tasks = data.tasks || [];

        if (!window.vis || !window.vis.Timeline) {
            throw new TypeError('vis.Timeline не загружен. Проверьте подключение скрипта vis-timeline.');
        }

        if (tasks.length === 0) {
            document.getElementById('emptyState').style.display = 'block';
            document.getElementById('ganttControls').style.display = 'none';
            document.getElementById('ganttLegend').style.display = 'none';
            return;
        }

        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('ganttControls').style.display = 'flex';
        document.getElementById('ganttLegend').style.display = 'flex';

        // Создаём карту цветов
        const colorMap = getProductionColorMap(tasks);

        // Группы = сцены, элементы = показы
        const groupsMap = new Map();
        tasks.forEach(t => {
            if (!groupsMap.has(t.resource)) {
                groupsMap.set(t.resource, {
                    id: t.resource,
                    content: `<strong>${t.resource}</strong>`,
                    order: Array.from(groupsMap.keys()).length
                });
            }
        });
        const groups = new vis.DataSet(Array.from(groupsMap.values()));

        // Получаем информацию о спектаклях для отображения названий из state
        const prodTitleMap = new Map();
        state.productions.forEach(p => {
            if (p.id) prodTitleMap.set(p.id, p.title || p.id);
        });

        const items = new vis.DataSet(tasks.map(t => {
            const title = prodTitleMap.get(t.title) || t.title;
            const color = colorMap.get(t.title) || productionColors[0];
            const startTime = formatTime(t.start);
            const dateStr = formatDate(t.start);
            return {
                id: t.id,
                group: t.resource,
                content: `<strong>${title}</strong>`,
                start: t.start,
                end: t.end,
                title: `${title}\n${dateStr} ${startTime} - ${formatTime(t.end)}`,
                style: `background-color: ${color}; border-color: ${color}; color: #fff;`,
                className: 'production-item'
            };
        }));

        // Обновляем легенду
        const legendEl = document.getElementById('ganttLegend');
        legendEl.innerHTML = '';
        const legendItems = new Map();
        tasks.forEach(t => {
            const title = prodTitleMap.get(t.title) || t.title;
            if (!legendItems.has(title)) {
                legendItems.set(title, colorMap.get(t.title));
            }
        });
        legendItems.forEach((color, title) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            const colorBox = document.createElement('div');
            colorBox.className = 'legend-color';
            colorBox.style.backgroundColor = color;
            item.appendChild(colorBox);
            const label = document.createElement('span');
            label.textContent = title;
            item.appendChild(label);
            legendEl.appendChild(item);
        });

        const container = document.getElementById('timeline');
        
        // Если уже есть экземпляр, удаляем его
        if (timelineInstance) {
            timelineInstance.destroy();
        }

        const options = {
            stack: false,
            groupOrder: (a, b) => a.id.localeCompare(b.id),
            orientation: 'top',
            zoomMin: 1000 * 60 * 60, // 1 час
            zoomMax: 1000 * 60 * 60 * 24 * 60, // 2 месяца
            editable: false,
            selectable: true,
            multiselect: false,
            showCurrentTime: true,
            showMajorLabels: true,
            showMinorLabels: true,
            format: {
                minorLabels: {
                    hour: 'HH:mm',
                    weekday: 'ddd D'
                },
                majorLabels: {
                    weekday: 'dddd D MMMM',
                    day: 'D MMMM',
                    week: 'w',
                    month: 'MMMM YYYY'
                }
            },
            locale: 'ru',
            tooltip: {
                followMouse: true,
                overflowMethod: 'cap'
            },
            margin: {
                item: {
                    horizontal: 10,
                    vertical: 5
                }
            }
        };

        timelineInstance = new vis.Timeline(container, items, groups, options);

        // Подключаем элементы управления
        document.getElementById('btnZoomIn').onclick = () => {
            const range = timelineInstance.getWindow();
            const zoom = range.end - range.start;
            timelineInstance.setWindow({
                start: range.start - zoom * 0.2,
                end: range.end + zoom * 0.2
            });
        };

        document.getElementById('btnZoomOut').onclick = () => {
            const range = timelineInstance.getWindow();
            const zoom = range.end - range.start;
            timelineInstance.setWindow({
                start: range.start + zoom * 0.2,
                end: range.end - zoom * 0.2
            });
        };

        document.getElementById('btnFit').onclick = () => {
            timelineInstance.fit();
        };

        document.getElementById('btnToday').onclick = () => {
            const now = new Date();
            const range = timelineInstance.getWindow();
            const zoom = range.end - range.start;
            timelineInstance.setWindow({
                start: new Date(now.getTime() - zoom / 2),
                end: new Date(now.getTime() + zoom / 2)
            });
        };
    }

	// Переменные для календаря (по умолчанию ноябрь 2025)
	let currentMonth = 10; // Ноябрь (месяцы в JS идут с 0)
	let currentYear = 2025;
	let scheduleTasks = [];

	// Переключение видов
	function switchView(viewName) {
		document.querySelectorAll('.schedule-view').forEach(v => v.style.display = 'none');
		document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
		
		if (viewName === 'calendar') {
			const calendarView = document.getElementById('calendarView');
			if (calendarView) {
				calendarView.style.display = 'block';
			}
			const btn = document.getElementById('btnViewCalendar');
			if (btn) {
				btn.classList.add('active');
			}
			renderCalendar();
		} else if (viewName === 'table') {
			const tableView = document.getElementById('tableView');
			if (tableView) {
				tableView.style.display = 'block';
			}
			const btn = document.getElementById('btnViewTable');
			if (btn) {
				btn.classList.add('active');
			}
			renderTable();
		} else if (viewName === 'assignments') {
			const assignmentsView = document.getElementById('assignmentsView');
			if (assignmentsView) {
				assignmentsView.style.display = 'block';
			}
			const btn = document.getElementById('btnViewAssignments');
			if (btn) {
				btn.classList.add('active');
			}
			renderAssignments();
		}
	}

	// Рендеринг календаря - отдельный календарь для каждой сцены
	function renderCalendar() {
		try {
			const container = document.getElementById('calendarsContainer');
			if (!container) {
				console.error('Контейнер календаря не найден');
				return;
			}
			
			// Сохраняем активную вкладку перед перерисовкой
			const activeTab = document.querySelector('.stage-calendar-tab.active');
			const activeStageName = activeTab ? activeTab.textContent : null;
			
			// Сохраняем состояние видимости всех календарей перед перерисовкой
			const calendarVisibility = new Map();
			document.querySelectorAll('.stage-calendar').forEach(cal => {
				const calId = cal.id;
				if (calId) {
					calendarVisibility.set(calId, cal.style.display);
				}
			});
			
			// Сохраняем текущее содержимое на случай ошибки
			const previousContent = container.innerHTML;
			
			// Скрываем контейнер для плавной перерисовки
			container.style.opacity = '0';
			container.style.transition = 'opacity 0.1s';
			container.innerHTML = '';

		// Обновляем заголовок месяца
		const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
			'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
		const monthEl = document.getElementById('calendarMonth');
		if (monthEl) {
			monthEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
		}

		// Получаем все уникальные сцены
		const stagesSet = new Set();
		
		// Сначала из событий расписания (если они есть)
		scheduleTasks.forEach(task => {
			if (task.resource) {
				stagesSet.add(task.resource);
			}
		});

		// Всегда добавляем сцены из state (даже если есть события)
		if (state.stages && state.stages.length > 0) {
			state.stages.forEach(stage => {
				const stageName = stage.name || stage.id;
				if (stageName) {
					stagesSet.add(stageName);
				}
			});
		}
		
		// Если всё ещё нет сцен, попробуем найти уникальные сцены из таймслотов и постановок
		if (stagesSet.size === 0) {
			// Используем все уникальные stage_id из productions и timeslots
			const allStageIds = new Set();
			state.productions.forEach(p => {
				if (p.stage_id) allStageIds.add(p.stage_id);
			});
			state.timeslots.forEach(t => {
				if (t.stage_id) allStageIds.add(t.stage_id);
			});
			
			// Пытаемся найти названия сцен по ID
			allStageIds.forEach(stageId => {
				const stage = state.stages.find(s => {
					const sId = s.id || generateId(s.name || 'stage');
					return sId === stageId;
				});
				if (stage) {
					stagesSet.add(stage.name || stage.id || stageId);
				} else {
					// Если не нашли, используем ID
					stagesSet.add(stageId);
				}
			});
		}

		// Сортируем сцены для консистентного отображения
		const stages = Array.from(stagesSet).sort();
		// Переставляем "Новая сцена" и "Камерная сцена" местами
		const idxNew = stages.findIndex(n => (n || '').toLowerCase().includes('новая'));
		const idxChamber = stages.findIndex(n => (n || '').toLowerCase().includes('камерн'));
		if (idxNew !== -1 && idxChamber !== -1 && idxNew !== idxChamber) {
			const tmp = stages[idxNew];
			stages[idxNew] = stages[idxChamber];
			stages[idxChamber] = tmp;
		}

		// Если нет сцен, показываем пустое состояние
		if (stages.length === 0) {
			console.warn('Нет сцен для отображения календаря');
			console.warn('State:', { 
				stages: state.stages, 
				productions: state.productions.length, 
				timeslots: state.timeslots.length,
				scheduleTasks: scheduleTasks.length 
			});
			container.innerHTML = '<div class="empty-state">Нет данных о сценах для отображения. Добавьте сцены и таймслоты.</div>';
			return;
		}
		
		console.log('Рендеринг календаря для сцен:', stages);

		// Создаём контейнер для вкладок сцен
		const tabsContainer = document.createElement('div');
		tabsContainer.className = 'stage-calendar-tabs';
		
		const calendarsWrapper = document.createElement('div');
		calendarsWrapper.className = 'stage-calendars-wrapper';
		
		// Создаём отдельный календарь для каждой сцены
		stages.forEach((stageName, index) => {
			// Кнопка вкладки
			const tabBtn = document.createElement('button');
			tabBtn.className = 'stage-calendar-tab';
			tabBtn.textContent = stageName;
			if (index === 0) {
				tabBtn.classList.add('active');
			}
			// Индивидуальный цвет вкладки при наведении/активации
			const tabColor = getStageColor(stageName);
			tabBtn.addEventListener('mouseenter', () => {
				tabBtn.style.background = 'rgba(0,0,0,0.03)';
				tabBtn.style.color = tabColor;
				tabBtn.style.borderBottomColor = tabColor;
			});
			tabBtn.addEventListener('mouseleave', () => {
				if (!tabBtn.classList.contains('active')) {
					tabBtn.style.background = '';
					tabBtn.style.color = '';
					tabBtn.style.borderBottomColor = 'transparent';
				}
			});
			tabBtn.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				
				// Скрываем все календари
				document.querySelectorAll('.stage-calendar').forEach(cal => {
					cal.style.display = 'none';
				});
				
				// Показываем выбранный
				const targetCalendar = document.getElementById(`calendar-${stageName}`);
				if (targetCalendar) {
					targetCalendar.style.display = 'block';
				} else {
					console.error(`Календарь для сцены "${stageName}" не найден`);
				}
				
				// Обновляем активную вкладку
				document.querySelectorAll('.stage-calendar-tab').forEach(btn => {
					btn.classList.remove('active');
					// Сбрасываем стиль у неактивных
					if (btn !== tabBtn) {
						btn.style.background = '';
						btn.style.color = '';
						btn.style.borderBottomColor = 'transparent';
					}
				});
				tabBtn.classList.add('active');
				// Применяем цвет активной вкладки
				tabBtn.style.background = 'rgba(0,0,0,0.03)';
				tabBtn.style.color = tabColor;
				tabBtn.style.borderBottomColor = tabColor;
				
				// Убеждаемся, что календарный вид виден
				const calendarView = document.getElementById('calendarView');
				if (calendarView) {
					calendarView.style.display = 'block';
				}
			};
			tabsContainer.appendChild(tabBtn);
			
			const stageCalendar = document.createElement('div');
			stageCalendar.className = 'stage-calendar';
			stageCalendar.id = `calendar-${stageName}`;
			
			// Восстанавливаем видимость из сохраненного состояния, если есть
			// Иначе используем логику по умолчанию (первый видим)
			const savedVisibility = calendarVisibility.get(`calendar-${stageName}`);
			if (savedVisibility !== undefined) {
				stageCalendar.style.display = savedVisibility;
			} else {
				// Если это первая перерисовка или календарь новый, показываем только первый
				stageCalendar.style.display = index === 0 ? 'block' : 'none';
			}
			
			// Если это активная сцена, показываем её
			if (activeStageName === stageName) {
				stageCalendar.style.display = 'block';
			}
			
			// Получаем цвет для этой сцены
			const color = getStageColor(stageName);

			// Сетка календаря для этой сцены
			const grid = document.createElement('div');
			grid.className = 'calendar-grid';

			// Заголовки дней недели
			const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
			dayNames.forEach(name => {
				const header = document.createElement('div');
				header.style.gridColumn = 'span 1';
				header.style.textAlign = 'center';
				header.style.fontWeight = '600';
				header.style.color = '#4a5568';
				header.style.padding = '8px';
				header.textContent = name;
				grid.appendChild(header);
			});

			// Получаем первый день месяца и количество дней
			const firstDayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
			const firstDayDow = getMoscowDayOfWeek(firstDayStr);
			const startOffset = firstDayDow; // 0=Monday
			
			// Вычисляем количество дней в месяце (не зависит от часового пояса)
			const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
			const daysInMonth = lastDayOfMonth.getUTCDate();

			// Пустые ячейки до начала месяца
			for (let i = 0; i < startOffset; i++) {
				grid.appendChild(document.createElement('div'));
			}

			// Дни месяца
			for (let day = 1; day <= daysInMonth; day++) {
				// Вычисляем день недели в московском времени
				const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
				const normalizedDow = getMoscowDayOfWeek(dateStr); // 0=Monday, 6=Sunday

				const dayEl = document.createElement('div');
				dayEl.className = 'calendar-day';
				if (normalizedDow >= 5) dayEl.classList.add('weekend');
				// Индивидуальная подсветка при наведении (цвет сцены)
				dayEl.addEventListener('mouseenter', () => {
					dayEl.style.borderColor = color;
					dayEl.style.boxShadow = `0 4px 12px ${color}`;
				});
				dayEl.addEventListener('mouseleave', () => {
					dayEl.style.borderColor = '';
					dayEl.style.boxShadow = '';
				});

				const header = document.createElement('div');
				header.className = 'calendar-day-header';
				header.textContent = dayNames[normalizedDow];
				dayEl.appendChild(header);

				const number = document.createElement('div');
				number.className = 'calendar-day-number';
				number.textContent = day;
				dayEl.appendChild(number);

				// Получаем stage_id для этой сцены
				const stage = state.stages.find(s => (s.name || s.id) === stageName);
				const stageIdFromName = stage ? (stage.id || generateId(stage.name || 'stage')) : stageName;

				// Находим ВСЕ таймслоты для этого дня и этой сцены
				const dayTimeslots = state.timeslots.filter(t => {
					if (!t.date || !t.stage_id) return false;
					// Парсим дату без учета часового пояса
					const dateMatch = t.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
					if (dateMatch) {
						const tDateStr = dateMatch[0];
						return tDateStr === dateStr && t.stage_id === stageIdFromName;
					}
					// Fallback на старый способ (но с UTC)
					const tDate = new Date(t.date + 'T00:00:00Z'); // Добавляем T00:00:00Z для UTC
					const tDateStr = `${tDate.getUTCFullYear()}-${String(tDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tDate.getUTCDate()).padStart(2, '0')}`;
					return tDateStr === dateStr && t.stage_id === stageIdFromName;
				}).sort((a, b) => {
					// Сортируем по времени
					const timeA = a.start_time || '19:00';
					const timeB = b.start_time || '19:00';
					return timeA.localeCompare(timeB);
				});

				// Получаем события из расписания для этого дня и сцены
				const dayEvents = scheduleTasks.filter(t => {
					const taskDate = t.start.split('T')[0];
					return taskDate === dateStr && t.resource === stageName;
				});

				// Создаём карту событий по времени для быстрого поиска
				// Нормализуем время для сравнения (HH:MM формат)
				const eventsByTime = new Map();
				dayEvents.forEach(event => {
					let eventTime = formatTime(event.start);
					// Если формат "HH:MM:SS", обрезаем до "HH:MM"
					if (eventTime.length > 5) {
						eventTime = eventTime.substring(0, 5);
					}
					if (!eventsByTime.has(eventTime)) {
						eventsByTime.set(eventTime, []);
					}
					eventsByTime.get(eventTime).push(event);
				});

				// Создаём карту фиксированных назначений по таймслоту
				const fixedByTimeslot = new Map();
				state.fixedAssignments.forEach(fa => {
					fixedByTimeslot.set(fa.timeslot_id, fa);
				});

				// Отображаем все таймслоты
				if (dayTimeslots.length > 0) {
					dayTimeslots.forEach(timeslot => {
						let slotTime = timeslot.start_time || '19:00';
						// Нормализуем время (убираем секунды, если есть)
						if (slotTime.length > 5) {
							slotTime = slotTime.substring(0, 5);
						}
						const fixedAssignment = fixedByTimeslot.get(timeslot.id);
						const fixedProduction = fixedAssignment ? state.productions.find(p => {
							const pId = p.id || generateId(p.title || 'production');
							return pId === fixedAssignment.production_id;
						}) : null;
						const scheduledEvents = eventsByTime.get(slotTime) || [];

						// Если есть фиксированный спектакль, показываем его
						if (fixedProduction) {
							const eventEl = document.createElement('div');
							eventEl.className = 'calendar-event fixed';
							eventEl.style.backgroundColor = color;

							const time = document.createElement('div');
							time.className = 'calendar-event-time';
							time.textContent = slotTime;
							time.style.marginBottom = '4px';
							eventEl.appendChild(time);

							const titleEl = document.createElement('div');
							titleEl.className = 'calendar-event-title';
							titleEl.textContent = fixedProduction.title || fixedProduction.id;
							eventEl.appendChild(titleEl);

							// Добавляем кнопку удаления фиксации
							const removeBtn = document.createElement('button');
							removeBtn.textContent = '✕';
							removeBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center;';
							removeBtn.onclick = (e) => {
								e.stopPropagation();
								removeFixedAssignment(timeslot.id);
							};
							eventEl.appendChild(removeBtn);

							eventEl.onclick = (e) => {
								e.stopPropagation();
								// Если есть назначения, показываем их, иначе показываем диалог фиксации
								const scheduleItemId = `${fixedProduction.id}|${stageIdFromName}|${timeslot.id}`;
								const hasAssignments = state.assignments.some(a => a.schedule_item_id === scheduleItemId);
								if (hasAssignments) {
									showAssignmentsModal(fixedProduction.id, stageIdFromName, timeslot.id);
								} else {
									showFixedAssignmentDialog(timeslot, stageName, dateStr);
								}
							};

							dayEl.appendChild(eventEl);
						} else if (scheduledEvents.length > 0) {
							// Показываем события из расписания (с возможностью перетаскивания)
							scheduledEvents.forEach(event => {
								const eventEl = document.createElement('div');
								eventEl.className = 'calendar-event draggable';
								eventEl.draggable = true;
								eventEl.dataset.productionId = event.title; // production_id
								eventEl.dataset.timeslotId = timeslot.id;
								eventEl.dataset.stageId = stageIdFromName;
								eventEl.dataset.date = dateStr;
								eventEl.dataset.startTime = slotTime;
								
								const prodTitleMap = new Map();
								state.productions.forEach(p => {
									if (p.id) prodTitleMap.set(p.id, p.title || p.id);
								});
								const title = prodTitleMap.get(event.title) || event.title;
								// Используем цвет сцены
								eventEl.style.backgroundColor = color;

								const time = document.createElement('div');
								time.className = 'calendar-event-time';
								time.textContent = slotTime;
								time.style.marginBottom = '4px';
								eventEl.appendChild(time);

								const titleEl = document.createElement('div');
								titleEl.className = 'calendar-event-title';
								titleEl.textContent = title;
								eventEl.appendChild(titleEl);
								
								// Добавляем обработчик клика для просмотра назначений
								eventEl.style.cursor = 'pointer';
								eventEl.addEventListener('click', (e) => {
									e.stopPropagation();
									showAssignmentsModal(event.title, stageIdFromName, timeslot.id);
								});

								// Обработчики drag & drop
								eventEl.addEventListener('dragstart', (e) => {
									e.dataTransfer.effectAllowed = 'move';
									e.dataTransfer.setData('text/plain', JSON.stringify({
										productionId: event.title,
										timeslotId: timeslot.id,
										stageId: stageIdFromName,
										date: dateStr,
										startTime: slotTime
									}));
									eventEl.style.opacity = '0.5';
								});
								
								eventEl.addEventListener('dragend', (e) => {
									eventEl.style.opacity = '1';
								});

								eventEl.onclick = (e) => {
									e.stopPropagation();
									// Если есть назначения, показываем их, иначе показываем диалог фиксации
									const scheduleItemId = `${event.title}|${stageIdFromName}|${timeslot.id}`;
									const hasAssignments = state.assignments.some(a => a.schedule_item_id === scheduleItemId);
									if (hasAssignments) {
										showAssignmentsModal(event.title, stageIdFromName, timeslot.id);
									} else {
										showFixedAssignmentDialog(timeslot, stageName, dateStr);
									}
								};

								dayEl.appendChild(eventEl);
							});
						} else {
							// Пустой таймслот - показываем как доступный (с поддержкой drop)
							const emptySlotEl = document.createElement('div');
							emptySlotEl.className = 'calendar-event empty-slot droppable';
							emptySlotEl.dataset.timeslotId = timeslot.id;
							emptySlotEl.dataset.stageId = stageIdFromName;
							emptySlotEl.dataset.date = dateStr;
							emptySlotEl.dataset.startTime = slotTime;
							emptySlotEl.style.cssText = 'background: rgba(128, 128, 128, 0.1); border: 1px dashed rgba(128, 128, 128, 0.3); color: #666; cursor: pointer; min-height: 40px;';
							
							const time = document.createElement('div');
							time.className = 'calendar-event-time';
							time.textContent = slotTime;
							time.style.marginBottom = '4px';
							emptySlotEl.appendChild(time);

							const titleEl = document.createElement('div');
							titleEl.className = 'calendar-event-title';
							titleEl.textContent = 'Свободно';
							titleEl.style.fontSize = '10px';
							titleEl.style.opacity = '0.7';
							emptySlotEl.appendChild(titleEl);
							
							// Кнопка удаления таймслота
							const deleteBtn = document.createElement('button');
							deleteBtn.textContent = '✕';
							deleteBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; background: rgba(184, 0, 42, 0.7); color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.2s;';
							deleteBtn.title = 'Удалить таймслот';
							deleteBtn.onmouseenter = () => {
								deleteBtn.style.opacity = '1';
							};
							deleteBtn.onmouseleave = () => {
								deleteBtn.style.opacity = '0.7';
							};
							deleteBtn.onclick = (e) => {
								e.stopPropagation();
								if (confirm(`Удалить таймслот ${dateStr} ${slotTime}?`)) {
									// Удаляем таймслот из state
									state.timeslots = state.timeslots.filter(t => t.id !== timeslot.id);
									// Удаляем связанные закрепления
									state.fixedAssignments = state.fixedAssignments.filter(fa => fa.timeslot_id !== timeslot.id);
									// Перерисовываем календарь
									renderCalendar();
									setStatus('Таймслот удалён', false, true);
								}
							};
							emptySlotEl.appendChild(deleteBtn);
							
							// Обновляем стиль для поддержки position: relative
							emptySlotEl.style.position = 'relative';

							// Обработчики drag & drop
							emptySlotEl.addEventListener('dragover', (e) => {
								e.preventDefault();
								e.dataTransfer.dropEffect = 'move';
								emptySlotEl.style.background = 'rgba(184, 0, 42, 0.2)';
							});
							
							emptySlotEl.addEventListener('dragleave', (e) => {
								emptySlotEl.style.background = 'rgba(128, 128, 128, 0.1)';
							});
							
							emptySlotEl.addEventListener('drop', (e) => {
								e.preventDefault();
								emptySlotEl.style.background = 'rgba(128, 128, 128, 0.1)';
								
								try {
									const data = JSON.parse(e.dataTransfer.getData('text/plain'));
									moveProductionToTimeslot(data, {
										timeslotId: timeslot.id,
										stageId: stageIdFromName,
										date: dateStr,
										startTime: slotTime
									});
								} catch (err) {
									console.error('Ошибка при перемещении:', err);
								}
							});

							emptySlotEl.onclick = (e) => {
								e.stopPropagation();
								showFixedAssignmentDialog(timeslot, stageName, dateStr);
							};

							dayEl.appendChild(emptySlotEl);
						}
					});

					// Делаем ячейку кликабельной
					dayEl.classList.add('clickable');
					dayEl.style.cursor = 'pointer';
					dayEl.title = `Доступно таймслотов: ${dayTimeslots.length}. ЛКМ - закрепить спектакль, ПКМ - добавить таймслот.`;
				} else {
					// Нет таймслотов для этого дня
					dayEl.classList.add('clickable');
					dayEl.style.cursor = 'pointer';
					dayEl.title = 'ЛКМ - добавить таймслот, ПКМ - добавить таймслот';
				}
				
				// Обработчик правой кнопки мыши для добавления таймслота
				dayEl.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					e.stopPropagation();
					showAddTimeslotDialog(stageName, stageIdFromName, dateStr, normalizedDow);
				});

				grid.appendChild(dayEl);
			}

			stageCalendar.appendChild(grid);
			calendarsWrapper.appendChild(stageCalendar);
		});
		
		container.appendChild(tabsContainer);
		container.appendChild(calendarsWrapper);
		
		// Сразу скрываем все календари, кроме активного (до setTimeout)
		document.querySelectorAll('.stage-calendar').forEach(cal => {
			if (activeStageName && cal.id === `calendar-${activeStageName}`) {
				cal.style.display = 'block';
			} else {
				cal.style.display = 'none';
			}
		});
		
		// Обновляем активную вкладку сразу
		if (activeStageName) {
			const tabs = document.querySelectorAll('.stage-calendar-tab');
			tabs.forEach(btn => {
				if (btn.textContent === activeStageName) {
					btn.classList.add('active');
				} else {
					btn.classList.remove('active');
				}
			});
		}
		
		// Показываем контейнер с плавным появлением
		requestAnimationFrame(() => {
			container.style.opacity = '1';
		});
		
		// Восстанавливаем активную вкладку, если она была
		// Используем setTimeout, чтобы дать DOM время обновиться
		setTimeout(() => {
			// Убеждаемся, что календарный вид виден
			const calendarView = document.getElementById('calendarView');
			if (calendarView) {
				calendarView.style.display = 'block';
			}
			
			const tabs = document.querySelectorAll('.stage-calendar-tab');
			if (tabs.length === 0) {
				console.warn('Вкладки календаря не найдены после перерисовки');
				return;
			}
			
			if (activeStageName) {
				const restoredTab = Array.from(tabs).find(btn => btn.textContent === activeStageName);
				if (restoredTab) {
					// Вызываем обработчик напрямую, а не через click()
					const targetCalendar = document.getElementById(`calendar-${activeStageName}`);
					if (targetCalendar) {
						// Скрываем все календари
						document.querySelectorAll('.stage-calendar').forEach(cal => {
							cal.style.display = 'none';
						});
						// Показываем нужный
						targetCalendar.style.display = 'block';
						// Обновляем активную вкладку
						tabs.forEach(btn => btn.classList.remove('active'));
						restoredTab.classList.add('active');
					}
				} else {
					// Если точной вкладки не найдено, активируем первую
					const firstTab = tabs[0];
					if (firstTab) {
						firstTab.click();
					}
				}
			} else {
				// Если не было активной вкладки, активируем первую
				const firstTab = tabs[0];
				if (firstTab) {
					firstTab.click();
				}
			}
		}, 10);
		} catch (error) {
			console.error('Ошибка при рендеринге календаря:', error);
			console.error('Stack trace:', error.stack);
			const container = document.getElementById('calendarsContainer');
			if (container) {
				// Восстанавливаем opacity в случае ошибки
				container.style.opacity = '1';
				container.innerHTML = `<div class="empty-state" style="color: #b8002a; padding: 20px;">
					<strong>Ошибка при отображении календаря:</strong><br>
					${error.message}<br>
					<button onclick="renderCalendar()" style="margin-top: 10px; padding: 8px 16px; background: #b8002a; color: white; border: none; border-radius: 4px; cursor: pointer;">
						Попробовать снова
					</button>
				</div>`;
			}
			setStatus(`Ошибка при отображении календаря: ${error.message}`, true);
		}
	}

		// Рендеринг таблицы
	function renderTable() {
		const tbody = document.getElementById('scheduleTable').querySelector('tbody');
		tbody.innerHTML = '';

		const prodTitleMap = new Map();
		state.productions.forEach(p => {
			if (p.id) prodTitleMap.set(p.id, p.title || p.id);
		});

		// Сортируем по дате и времени
		const sortedTasks = [...scheduleTasks].sort((a, b) => 
			new Date(a.start) - new Date(b.start)
		);

		// Создаём карты для быстрого поиска
		const peopleById = {};
		state.people.forEach(p => peopleById[p.id] = p);
		const rolesById = {};
		state.roles.forEach(r => rolesById[r.id] = r);
		
		sortedTasks.forEach(task => {
			const row = document.createElement('tr');
			const title = prodTitleMap.get(task.title) || task.title;
			// Используем цвет сцены вместо цвета постановки
			const color = getStageColor(task.resource);
			const date = new Date(task.start);
			
			// Извлекаем production_id, stage_id, timeslot_id из task.id
			const [productionId, stageId, timeslotId] = task.id.split('|');
			const scheduleItemId = `${productionId}|${stageId}|${timeslotId}`;

			// Дата
			const tdDate = document.createElement('td');
			tdDate.textContent = formatDate(task.start);
			row.appendChild(tdDate);

			// Время
			const tdTime = document.createElement('td');
			tdTime.textContent = formatTime(task.start);
			row.appendChild(tdTime);

			// Сцена
			const tdStage = document.createElement('td');
			tdStage.textContent = task.resource;
			row.appendChild(tdStage);

			// Спектакль
			const tdProd = document.createElement('td');
			const prodBadge = document.createElement('span');
			prodBadge.className = 'table-production';
			prodBadge.style.backgroundColor = color;
			prodBadge.textContent = title;
			prodBadge.style.cursor = 'pointer';
			prodBadge.title = 'Нажмите, чтобы посмотреть назначения';
			prodBadge.onclick = () => {
				const [productionId, stageId, timeslotId] = task.id.split('|');
				showAssignmentsModal(productionId, stageId, timeslotId);
			};
			tdProd.appendChild(prodBadge);
			row.appendChild(tdProd);
			
			// Назначения
			const tdAssignments = document.createElement('td');
			const assignmentsForItem = state.assignments.filter(a => a.schedule_item_id === scheduleItemId);
			if (assignmentsForItem.length > 0) {
				const assignmentList = document.createElement('div');
				assignmentList.style.display = 'flex';
				assignmentList.style.flexDirection = 'column';
				assignmentList.style.gap = '4px';
				assignmentsForItem.forEach(a => {
					const person = peopleById[a.person_id];
					const role = rolesById[a.role_id];
					const assignmentDiv = document.createElement('div');
					assignmentDiv.style.fontSize = '12px';
					// Меняем порядок: сначала роль, затем человек
					assignmentDiv.textContent = `${role?.name || a.role_id}: ${person?.name || a.person_id}${a.is_conductor ? ' (Дирижер)' : ''}`;
					assignmentList.appendChild(assignmentDiv);
				});
				tdAssignments.appendChild(assignmentList);
			} else {
				tdAssignments.textContent = '-';
			}
			row.appendChild(tdAssignments);

			tbody.appendChild(row);
		});
	}

	// Получить цвет для спектакля
	function getProductionColor(title) {
		const prodSet = new Set();
		scheduleTasks.forEach(t => prodSet.add(t.title));
		const prodArray = Array.from(prodSet);
		const idx = prodArray.indexOf(title);
		return productionColors[idx % productionColors.length] || productionColors[0];
	}


	// Обновляем функцию renderGantt чтобы сохранять tasks
	async function renderGanttOriginal() {
        if (!scenarioId) {
            return;
        }

        const res = await fetch(`${API_BASE_URL}/scenarios/${scenarioId}/gantt`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const tasks = data.tasks || [];

        if (!window.vis || !window.vis.Timeline) {
            throw new TypeError('vis.Timeline не загружен. Проверьте подключение скрипта vis-timeline.');
        }

        if (tasks.length === 0) {
            return;
        }

        // Создаём карту цветов
        const colorMap = getProductionColorMap(tasks);

        const groupsMap = new Map();
        tasks.forEach(t => {
            if (!groupsMap.has(t.resource)) {
                groupsMap.set(t.resource, {
                    id: t.resource,
                    content: `<strong>${t.resource}</strong>`,
                    order: Array.from(groupsMap.keys()).length
                });
            }
        });
        const groups = new vis.DataSet(Array.from(groupsMap.values()));

        const prodTitleMap = new Map();
        state.productions.forEach(p => {
            if (p.id) prodTitleMap.set(p.id, p.title || p.id);
        });

        const items = new vis.DataSet(tasks.map(t => {
            const title = prodTitleMap.get(t.title) || t.title;
            const color = colorMap.get(t.title) || productionColors[0];
            const startTime = formatTime(t.start);
            const dateStr = formatDate(t.start);
            return {
                id: t.id,
                group: t.resource,
                content: `<strong>${title}</strong>`,
                start: t.start,
                end: t.end,
                title: `${title}\n${dateStr} ${startTime} - ${formatTime(t.end)}`,
                style: `background-color: ${color}; border-color: ${color}; color: #fff;`,
                className: 'production-item'
            };
        }));

        const legendEl = document.getElementById('ganttLegend');
        legendEl.innerHTML = '';
        const legendItems = new Map();
        tasks.forEach(t => {
            const title = prodTitleMap.get(t.title) || t.title;
            if (!legendItems.has(title)) {
                legendItems.set(title, colorMap.get(t.title));
            }
        });
        legendItems.forEach((color, title) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            const colorBox = document.createElement('div');
            colorBox.className = 'legend-color';
            colorBox.style.backgroundColor = color;
            item.appendChild(colorBox);
            const label = document.createElement('span');
            label.textContent = title;
            item.appendChild(label);
            legendEl.appendChild(item);
        });

        const container = document.getElementById('timeline');
        
        if (timelineInstance) {
            timelineInstance.destroy();
        }

        const options = {
            stack: false,
            groupOrder: (a, b) => a.id.localeCompare(b.id),
            orientation: 'top',
            zoomMin: 1000 * 60 * 60,
            zoomMax: 1000 * 60 * 60 * 24 * 60,
            editable: false,
            selectable: true,
            multiselect: false,
            showCurrentTime: true,
            showMajorLabels: true,
            showMinorLabels: true,
            format: {
                minorLabels: {
                    hour: 'HH:mm',
                    weekday: 'ddd D'
                },
                majorLabels: {
                    weekday: 'dddd D MMMM',
                    day: 'D MMMM',
                    week: 'w',
                    month: 'MMMM YYYY'
                }
            },
            locale: 'ru',
            tooltip: {
                followMouse: true,
                overflowMethod: 'cap'
            },
            margin: {
                item: {
                    horizontal: 10,
                    vertical: 5
                }
            }
        };

        timelineInstance = new vis.Timeline(container, items, groups, options);

        document.getElementById('btnZoomIn').onclick = () => {
            const range = timelineInstance.getWindow();
            const zoom = range.end - range.start;
            timelineInstance.setWindow({
                start: range.start - zoom * 0.2,
                end: range.end + zoom * 0.2
            });
        };

        document.getElementById('btnZoomOut').onclick = () => {
            const range = timelineInstance.getWindow();
            const zoom = range.end - range.start;
            timelineInstance.setWindow({
                start: range.start + zoom * 0.2,
                end: range.end - zoom * 0.2
            });
        };

        document.getElementById('btnFit').onclick = () => {
            timelineInstance.fit();
        };

        document.getElementById('btnToday').onclick = () => {
            const now = new Date();
            const range = timelineInstance.getWindow();
            const zoom = range.end - range.start;
            timelineInstance.setWindow({
                start: new Date(now.getTime() - zoom / 2),
                end: new Date(now.getTime() + zoom / 2)
            });
        };
    }

	// Обновляем основную функцию renderGantt
	async function renderGantt() {
		if (!scenarioId) {
			showEmptyState();
			return;
		}

		try {
			const apiUrl = `${API_BASE_URL}/scenarios/${scenarioId}/gantt`;
			const res = await fetch(apiUrl);
			
			if (!res.ok) {
				const errorText = await res.text();
				let errorDetail = errorText;
				try {
					const errorJson = JSON.parse(errorText);
					errorDetail = errorJson.detail || errorText;
				} catch {
					// Если не JSON, используем как есть
				}
				setStatus(`Ошибка загрузки расписания: ${errorDetail}`, true);
				showEmptyState();
				return;
			}
			
			const data = await res.json();
			scheduleTasks = data.tasks || [];

			if (scheduleTasks.length === 0) {
				showEmptyState();
				return;
			}

			hideEmptyState();
			
			// Определяем текущий активный вид
			const activeView = document.querySelector('.view-btn.active')?.dataset.view || 'calendar';
			if (activeView === 'calendar') {
				renderCalendar();
			} else if (activeView === 'table') {
				renderTable();
			} else if (activeView === 'gantt') {
				await renderGanttOriginal();
			}
		} catch (e) {
			setStatus(`Ошибка загрузки расписания: ${e.message || e}`, true);
			console.error('Ошибка при загрузке расписания:', e);
			showEmptyState();
		}
	}

	function showEmptyState() {
		document.getElementById('emptyState').style.display = 'block';
		document.querySelectorAll('.schedule-view').forEach(v => v.style.display = 'none');
	}

	function hideEmptyState() {
		document.getElementById('emptyState').style.display = 'none';
	}

	// Функции для работы с фиксированными назначениями
	// Диалог для добавления нового таймслота
	function showAddTimeslotDialog(stageName, stageId, dateStr, dayOfWeek) {
		const dialog = document.createElement('div');
		dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 24px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 10000; min-width: 300px; max-width: 500px;';
		dialog.innerHTML = `
			<h3 style="margin-top: 0; font-family: \'Playfair Display\', serif; color: #1a0a1a;">Добавить таймслот</h3>
			<p style="color: #666; margin-bottom: 16px;">Сцена: <strong>${stageName}</strong><br>Дата: <strong>${dateStr}</strong></p>
			<label style="display: block; margin-bottom: 8px; font-weight: 600;">Время начала:</label>
			<input type="time" id="newTimeslotTime" value="19:00" style="width: 100%; padding: 8px; margin-bottom: 16px; border: 2px solid rgba(184, 0, 42, 0.2); border-radius: 6px; font-size: 14px;">
			<div style="display: flex; gap: 8px; justify-content: flex-end;">
				<button id="cancelAddTimeslotBtn" style="padding: 8px 16px; background: #e2e8f0; color: #2d3748; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Отмена</button>
				<button id="confirmAddTimeslotBtn" style="padding: 8px 16px; background: linear-gradient(135deg, #b8002a 0%, #8b001f 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Добавить</button>
			</div>
		`;

		document.body.appendChild(dialog);

		const confirmBtn = dialog.querySelector('#confirmAddTimeslotBtn');
		const cancelBtn = dialog.querySelector('#cancelAddTimeslotBtn');
		const timeInput = dialog.querySelector('#newTimeslotTime');

		const closeDialog = () => {
			document.body.removeChild(dialog);
		};

		confirmBtn.onclick = () => {
			const timeValue = timeInput.value;
			if (!timeValue) {
				alert('Пожалуйста, выберите время');
				return;
			}

			// Проверяем, нет ли уже таймслота с таким временем для этой даты и сцены
			const existingTimeslot = state.timeslots.find(t => {
				if (!t.date || !t.stage_id) return false;
				// Парсим дату без учета часового пояса
				const dateMatch = t.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
				if (dateMatch) {
					const tDateStr = dateMatch[0];
					return tDateStr === dateStr && t.stage_id === stageId && t.start_time === timeValue;
				}
				// Fallback
				const tDate = new Date(t.date + 'T00:00:00Z');
				const tDateStr = `${tDate.getUTCFullYear()}-${String(tDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tDate.getUTCDate()).padStart(2, '0')}`;
				return tDateStr === dateStr && t.stage_id === stageId && t.start_time === timeValue;
			});

			if (existingTimeslot) {
				alert('Таймслот с таким временем уже существует для этой даты и сцены');
				return;
			}

			// Создаём новый таймслот
			const newTimeslotId = `slot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			const newTimeslot = {
				id: newTimeslotId,
				stage_id: stageId,
				date: dateStr,
				day_of_week: dayOfWeek,
				start_time: timeValue
			};

			// Добавляем в state.timeslots
			state.timeslots.push(newTimeslot);
			
			// Обновляем originalTimeslots, чтобы новый таймслот сохранялся
			state.originalTimeslots.push(JSON.parse(JSON.stringify(newTimeslot)));

			// Перерисовываем календарь
			renderCalendar();
			setStatus(`Таймслот добавлен: ${dateStr} ${timeValue}`, false, true);
			closeDialog();
		};

		cancelBtn.onclick = closeDialog;

		dialog.onclick = (e) => {
			if (e.target === dialog) {
				closeDialog();
			}
		};
	}

	function showFixedAssignmentDialog(timeslot, stageName, dateStr) {
		// Получаем спектакли для этой сцены
		const stage = state.stages.find(s => (s.name || s.id) === stageName);
		const stageId = stage ? (stage.id || generateId(stage.name || 'stage')) : stageName;
		const availableProductions = state.productions.filter(p => {
			const pStageId = p.stage_id;
			return pStageId === stageId;
		});

		if (availableProductions.length === 0) {
			alert('Нет спектаклей для этой сцены. Добавьте спектакли в разделе "Постановки".');
			return;
		}

		// Проверяем, есть ли уже закреплённый спектакль для этого таймслота
		const existingFixed = state.fixedAssignments.find(fa => fa.timeslot_id === timeslot.id);
		
		// Подсчитываем количество закреплений для каждого спектакля
		const fixedCountByProduction = new Map();
		state.fixedAssignments.forEach(fa => {
			const count = fixedCountByProduction.get(fa.production_id) || 0;
			fixedCountByProduction.set(fa.production_id, count + 1);
		});
		
		// Также считаем назначения из расписания (если расписание уже составлено)
		const scheduledCountByProduction = new Map();
		scheduleTasks.forEach(task => {
			const prodId = task.title; // production_id из расписания
			const count = scheduledCountByProduction.get(prodId) || 0;
			scheduledCountByProduction.set(prodId, count + 1);
		});
		
		// Создаём диалог выбора спектакля
		const dialog = document.createElement('div');
		dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 24px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 10000; min-width: 300px; max-width: 500px;';
		dialog.innerHTML = `
			<h3 style="margin-top: 0; font-family: \'Playfair Display\', serif; color: #1a0a1a;">${existingFixed ? 'Изменить закреплённый спектакль' : 'Закрепить спектакль'}</h3>
			<p style="color: #666; margin-bottom: 16px;">Сцена: <strong>${stageName}</strong><br>Дата: <strong>${dateStr}</strong><br>Время: <strong>${timeslot.start_time || '19:00'}</strong></p>
			<label style="display: block; margin-bottom: 8px; font-weight: 600;">Выберите спектакль:</label>
			<select id="fixedProductionSelect" style="width: 100%; padding: 8px; margin-bottom: 16px; border: 2px solid rgba(184, 0, 42, 0.2); border-radius: 6px; font-size: 14px;">
				<option value="">-- Убрать фиксацию --</option>
				${availableProductions.map(p => {
					const pId = p.id || generateId(p.title || 'production');
					const selected = existingFixed && existingFixed.production_id === pId ? 'selected' : '';
					const maxShows = Number(p.max_shows || 1);
					const fixedCount = fixedCountByProduction.get(pId) || 0;
					const scheduledCount = scheduledCountByProduction.get(pId) || 0;
					const totalCount = fixedCount + scheduledCount;
					const isDisabled = totalCount >= maxShows && !selected;
					const disabledText = isDisabled ? ' (достигнут лимит)' : '';
					const disabledAttr = isDisabled ? 'disabled' : '';
					return `<option value="${pId}" ${selected} ${disabledAttr}>${p.title || p.id}${disabledText} (${totalCount}/${maxShows})</option>`;
				}).join('')}
			</select>
			<div style="display: flex; gap: 8px; justify-content: flex-end;">
				<button id="cancelFixedBtn" style="padding: 8px 16px; background: #e2e8f0; color: #2d3748; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Отмена</button>
				<button id="confirmFixedBtn" style="padding: 8px 16px; background: linear-gradient(135deg, #b8002a 0%, #8b001f 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">${existingFixed ? 'Изменить' : 'Закрепить'}</button>
			</div>
		`;

		document.body.appendChild(dialog);

		const confirmBtn = dialog.querySelector('#confirmFixedBtn');
		const cancelBtn = dialog.querySelector('#cancelFixedBtn');
		const select = dialog.querySelector('#fixedProductionSelect');

		const closeDialog = () => {
			document.body.removeChild(dialog);
		};

		confirmBtn.onclick = () => {
			const productionId = select.value;
			if (!productionId) {
				// Удаляем фиксацию
				removeFixedAssignment(timeslot.id);
			} else {
				const production = availableProductions.find(p => (p.id || generateId(p.title || 'production')) === productionId);
				if (production) {
					const maxShows = Number(production.max_shows || 1);
					// Подсчитываем текущее количество закреплений (исключая текущий таймслот, если он уже закреплён)
					const currentFixedCount = state.fixedAssignments
						.filter(fa => fa.production_id === productionId && fa.timeslot_id !== timeslot.id)
						.length;
					const scheduledCount = scheduleTasks.filter(t => t.title === productionId).length;
					const totalCount = currentFixedCount + scheduledCount;
					
					if (totalCount >= maxShows) {
						alert(`Нельзя закрепить больше ${maxShows} показов для спектакля "${production.title || productionId}". Уже закреплено/назначено: ${totalCount}.`);
						return;
					}
					
					addFixedAssignment({
						production_id: productionId,
						timeslot_id: timeslot.id,
						stage_id: stageId,
						date: dateStr,
						start_time: timeslot.start_time || '19:00'
					});
				}
			}
			closeDialog();
		};

		cancelBtn.onclick = closeDialog;

		// Закрытие по клику вне диалога
		dialog.onclick = (e) => {
			if (e.target === dialog) {
				closeDialog();
			}
		};
	}

	function addFixedAssignment(assignment) {
		console.log('Добавление закрепления:', assignment);
		
		// Удаляем существующее назначение для этого таймслота (если есть)
		state.fixedAssignments = state.fixedAssignments.filter(fa => fa.timeslot_id !== assignment.timeslot_id);
		// Добавляем новое
		state.fixedAssignments.push(assignment);
		
		console.log('Текущие закрепления:', state.fixedAssignments);
		console.log('Состояние сцен:', state.stages);
		console.log('Состояние таймслотов:', state.timeslots.length);
		
		// Убеждаемся, что календарный вид виден
		const calendarView = document.getElementById('calendarView');
		if (!calendarView) {
			console.error('Элемент calendarView не найден');
			return;
		}
		
		if (calendarView.style.display === 'none') {
			switchView('calendar');
		}
		
		// Убеждаемся, что контейнер календаря виден
		const container = document.getElementById('calendarsContainer');
		if (!container) {
			console.error('Контейнер calendarsContainer не найден');
			return;
		}
		
		// Перерисовываем календарь
		try {
			renderCalendar();
			console.log('Календарь успешно перерисован');
			
			// Дополнительная проверка: убеждаемся, что календарь действительно отобразился
			setTimeout(() => {
				const container = document.getElementById('calendarsContainer');
				if (container && container.innerHTML.trim() === '') {
					console.error('Календарь остался пустым после рендеринга');
					console.error('Попытка повторного рендеринга...');
					try {
						renderCalendar();
					} catch (retryError) {
						console.error('Ошибка при повторном рендеринге:', retryError);
					}
				}
			}, 100);
		} catch (error) {
			console.error('Ошибка при перерисовке календаря:', error);
			console.error('Stack trace:', error.stack);
			setStatus(`Ошибка при перерисовке календаря: ${error.message}`, true);
			
			// Пробуем восстановить календарь
			setTimeout(() => {
				try {
					renderCalendar();
				} catch (retryError) {
					console.error('Не удалось восстановить календарь:', retryError);
				}
			}, 500);
		}
		
		setStatus(`Спектакль закреплён на ${assignment.date} ${assignment.start_time}`, false, true);
	}

	function removeFixedAssignment(timeslotId) {
		state.fixedAssignments = state.fixedAssignments.filter(fa => fa.timeslot_id !== timeslotId);
		
		// Убеждаемся, что календарный вид виден
		const calendarView = document.getElementById('calendarView');
		if (calendarView && calendarView.style.display === 'none') {
			switchView('calendar');
		}
		
		// Перерисовываем календарь
		renderCalendar();
		setStatus('Фиксация спектакля удалена', false, true);
	}

	// Обработчики переключения видов
	document.getElementById('btnViewCalendar').onclick = () => switchView('calendar');
	document.getElementById('btnViewTable').onclick = () => switchView('table');
	document.getElementById('btnViewAssignments').onclick = () => switchView('assignments');

	// Обработчики навигации по календарю
	document.getElementById('btnPrevMonth').onclick = () => {
		currentMonth--;
		if (currentMonth < 0) {
			currentMonth = 11;
			currentYear--;
		}
		renderCalendar();
	};

	document.getElementById('btnNextMonth').onclick = () => {
		currentMonth++;
		if (currentMonth > 11) {
			currentMonth = 0;
			currentYear++;
		}
		renderCalendar();
	};

	btnCreate.addEventListener('click', createScenario);
	btnSolve.addEventListener('click', solveScenario);
	
	// Кнопка очистки расписания
	const btnClearSchedule = document.getElementById('btnClearSchedule');
	if (btnClearSchedule) {
		btnClearSchedule.addEventListener('click', clearSchedule);
	}

	// Функция для перемещения спектакля между таймслотами (drag & drop)
	function moveProductionToTimeslot(fromData, toData) {
		// Проверяем, что спектакль существует
		const production = state.productions.find(p => {
			const pId = p.id || generateId(p.title || 'production');
			return pId === fromData.productionId;
		});
		
		if (!production) {
			alert('Спектакль не найден');
			return;
		}
		
		// Проверяем, что целевой таймслот существует и принадлежит той же сцене
		const targetTimeslot = state.timeslots.find(t => t.id === toData.timeslotId);
		if (!targetTimeslot) {
			alert('Целевой таймслот не найден');
			return;
		}
		
		// Проверяем, что спектакль привязан к той же сцене
		const productionStageId = production.stage_id;
		if (productionStageId !== toData.stageId) {
			alert('Нельзя переместить спектакль на другую сцену');
			return;
		}
		
		// Проверяем max_shows (исключаем текущее назначение из подсчёта)
		const maxShows = Number(production.max_shows || 1);
		
		// Считаем закрепленные спектакли (исключая текущий таймслот)
		const currentFixedCount = state.fixedAssignments
			.filter(fa => fa.production_id === fromData.productionId && fa.timeslot_id !== fromData.timeslotId)
			.length;
		
		// Считаем спектакли из расписания, но исключаем те, которые уже закреплены
		// (чтобы не считать дважды) и исключаем текущее назначение
		const fixedTimeslotIds = new Set(
			state.fixedAssignments
				.filter(fa => fa.production_id === fromData.productionId)
				.map(fa => fa.timeslot_id)
		);
		
		// Находим название сцены для сравнения
		const fromStage = state.stages.find(s => {
			const sId = s.id || generateId(s.name || 'stage');
			return sId === fromData.stageId;
		});
		const fromStageName = fromStage ? (fromStage.name || fromStage.id) : fromData.stageId;
		
		const scheduledCount = scheduleTasks.filter(t => {
			// Исключаем текущее назначение
			const taskDate = t.start.split('T')[0];
			const taskTime = formatTime(t.start).substring(0, 5);
			if (taskDate === fromData.date && taskTime === fromData.startTime && 
			    (t.resource === fromData.stageId || t.resource === fromStageName)) {
				return false; // Это текущее назначение, которое мы перемещаем
			}
			
			// Проверяем, что это тот же спектакль
			if (t.title !== fromData.productionId) {
				return false;
			}
			
			// Исключаем спектакли, которые уже закреплены (чтобы не считать дважды)
			// Для этого нужно найти таймслот по дате и времени
			const matchingTimeslot = state.timeslots.find(ts => {
				// Парсим дату без учета часового пояса
				const dateMatch = ts.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
				const tsDateStr = dateMatch ? dateMatch[0] : (() => {
					const tsDate = new Date(ts.date + 'T00:00:00Z');
					return `${tsDate.getUTCFullYear()}-${String(tsDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tsDate.getUTCDate()).padStart(2, '0')}`;
				})();
				const tsTime = (ts.start_time || '19:00').substring(0, 5);
				return tsDateStr === taskDate && tsTime === taskTime && 
				       (ts.stage_id === fromData.stageId || 
				        (fromStage && (ts.stage_id === fromStage.id || ts.stage_id === fromStageName)));
			});
			
			if (matchingTimeslot && fixedTimeslotIds.has(matchingTimeslot.id)) {
				return false; // Этот спектакль уже закреплен, не считаем его в scheduleTasks
			}
			
			return true;
		}).length;
		
		const totalCount = currentFixedCount + scheduledCount;
		
		console.log('Проверка max_shows при перемещении:', {
			productionId: fromData.productionId,
			maxShows: maxShows,
			currentFixedCount: currentFixedCount,
			scheduledCount: scheduledCount,
			totalCount: totalCount
		});
		
		if (totalCount >= maxShows) {
			alert(`Нельзя переместить спектакль: достигнут лимит ${maxShows} показов. Текущее количество: ${totalCount} (закреплено: ${currentFixedCount}, в расписании: ${scheduledCount}).`);
			return;
		}
		
		// Удаляем старое назначение из scheduleTasks (если оно там было)
		// Нужно найти название сцены по stageId для правильного сравнения
		const stage = state.stages.find(s => {
			const sId = s.id || generateId(s.name || 'stage');
			return sId === fromData.stageId;
		});
		const stageName = stage ? (stage.name || stage.id) : fromData.stageId;
		
		console.log('Удаление из scheduleTasks:', {
			productionId: fromData.productionId,
			date: fromData.date,
			startTime: fromData.startTime,
			stageId: fromData.stageId,
			stageName: stageName,
			beforeCount: scheduleTasks.length
		});
		
		scheduleTasks = scheduleTasks.filter(task => {
			const taskDate = task.start.split('T')[0];
			const taskTime = formatTime(task.start).substring(0, 5);
			// Удаляем задачу, если она соответствует исходному таймслоту
			// Сравниваем и по stageId (если task.resource это ID), и по названию сцены
			const matchesProduction = task.title === fromData.productionId;
			const matchesDate = taskDate === fromData.date;
			const matchesTime = taskTime === fromData.startTime;
			const matchesStage = task.resource === fromData.stageId || task.resource === stageName;
			
			const shouldRemove = matchesProduction && matchesDate && matchesTime && matchesStage;
			
			if (shouldRemove) {
				console.log('Удаляем задачу из scheduleTasks:', task);
			}
			
			return !shouldRemove;
		});
		
		console.log('После удаления из scheduleTasks:', scheduleTasks.length);
		
		// Проверяем, был ли спектакль закреплен
		const wasFixed = state.fixedAssignments.some(fa => 
			fa.timeslot_id === fromData.timeslotId && fa.production_id === fromData.productionId
		);
		
		// Находим название сцены для целевого таймслота
		const targetStage = state.stages.find(s => {
			const sId = s.id || generateId(s.name || 'stage');
			return sId === toData.stageId;
		});
		const targetStageName = targetStage ? (targetStage.name || targetStage.id) : toData.stageId;
		
		if (wasFixed) {
			// Если спектакль был закреплен, обновляем закрепление
			// Удаляем старое закрепление
			state.fixedAssignments = state.fixedAssignments.filter(fa => 
				!(fa.timeslot_id === fromData.timeslotId && fa.production_id === fromData.productionId)
			);
			
			// Удаляем существующее закрепление для целевого таймслота (если есть)
			state.fixedAssignments = state.fixedAssignments.filter(fa => fa.timeslot_id !== toData.timeslotId);
			
			// Добавляем новое закрепление
			const newFixed = {
				production_id: fromData.productionId,
				timeslot_id: toData.timeslotId,
				stage_id: toData.stageId,
				date: toData.date,
				start_time: toData.startTime
			};
			
			state.fixedAssignments.push(newFixed);
			console.log('Обновлено закрепление для спектакля');
		} else {
			// Если спектакль был просто в расписании, обновляем его в scheduleTasks
			// Добавляем новое назначение в scheduleTasks
			const newTask = {
				id: `moved_${fromData.productionId}_${toData.timeslotId}_${Date.now()}`,
				title: fromData.productionId,
				resource: targetStageName, // Используем название сцены
				start: `${toData.date}T${toData.startTime}:00`,
				end: `${toData.date}T${toData.startTime}:00`
			};
			
			scheduleTasks.push(newTask);
			console.log('Обновлено назначение в scheduleTasks:', newTask);
		}
		
		// Убеждаемся, что календарный вид виден
		const calendarView = document.getElementById('calendarView');
		if (calendarView && calendarView.style.display === 'none') {
			switchView('calendar');
		}
		
		// Перерисовываем календарь
		try {
			renderCalendar();
			setStatus(`Спектакль перемещён на ${toData.date} ${toData.startTime}`, false, true);
		} catch (error) {
			console.error('Ошибка при перерисовке календаря после перемещения:', error);
			console.error('Stack trace:', error.stack);
			setStatus(`Ошибка при перерисовке: ${error.message}`, true);
			
			// Пробуем восстановить календарь
			setTimeout(() => {
				try {
					renderCalendar();
				} catch (retryError) {
					console.error('Не удалось восстановить календарь:', retryError);
				}
			}, 500);
		}
	}

	// Функция полной очистки расписания
	function clearSchedule() {
		if (!confirm('Вы уверены, что хотите полностью очистить расписание?\n\nЭто действие:\n- Удалит все спектакли с календаря\n- Восстановит все удалённые таймслоты\n- Удалит все закрепления спектаклей\n\nДействие нельзя отменить.')) {
			return;
		}
		
		try {
			// Очищаем расписание
			scheduleTasks = [];
			
			// Восстанавливаем оригинальные таймслоты
			if (state.originalTimeslots && state.originalTimeslots.length > 0) {
				state.timeslots = JSON.parse(JSON.stringify(state.originalTimeslots));
			} else {
				// Если оригинальные таймслоты не сохранены, генерируем заново (ноябрь 2025)
				const defaultYear = 2025;
				const defaultMonth = 11; // Ноябрь
				state.timeslots = generateMonthCalendar(defaultYear, defaultMonth);
				state.originalTimeslots = JSON.parse(JSON.stringify(state.timeslots));
			}
			
			// Очищаем все закрепления
			state.fixedAssignments = [];
			
			// Перерисовываем календарь
			renderCalendar();
			
			// Обновляем таблицу, если она видна
			const tableView = document.getElementById('tableView');
			if (tableView && tableView.style.display !== 'none') {
				renderTable();
			}
			
			setStatus('✅ Расписание полностью очищено. Все спектакли удалены, таймслоты восстановлены, закрепления сняты.', false, true);
		} catch (error) {
			console.error('Ошибка при очистке расписания:', error);
			setStatus(`Ошибка при очистке расписания: ${error.message}`, true);
		}
	}

	// Инициализация
	// Тестовые данные для людей, ролей и назначений уже добавлены выше при первой загрузке
	// Рендеринг уже выполнен выше
	
	showEmptyState();
	switchView('calendar');
})();


