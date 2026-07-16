package com.loanos.fieldops.security

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Communicates with Google Play Integrity API to fetch a cryptographically signed hardware
 * attestation token used to certify field devices (`certifyFieldDevice`).
 *
 * Fail-closed: if Play Integrity is unavailable or errors, no token is produced and the
 * caller must treat the device as uncertified. A fabricated fallback token would let an
 * uncertified device onto the compliance plane, so none is ever returned.
 */
class DeviceAttestation(private val context: Context) {

    /**
     * Retrieves the Google Play Integrity token asynchronously.
     * Returns a failed [Result] when attestation cannot be obtained — callers must
     * block certification and field allocation download in that case.
     */
    suspend fun fetchAttestationToken(cloudProjectNumber: Long, nonce: String): Result<String> {
        return runCatching {
            suspendCancellableCoroutine { continuation ->
                val integrityManager = IntegrityManagerFactory.create(context)
                val request = IntegrityTokenRequest.builder()
                    .setCloudProjectNumber(cloudProjectNumber)
                    .setNonce(nonce)
                    .build()

                integrityManager.requestIntegrityToken(request)
                    .addOnSuccessListener { response ->
                        continuation.resume(response.token())
                    }
                    .addOnFailureListener { exception ->
                        continuation.resumeWithException(exception)
                    }
            }
        }
    }
}
