// The fictional IT-company scenario used to populate the application: 10
// employees, 5 projects, 48 tasks (20 of them in the shared pool), the work
// sessions, comments and activity history that go with them.
//
// Pure and deterministic: given the same `nowMs`, the same rows come out. Record
// ids are fixed ("asm-emp-01", "asm-tsk-17", ...) so seeding can be repeated
// without creating duplicates and so these rows can always be told apart from
// anything created later (their ids start with "asm-"). Only workspace tokens
// are random: they are the one secret in the data, so they are injected by the
// caller and never derived from anything in the source code.
//
// Every figure shown by the dashboard and the reports is computed from these
// rows by the application; nothing here is an independent aggregate.

var ASSESSMENT_EMPLOYEES = [
  // n, last name, first name, middle name, email, joined (days ago)
  [1, 'Волкова', 'Марина', 'Андреевна', 'marina.volkova@example.com', 20],
  [2, 'Кузнецов', 'Даниил', 'Сергеевич', 'daniil.kuznetsov@example.com', 20],
  [3, 'Лебедева', 'София', 'Олеговна', 'sofia.lebedeva@example.com', 20],
  [4, 'Назаров', 'Тимур', 'Рустамович', 'timur.nazarov@example.com', 20],
  [5, 'Ковалёва', 'Анна', 'Игоревна', 'anna.kovaleva@example.com', 20],
  [6, 'Сидоров', 'Артём', 'Павлович', 'artem.sidorov@example.com', 20],
  [7, 'Петренко', 'Ольга', 'Игоревна', 'olga.petrenko@example.com', 20],
  [8, 'Морозов', 'Лев', 'Николаевич', 'lev.morozov@example.com', 20],
  [9, 'Сулейменова', 'Айгерим', 'Маратовна', 'aigerim.suleimenova@example.com', 20],
  [10, 'Новиков', 'Виктор', 'Дмитриевич', 'viktor.novikov@example.com', 6]
];

var ASSESSMENT_PROJECTS = [
  ['Разработка программного обеспечения', 'Создание и развитие клиентских и внутренних приложений компании.'],
  ['Тестирование и аудит продуктов', 'Проверка качества, безопасности и производительности продуктов.'],
  ['Администрирование и инфраструктура', 'Серверы, учётные записи, резервное копирование и рабочие среды.'],
  ['Сопровождение и техническая поддержка', 'Помощь сотрудникам, обновление программ и решение обращений.'],
  ['Данные, отчётность и автоматизация', 'Управленческая отчётность и автоматизация рутинных процессов.']
];

// project (1-5), title, description, priority, due (days from today, null = none),
// owner (employee n, 0 = nobody), status, how the owner got it ('assigned' by the
// Manager or 'claimed' from the shared pool), created (days ago),
// first work day (days ago), last work day (days ago), sessions, planned minutes
var ASSESSMENT_TASKS = [
  // ---- 20 tasks in the shared pool (nobody owns them yet) ----
  [1, 'Разработать систему управления клиентами', 'Модуль регистрации клиентов, редактирования их данных и просмотра истории взаимодействий. Ожидаемый результат: менеджер создаёт клиента, изменяет его данные и видит историю обращений.', 'high', 14, 0, 'available', '', 6],
  [1, 'Создать сервис онлайн-записи на приём', 'Сервис, в котором клиент выбирает свободные дату и время и получает подтверждение записи. Ожидаемый результат: запись создаётся, занятое время нельзя выбрать повторно.', 'high', 12, 0, 'available', '', 5],
  [1, 'Доработать приложение управления сотрудниками', 'Профили сотрудников, сведения об отделах и удобный поиск. Ожидаемый результат: карточка сотрудника с отделом и поиск по имени и должности.', 'medium', 20, 0, 'available', '', 4],
  [1, 'Разработать мобильное приложение для заявок на обслуживание', 'Экраны подачи заявки, просмотра её статуса и получения обновлений. Ожидаемый результат: пользователь подаёт заявку и видит смену её статуса.', 'medium', 25, 0, 'available', '', 4],
  [1, 'Реализовать систему уведомлений', 'Отправка электронных писем о важных событиях в бизнес-приложении компании. Ожидаемый результат: письмо уходит при каждом важном событии, текст понятен получателю.', 'medium', 16, 0, 'available', '', 3],
  [2, 'Провести аудит платёжного приложения FinFlow', 'Проверка сценария оплаты, выявление функциональных дефектов и подготовка отчёта с рекомендациями. Проверка идёт без реальных денежных операций. Ожидаемый результат: отчёт с перечнем дефектов и рекомендациями.', 'high', 10, 0, 'available', '', 6],
  [2, 'Протестировать новую версию портала сотрудников WorkSpace', 'Проверка входа в систему, редактирования профиля, назначения задач и отображения истории работы. Ожидаемый результат: список замечаний по каждому из сценариев.', 'high', 9, 0, 'available', '', 5],
  [2, 'Проверить безопасность веб-приложения ClientHub', 'Санкционированная проверка прав доступа, проверки вводимых данных и защиты конфиденциальной информации в изолированной среде. Ожидаемый результат: перечень уязвимостей с оценкой риска и мерами устранения.', 'high', 15, 0, 'available', '', 4],
  [2, 'Подготовить отчёт о тестировании интернет-магазина ShopPilot', 'Проверка поиска товаров, работы корзины, оформления заказа и обработки ошибок. Ожидаемый результат: отчёт с результатами по каждому сценарию.', 'medium', 11, 0, 'available', '', 3],
  [2, 'Провести аудит производительности системы аналитики ReportPro', 'Выявление медленных отчётов и подготовка рекомендаций по сокращению времени ответа. Ожидаемый результат: список медленных отчётов с замерами и планом ускорения.', 'medium', 18, 0, 'available', '', 2],
  [3, 'Настроить новую среду Windows Server', 'Установка актуального поддерживаемого выпуска Windows Server, установка обновлений, базовая настройка безопасности и описание результата. Перед началом уточнить точный выпуск и требования к лицензированию. Ожидаемый результат: настроенный сервер и документ с описанием конфигурации.', 'high', 8, 0, 'available', '', 5],
  [3, 'Настроить учётные записи сотрудников и права доступа', 'Создание учётных записей и назначение прав в соответствии с организационной структурой компании. Ожидаемый результат: у каждой роли только необходимые права, список прав задокументирован.', 'medium', 7, 0, 'available', '', 4],
  [3, 'Установить и настроить внутреннее программное обеспечение компании', 'Установка утверждённых приложений для команды разработки и проверка их запуска. Ожидаемый результат: все приложения запускаются без ошибок.', 'medium', 13, 0, 'available', '', 3],
  [3, 'Настроить резервное копирование файлов компании', 'План резервного копирования, срок хранения копий и пробное восстановление в контролируемой среде. Ожидаемый результат: работающее расписание и успешное пробное восстановление.', 'high', 6, 0, 'available', '', 2],
  [3, 'Подготовить сервер разработки для нового проекта', 'Установка необходимых сред выполнения и инструментов, настройка окружения и проверка запуска проекта. Ожидаемый результат: проект успешно запускается на сервере.', 'medium', 17, 0, 'available', '', 2],
  [4, 'Выяснить причину медленной работы компьютера сотрудника', 'Проверка загрузки ресурсов, автозапуска программ, свободного места и установленных обновлений. Ожидаемый результат: записанные выводы и рекомендации по устранению.', 'low', 5, 0, 'available', '', 1],
  [4, 'Обновить программы, используемые командой дизайна', 'Подбор доступных утверждённых обновлений, установка в проверочной среде и проверка работы нужных функций. Ожидаемый результат: список обновлений и подтверждение, что функции работают.', 'low', 19, 0, 'available', '', 1],
  [4, 'Устранить проблему с доступом во внутренний портал', 'Разбор обращения сотрудника о недоступности портала, поиск причины и описание решения. Ожидаемый результат: причина найдена, доступ восстановлен, решение задокументировано.', 'high', 3, 0, 'available', '', 1],
  [5, 'Подготовить управленческий отчёт для отдела продаж', 'Отчёт о продажах, выполненных заказах и ключевых показателях эффективности. Ожидаемый результат: понятный отчёт для руководителя на одну страницу.', 'medium', 10, 0, 'available', '', 2],
  [5, 'Автоматизировать еженедельный отчёт о статусе проектов', 'Процесс, который собирает обновления по проектам и формирует структурированный отчёт для менеджера. Ожидаемый результат: отчёт формируется автоматически каждую неделю.', 'medium', 21, 0, 'available', '', 3],

  // ---- completed work ----
  [1, 'Разработать форму регистрации клиента', 'Форма с проверкой введённых данных и подтверждением по почте.', 'high', -6, 1, 'completed', 'assigned', 13, 13, 9, 3, 480],
  [1, 'Спроектировать структуру базы клиентов', 'Описание сущностей: клиенты, контакты и сделки.', 'high', -4, 2, 'completed', 'assigned', 13, 12, 8, 3, 540],
  [1, 'Реализовать личный кабинет клиента', 'Просмотр заказов, обращений и редактирование профиля.', 'medium', -2, 8, 'completed', 'claimed', 10, 9, 4, 3, 420],
  [1, 'Подключить отправку подтверждений по электронной почте', 'Письма о регистрации и смене пароля.', 'medium', -1, 2, 'completed', 'assigned', 9, 7, 5, 2, 240],
  [1, 'Разработать экраны авторизации мобильного приложения', 'Вход по паролю и по отпечатку пальца.', 'high', -5, 7, 'completed', 'assigned', 13, 12, 7, 4, 600],
  [1, 'Подготовить макеты интерфейса личного кабинета', 'Макеты для компьютера и телефона с описанием состояний.', 'high', -4, 5, 'completed', 'assigned', 13, 12, 8, 3, 600],
  [2, 'Проверить сценарии регистрации клиента', 'Позитивные и негативные проверки формы регистрации.', 'high', -3, 3, 'completed', 'assigned', 11, 10, 6, 3, 420],
  [2, 'Провести регрессионное тестирование релиза 2.4', 'Повторная проверка основных функций перед выпуском.', 'medium', -2, 9, 'completed', 'claimed', 10, 9, 8, 2, 360],
  [2, 'Автоматизировать проверку входа в систему', 'Автоматические проверки входа с разными ролями.', 'high', -5, 9, 'completed', 'assigned', 12, 11, 8, 3, 480],
  [3, 'Установить обновления безопасности на серверах', 'Плановое обновление всех рабочих серверов.', 'high', -6, 4, 'completed', 'assigned', 13, 12, 9, 3, 300],
  [3, 'Развернуть сервер для проверки новых версий', 'Отдельная среда для приёмки релизов.', 'medium', -3, 4, 'completed', 'assigned', 10, 9, 6, 3, 390],
  [4, 'Составить инструкцию по подключению к корпоративной сети', 'Пошаговая памятка для новых сотрудников.', 'medium', -1, 10, 'completed', 'claimed', 6, 6, 5, 2, 180],
  [5, 'Сформировать отчёт по продажам за квартал', 'Продажи по регионам и менеджерам.', 'high', -5, 6, 'completed', 'assigned', 12, 11, 8, 3, 360],
  [5, 'Построить сводный отчёт по загрузке команд', 'Учтённое время по командам и проектам.', 'medium', -2, 6, 'completed', 'assigned', 9, 8, 4, 3, 450],

  // ---- work in progress (paused between sessions) ----
  [1, 'Подключить приём платежей в приложении', 'Интеграция с платёжным шлюзом и обработка отказов.', 'high', 4, 1, 'active', 'assigned', 9, 8, 1, 4, 300],
  [1, 'Разграничить права доступа в системе клиентов', 'Права для руководителей групп и администраторов.', 'high', 2, 8, 'active', 'claimed', 8, 6, 2, 2, 150],
  [1, 'Ускорить загрузку сайта компании', 'Сжатие изображений и кэширование страниц.', 'medium', 3, 2, 'active', 'assigned', 6, 5, 1, 3, 180],
  [1, 'Добавить автономный режим в мобильное приложение', 'Просмотр истории заказов без подключения к сети.', 'high', 1, 7, 'active', 'assigned', 8, 6, 1, 3, 360],
  [2, 'Подготовить сценарии нагрузочного тестирования', 'Профили нагрузки для часов пиковой посещаемости.', 'medium', 6, 3, 'active', 'assigned', 5, 4, 1, 2, 150],
  [2, 'Подготовить набор данных для проверки заказов', 'Повторяемые наборы клиентов, заказов и счетов.', 'medium', -1, 9, 'active', 'claimed', 7, 5, 2, 3, 240],
  [5, 'Создать панель контроля сроков проектов', 'Диаграмма сгорания задач по спринтам.', 'high', 3, 6, 'active', 'assigned', 6, 4, 1, 3, 270],
  [5, 'Настроить ежемесячную выгрузку данных в хранилище', 'Автоматическая выгрузка задач и учтённого времени.', 'medium', 5, 4, 'active', 'claimed', 5, 4, 2, 2, 200],

  // ---- assigned, not started yet ----
  [4, 'Написать руководство пользователя для внутреннего портала', 'Краткая инструкция с примерами.', 'medium', 9, 10, 'active', 'assigned', 5, 0, 0, 0, 0],
  [2, 'Исправить замечания по доступности сайта', 'Устранить замечания проверки читаемости и управления с клавиатуры.', 'high', -1, 1, 'active', 'assigned', 3, 0, 0, 0, 0],
  [3, 'Провести инвентаризацию лицензий на программы', 'Сверить установленные программы с купленными лицензиями.', 'low', 12, 4, 'active', 'assigned', 2, 0, 0, 0, 0],
  [5, 'Подготовить квартальную сводку показателей для руководства', 'Одностраничная сводка по проектам и загрузке.', 'medium', 18, 6, 'active', 'assigned', 1, 0, 0, 0, 0],

  // ---- drafts (not yet published) ----
  [1, 'Перевести интерфейс клиентского портала на новый язык', 'Подготовка текстов и проверка переводов.', 'medium', 20, 0, 'draft', '', 2],
  [4, 'Обучить сотрудников работе с новой системой заявок', 'Два коротких занятия и памятка.', 'medium', 15, 0, 'draft', '', 1]
];

// task index (1-based, in the table above), author ('manager' or employee n), text, days ago, hour, minute
var ASSESSMENT_COMMENTS = [
  [35, 'manager', 'Пожалуйста, предусмотрите повторную попытку при отказе банка.', 7, 10, 0],
  [35, 1, 'Хорошо, добавляю повторную попытку и понятное сообщение для клиента.', 7, 11, 40],
  [36, 8, 'Нужен ли руководителям групп доступ к платёжным данным?', 5, 11, 0],
  [36, 'manager', 'Нет, платёжные данные доступны только администраторам.', 5, 11, 45],
  [38, 7, 'На Android история заказов открывается без сети, на iPhone нужно проверить разрешения.', 3, 16, 0],
  [38, 'manager', 'Сначала завершите Android, iPhone — следующим шагом.', 3, 16, 30],
  [40, 9, 'Набор покрывает клиентов и заказы, счета добавлю следующей сессией.', 2, 15, 10],
  [41, 6, 'Жду подтверждения, как считать срок выполнения задачи.', 2, 10, 15],
  [41, 'manager', 'Считайте от первого начала работы до завершения.', 2, 12, 0],
  [44, 'manager', 'Эта задача блокирует релиз: начните, пожалуйста, сегодня.', 1, 9, 30],
  [30, 'manager', 'Отличная работа, обновления прошли без простоев.', 8, 15, 0],
  [37, 2, 'Сжатие изображений уменьшило объём страниц примерно на 40 %.', 3, 17, 0]
];

// Builds every row for the scenario. `nowMs` anchors all dates (sessions lie on
// whole past days, so none is ever "running"); `newToken` returns a fresh random
// workspace token.
function buildAssessmentDataset(nowMs, newToken) {
  var DAY = 86400000;
  var midnight = nowMs - (nowMs % DAY);
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function at(daysAgo, hour, minute) { return new Date(midnight - daysAgo * DAY + (hour * 60 + minute) * 60000).toISOString(); }
  function atMin(daysAgo, minutes) { return at(daysAgo, Math.floor(minutes / 60), minutes % 60); }
  function ymd(daysFromToday) { return ymdUtc(midnight + daysFromToday * DAY); }
  function weekday(daysAgo) { return new Date(midnight - daysAgo * DAY).getUTCDay(); }
  // Weekend days are moved to the next Monday (or the previous Friday if that would be in the future).
  function workday(d) {
    var w = weekday(d);
    if (w === 6) return d - 2 >= 1 ? d - 2 : d + 1;
    if (w === 0) return d - 1 >= 1 ? d - 1 : d + 2;
    return d;
  }

  var projects = ASSESSMENT_PROJECTS.map(function (p, i) {
    return { id: 'asm-prj-' + (i + 1), name: p[0], description: p[1], status: 'active', createdAt: at(21, 8, 0) };
  });
  var employees = ASSESSMENT_EMPLOYEES.map(function (e) {
    return { id: 'asm-emp-' + pad(e[0], 2), lastName: e[1], firstName: e[2], middleName: e[3], email: e[4],
      workspaceToken: newToken(), createdAt: at(e[5], 8, 0), active: true };
  });
  var empById = {};
  employees.forEach(function (e, i) { empById[ASSESSMENT_EMPLOYEES[i][0]] = e; });
  function fullName(e) { return [e.lastName, e.firstName, e.middleName].filter(Boolean).join(' '); }

  var tasks = [], sessions = [], comments = [], activity = [];
  var cursors = {};
  var actSeq = 0;
  function logAct(task, when, actorType, actorId, action, detail) {
    activity.push({ id: '', taskId: task.id, at: when, actorType: actorType, actorId: actorId || '', action: action, detail: detail || '', _n: ++actSeq });
  }
  // Place a session of `minutes` for employee n on a day: sessions of one person never overlap,
  // start after 09:00, skip the lunch break and keep 20 minutes between sessions.
  function place(n, day, minutes) {
    var key = n + '|' + day;
    var start = cursors[key] !== undefined ? cursors[key] : 9 * 60 + (n % 4) * 15;
    if (start < 12 * 60 + 30 && start + minutes > 12 * 60 + 30) start = 13 * 60 + 30;
    if (start >= 12 * 60 + 30 && start < 13 * 60 + 30) start = 13 * 60 + 30;
    cursors[key] = start + minutes + 20;
    return start;
  }
  function split(total, count) {
    var weights = [1, 0.75, 1.25, 0.9], sum = 0, i;
    for (i = 0; i < count; i++) sum += weights[i % 4];
    var out = [], used = 0;
    for (i = 0; i < count - 1; i++) { var m = Math.round(total * weights[i % 4] / sum / 5) * 5; out.push(m); used += m; }
    out.push(total - used);
    return out;
  }
  function pickDays(from, to, count) {
    var out = [], span = from - to;
    for (var i = 0; i < count; i++) out.push(workday(from - (count === 1 ? span : Math.round(i * span / (count - 1)))));
    out.sort(function (a, b) { return b - a; });
    return out;
  }

  var poolCount = 0;
  ASSESSMENT_TASKS.forEach(function (d, index) {
    var n = index + 1;
    var isPool = d[6] === 'available';
    var isDraft = d[6] === 'draft';
    var project = projects[d[0] - 1];
    var owner = (isPool || isDraft) ? 0 : d[5];
    var emp = owner ? empById[owner] : null;
    var created = (isPool || isDraft) ? d[8] : d[8];
    var status = d[6];
    var task = {
      id: 'asm-tsk-' + pad(n, 2), employeeId: emp ? emp.id : '', title: d[1], status: status,
      createdAt: at(created, 8, n % 30), completedAt: '', projectId: project.id, priority: d[3],
      dueDate: d[4] === null ? '' : ymd(d[4]), description: d[2], assignedAt: ''
    };
    if (isPool) poolCount++;
    logAct(task, task.createdAt, 'manager', '', 'created', task.priority);
    if (isPool || d[7] === 'claimed') logAct(task, at(created, 8, 30 + (n % 15)), 'manager', '', 'published', '');
    tasks.push(task);
    if (!emp) return;

    var firstDay = d[9], lastDay = d[10], count = d[11], minutes = d[12];
    var planned = [];
    if (count > 0) {
      var days = pickDays(firstDay, lastDay, count), parts = split(minutes, count);
      days.forEach(function (day, i) { planned.push({ day: day, minutes: parts[i] }); });
    }
    var firstStartDay = planned.length ? planned[0].day : created;
    if (d[7] === 'claimed') {
      task.assignedAt = at(firstStartDay, 8, 50);
      logAct(task, task.assignedAt, 'employee', emp.id, 'claimed', '');
    } else {
      task.assignedAt = at(created, 8, 35 + (n % 20));
      logAct(task, task.assignedAt, 'manager', '', 'assigned', fullName(emp));
    }
    planned.forEach(function (p, i) {
      var start = place(owner, p.day, p.minutes);
      var last = i === planned.length - 1;
      var finishes = last && status === 'completed';
      var s = { id: '', employeeId: emp.id, taskId: task.id, startTime: atMin(p.day, start), endTime: atMin(p.day, start + p.minutes),
        durationMs: p.minutes * 60000, status: finishes ? 'completed' : 'paused', _task: n };
      sessions.push(s);
      logAct(task, s.startTime, 'employee', emp.id, i === 0 ? 'started' : 'resumed', '');
      logAct(task, s.endTime, 'employee', emp.id, finishes ? 'completed' : 'paused', '');
      if (finishes) task.completedAt = s.endTime;
    });
  });

  ASSESSMENT_COMMENTS.forEach(function (c, i) {
    var task = tasks[c[0] - 1];
    var emp = c[1] === 'manager' ? null : empById[c[1]];
    var when = at(c[3], c[4], c[5]);
    comments.push({ id: 'asm-cmt-' + pad(i + 1, 2), taskId: task.id, authorType: emp ? 'employee' : 'manager',
      authorId: emp ? emp.id : '', authorName: emp ? fullName(emp) : '', text: c[2], createdAt: when });
    logAct(task, when, emp ? 'employee' : 'manager', emp ? emp.id : '', 'commented', '');
  });

  sessions.sort(function (a, b) { return a.startTime < b.startTime ? -1 : (a.startTime > b.startTime ? 1 : 0); });
  sessions.forEach(function (s, i) { s.id = 'asm-ses-' + pad(i + 1, 3); delete s._task; });
  activity.sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : (a._n - b._n)); });
  activity.forEach(function (a, i) { a.id = 'asm-act-' + pad(i + 1, 4); delete a._n; });

  return { projects: projects, employees: employees, tasks: tasks, sessions: sessions, comments: comments, activity: activity };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildAssessmentDataset: buildAssessmentDataset, ASSESSMENT_EMPLOYEES: ASSESSMENT_EMPLOYEES, ASSESSMENT_PROJECTS: ASSESSMENT_PROJECTS, ASSESSMENT_TASKS: ASSESSMENT_TASKS, ASSESSMENT_COMMENTS: ASSESSMENT_COMMENTS };
}
