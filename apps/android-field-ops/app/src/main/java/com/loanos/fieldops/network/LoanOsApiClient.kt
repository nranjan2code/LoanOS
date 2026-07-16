package com.loanos.fieldops.network

import com.loanos.fieldops.data.AssignmentEntity
import com.loanos.fieldops.sync.OfflineEnvelope
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface LoanOsApiClient {

    /**
     * Sets the LoanOS session cookie via Set-Cookie (handled transparently by
     * NetworkModule's PersistentCookieJar) — the response body carries the
     * profile, not a bearer token.
     */
    @POST("auth/login")
    suspend fun login(
        @Body request: LoginRequest
    ): Response<LoginResponse>

    /**
     * A field device cannot certify itself (the backend rejects testedBy == approvedBy
     * — four-eyes). Certification is performed by a security_admin from the tenant
     * back office; the app only ever reads the resulting status.
     */
    @GET("experience/devices/{deviceId}/status")
    suspend fun getDeviceCertificationStatus(
        @Path("deviceId") deviceId: String
    ): Response<DeviceStatusResponse>

    /**
     * Leases a one-time-use AES-256 data key for local envelope encryption.
     * The server never persists the raw key material after this response —
     * it must be used promptly and never written to disk.
     */
    @POST("experience/keys/lease")
    suspend fun leaseEncryptionKey(
        @Body request: KeyLeaseRequest
    ): Response<KeyLeaseResponse>

    /**
     * Pushes an encrypted offline envelope into the tenant's server-side queue.
     * Reconciliation (`/experience/offline-work/reconcile`) is a back-office
     * checker action carrying `evidenceRef`/`currentVersion`; the field device
     * only ever enqueues.
     */
    @POST("experience/offline-work/enqueue")
    suspend fun enqueueOfflineWork(
        @Body envelope: OfflineEnvelope
    ): Response<EnqueueResponse>

    @GET("experience/assignments")
    suspend fun getAssignments(): Response<List<AssignmentEntity>>
}

data class LoginRequest(
    val scope: String = "tenant",
    val tenantId: String,
    val email: String,
    val password: String,
    val mfaCode: String? = null
)

data class LoginResponse(
    val scope: String,
    val tenant: TenantSummary?,
    val user: UserSummary,
    val session: SessionSummary
)

data class TenantSummary(val tenantId: String, val name: String?)

data class UserSummary(
    val userId: String,
    val displayName: String,
    val email: String,
    val adminRoles: List<String> = emptyList()
)

data class SessionSummary(val sessionId: String, val expiresAt: String)

data class DeviceStatusResponse(
    val deviceId: String,
    val status: String, // certified, expired, not_certified, blocked
    val expiresAt: String?
)

data class KeyLeaseRequest(val deviceId: String)

data class KeyLeaseResponse(
    val deviceId: String,
    val keyId: String,
    val keyMaterialBase64: String,
    val algorithm: String,
    val issuedAt: String,
    val expiresAt: String
)

data class EnqueueResponse(
    val envelopeId: String,
    val status: String,         // queued
    val queuedAt: String,
    val expiresAt: String
)
