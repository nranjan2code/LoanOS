package com.loanos.fieldops.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "offline_envelopes")
data class OfflineEnvelopeEntity(
    @PrimaryKey val envelopeId: String,
    val tenantId: String,
    val idempotencyKey: String,
    val deviceId: String,
    val aggregateType: String,
    val aggregateId: String,
    val baseVersion: String,
    val ciphertext: String,
    val ciphertextSha256: String,
    val keyId: String,
    val algorithm: String,
    val nonce: String,
    val authTag: String,
    val createdBy: String,
    val expiresAt: String, // ISO-8601 string
    val queuedAt: String,  // ISO-8601 string
    val status: String     // queued, conflict, applied
)
