import {db} from './_db.js';

export async function notifyUser(userId, subject, body) {
  const safeSubject = String(subject || 'TrackNest notification').slice(0, 180);
  const safeBody = String(body || '').slice(0, 4000);
  // Persist an in-app notification using the actual production table schema.
  try {
    await db('notifications', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, title: safeSubject, message: safeBody, type: 'payment', is_read: false })
    });
  } catch (error) {
    // A notification delivery failure must never undo a completed wallet action.
  }

  let u; try { u = (await db('users?id=eq.' + encodeURIComponent(userId) + '&select=email,phone'))[0]; } catch (error) { return; }
  if (!u) return;
  const jobs = [];
  if (process.env.RESEND_API_KEY && u.email) {
    jobs.push((async () => {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'TrackNest <onboarding@resend.dev>',
            to: [u.email], subject: safeSubject, html: '<p>' + safeBody.replace(/</g, '&lt;') + '</p>'
          })
        });
      } catch (error) {}
    })());
  }
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM && u.phone) {
    jobs.push((async () => {
      try {
        const basic = Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
        await fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json', {
          method: 'POST',
          headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ From: process.env.TWILIO_FROM, To: u.phone, Body: safeSubject + ': ' + safeBody })
        });
      } catch (error) {}
    })());
  }
  await Promise.all(jobs);
}
