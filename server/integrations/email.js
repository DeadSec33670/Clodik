'use strict';
const https = require('node:https');

/**
 * Pluggable email-сервис. Драйвер выбирается переменной EMAIL_DRIVER:
 *   - console (по умолчанию): печатает письмо в консоль — удобно для разработки;
 *   - resend:    REST API Resend  (нужен RESEND_API_KEY);
 *   - sendgrid:  REST API SendGrid (нужен SENDGRID_API_KEY).
 *
 * Используется для восстановления пароля и подтверждения заказа (ТЗ).
 * Реальные ключи подставляются в .env — код менять не нужно.
 */

const DRIVER = (process.env.EMAIL_DRIVER || 'console').toLowerCase();
const FROM = process.env.EMAIL_FROM || 'ArhoShop <noreply@arhoshop.ru>';

function postJSON(host, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      { host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`email http ${res.statusCode}: ${body}`));
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendEmail({ to, subject, text, html }) {
  if (DRIVER === 'resend') {
    return postJSON('api.resend.com', '/emails',
      { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from: FROM, to: [to], subject, text, html: html || `<p>${text}</p>` });
  }
  if (DRIVER === 'sendgrid') {
    return postJSON('api.sendgrid.com', '/v3/mail/send',
      { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM.replace(/.*<|>.*/g, '') || FROM },
        subject,
        content: [{ type: 'text/plain', value: text }, ...(html ? [{ type: 'text/html', value: html }] : [])],
      });
  }
  // console-драйвер (dev): не отправляет реальное письмо
  console.log('\n=== EMAIL (console driver) ===');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log(text);
  console.log('=============================\n');
  return 'logged';
}

module.exports = { sendEmail, DRIVER };
