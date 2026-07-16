package com.loanos.fieldops.network

import android.content.Context
import android.util.Log
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.sync.OfflineEnvelope

object SyncManager {
    private const val TAG = "SyncManager"

    suspend fun sync(context: Context): Result<Unit> {
        val database = FieldOpsDatabase.getDatabase(context)
        val assignmentDao = database.assignmentDao()
        val envelopeDao = database.offlineEnvelopeDao()

        return try {
            // 1. Pull assignments from server. Only insert assignments we have not
            // seen yet — locally completed work must not be reset to "pending" by
            // a stale server projection before its envelope has been reconciled.
            val assignmentsResponse = NetworkModule.apiService.getAssignments()
            if (assignmentsResponse.isSuccessful) {
                assignmentsResponse.body()?.let { list ->
                    val newAssignments = list.filter { assignmentDao.getAssignmentById(it.id) == null }
                    if (newAssignments.isNotEmpty()) {
                        assignmentDao.insertAll(newAssignments)
                    }
                    Log.d(TAG, "Fetched ${list.size} assignments (${newAssignments.size} new).")
                }
            } else {
                Log.w(TAG, "Failed to pull assignments: ${assignmentsResponse.code()}")
            }

            // 2. Push pending offline envelopes into the server-side queue.
            val pendingEnvelopes = envelopeDao.getEnvelopesByStatus("queued")
            Log.d(TAG, "Found ${pendingEnvelopes.size} queued envelopes. Uploading.")

            pendingEnvelopes.forEach { entity ->
                val networkEnvelope = OfflineEnvelope(
                    tenantId = entity.tenantId,
                    envelopeId = entity.envelopeId,
                    idempotencyKey = entity.idempotencyKey,
                    deviceId = entity.deviceId,
                    aggregateType = entity.aggregateType,
                    aggregateId = entity.aggregateId,
                    baseVersion = entity.baseVersion,
                    ciphertext = entity.ciphertext,
                    ciphertextSha256 = entity.ciphertextSha256,
                    keyId = entity.keyId,
                    algorithm = entity.algorithm,
                    nonce = entity.nonce,
                    authTag = entity.authTag,
                    createdBy = entity.createdBy,
                    expiresAt = entity.expiresAt
                )

                val response = NetworkModule.apiService.enqueueOfflineWork(networkEnvelope)
                when {
                    response.isSuccessful -> {
                        Log.d(TAG, "Envelope ${entity.envelopeId} accepted by server queue.")
                        envelopeDao.updateStatus(entity.envelopeId, "uploaded")
                    }
                    // 409 = idempotency replay: the server already holds this envelope
                    // from an earlier partially-acknowledged sync. Safe to mark uploaded.
                    response.code() == 409 -> {
                        Log.w(TAG, "Envelope ${entity.envelopeId} already queued server-side (replay).")
                        envelopeDao.updateStatus(entity.envelopeId, "uploaded")
                    }
                    else -> {
                        Log.e(TAG, "Enqueue failed for ${entity.envelopeId}: ${response.code()}. Will retry next sync.")
                    }
                }
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Sync operation failed", e)
            Result.failure(e)
        }
    }
}
