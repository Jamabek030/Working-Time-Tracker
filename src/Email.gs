// Email service. Throws on delivery failure so the caller can surface the error.

function email_sendInvitation(employee, initialTaskTitle) {
  var baseUrl = getWebAppUrl();
  var url = baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') +
    'page=employee&token=' + encodeURIComponent(employee.workspaceToken);

  var subject = 'Your Working Time Tracker workspace';
  var body = [
    'Hello ' + employee.firstName + ',',
    '',
    'You have been added to Working Time Tracker.',
    '',
    'Your initial task: ' + initialTaskTitle,
    '',
    'Open your personal workspace: ' + url,
    '',
    'How it works:',
    '  - Click Start to begin working on your task.',
    '  - Click Pause when you take a break; elapsed time stops accruing.',
    '  - Click Resume to continue later, including on another day.',
    '  - Click Finish when the task is complete.',
    '',
    'Your personal link is permanent. Keep it private: anyone who has the link can access your workspace.',
    '',
    'Best,',
    'Working Time Tracker'
  ].join('\n');

  try {
    MailApp.sendEmail({ to: employee.email, subject: subject, body: body });
    return { sent: true };
  } catch (err) {
    throw new Error('Email delivery failed: ' + (err && err.message ? err.message : String(err)));
  }
}
