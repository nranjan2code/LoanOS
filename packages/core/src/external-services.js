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

      bureauProvider: config.bureauProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_PROVIDER : "mock") ?? "mock",
      bureauApiUrl: config.bureauApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_API_URL : "") ?? "",
      bureauApiKey: config.bureauApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_BUREAU_API_KEY : "") ?? "",

      vcipProvider: config.vcipProvider ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_PROVIDER : "mock") ?? "mock",
      vcipApiUrl: config.vcipApiUrl ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_API_URL : "") ?? "",
      vcipApiKey: config.vcipApiKey ?? (typeof process !== "undefined" ? process.env.LOANOS_VCIP_API_KEY : "") ?? "",

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
      return { success: true, provider: "real", ref: `SMS-REAL-${Date.now()}` };
    } else {
      // Mock provider
      console.log(`[MOCK SMS] To: ${phone} | Message: ${message}`);
      return { success: true, provider: "mock", ref: `SMS-MOCK-${Date.now()}` };
    }
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
