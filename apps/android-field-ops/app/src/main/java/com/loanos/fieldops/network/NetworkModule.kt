package com.loanos.fieldops.network

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object NetworkModule {
    private const val BASE_URL = "https://api.demo.aitailorworkshop.in/v1/" // Production compliance endpoint

    @Volatile
    private var accessToken: String? = null

    fun setToken(token: String) {
        accessToken = token
    }

    private val authInterceptor = object : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val original = chain.request()
            val requestBuilder = original.newBuilder()
                .header("Accept", "application/json")
                .header("X-Client-Platform", "android")
            
            accessToken?.let {
                requestBuilder.header("Authorization", "Bearer $it")
            }

            return chain.proceed(requestBuilder.build())
        }
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val apiService: LoanOsApiClient = retrofit.create(LoanOsApiClient::class.java)
}
