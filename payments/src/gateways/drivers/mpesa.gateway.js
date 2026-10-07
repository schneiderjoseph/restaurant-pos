'use strict';

const logger = require('../../lib/logger');
const { BaseGateway } = require('../base.gateway');
const { PaymentGateway, PaymentStatus, WebhookStatus } = require('../gateway.types');
const { buildMpesaWebhookCallbackUrl } = require('../../lib/intent.utils');
const {
  stkPush,
  stkPushQuery,
  parseStkCallback,
  mapStkResultCode,
  maskPhone,
} = require('../mpesa/daraja.client');

/**
 * Daraja callbacks carry no signature. An STK push started here is remembered by its
 * CheckoutRequestID, and a callback only counts once Safaricom confirms it (STK query).
 */
const PENDING_STK_TTL_MS = 30 * 60 * 1000;
/** checkoutRequestId -> { paymentTypeId, expiresAt } */
const pendingStk = new Map();

function rememberStk(checkoutRequestId, paymentTypeId) {
  const now = Date.now();
  for (const [id, entry] of pendingStk) {
    if (entry.expiresAt <= now) pendingStk.delete(id);
  }
  pendingStk.set(String(checkoutRequestId), { paymentTypeId, expiresAt: now + PENDING_STK_TTL_MS });
}

function getPaymentTypeId(payload) {
  const id = payload?.metadata?.paymentTypeId;
  if (!id) {
    throw new Error('metadata.paymentTypeId is required for M-Pesa');
  }
  return String(id);
}

function mapMpesaCredentials(config, mode) {
  const consumerKey = config?.client_id;
  const consumerSecret = config?.client_secret;
  const passkey = config?.integrity_salt;
  const shortcode = config?.merchant_id;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      'M-Pesa gateway config is incomplete. Set Consumer Key, Consumer Secret, Passkey, and Shortcode on the payment type.'
    );
  }

  const transactionType = (config?.public_key || '').trim() || 'CustomerPayBillOnline';

  return {
    consumerKey: String(consumerKey).trim(),
    consumerSecret: String(consumerSecret).trim(),
    passkey: String(passkey).trim(),
    shortcode: String(shortcode).trim(),
    transactionType,
    mode: mode === 'live' ? 'live' : 'sandbox',
  };
}

function resolveKesAmount(amount, currency) {
  const cur = String(currency || '').toUpperCase();
  if (cur && cur !== 'KES') {
    throw new Error(`M-Pesa requires KES currency (received ${cur})`);
  }
  const kes = Math.round(Number(amount));
  if (!Number.isFinite(kes) || kes <= 0) {
    throw new Error('amount must be a positive number in whole KES');
  }
  return kes;
}

class MpesaGateway extends BaseGateway {
  constructor() {
    super(PaymentGateway.MPESA);
    this.requiresPaymentTypeId = true;
    this.requiresIntentIdOnVerify = true;
    this.requiresServerConfig = true;
  }

  mapCredentials(config, mode) {
    return mapMpesaCredentials(config, mode);
  }

  async createIntent(payload) {
    const paymentTypeId = getPaymentTypeId(payload);
    logger.info('mpesa', 'createIntent', {
      paymentTypeId,
      orderId: payload.orderId,
      amount: payload.amount,
      currency: payload.currency,
      phone: payload.customer?.phone ? logger.maskSecret(String(payload.customer.phone), 6) : null,
    });

    const { loadPaymentTypeGatewayConfig } = require('../../lib/gateway-config.store');
    const { credentials: mpesa } = await loadPaymentTypeGatewayConfig(paymentTypeId, this.name);

    const phone = payload.customer?.phone;
    if (!phone) {
      throw new Error('customer.phone is required for M-Pesa STK push');
    }

    const amount = resolveKesAmount(payload.amount, payload.currency);
    const callbackUrl = buildMpesaWebhookCallbackUrl(payload.orderId);
    logger.info('mpesa', 'STK push starting', { amount, callbackUrl, mode: mpesa.mode });

    const stk = await stkPush({
      credentials: mpesa,
      phone,
      amount,
      accountReference: payload.orderId,
      description: `Order ${payload.orderId}`,
      callbackUrl,
    });

    logger.info('mpesa', 'STK push accepted', {
      checkoutRequestId: stk.checkoutRequestId,
      merchantRequestId: stk.merchantRequestId,
      customerMessage: stk.customerMessage,
    });

    rememberStk(stk.checkoutRequestId, paymentTypeId);

    const now = Date.now();
    return {
      gateway: this.name,
      intentId: stk.checkoutRequestId,
      paymentUrl: null,
      clientToken: maskPhone(stk.phone),
      status: PaymentStatus.PENDING,
      expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      gatewayPayload: {
        merchantRequestId: stk.merchantRequestId,
        checkoutRequestId: stk.checkoutRequestId,
        customerMessage: stk.customerMessage,
        phone: stk.phone,
        paymentTypeId,
      },
    };
  }

  async verify(payload) {
    const paymentTypeId = getPaymentTypeId(payload);
    const checkoutRequestId = payload.intentId;
    if (!checkoutRequestId) {
      throw new Error('intentId (CheckoutRequestID) is required for M-Pesa verify');
    }

    const { loadPaymentTypeGatewayConfig } = require('../../lib/gateway-config.store');
    const { credentials: mpesa } = await loadPaymentTypeGatewayConfig(paymentTypeId, this.name);
    const query = await stkPushQuery({
      credentials: mpesa,
      checkoutRequestId,
    });

    const resultCode = Number(query.ResultCode);
    const status = mapStkResultCode(resultCode);

    return {
      gateway: this.name,
      status,
      verifiedAt: new Date().toISOString(),
      reference: query.MpesaReceiptNumber || null,
      gatewayPayload: {
        resultCode,
        resultDesc: query.ResultDesc,
        responseCode: query.ResponseCode,
        responseDescription: query.ResponseDescription,
        checkoutRequestId: query.CheckoutRequestID || checkoutRequestId,
        merchantRequestId: query.MerchantRequestID || null,
      },
    };
  }

  async handleWebhook(payload) {
    const parsed = parseStkCallback(payload.body || {});
    if (!parsed) {
      return {
        gateway: this.name,
        status: WebhookStatus.IGNORED,
        eventType: 'unknown',
        eventId: null,
        normalizedData: payload.body || {},
        receivedAt: new Date().toISOString(),
      };
    }

    const pending = pendingStk.get(String(parsed.checkoutRequestId || ''));
    let confirmedCode = null;
    if (pending && pending.expiresAt > Date.now()) {
      try {
        const { loadPaymentTypeGatewayConfig } = require('../../lib/gateway-config.store');
        const { credentials } = await loadPaymentTypeGatewayConfig(pending.paymentTypeId, this.name);
        const query = await stkPushQuery({ credentials, checkoutRequestId: parsed.checkoutRequestId });
        confirmedCode = Number(query.ResultCode);
      } catch (err) {
        logger.warn('mpesa', 'STK query for callback failed', { message: err.message });
      }
    }
    if (confirmedCode === null || confirmedCode !== Number(parsed.resultCode)) {
      logger.warn('mpesa', 'Callback not confirmed by STK query — rejected', {
        checkoutRequestId: parsed.checkoutRequestId,
        known: Boolean(pending),
      });
      return {
        gateway: this.name,
        status: WebhookStatus.REJECTED,
        eventType: 'stk_callback',
        eventId: parsed.checkoutRequestId,
        normalizedData: { ...parsed, signatureValid: false },
        receivedAt: new Date().toISOString(),
      };
    }
    pendingStk.delete(String(parsed.checkoutRequestId));

    const paymentStatus = mapStkResultCode(parsed.resultCode);

    return {
      gateway: this.name,
      status: WebhookStatus.RECEIVED,
      eventType: 'stk_callback',
      eventId: parsed.checkoutRequestId,
      normalizedData: {
        ...parsed,
        paymentStatus,
      },
      receivedAt: new Date().toISOString(),
    };
  }
}

module.exports = { MpesaGateway, mapMpesaCredentials };
