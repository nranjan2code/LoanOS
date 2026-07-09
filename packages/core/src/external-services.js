import { createFinding } from "./compliance-controls.js";

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

/**
 * Service Manager to switch between mock and real integrations.
 * Anchored to the user requirement of toggleable mock/real external connectors.
 */
export class ExternalServiceManager {
  constructor(config = {}) {
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

      vcipProvider: config.vcipProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_PROVIDER : "mock") ?? "mock",
      vcipApiUrl: config.vcipApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_API_URL : "") ?? "",
      vcipApiKey: config.vcipApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_API_KEY : "") ?? "",

      bankAccountProvider: config.bankAccountProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_PROVIDER : "mock") ?? "mock",
      bankAccountApiUrl: config.bankAccountApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_API_URL : "") ?? "",
      bankAccountApiKey: config.bankAccountApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_BANK_ACCOUNT_API_KEY : "") ?? "",

      paymentRailProvider: config.paymentRailProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_PROVIDER : "mock") ?? "mock",
      paymentRailApiUrl: config.paymentRailApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_API_URL : "") ?? "",
      paymentRailApiKey: config.paymentRailApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_API_KEY : "") ?? "",
      paymentRailDataResidencyCountry: config.paymentRailDataResidencyCountry ?? (typeof process !== "undefined" ? process.env.LOANOS_PAYMENT_RAIL_DATA_RESIDENCY_COUNTRY : "IN") ?? "IN",

      esignProvider: config.esignProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_PROVIDER : "mock") ?? "mock",
      esignApiUrl: config.esignApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_API_URL : "") ?? "",
      esignApiKey: config.esignApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_ESIGN_API_KEY : "") ?? "",

      cersaiProvider: config.cersaiProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_PROVIDER : "mock") ?? "mock",
      cersaiApiUrl: config.cersaiApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_API_URL : "") ?? "",
      cersaiApiKey: config.cersaiApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_CERSAI_API_KEY : "") ?? "",

      fiuProvider: config.fiuProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_PROVIDER : "mock") ?? "mock",
      fiuApiUrl: config.fiuApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_API_URL : "") ?? "",
      fiuApiKey: config.fiuApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_FIU_API_KEY : "") ?? ""
    };
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
    if (this.config.bureauProvider === "real") {
      if (!this.config.bureauApiUrl || !this.config.bureauApiKey) {
        throw new Error("Real Credit Bureau provider configured but API credentials missing.");
      }
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
      const match = MOCK_BUREAU_SCORES[panNumber] || { score: 700, activeAccounts: 1, defaultAccounts: 0, enquiries30Days: 0 };
      return {
        success: true,
        provider: "mock",
        pan: panNumber,
        score: match.score,
        activeAccounts: match.activeAccounts,
        defaultAccounts: match.defaultAccounts,
        enquiries30Days: match.enquiries30Days,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Invokes V-CIP video analysis / facial match.
   */
  async analyzeVcipVideo(borrowerId, videoHash) {
    if (this.config.vcipProvider === "real") {
      if (!this.config.vcipApiUrl || !this.config.vcipApiKey) {
        throw new Error("Real V-CIP provider configured but credentials missing.");
      }
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
      const match = MOCK_VCIP_RECORDS[borrowerId] || { faceMatchScore: 0.85, livenessConfirmed: true, location: { lat: 28.6139, lng: 77.2090, country: "IN" } };
      return {
        success: true,
        provider: "mock",
        borrowerId,
        faceMatchScore: match.faceMatchScore,
        livenessConfirmed: match.livenessConfirmed,
        gps: match.location,
        verifiedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Verifies that a disbursement bank account exists, is active, and matches
   * the expected borrower or end-beneficiary name before funds move.
   */
  async verifyBankAccount({ accountNumber, ifsc, expectedHolderName } = {}) {
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
    const match = MOCK_BANK_ACCOUNTS[`${normalizedIfsc}:${normalizedAccountNumber}`] ?? null;
    if (!match) {
      return {
        success: false,
        provider: "mock",
        status: "not_found",
        ifsc: normalizedIfsc,
        accountNumberLast4,
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

  /**
   * Verifies Aadhaar-based eSign OTP.
   */
  async verifyEsignOtp(aadhaarNumber, otp, payloadHash) {
    if (!aadhaarNumber || aadhaarNumber.length !== 12 || !/^\d{12}$/.test(aadhaarNumber)) {
      throw new Error("Invalid Aadhaar number format. Must be 12 numeric digits.");
    }
    if (this.config.esignProvider === "real") {
      if (!this.config.esignApiUrl || !this.config.esignApiKey) {
        throw new Error("Real eSign provider configured but credentials missing.");
      }
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
      if (otp !== "123456") {
        throw new Error("Invalid eSign OTP. Mock provider expects OTP '123456'.");
      }
      return {
        success: true,
        provider: "mock",
        signatureRef: `SIG-MOCK-${Date.now()}`,
        signedAt: new Date().toISOString(),
        esignProvider: "mock"
      };
    }
  }

  /**
   * Files a security interest with CERSAI.
   */
  async fileCersaiSecurityInterest(securityInterestData) {
    if (this.config.cersaiProvider === "real") {
      if (!this.config.cersaiApiUrl || !this.config.cersaiApiKey) {
        throw new Error("Real CERSAI provider configured but credentials missing.");
      }
      const res = await fetch(`${this.config.cersaiApiUrl}/security-interests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.cersaiApiKey}`
        },
        body: JSON.stringify(securityInterestData)
      });
      if (!res.ok) {
        throw new Error(`Real CERSAI service failed with status ${res.status}`);
      }
      return await res.json();
    } else {
      // Mock provider
      return {
        success: true,
        provider: "mock",
        cersaiTransactionId: `CERSAI-MOCK-${Date.now()}`,
        cersaiRegistrationNumber: `REG-MOCK-${Date.now()}`,
        filedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Searches CERSAI for existing charges on an asset.
   */
  async searchCersai(assetDescription) {
    if (this.config.cersaiProvider === "real") {
      if (!this.config.cersaiApiUrl || !this.config.cersaiApiKey) {
        throw new Error("Real CERSAI provider configured but credentials missing.");
      }
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
      return {
        success: true,
        provider: "mock",
        count: 0,
        charges: [],
        searchedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Files an STR/CTR with FIU-IND.
   */
  async fileFiuReport(reportData) {
    if (this.config.fiuProvider === "real") {
      if (!this.config.fiuApiUrl || !this.config.fiuApiKey) {
        throw new Error("Real FIU-IND provider configured but credentials missing.");
      }
      const res = await fetch(`${this.config.fiuApiUrl}/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.fiuApiKey}`
        },
        body: JSON.stringify(reportData)
      });
      if (!res.ok) {
        throw new Error(`Real FIU-IND filing failed with status ${res.status}`);
      }
      return await res.json();
    } else {
      // Mock provider
      return {
        success: true,
        provider: "mock",
        fiuAcknowledgementId: `FIU-ACK-MOCK-${Date.now()}`,
        filedAt: new Date().toISOString()
      };
    }
  }
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
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
