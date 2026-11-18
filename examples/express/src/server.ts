import express, { type ErrorRequestHandler } from 'express';
import {
  ErrorCode,
  NepalPayError,
  createNepalPayFromEnv,
  renderRedirectPage,
} from '@bijayx/nepal-pay';
import { Orders } from './orders.ts';

const app = express();
const pay = createNepalPayFromEnv(); // reads NEPAL_PAY_ENV, KHALTI_*, ESEWA_*
const BASE_URL = process.env.APP_URL ?? 'http://localhost:3000';

// 1. Start a payment: create the order, initiate, store the reference, redirect.
app.post('/checkout/:gateway', async (req, res) => {
  const order = Orders.create(150_000); // Rs 1,500 — always computed server-side

  const payment = await pay.gateway(req.params.gateway).initiate({
    amount: order.amount,
    orderId: order.id,
    orderName: 'Charging session',
    returnUrl: `${BASE_URL}/payments/${req.params.gateway}/return?order=${order.id}`,
  });

  Orders.attachPayment(order.id, payment.gateway, payment.reference);

  // Khalti → GET redirect; eSewa → auto-submitting POST form. This handles both.
  res.type('html').send(renderRedirectPage(payment.redirect));
});

// 2. Customer comes back: verify with the gateway, then settle the order once.
app.get('/payments/:gateway/return', async (req, res) => {
  const order = Orders.find(String(req.query.order));
  if (!order?.paymentReference) {
    res.status(404).send('Unknown order');
    return;
  }

  const result = await pay.gateway(req.params.gateway).verify({
    callback: req.query as Record<string, string>,
    expected: { amount: order.amount, reference: order.paymentReference },
  });

  if (result.isPaid) {
    if (Orders.markPaid(order.id)) {
      // First time we've seen this payment: fulfil the order, send receipts, etc.
    }
    res.send(`Paid. Transaction ${result.transactionId ?? ''}`);
    return;
  }

  if (result.status === 'pending' || result.status === 'ambiguous') {
    res.send('Payment is processing. We will update your order shortly.');
    return;
  }

  Orders.markFailed(order.id);
  res.status(402).send(`Payment not completed (${result.status}).`);
});

// 3. One place that turns library errors into HTTP responses.
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof NepalPayError) {
    console.error(error.toJSON()); // safe to log: never contains secrets

    switch (error.code) {
      case ErrorCode.AMOUNT_MISMATCH:
      case ErrorCode.REFERENCE_MISMATCH:
      case ErrorCode.INVALID_SIGNATURE:
        res.status(400).send('Payment could not be verified.'); // fraud signal: alert, do not fulfil
        return;
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.INVALID_CALLBACK:
        res.status(422).send(error.message);
        return;
      case ErrorCode.NETWORK_ERROR:
      case ErrorCode.TIMEOUT:
      case ErrorCode.GATEWAY_ERROR:
        res.status(503).send('Payment provider is unavailable. Please try again.');
        return;
      default:
        res.status(500).send('Payment error');
        return;
    }
  }
  res.status(500).send('Internal error');
};
app.use(errorHandler);

app.listen(3000, () => {
  console.log(`Example running on ${BASE_URL}`);
});
