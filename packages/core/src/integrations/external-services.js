import { createFinding } from "../compliance/compliance-controls.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { assessProviderCertification } from "./provider-governance.js";

// Mock pre-seeded data for Credit Bureau (CIBIL equivalent)
const MOCK_BUREAU_SCORES = {
  "ABCDE1234F": { score: 750, activeAccounts: 2, defaultAccounts: 0, enquiries30Days: 1 }, // Kumar
  "XYZWX9876A": { score: 580, activeAccounts: 4, defaultAccounts: 2, enquiries30Days: 5 }, // Default risk
};

// Mock pre-seeded V-CIP results
const MOCK_VCIP_RECORDS = {
  "borrower_1": { faceMatchScore: 0.92, livenessConfirmed: true, location: { lat: 12.9716, lng: 77.5946, country: "IN" } }
};

const MOCK_BANK_ACCOUNTS = {
  "HDFC0000001:123456789012": {
    accountHolderName: "Asha Sharma",
    accountStatus: "active",
    bankName: "HDFC Bank"
  },
  "ICIC0000002:987654321098": {
    accountHolderName: "Rajesh Kumar",
    accountStatus: "active",
    bankName: "ICICI Bank"
  }
};
const PROVIDER_CIRCUITS = new Map();

/**
 * Service Manager to switch between mock and real integrations.
 * Anchored to the user requirement of toggleable mock/real external connectors.
 */
export class ExternalServiceManager {
  constructor(config = {}) {
    this.simulator = config.simulator ?? null;
    this.simulatorTenantId = config.simulatorTenantId ?? null;
    this.simulatorScenarios = config.simulatorScenarios ?? {};
    this.config = {
      smsProvider: config.smsProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_SMS_PROVIDER : "mock") ?? "mock",
      smsApiUrl: config.smsApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_SMS_API_URL : "") ?? "",
      smsApiKey: config.smsApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_SMS_API_KEY : "") ?? "",
      smsDataResidencyCountry: config.smsDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_SMS_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      emailProvider: config.emailProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_EMAIL_PROVIDER : "mock") ?? "mock",
      emailApiUrl: config.emailApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_EMAIL_API_URL : "") ?? "",
      emailApiKey: config.emailApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_EMAIL_API_KEY : "") ?? "",
      emailDataResidencyCountry: config.emailDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_EMAIL_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      whatsappProvider: config.whatsappProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_WHATSAPP_PROVIDER : "mock") ?? "mock",
      whatsappApiUrl: config.whatsappApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_WHATSAPP_API_URL : "") ?? "",
      whatsappApiKey: config.whatsappApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_WHATSAPP_API_KEY : "") ?? "",
      whatsappDataResidencyCountry: config.whatsappDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_WHATSAPP_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      bureauProvider: config.bureauProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_PROVIDER : "mock") ?? "mock",
      bureauApiUrl: config.bureauApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_API_URL : "") ?? "",
      bureauApiKey: config.bureauApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_API_KEY : "") ?? "",
      bureauDataResidencyCountry: config.bureauDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      vcipProvider: config.vcipProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_PROVIDER : "mock") ?? "mock",
      vcipApiUrl: config.vcipApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_API_URL : "") ?? "",
      vcipApiKey: config.vcipApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_API_KEY : "") ?? "",
      vcipDataResidencyCountry: config.vcipDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      bankAccountProvider: config.bankAccountProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_PROVIDER : "mock") ?? "mock",
      bankAccountApiUrl: config.bankAccountApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_API_URL : "") ?? "",
      bankAccountApiKey: config.bankAccountApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_API_KEY : "") ?? "",
      bankAccountDataResidencyCountry: config.bankAccountDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      paymentRailProvider: config.paymentRailProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_PROVIDER : "mock") ?? "mock",
      paymentRailApiUrl: config.paymentRailApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_API_URL : "") ?? "",
      paymentRailApiKey: config.paymentRailApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_API_KEY : "") ?? "",
      paymentRailDataResidencyCountry: config.paymentRailDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      escrowProvider: config.escrowProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_ESCROW_PROVIDER : "mock") ?? "mock",
      escrowApiUrl: config.escrowApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_ESCROW_API_URL : "") ?? "",
      escrowApiKey: config.escrowApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_ESCROW_API_KEY : "") ?? "",
      escrowDataResidencyCountry: config.escrowDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_ESCROW_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      coreBankingProvider: config.coreBankingProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_CORE_BANKING_PROVIDER : "mock") ?? "mock",
      coreBankingApiUrl: config.coreBankingApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_CORE_BANKING_API_URL : "") ?? "",
      coreBankingApiKey: config.coreBankingApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_CORE_BANKING_API_KEY : "") ?? "",
      coreBankingDataResidencyCountry: config.coreBankingDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_CORE_BANKING_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      esignProvider: config.esignProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_PROVIDER : "mock") ?? "mock",
      esignApiUrl: config.esignApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_API_URL : "") ?? "",
      esignApiKey: config.esignApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_API_KEY : "") ?? "",
      esignDataResidencyCountry: config.esignDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      cersaiProvider: config.cersaiProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_PROVIDER : "mock") ?? "mock",
      cersaiApiUrl: config.cersaiApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_API_URL : "") ?? "",
      cersaiApiKey: config.cersaiApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_API_KEY : "") ?? "",
      cersaiDataResidencyCountry: config.cersaiDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      fiuProvider: config.fiuProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_PROVIDER : "mock") ?? "mock",
      fiuApiUrl: config.fiuApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_API_URL : "") ?? "",
      fiuApiKey: config.fiuApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_API_KEY : "") ?? "",
      fiuDataResidencyCountry: config.fiuDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",
      cicProvider: config.cicProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_CIC_PROVIDER : "mock") ?? "mock",
      cicApiUrl: config.cicApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_CIC_API_URL : "") ?? "",
      cicApiKey: config.cicApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_CIC_API_KEY : "") ?? "",
      cicDataResidencyCountry: config.cicDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_CIC_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",
      ckycrrProvider: config.ckycrrProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_CKYCRR_PROVIDER : "mock") ?? "mock",
      ckycrrApiUrl: config.ckycrrApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_CKYCRR_API_URL : "") ?? "",
      ckycrrApiKey: config.ckycrrApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_CKYCRR_API_KEY : "") ?? "",
      ckycrrDataResidencyCountry: config.ckycrrDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_CKYCRR_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",
      accountAggregatorProvider: config.accountAggregatorProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_ACCOUNT_AGGREGATOR_PROVIDER : "mock") ?? "mock",
      accountAggregatorApiUrl: config.accountAggregatorApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_ACCOUNT_AGGREGATOR_API_URL : "") ?? "",
      accountAggregatorApiKey: config.accountAggregatorApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_ACCOUNT_AGGREGATOR_API_KEY : "") ?? "",
      accountAggregatorDataResidencyCountry: config.accountAggregatorDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_ACCOUNT_AGGREGATOR_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",
      providerCertifications: config.providerCertifications ?? (typeof process !== "undefined" && process.env.LOANOS_PROVIDER_CERTIFICATIONS ? JSON.parse(process.env.LOANOS_PROVIDER_CERTIFICATIONS) : {}),
      providerCallbackSecrets: config.providerCallbackSecrets ?? (typeof process !== "undefined" && process.env.LOANOS_PROVIDER_CALLBACK_SECRETS ? JSON.parse(process.env.LOANOS_PROVIDER_CALLBACK_SECRETS) : {})
      ,providerTimeoutMs: Number(config.providerTimeoutMs ?? (typeof process !== "undefined" ? process.env.LOANOS_PROVIDER_TIMEOUT_MS : 5000) ?? 5000),
      providerMaxAttempts: Number(config.providerMaxAttempts ?? (typeof process !== "undefined" ? process.env.LOANOS_PROVIDER_MAX_ATTEMPTS : 2) ?? 2)
      ,providerCircuitFailureThreshold: Number(config.providerCircuitFailureThreshold ?? (typeof process !== "undefined" ? process.env.LOANOS_PROVIDER_CIRCUIT_FAILURE_THRESHOLD : 3) ?? 3),
      providerCircuitCooldownMs: Number(config.providerCircuitCooldownMs ?? (typeof process !== "undefined" ? process.env.LOANOS_PROVIDER_CIRCUIT_COOLDOWN_MS : 30000) ?? 30000)
    };

    if (config.isSandbox) {
      this.config.smsProvider = "mock";
      this.config.emailProvider = "mock";
      this.config.whatsappProvider = "mock";
      this.config.bureauProvider = "mock";
      this.config.vcipProvider = "mock";
      this.config.bankAccountProvider = "mock";
      this.config.paymentRailProvider = "mock";
      this.config.escrowProvider = "mock";
      this.config.coreBankingProvider = "mock";
      this.config.esignProvider = "mock";
      this.config.cersaiProvider = "mock";
      this.config.fiuProvider = "mock";
      this.config.cicProvider = "mock";
      this.config.ckycrrProvider = "mock";
      this.config.accountAggregatorProvider = "mock";
    }
  }

  integrationReadiness() {
    const integrations = [["sms", "SMS", "sms"], ["email", "Email", "email"], ["whatsapp", "WhatsApp", "whatsapp"], ["bureau", "Credit Bureau", "bureau"], ["vcip", "V-CIP", "vcip"], ["bank_account", "Bank account verification", "bankAccount"], ["payment_rail", "Payment rail", "paymentRail"], ["esign", "eSign", "esign"], ["cersai", "CERSAI", "cersai"], ["fiu", "FIU-IND", "fiu"], ["cic", "Credit information company", "cic"], ["ckycrr", "CKYCRR", "ckycrr"], ["account_aggregator", "Account Aggregator", "accountAggregator"], ["escrow", "Escrow", "escrow"], ["core_banking", "Core banking", "coreBanking"]];
    return integrations.map(([integration, label, prefix]) => {
      const provider = this.config[`${prefix}Provider`]; const dataResidencyCountry = this.config[`${prefix}DataResidencyCountry`]; const hasEndpoint = Boolean(this.config[`${prefix}ApiUrl`]); const hasCredential = Boolean(this.config[`${prefix}ApiKey`]); const residencyCompliant = dataResidencyCountry === "IN"; const certification = assessProviderCertification(this.config.providerCertifications, integration); const configured = provider === "mock" || (hasEndpoint && hasCredential && residencyCompliant && certification.certified); const circuit = PROVIDER_CIRCUITS.get(label); const circuitOpenUntil = circuit?.openUntil && circuit.openUntil > Date.now() ? new Date(circuit.openUntil).toISOString() : null;
      const reason = circuitOpenUntil ? "provider_circuit_open" : configured ? null : !residencyCompliant ? "india_data_residency_required" : !hasEndpoint || !hasCredential ? "endpoint_or_credential_missing" : certification.reason;
      return { integration, label, provider, mode: provider === "mock" ? "mock" : "real", status: circuitOpenUntil ? "degraded" : configured ? (provider === "mock" ? "mock" : "ready") : "blocked", dataResidencyCountry, residencyCompliant, hasEndpoint, hasCredential, certificationStatus: provider === "mock" ? "not_required" : certification.status, certificationExpiresAt: certification.certification?.expiresAt ?? null, circuitOpenUntil, consecutiveFailures: circuit?.failures ?? 0, reason };
    });
  }

  assertCertified(integration) {
    const assessment = assessProviderCertification(this.config.providerCertifications, integration);
    if (!assessment.certified) throw new Error(`${integration} live provider is blocked: ${assessment.reason}.`);
    return assessment.certification;
  }

  simulateMockProvider({ provider, operation, idempotencyKey, scenario, payload = {} } = {}) {
    if (!this.simulator) throw new Error("A tenant-local provider simulator is not configured.");
    const providerPrefixes = { bureau: "bureau", vcip: "vcip", bank_account: "bankAccount", payment_rail: "paymentRail", esign: "esign", ckycrr: "ckycrr", account_aggregator: "accountAggregator", sms: "sms", email: "email", whatsapp: "whatsapp", cersai: "cersai", fiu: "fiu", cic: "cic", escrow: "escrow", core_banking: "coreBanking" };
    const prefix = providerPrefixes[provider];
    if (!prefix) throw new Error(`Provider simulator does not support ${provider}.`);
    if (this.config[`${prefix}Provider`] === "real") throw new Error("Provider simulator cannot execute for a real provider configuration.");
    const result = this.simulator.submit({ tenantId: this.simulatorTenantId, provider, operation, idempotencyKey, scenario, payload });
    const callbacks = typeof this.simulator.pendingCallbacks === "function" ? this.simulator.pendingCallbacks().filter((item) => item.payload?.requestId === result?.requestId) : [];
    if (callbacks.some((item) => typeof this.simulator.verify === "function" && !this.simulator.verify(item))) throw new Error(`Simulated ${provider} callback integrity validation failed.`);
    return result;
  }

  simulatedMock(provider, operation, idempotencyKey, payload = {}) {
    if (!this.simulator) return null;
    const scenario = this.simulatorScenarios[`${provider}.${operation}`] ?? this.simulatorScenarios[provider] ?? "success";
    const result = this.simulateMockProvider({ provider, operation, idempotencyKey, scenario, payload });
    if (!result?.success) throw new Error(`Simulated ${provider} provider rejected ${operation}${result?.responseCode ? `: ${result.responseCode}` : "."}`);
    return result;
  }

  verifyProviderCallback(provider, eventId, payload, signature) {
    if (!/^[a-z_]{2,40}$/.test(String(provider ?? "")) || !eventId || !signature) throw new Error("Provider callback requires a valid provider, eventId, and signature.");
    const secret = this.config.providerCallbackSecrets?.[provider];
    if (!secret) throw new Error(`Provider callback secret is not configured for ${provider}.`);
    const expected = createHmac("sha256", secret).update(`${provider}.${eventId}.${JSON.stringify(payload ?? {})}`).digest("hex");
    const supplied = String(signature).replace(/^sha256=/i, "");
    if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))) throw new Error("Provider callback signature is invalid.");
    return { provider, eventId, payloadHash: createHmac("sha256", secret).update(JSON.stringify(payload ?? {})).digest("hex") };
  }

  verifyPaymentSettlementCallback(eventId, payload, signature, timestamp, now = new Date()) {
    if (!timestamp) throw new Error("Payment callback timestamp is required.");
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs)) throw new Error("Payment callback timestamp is invalid.");
    const toleranceMs = 5 * 60 * 1000;
    if (Math.abs(now.getTime() - timestampMs) > toleranceMs) throw new Error("Payment callback timestamp is outside the replay-protection window.");
    const provider = "payment_rail";
    const secret = this.config.providerCallbackSecrets?.[provider];
    if (!eventId || !signature || !secret) throw new Error("Payment callback signature configuration and event identity are required.");
    const expected = createHmac("sha256", secret).update(`${provider}.${timestamp}.${eventId}.${JSON.stringify(payload ?? {})}`).digest("hex");
    const supplied = String(signature).replace(/^sha256=/i, "");
    if (!/^[a-f0-9]{64}$/i.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))) throw new Error("Payment callback signature is invalid.");
    return { provider, eventId, timestamp: new Date(timestampMs).toISOString(), payloadHash: createHmac("sha256", secret).update(JSON.stringify(payload ?? {})).digest("hex") };
  }

  /**
   * Sends an SMS notification.
   */
  async sendSms(phone, message) {
    ensureIndiaDataResidency("SMS", this.config.smsDataResidencyCountry);
    if (this.config.smsProvider === "real") {
      if (!this.config.smsApiUrl || !this.config.smsApiKey) {
        throw new Error("Real SMS provider configured but API URL or API key is missing.");
      }
      this.assertCertified("sms");
      // Call actual REST API
      const res = await fetch(this.config.smsApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.smsApiKey}`
        },
        body: JSON.stringify({ phone, message })
      });
      if (!res.ok) {
        throw new Error(`Real SMS Gateway returned status ${res.status}`);
      }
      return {
        success: true,
        channel: "sms",
        provider: "real",
        ref: `SMS-REAL-${Date.now()}`,
        dataResidencyCountry: this.config.smsDataResidencyCountry
      };
    } else {
      // Mock provider
      const simulated = this.simulatedMock("sms", "send", mockIdempotencyKey("sms", phone, message), { phone, message });
      if (simulated) return { success: true, channel: "sms", provider: "mock", ref: simulated.providerReference, dataResidencyCountry: this.config.smsDataResidencyCountry, ...simulated.response };
      console.log(`[MOCK SMS] To: ${phone} | Message: ${message}`);
      return {
        success: true,
        channel: "sms",
        provider: "mock",
        ref: `SMS-MOCK-${Date.now()}`,
        dataResidencyCountry: this.config.smsDataResidencyCountry
      };
    }
  }

  async sendEmail(to, subject, message) {
    ensureIndiaDataResidency("Email", this.config.emailDataResidencyCountry);
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      throw new Error("Valid email recipient is required.");
    }
    if (!subject) {
      throw new Error("Email subject is required.");
    }
    if (this.config.emailProvider === "real") {
      if (!this.config.emailApiUrl || !this.config.emailApiKey) {
        throw new Error("Real email provider configured but API URL or API key is missing.");
      }
      this.assertCertified("email");
      const res = await fetch(this.config.emailApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.emailApiKey}`
        },
        body: JSON.stringify({ to, subject, message })
      });
      if (!res.ok) {
        throw new Error(`Real email provider returned status ${res.status}`);
      }
      return {
        success: true,
        channel: "email",
        provider: "real",
        ref: `EMAIL-REAL-${Date.now()}`,
        dataResidencyCountry: this.config.emailDataResidencyCountry
      };
    }

    const simulated = this.simulatedMock("email", "send", mockIdempotencyKey("email", to, subject, message), { to, subject, message });
    if (simulated) return { success: true, channel: "email", provider: "mock", ref: simulated.providerReference, dataResidencyCountry: this.config.emailDataResidencyCountry, ...simulated.response };
    console.log(`[MOCK EMAIL] To: ${to} | Subject: ${subject} | Message: ${message}`);
    return {
      success: true,
      channel: "email",
      provider: "mock",
      ref: `EMAIL-MOCK-${Date.now()}`,
      dataResidencyCountry: this.config.emailDataResidencyCountry
    };
  }

  async sendWhatsApp(phone, message) {
    ensureIndiaDataResidency("WhatsApp", this.config.whatsappDataResidencyCountry);
    if (!/^\+?\d{10,15}$/.test(String(phone ?? "").replace(/[\s-]/g, ""))) {
      throw new Error("Valid WhatsApp phone recipient is required.");
    }
    if (this.config.whatsappProvider === "real") {
      if (!this.config.whatsappApiUrl || !this.config.whatsappApiKey) {
        throw new Error("Real WhatsApp provider configured but API URL or API key is missing.");
      }
      this.assertCertified("whatsapp");
      const res = await fetch(this.config.whatsappApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.whatsappApiKey}`
        },
        body: JSON.stringify({ phone, message })
      });
      if (!res.ok) {
        throw new Error(`Real WhatsApp provider returned status ${res.status}`);
      }
      return {
        success: true,
        channel: "whatsapp",
        provider: "real",
        ref: `WHATSAPP-REAL-${Date.now()}`,
        dataResidencyCountry: this.config.whatsappDataResidencyCountry
      };
    }

    const simulated = this.simulatedMock("whatsapp", "send", mockIdempotencyKey("whatsapp", phone, message), { phone, message });
    if (simulated) return { success: true, channel: "whatsapp", provider: "mock", ref: simulated.providerReference, dataResidencyCountry: this.config.whatsappDataResidencyCountry, ...simulated.response };
    console.log(`[MOCK WHATSAPP] To: ${phone} | Message: ${message}`);
    return {
      success: true,
      channel: "whatsapp",
      provider: "mock",
      ref: `WHATSAPP-MOCK-${Date.now()}`,
      dataResidencyCountry: this.config.whatsappDataResidencyCountry
    };
  }

  async sendCommunication({ channel, to, subject, message } = {}) {
    if (channel === "sms") {
      return this.sendSms(to, message);
    }
    if (channel === "email") {
      return this.sendEmail(to, subject, message);
    }
    if (channel === "whatsapp") {
      return this.sendWhatsApp(to, message);
    }
    throw new Error("Communication channel must be sms, email, or whatsapp.");
  }

  /**
   * Queries Credit Bureau (CIBIL equivalent).
   */
  async queryCreditBureau(panNumber) {
    ensureIndiaDataResidency("Credit Bureau", this.config.bureauDataResidencyCountry);
    if (this.config.bureauProvider === "real") {
      if (!this.config.bureauApiUrl || !this.config.bureauApiKey) {
        throw new Error("Real Credit Bureau provider configured but API credentials missing.");
      }
      this.assertCertified("bureau");
      const res = await fetch(`${this.config.bureauApiUrl}/scores?pan=${encodeURIComponent(panNumber)}`, {
        headers: {
          "Authorization": `Bearer ${this.config.bureauApiKey}`
        }
      });
      if (!res.ok) {
        throw new Error(`Real Credit Bureau query failed with status ${res.status}`);
      }
      return await res.json();
    } else {
      // Mock provider
      const simulated = this.simulatedMock("bureau", "query", mockIdempotencyKey("bureau", panNumber), { panNumber });
      const match = MOCK_BUREAU_SCORES[panNumber] || { score: 700, activeAccounts: 1, defaultAccounts: 0, enquiries30Days: 0 };
      return {
        success: true,
        provider: "mock",
        pan: panNumber,
        score: simulated?.response?.score ?? match.score,
        activeAccounts: simulated?.response?.activeAccounts ?? match.activeAccounts,
        defaultAccounts: simulated?.response?.defaultAccounts ?? match.defaultAccounts,
        enquiries30Days: simulated?.response?.enquiries30Days ?? match.enquiries30Days,
        dataResidencyCountry: this.config.bureauDataResidencyCountry,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Invokes V-CIP video analysis / facial match.
   */
  async analyzeVcipVideo(borrowerId, videoHash) {
    ensureIndiaDataResidency("V-CIP", this.config.vcipDataResidencyCountry);
    if (this.config.vcipProvider === "real") {
      if (!this.config.vcipApiUrl || !this.config.vcipApiKey) {
        throw new Error("Real V-CIP provider configured but credentials missing.");
      }
      this.assertCertified("vcip");
      const res = await fetch(this.config.vcipApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.vcipApiKey}`
        },
        body: JSON.stringify({ borrowerId, videoHash })
      });
      if (!res.ok) {
        throw new Error(`Real V-CIP service failed with status ${res.status}`);
      }
      return await res.json();
    } else {
      // Mock provider
      const simulated = this.simulatedMock("vcip", "analyze", mockIdempotencyKey("vcip", borrowerId, videoHash), { borrowerId, videoHash });
      const match = MOCK_VCIP_RECORDS[borrowerId] || { faceMatchScore: 0.85, livenessConfirmed: true, location: { lat: 28.6139, lng: 77.2090, country: "IN" } };
      return {
        success: true,
        provider: "mock",
        borrowerId,
        faceMatchScore: simulated?.response?.faceMatchScore ?? match.faceMatchScore,
        livenessConfirmed: simulated?.response?.livenessConfirmed ?? match.livenessConfirmed,
        gps: simulated?.response?.gps ?? simulated?.response?.location ?? match.location,
        dataResidencyCountry: this.config.vcipDataResidencyCountry,
        verifiedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Verifies that a disbursement bank account exists, is active, and matches
   * the expected borrower or end-beneficiary name before funds move.
   */
  async verifyBankAccount({ accountNumber, ifsc, expectedHolderName } = {}) {
    ensureIndiaDataResidency("Bank account verification", this.config.bankAccountDataResidencyCountry);
    const normalizedAccountNumber = String(accountNumber ?? "").trim();
    const normalizedIfsc = String(ifsc ?? "").trim().toUpperCase();
    if (!/^\d{6,18}$/.test(normalizedAccountNumber)) {
      throw new Error("Invalid bank account number format. Must be 6 to 18 numeric digits.");
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      throw new Error("Invalid IFSC format.");
    }

    if (this.config.bankAccountProvider === "real") {
      if (!this.config.bankAccountApiUrl || !this.config.bankAccountApiKey) {
        throw new Error("Real bank account verification provider configured but credentials missing.");
      }
      this.assertCertified("bank_account");
      const res = await fetch(this.config.bankAccountApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.bankAccountApiKey}`
        },
        body: JSON.stringify({
          accountNumber: normalizedAccountNumber,
          ifsc: normalizedIfsc,
          expectedHolderName
        })
      });
      if (!res.ok) {
        throw new Error(`Real bank account verification failed with status ${res.status}`);
      }
      return await res.json();
    }

    const accountNumberLast4 = normalizedAccountNumber.slice(-4);
    const simulated = this.simulatedMock("bank_account", "verify", mockIdempotencyKey("bank_account", normalizedIfsc, normalizedAccountNumber, expectedHolderName ?? ""), { accountNumber: normalizedAccountNumber, ifsc: normalizedIfsc, expectedHolderName });
    if (simulated) {
      const response = simulated.response ?? {}; const status = response.status ?? "verified";
      return { success: response.success ?? status === "verified", provider: "mock", verificationRef: response.verificationRef ?? simulated.providerReference, status, accountStatus: response.accountStatus ?? (status === "not_found" ? null : "active"), bankName: response.bankName ?? null, ifsc: normalizedIfsc, accountNumberLast4, accountHolderName: response.accountHolderName ?? null, expectedHolderName: expectedHolderName ?? null, nameMatch: response.nameMatch ?? status === "verified", dataResidencyCountry: this.config.bankAccountDataResidencyCountry, verifiedAt: simulated.respondedAt };
    }
    const match = MOCK_BANK_ACCOUNTS[`${normalizedIfsc}:${normalizedAccountNumber}`] ?? null;
    if (!match) {
      return {
        success: false,
        provider: "mock",
        status: "not_found",
        ifsc: normalizedIfsc,
        accountNumberLast4,
        dataResidencyCountry: this.config.bankAccountDataResidencyCountry,
        verifiedAt: new Date().toISOString()
      };
    }

    const nameMatch = expectedHolderName
      ? normalizeName(expectedHolderName) === normalizeName(match.accountHolderName)
      : true;
    const status = match.accountStatus !== "active"
      ? "inactive"
      : nameMatch
        ? "verified"
        : "name_mismatch";

    return {
      success: status === "verified",
      provider: "mock",
      verificationRef: `BANK-VERIFY-MOCK-${Date.now()}`,
      status,
      accountStatus: match.accountStatus,
      bankName: match.bankName,
      ifsc: normalizedIfsc,
      accountNumberLast4,
      accountHolderName: match.accountHolderName,
      expectedHolderName: expectedHolderName ?? null,
      nameMatch,
      dataResidencyCountry: this.config.bankAccountDataResidencyCountry,
      verifiedAt: new Date().toISOString()
    };
  }

  /**
   * Registers a NACH mandate with a payment rail provider. This first slice
   * records initiation evidence only; settlement/reconciliation stay in LMS.
   */
  async createNachMandate(input = {}) {
    ensureIndiaDataResidency("Payment rail", this.config.paymentRailDataResidencyCountry);
    const payload = normalizeNachMandateInput(input);
    if (this.config.paymentRailProvider === "real") {
      if (!this.config.paymentRailApiUrl || !this.config.paymentRailApiKey) {
        throw new Error("Real payment rail provider configured but API URL or API key is missing.");
      }
      this.assertCertified("payment_rail");
      const res = await fetch(`${this.config.paymentRailApiUrl}/nach/mandates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.paymentRailApiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`Real payment rail provider returned status ${res.status}`);
      }
      return await res.json();
    }

    const simulated = this.simulatedMock("payment_rail", "nach_mandate", mockIdempotencyKey("nach_mandate", payload), payload);
    if (simulated) return { success: true, provider: "mock", channel: "nach", mandateRef: simulated.response?.mandateRef ?? simulated.providerReference, status: simulated.response?.status ?? "registered", dataResidencyCountry: this.config.paymentRailDataResidencyCountry, registeredAt: simulated.respondedAt };
    return {
      success: true,
      provider: "mock",
      channel: "nach",
      mandateRef: `NACH-MOCK-${Date.now()}`,
      status: "registered",
      dataResidencyCountry: this.config.paymentRailDataResidencyCountry,
      registeredAt: new Date().toISOString()
    };
  }

  /**
   * Creates a UPI collect request. The response is initiation evidence, not a
   * confirmed loan-account payment.
   */
  async createUpiCollect(input = {}) {
    ensureIndiaDataResidency("Payment rail", this.config.paymentRailDataResidencyCountry);
    const payload = normalizeUpiCollectInput(input);
    if (this.config.paymentRailProvider === "real") {
      if (!this.config.paymentRailApiUrl || !this.config.paymentRailApiKey) {
        throw new Error("Real payment rail provider configured but API URL or API key is missing.");
      }
      this.assertCertified("payment_rail");
      const res = await fetch(`${this.config.paymentRailApiUrl}/upi/collects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.paymentRailApiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`Real payment rail provider returned status ${res.status}`);
      }
      return await res.json();
    }

    const simulated = this.simulatedMock("payment_rail", "upi_collect", mockIdempotencyKey("upi_collect", payload), payload);
    if (simulated) return { success: true, provider: "mock", channel: "upi", collectRef: simulated.response?.collectRef ?? simulated.providerReference, status: simulated.response?.status ?? "pending", dataResidencyCountry: this.config.paymentRailDataResidencyCountry, createdAt: simulated.respondedAt };
    return {
      success: true,
      provider: "mock",
      channel: "upi",
      collectRef: `UPI-MOCK-${Date.now()}`,
      status: "pending",
      dataResidencyCountry: this.config.paymentRailDataResidencyCountry,
      createdAt: new Date().toISOString()
    };
  }

  // Creates a single NACH debit presentment against an already-registered
  // mandate. Initiation is deliberately distinct from settlement: no loan
  // payment exists until the provider callback is reconciled.
  async createNachPresentment(input = {}) {
    ensureIndiaDataResidency("Payment rail", this.config.paymentRailDataResidencyCountry);
    const mandateRef = String(input.mandateRef ?? "").trim();
    if (!mandateRef) throw new Error("NACH presentment requires mandateRef.");
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("NACH presentment amount must be positive.");
    }
    if (this.config.paymentRailProvider === "real") {
      if (!this.config.paymentRailApiUrl || !this.config.paymentRailApiKey) {
        throw new Error("Real payment rail provider configured but API URL or API key is missing.");
      }
      this.assertCertified("payment_rail");
      const res = await fetch(`${this.config.paymentRailApiUrl}/nach/presentments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.config.paymentRailApiKey}` },
        body: JSON.stringify({ mandateRef, amount: input.amount, currency: input.currency ?? "INR", dueDate: input.dueDate ?? null })
      });
      if (!res.ok) throw new Error(`Real payment rail provider returned status ${res.status}`);
      return await res.json();
    }
    const presentmentPayload = { mandateRef, amount: input.amount, currency: input.currency ?? "INR", dueDate: input.dueDate ?? null };
    const simulated = this.simulatedMock("payment_rail", "nach_presentment", mockIdempotencyKey("nach_presentment", presentmentPayload), presentmentPayload);
    if (simulated) return { success: true, provider: "mock", channel: "nach", presentmentRef: simulated.response?.presentmentRef ?? simulated.providerReference, status: simulated.response?.status ?? "pending", dataResidencyCountry: this.config.paymentRailDataResidencyCountry, createdAt: simulated.respondedAt };
    return {
      success: true,
      provider: "mock",
      channel: "nach",
      presentmentRef: `NACH-PRESENTMENT-MOCK-${Date.now()}`,
      status: "pending",
      dataResidencyCountry: this.config.paymentRailDataResidencyCountry,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Verifies Aadhaar-based eSign OTP.
   */
  async verifyEsignOtp(aadhaarNumber, otp, payloadHash) {
    ensureIndiaDataResidency("eSign", this.config.esignDataResidencyCountry);
    if (!aadhaarNumber || aadhaarNumber.length !== 12 || !/^\d{12}$/.test(aadhaarNumber)) {
      throw new Error("Invalid Aadhaar number format. Must be 12 numeric digits.");
    }
    if (this.config.esignProvider === "real") {
      if (!this.config.esignApiUrl || !this.config.esignApiKey) {
        throw new Error("Real eSign provider configured but credentials missing.");
      }
      this.assertCertified("esign");
      const res = await fetch(this.config.esignApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.esignApiKey}`
        },
        body: JSON.stringify({ aadhaarNumber, otp, payloadHash })
      });
      if (!res.ok) {
        throw new Error(`Real eSign service failed with status ${res.status}`);
      }
      return await res.json();
    } else {
      // Mock provider
      const simulated = this.simulatedMock("esign", "verify_otp", mockIdempotencyKey("esign", aadhaarNumber, payloadHash), { aadhaarNumber, otp, payloadHash });
      if (simulated) {
        const envelopeId = simulated.response?.envelopeId ?? simulated.providerReference;
        return { success: true, provider: "mock", signatureRef: simulated.response?.signatureRef ?? simulated.providerReference, signedAt: simulated.respondedAt, esignProvider: "mock", dataResidencyCountry: this.config.esignDataResidencyCountry, envelopeId, externalEnvelopeStorageUrl: simulated.response?.externalEnvelopeStorageUrl ?? `https://esign-provider.mock/envelopes/${envelopeId}` };
      }
      if (otp !== "123456") {
        throw new Error("Invalid eSign OTP. Mock provider expects OTP '123456'.");
      }
      const envelopeId = `env_esign_${Date.now()}`;
      return {
        success: true,
        provider: "mock",
        signatureRef: `SIG-MOCK-${Date.now()}`,
        signedAt: new Date().toISOString(),
        esignProvider: "mock",
        dataResidencyCountry: this.config.esignDataResidencyCountry,
        envelopeId,
        externalEnvelopeStorageUrl: `https://esign-provider.mock/envelopes/${envelopeId}`
      };
    }
  }

  /**
   * Files a security interest with CERSAI.
   */
  async fileCersaiSecurityInterest(securityInterestData) {
    ensureIndiaDataResidency("CERSAI", this.config.cersaiDataResidencyCountry);
    if (this.config.cersaiProvider === "real") {
      if (!this.config.cersaiApiUrl || !this.config.cersaiApiKey) {
        throw new Error("Real CERSAI provider configured but credentials missing.");
      }
      this.assertCertified("cersai");
      return postProviderJson(`${this.config.cersaiApiUrl}/security-interests`, securityInterestData, this.config.cersaiApiKey, securityInterestData.checksumSha256, "CERSAI", this.config);
    } else {
      // Mock provider
      const simulated = this.simulatedMock("cersai", "file", mockIdempotencyKey("cersai_file", securityInterestData.checksumSha256, securityInterestData.securityInterestId), securityInterestData);
      if (simulated) return { success: true, provider: "mock", providerSubmissionRef: simulated.response?.providerSubmissionRef ?? simulated.providerReference, checksumSha256: securityInterestData.checksumSha256 ?? null, dataResidencyCountry: this.config.cersaiDataResidencyCountry, filedAt: simulated.respondedAt };
      return {
        success: true,
        provider: "mock",
        providerSubmissionRef: `CERSAI-SUB-MOCK-${Date.now()}`,
        checksumSha256: securityInterestData.checksumSha256 ?? null,
        dataResidencyCountry: this.config.cersaiDataResidencyCountry,
        filedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Searches CERSAI for existing charges on an asset.
   */
  async searchCersai(assetDescription) {
    ensureIndiaDataResidency("CERSAI", this.config.cersaiDataResidencyCountry);
    if (this.config.cersaiProvider === "real") {
      if (!this.config.cersaiApiUrl || !this.config.cersaiApiKey) {
        throw new Error("Real CERSAI provider configured but credentials missing.");
      }
      this.assertCertified("cersai");
      const res = await fetch(`${this.config.cersaiApiUrl}/search?asset=${encodeURIComponent(assetDescription)}`, {
        headers: {
          "Authorization": `Bearer ${this.config.cersaiApiKey}`
        }
      });
      if (!res.ok) {
        throw new Error(`Real CERSAI search failed with status ${res.status}`);
      }
      return await res.json();
    } else {
      // Mock provider — returns no existing charges
      const simulated = this.simulatedMock("cersai", "search", mockIdempotencyKey("cersai_search", assetDescription), { assetDescription });
      if (simulated) return { success: true, provider: "mock", count: simulated.response?.count ?? simulated.response?.charges?.length ?? 0, charges: simulated.response?.charges ?? [], dataResidencyCountry: this.config.cersaiDataResidencyCountry, searchedAt: simulated.respondedAt };
      return {
        success: true,
        provider: "mock",
        count: 0,
        charges: [],
        dataResidencyCountry: this.config.cersaiDataResidencyCountry,
        searchedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Files an STR/CTR with FIU-IND.
   */
  async fileFiuReport(reportData) {
    ensureIndiaDataResidency("FIU-IND", this.config.fiuDataResidencyCountry);
    if (this.config.fiuProvider === "real") {
      if (!this.config.fiuApiUrl || !this.config.fiuApiKey) {
        throw new Error("Real FIU-IND provider configured but credentials missing.");
      }
      this.assertCertified("fiu");
      return postProviderJson(`${this.config.fiuApiUrl}/reports`, reportData, this.config.fiuApiKey, reportData.checksumSha256, "FIU-IND", this.config);
    } else {
      // Mock provider
      const simulated = this.simulatedMock("fiu", "file", mockIdempotencyKey("fiu_file", reportData.checksumSha256, reportData.reportId), reportData);
      if (simulated) return { success: true, provider: "mock", providerSubmissionRef: simulated.response?.providerSubmissionRef ?? simulated.providerReference, checksumSha256: reportData.checksumSha256 ?? null, dataResidencyCountry: this.config.fiuDataResidencyCountry, filedAt: simulated.respondedAt };
      return {
        success: true,
        provider: "mock",
        providerSubmissionRef: `FIU-SUB-MOCK-${Date.now()}`,
        checksumSha256: reportData.checksumSha256 ?? null,
        dataResidencyCountry: this.config.fiuDataResidencyCountry,
        filedAt: new Date().toISOString()
      };
    }
  }

  async submitCicReportingBatch(batch = {}) {
    ensureIndiaDataResidency("Credit information company", this.config.cicDataResidencyCountry);
    if (!batch.batchId || !batch.checksumSha256 || !Number.isInteger(batch.recordCount)) throw new Error("CIC transport requires a checksum-bound reporting batch.");
    if (this.config.cicProvider === "real") {
      if (!this.config.cicApiUrl || !this.config.cicApiKey) throw new Error("Real CIC provider configured but credentials missing.");
      this.assertCertified("cic");
      return postProviderJson(`${this.config.cicApiUrl}/batches`, batch, this.config.cicApiKey, batch.checksumSha256, "Credit information company", this.config);
    }
    const simulated = this.simulatedMock("cic", "submit", mockIdempotencyKey("cic_submit", batch.batchId, batch.checksumSha256), batch);
    if (simulated) return { success: true, provider: "mock", providerSubmissionRef: simulated.response?.providerSubmissionRef ?? simulated.providerReference, transportEvidenceRef: simulated.response?.transportEvidenceRef ?? simulated.providerReference, checksumSha256: batch.checksumSha256, submittedAt: simulated.respondedAt, dataResidencyCountry: "IN" };
    return { success: true, provider: "mock", providerSubmissionRef: `CIC-MOCK-${batch.batchId}`, transportEvidenceRef: `CIC-TRANSPORT-MOCK-${batch.checksumSha256}`, checksumSha256: batch.checksumSha256, submittedAt: new Date().toISOString(), dataResidencyCountry: "IN" };
  }

  async submitCkycrrPacket(submission = {}) {
    ensureIndiaDataResidency("CKYCRR", this.config.ckycrrDataResidencyCountry);
    if (!submission.submissionId || !submission.packet?.checksumSha256) throw new Error("CKYCRR transport requires a checksum-bound packet.");
    if (this.config.ckycrrProvider === "real") {
      if (!this.config.ckycrrApiUrl || !this.config.ckycrrApiKey) throw new Error("Real CKYCRR provider configured but credentials missing.");
      this.assertCertified("ckycrr");
      return postProviderJson(`${this.config.ckycrrApiUrl}/submissions`, submission, this.config.ckycrrApiKey, submission.packet.checksumSha256, "CKYCRR", this.config);
    }
    const simulated = this.simulatedMock("ckycrr", "submit", `ckycrr:${submission.submissionId}:${submission.packet.checksumSha256}`, submission);
    if (simulated) return { success: true, provider: "mock", providerSubmissionRef: simulated.response?.providerSubmissionRef ?? simulated.providerReference, transportRef: simulated.response?.transportRef ?? simulated.providerReference, digitalSignatureRef: simulated.response?.digitalSignatureRef ?? `CKYCRR-DSC-${simulated.providerReference}`, fileName: simulated.response?.fileName ?? `${submission.submissionId}.zip`, fileSizeBytes: simulated.response?.fileSizeBytes ?? Buffer.byteLength(submission.packet.canonicalContent ?? "{}"), submittedAt: simulated.respondedAt, dataResidencyCountry: "IN" };
    return { success: true, provider: "mock", providerSubmissionRef: `CKYCRR-MOCK-${submission.submissionId}`, transportRef: `CKYCRR-TRANSPORT-MOCK-${submission.packet.checksumSha256}`, digitalSignatureRef: `CKYCRR-DSC-MOCK-${submission.submissionId}`, fileName: `${submission.submissionId}.zip`, fileSizeBytes: Buffer.byteLength(submission.packet.canonicalContent ?? "{}"), submittedAt: new Date().toISOString(), dataResidencyCountry: "IN" };
  }

  async fetchAccountAggregatorData(consent = {}, request = {}) {
    ensureIndiaDataResidency("Account Aggregator", this.config.accountAggregatorDataResidencyCountry);
    if (!consent.consentId || !consent.aaConsentHandle) throw new Error("AA fetch requires an active provider consent handle.");
    if (this.config.accountAggregatorProvider === "real") {
      if (!this.config.accountAggregatorApiUrl || !this.config.accountAggregatorApiKey) throw new Error("Real Account Aggregator provider configured but credentials missing.");
      this.assertCertified("account_aggregator");
      return postProviderJson(`${this.config.accountAggregatorApiUrl}/fi/fetch`, { consentHandle: consent.aaConsentHandle, ...request }, this.config.accountAggregatorApiKey, request.fetchId ?? `${consent.consentId}:${(consent.fetches ?? []).length + 1}`, "Account Aggregator", this.config);
    }
    const idempotencyKey = request.fetchId ?? `${consent.consentId}:${(consent.fetches ?? []).length + 1}`;
    const simulated = this.simulatedMock("account_aggregator", "fetch", idempotencyKey, { consentHandle: consent.aaConsentHandle, ...request });
    if (simulated) return { success: true, provider: "mock_aa", providerFetchRef: simulated.response?.providerFetchRef ?? simulated.providerReference, recordCount: simulated.response?.recordCount ?? request.recordCount ?? consent.fiTypes?.length ?? 0, payloadHash: simulated.response?.payloadHash ?? request.payloadHash ?? null, dataResidencyCountry: "IN", fetchedAt: simulated.respondedAt };
    return { success: true, provider: "mock_aa", providerFetchRef: `AA-MOCK-${consent.consentId}-${(consent.fetches ?? []).length + 1}`, recordCount: request.recordCount ?? consent.fiTypes?.length ?? 0, payloadHash: request.payloadHash ?? null, dataResidencyCountry: "IN", fetchedAt: new Date().toISOString() };
  }

  async submitEscrowInstruction(instruction = {}) {
    ensureIndiaDataResidency("Co-lending escrow", this.config.escrowDataResidencyCountry);
    if (!instruction.instructionId || !instruction.escrowAccountRef || !instruction.checksumSha256 || !Number.isFinite(instruction.amount) || instruction.amount < 0) throw new Error("Escrow instruction requires identifiers, checksum, and a non-negative amount.");
    if (this.config.escrowProvider === "real") {
      if (!this.config.escrowApiUrl || !this.config.escrowApiKey) throw new Error("Real escrow provider configured but API URL or API key is missing.");
      this.assertCertified("escrow");
      const res = await fetch(`${this.config.escrowApiUrl}/instructions`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.config.escrowApiKey}` }, body: JSON.stringify(instruction) });
      if (!res.ok) throw new Error(`Real escrow provider returned status ${res.status}`);
      const result = await res.json();
      if (!result?.providerReference || result?.checksumSha256 !== instruction.checksumSha256 || result?.status !== "accepted") throw new Error("Escrow provider acknowledgement did not exactly match the submitted instruction.");
      return result;
    }
    const simulated = this.simulatedMock("escrow", "submit", mockIdempotencyKey("escrow_submit", instruction.instructionId, instruction.checksumSha256), instruction);
    if (simulated) return { status: simulated.response?.status ?? "accepted", provider: "mock", providerReference: simulated.response?.providerReference ?? simulated.providerReference, checksumSha256: instruction.checksumSha256, acceptedAt: simulated.respondedAt, dataResidencyCountry: this.config.escrowDataResidencyCountry };
    return { status: "accepted", provider: "mock", providerReference: `ESCROW-MOCK-${instruction.instructionId}`, checksumSha256: instruction.checksumSha256, acceptedAt: new Date().toISOString(), dataResidencyCountry: this.config.escrowDataResidencyCountry };
  }

  async postCoreBankingBatch(batch = {}) {
    ensureIndiaDataResidency("Core banking", this.config.coreBankingDataResidencyCountry);
    if (!batch.batchId || !batch.checksumSha256 || !Number.isInteger(batch.lineCount) || batch.lineCount <= 0 || !Array.isArray(batch.lines) || batch.lines.length !== batch.lineCount) throw new Error("Core-banking batch requires an exact checksum-bound line payload.");
    if (this.config.coreBankingProvider === "real") {
      if (!this.config.coreBankingApiUrl || !this.config.coreBankingApiKey) throw new Error("Real core-banking provider configured but API URL or API key is missing.");
      this.assertCertified("core_banking");
      const res = await fetch(`${this.config.coreBankingApiUrl}/journal-batches`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.config.coreBankingApiKey}` }, body: JSON.stringify(batch) });
      if (!res.ok) throw new Error(`Real core-banking provider returned status ${res.status}`);
      const result = await res.json();
      if (!result?.providerReference || result?.checksumSha256 !== batch.checksumSha256 || result?.lineCount !== batch.lineCount || result?.status !== "accepted") throw new Error("Core-banking acknowledgement did not exactly match the submitted batch.");
      return result;
    }
    const simulated = this.simulatedMock("core_banking", "post_batch", mockIdempotencyKey("core_banking", batch.batchId, batch.checksumSha256), batch);
    if (simulated) return { status: simulated.response?.status ?? "accepted", provider: "mock", providerReference: simulated.response?.providerReference ?? simulated.providerReference, checksumSha256: batch.checksumSha256, lineCount: batch.lineCount, acceptedAt: simulated.respondedAt, dataResidencyCountry: this.config.coreBankingDataResidencyCountry };
    return { status: "accepted", provider: "mock", providerReference: `CBS-MOCK-${batch.batchId}`, checksumSha256: batch.checksumSha256, lineCount: batch.lineCount, acceptedAt: new Date().toISOString(), dataResidencyCountry: this.config.coreBankingDataResidencyCountry };
  }
}

function mockIdempotencyKey(provider, ...values) {
  return `${provider}:${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function postProviderJson(url, payload, apiKey, idempotencyKey, provider, config) {
  const circuit = PROVIDER_CIRCUITS.get(provider); const now = Date.now();
  if (circuit?.openUntil && circuit.openUntil > now) throw new Error(`${provider} provider circuit is open until ${new Date(circuit.openUntil).toISOString()}.`);
  const attempts = Math.max(1, Math.min(3, Number.isInteger(config.providerMaxAttempts) ? config.providerMaxAttempts : 2));
  const timeoutMs = Math.max(250, Math.min(30000, Number.isFinite(config.providerTimeoutMs) ? config.providerTimeoutMs : 5000));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) { PROVIDER_CIRCUITS.delete(provider); return await res.json(); }
      if (res.status < 500 || attempt === attempts) throw new Error(`${provider} provider failed with status ${res.status}`);
      lastError = new Error(`${provider} provider transiently failed with status ${res.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
  }
  const threshold = Math.max(1, Math.min(10, Number.isInteger(config.providerCircuitFailureThreshold) ? config.providerCircuitFailureThreshold : 3));
  const failures = (circuit?.failures ?? 0) + 1; const cooldownMs = Math.max(1000, Math.min(300000, Number.isFinite(config.providerCircuitCooldownMs) ? config.providerCircuitCooldownMs : 30000));
  PROVIDER_CIRCUITS.set(provider, { failures, openUntil: failures >= threshold ? now + cooldownMs : null });
  throw new Error(`${provider} provider unavailable after ${attempts} attempt(s): ${lastError?.message ?? "unknown error"}`);
}

function normalizeNachMandateInput(input = {}) {
  if (!input.borrowerId) {
    throw new Error("NACH mandate requires borrowerId.");
  }
  const maxAmount = Number(input.maxAmount);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    throw new Error("NACH mandate requires a positive maxAmount.");
  }
  const frequency = input.frequency ?? "monthly";
  if (!["monthly", "quarterly", "half_yearly", "yearly", "as_presented"].includes(frequency)) {
    throw new Error("NACH mandate frequency must be monthly, quarterly, half_yearly, yearly, or as_presented.");
  }
  if (!input.bankAccountVerificationRef && !input.accountNumberLast4) {
    throw new Error("NACH mandate requires bankAccountVerificationRef or accountNumberLast4.");
  }
  return {
    borrowerId: input.borrowerId,
    loanAccountId: input.loanAccountId ?? null,
    applicationId: input.applicationId ?? null,
    maxAmount,
    currency: input.currency ?? "INR",
    frequency,
    startsAt: input.startsAt ?? null,
    expiresAt: input.expiresAt ?? null,
    consentRef: input.consentRef ?? null,
    bankAccountVerificationRef: input.bankAccountVerificationRef ?? null,
    accountNumberLast4: input.accountNumberLast4 ?? null,
    ifsc: input.ifsc ? String(input.ifsc).trim().toUpperCase() : null
  };
}

function normalizeUpiCollectInput(input = {}) {
  if (!input.vpa || !/^[A-Za-z0-9.\-_]{2,256}@[A-Za-z0-9.\-_]{2,64}$/.test(String(input.vpa))) {
    throw new Error("UPI collect requires a valid VPA.");
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("UPI collect requires a positive amount.");
  }
  return {
    borrowerId: input.borrowerId ?? null,
    loanAccountId: input.loanAccountId ?? null,
    applicationId: input.applicationId ?? null,
    amount,
    currency: input.currency ?? "INR",
    purpose: input.purpose ?? "repayment",
    vpa: String(input.vpa).trim().toLowerCase(),
    expiresAt: input.expiresAt ?? null
  };
}

function ensureIndiaDataResidency(label, country) {
  if (country !== "IN") {
    throw new Error(`${label} provider data residency country must be IN.`);
  }
}
