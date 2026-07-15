package com.loanos.fieldops.network

import android.content.Context
import android.util.Log
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.data.OfflineEnvelopeEntity
import com.loanos.fieldops.sync.OfflineEnvelope

object SyncManager {
    private const val TAG = "SyncManager"

    suspend fun sync(context: Context): Result<Unit> {
        val database = FieldOpsDatabase.getDatabase(context)
        val assignmentDao = database.assignmentDao()
        val envelopeDao = database.offlineEnvelopeDao()

        return try {
            // 1. Pull assignments from server
            val assignmentsResponse = NetworkModule.apiService.getAssignments()
            if (assignmentsResponse.isSuccessful) {
                assignmentsResponse.body()?.let { list ->
                    // Replace / update local cache
                    Log.d(TAG, "Fetched ${list.size} assignments. Caching locally.")
                    // Simple replacement strategy
                    list.forEach { assignment ->
                        assignmentDao.insertAll(listOf(assignment))
                    }
                }
            } else {
                Log.w(TAG, "Failed to pull assignments: ${assignmentsResponse.code()}")
            }

            // 2. Push pending offline work queue
            val pendingEnvelopes = envelopeDao.getEnvelopesByStatus("queued")
            Log.d(TAG, "Found ${pendingEnvelopes.size} queued envelopes. Uploading.")
            
            pendingEnvelopes.forEach { entity ->
                val networkEnvelope = OfflineEnvelope(
                    tenantId = entity.tenantId,
                    envelopeId = entity.envelopeId,
                    idempotencyKey = entity.idempotencyKey,
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

                val response = NetworkModule.apiService.reconcileOfflineWork(networkEnvelope)
                if (response.isSuccessful) {
                    val reconciliation = response.body()
                    val nextStatus = reconciliation?.status ?: "applied"
                    Log.d(TAG, "Envelope ${entity.envelopeId} reconciled with status: $nextStatus")
                    envelopeDao.insert(entity.copy(status = nextStatus))
                } else {
                    Log.e(TAG, "Reconcile failed for ${entity.envelopeId}: ${response.code()}")
                }
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Sync operation failed", e)
            Result.failure(e)
        }
    }
}
