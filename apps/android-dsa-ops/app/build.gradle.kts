plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.loanos.dsaops"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.loanos.dsaops"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // AndroidX Core & Lifecycle
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")

    // Jetpack Compose
    implementation(platform("androidx.compose:compose-bom:2024.01.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    // Security & Encrypted Shared Prefs (No Local SQLite for Zero-Local-Data compliance)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Network & Serialization
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.google.code.gson:gson:2.10.1")
    // Pin OkHttp to a Kotlin-native 4.x release (Retrofit 2.9.0 otherwise pulls
    // OkHttp 3.x transitively, whose Java-style Cookie.name()/expiresAt() methods
    // don't map to Kotlin property syntax).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // QR Code visual generator helper
    implementation("com.google.zxing:core:3.5.3")

    // Custom Tabs for the OIDC+PKCE federated login redirect
    implementation("androidx.browser:browser:1.8.0")

    // Biometric step-up for sensitive actions (e.g. consent OTP dispatch)
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.6.2")

    // Testing
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.01.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
