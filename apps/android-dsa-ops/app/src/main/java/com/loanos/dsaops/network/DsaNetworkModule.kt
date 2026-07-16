package com.loanos.dsaops.network

import android.content.Context
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object DsaNetworkModule {
    private const val BASE_URL = "https://api.demo.aitailorworkshop.in/v1/"

    private lateinit var retrofit: Retrofit
    lateinit var apiService: DsaApiClient
        private set
    private lateinit var cookieJar: PersistentCookieJar

    @Volatile
    private var initialized = false

    fun init(context: Context) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return

            cookieJar = PersistentCookieJar(context)

            val platformInterceptor = Interceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("Accept", "application/json")
                    .header("X-Client-Platform", "android")
                    .build()
                chain.proceed(request)
            }

            val okHttpClient = OkHttpClient.Builder()
                .cookieJar(cookieJar)
                .addInterceptor(platformInterceptor)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .build()

            retrofit = Retrofit.Builder()
                .baseUrl(BASE_URL)
                .client(okHttpClient)
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            apiService = retrofit.create(DsaApiClient::class.java)
            initialized = true
        }
    }

    fun clearSession() {
        cookieJar.clear()
    }
}
