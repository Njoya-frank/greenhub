const DEFAULT_RECIPIENT = 'greenhub2027@gmail.com';
const DEFAULT_FROM = 'Greenhub Orders <onboarding@resend.dev>';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

function sendJson(response, status, body) {
  if (typeof response.status === 'function' && typeof response.json === 'function') {
    return response.status(status).json(body);
  }
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function normalizeOrder(input) {
  const order = input && typeof input === 'object' ? input : {};
  const items = Array.isArray(order.items)
    ? order.items.map((item) => ({
      name: String(item?.name || 'Product').trim().slice(0, 200),
      quantity: Math.max(1, Number.parseInt(item?.quantity, 10) || 1),
      price: Number(Number(item?.price || 0).toFixed(2))
    })).slice(0, 50)
    : [];

  if (!String(order.id || '').trim() || !String(order.customer_name || '').trim() || !String(order.customer_email || '').trim() || !items.length) {
    return null;
  }

  return {
    id: String(order.id).trim().slice(0, 100),
    customerName: String(order.customer_name).trim().slice(0, 200),
    customerEmail: String(order.customer_email).trim().slice(0, 320),
    paymentMethod: String(order.payment_method || 'Not specified').trim().slice(0, 100),
    items,
    total: Number(Number(order.total || 0).toFixed(2))
  };
}

function orderEmailMarkup(order) {
  const rows = order.items.map((item) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right">€${(item.price * item.quantity).toFixed(2)}</td>
    </tr>`).join('');

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17231b;max-width:680px">
      <h2 style="margin-bottom:4px">New Greenhub order</h2>
      <p style="margin-top:0;color:#526158">Order <strong>${escapeHtml(order.id)}</strong> has been placed.</p>
      <table style="border-collapse:collapse;width:100%;margin:20px 0">
        <tbody>
          <tr><td style="padding:6px 0;font-weight:bold;width:160px">Customer</td><td style="padding:6px 0">${escapeHtml(order.customerName)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:bold">Customer email</td><td style="padding:6px 0">${escapeHtml(order.customerEmail)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:bold">Payment method</td><td style="padding:6px 0">${escapeHtml(order.paymentMethod)}</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb">
        <thead><tr style="background:#f3f6f3"><th style="padding:10px 12px;text-align:left">Product</th><th style="padding:10px 12px;text-align:center">Qty</th><th style="padding:10px 12px;text-align:right">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2" style="padding:12px;text-align:right;font-weight:bold">Total</td><td style="padding:12px;text-align:right;font-weight:bold">€${order.total.toFixed(2)}</td></tr></tfoot>
      </table>
    </div>`;
}

function orderEmailText(order) {
  const items = order.items.map((item) => `${item.name} x${item.quantity} — €${(item.price * item.quantity).toFixed(2)}`).join('\n');
  return [
    `New Greenhub order: ${order.id}`,
    `Customer: ${order.customerName}`,
    `Customer email: ${order.customerEmail}`,
    `Payment method: ${order.paymentMethod}`,
    '',
    'Products:',
    items,
    '',
    `Total: €${order.total.toFixed(2)}`
  ].join('\n');
}

async function readRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  let raw = '';
  for await (const chunk of request) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

module.exports = async function orderEmail(request, response) {
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return sendJson(response, 503, { error: 'Order email is not configured yet.' });

  const order = normalizeOrder(await readRequestBody(request));
  if (!order) return sendJson(response, 400, { error: 'Order details are incomplete.' });

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: String(process.env.ORDER_EMAIL_FROM || DEFAULT_FROM).trim(),
      to: [String(process.env.ORDER_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT).trim()],
      reply_to: order.customerEmail,
      subject: `New Greenhub order ${order.id}`,
      html: orderEmailMarkup(order),
      text: orderEmailText(order)
    })
  });

  if (!resendResponse.ok) {
    let errorMessage = 'The email provider rejected the order notification.';
    try {
      const errorBody = await resendResponse.json();
      errorMessage = errorBody?.message || errorBody?.name || errorMessage;
    } catch {
      // Keep the safe fallback message when the provider response is not JSON.
    }
    return sendJson(response, 502, { error: errorMessage });
  }

  let providerResult = {};
  try { providerResult = await resendResponse.json(); } catch { /* no response body required */ }
  return sendJson(response, 200, { sent: true, id: providerResult?.id || null });
};
