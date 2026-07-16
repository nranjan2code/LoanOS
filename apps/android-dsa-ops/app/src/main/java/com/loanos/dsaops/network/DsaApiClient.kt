package com.loanos.dsaops.network

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface DsaApiClient {

    @POST("auth/federated/start")
    suspend fun startFederatedLogin(@Body request: FederatedStartRequest): Response<FederatedStartResponse>

    @POST("auth/federated/exchange")
    suspend fun exchangeFederatedLogin(@Body request: FederatedExchangeRequest): Response<FederatedExchangeResponse>

    /** Server-scoped by the caller's channelScope (partner-restricted for a DSA). */
    @GET("channels/operations")
    suspend fun getChannelOperations(): Response<ChannelOperationsResponse>

    @POST("channels/leads")
    suspend fun submitLead(@Body request: ChannelLeadRequest): Response<ChannelLeadResponse>
}

data class FederatedStartRequest(
    val tenantId: String,
    val policyId: String,
    val redirectUri: String,
    val codeChallenge: String
)

data class FederatedStartResponse(
    val state: String,
    val protocol: String,
    val authorizationUrl: String?,
    val expiresAt: String
)

data class FederatedExchangeRequest(
    val state: String,
    val code: String,
    val codeVerifier: String
)

data class FederatedExchangeResponse(
    val scope: String,
    val tenant: TenantSummary?,
    val user: DsaUserSummary,
    val session: SessionSummary
)

data class TenantSummary(val tenantId: String, val name: String?)

data class ChannelScope(
    val mode: String,
    val partnerIds: List<String> = emptyList(),
    val operatingUnitIds: List<String> = emptyList()
)

data class DsaUserSummary(
    val userId: String,
    val displayName: String,
    val email: String,
    val adminRoles: List<String> = emptyList(),
    val channelScope: ChannelScope? = null
)

data class SessionSummary(val sessionId: String, val expiresAt: String)

data class LendingProgramme(
    val programmeId: String,
    val name: String,
    val productPolicyIds: List<String>,
    val channels: List<String>
)

data class ChannelLeadSummary(
    val leadId: String,
    val partnerId: String?,
    val status: String,
    val contact: LeadContact,
    val requestedAmountPaise: String,
    val requestedProductPolicyId: String,
    val createdAt: String
)

data class ChannelOperationsResponse(
    val lendingProgrammes: List<LendingProgramme> = emptyList(),
    val channelLeads: List<ChannelLeadSummary> = emptyList()
)

data class LeadContact(val name: String, val email: String?, val mobile: String?)

data class LeadAttribution(val source: String, val campaign: String? = null, val referralRef: String? = null)

data class ChannelLeadRequest(
    val leadId: String,
    val programmeId: String,
    val channel: String = "dsa",
    val partnerId: String,
    val postalCode: String,
    val contact: LeadContact,
    val requestedAmountPaise: String,
    val requestedProductPolicyId: String,
    val attribution: LeadAttribution,
    val consentRef: String,
    val disclosureRef: String,
    val conductAttestationRef: String,
    val owner: String
)

data class ChannelLeadResponse(
    val leadId: String,
    val status: String,
    val createdAt: String
)
