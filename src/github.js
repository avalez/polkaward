const crypto = require("crypto");

const jsonResponse = (statusCode, body) => ({
  statusCode,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const logResponse = (delivery, response) => {
  console.log('Responding to GitHub webhook', {
    delivery,
    statusCode: response.statusCode,
  });
  return response;
}

const getHeader = (headers = {}, name) => {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
}

const parseWebhookBody = (body, contentType = '') => {
  if (!body) return {};
  if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const payload = new URLSearchParams(body).get('payload');
    if (!payload) {
      throw new Error('Missing form payload');
    }
    return JSON.parse(payload);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON payload');
  }
}

const normalizeWebhookBody = (body) => {
  if (typeof body === 'string') {
    return body;
  }

  if (body == null) {
    return '';
  }

  return String(body);
}

const verifyGithubSignature = (body = '', signature, secret) => {
  if (!signature?.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex')}`;
  const expected = Buffer.from(expectedSignature, 'utf8');
  const received = Buffer.from(signature, 'utf8');

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

const handleGithubWebhook = async (request) => {
  const body = normalizeWebhookBody(request.body);
  const contentType = getHeader(request.headers, 'content-type') || '';
  const delivery = getHeader(request.headers, 'x-github-delivery');
  const event = getHeader(request.headers, 'x-github-event');

  console.log('Received GitHub webhook request', {
    method: request.method,
    userPath: request.userPath,
    contentType,
    delivery,
    event,
    bodyLength: body.length,
  });

  if (request.method !== 'POST') {
    return logResponse(delivery, jsonResponse(405, { error: 'Method not allowed' }));
  }

  const signature = getHeader(request.headers, 'x-hub-signature-256');
  const secret = process.env.GITHUB_SECRET;

  if (!secret) {
    console.error('GITHUB_SECRET is not configured; rejecting GitHub webhook.');
    return logResponse(delivery, jsonResponse(500, { error: 'Webhook secret is not configured' }));
  }

  if (!verifyGithubSignature(body, signature, secret)) {
    console.warn('Rejected GitHub webhook with invalid signature', { event, delivery });
    return logResponse(delivery, jsonResponse(401, { error: 'Invalid signature' }));
  }

  let payload;
  try {
    payload = parseWebhookBody(body, contentType);
  } catch (error) {
    return logResponse(delivery, jsonResponse(400, { error: error.message }));
  }

  if (event === 'ping') {
    console.log('Received GitHub webhook ping', {
      delivery,
      repository: payload.repository?.full_name,
      hookId: payload.hook_id,
    });
    return logResponse(delivery, jsonResponse(200, { ok: true, event, delivery }));
  }

  console.log('Received GitHub webhook', {
    event,
    delivery,
    action: payload.action,
    repository: payload.repository?.full_name,
    sender: payload.sender?.login,
  });

  return logResponse(delivery, jsonResponse(202, { ok: true, event, delivery }));
};

module.exports = {
    handleGithubWebhook
};