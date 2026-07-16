package com.loanos.fieldops.security

import android.util.Base64
import com.loanos.fieldops.network.KeyLeaseRequest
import com.loanos.fieldops.network.NetworkModule

data class LeasedKey(val keyId: String, val keyBytes: ByteArray)

/**
 * Fetches a fresh AES-256 data key from `/experience/keys/lease` for a single
 * envelope. Each offline-work screen leases its own key rather than reusing a
 * hardcoded value, so a leaked device only exposes recently-issued keys.
 */
object KeyLeaseClient {
    suspend fun lease(deviceId: String): Result<LeasedKey> {
        return try {
            val response = NetworkModule.apiService.leaseEncryptionKey(KeyLeaseRequest(deviceId))
            val body = response.body()
            if (response.isSuccessful && body != null) {
                Result.success(LeasedKey(body.keyId, Base64.decode(body.keyMaterialBase64, Base64.NO_WRAP)))
            } else {
                Result.failure(IllegalStateException("Key lease failed (${response.code()})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
