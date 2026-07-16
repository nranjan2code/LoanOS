package com.loanos.fieldops.location

import android.annotation.SuppressLint
import android.content.Context
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.tasks.await

data class GeoFix(val latitude: Double, val longitude: Double, val accuracyMeters: Float)

/**
 * Fetches a fresh high-accuracy GPS fix for geo-tagged KYC/collateral evidence.
 * Requires ACCESS_FINE_LOCATION to already be granted — callers must request it first.
 */
object GeoLock {
    @SuppressLint("MissingPermission")
    suspend fun getCurrentFix(context: Context): Result<GeoFix> {
        return try {
            val client = LocationServices.getFusedLocationProviderClient(context)
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .build()
            val location = client.getCurrentLocation(request, null).await()
                ?: return Result.failure(IllegalStateException("No GPS fix available. Move to open sky and retry."))
            Result.success(GeoFix(location.latitude, location.longitude, location.accuracy))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
