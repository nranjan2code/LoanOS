package com.loanos.fieldops.network

import com.loanos.fieldops.data.AssignmentEntity
import com.loanos.fieldops.sync.OfflineEnvelope
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface LoanOsApiClient {

    @POST("experience/devices/certify")
    suspend fun certifyDevice(
        @Body request: DeviceCertRequest
    ): Response<DeviceCertResponse>

    @POST("experience/offline-work/reconcile")
    suspend fun reconcileOfflineWork(
        @Body envelope: OfflineEnvelope
    ): Response<ReconciliationResponse>

    @GET("experience/assignments")
    suspend fun getAssignments(): Response<List<AssignmentEntity>>
}

data class DeviceCertRequest(
    val deviceId: String,
    val platform: String = "android",
    val osVersion: String,
    val browserVersion: String,
    val attestationRef: String,          // Play Integrity token/reference
    val encryptionEvidenceRef: String,
    val assistiveTechnologyEvidenceRef: String,
    val encryptedStorage: Boolean = true,
    val screenLockEnforced: Boolean = true,
    val remoteWipeEnabled: Boolean = true,
    val testedBy: String,
    val approvedBy: String,
    val approvalRef: String,
    val expiresAt: String
)

data class DeviceCertResponse(
    val deviceId: String,
    val status: String, // certified, blocked
    val certifiedAt: String,
    val expiresAt: String
)

data class ReconciliationResponse(
    val envelopeId: String,
    val status: String,         // applied, conflict
    val currentVersion: String?,
    val conflictReason: String?,
    val reconciledAt: String
)
