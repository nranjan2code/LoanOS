package com.loanos.fieldops

import android.app.Application
import com.loanos.fieldops.network.NetworkModule

/**
 * Process-wide entry point for the field-ops app.
 *
 * Owns exactly two pieces of global, one-time-only bootstrap:
 *  1. Loading the native SQLCipher library so [com.loanos.fieldops.data.FieldOpsDatabase]
 *     can open its encrypted Room database later.
 *  2. Initializing [NetworkModule] (Retrofit/OkHttp + the persistent cookie jar) so the
 *     rest of the app can call `NetworkModule.apiService` without null-checking init state.
 *
 * Does NOT own session state, tenant selection, or compliance gating (biometric/device
 * certification) — those live in [SessionManager] / `security.BiometricGate` /
 * `ui.DeviceCertificationScreen` and are driven from [MainActivity] per-launch.
 */
class FieldOpsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize SQLCipher native library (net.zetetic:sqlcipher-android)
        System.loadLibrary("sqlcipher")
        NetworkModule.init(this)
    }
}
