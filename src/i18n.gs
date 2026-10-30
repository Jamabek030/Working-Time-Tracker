// Localization: one dictionary per language, the language-resolution rule, the
// mapping from server error messages to translatable codes, and the invitation
// email / CSV header texts. Pure (no Apps Script services) so Node can test it.
//
// The Manager and the employee workspace receive I18N through the template and
// translate on the client, so no business logic is duplicated per language.
// Employee names, emails and task titles are user data and are never looked up
// here.

var I18N = {
  en: {
    'app.title': 'Working Time Tracker',
    'app.subtitle.manager': 'Manager console',
    'app.subtitle.employee': 'Employee workspace',
    'a11y.skip': 'Skip to content',
    'lang.label': 'Language',
    'demo.banner': 'Public demonstration. Use fictional data only: anyone with this URL can see and change everything here, and the data may be reset at any time. An invitation email is sent only if you tick the option and enter a real address (small daily limits apply); addresses ending in @example.com are never mailed.',
    'footer.note': 'Demonstration with fictional data. Times are shown in UTC.',

    'nav.dashboard': 'Dashboard',
    'nav.employees': 'Employees',
    'nav.reports': 'Reports',
    'period.from': 'From',
    'period.to': 'To',
    'period.utcNote': 'Days are UTC calendar days.',
    'common.loading': 'Loading…',
    'common.close': 'Close',
    'common.unknown': '(unknown)',

    'col.date': 'Date',
    'col.duration': 'Duration',
    'col.email': 'Email',
    'col.end': 'End',
    'col.invite': 'Invitation',
    'col.name': 'Name',
    'col.start': 'Start',
    'col.status': 'Status',
    'col.task': 'Task',
    'col.total': 'Total time',
    'col.actions': 'Actions',

    'dash.totalEmployees': 'Employees',
    'dash.working': 'Working now',
    'dash.paused': 'On pause',
    'dash.activeTasks': 'Active tasks',
    'dash.doneTasks': 'Completed tasks',
    'dash.tracked': 'Tracked time in period',
    'dash.daily': 'Tracked time per day',
    'dash.byEmployee': 'Tracked time by employee',
    'dash.emptyPeriod': 'No tracked time in this period.',
    'dash.refresh': 'Refresh',
    'dash.chartLabel': 'Bar chart of tracked time per day: {total} over {days} days',

    'emp.add': 'Add employee',
    'emp.list': 'Employees',
    'emp.search': 'Search by name or email',
    'emp.searchPh': 'Start typing…',
    'emp.filter': 'Work status',
    'emp.empty': 'No employees yet. Add one above.',
    'emp.loadSample': 'Load fictional sample data',
    'emp.noResults': 'No employees match the search.',
    'emp.count': 'Showing {shown} of {total}',
    'emp.details': 'Details',
    'emp.detailsFor': 'Details of {name}',

    'state.all': 'All',
    'state.working': 'Working',
    'state.paused': 'On pause',
    'state.idle': 'Not started',
    'status.active': 'active',
    'status.paused': 'paused',
    'status.completed': 'completed',
    'status.replaced': 'replaced',

    'form.lastName': 'Last name',
    'form.firstName': 'First name',
    'form.middleName': 'Middle name (optional)',
    'form.email': 'Email',
    'form.emailPh': 'name@example.com',
    'form.initialTask': 'Initial task or goal',
    'form.sendInvite': 'Send an invitation email with the workspace link',
    'form.create': 'Create employee',
    'form.creating': 'Creating…',
    'form.created': 'Employee {name} was created.',
    'field.lastName': 'Last name',
    'field.firstName': 'First name',
    'field.middleName': 'Middle name',
    'field.email': 'Email',
    'field.initialTask': 'Initial task',
    'field.taskTitle': 'Task title',

    'mail.info.disabled': 'Invitation emails are switched off in this deployment. Copy the workspace link from Details instead.',
    'mail.info.unavailable': 'Invitation emails are not authorized for this deployment yet (the owner must approve the mail permission). The employee is still created; copy the workspace link from Details.',
    'mail.info.ready': 'Invitation emails are available (remaining mail quota today: {remaining}).',

    'invite.none': 'Not sent',
    'invite.sent': 'Accepted for delivery',
    'invite.failed': 'Failed',
    'invite.unavailable': 'Not authorized',
    'invite.skipped_reserved': 'Skipped (example address)',
    'invite.limit_global': 'Daily limit reached',
    'invite.limit_recipient': 'Recipient limit reached',
    'invite.disabled': 'Disabled',
    'invite.not_requested': 'Not requested',
    'invite.send': 'Send invitation',
    'invite.retry': 'Retry invitation',
    'invite.resend': 'Send invitation again',
    'invite.sending': 'Sending…',
    'invite.result.none': 'No invitation was sent.',
    'invite.result.not_requested': 'No invitation was requested; copy the workspace link from Details.',
    'invite.result.sent': 'The invitation email was accepted by Google for delivery (this is not a delivery receipt).',
    'invite.result.failed': 'Sending the invitation failed. The employee was kept; use Retry or copy the workspace link from Details.',
    'invite.result.unavailable': 'Email is not authorized for this deployment. The employee was kept; copy the workspace link from Details.',
    'invite.result.skipped_reserved': 'No email was sent because the address is a reserved example address. Copy the workspace link from Details.',
    'invite.result.limit_global': 'No email was sent: the daily invitation limit of this demo is used up. Copy the workspace link from Details.',
    'invite.result.limit_recipient': 'No email was sent: this address already received the allowed number of invitations today.',
    'invite.result.disabled': 'Invitation emails are switched off in this deployment. Copy the workspace link from Details.',

    'details.title': 'Details',
    'details.total': 'Total recorded time',
    'details.running': 'timer running',
    'details.warnings': 'Data warnings: {n} session row(s) could not be counted cleanly. See the server execution log.',
    'details.workspaceLink': 'Employee workspace link',
    'details.copyLink': 'Copy link',
    'details.copied': 'Link copied.',
    'details.copyManual': 'Select the link and press Ctrl+C to copy it.',
    'details.openWorkspace': 'Open workspace',
    'details.linkNote': 'Anyone who has this link can use this employee’s workspace (start and stop the timer). It does not open the Manager console. It works independently of email.',
    'details.rotate': 'Rotate workspace link',
    'details.rotateConfirm': 'Rotate this employee’s workspace link? The existing link stops working immediately and the new link must be shared with them.',
    'details.assign': 'Assign task',
    'details.assignLabel': 'New task title',
    'details.assigning': 'Assigning…',
    'details.newTask': 'Assign a new task',
    'details.tasks': 'Tasks and work sessions',
    'details.noTasks': 'No tasks yet.',
    'details.noSessions': 'No work sessions on this task yet.',
    'details.taskTotal': 'time on task: {time}',
    'details.created': 'Created',
    'details.closed': 'Closed',

    'rep.title': 'Report',
    'rep.employee': 'Employee',
    'rep.allEmployees': 'All employees',
    'rep.generate': 'Generate report',
    'rep.generating': 'Generating…',
    'rep.exportCsv': 'Export CSV',
    'rep.exporting': 'Preparing CSV…',
    'rep.exported': 'CSV file {name} prepared ({n} rows).',
    'rep.exportManual': 'The download could not start. Copy the CSV text below and save it as {name}.',
    'rep.csvFallback': 'CSV text (copy if the download did not start)',
    'rep.found': 'Employees with activity: {n}',
    'rep.grandTotal': 'total {time}',
    'rep.totalInRange': 'Total in range',
    'rep.inRange': 'Time in range',
    'rep.noSessions': 'No work sessions in the selected period.',
    'rep.tasksCreated': 'Tasks created in the selected period',
    'rep.empty': 'No activity in the selected period.',

    'ws.heading': 'Workspace',
    'ws.notice': 'Personal workspace link. Anyone who has this link can use this workspace, so keep it private. If the link leaks, ask your manager to rotate it. This page cannot open the Manager console.',
    'ws.currentTask': 'Current task',
    'ws.start': 'Start',
    'ws.pause': 'Pause',
    'ws.resume': 'Resume',
    'ws.finish': 'Finish task',
    'ws.starting': 'Starting…',
    'ws.pausing': 'Pausing…',
    'ws.resuming': 'Resuming…',
    'ws.finishing': 'Finishing…',
    'ws.finishConfirm': 'Finish the current task? It will be marked completed and the timer will stop.',
    'ws.history': 'Work history',
    'ws.historyEmpty': 'No work sessions recorded yet.',
    'ws.noTask': 'No active task. Ask your manager to assign one.',
    'ws.unavailable': 'This workspace is not available.',

    'err.server_error': 'A server error occurred. Please try again; the owner can check the execution log.',
    'err.too_long': '{field} is too long (max {limit} characters).',
    'err.required_lastName': 'Last name is required.',
    'err.required_firstName': 'First name is required.',
    'err.required_initialTask': 'An initial task is required.',
    'err.required_taskTitle': 'Task title is required.',
    'err.invalid_email': 'A valid email address is required.',
    'err.duplicate_email': 'An employee with this email already exists.',
    'err.employee_not_found': 'Employee not found.',
    'err.employee_required': 'Employee is required.',
    'err.invalid_link': 'Invalid workspace link.',
    'err.no_active_task': 'No active task assigned.',
    'err.session_running': 'A session is already running.',
    'err.no_session_to_pause': 'No active session to pause.',
    'err.no_task_to_finish': 'No active task to finish.',
    'err.date_order': 'The From date must be on or before the To date.',
    'err.date_format': 'Dates must use the YYYY-MM-DD format.',
    'err.date_invalid': 'This is not a valid calendar date.',
    'err.range_too_long': 'The period is too long (max {limit} days).',
    'err.demo_limit': 'Demo limit reached: at most {limit} {what} can be stored. Ask the maintainer to reset the demo data.',
    'err.demo_unavailable': 'The demonstration is unavailable: its environment check failed.',
    'err.locked': 'This deployment is locked.',
    'err.sample_not_demo': 'Sample data is only available in the demonstration build.',
    'err.sample_not_empty': 'Sample data can only be loaded while the demo has no employees.',

    'mail.subject': 'Your Working Time Tracker workspace',
    'mail.body': 'Hello {name},\n\nYou have been added to Working Time Tracker (a demonstration application).\n\nYour task: {task}\n\nOpen your personal workspace: {url}\n\nHow it works:\n- Start begins the timer; Pause stops it; Resume continues; Finish ends the task.\n- Your link is personal. Anyone who has it can use your workspace, so do not share it. It cannot open the manager console.\n\nIf you did not expect this message, you can ignore it; nothing happens unless you open the link.\n\nWorking Time Tracker',

    'csv.employee': 'Employee',
    'csv.email': 'Email',
    'csv.task': 'Task',
    'csv.date': 'Date (UTC)',
    'csv.start': 'Start (UTC)',
    'csv.end': 'End (UTC)',
    'csv.durationHms': 'Duration (hh:mm:ss)',
    'csv.durationSec': 'Duration (seconds)',
    'csv.status': 'Status'
  },

  ru: {
    'app.title': 'Учёт рабочего времени',
    'app.subtitle.manager': 'Консоль менеджера',
    'app.subtitle.employee': 'Рабочее место сотрудника',
    'a11y.skip': 'Перейти к содержимому',
    'lang.label': 'Язык',
    'demo.banner': 'Публичная демонстрация. Используйте только вымышленные данные: любой, у кого есть эта ссылка, видит и меняет здесь всё, а данные могут быть сброшены в любой момент. Приглашение по почте отправляется только если вы отметили эту опцию и указали настоящий адрес (действуют небольшие суточные лимиты); на адреса @example.com письма не отправляются никогда.',
    'footer.note': 'Демонстрация с вымышленными данными. Время указано в UTC.',

    'nav.dashboard': 'Обзор',
    'nav.employees': 'Сотрудники',
    'nav.reports': 'Отчёты',
    'period.from': 'С',
    'period.to': 'По',
    'period.utcNote': 'Дни считаются по календарю UTC.',
    'common.loading': 'Загрузка…',
    'common.close': 'Закрыть',
    'common.unknown': '(неизвестно)',

    'col.date': 'Дата',
    'col.duration': 'Длительность',
    'col.email': 'Эл. почта',
    'col.end': 'Окончание',
    'col.invite': 'Приглашение',
    'col.name': 'Имя',
    'col.start': 'Начало',
    'col.status': 'Статус',
    'col.task': 'Задача',
    'col.total': 'Всего времени',
    'col.actions': 'Действия',

    'dash.totalEmployees': 'Сотрудников',
    'dash.working': 'Сейчас работают',
    'dash.paused': 'На паузе',
    'dash.activeTasks': 'Активные задачи',
    'dash.doneTasks': 'Завершённые задачи',
    'dash.tracked': 'Учтённое время за период',
    'dash.daily': 'Учтённое время по дням',
    'dash.byEmployee': 'Учтённое время по сотрудникам',
    'dash.emptyPeriod': 'За этот период время не учтено.',
    'dash.refresh': 'Обновить',
    'dash.chartLabel': 'Столбчатая диаграмма учтённого времени по дням: {total} за {days} дн.',

    'emp.add': 'Добавить сотрудника',
    'emp.list': 'Сотрудники',
    'emp.search': 'Поиск по имени или почте',
    'emp.searchPh': 'Начните вводить…',
    'emp.filter': 'Статус работы',
    'emp.empty': 'Сотрудников пока нет. Добавьте первого выше.',
    'emp.loadSample': 'Загрузить вымышленные примеры',
    'emp.noResults': 'Нет сотрудников, подходящих под поиск.',
    'emp.count': 'Показано {shown} из {total}',
    'emp.details': 'Подробнее',
    'emp.detailsFor': 'Подробности: {name}',

    'state.all': 'Все',
    'state.working': 'Работает',
    'state.paused': 'На паузе',
    'state.idle': 'Не начинал',
    'status.active': 'идёт',
    'status.paused': 'пауза',
    'status.completed': 'завершено',
    'status.replaced': 'заменена',

    'form.lastName': 'Фамилия',
    'form.firstName': 'Имя',
    'form.middleName': 'Отчество (необязательно)',
    'form.email': 'Эл. почта',
    'form.emailPh': 'name@example.com',
    'form.initialTask': 'Первая задача или цель',
    'form.sendInvite': 'Отправить приглашение со ссылкой на рабочее место',
    'form.create': 'Создать сотрудника',
    'form.creating': 'Создание…',
    'form.created': 'Сотрудник {name} создан.',
    'field.lastName': 'Фамилия',
    'field.firstName': 'Имя',
    'field.middleName': 'Отчество',
    'field.email': 'Эл. почта',
    'field.initialTask': 'Первая задача',
    'field.taskTitle': 'Название задачи',

    'mail.info.disabled': 'Отправка приглашений в этой установке отключена. Скопируйте ссылку на рабочее место в разделе «Подробнее».',
    'mail.info.unavailable': 'Отправка приглашений для этой установки ещё не разрешена (владелец должен подтвердить доступ к почте). Сотрудник всё равно создаётся; скопируйте ссылку на рабочее место в разделе «Подробнее».',
    'mail.info.ready': 'Отправка приглашений доступна (остаток почтовой квоты на сегодня: {remaining}).',

    'invite.none': 'Не отправлялось',
    'invite.sent': 'Принято к доставке',
    'invite.failed': 'Ошибка',
    'invite.unavailable': 'Нет разрешения',
    'invite.skipped_reserved': 'Пропущено (адрес-пример)',
    'invite.limit_global': 'Достигнут суточный лимит',
    'invite.limit_recipient': 'Лимит для адресата',
    'invite.disabled': 'Отключено',
    'invite.not_requested': 'Не запрашивалось',
    'invite.send': 'Отправить приглашение',
    'invite.retry': 'Повторить отправку',
    'invite.resend': 'Отправить приглашение ещё раз',
    'invite.sending': 'Отправка…',
    'invite.result.none': 'Приглашение не отправлялось.',
    'invite.result.not_requested': 'Приглашение не запрашивалось; скопируйте ссылку на рабочее место в разделе «Подробнее».',
    'invite.result.sent': 'Google принял письмо с приглашением к доставке (это не подтверждение получения).',
    'invite.result.failed': 'Не удалось отправить приглашение. Сотрудник сохранён; нажмите «Повторить отправку» или скопируйте ссылку в разделе «Подробнее».',
    'invite.result.unavailable': 'Для этой установки не разрешена отправка почты. Сотрудник сохранён; скопируйте ссылку на рабочее место в разделе «Подробнее».',
    'invite.result.skipped_reserved': 'Письмо не отправлено: адрес относится к зарезервированным адресам-примерам. Скопируйте ссылку на рабочее место в разделе «Подробнее».',
    'invite.result.limit_global': 'Письмо не отправлено: суточный лимит приглашений этой демонстрации исчерпан. Скопируйте ссылку на рабочее место в разделе «Подробнее».',
    'invite.result.limit_recipient': 'Письмо не отправлено: на этот адрес сегодня уже отправлено допустимое число приглашений.',
    'invite.result.disabled': 'Отправка приглашений в этой установке отключена. Скопируйте ссылку на рабочее место в разделе «Подробнее».',

    'details.title': 'Подробности',
    'details.total': 'Всего учтено времени',
    'details.running': 'таймер идёт',
    'details.warnings': 'Предупреждения о данных: не удалось корректно учесть сессий: {n}. См. журнал выполнения на сервере.',
    'details.workspaceLink': 'Ссылка на рабочее место сотрудника',
    'details.copyLink': 'Копировать ссылку',
    'details.copied': 'Ссылка скопирована.',
    'details.copyManual': 'Выделите ссылку и нажмите Ctrl+C, чтобы скопировать.',
    'details.openWorkspace': 'Открыть рабочее место',
    'details.linkNote': 'Любой, у кого есть эта ссылка, может пользоваться рабочим местом сотрудника (запускать и останавливать таймер). Консоль менеджера она не открывает. Ссылка работает независимо от почты.',
    'details.rotate': 'Сменить ссылку на рабочее место',
    'details.rotateConfirm': 'Сменить ссылку на рабочее место сотрудника? Прежняя ссылка перестанет работать сразу, а новую нужно будет передать сотруднику.',
    'details.assign': 'Назначить задачу',
    'details.assignLabel': 'Название новой задачи',
    'details.assigning': 'Назначение…',
    'details.newTask': 'Назначить новую задачу',
    'details.tasks': 'Задачи и рабочие сессии',
    'details.noTasks': 'Задач пока нет.',
    'details.noSessions': 'По этой задаче рабочих сессий пока нет.',
    'details.taskTotal': 'время по задаче: {time}',
    'details.created': 'Создана',
    'details.closed': 'Закрыта',

    'rep.title': 'Отчёт',
    'rep.employee': 'Сотрудник',
    'rep.allEmployees': 'Все сотрудники',
    'rep.generate': 'Сформировать отчёт',
    'rep.generating': 'Формирование…',
    'rep.exportCsv': 'Экспорт в CSV',
    'rep.exporting': 'Подготовка CSV…',
    'rep.exported': 'Файл CSV {name} подготовлен (строк: {n}).',
    'rep.exportManual': 'Скачивание не началось. Скопируйте текст CSV ниже и сохраните его как {name}.',
    'rep.csvFallback': 'Текст CSV (скопируйте, если скачивание не началось)',
    'rep.found': 'Сотрудников с активностью: {n}',
    'rep.grandTotal': 'итого {time}',
    'rep.totalInRange': 'Итого за период',
    'rep.inRange': 'Время в периоде',
    'rep.noSessions': 'В выбранном периоде рабочих сессий нет.',
    'rep.tasksCreated': 'Задачи, созданные в выбранном периоде',
    'rep.empty': 'В выбранном периоде активности нет.',

    'ws.heading': 'Рабочее место',
    'ws.notice': 'Личная ссылка на рабочее место. Любой, у кого есть эта ссылка, может пользоваться этим рабочим местом, поэтому не передавайте её другим. Если ссылка утекла, попросите менеджера сменить её. Консоль менеджера эта страница не открывает.',
    'ws.currentTask': 'Текущая задача',
    'ws.start': 'Старт',
    'ws.pause': 'Пауза',
    'ws.resume': 'Продолжить',
    'ws.finish': 'Завершить задачу',
    'ws.starting': 'Запуск…',
    'ws.pausing': 'Пауза…',
    'ws.resuming': 'Продолжение…',
    'ws.finishing': 'Завершение…',
    'ws.finishConfirm': 'Завершить текущую задачу? Она будет отмечена выполненной, а таймер остановится.',
    'ws.history': 'История работы',
    'ws.historyEmpty': 'Рабочих сессий пока нет.',
    'ws.noTask': 'Нет активной задачи. Попросите менеджера назначить её.',
    'ws.unavailable': 'Это рабочее место недоступно.',

    'err.server_error': 'Произошла ошибка сервера. Повторите попытку; владелец может посмотреть журнал выполнения.',
    'err.too_long': 'Поле «{field}» слишком длинное (максимум {limit} символов).',
    'err.required_lastName': 'Укажите фамилию.',
    'err.required_firstName': 'Укажите имя.',
    'err.required_initialTask': 'Укажите первую задачу.',
    'err.required_taskTitle': 'Укажите название задачи.',
    'err.invalid_email': 'Укажите корректный адрес электронной почты.',
    'err.duplicate_email': 'Сотрудник с такой электронной почтой уже существует.',
    'err.employee_not_found': 'Сотрудник не найден.',
    'err.employee_required': 'Не указан сотрудник.',
    'err.invalid_link': 'Недействительная ссылка на рабочее место.',
    'err.no_active_task': 'Активная задача не назначена.',
    'err.session_running': 'Сессия уже идёт.',
    'err.no_session_to_pause': 'Нет активной сессии для паузы.',
    'err.no_task_to_finish': 'Нет активной задачи для завершения.',
    'err.date_order': 'Дата «С» должна быть не позже даты «По».',
    'err.date_format': 'Даты нужно вводить в формате ГГГГ-ММ-ДД.',
    'err.date_invalid': 'Такой даты не существует.',
    'err.range_too_long': 'Период слишком длинный (максимум {limit} дн.).',
    'err.demo_limit': 'Достигнут лимит демонстрации: можно хранить не более {limit} записей ({what}). Попросите владельца сбросить демо-данные.',
    'err.demo_unavailable': 'Демонстрация недоступна: проверка окружения не пройдена.',
    'err.locked': 'Эта установка заблокирована.',
    'err.sample_not_demo': 'Примеры данных доступны только в демонстрационной сборке.',
    'err.sample_not_empty': 'Примеры можно загрузить, только пока в демо нет сотрудников.',

    'mail.subject': 'Ваше рабочее место в «Учёте рабочего времени»',
    'mail.body': 'Здравствуйте, {name}!\n\nВас добавили в «Учёт рабочего времени» (демонстрационное приложение).\n\nВаша задача: {task}\n\nОткройте своё рабочее место: {url}\n\nКак это работает:\n- «Старт» запускает таймер, «Пауза» останавливает, «Продолжить» возобновляет, «Завершить задачу» закрывает задачу.\n- Ссылка личная. Любой, у кого она есть, может пользоваться вашим рабочим местом, поэтому не передавайте её другим. Консоль менеджера она не открывает.\n\nЕсли вы не ожидали это письмо, просто проигнорируйте его: пока вы не откроете ссылку, ничего не происходит.\n\n«Учёт рабочего времени»',

    'csv.employee': 'Сотрудник',
    'csv.email': 'Эл. почта',
    'csv.task': 'Задача',
    'csv.date': 'Дата (UTC)',
    'csv.start': 'Начало (UTC)',
    'csv.end': 'Окончание (UTC)',
    'csv.durationHms': 'Длительность (чч:мм:сс)',
    'csv.durationSec': 'Длительность (секунды)',
    'csv.status': 'Статус'
  }
};

// Order of precedence: an explicit stored choice, then the ?lang= of the link
// that was opened, then the browser language, then English. Self-contained on
// purpose: the page receives this function's source text (see manager.html).
function resolveLanguage(o) {
  o = o || {};
  var pick = function (v) { v = String(v || '').toLowerCase().slice(0, 2); return (v === 'ru' || v === 'en') ? v : null; };
  return pick(o.stored) || pick(o.param) || pick(o.browser) || 'en';
}

function translate(lang, key, params) {
  var dict = I18N[lang === 'ru' ? 'ru' : 'en'];
  var s = dict[key];
  if (s === undefined) s = I18N.en[key];
  if (s === undefined) return key;
  return s.replace(/\{(\w+)\}/g, function (m, k) { return (params && params[k] !== undefined) ? params[k] : m; });
}

function normalizeLang(v) {
  return String(v || '').toLowerCase().slice(0, 2) === 'ru' ? 'ru' : 'en';
}

// --- server error messages -> translatable codes ------------------------------
// Service code keeps throwing readable English UserError messages; this table
// (checked by tests against every UserError literal in src/) gives each one a
// stable code so the browser can show it in the selected language.
var ERROR_TABLE = [
  [/^Last name is required\.$/, 'required_lastName'],
  [/^First name is required\.$/, 'required_firstName'],
  [/^An initial task is required\.$/, 'required_initialTask'],
  [/^Task title is required\.$/, 'required_taskTitle'],
  [/^A valid email address is required\.$/, 'invalid_email'],
  [/^An employee with this email already exists\.$/, 'duplicate_email'],
  [/^Employee not found\.$/, 'employee_not_found'],
  [/^Employee is required\.$/, 'employee_required'],
  [/^Invalid workspace link\.$/, 'invalid_link'],
  [/^No active task assigned\.$/, 'no_active_task'],
  [/^A session is already running\.$/, 'session_running'],
  [/^No active session to pause\.$/, 'no_session_to_pause'],
  [/^No active task to finish\.$/, 'no_task_to_finish'],
  [/^From date must be on or before To date\.$/, 'date_order'],
  [/^Date must be in YYYY-MM-DD format\.$/, 'date_format'],
  [/^(Date components out of range|Invalid calendar date)\.$/, 'date_invalid'],
  [/^Date range is too long \(max (\d+) days\)\.$/, 'range_too_long', function (m) { return { limit: m[1] }; }],
  [/^The demonstration is unavailable/, 'demo_unavailable'],
  [/^This deployment is locked/, 'locked'],
  [/^Sample data is only available/, 'sample_not_demo'],
  [/^Sample data can only be loaded/, 'sample_not_empty'],
  [/^A server error occurred/, 'server_error'],
  [/^Demo limit reached: at most (\d+) (.+) can be stored\./, 'demo_limit', function (m) { return { limit: m[1], what: m[2] }; }],
  [/^(.+) is too long \(max (\d+) characters\)\.$/, 'too_long', function (m) {
    var map = { 'Last name': 'lastName', 'First name': 'firstName', 'Middle name': 'middleName', 'Email': 'email', 'Initial task': 'initialTask', 'Task title': 'taskTitle' };
    return { field: map[m[1]] || 'taskTitle', limit: m[2] };
  }]
];

function errorCodeFor(message) {
  var msg = String(message || '');
  for (var i = 0; i < ERROR_TABLE.length; i++) {
    var m = ERROR_TABLE[i][0].exec(msg);
    if (m) return { code: ERROR_TABLE[i][1], params: ERROR_TABLE[i][2] ? ERROR_TABLE[i][2](m) : {} };
  }
  return null;
}

// "@@code@@{json params}@@English fallback" - parsed by WTT.errorText in the page.
function errorEncode(message) {
  var c = errorCodeFor(message);
  if (!c) return String(message);
  return '@@' + c.code + '@@' + JSON.stringify(c.params) + '@@' + message;
}

// --- invitation email (plain text only; user text is sanitized and capped) ----
function buildInvitationEmail(lang, data) {
  var l = normalizeLang(lang);
  var name = sanitizeMailText(data.firstName, 60);
  var task = sanitizeMailText(data.taskTitle, 120);
  return {
    subject: translate(l, 'mail.subject'),
    body: translate(l, 'mail.body', { name: name, task: task, url: data.url })
  };
}

function csvLabelsFor(lang) {
  var l = normalizeLang(lang);
  return {
    employee: translate(l, 'csv.employee'), email: translate(l, 'csv.email'), task: translate(l, 'csv.task'),
    date: translate(l, 'csv.date'), start: translate(l, 'csv.start'), end: translate(l, 'csv.end'),
    durationHms: translate(l, 'csv.durationHms'), durationSec: translate(l, 'csv.durationSec'), status: translate(l, 'csv.status'),
    statuses: {
      active: translate(l, 'status.active'), paused: translate(l, 'status.paused'),
      completed: translate(l, 'status.completed'), replaced: translate(l, 'status.replaced')
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    I18N: I18N, resolveLanguage: resolveLanguage, translate: translate, normalizeLang: normalizeLang,
    errorCodeFor: errorCodeFor, errorEncode: errorEncode, buildInvitationEmail: buildInvitationEmail,
    csvLabelsFor: csvLabelsFor, ERROR_TABLE: ERROR_TABLE
  };
}
