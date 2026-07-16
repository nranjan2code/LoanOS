package com.loanos.fieldops.network

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * The LoanOS API resolves staff sessions from the `Cookie` header only
 * (`sessionTokenFromRequest` in apps/api/src/server.js) — there is no bearer-token
 * path for user sessions. OkHttp does not persist cookies across process restarts
 * by default, so without this the agent would have to re-authenticate every app
 * launch. The session cookie is itself the bearer credential, so it is stored in
 * EncryptedSharedPreferences (Keystore-backed) rather than a plain file.
 */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = EncryptedSharedPreferences.create(
        "loanos_secure_cookie_prefs",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context.applicationContext,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val editor = prefs.edit()
        cookies.forEach { cookie ->
            editor.putString(cookie.name, cookie.toString())
        }
        editor.apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        return prefs.all.values
            .mapNotNull { it as? String }
            .mapNotNull { Cookie.parse(url, it) }
            .filter { !it.expiresAt.let { exp -> exp in 1 until System.currentTimeMillis() } }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
