package com.loanos.fieldops.sync

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Represents the AES-256-GCM encrypted envelope for compliance-safe offline work queueing.
 * Matches the core verification schema of `enqueueEncryptedOfflineWork` in LoanOS.
 */
data class OfflineEnvelope(
    val tenantId: String,
    val envelopeId: String,
    val idempotencyKey: String,
    val aggregateType: String,
    val aggregateId: String,
    val baseVersion: String,
    val ciphertext: String,        // Base64 encoded ciphertext
    val ciphertextSha256: String,  // Hex-encoded SHA-256 of the ciphertext
    val keyId: String,             // Reference identifier of the KMS key
    val algorithm: String = "AES-256-GCM",
    val nonce: String,             // Base64 encoded IV
    val authTag: String,           // Base64 encoded auth tag
    val createdBy: String,
    val expiresAt: String          // ISO-8601 Future Date
)

object OfflineQueueManager {
    private const val GCM_IV_LENGTH = 12
    private const val GCM_TAG_LENGTH = 16 // 128-bit authentication tag

    /**
     * Encrypts offline work payload using AES-256-GCM and packages it into a compliance-safe envelope.
     * Complies with the zero-plaintext rule on persistent device caches.
     */
    fun createEnvelope(
        tenantId: String,
        aggregateType: String,
        aggregateId: String,
        baseVersion: String,
        plaintextPayload: String,
        keyId: String,
        aesKeyBytes: ByteArray, // Shared/Leased AES key bytes
        createdBy: String,
        expiresAt: String
    ): OfflineEnvelope {
        val iv = ByteArray(GCM_IV_LENGTH).apply { SecureRandom().nextBytes(this) }
        val secretKey = SecretKeySpec(aesKeyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(GCM_TAG_LENGTH * 8, iv)
        
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)
        val encryptedData = cipher.doFinal(plaintextPayload.toByteArray(Charsets.UTF_8))

        // Split ciphertext and GCM authentication tag
        val ciphertextLength = encryptedData.size - GCM_TAG_LENGTH
        val ciphertextBytes = encryptedData.copyOfRange(0, ciphertextLength)
        val tagBytes = encryptedData.copyOfRange(ciphertextLength, encryptedData.size)

        val ciphertextBase64 = Base64.encodeToString(ciphertextBytes, Base64.NO_WRAP)
        val tagBase64 = Base64.encodeToString(tagBytes, Base64.NO_WRAP)
        val ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP)

        // Compute SHA-256 of the ciphertext (string format or raw bytes depending on matching rules,
        // packages/core/src/customer-experience-completion.js does: sha256(input.ciphertext))
        val sha256Digest = MessageDigest.getInstance("SHA-256")
            .digest(ciphertextBase64.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

        return OfflineEnvelope(
            tenantId = tenantId,
            envelopeId = UUID.randomUUID().toString(),
            idempotencyKey = UUID.randomUUID().toString(),
            aggregateType = aggregateType,
            aggregateId = aggregateId,
            baseVersion = baseVersion,
            ciphertext = ciphertextBase64,
            ciphertextSha256 = sha256Digest,
            keyId = keyId,
            nonce = ivBase64,
            authTag = tagBase64,
            createdBy = createdBy,
            expiresAt = expiresAt
        )
    }
}
