// Email service. Throws on delivery failure so the caller can surface the
// error. The api_* layer records emailSent = true only after this function
// returns without throwing (audit F-02 crosscheck).

function email_sendInvitation(employee, initialTaskTitle) {
  var url = employeeWorkspaceUrl_(employee.workspaceToken);

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
    'Your personal link is permanent until a manager rotates it. Keep it private: anyone who has the link can access your workspace.',
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
