package com.loanos.dsaops.auth

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

data class PkcePair(val codeVerifier: String, val codeChallenge: String)

/** Generates an S256 PKCE pair matching /auth/federated/start's `code_challenge_method: S256`. */
object PkceUtil {
    private val urlSafeNoWrap = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

    fun generate(): PkcePair {
        val verifierBytes = ByteArray(64).apply { SecureRandom().nextBytes(this) }
        val codeVerifier = Base64.encodeToString(verifierBytes, urlSafeNoWrap)
        val digest = MessageDigest.getInstance("SHA-256").digest(codeVerifier.toByteArray(Charsets.US_ASCII))
        val codeChallenge = Base64.encodeToString(digest, urlSafeNoWrap)
        return PkcePair(codeVerifier, codeChallenge)
    }
}
